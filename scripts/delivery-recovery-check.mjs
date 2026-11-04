// Delivery recovery through the real useCore hook and a scripted transport. No external service.
import assert from "node:assert/strict";
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
const until = async (done, what) => {
  for (let i = 0; i < 500 && !done(); i++) await sleep(10);
  assert.ok(done(), what);
};
const server = await uiServer();
const roots = [];
try {
  const { useCore } = await server.ssrLoadModule("/src/core.ts");
  const waiting = await server.ssrLoadModule("/src/waiting.ts");
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
  console.log("delivery-recovery-check: identity isolation, restart, two tabs and explicit legacy recovery pass");
} finally {
  for (const root of roots) root.unmount();
  await server.close();
}
