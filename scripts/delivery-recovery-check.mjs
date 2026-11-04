// Delivery recovery through the real useCore hook and a scripted transport. No external service.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const rust = spawnSync("cargo", ["test", "--quiet", "--manifest-path", "core/Cargo.toml", "delivery_", "--", "--test-threads=1"], {
  cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
});
if (rust.error) throw rust.error;
if (rust.status !== 0) { process.stderr.write(rust.stdout + rust.stderr); process.exit(rust.status ?? 1); }
assert.match(rust.stdout, /[1-9]\d* passed; 0 failed/, "delivery regression tests ran");
import { uiServer } from "./ui-server.mjs";
// Just enough of a browser for react-dom to mount a component that draws nothing (as in notice-check).
const noop = () => {};
const element = () => ({ nodeType: 1, tagName: "DIV", nodeName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml",
  style: {}, setAttribute: noop, getAttribute: () => null, addEventListener: noop, removeEventListener: noop,
  appendChild: noop, removeChild: noop, ownerDocument: globalThis.document });
globalThis.window = globalThis;
globalThis.document = { nodeType: 9, addEventListener: noop, removeEventListener: noop, createElement: element,
  body: { style: {} }, activeElement: null, getSelection: () => null, querySelector: () => null, getElementById: () => null, defaultView: globalThis };
globalThis.document.documentElement = element();
globalThis.HTMLIFrameElement = class {};
globalThis.dispatchEvent = () => true;
globalThis.addEventListener ??= noop;
globalThis.removeEventListener ??= noop;
const saved = new Map();
globalThis.localStorage = { get length() { return saved.size; }, key: (i) => [...saved.keys()][i] ?? null, getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key) };
Object.defineProperty(globalThis, "location", { value: { protocol: "http:", host: "check", hostname: "localhost", search: "", pathname: "/" }, configurable: true });

let activeMap = "A", acknowledge = false;
const sockets = [], accepted = new Map();
globalThis.WebSocket = class {
  static OPEN = 1; readyState = 1; sent = []; map = activeMap;
  constructor() { sockets.push(this); queueMicrotask(() => { this.onopen?.(); if (this.map) this.tell({ type: "map_identity", id: this.map }); }); }
  tell(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
  send(data) {
    this.sent.push(data);
    const m = JSON.parse(data);
    if (m.type === "identify" && this.map) queueMicrotask(() => this.tell({ type: "map_identity", id: this.map }));
    if (m.type === "heartbeat" && !this.silent) queueMicrotask(() => this.tell(m));
    if (m.type === "text") {
      const key = `${this.map}:${m.id}`;
      if (!accepted.has(key)) accepted.set(key, m.text);
      if (acknowledge) queueMicrotask(() => this.tell({ type: "text_received", id: m.id }));
    }
  }
  close() { if (this.readyState === 1) { this.readyState = 3; this.onclose?.(); } }
  addEventListener() {} removeEventListener() {}
};
const ui = new URL("../ui/", import.meta.url);
const React = (await import(new URL("node_modules/react/index.js", ui))).default;
const { createRoot } = (await import(new URL("node_modules/react-dom/client.js", ui))).default;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (done, what, limit = 5000) => {
  for (let i = 0; i < limit / 10 && !done(); i++) await sleep(10);
  assert.ok(done(), what);
};
const server = await uiServer();
const roots = [];
try {
  const { useCore } = await server.ssrLoadModule("/src/core.ts");
  const waiting = await server.ssrLoadModule("/src/waiting.ts");
  const isolated = JSON.stringify({ type: "text", id: waiting.thoughtId(), text: "Another dotted speaker" });
  const dotted = waiting.waitingKey("scope.other", "A");
  waiting.saveWaiting(dotted, [isolated]);
  assert.deepEqual(waiting.quarantined("scope", "A"), [], "dotted speaker names cannot overlap recovery scopes");
  assert.equal(waiting.readWaiting(waiting.waitingKey("scope.other", "A.other")).length, 0, "dotted map names cannot overlap queues");
  waiting.receivedWaiting(dotted, JSON.parse(isolated).id);
  let core;
  const root = createRoot(element()); roots.push(root);
  root.render(React.createElement(function Window() { core = useCore("you"); return null; }));
  await until(() => core?.deliveryMapId === "A", "map A identified");
  assert.equal(core.sendText("Only map A may receive these words"), true);
  await until(() => core.queuedCount === 1, "unreceipted words remain saved");
  activeMap = "B"; sockets.at(-1).close();
  await until(() => core.deliveryMapId === "B", "same origin changed to map B");
  assert.equal([...accepted.keys()].filter(key => key.startsWith("B:")).length, 0, "zero A text enters B");
  assert.ok(core.recovery.entries.some(e => e.text.startsWith("Only map A")), "other-map words are quarantined");
  acknowledge = true; activeMap = "A"; sockets.at(-1).close();
  await until(() => core.deliveryMapId === "A" && core.queuedCount === 0, "same-map restart retries until receipt");
  assert.equal(accepted.size, 1, "same id accepted once after restart");
  const legacy = JSON.stringify({ type: "text", id: waiting.thoughtId(), text: "Old unscoped words" });
  waiting.saveWaiting("e2a2o.waiting.you", [legacy]);
  sockets.at(-1).close();
  await until(() => core.recovery.entries.some(e => e.text === "Old unscoped words"), "legacy recovery is offered");
  assert.equal([...accepted.values()].includes("Old unscoped words"), false, "legacy text is never automatically replayed");
  assert.equal(core.recover(core.recovery.entries.find(e => e.text === "Old unscoped words").id), true);
  await until(() => [...accepted.values()].includes("Old unscoped words"), "explicit legacy recovery sends");
  let second;
  const other = createRoot(element()); roots.push(other);
  other.render(React.createElement(function Window() { second = useCore("you"); return null; }));
  await until(() => second?.deliveryMapId === "A", "second tab identifies the same map");
  assert.equal(second.sendText("Second tab words"), true);
  await until(() => second.queuedCount === 0, "second tab receipt");
  activeMap = null; sockets.at(-1).close();
  await until(() => sockets.at(-1).map === null, "connection with missing identity");
  assert.equal(second.sendText("Do not send without identity"), false);
  assert.equal([...accepted.values()].includes("Do not send without identity"), false);
  const first = sockets.find(socket => socket.map === "A" && socket.readyState === 1);
  first.tell({ type: "recoverable_speech", id: "speech-recovery", text: "Unfinished words" });
  await until(() => core.recovery.entries.some(entry => entry.id === "speech-recovery"), "unfinished words offered");
  assert.equal(core.recover("speech-recovery"), true);
  assert.deepEqual(JSON.parse(first.sent.at(-1)), { type: "recover_speech", id: "speech-recovery", keep: true });
  first.tell({ type: "recoverable_speech", id: "speech-recovery", text: "" });
  await until(() => !core.recovery.entries.some(entry => entry.id === "speech-recovery"), "late final retires the draft");
  activeMap = "A";
  acknowledge = false;
  assert.equal(core.sendText("Retain this across a silent socket"), true);
  const retained = JSON.parse(first.sent.findLast(data => JSON.parse(data).type === "text"));
  const stalledAt = Date.now();
  first.silent = true;
  acknowledge = true;
  await until(() => sockets.some(socket => socket !== first && socket.map === "A" && socket.sent.some(data => JSON.parse(data).id === retained.id)),
    "silent open socket reconnects and replays the same ID", 18000);
  assert.ok(Date.now() - stalledAt <= 17000, "15 s deadline plus reconnect backoff and scheduling allowance");
  await until(() => core.queuedCount === 0, "receipt after silent-socket recovery");
  assert.equal([...accepted.values()].filter(text => text === retained.text).length, 1, "silent reconnect accepts once");
  console.log(`silent socket recovered in ${Date.now() - stalledAt} ms (15 s deadline, 1 s initial backoff)`);
  const store = localStorage.setItem;
  localStorage.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); };
  let draft = "Only send these words with explicit approval", cleared = 0;
  acknowledge = false;
  assert.equal(core.sendText(draft), false, "failed storage keeps the composer draft");
  await until(() => core.recovery.storageUnavailable, "storage failure offers explicit online send");
  assert.equal([...accepted.values()].includes(draft), false, "failed storage never sends automatically");
  const exact = draft;
  const clearExact = () => { if (draft === exact) { draft = ""; cleared++; } };
  assert.equal(core.sendOnline(exact, clearExact), true);
  await until(() => core.recovery.onlinePending, "waiting for a receipt");
  assert.equal(draft, exact, "sending bytes does not clear the draft");
  const sending = sockets.findLast(socket => socket.map === "A" && socket.readyState === 1);
  const originalIds = sending.sent.map(JSON.parse).filter(m => m.text === exact).map(m => m.id);
  assert.equal(originalIds.length, 1);
  sending.close();
  sending.tell({ type: "map_identity", id: "late-old-map" });
  sending.tell({ type: "text_received", id: originalIds[0] });
  await sleep(10);
  assert.equal(draft, exact, "a retired connection cannot clear the draft");
  assert.equal(core.deliveryMapId, "A", "a retired connection cannot replace map identity");
  await until(() => core.connected && sockets.at(-1) !== sending && core.recovery.onlineAvailable, "online send reconnects");
  const reconnected = sockets.at(-1);
  assert.ok(!reconnected.sent.map(JSON.parse).some(m => m.text === exact), "volatile text is never replayed without another explicit action");
  acknowledge = true;
  assert.equal(core.sendOnline(exact, clearExact), true);
  await until(() => draft === "", "only receipt clears the exact draft");
  assert.equal(cleared, 1);
  assert.deepEqual(reconnected.sent.map(JSON.parse).filter(m => m.text === exact).map(m => m.id), originalIds, "explicit retry keeps its source ID");
  assert.equal([...accepted.values()].filter(text => text === exact).length, 1, "online retry is accepted once");
  acknowledge = false;
  draft = "A draft sent before editing";
  assert.equal(core.sendOnline(draft, () => { if (draft === "A draft sent before editing") draft = ""; }), true);
  await until(() => core.recovery.onlinePending, "second explicit send pending");
  const id = reconnected.sent.map(JSON.parse).findLast(m => m.type === "text").id;
  draft = "New words typed while waiting";
  reconnected.tell({ type: "text_received", id });
  await until(() => !core.recovery.onlinePending, "receipt for earlier draft");
  assert.equal(draft, "New words typed while waiting", "an earlier receipt cannot clear a changed draft");
  localStorage.setItem = store;
  console.log("delivery-recovery-check: identity isolation, restart, two tabs, legacy recovery, interrupted speech, crash receipts, heartbeat and explicit online send pass");
} finally {
  for (const root of roots) root.unmount();
  await server.close();
}
