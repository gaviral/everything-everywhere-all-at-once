// No extra dependencies: run with `node scripts/notice-check.mjs`.
// Which notices stay until dismissed and how long the rest are up (ui/src/notice-rules.ts); and, on the real useCore
// hook (ui/src/core.ts) fed by a stand-in socket, that a notice the window makes drops an older Undo, that the same
// words said again count as a new answer, and that the window's answer to a view request stands down when the core
// has answered since.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { uiServer } from "./ui-server.mjs";

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
globalThis.WebSocket = class { static OPEN = 1; readyState = 1; sent = [];
  constructor() { sockets.push(this); queueMicrotask(() => this.onopen?.()); }
  send(data) { this.sent.push(data); } close() {} addEventListener() {} removeEventListener() {} };
const ui = new URL("../ui/", import.meta.url);
const React = (await import(new URL("node_modules/react/index.js", ui))).default;
const { createRoot } = (await import(new URL("node_modules/react-dom/client.js", ui))).default;
const app0 = () => readFileSync(new URL("src/App.tsx", ui), "utf8");
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const server = await uiServer();
try {
  const { staysUp, upFor, SHORTEST_MS, micStopped, undoUpFor, slowReadMs, DECIDE_MS, REACH_MS } = await server.ssrLoadModule("/src/notice-rules.ts");
  const { readMs } = await server.ssrLoadModule("/src/attention-core.ts");

  // Each of these asks for something only the person can do, or says the core is gone: up until dismissed.
  for (const notice of [
    "The mic stopped. Tap it to keep talking.",
    "Couldn't start the mic. Tap it to try again, or type below.",
    "The browser is blocking the microphone for this site. Allow it from the icon beside the address, then tap the mic. You can type meanwhile.",
    "Safari is blocking the microphone for this site. Allow it in Safari › Settings for This Website, then tap the mic. You can type meanwhile.",
    "Safari is blocking the microphone for this site. Allow it in Website Settings, from the page menu in the address bar, then tap the mic. You can type meanwhile.",
    "Your Mac is blocking the microphone for this browser. Turn it on in System Settings › Privacy & Security › Microphone, then reopen the browser.",
    "Windows is blocking the microphone for this browser. Turn it on in Settings › Privacy & security › Microphone, then reopen the browser.",
    "No microphone found. Connect one, then tap the mic, or type below.",
    "The microphone is busy in another app or didn't start. Close that app, then tap the mic, or type below.",
    "The microphone wasn't allowed. Tap the mic and choose Allow, or type below.",
    "Live audio needs a secure page (https). Open the link that starts with https.",
    "Connection lost. Reconnect to use the microphone; you can still type below.",
    "The AI key was refused. Check MODEL_API_KEY in .env, then restart.",
  ]) assert.ok(staysUp(notice), notice);

  // Answers go after their reading time. A missing key is said by the header, the composer and the tour: kept up, the
  // notice covered the Apps bar and the tour's last step on a keyless first run. "Already off" asks nothing.
  for (const notice of [
    "MODEL_API_KEY is not set: listening and placement are off.",
    "The mic is already off.",
    "Microphone allowed. Tap to talk.",
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

  // The mic stopping on its own says why, when the core said, and stays up until the mic is tapped (bug hunt 26:
  // every reason became the same "The mic stopped").
  const quiet = micStopped("Speech service error: Voice Transcribe stopped answering");
  assert.equal(quiet, "The mic stopped: the voice service stopped answering. Check the connection, then tap the mic.");
  assert.equal(micStopped("Speech service error: IO error: Connection reset by peer (os error 54)"), quiet);
  const busy = micStopped("Voice Transcribe: Too many requests");
  assert.equal(busy, "The mic stopped: the voice service said “Too many requests”. Tap it to try again, or type below.");
  assert.equal(micStopped(""), "The mic stopped. Tap it to keep talking.");
  for (const notice of [quiet, busy]) assert.ok(staysUp(notice), notice);

  // A notice with Undo stays until a slow reader could notice it, read it and its button, check the map, decide and
  // reach for the button (persona run 2026-11-01, friction 4: Undo was gone in 5 s, reached at ≈ 8 s).
  for (const notice of ["Moved to Health", "Removed “Buy more stakes for the beans”", long]) {
    assert.equal(undoUpFor(notice), Math.max(upFor(notice), slowReadMs(`${notice} Undo ⌘Z`) + slowReadMs(notice) + DECIDE_MS + REACH_MS), notice);
    assert.ok(undoUpFor(notice) > upFor(notice), `acting on “${notice}” takes longer than reading it`);
  }
  assert.ok(slowReadMs("Moved to Health") > readMs("Moved to Health"), "a deadline is set for the slow reader, not the mean");

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

  // A stream's "listening" is counted, so a window that starts its mic again can tell the old stream's late "not
  // listening" (before the new one's "listening") from its own stream ending (bug hunt 13).
  const listened = core.listenedRevision;
  say({ type: "status", listening: false, note: "Stopped listening" });
  await settle();
  assert.equal(core.listenedRevision, listened);
  say({ type: "status", listening: true, note: "Listening" });
  await settle();
  assert.equal(core.listenedRevision, listened + 1);
  const appSource = readFileSync(new URL("src/App.tsx", ui), "utf8");
  assert.match(appSource, /statusNew: core\.voiceStatusRevision > voiceStartedAt\.current, listenedNew: core\.listenedRevision > voiceListenedAt\.current/);
  assert.match(appSource, /voiceListenedAt\.current = voiceRevisions\.current\.listened;/);

  // Past the hosted site's daily limit the proxy follows the core's key notice with its own line: the window knows
  // the key is held back for the day, not missing, until the next connection's snapshot says otherwise.
  say({ type: "notice", message: "MODEL_API_KEY is not set: listening and placement are off." });
  await settle();
  assert.ok(core.noKey && !core.resting);
  say({ type: "notice", message: "Today's free tries are used up; back tomorrow. Your map is still here to read." });
  await settle();
  assert.ok(core.noKey && core.resting && !core.keyRefused);
  // Asking for an app then: the core has no key, so it says making one needs it. Still the day's limit, not a missing key.
  say({ type: "notice", message: "Making an app needs the AI key. Set MODEL_API_KEY in .env, then restart." });
  await settle();
  assert.ok(core.noKey && core.resting && !core.keyRefused, "an app's key notice keeps back tomorrow");
  say({ type: "snapshot", world: {} });
  await settle();
  assert.ok(!core.noKey && !core.resting, "a new snapshot: the core says again if it still holds");
  // The header's words, one place for both its dot and its text.
  const { statusLine } = await server.ssrLoadModule("/src/core.ts");
  const line = (extra) => statusLine({ connected: true, listening: false, noKey: false, refused: false, resting: false, paused: false, ...extra });
  assert.equal(line({}), "Ready");
  assert.equal(line({ noKey: true }), "No AI key");
  assert.equal(line({ noKey: true, refused: true }), "AI key refused");
  assert.match(line({ noKey: true, resting: true }), /^Free tries .*tomorrow/);
  assert.doesNotMatch(line({ noKey: true, resting: true }), /AI key/);
  assert.match(app0(), /statusLine\(\{/);

  // The words of a voice error stay readable for the window's "The mic stopped" notice.
  say({ type: "error", message: "Speech service error: Voice Transcribe stopped answering" });
  await settle();
  assert.equal(core.voiceError, "Speech service error: Voice Transcribe stopped answering");
  assert.equal(core.notice, "", "a voice error isn't shown raw");

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
  // A focused Undo that leaves the notice says no blur: the notice's focus is looked up again on every change, so
  // later notices still time out (bug hunt 19; wiring).
  assert.match(app, /useEffect\(\(\) => \{ setNoticeFocused\(!!core\.notice && !!noticeRef\.current\?\.contains\(document\.activeElement\)\); \}, \[core\.notice, core\.undoId\]\);/);
  assert.match(app, /<motion\.div\s+ref=\{noticeRef\}\s+className="notice"/);

  // "Stop listening" said: the core sends the pause, then the stream's end, often taken in one render. The pause
  // effect runs first and stops the mic through the shared ref, so the stream-end effect after it in that render
  // finds the mic off: the answer is "Paused", not a sticky "The mic stopped" (bug hunt 12; wiring, as no check
  // here renders App).
  const pauseAt = app.indexOf('core.viewAsk?.view !== "pause"');
  const streamEndAt = app.indexOf("core.voiceStatusRevision > voiceStartedAt.current");
  assert.ok(pauseAt > 0 && pauseAt < streamEndAt, "the pause effect is declared before the stream-end effect");
  assert.match(app.slice(pauseAt, streamEndAt), /if \(!releaseMic\(\)\)/);
  assert.match(app.slice(streamEndAt, streamEndAt + 300), /if \(liveStop\.current && /);
  assert.match(app, /const releaseMic = \(\) => \{\s*const stop = liveStop\.current;\s*liveStop\.current = null;/);

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
  // ⌘Z (or Ctrl+Z) asks the core for "undo that": the last turn, whether or not the notice is still up.
  core.undoLast();
  assert.deepEqual(JSON.parse(sockets.at(-1).sent.at(-1)), { type: "undo_last" });
  root.unmount();

  // The window: a notice with Undo gets the time to act, holds while the pointer or focus is on it, and ⌘Z / Ctrl+Z
  // outside a field with words in it is the app's undo (the key handler skipped every modifier key before).
  assert.match(app, /core\.undoId \? undoUpFor\(/);
  assert.match(app, /onMouseEnter=\{\(\) => setNoticeHeld\(true\)\}/);
  assert.match(app, /isUndoKey\(event, MAC\)[^]*?undoKeyGoesTo\([^]*?if \(goesTo === "app"\) core\.undoLast\(\)/);
  assert.match(app, /typedSinceSend\.current = true; setDraft/);
  assert.match(app, /setDraft\(""\); typedSinceSend\.current = false;/);
  const { isUndoKey, undoKeyGoesTo } = await server.ssrLoadModule("/src/notice-rules.ts");
  const press = (over) => ({ repeat: false, field: false, composer: false, composerEmpty: false, typedSinceSend: false, ...over });
  assert.equal(undoKeyGoesTo(press({})), "app", "on the map");
  assert.equal(undoKeyGoesTo(press({ field: true, composer: true, composerEmpty: true })), "app", "the composer a thought just left");
  assert.equal(undoKeyGoesTo(press({ field: true, composer: true, composerEmpty: true, typedSinceSend: true })), "browser",
    "a draft typed then cleared is restored, not the last thought taken back");
  assert.equal(undoKeyGoesTo(press({ field: true, composer: true })), "browser", "words in the composer");
  assert.equal(undoKeyGoesTo(press({ field: true, composerEmpty: true })), "browser", "the search field");
  assert.equal(undoKeyGoesTo(press({ repeat: true })), "none", "holding ⌘Z doesn't undo the undo");
  assert.equal(undoKeyGoesTo(press({ repeat: true, field: true, composer: true, composerEmpty: true })), "none");
  const key = (over) => ({ key: "z", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over });
  assert.ok(isUndoKey(key({ metaKey: true }), true) && isUndoKey(key({ ctrlKey: true }), false));
  assert.ok(isUndoKey(key({ key: "Z", metaKey: true }), true), "Caps Lock on");
  assert.ok(!isUndoKey(key({ metaKey: true, shiftKey: true }), true), "⇧⌘Z is redo, which this app doesn't have");
  assert.ok(!isUndoKey(key({ ctrlKey: true }), true), "on a Mac, Ctrl+Z isn't undo");
  assert.ok(!isUndoKey(key({ metaKey: true }), false), "elsewhere, ⌘ is the Windows key");

  // The button says what it takes back and how else to reach it.
  const { renderToStaticMarkup } = (await import(new URL("node_modules/react-dom/server.node.js", ui))).default;
  const { UndoButton } = await server.ssrLoadModule("/src/Undo.tsx");
  const button = renderToStaticMarkup(React.createElement(UndoButton, { id: 3, onUndo: () => {}, what: "Moved to Health", mac: true }));
  assert.match(button, /aria-label="Undo “Moved to Health”"/);
  assert.match(button, />Undo <kbd[^>]*>⌘Z<\/kbd>/);
  assert.match(button, /title="[^"]*say “undo that”/);

  // Every answer the window makes for a view request passes the request, so each can stand down the same way.
  const viewAnswers = app.match(/core\.showNotice\([^;]*core\.viewAsk\)/g) ?? [];
  assert.equal(viewAnswers.length, 7, "pause (2), finish (2), later, forget, nothing to set aside");
  console.log("notice-check: ok");
} finally {
  await server.close();
}
