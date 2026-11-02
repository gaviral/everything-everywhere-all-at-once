// No extra dependencies: run with `node scripts/points-check.mjs` (after the UI is built; precheck builds it first).
// Every point stays inside its card, in a real browser with the app's own motion (2026-11-02). In takes, a point that
// had just landed in a new branch was drawn ≈ 100 px under its card for 13–15 s after "Show" on a card above it:
// Point measured its box only when its thread's thoughts changed (layoutDependency), so when its card moved, Motion
// projected it from its old box and the card's move counted twice. This plays that moment on the built UI (ui/dist),
// served with a stand-in core (a snapshot, then the core's changes), in headless Chrome, and measures every point
// against its card while the cards move. Exit 3 (precheck's WARN) when this machine has no Chrome or ui/dist.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, normalize } from "node:path";
import { spawn } from "node:child_process";

const dist = new URL("../ui/dist/", import.meta.url).pathname;
const chromePath = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((p) => p && existsSync(p));
if (!chromePath || !existsSync(join(dist, "index.html"))) {
  console.log(`SKIP points-check: ${chromePath ? "no ui/dist (build the UI first)" : "no Chrome (set CHROME)"}`);
  process.exit(3);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- The map at the moment it went wrong: Rent above Stats in one column, Stats open (the active thread).
const now = Date.now();
const thread = (id, title, parent_id = null) => ({ id, title, parent_id, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "" });
const thought = (id, text, thread_id, placed = true) => ({ id, speaker: "you", text, point: placed ? text : "", thread_id, placed, unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: now, place_ms: placed ? 3000 : null, decided: false });
const world = {
  threads: [thread("T1", "Rent Due Friday"), thread("T2", "Garden Plans"), thread("T3", "Stats Midterm Thursday")],
  thoughts: [thought("a", "Rent is due Friday", "T1"), thought("b", "Plant the tomatoes this weekend", "T2"), thought("c", "Stats midterm is Thursday, chapters four to six", "T3")],
  active: "T3", active_by: { you: "T3" }, suggestions: [],
  actions: [{ id: "ac-1", thread_id: "T1", kind: "reminder", title: "Pay rent", when: "2026-11-06", status: "new", done_ms: null }],
  merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [],
};
// Then a thought arrives (its pending pill), lands in a new branch under Stats, and that branch becomes active.
const said = thought("d", "Study with Priya on Wednesday night", "T3", false);
const later = [
  [{ type: "thought_added", thought: said }, 1500],
  [{ type: "thread_added", thread: thread("T4", "Study With Priya", "T3") }, 0],
  [{ type: "thought_placed", thought_id: "d", thread_id: "T4", point: said.text, unclear: "", guess: "", heard: "", fixed: "", complete: true, place_ms: 3100 }, 0],
  [{ type: "thread_touched", thread_id: "T4", last_point: said.text, at_ms: now }, 0],
  [{ type: "active_changed", thread_id: "T4", speaker: "you" }, 1500],
];

// ---- A stand-in core: the built UI over HTTP, and /ws sending the snapshot and then the changes.
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".woff2": "font/woff2" };
const sockets = new Set();
const frame = (text) => {
  const body = Buffer.from(text), n = body.length;
  const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x81, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
  return Buffer.concat([head, body]);
};
const send = (msg) => { for (const s of sockets) s.write(frame(JSON.stringify(msg))); };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  const file = join(dist, path === "/" ? "index.html" : path);
  // Alone on this laptop, as the core answers when no room is open.
  if (path === "/room") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ room: false, member: true })); return; }
  if (!file.startsWith(dist) || !existsSync(file) || file.endsWith("/")) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});
server.on("upgrade", (req, socket) => {
  if (!req.url.startsWith("/ws")) { socket.destroy(); return; }
  const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.on("error", () => {});
  socket.on("close", () => sockets.delete(socket));
  socket.on("data", () => {}); // what the page says (hello, focus) needs no answer here
  sockets.add(socket);
  socket.write(frame(JSON.stringify({ type: "snapshot", world })));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

// ---- Headless Chrome over the DevTools protocol.
const profile = mkdtempSync(join(tmpdir(), "points-check-"));
const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run",
  "--no-default-browser-check", "--mute-audio", "--hide-scrollbars", "--window-size=1440,900", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
let failed = null;
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
  await page("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  // The app's own motion (a Mac with Reduce Motion on passes "reduce", and the app then animates no layout).
  await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }, { name: "prefers-color-scheme", value: "light" }] });
  await page("Page.navigate", { url: `http://127.0.0.1:${port}/` });
  for (let i = 0; i < 100 && !(await evaluate(`!!document.querySelector("#thread-T3 li[id^='point-']")`).catch(() => false)); i++) await sleep(100);
  await sleep(800);
  for (const [change, wait] of later) { send({ type: "change", change }); await sleep(wait || 60); }

  // Every point's box (as drawn, transforms included) against its own card's.
  const probe = `[...document.querySelectorAll("li[id^='point-']")].map((li) => {
    const card = li.closest("section.thread"), p = li.getBoundingClientRect(), c = card.getBoundingClientRect();
    return { point: li.id, card: card.id, out: Math.round(Math.max(0, c.top - p.top, p.bottom - c.bottom, c.left - p.left, p.right - c.right)) };
  })`;
  const top = (id) => evaluate(`document.getElementById("${id}").getBoundingClientRect().top`);
  const stray = (points) => points.filter((p) => p.out > 2);
  const before = await evaluate(probe);
  assert.ok(before.some((p) => p.point === "point-d" && p.card === "thread-T4"), `the new point is in its branch card: ${JSON.stringify(before)}`);
  assert.deepEqual(stray(before), [], "every point starts inside its card");

  // "Show" on Rent, above Stats: Stats and its branch move down. Then "Hide": they move back up.
  for (const [step, expect] of [["Show", 1], ["Hide", -1]]) {
    const from = await top("thread-T4");
    await evaluate(`document.querySelector("#thread-T1 > .thread-head > button.thread-toggle").click()`);
    // Springs settle well inside a second; a stray point stayed out for 13–15 s on camera.
    await sleep(1200);
    const moved = (await top("thread-T4")) - from;
    assert.ok(moved * expect > 30, `${step} on Rent moves the branch card (moved ${Math.round(moved)} px)`);
    const out = [];
    for (let i = 0; i < 8; i++) { out.push(...stray(await evaluate(probe))); await sleep(100); }
    const worst = new Map(out.map((p) => [p.point, p]));
    assert.deepEqual([...worst.values()], [], `after ${step} on the card above, every point stays inside its card (px outside)`);
  }
  browser.close();
} catch (error) {
  failed = error;
} finally {
  const exited = new Promise((resolve) => (chrome.exitCode !== null ? resolve() : chrome.once("exit", resolve)));
  chrome.kill();
  await Promise.race([exited, sleep(3000)]);
  server.close();
  for (const s of sockets) s.destroy();
  // The throwaway profile in the system's temp folder; Chrome may still be closing files in it.
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* the OS clears its temp folder */ }
}
if (failed) { console.error(failed.message); process.exit(1); }
console.log("points-check: every point stays inside its card while the cards around it move");
