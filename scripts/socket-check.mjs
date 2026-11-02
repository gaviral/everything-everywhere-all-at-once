// No extra dependencies: run with `node scripts/socket-check.mjs`.
// The window's side of the connection (useCore in ui/src/core.ts, mounted with a stand-in socket as notice-check
// mounts it): the live words and their hand-off to the thought they become, where a pending thought stands, the key's
// state, and what a dropped connection keeps: thoughts typed meanwhile go out on reconnecting, in order ("nothing
// gets lost"), and what was waiting on the old connection (a search, a "why here?") stops waiting.
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
Object.defineProperty(globalThis, "location", { value: { protocol: "http:", host: "check", hostname: "localhost", search: "", pathname: "/" }, configurable: true });
const sockets = [];
globalThis.WebSocket = class { static OPEN = 1; readyState = 1; sent = [];
  constructor() { sockets.push(this); queueMicrotask(() => this.onopen?.()); }
  send(data) { if (this.readyState !== 1) throw new Error("sent on a closed socket"); this.sent.push(data); }
  close() {} addEventListener() {} removeEventListener() {} };
const ui = new URL("../ui/", import.meta.url);
const React = (await import(new URL("node_modules/react/index.js", ui))).default;
const { createRoot } = (await import(new URL("node_modules/react-dom/client.js", ui))).default;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Waits for what a message should lead to, up to 3 s: React renders when the machine gets to it, and a fixed 20 ms
// wait failed about 1 run in 16 on a machine busy with builds (notice-check, 2026-11-02).
const until = async (done, what) => {
  for (let waited = 0; !done() && waited < 3000; waited += 10) await sleep(10);
  assert.ok(done(), `still waiting for ${what}`);
};

const server = await uiServer();
try {
  const { useCore, LOOKING } = await server.ssrLoadModule("/src/core.ts");
  let core;
  const root = createRoot(element());
  root.render(React.createElement(function Window() { core = useCore("me"); return null; }));
  await until(() => core?.connected, "the first connection");
  const say = (message) => sockets.at(-1).onmessage({ data: JSON.stringify(message) });
  const world = { recaps: [], threads: [{ id: "T1", title: "Rent", parent_id: null, status: "open", last_point: "", touched_ms: 1, tags: [], picture: null, dropped_by: "" }],
    thoughts: [], active: "T1", active_by: { me: "T1" }, suggestions: [], actions: [], merged: {}, proposals: [], apps: [], apps_seeded: true };
  say({ type: "snapshot", world });
  await until(() => core.snapshotRevision === 1, "the map");

  // The live line: words as they're heard; at the turn's end they stay up (the hand-off) until the thought they
  // became arrives, so the dock never blanks between the words and the thought on its way.
  say({ type: "partial", text: "rent is due friday" });
  await until(() => core.partial === "rent is due friday", "the live words");
  assert.equal(core.handoff, "");
  say({ type: "partial", text: "" });
  await until(() => core.partial === "", "the turn's end");
  assert.equal(core.handoff, "rent is due friday", "the turn ended: its words stay");
  const thought = (id, speaker) => ({ id, speaker, text: "Rent is due Friday", point: "", thread_id: "T1", placed: false, unclear: "",
    complete: true, at_ms: Date.now(), place_ms: null });
  say({ type: "change", change: { type: "thought_added", thought: thought("t0", "Sam") } });
  await until(() => core.world.thoughts.length === 1, "Sam's thought");
  assert.equal(core.handoff, "rent is due friday", "someone else's thought isn't yours");
  say({ type: "change", change: { type: "thought_added", thought: thought("t1", "me") } });
  await until(() => core.world.thoughts.length === 2, "your thought");
  assert.equal(core.handoff, "", "yours arrived: the pill takes over");
  // No thought came of it (filler set aside): the words go after 1.5 s.
  say({ type: "partial", text: "um so yeah" });
  say({ type: "partial", text: "" });
  await until(() => core.handoff === "um so yeah", "the hand-off");
  const ended = Date.now();
  await until(() => core.handoff === "", "the hand-off to end");
  assert.ok(Date.now() - ended >= 1400, "after its moment, not at once");

  // Where pending thoughts stand: the one being placed, and each retry by this window's clock.
  const before = Date.now();
  say({ type: "placing", now: "t1", retries: [{ thought_id: "t9", in_ms: 30_000 }] });
  await until(() => core.placing.now === "t1", "placing");
  assert.ok(core.placing.retryAt.t9 >= before + 30_000 && core.placing.retryAt.t9 <= Date.now() + 30_000);

  // The key: missing, then refused; the next snapshot takes back a word about it until the core repeats it.
  say({ type: "notice", message: "MODEL_API_KEY is not set: listening and placement are off." });
  await until(() => core.noKey, "no key");
  assert.equal(core.keyRefused, false);
  say({ type: "notice", message: "The AI key was refused. Check MODEL_API_KEY in .env, then restart." });
  await until(() => core.keyRefused, "a refused key");
  say({ type: "snapshot", world });
  await until(() => core.snapshotRevision === 2, "the next map");
  assert.deepEqual([core.noKey, core.notice], [false, ""], "a fresh map: the key's word is the core's to say again");

  // A search shows "Looking…" until its answer; the answer moves the map there.
  say({ type: "notice", message: LOOKING });
  say({ type: "found", thread_id: "T1", thought_id: null, message: "Here: Rent" });
  await until(() => core.found?.thread_id === "T1", "the search's answer");
  assert.equal(core.notice, "Here: Rent");

  // Typed "recap": the sheet opens here and asks the core for one; it isn't sent as a thought.
  const old = sockets.at(-1);
  old.sent.length = 0;
  assert.equal(core.sendText("recap"), true);
  await until(() => core.recap.view, "the recap sheet");
  assert.equal(core.recap.view.period, "today");
  assert.deepEqual(old.sent.map((m) => JSON.parse(m).type), ["recap"]);

  // The connection drops: what waited on it stops waiting, and the window tries again.
  say({ type: "notice", message: LOOKING });
  core.askWhy("t1");
  await until(() => core.whys.t1?.pending && core.notice === LOOKING, "a search and a why");
  old.readyState = 3;
  old.onclose();
  await until(() => !core.connected, "the drop");
  assert.deepEqual([core.listening, core.notice, core.whys.t1], [false, "", undefined], "nothing left waiting");
  // Typed meanwhile: kept, counted where the dock shows it, never lost.
  assert.equal(core.sendText("Oh, and the electric bill"), true);
  assert.equal(core.sendText("Autopay before the 10th"), true);
  await until(() => core.queuedCount === 2, "two waiting");
  // Reconnected (the first retry is a second later): sent first, in the order typed.
  await until(() => sockets.at(-1) !== old && core.connected, "the next connection");
  assert.deepEqual(sockets.at(-1).sent.slice(0, 2).map((m) => JSON.parse(m).text), ["Oh, and the electric bill", "Autopay before the 10th"]);
  await until(() => core.queuedCount === 0, "nothing waiting");
  // Past 50 waiting, the window says so instead of keeping more.
  const again = sockets.at(-1);
  again.readyState = 3;
  again.onclose();
  await until(() => !core.connected, "the second drop");
  for (let i = 0; i < 50; i++) core.sendText(`thought ${i}`);
  assert.equal(core.sendText("one too many"), false);
  await until(() => core.notice.startsWith("Too many thoughts are waiting to send"), "the full queue's notice");
  root.unmount();
  console.log("socket-check: ok (live words and hand-off, placing, the key, a search's answer, typed recap, a dropped connection, the offline queue)");
} finally {
  await server.close();
}
