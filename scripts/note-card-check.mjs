// No extra dependencies: run with `node scripts/note-card-check.mjs`.
// The note card (ui/src/note-card.ts, fed the core's `note_card` messages, core/src/notes.rs): the note's title and
// points, a decision and an unfinished point marked, Open in Notes only once Notes has the note, a dry run that says
// it wrote nothing, and an ended card that stays long enough to read and reach Open. The window never writes: the
// core does, only with NOTES_WRITE=on (its tests stand in for osascript, so nothing is written here or there).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { uiServer } from "./ui-server.mjs";

const src = (name) => readFileSync(new URL(`../ui/src/${name}`, import.meta.url), "utf8");

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
const sockets = [];
globalThis.WebSocket = class { static OPEN = 1; readyState = 1; sent = [];
  constructor() { sockets.push(this); queueMicrotask(() => { this.onopen?.(); this.onmessage?.({ data: JSON.stringify({ type: "map_identity", id: "socket-check-map" }) }); }); }
  send(data) { if (this.readyState !== 1) throw new Error("sent on a closed socket"); this.sent.push(data); const m = JSON.parse(data); if (m.type === "heartbeat") queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(m) })); if (m.type === "text" && m.id) queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: "text_received", id: m.id }) })); }
  close() {} addEventListener() {} removeEventListener() {} };
const ui = new URL("../ui/", import.meta.url);
const React = (await import(new URL("node_modules/react/index.js", ui))).default;
const { createRoot } = (await import(new URL("node_modules/react-dom/client.js", ui))).default;

let mounted;
const until = async (done, what) => {
  const deadline = Date.now() + 3000;
  while (!done() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(done(), what);
};
const server = await uiServer();
try {
  const { received, comesFirst, cardWords, pointCount, pointWords, announcement, lingerMs, STATE_CLASS } = await server.ssrLoadModule("/src/note-card.ts");
  const { readingTime, SHORTEST_MS, slowReadMs, DECIDE_MS, REACH_MS } = await server.ssrLoadModule("/src/notice-rules.ts");
  const sections = [
    { title: "", points: [
      { text: "Picnic at the lake", who: "", decided: false, unfinished: false },
      { text: "Saturday at noon", who: "", decided: true, unfinished: false },
      { text: "Someone to bring the", who: "", decided: false, unfinished: true },
    ] },
    { title: "Weather", points: [{ text: "Check the forecast", who: "", decided: false, unfinished: false }] },
  ];
  const msg = (state, extra = {}) => ({ type: "note_card", id: 1, title: "Picnic at the lake", sections, state, live: true, message: "", ...extra });

  // Saving: no Open yet, and it stays until Notes answers.
  let card = received(null, msg("saving", { message: "Saving to Notes…" }));
  assert.equal(card.type, undefined, "the card is the message without its type");
  assert.deepEqual(cardWords(card), { heading: "Note in Notes", status: "Saving to Notes…", open: false });
  assert.equal(lingerMs(card), 0, "a saving card stays until Notes answers");
  assert.equal(pointCount(card), 4);

  // Saved: Open in Notes, and up long enough to read its title and status, decide, and reach the button.
  card = received(card, msg("saved", { message: "Saved to Notes" }));
  assert.deepEqual(cardWords(card), { heading: "Note in Notes", status: "Saved to Notes", open: true });
  assert.equal(lingerMs(card), readingTime("Note in Notes Picnic at the lake Saved to Notes Picnic at the lake Saturday at noon Decided Someone to bring the unfinished Weather Check the forecast Open in Notes"));
  assert.ok(lingerMs(card) >= SHORTEST_MS, "never shorter than any notice");
  assert.ok(lingerMs(card) >= slowReadMs("Note in Notes Picnic at the lake Saved to Notes") + DECIDE_MS + REACH_MS, "keeps the original time to act");
  assert.equal(announcement(card), "Note “Picnic at the lake”, 4 points. Saved to Notes");

  // A dry run: says so in its heading and status, offers no Open (nothing is in Notes).
  const dry = received(null, msg("dry_run", { live: false, message: "Dry run: nothing written. With NOTES_WRITE=on this would be a new note in Notes." }));
  assert.deepEqual(cardWords(dry), { heading: "Note in Notes · dry run", status: "Dry run: nothing written. With NOTES_WRITE=on this would be a new note in Notes.", open: false });
  assert.ok(lingerMs(dry) > lingerMs(card), "a longer status stays longer");
  assert.equal(cardWords(received(null, msg("failed"))).open, false, "a refused note has nothing to open");
  assert.equal(cardWords(received(null, msg("failed"))).status, "Not saved");

  // A newer note replaces the one up; a late word on an older one leaves the newer.
  const newer = received(card, msg("dry_run", { id: 2, title: "Bills" }));
  assert.equal(newer.title, "Bills");
  assert.equal(received(newer, msg("saved")), newer);

  // The answer to a save just asked for comes before Recap; a card's end doesn't close it.
  assert.equal(comesFirst(msg("saving")), true);
  assert.equal(comesFirst(msg("dry_run")), true);
  assert.equal(comesFirst(msg("saved")), false);
  assert.equal(comesFirst(msg("failed")), false);
  assert.match(src("core.ts"), /noticeQueue\.find\("note", String\(msg\.id\)\)/, "updates find their own queued note");
  assert.match(src("core.ts"), /noticeQueue\.push\("note", String\(msg\.id\), note\)/, "each note has one queue entry");
  assert.match(src("core.ts"), /if \(noteFirst\(msg\)\) closeRecap\(\);/, "new notes make way in Recap");
  // Reopen the real socket handler after reading a completion. A new core may reuse id 1.
  const { useCore } = await server.ssrLoadModule("/src/core.ts");
  let core;
  mounted = createRoot(element());
  mounted.render(React.createElement(function Window() { core = useCore("me"); return null; }));
  await until(() => core?.connected, "the window connects");
  const say = message => sockets.at(-1).onmessage({ data: JSON.stringify(message) });
  say(msg("saved"));
  await until(() => core.noteCard?.id === 1, "saved note is visible");
  core.noteCardGone(1);
  await until(() => core.noteCard === null, "read completion closes");
  const closedSocket = sockets.at(-1);
  closedSocket.readyState = 3;
  closedSocket.onclose();
  await until(() => sockets.at(-1) !== closedSocket && core.connected, "the window reconnects to a new socket");
  say(msg("saving", { title: "A new picnic note" }));
  await until(() => core.noteCard?.title === "A new picnic note", "a restarted core can reuse a read note id");
  say(msg("saved", { title: "A new picnic note", message: "Saved to Notes" }));
  await until(() => core.noteCard?.state === "saved", "the reused note receives its own completion");

  // Who said a point shows only in a room (the core sends it then).
  assert.equal(pointWords({ text: "Bring chips", who: "Speaker", decided: false, unfinished: false }), "Speaker: Bring chips");
  assert.equal(pointWords(sections[0].points[0]), "Picnic at the lake");
  assert.deepEqual(Object.keys(STATE_CLASS).sort(), ["dry_run", "failed", "saved", "saving"]);

  // The card draws the marks and offers only Open: nothing in the window can delete or change a note.
  const view = src("NoteCard.tsx");
  assert.match(view, /point\.decided && <span className="decided"><span aria-hidden="true">✓ <\/span>Decided<\/span>/, "a decision marked as the map marks it");
  assert.match(view, /point\.unfinished && <span className="note-card-mark">unfinished<\/span>/);
  assert.doesNotMatch(src("core.ts"), /"(delete|remove|edit)_note"/, "the window never asks to delete or change a note");
  assert.match(src("core.ts"), /type: "open_note", id/);
  assert.match(src("App.tsx"), /<NoteCard card=\{core\.noteCard\} onOpen=\{core\.openNote\} onGone=\{core\.noteCardGone\} \/>/);
  console.log("note-card-check: ok");
} finally {
  mounted?.unmount();
  await server.close();
}
