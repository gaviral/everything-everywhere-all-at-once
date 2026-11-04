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
// Storage can be denied in a browser too: recovery must report that without
// crashing a later render or preventing any of the notices below.
const deniedStorage = () => { throw new Error("Storage unavailable"); };
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  get length() { return deniedStorage(); }, key: deniedStorage,
  getItem: deniedStorage, setItem: deniedStorage, removeItem: deniedStorage,
} });
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
// Waits for what a message leads to, up to 3 s: on a machine busy with builds, 20 ms was sometimes too short for React
// to render and run the window's effect (5 runs in 20 at load average 76, 2026-11-02).
const until = async (done) => { for (let waited = 0; !done() && waited < 3000; waited += 10) await new Promise((resolve) => setTimeout(resolve, 10)); };

const server = await uiServer();
try {
  const { staysUp, upFor, readingTime, SHORTEST_MS, micStopped, undoUpFor, slowReadMs, DECIDE_MS, REACH_MS } = await server.ssrLoadModule("/src/notice-rules.ts");
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
  assert.equal(upFor(keyless), readingTime(keyless));
  const long = "Did “Expand the garden” instead. Your earlier words are off the map, and the journal keeps them if you want them back later.";
  assert.equal(upFor(long), readingTime(long));
  assert.ok(upFor(long) > upFor("Back to Rent"));
  for (const text of ["Back to Rent", keyless, long]) {
    assert.ok(upFor(text) >= Math.max(SHORTEST_MS, readMs(text)), "never shorter than the original reading time");
  }

  // The mic stopping on its own says why, when the core said, and stays up until the mic is tapped (bug hunt 26:
  // every reason became the same "The mic stopped").
  const quiet = micStopped("Speech service error: Voice Transcribe stopped answering");
  assert.equal(quiet, "The mic stopped: the voice service stopped answering. Check the connection, then tap the mic.");
  assert.equal(micStopped("Speech service error: IO error: Connection reset by peer (os error 54)"), quiet);
  const busy = micStopped("Voice Transcribe: Too many requests");
  assert.equal(busy, "The mic stopped: the voice service said “Too many requests”. Tap it to try again, or type below.");
  assert.equal(micStopped(""), "The mic stopped. Tap it to keep talking.");
  // A mic notice stays until the mic is tapped again, and that tap clears it, so "The mic stopped" never sits over a
  // listening mic; the refused-key notice isn't the mic's and stays (review ui-voice #2).
  const { micNotice } = await server.ssrLoadModule("/src/notice-rules.ts");
  for (const notice of [quiet, busy, micStopped(""),
    "The browser is blocking the microphone for this site. Allow it from the icon beside the address, then tap the mic. You can type meanwhile.",
    "Your Mac is blocking the microphone for this browser. Turn it on in System Settings › Privacy & Security › Microphone, then reopen the browser.",
    "No microphone found. Connect one, then tap the mic, or type below.",
    "Couldn't start the mic. Tap it to try again, or type below.", "Connection lost. Reconnect to use the microphone; you can still type below.",
    "The mic stopped: the connection was lost. Tap it once reconnected; you can still type below."]) assert.ok(micNotice(notice), notice);
  for (const notice of ["The AI key was refused. Check MODEL_API_KEY in .env, then restart.", "Moved to Health", ""]) assert.ok(!micNotice(notice), notice);
  const appText = readFileSync(new URL("../ui/src/App.tsx", import.meta.url), "utf8");
  const startPath = appText.slice(appText.indexOf("const toggleMic"), appText.indexOf("await startMic("));
  assert.match(startPath, /setStartingMic\(true\);\s*if \(micNotice\(core\.notice\)\) core\.clearNotice\(\);/, "the tap that starts the mic clears its notice");
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

  // Active sends interrupt reading: Stop cannot wait behind an old completion or another card.
  const { noticeQueue } = await server.ssrLoadModule("/src/notice-queue.ts");
  const priority = noticeQueue();
  const older = { id: 1, to: "Sam", text: "Earlier send", state: "stopped", live: false, message: "Stopped: not sent", until: 0, total: 5000 };
  priority.push("send", "1", older);
  priority.push("notice", "answer", { text: "Unread answer", undo: null });
  const active = { ...older, id: 2, state: "counting", until: Date.now() + 5000 };
  priority.push("send", "2", active);
  assert.equal(priority.snapshot().value, active, "a fresh countdown preempts the older completion");
  assert.equal(priority.find("send", "1").value, older, "preemption preserves the unread completion");
  priority.push("notice", "later", { text: "Later answer", undo: null });
  assert.equal(priority.snapshot().value, active, "ordinary answers cannot cover Stop");
  const replacement = { ...active, id: 3 };
  priority.push("send", "3", replacement);
  assert.equal(priority.snapshot().value, replacement, "the current core count replaces an obsolete count");
  assert.equal(priority.find("send", "2"), undefined);
  priority.push("send", "3", { ...replacement, state: "stopped" });
  assert.equal(priority.snapshot().key, "3", "its completion keeps the current reading turn");
  priority.drop("send", "3");
  assert.equal(priority.snapshot().value, older, "the interrupted completion resumes afterwards");
  priority.drop("send", "1");
  assert.equal(priority.snapshot().key, "answer", "the remaining unread answers resume in arrival order");
  priority.push("send", "1", { ...active, id: 1 });
  assert.equal(priority.snapshot().kind, "send", "an active countdown cannot be suppressed by a previously read id");
  assert.equal(priority.snapshot().key, "1");

  // The real hook: a burst waits in order, keeps its own Undo and survives new speech.
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
  await until(() => sockets.length > 0);
  const say = (message) => sockets.at(-1).onmessage({ data: JSON.stringify(message) });
  await settle();
  say({ type: "notice", message: "Moved to Garden" });
  say({ type: "undoable", id: 1 });
  say({ type: "notice", message: "Moved to Kitchen" });
  say({ type: "undoable", id: 2 });
  await until(() => core.notice !== "");
  assert.equal(core.recovery.storageUnavailable, true, "storage denial leaves recovery and notices usable");
  assert.equal(core.notice, "Moved to Garden");
  assert.equal(core.undoId, null, "a newer answer invalidates the old Undo even while queued");
  assert.equal(core.latestUndoId, 2, "History knows the latest queued turn without lending its Undo to the visible one");
  core.clearNotice();
  await until(() => core.notice === "Moved to Kitchen");
  assert.equal(core.undoId, 2);
  say({ type: "correctable", for_ms: 8000, back_to: null });
  await until(() => core.undoId === null);
  assert.equal(core.notice, "Moved to Kitchen", "speech doesn't dismiss a notice");
  core.clearNotice();
  await until(() => core.notice === "");
  say({ type: "notice", message: "Again" });
  say({ type: "notice", message: "Again" });
  await until(() => core.notice === "Again");
  core.clearNotice();
  await settle();
  assert.equal(core.notice, "Again", "same words from two events are two answers");
  core.sendText("stop showing this");
  await until(() => core.notice === "");
  say({ type: "notice", message: "Muted kind" });
  await settle();
  assert.equal(core.notice, "");
  say({ type: "notice_control", show: true });
  say({ type: "notice", message: "Back again" });
  await until(() => core.notice === "Back again");
  assert.equal(core.notice, "Back again");
  core.undoLast();
  assert.deepEqual(JSON.parse(sockets.at(-1).sent.at(-1)), { type: "undo_last" });
  core.clearNotice();
  await until(() => core.notice === "");

  // Preserve the pre-queue lifecycle checks. Each answer is read before the next
  // scene; within a scene the queue must retain arrival order.
  const read = async (text) => {
    await until(() => core.notice === text);
    assert.equal(core.notice, text);
    core.clearNotice();
    await settle();
  };
  const listened = core.listenedRevision;
  say({ type: "status", listening: false, note: "Stopped listening" });
  await settle();
  assert.equal(core.listenedRevision, listened);
  say({ type: "status", listening: true, note: "Listening" });
  await until(() => core.listenedRevision === listened + 1);
  assert.equal(core.listenedRevision, listened + 1);

  // A snapshot retires every stale key notice, including ones behind an unread answer.
  say({ type: "notice", message: "Keep this unread answer" });
  say({ type: "notice", message: "MODEL_API_KEY is not set: listening and placement are off." });
  await until(() => core.noKey);
  assert.ok(core.noKey && !core.resting);
  say({ type: "notice", message: "Today's free tries are used up; back tomorrow. Your map is still here to read." });
  await until(() => core.resting);
  assert.ok(core.noKey && core.resting && !core.keyRefused);
  say({ type: "notice", message: "Making an app needs the AI key. Set MODEL_API_KEY in .env, then restart." });
  await settle();
  assert.ok(core.noKey && core.resting && !core.keyRefused);
  say({ type: "snapshot", world: {} });
  await until(() => !core.noKey && !core.resting);
  assert.ok(!core.noKey && !core.resting);
  await read("Keep this unread answer");
  assert.equal(core.notice, "", "no stale key notice remains queued after the snapshot");

  const { statusLine } = await server.ssrLoadModule("/src/core.ts");
  const line = (extra) => statusLine({ connected: true, listening: false, noKey: false, refused: false, resting: false, paused: false, ...extra });
  assert.equal(line({}), "Ready");
  assert.equal(line({ noKey: true }), "No AI key");
  assert.equal(line({ noKey: true, refused: true }), "AI key refused");
  assert.match(line({ noKey: true, resting: true }), /^Free tries .*tomorrow/);
  assert.doesNotMatch(line({ noKey: true, resting: true }), /AI key/);
  say({ type: "error", message: "Speech service error: Voice Transcribe stopped answering" });
  await until(() => core.voiceError !== "");
  assert.equal(core.voiceError, "Speech service error: Voice Transcribe stopped answering");
  assert.equal(core.notice, "", "voice errors aren't raw notices");

  say({ type: "notice", message: "Expanded everything." });
  say({ type: "undoable", id: 3 });
  await until(() => core.undoId === 3);
  assert.equal(core.undoId, 3);
  core.showNotice("Sound isn't available in this browser right now.");
  await until(() => core.undoId === null);
  assert.equal(core.undoId, null, "a local answer invalidates an old Undo");
  await read("Expanded everything.");
  await read("Sound isn't available in this browser right now.");

  const before = core.answerRevision;
  say({ type: "view", view: "pause" });
  await read("The mic is already off.");
  say({ type: "view", view: "pause" });
  await read("The mic is already off.");
  assert.equal(core.answerRevision, before + 2, "identical local answers count separately");
  // A same-render core correction suppresses the local answer.
  say({ type: "view", view: "pause" });
  say({ type: "notice", message: "Did stop listening instead." });
  say({ type: "undoable", id: 7 });
  await until(() => core.undoId === 7);
  assert.equal(core.undoId, 7);
  await read("Did stop listening instead.");
  assert.equal(core.notice, "", "no stale local answer was queued after the correction");
  // Separate renders retain the answer already read, then the correction and its Undo.
  say({ type: "view", view: "pause" });
  await until(() => core.notice === "The mic is already off.");
  say({ type: "notice", message: "Did pause instead." });
  say({ type: "correctable", for_ms: 12000, back_to: null });
  say({ type: "undoable", id: 8 });
  await settle();
  await read("The mic is already off.");
  assert.equal(core.undoId, 8, "the queued correction owns its Undo");
  say({ type: "correctable", for_ms: 12000, back_to: null });
  await until(() => core.undoId === null);
  assert.equal(core.undoId, null, "newer words invalidate Undo");
  await read("Did pause instead.");

  say({ type: "notice", message: "Moved to Garden" });
  say({ type: "undoable", id: 9 });
  await until(() => core.undoId === 9);
  say({ type: "snapshot", world: {} });
  await until(() => core.undoId === null);
  assert.equal(core.undoId, null, "a snapshot invalidates the old core's Undo ids");
  await read("Moved to Garden");
  say({ type: "notice", message: "Moved to Health" });
  say({ type: "undoable", id: 10 });
  await until(() => core.undoId === 10);
  const socket = sockets.at(-1), sent = socket.sent.length;
  socket.readyState = 3;
  core.undo(10);
  await settle();
  assert.equal(socket.sent.length, sent, "no Undo sent on a closed socket");
  assert.equal(core.undoId, null);
  await read("Moved to Health");
  await read("Not connected — try again when connected.");
  socket.readyState = 1;
  root.unmount();
  const app = app0();
  assert.match(app, /statusLine\(\{/);
  assert.match(app, /statusNew: core\.voiceStatusRevision > voiceStartedAt\.current, listenedNew: core\.listenedRevision > voiceListenedAt\.current/);
  assert.match(app, /voiceListenedAt\.current = voiceRevisions\.current\.listened;/);
  assert.match(app, /window\.setTimeout\(core\.clearNotice[^]*?\}, \[core\.notice, core\.noticeKey,/);
  assert.match(app, /useEffect\(\(\) => \{ setNoticeFocused\(!!core\.notice && !!noticeRef\.current\?\.contains\(document\.activeElement\)\); \}, \[core\.notice, core\.undoId\]\);/);
  assert.match(app, /<motion\.div\s+ref=\{noticeRef\}\s+className="notice"/);
  const pauseAt = app.indexOf('core.viewAsk?.view !== "pause"');
  const streamEndAt = app.indexOf("core.voiceStatusRevision > voiceStartedAt.current");
  assert.ok(pauseAt > 0 && pauseAt < streamEndAt);
  assert.match(app.slice(pauseAt, streamEndAt), /if \(!releaseMic\(\)\)/);
  assert.match(app.slice(streamEndAt, streamEndAt + 300), /if \(liveStop\.current && /);
  assert.match(app, /const releaseMic = \(\) => \{\s*const stop = liveStop\.current;\s*liveStop\.current = null;/);

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
  assert.doesNotMatch(button, /disabled/);
  // Away from the core it can't reach it: disabled, as the window's other core buttons are (feedback.ts undo-notice).
  const away = renderToStaticMarkup(React.createElement(UndoButton, { id: 3, onUndo: () => {}, what: "Moved to Health", mac: true, offline: true }));
  assert.match(away, /<button[^>]* disabled=""/);
  assert.match(app, /<UndoButton [^>]*offline=\{!core\.connected\}/);
  // So is the map change's Undo: pressed offline, its click went nowhere and the note went with it.
  assert.match(app, /core\.mapChange\.restore\) && <button className="undo" disabled=\{!core\.connected\}/);

  // Every answer the window makes for a view request passes the request, so each can stand down the same way.
  const viewAnswers = app.match(/core\.showNotice\([^;]*core\.viewAsk\)/g) ?? [];
  assert.equal(viewAnswers.length, 10, "Talk/features, pause (2), finish (2), later, forget, nothing to set aside, Notification history off, Cards off");
  console.log("notice-check: ok");
} finally {
  await server.close();
}
