// No extra dependencies: run with `node scripts/export-check.mjs`.
// "Export my map" (ui/src/export-md.ts): threads as headings in the map's order with branches under their thread,
// thoughts as bullets with the time said, decisions marked where they were said, made in the window with nothing sent
// anywhere, and the file handed to the browser to save.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { uiServer } from "./ui-server.mjs";

globalThis.location = new URL("http://localhost:4321/");
const server = await uiServer();
try {
  const { mapMarkdown, saysDecided, decidedAt, inline, exportedNotice, download } = await server.ssrLoadModule("/src/export-md.ts");
  const { movesAsked } = await server.ssrLoadModule("/src/core.ts");

  const NOW = Date.UTC(2026, 10, 3, 22, 12); // Nov 3, 2026, 10:12 PM UTC
  const at = (day, h, m) => Date.UTC(2026, 10, day, h, m);
  const thread = (id, title, parent_id = null) => ({ id, title, parent_id, status: "open", last_point: "", touched_ms: 0, tags: [], picture: null, dropped_by: "" });
  const thought = (id, thread_id, point, at_ms, extra = {}) => ({ id, speaker: "you", text: point, point, thread_id, placed: !!thread_id, unclear: "", complete: true, at_ms, place_ms: null, ...extra });
  const base = { recaps: [], apps: [], apps_seeded: false, merged: {}, proposals: [], suggestions: [], actions: [], active: null, active_by: {}, notes: {} };
  const md = (world) => mapMarkdown({ ...base, ...world }, { now: NOW, timeZone: "UTC" });

  // Threads in the map's order; a branch right under its thread, one level down; a branch of a branch, two.
  const world = {
    threads: [thread("T1", "Garden"), thread("T2", "Bills"), thread("T3", "Beans", "T1"), thread("T4", "Stakes", "T3"), thread("T5", "Lost parent", "GONE")],
    thoughts: [
      thought("b", "T1", "water the tomatoes", at(1, 9, 5)),
      thought("a", "T1", "plant beans this week", at(1, 9, 0)),
      thought("c", "T1", "compost from Dana", at(2, 8, 0)),
      thought("d", "T2", "electric bill due Friday", at(1, 10, 0), { text: "so the electric bill is due on Friday I think" }),
      thought("e", "T3", "pole beans", at(1, 11, 0)),
      thought("f", null, "call the landlord", at(1, 12, 0)),
    ],
  };
  const out = md(world).text;
  const headings = out.split("\n").filter((l) => l.startsWith("#"));
  assert.deepEqual(headings, ["# Thread map", "## Garden", "### Beans", "#### Stakes", "## Bills", "## Lost parent", "## Not placed yet"]);
  assert.match(out, /^Exported Nov 3, 2026, 10:12 PM · 5 threads · 6 thoughts$/m);

  // Thoughts in the order said; the first bullet on a thread carries its date, later ones only the time unless the day changed.
  const garden = out.split("## Garden\n\n")[1].split("\n\n")[0].split("\n");
  assert.deepEqual(garden, ["- Nov 1, 9:00 AM · Plant beans this week", "- 9:05 AM · Water the tomatoes", "- Nov 2, 8:00 AM · Compost from Dana"]);
  // The point as the card shows it, not the longer words behind it.
  assert.match(out, /## Bills\n\n- Nov 1, 10:00 AM · Electric bill due Friday\n/);
  assert.ok(!out.includes("I think"), "the words behind a point stay on its card");
  assert.match(out, /#### Stakes\n\n- Nothing said here yet/);
  assert.match(out, /## Not placed yet\n\n- Nov 1, 12:00 PM · Call the landlord/);
  assert.equal(md(world).name, "thread-map-2026-11-03-2212.md");

  // A point dated ahead of the clock (a sample dated for a demo) counts as earliest, as on the map; time 0 shows none.
  const ahead = md({ threads: [thread("T1", "Trip")], thoughts: [thought("x", "T1", "later one", at(1, 9, 0)), thought("y", "T1", "dated ahead", NOW + 3 * 3600_000), thought("z", "T1", "no time", 0)] }).text;
  assert.match(ahead, /## Trip\n\n- Dated ahead\n- No time\n- Nov 1, 9:00 AM · Later one/);

  // Decisions: said outright, they're marked on their point; a recap's decision lands on the point it restates, or
  // under the heading when no point does; said once even when both recaps have it; a merged thread's goes where it went.
  for (const yes of ["I decided to rent the van", "We've decided: Lisbon", "we have finally settled on the blue tiles", "I've made up my mind", "We chose the earlier flight", "I’ve decided"]) assert.ok(saysDecided(yes), yes);
  for (const no of ["I can't decide", "I haven't decided yet", "have you decided?", "I'm going with Sam to Tahoe", "decide by Friday", "undecided",
    "I haven't made up my mind", "Have we decided on the train", "Have we decided on the train?", "not sure we chose the right one", "if we chose the van it'd fit", "I never settled on a name"]) assert.ok(!saysDecided(no), no);
  for (const yes of ["I'm not sure, but I decided to go", "Not the bus. We chose the train", "I decided not to go"]) assert.ok(saysDecided(yes), yes);
  const decided = md({
    threads: [thread("T1", "Pottery"), thread("T2", "Trip")],
    thoughts: [thought("p1", "T1", "class on Tuesdays or Saturdays", at(1, 9, 0)), thought("p2", "T1", "book the Saturday pottery class", at(1, 9, 10)),
      thought("t1", "T2", "I decided to take the train", at(1, 10, 0))],
    merged: { OLD: "T2" },
    recaps: [
      { period: "today", since_ms: at(1, 0, 0), through_ms: at(1, 23, 0), thought_count: 3, decisions: [{ thread_id: "T1", text: "Book the Saturday pottery class" }, { thread_id: "OLD", text: "Hotel near the station" }] },
      { period: "session", since_ms: at(1, 9, 0), through_ms: at(1, 10, 0), thought_count: 3, decisions: [{ thread_id: "T1", text: "book the Saturday pottery class" }] },
    ],
  }).text;
  assert.match(decided, /- Nov 1, 9:00 AM · Class on Tuesdays or Saturdays\n- 9:10 AM · \*\*Decided:\*\* Book the Saturday pottery class\n/);
  assert.equal(decided.match(/Decided:\*\* Book the Saturday/g).length, 1, "a decision in both recaps is said once");
  assert.match(decided, /## Trip\n\n- \*\*Decided:\*\* Hotel near the station\n- Nov 1, 10:00 AM · \*\*Decided:\*\* I decided to take the train/);
  assert.equal(decidedAt("Book the Saturday pottery class", [thought("q", "T1", "pottery is fun", 1)]), null, "one shared word isn't the same decision");
  // The core's mark (decided.rs, as the card shows it) counts even where this file's rule finds no decision.
  const marked = md({ threads: [thread("T1", "Plans")], thoughts: [thought("m1", "T1", "let's go with Thursday", at(1, 9, 0), { decided: true })] }).text;
  assert.match(marked, /\*\*Decided:\*\* Let's go with Thursday/);
  // A recap made before a thought was scratched spoke of a map that's gone: its decisions don't come back.
  const undone = md({ threads: [thread("T1", "Trip")], thoughts: [thought("u1", "T1", "trip in June", at(1, 9, 0))],
    recaps: [{ period: "today", since_ms: at(1, 0, 0), through_ms: at(1, 23, 0), thought_count: 2, decisions: [{ thread_id: "T1", text: "Rent the van" }] }] }).text;
  assert.ok(!undone.includes("Decided"), "a scratched decision stays scratched");
  // Not placed yet, a decision said outright is still marked.
  assert.match(md({ threads: [], thoughts: [thought("w", null, "I decided to rent the van", at(1, 9, 0))] }).text,
    /## Not placed yet\n\n- Nov 1, 9:00 AM · \*\*Decided:\*\* I decided to rent the van/);

  // Words said across a pause read as one point, as the card shows them.
  const joined = md({ threads: [thread("T1", "Shed")], thoughts: [thought("h", "T1", "paint the shed", at(1, 9, 0), { text: "I want to paint the" }), thought("k", "T1", "paint the shed green", at(1, 9, 1), { text: "shed green" })], notes: { k: { continues: "h" } } });
  assert.match(joined.text, /## Shed\n\n- Nov 1, 9:01 AM · Paint the shed green\n$/);
  assert.equal(joined.thoughts, 1, "counted as the card counts points");

  // Who said it, only when more than one person did; Markdown in the words stays literal, on one line.
  const two = md({ threads: [thread("T1", "Plan")], thoughts: [thought("s1", "T1", "a", at(1, 9, 0)), { ...thought("s2", "T1", "b", at(1, 9, 1)), speaker: "Sam" }] }).text;
  assert.match(two, /- Nov 1, 9:00 AM · you: A\n- 9:01 AM · Sam: B/);
  assert.ok(!md(world).text.includes("you:"), "alone, no names");
  assert.equal(inline("*bold* _x_ [link](y) <b>\n next"), "\\*bold\\* \\_x\\_ \\[link\\](y) \\<b\\> next");

  // Reminders and events as tasks (added ones checked; the AI's still proposed say so; dismissed ones gone); kept ideas.
  const tasks = md({ threads: [thread("T1", "Bills")], thoughts: [thought("m", "T1", "pay rent", at(1, 9, 0))],
    actions: [{ id: "a1", thread_id: "T1", kind: "reminder", title: "Pay rent", when: "Friday", status: "done", done_ms: 1 },
      { id: "a2", thread_id: "T1", kind: "event", title: "Call bank", when: "", status: "new", done_ms: null },
      { id: "a3", thread_id: "T1", kind: "reminder", title: "Gone", when: "", status: "dismissed", done_ms: null }],
    suggestions: [{ id: "s1", thread_id: "T1", text: "Autopay", status: "kept" }, { id: "s2", thread_id: "T1", text: "Not kept", status: "new" }] }).text;
  assert.match(tasks, /- \[x\] Reminder: Pay rent · Friday\n- \[ \] Event: Call bank \(proposed by AI\)\n- Idea: Autopay\n/);
  assert.ok(!tasks.includes("Gone") && !tasks.includes("Not kept"));

  assert.equal(exportedNotice(md(world)), "Exported 5 threads and 6 thoughts as thread-map-2026-11-03-2212.md");

  // Nothing leaves the machine: the file is made from the map in the window, and only handed to the browser to save.
  const source = readFileSync(new URL("../ui/src/export-md.ts", import.meta.url), "utf8");
  for (const word of ["fetch(", "WebSocket", "XMLHttpRequest", "sendBeacon", "send(", "window.open"]) assert.ok(!source.includes(word), word);
  let clicked = null;
  const appended = [];
  globalThis.document = { createElement: () => ({ click() { clicked = this; }, remove() { appended.splice(appended.indexOf(this), 1); } }), body: { appendChild: (el) => appended.push(el) } };
  globalThis.window = { setTimeout: (f) => f() };
  const made = [];
  const revoked = [];
  const { createObjectURL, revokeObjectURL } = URL;
  URL.createObjectURL = (blob) => { made.push(blob); return "blob:x"; };
  URL.revokeObjectURL = (url) => revoked.push(url);
  try {
    const file = md(world);
    download(file);
    assert.equal(clicked.download, file.name);
    assert.equal(clicked.href, "blob:x");
    assert.equal(made[0].type, "text/markdown;charset=utf-8");
    assert.equal(await made[0].text(), file.text);
    assert.deepEqual(appended, [], "the link leaves the page");
    assert.deepEqual(revoked, ["blob:x"], "the file lets go of its memory");
  } finally { URL.createObjectURL = createObjectURL; URL.revokeObjectURL = revokeObjectURL; }

  // Said aloud, it doesn't move the map, and the window answers it with the file (App.tsx), as the Export button does.
  assert.equal(movesAsked("you")({ ...base, threads: [], thoughts: [] }, { type: "view", view: "export" }), false);
  const app = readFileSync(new URL("../ui/src/App.tsx", import.meta.url), "utf8");
  assert.ok(app.includes('if (asked === "export") { exportMap(core.viewAsk); return; }'), "the spoken ask exports");
  assert.ok(app.includes('onClick={() => exportMap()} aria-label="Export map as Markdown"'), "the Export button exports, named for screen readers");
  assert.ok(app.includes('{(world.threads.length > 0 || world.thoughts.length > 0) && <button className="import-open" onClick={() => exportMap()}'), "Export shows while every thought waits for a thread");
  console.log("export-check: ok");
} finally {
  await server.close();
}
