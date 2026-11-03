// The built UI (ui/dist) in headless Chrome, served with a stand-in core: for checks that need a real page (layout,
// the top layer, focus, a connection that drops and comes back). No extra dependencies: Node's own http and WebSocket,
// Chrome over the DevTools protocol. `ready()` says why a check can't run here (no Chrome, or the UI isn't built);
// a check then exits 3, which scripts/test.sh and precheck read as skipped, not failed.
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, normalize } from "node:path";
import { spawn } from "node:child_process";

const dist = new URL("../ui/dist/", import.meta.url).pathname;
const chromePath = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((p) => p && existsSync(p));
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Why this machine can't run a page check, or "" when it can. */
export function ready() {
  if (!chromePath) return "no Chrome (set CHROME)";
  if (!existsSync(join(dist, "index.html"))) return "no ui/dist (build the UI first)";
  return "";
}

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".woff2": "font/woff2" };
const frame = (text) => {
  const body = Buffer.from(text), n = body.length;
  const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x81, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
  return Buffer.concat([head, body]);
};

/** Text frames out of what a page sent (a browser masks every frame); returns them and the bytes left over. */
function unframe(buffer) {
  const texts = [];
  let at = 0;
  for (;;) {
    if (buffer.length - at < 2) break;
    const opcode = buffer[at] & 15, masked = buffer[at + 1] & 128;
    let n = buffer[at + 1] & 127, head = 2;
    if (n === 126) { if (buffer.length - at < 4) break; n = buffer.readUInt16BE(at + 2); head = 4; }
    else if (n === 127) { if (buffer.length - at < 10) break; n = Number(buffer.readBigUInt64BE(at + 2)); head = 10; }
    const mask = masked ? buffer.subarray(at + head, at + head + 4) : null;
    head += masked ? 4 : 0;
    if (buffer.length - at < head + n) break;
    const body = Buffer.from(buffer.subarray(at + head, at + head + n));
    if (mask) for (let i = 0; i < n; i++) body[i] ^= mask[i % 4];
    if (opcode === 1) texts.push(body.toString("utf8"));
    at += head + n;
  }
  return { texts, rest: buffer.subarray(at) };
}

/** A stand-in core: the built UI over HTTP, alone on this laptop, and /ws. Each window that connects gets
 *  `joinReply(query)`'s messages (the core's catch-up: the world, and whatever else a check puts first; `query` is the
 *  connection's URLSearchParams), or is refused when it returns null; `heard` collects what windows sent, parsed.
 *  `door`: what /room says (alone on a laptop unless a check opens a room, or runs as the hosted site). A check that
 *  answers as the core would hears each message with the window's query (`onMessage`) and each window closing
 *  (`onClose`). */
export async function standInCore(joinReply, { door = { room: false, member: true }, onMessage = null, onClose = null, port = 0 } = {}) {
  const sockets = new Set();
  const heard = [];
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    const file = join(dist, path === "/" ? "index.html" : path);
    if (path === "/room") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(door)); return; }
    if (!file.startsWith(dist) || !existsSync(file) || file.endsWith("/")) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  server.on("upgrade", (req, socket) => {
    const messages = req.url.startsWith("/ws") ? joinReply(new URL(req.url, "http://x").searchParams) : null;
    // A core that's away: the window's try fails, and it tries again later.
    if (!messages) { socket.destroy(); return; }
    const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const query = new URL(req.url, "http://x").searchParams;
    socket.on("error", () => {});
    socket.on("close", () => { sockets.delete(socket); onClose?.(query); });
    // The server keeps a socket half-open after the window's side ends; ending this side too makes it close.
    socket.on("end", () => socket.end());
    let pending = Buffer.alloc(0);
    socket.on("data", (data) => {
      const { texts, rest } = unframe(Buffer.concat([pending, data]));
      pending = Buffer.from(rest);
      for (const text of texts) {
        let message;
        try { message = JSON.parse(text); } catch { continue; /* not a message */ }
        heard.push(message);
        onMessage?.(message, query);
      }
    });
    sockets.add(socket);
    for (const message of messages) socket.write(frame(JSON.stringify(message)));
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    heard,
    connected: () => sockets.size,
    send: (message) => { for (const s of sockets) s.write(frame(JSON.stringify(message))); },
    /** Every window's connection ends at once, as a core that went away. */
    drop: () => { for (const s of sockets) s.destroy(); sockets.clear(); },
    close: () => { for (const s of sockets) s.destroy(); server.close(); },
  };
}

// A Chrome outlives the check that started it unless something ends it. A check's `finally` does, but `process.exit()`
// skips a `finally`, and so does a signal (a timeout's SIGTERM): each such run left a headless Chrome and its profile
// behind (the one-brick run of bricks-check did, 14 in a day). So every Chrome started here is also ended when the
// process ends, however it ends: the 'exit' event runs for process.exit(), an uncaught error and a normal end, and a
// signal is turned into an exit.
const running = new Map(); // each Chrome that hasn't exited yet, with its throwaway profile
let watching = false;
function endWhatIsLeft() {
  for (const [chrome, profile] of running) {
    try { chrome.kill("SIGKILL"); } catch { /* already gone */ }
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* the OS clears its temp folder */ }
  }
  running.clear();
}
function watchExit() {
  if (watching) return;
  watching = true;
  process.on("exit", endWhatIsLeft);
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) process.on(signal, () => process.exit(code));
}

/** Headless Chrome with one page at `url`, `width` × `height`, light, the app's own motion. */
export async function openPage(url, { width = 1440, height = 900, debugPort = 0 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "page-check-"));
  const chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "--no-first-run",
    "--no-default-browser-check", "--mute-audio", "--hide-scrollbars", `--window-size=${width},${height}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  running.set(chrome, profile);
  chrome.once("exit", () => running.delete(chrome));
  watchExit();
  const close = async () => {
    const exited = new Promise((resolve) => (chrome.exitCode !== null ? resolve() : chrome.once("exit", resolve)));
    chrome.kill();
    await Promise.race([exited, sleep(3000)]);
    // Let go of Chrome. Its crash handler can outlive it (12 s to over 2 minutes, with four checks running at once) and
    // holds the other end of Chrome's stderr pipe; a pipe someone else still holds keeps this process alive after the
    // check is done, and guide-check's old 4-minute detector then failed a finished check as "stuck" at its last step.
    // Nothing here reads Chrome's output once it is closed, so drop our end and the child; what is left is ended with
    // this process (endWhatIsLeft).
    chrome.stderr.destroy();
    chrome.unref();
    // The throwaway profile in the system's temp folder; Chrome may still be closing files in it.
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* the OS clears its temp folder */ }
  };
  try {
    const devtools = await new Promise((resolve, reject) => {
      let err = "";
      // Cleared once settled: a timer left running held this process 15 s after the last page closed.
      const timer = setTimeout(() => reject(new Error("Chrome did not start")), 15000);
      chrome.stderr.on("data", (d) => { err += d; const m = err.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(timer); resolve(m[1]); } });
      chrome.on("exit", () => { clearTimeout(timer); reject(new Error("Chrome exited")); });
    });
    const browser = new WebSocket(devtools);
    await new Promise((resolve, reject) => { browser.onopen = resolve; browser.onerror = reject; });
    let id = 0;
    const waiting = new Map();
    // What the page announces (`Page.screencastFrame`, …), for a check that wants it: `on(method, handler)`.
    const listening = new Map();
    let attached = null;
    browser.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
      else if (m.method && m.sessionId && m.sessionId === attached) listening.get(m.method)?.(m.params);
    };
    const cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const n = ++id;
      waiting.set(n, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      browser.send(JSON.stringify({ id: n, method, params, sessionId }));
    });
    const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true });
    attached = sessionId;
    const page = (method, params) => cdp(method, params, sessionId);
    const evaluate = async (expression) => {
      const r = await page("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    /** Waits up to `ms` for `expression` to be true in the page. */
    const until = async (expression, ms = 5000) => {
      for (let waited = 0; waited < ms; waited += 50) {
        if (await evaluate(expression).catch(() => false)) return true;
        await sleep(50);
      }
      return false;
    };
    await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }, { name: "prefers-color-scheme", value: "light" }] });
    await page("Page.navigate", { url });
    return { page, evaluate, until, on: (method, handler) => listening.set(method, handler), close: async () => { browser.close(); await close(); } };
  } catch (error) {
    await close();
    throw error;
  }
}
