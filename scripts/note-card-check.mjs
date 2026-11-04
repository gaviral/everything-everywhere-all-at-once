// No extra dependencies: run with `node scripts/note-card-check.mjs`.
// The note card (ui/src/note-card.ts, fed the core's `note_card` messages, core/src/notes.rs): the note's title and
// points, a decision and an unfinished point marked, Open in Notes only once Notes has the note, a dry run that says
// it wrote nothing, and an ended card that stays long enough to read and reach Open. The window never writes: the
// core does, only with NOTES_WRITE=on (its tests stand in for osascript, so nothing is written here or there).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { uiServer } from "./ui-server.mjs";

const src = (name) => readFileSync(new URL(`../ui/src/${name}`, import.meta.url), "utf8");

globalThis.location = new URL("http://localhost:4321/");
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
  assert.match(src("core.ts"), /ws\.onopen = \(\) => \{[^]*?noticeQueue\.reset\("note"\)/, "a restarted core can reuse note ids");

  // Who said a point shows only in a room (the core sends it then).
  assert.equal(pointWords({ text: "Bring chips", who: "Ana", decided: false, unfinished: false }), "Ana: Bring chips");
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
  await server.close();
}
