// No extra dependencies: run with `node scripts/notice-check.mjs`.
// Which notices stay until dismissed and how long the rest are up (ui/src/notice-rules.ts); and, on the real useCore
// hook (ui/src/core.ts) fed by a stand-in socket, that a notice the window makes drops an older Undo, that the same
// words said again count as a new answer, and that the window's answer to a view request stands down when the core
// has answered since.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "../ui/node_modules/vite/dist/node/index.js";

// Just enough of a browser for react-dom to mount a component that draws nothing, set before react-dom loads.
const noop = () => {};
const element = () => ({ nodeType: 1, tagName: "DIV", nodeName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml",
  style: {}, setAttribute: noop, getAttribute: () => null, addEventListener: noop, removeEventListener: noop,
  appendChild: noop, removeChild: noop, ownerDocument: globalThis.document });
globalThis.window = globalThis;
globalThis.document = { nodeType: 9, addEventListener: noop, removeEventListener: noop, createElement: element,
  body: { style: {} }, activeElement: null, getSelection: () => null, querySelector: () => null, defaultView: globalThis };
globalThis.document.documentElement = element();
globalThis.HTMLIFrameElement = class {};
globalThis.dispatchEvent = () => true;
globalThis.addEventListener ??= noop;
globalThis.removeEventListener ??= noop;
Object.defineProperty(globalThis, "location", { value: { protocol: "http:", host: "check", search: "", pathname: "/" }, configurable: true });
const sockets = [];
globalThis.WebSocket = class { static OPEN = 1; readyState = 1;
  constructor() { sockets.push(this); queueMicrotask(() => this.onopen?.()); }
  send() {} close() {} addEventListener() {} removeEventListener() {} };
const ui = new URL("../ui/", import.meta.url);
const React = (await import(new URL("node_modules/react/index.js", ui))).default;
const { createRoot } = (await import(new URL("node_modules/react-dom/client.js", ui))).default;
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const server = await createServer({ root: new URL("../ui", import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
try {
  const { staysUp, upFor, SHORTEST_MS } = await server.ssrLoadModule("/src/notice-rules.ts");
  const { readMs } = await server.ssrLoadModule("/src/attention-core.ts");

  // Each of these asks for something only the person can do, or says the core is gone: up until dismissed.
  for (const notice of [
    "The mic stopped. Tap it to keep talking.",
    "Microphone access is off. Allow it in your browser settings, or type below.",
    "Couldn't start the mic. Try again. You can type below.",
    "Connection lost. Reconnect to use the microphone; you can still type below.",
    "The AI key was refused. Check MODEL_API_KEY in .env, then restart.",
  ]) assert.ok(staysUp(notice), notice);

  // Answers go after their reading time. A missing key is said by the header, the composer and the tour: kept up, the
  // notice covered the Apps bar and the tour's last step on a keyless first run. "Already off" asks nothing.
  for (const notice of [
    "MODEL_API_KEY is not set: listening and placement are off.",
    "The mic is already off.",
    "Back to Rent is due",
    "Kept as a thought: it didn't read as a request",
  ]) assert.ok(!staysUp(notice), notice);

  // Up for at least as long as before, longer when the words take longer to read.
  assert.equal(upFor("Back to Rent"), SHORTEST_MS);
  const keyless = "No AI key: you can browse the map, but new thoughts and listening need MODEL_API_KEY in .env (see .env.example).";
  assert.equal(upFor(keyless), Math.max(SHORTEST_MS, readMs(keyless)));
  const long = "Did “Expand the garden” instead. Your earlier words are off the map, and the journal keeps them if you want them back later.";
  assert.equal(upFor(long), readMs(long));
  assert.ok(upFor(long) > SHORTEST_MS);

  // "Visa was refused" is a thread's title, not the key: "Back to Visa was refused" goes like any answer (review).
  assert.ok(!staysUp("Back to Visa was refused"));

  // The real hook, with App.tsx's answer to "stop listening" while the mic is off.
  const { useCore } = await server.ssrLoadModule("/src/core.ts");
  let core;
  function Window() {
    core = useCore("me");
    React.useEffect(() => {
      if (core.viewAsk?.view === "pause") core.showNotice("The mic is already off.", core.viewAsk);
    }, [core.viewAsk]);
    return null;
  }
  const root = createRoot(element());
  root.render(React.createElement(Window));
  // The hook opens its socket in an effect; on a busy machine that can take longer than one settle.
  for (let waited = 0; !sockets.length && waited < 5000; waited += 20) await settle();
  assert.ok(sockets.length, "useCore opened no socket within 5 s");
  await settle();
  const say = (message) => sockets.at(-1).onmessage({ data: JSON.stringify(message) });

  // A notice made in the window is a newer answer: it clears the Undo an earlier one offered.
  say({ type: "notice", message: "Expanded everything." });
  say({ type: "undoable", id: 1 });
  await settle();
  assert.equal(core.undoId, 1);
  core.showNotice("Sound isn't available in this browser right now.");
  await settle();
  assert.equal(core.undoId, null);

  // The same words again are a new answer: App.tsx restarts its reading time on answerRevision (review).
  const before = core.answerRevision;
  say({ type: "view", view: "pause" });
  await settle();
  assert.equal(core.notice, "The mic is already off.");
  say({ type: "view", view: "pause" });
  await settle();
  assert.equal(core.notice, "The mic is already off.");
  assert.equal(core.answerRevision, before + 2);
  const app = readFileSync(new URL("src/App.tsx", ui), "utf8");
  assert.match(app, /window\.setTimeout\(core\.clearNotice[^]*?\}, \[core\.notice, core\.answerRevision,/);

  // "No, I meant stop listening": the core sends the view, then "Did … instead" with its Undo. Arriving in one render,
  // the correction's answer and Undo stay; the window's "already off" stands down (review).
  say({ type: "view", view: "pause" });
  say({ type: "notice", message: "Did “stop listening” instead. Your earlier words are off the map." });
  say({ type: "undoable", id: 7 });
  await settle();
  assert.equal(core.notice, "Did “stop listening” instead. Your earlier words are off the map.");
  assert.equal(core.undoId, 7);
  // Rendered one at a time, the window answers first and the correction replaces it, with its Undo.
  say({ type: "view", view: "pause" });
  await settle();
  assert.equal(core.notice, "The mic is already off.");
  say({ type: "notice", message: "Did “stop listening” instead." });
  say({ type: "undoable", id: 8 });
  await settle();
  assert.equal(core.notice, "Did “stop listening” instead.");
  assert.equal(core.undoId, 8);
  root.unmount();

  // Every answer the window makes for a view request passes the request, so each can stand down the same way.
  const viewAnswers = app.match(/core\.showNotice\([^;]*core\.viewAsk\)/g) ?? [];
  assert.equal(viewAnswers.length, 7, "pause (2), finish (2), later, forget, nothing to set aside");
  console.log("notice-check: ok");
} finally {
  await server.close();
}
