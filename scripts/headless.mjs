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
 *  connection's URLSearchParams), or is refused when it returns null; `heard` collects what windows sent, parsed. */
export async function standInCore(joinReply) {
  const sockets = new Set();
  const heard = [];
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    const file = join(dist, path === "/" ? "index.html" : path);
    if (path === "/room") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ room: false, member: true })); return; }
    if (!file.startsWith(dist) || !existsSync(file) || file.endsWith("/")) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  server.on("upgrade", (req, socket) => {
    const messages = req.url.startsWith("/ws") ? joinReply(new URL(req.url, "http://x").searchParams) : null;
    // A core that's away: the window's try fails, and it tries again later.
    if (!messages) { socket.destroy(); return; }
    const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    let pending = Buffer.alloc(0);
    socket.on("data", (data) => {
      const { texts, rest } = unframe(Buffer.concat([pending, data]));
      pending = Buffer.from(rest);
      for (const text of texts) { try { heard.push(JSON.parse(text)); } catch { /* not a message */ } }
    });
    sockets.add(socket);
    for (const message of messages) socket.write(frame(JSON.stringify(message)));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
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

/** Headless Chrome with one page at `url`, `width` × `height`, light, the app's own motion. */
export async function openPage(url, { width = 1440, height = 900 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "page-check-"));
  const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run",
    "--no-default-browser-check", "--mute-audio", "--hide-scrollbars", `--window-size=${width},${height}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const close = async () => {
    const exited = new Promise((resolve) => (chrome.exitCode !== null ? resolve() : chrome.once("exit", resolve)));
    chrome.kill();
    await Promise.race([exited, sleep(3000)]);
    // The throwaway profile in the system's temp folder; Chrome may still be closing files in it.
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* the OS clears its temp folder */ }
  };
  try {
    const devtools = await new Promise((resolve, reject) => {
      let err = "";
      chrome.stderr.on("data", (d) => { err += d; const m = err.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
      chrome.on("exit", () => reject(new Error("Chrome exited")));
      setTimeout(() => reject(new Error("Chrome did not start")), 15000);
    });
    const browser = new WebSocket(devtools);
    await new Promise((resolve, reject) => { browser.onopen = resolve; browser.onerror = reject; });
    let id = 0;
    const waiting = new Map();
    browser.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
    const cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const n = ++id;
      waiting.set(n, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      browser.send(JSON.stringify({ id: n, method, params, sessionId }));
    });
    const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true });
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
    return { page, evaluate, until, close: async () => { browser.close(); await close(); } };
  } catch (error) {
    await close();
    throw error;
  }
}
