// No extra dependencies: run with `node scripts/guide-check.mjs` (after the UI is built; precheck builds it first).
// Another participant shows you a part of the screen, says a line, or holds a question for your pause (docs/guide.md:
// the core relays `point`, `caption` and `hold`, core/src/guide.rs; ui/src/Guide.tsx draws them). Held here:
//  1. The rules (ui/src/guide-core.ts, through Vite): docs/guide.md lists exactly the names the code knows, and each
//     fixed name is on an element; the arrow's place at a part (short, from the nearest side with room, kept clear of
//     what is near the part); how long a caption, a page of it and a question stay; pages of two lines; a question's main
//     words; the mic hearing the caption's own voice; one point at a time; held questions asked, gone ahead, put off,
//     dropped and talked over; where a part not on screen is.
//  2. On the built UI in headless Chrome over a stand-in core (exit 3, precheck's WARN, without Chrome or ui/dist): the
//     caption bottom center above where you type, its Markdown, its pages; the arrow at the named part (short, its tip
//     clear of the ring; scripts/arrow-clear-check.mjs holds that it crosses no button or text), scrolled into view, and
//     followed as it moves; Esc and a click take it down; Show on the card a thought is in and the Map button lead it on
//     to the part; a part not on screen is said, not guessed; the caption over an open sheet, gone once read, held under
//     the pointer and while the page is hidden; talking over it steps it back at once (not its own voice), what you
//     didn't read held; a held question waits while you talk or type and is asked at your pause, with ink buttons and
//     keys: Go ahead, Later, Drop it; a phone keeps both on screen; Reduce Motion moves nothing.
// GUIDE_SHOTS=<folder> also saves a screenshot of each step there.
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { uiServer } from "./ui-server.mjs";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

// ---- 1. The rules.
const server = await uiServer();
let rules;
try { rules = await server.ssrLoadModule("/src/guide-core.ts"); } finally { await server.close(); }
const {
  NAMES, pointer, shape, RUNS, aimAt, captionMs, CAPTION_SHORTEST_MS, askMs, overMs, pages, mainWords, echoOf, guided, NOTHING, nextAsk, inLine, asked, wentAhead,
  putOff, dropped, talkedOver, heldLater, heldDropped, instead, label, GUTTER, TIP_GAP, RING_PAD, NEAR, NATURAL_PAUSE_MS,
} = rules;

// The docs list every name the code knows and no other; each fixed name is on an element, each made one has its maker.
const listed = [...read("docs/guide.md").matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
assert.deepEqual(listed.toSorted(), [...Object.keys(NAMES), "thread:<id>", "point:<id>", "view:<id>"].toSorted(), "docs/guide.md lists each name guide-core.ts knows");
const src = readdirSync(new URL("ui/src/", root)).filter((f) => f.endsWith(".tsx")).map((f) => read(`ui/src/${f}`)).join("\n");
for (const name of Object.keys(NAMES)) assert.ok(src.includes(`data-guide="${name}"`), `no element in ui/src has data-guide="${name}"`);
for (const made of ["thread:${thread.id}", "point:${thought.id}", "view:${brick.info.id}"]) assert.ok(src.includes(`data-guide={\`${made}\`}`), `no element is named ${made}`);

// The arrow: short, at the part, from the nearest side that has room (the side facing the caption first), never across
// what's drawn near the part (`avoid`: its buttons, lines of text and cards, as the page measures them).
const laptop = { width: 1440, height: 900 };
const within = (r, screen) => [r.start, r.c1, r.c2, r.end].every((p) => p.x >= 8 && p.x <= screen.width - 8 && p.y >= 8 && p.y <= screen.height - 8);
const caption = { left: 420, top: 718, right: 1020, bottom: 770 };
const arrow = (to, from, screen, avoid = [], opts) => { const plan = pointer(to, from, screen, avoid, opts); return plan && { plan, route: shape(plan, to) }; };
// A line of text up the map, nothing near: from under it, the way the caption is, near its right end, where a line of
// text ends first; the longest run, straight, its tip TIP_GAP clear of the part.
const line = { left: 586, top: 392, right: 834, bottom: 422 };
let pt = arrow(line, caption, laptop);
assert.deepEqual([pt.plan.side, pt.plan.run, pt.plan.sway], ["below", RUNS[0], 0]);
assert.deepEqual(pt.route.end, { x: 834 - 40, y: 422 + TIP_GAP });
assert.deepEqual(pt.route.start, { x: 834 - 40, y: 422 + TIP_GAP + RUNS[0] });
assert.ok(pt.route.c2.x === pt.route.end.x && pt.route.c2.y > pt.route.end.y, "it arrives along the line, from under the part");
assert.ok(within(pt.route, laptop), "its bends stay on screen");
// Words under it: not across them: from its right, at its middle, where the line leaves room.
pt = arrow(line, caption, laptop, [{ left: 560, top: 440, right: 900, bottom: 520 }]);
assert.equal(pt.plan.side, "right");
assert.deepEqual(pt.route.end, { x: 834 + TIP_GAP, y: 407 });
// Words on every side that faces the caption: the next side, and a shorter run where the room is short.
pt = arrow(line, caption, laptop, [{ left: 560, top: 440, right: 900, bottom: 520 }, { left: 860, top: 380, right: 1100, bottom: 440 }]);
assert.equal(pt.plan.side, "left");
pt = arrow(line, caption, laptop, [{ left: 560, top: 505, right: 900, bottom: 560 }]);
assert.deepEqual([pt.plan.side, pt.plan.run], ["below", RUNS[1]], "a shorter arrow beats another side");
// A tall card: at its head, where its title is, when the arrow comes in from a side.
const card = { left: 130, top: 190, right: 714, bottom: 595 };
assert.equal(arrow(card, caption, laptop).plan.side, "below");
pt = arrow(card, caption, laptop, [{ left: 100, top: 640, right: 800, bottom: 700 }]);
assert.deepEqual([pt.plan.side, pt.route.end.y], ["right", 190 + 28]);
// A button at the top, a neighbour under its right half (the Talk pill under Catalog): the tip moves to the left of
// it, a fifth in from the end, so the arrow still comes up from under it.
const catalog = { left: 1297, top: 17, right: 1423, bottom: 55 };
assert.deepEqual(arrow(catalog, caption, laptop).route.end, { x: 1360, y: 55 + TIP_GAP }, "a control, at its middle");
pt = arrow(catalog, caption, laptop, [{ left: 1370, top: 72, right: 1423, bottom: 108 }]);
assert.deepEqual([pt.plan.side, pt.route.end.x < 1370 - 12, pt.route.start.x === pt.route.end.x], ["below", true, true]);
// Boxed in (a phone's corner: Find to its left, the Talk pill under it, the screen's edges): no arrow, the ring alone.
const phone = { width: 390, height: 844 };
const corner = { left: 339, top: 10, right: 374, bottom: 46 };
const crowd = [{ left: 296, top: 10, right: 331, bottom: 46 }, { left: 257, top: 73, right: 372, bottom: 103 }];
const low = { left: 16, top: 770, right: 374, bottom: 800 };
assert.equal(arrow(corner, low, phone, crowd), null, "no room on any side: no arrow");
assert.equal(arrow(corner, low, phone, crowd.slice(0, 1)).plan.side, "below", "the Talk pill gone, it's from under");
assert.equal(arrow({ left: 296, top: 10, right: 331, bottom: 46 }, low, phone, [crowd[1]]).plan.side, "left", "Find, its left clear: from the left");
// The composer just under the caption: no arrow, its ring says which (the caption is at it already).
assert.equal(arrow({ left: 340, top: 770 + NEAR - 4, right: 1100, bottom: 840 }, caption, laptop), null);
// A card just over the caption (the unfinished card): from a side, the caption kept clear of.
pt = arrow({ left: 420, top: 718 - NEAR + 4 - 80, right: 1020, bottom: 718 - NEAR + 4 }, caption, laptop, [caption]);
assert.equal(pt.plan.side, "right");
// The mic, level with the caption and left of it: from its right, toward the caption.
pt = arrow({ left: 350, top: 784, right: 390, bottom: 824 }, caption, laptop);
assert.equal(pt.plan.side, "right");
// A phone: a line as wide as the card that holds it, the caption (kept clear of) under it: from under it, near its
// right end, shorter to stop short of the caption.
pt = arrow({ left: 23, top: 470, right: 367, bottom: 520 }, { left: 16, top: 600, right: 374, bottom: 700 }, phone, [{ left: 16, top: 600, right: 374, bottom: 700 }]);
assert.deepEqual([pt.plan.side, pt.plan.run, pt.route.end], ["below", RUNS[1], { x: 327, y: 520 + TIP_GAP }]);
assert.ok(within(pt.route, phone));
// It stays as it was while it's still clear, and moves with the part (the same plan, the part's new place).
const kept = arrow(line, caption, laptop, [{ left: 560, top: 440, right: 900, bottom: 520 }]).plan;
assert.equal(pointer(line, caption, laptop, [], { keep: kept }), kept, "the arrow drawn before stays while it is clear");
assert.notEqual(pointer(line, caption, laptop, [{ left: 800, top: 395, right: 900, bottom: 420 }], { keep: kept }), kept, "and gives way when it isn't");
assert.equal(shape(kept, { ...line, top: line.top + 100, bottom: line.bottom + 100 }).end.y, shape(kept, line).end.y + 100, "at the part, wherever it is");
// A part scrolled out of the room (a sliver at the edge it's past): from inside the room, pointing out toward it.
pt = arrow({ left: 400, top: 120, right: 1000, bottom: 120 }, caption, { ...laptop, top: 120, bottom: 718 }, [], { edge: "top" });
assert.deepEqual([pt.plan.side, pt.route.end.y], ["below", 120 + TIP_GAP]);
pt = arrow({ left: 400, top: 718, right: 1000, bottom: 718 }, caption, { ...laptop, top: 120, bottom: 718 }, [], { edge: "bottom" });
assert.equal(pt.plan.side, "above");
// What it aims at: the part as seen between the header and the dock; past the band, a sliver at the edge it's past.
const band = { top: 120, bottom: 760, width: 1440 };
assert.deepEqual(aimAt({ left: 400, top: 100, right: 1000, bottom: 300 }, band), { box: { left: 400, top: 120, right: 1000, bottom: 300 }, seen: true });
assert.deepEqual(aimAt({ left: 400, top: -200, right: 1000, bottom: 80 }, band), { box: { left: 400, top: 120, right: 1000, bottom: 120 }, seen: false });
assert.deepEqual(aimAt({ left: 400, top: 900, right: 1000, bottom: 1000 }, band), { box: { left: 400, top: 760, right: 1000, bottom: 760 }, seen: false });

// How long: a caption 4 s at least; a long one outlasts being spoken at the bridge's 200 words a minute; a question
// asked waits longer than it takes to read (read, look, decide, reach); talking over it is before an average reader
// could have read it.
assert.equal(captionMs("Look here."), CAPTION_SHORTEST_MS);
assert.ok(captionMs(Array(70).fill("word").join(" ")) >= (70 / 200) * 60_000 + 1000, "a long caption outlasts its words spoken");
const question = "Quick thing: Maya said Lena is away Saturday. Sunday works?";
assert.ok(askMs(question) > captionMs(question) + 2000, "a question waits for an answer longer than a line is read");
assert.ok(overMs(question) < captionMs(question), "talking over is before a slow reader's time, not after");
assert.equal(captionMs("**Look** here."), captionMs("Look here."), "Markdown isn't read");

// Pages: two lines at most each, whole sentences where they fit, a sentence too long cut at its words, the name's
// room on page one; a bold span cut by a page closes and opens again.
const nine = (run) => run.length * 9; // 9 px a character: 66 to a 600 px line
const fitsTwo = (page, first = 0) => {
  let lines = 1, x = first;
  for (const word of page.replace(/\*\*/g, "").split(" ")) {
    const w = nine(word);
    if (x > first && x + 9 + w > 600) { lines++; x = w; } else x += (x > first ? 9 : 0) + w;
  }
  return lines <= 2;
};
assert.deepEqual(pages("Short and sweet.", 600, nine), ["Short and sweet."]);
const long = "Here's what I'd suggest for the dinner. Sunday at noon works for Lena, since she's back by then. Maya can bring the folding chairs, and Jun has the speaker. If it rains, we move it inside to your place.";
let paged = pages(long, 600, nine, 80);
assert.ok(paged.length >= 2, `a long caption pages (${paged.length})`);
assert.equal(paged.join(" "), long, "every word, once, in order");
assert.ok(paged.every((page, i) => fitsTwo(page, i ? 0 : 80)), `each page two lines at most: ${JSON.stringify(paged)}`);
assert.ok(paged.slice(0, -1).every((page) => /[.!?…]$/.test(page)), "pages end at a sentence's end");
const run = `${Array(40).fill("word").join(" ")} **${Array(30).fill("bold").join(" ")}** end.`;
paged = pages(run, 600, nine);
assert.ok(paged.length >= 2 && paged.every((page) => (page.match(/\*\*/g) ?? []).length % 2 === 0), `a bold span cut by a page closes and opens again: ${JSON.stringify(paged)}`);

// A question's main words: the sender's, else its short question, else a short first sentence.
assert.equal(mainWords("Which Saturday? Lena leaves on the 14th."), "**Which Saturday?** Lena leaves on the 14th.");
assert.equal(mainWords(question), "Quick thing: Maya said Lena is away Saturday. **Sunday works?**");
assert.equal(mainWords("Bring chairs?"), "Bring chairs?");
assert.equal(mainWords("Is **this** the one? Yes."), "Is **this** the one? Yes.");

// The caption's own voice through the mic isn't you talking over it; your words are.
assert.equal(echoOf("quick thing Maya said", question), true);
assert.equal(echoOf("no wait I meant Friday", question), false);
assert.equal(echoOf("so", question), false);
assert.equal(echoOf("", question), false);

// One point at a time; only its sender takes it down; the same words again are a new caption; a point's words take
// the caption's place.
const msg = (kind, target, text, by = "Claude") => ({ type: "guide", kind, target, text, by, at_ms: 1 });
let s = guided(NOTHING, msg("point", "composer", "Type here"), 1);
s = guided(s, msg("point", "mic", ""), 2);
assert.equal(s.point.target, "mic");
assert.equal(guided(s, msg("point", null, "", "Sam"), 3), s, "someone else's clear leaves it");
assert.equal(guided(s, msg("point", null, ""), 4).point, null);
s = guided(guided(s, msg("caption", null, "Hello"), 5), msg("caption", null, "Hello"), 6);
assert.equal(s.caption.n, 6);
assert.equal(s.point.target, "mic", "a caption leaves the point up");
assert.equal(guided(s, msg("point", "composer", "Here"), 7).caption, null, "a point's words take the caption's place");
assert.equal(guided(s, msg("point", "composer", ""), 7).caption.n, 6, "a point without words leaves it");
// Said while you talk or type: held, said at your pause.
s = guided(NOTHING, msg("caption", null, "Mid-sentence"), 8, true);
assert.equal(s.caption, null);
assert.deepEqual(s.held.map((h) => [h.kind, h.state, h.text]), [["line", "waiting", "Mid-sentence"]]);

// Held questions: in the order they came, once each; the sender's "" takes back what it holds.
const hold = (text, target = null, by = "Friend") => msg("hold", target, text, by);
s = guided(NOTHING, hold(question, "point:a4"), 10);
s = guided(s, hold("Bring chairs?"), 11);
s = guided(s, hold(question, "point:a4"), 12);
assert.deepEqual(s.held.map((h) => [h.n, h.kind, h.state]), [[11, "question", "waiting"], [12, "question", "waiting"]], "the same question again is the one held");
assert.equal(guided(s, hold("", null), 13).held.length, 0, "taken back");
assert.equal(guided(s, hold("", null, "Sam"), 13).held.length, 2, "only by its sender");
let many = NOTHING;
for (let i = 0; i < 40; i++) many = guided(many, hold(`Question ${i}?`), 100 + i);
assert.deepEqual([many.held.length, many.held[0].text], [40, "Question 0?"], "every unanswered question stays, including the oldest");
many = guided(many, { ...hold("A line while busy"), kind: "caption" }, 200, true);
many = guided(many, { ...hold("Another line"), kind: "caption" }, 201);
many = talkedOver(many, { rest: "Unread words" });
assert.equal(many.held.length, 42, "busy and talked-over captions also keep every older question");
for (let i = 0; i < 40; i++) {
  const next = nextAsk(many);
  assert.equal(next.text, `Question ${i}?`, "older questions can still be answered in order");
  many = dropped(asked(many, next.n, 300 + i, 0));
}
// Your pause asks the first waiting, unless a caption is up: its caption with the buttons, its arrow; out of the stack.
assert.equal(nextAsk(s).n, 11);
assert.equal(nextAsk({ ...s, caption: { text: "x", by: "Friend", n: 1 } }), null, "not over a caption");
let a = asked(s, 12, 20, 0);
assert.deepEqual([a.caption.n, a.caption.ask.n, a.point.target, a.point.of], [20, 12, "point:a4", 20]);
assert.deepEqual(a.held.map((h) => h.n), [11], "no sentence twice: out of the stack while asked");
// Go ahead: the buttons go, the arrow stays with its caption, and a caption after it takes both.
const ahead = wentAhead(a);
assert.deepEqual([ahead.caption.ask, ahead.point.of], [undefined, 20]);
assert.equal(guided(ahead, msg("caption", null, "Next"), 21).point, null, "its arrow goes with its caption");
// Later: back first in line, waiting for you; Drop it: gone; both take its arrow.
const off = putOff(a);
assert.deepEqual([off.caption, off.point, off.held.map((h) => [h.n, h.state])], [null, null, [[12, "later"], [11, "waiting"]]]);
assert.equal(nextAsk(off).n, 11, "what's put off doesn't ask by itself");
const gone = dropped(a);
assert.deepEqual([gone.caption, gone.point, gone.held.map((h) => h.n)], [null, null, [11]]);
// Talked over: before you could read it, back to the stack as talked over; after, answered and done.
assert.deepEqual(talkedOver(a, { early: true }).held.map((h) => [h.n, h.state]), [[12, "over"], [11, "waiting"]]);
assert.deepEqual(talkedOver(a, { early: false }).held.map((h) => h.n), [11]);
// A caption talked over: what you didn't get to read waits, nothing to answer; with nothing left, nothing.
const said = guided(NOTHING, msg("caption", null, "One. Two. Three."), 30);
assert.deepEqual(talkedOver(said, { rest: "Two. Three." }).held.map((h) => [h.kind, h.state, h.text]), [["line", "over", "Two. Three."]]);
assert.deepEqual(talkedOver(said, { rest: "" }), { ...said, caption: null });
// A held card's Later and Drop it.
assert.equal(heldLater(s, 11).held[0].state, "later");
assert.deepEqual(heldDropped(s, 11).held.map((h) => h.n), [12]);
// One thing at a time: the urgent (the Interrupt level) jump the line; the rest in the order they came; what waits
// for you (put off, talked over) after; nothing dropped.
let queue = guided(guided(NOTHING, hold("First?"), 40), hold("Second?"), 41);
queue = guided(queue, { ...hold("Now, please?"), urgent: true }, 42);
queue = heldLater(queue, 40);
assert.deepEqual(inLine(queue.held).map((h) => h.text), ["Now, please?", "Second?", "First?"]);
assert.equal(nextAsk(queue).text, "Now, please?", "the urgent one comes up first");
assert.equal(asked(queue, 42, 50, 0).caption.ask.urgent, true, "asked as urgent");

// A part not on screen: what reveals it and where it is, by rule; no rule, no arrow.
const T = (id, title, parent_id = null) => ({ id, title, parent_id, status: "open", last_point: "", touched_ms: 0, tags: [], picture: null, dropped_by: "" });
const saidAt = (id, thread_id, placed = true) => ({ id, speaker: "you", text: id, point: id, thread_id, placed, unclear: "", complete: true, at_ms: 0, place_ms: null });
const map = { threads: [T("T1", "Rent"), T("T2", "Garden"), T("T3", "Seedlings", "T2"), T("T4", "Old")], thoughts: [saidAt("a", "T3"), saidAt("p", "T1", false)], merged: { T4: "T1" } };
const at = (over = {}) => ({ map, view: "map", query: "", focus: false, shown: (n) => ["thread:T1", "thread:T2"].includes(n), folded: (id) => id === "T2", ...over });
assert.deepEqual(instead("thread:T3", at()), { via: "thread:T2", line: "“Seedlings” is folded inside “Garden”: Show opens it." });
assert.deepEqual(instead("thread:T3", at({ query: "rent" })), { via: "search", line: "“Seedlings” is hidden by your search: clear it to see it." });
assert.deepEqual(instead("thread:T3", at({ focus: true })), { via: "focus", line: "“Seedlings” is hidden by Focus: turn Focus off to see it." });
assert.deepEqual(instead("thread:T1", at({ view: "palace", shown: () => false })), { via: "view:map", line: "“Rent” is in Cards: switch to Cards here." });
assert.deepEqual(instead("thread:T4", at()), { via: "thread:T1", line: "It's part of “Rent” now." });
assert.deepEqual(instead("thread:T9", at()), { via: null, line: "That topic isn't on this map." });
assert.deepEqual(instead("point:a", at()), { via: "thread:T2", line: "It's in “Seedlings”, folded inside “Garden”: Show opens it." });
assert.deepEqual(instead("point:a", at({ shown: (n) => n === "thread:T3", folded: () => true })), { via: "thread:T3", line: "It's in “Seedlings”: Show opens it." });
assert.deepEqual(instead("point:a", at({ view: "palace", shown: (n) => n === "thread:T3", folded: () => false })), { via: "thread:T3", line: "It's in “Seedlings”: open it here." });
assert.deepEqual(instead("point:p", at()), { via: "pending", line: "It's still finding its place." });
assert.deepEqual(instead("catalog", at()), { via: "apps", line: "The Features button is in Apps: open Apps." });
assert.deepEqual(instead("search", at({ view: "palace" })), { via: "view:map", line: "Search is in Cards: switch to it here." });
assert.deepEqual(instead("undo", at()), { via: null, line: "Undo shows on a notice you can take back, and none is up now." });
assert.deepEqual(instead("nope", at()), { via: null, line: "Nothing called “nope” is on this screen." });
assert.equal(label("point:a", map), "a thought in “Seedlings”");
assert.equal(label("thread:T4", map), "“Rent”");

if (process.argv.includes("--rules-only")) {
  console.log("Guide rules passed, including retaining and answering all 40 queued questions.");
  process.exit(0);
}

// ---- 2. The page.
const why = ready();
if (why) {
  console.log(`SKIP guide-check: ${why}`);
  process.exit(3);
}
const shots = process.env.GUIDE_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

// A map long enough to scroll: Rent open (you're on it), 24 more threads, and a branch whose point is folded away.
const now = Date.now();
const thread = (id, title, parent_id = null) => ({ id, title, parent_id, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "" });
const thought = (id, text, thread_id) => ({ id, speaker: "you", text, point: text, thread_id, placed: true, unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: now, place_ms: 2400, decided: false });
const titles = ["Rent Due Friday", "Garden Plans", "Stats Midterm Thursday", "Trip To Lisbon", "Bike Repair", "Mom's Birthday", "Thesis Outline", "Gym Schedule",
  "Book Club", "Car Insurance", "Dentist Visit", "Podcast Ideas", "Budget For November", "Moving Boxes", "Laptop Battery", "Team Offsite", "Language Practice",
  "Coffee Beans", "Climbing Gym", "Tax Receipts", "Recipe Swap", "Phone Plan", "Library Books", "Winter Jacket", "Concert Tickets"];
const threads = [...titles.map((title, i) => thread(`T${i + 1}`, title)), thread("T2b", "Tomato Seedlings", "T2")];
const thoughts = [
  ...["Rent is due Friday", "The landlord wants it by bank transfer", "Ask about the late fee", "Set a reminder for Thursday night", "Check the lease renewal date"]
    .map((text, i) => thought(`r${i}`, text, "T1")),
  ...titles.slice(1).map((title, i) => thought(`t${i + 2}`, `${title} needs a look this week`, `T${i + 2}`)),
  thought("seed", "Start the tomato seedlings indoors in March", "T2b"),
];
// Claude joined as an AI participant: its name has ✦ and the AI accent; its arrow shares the accent.
const world = { threads, thoughts, active: "T1", active_by: { you: "T1" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], ai: ["Claude"] };
const core = await standInCore(() => [{ type: "snapshot", world }]);
const guide = (kind, target, text, by = "Claude") => core.send({ type: "guide", kind, target, text, by, at_ms: Date.now() });
// Never stuck: a step that runs past STEP_LIMIT_MS fails the check, naming it. The longest step takes about 21 s (it waits
// out a caption's time), the whole check about two minutes with four of them running at once. It watches the steps, not
// the clock: a total time limit blamed the last step for a check that had finished but whose process was slow to end
// (a helper of Chrome held its pipe open, headless.mjs), and a slow machine could fail one that was only slow.
const STEP_LIMIT_MS = 90_000;
let doing = "opening the page";
let stuck = null;
const step = (name) => {
  doing = name;
  clearTimeout(stuck);
  stuck = setTimeout(async () => {
    console.error(`guide-check: stuck at “${doing}” for ${STEP_LIMIT_MS / 1000} seconds`);
    core.close();
    // Its browser too, or it outlives the check (it did once, before this).
    await Promise.race([page?.close(), sleep(4000)]).catch(() => {});
    process.exit(1);
  }, STEP_LIMIT_MS).unref();
};
step("opening the page");

let page = null;
let failed = null;
try {
  page = await openPage(`http://127.0.0.1:${core.port}/?cards`);
  let { evaluate, until } = page;
  const cdp = (...args) => page.page(...args);
  const shot = async (name) => {
    if (!shots) return;
    const { data } = await cdp("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(shots, `${name}.png`), Buffer.from(data, "base64"));
  };
  // No tour: this browser has seen it. Reloaded by the browser, not the page: a reload inside an evaluate can lose its
  // answer with the page it ran in, and the check waited forever (1 run in 5).
  const toured = async () => {
    await until(`document.readyState === "complete"`);
    await evaluate(`localStorage.setItem("e2a2o.toured", "1")`);
    await cdp("Page.reload", {});
  };
  await toured();
  assert.ok(await until(`!!document.querySelector('[data-guide="thread:T25"]') && !document.querySelector(".tour-tip")`, 8000), "the map shows");
  await sleep(600);

  const q = (name) => JSON.stringify(`[data-guide="${name}"]`);
  // The part as seen: under the header (and the map's tools, for what comes after them) and above the dock, unless it
  // floats over the page.
  const seen = (name) => evaluate(`(() => {
    const el = document.querySelector(${q(name)}); if (!el) return null;
    const r = el.getBoundingClientRect(), edge = (s, side) => document.querySelector(s)?.getBoundingClientRect()[side];
    const floating = !!el.closest("header, .map-tools, .notice-lane, .dock, dialog");
    const tools = document.querySelector(".map-tools"), under = tools && tools.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
    const top = floating ? 0 : Math.max(0, edge("header", "bottom") ?? 0, under ? edge(".map-tools", "bottom") ?? 0 : 0);
    const bottom = floating ? innerHeight : Math.min(innerHeight, edge(".dock", "top") ?? Infinity, edge(".guide-caption", "top") ?? Infinity);
    return { left: r.left, right: r.right, top: Math.max(r.top, top), bottom: Math.min(r.bottom, bottom), whole: r.top >= top && r.bottom <= bottom };
  })()`);
  // The arrow: where its head is and the side it comes in from, and where its line starts.
  const tip = () => evaluate(`(() => {
    const head = document.querySelector(".guide-arrow-head"), line = document.querySelector(".guide-arrow-line");
    const m = head?.getAttribute("transform")?.match(/translate\\(([-\\d.]+) ([-\\d.]+)\\)/), s = line?.getAttribute("d")?.match(/^M ([-\\d.]+) ([-\\d.]+)/);
    return m && s && { x: +m[1], y: +m[2], side: head.dataset.side, from: { x: +s[1], y: +s[2] } };
  })()`);
  const layer = () => evaluate(`document.querySelector(".guide-layer")?.dataset.state ?? null`);
  const words = () => evaluate(`document.querySelector(".guide-caption")?.innerText.replace(/\\s+/g, " ").trim() ?? null`);
  const box = (selector) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r && { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })()`);
  const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const inside = (a, w, h, gutter = GUTTER) => a.left >= gutter - 0.5 && a.top >= gutter - 0.5 && a.right <= w - gutter + 0.5 && a.bottom <= h - gutter + 0.5;
  /** The arrowhead touches the part's facing edge (TIP_GAP out), within its span, and the arrow is a short one at the part
   *  (its run, a little over for the tail's sway), not a line out from the caption. */
  const lands = async (name, why) => {
    const [part, t] = [await seen(name), await tip()];
    assert.ok(part && t, `${why}: an arrow and its part (${JSON.stringify({ part, t })})`);
    const near = (a, b) => Math.abs(a - b) <= 1.5;
    const ok = t.side === "above" ? near(t.y, part.top - TIP_GAP) && t.x >= part.left && t.x <= part.right
      : t.side === "below" ? near(t.y, part.bottom + TIP_GAP) && t.x >= part.left && t.x <= part.right
      : t.side === "left" ? near(t.x, part.left - TIP_GAP) && t.y >= part.top && t.y <= part.bottom
      : near(t.x, part.right + TIP_GAP) && t.y >= part.top && t.y <= part.bottom;
    assert.ok(ok, `${why}: the arrow lands on ${name} (tip ${JSON.stringify(t)}, part ${JSON.stringify(part)})`);
    const run = Math.hypot(t.from.x - t.x, t.from.y - t.y);
    assert.ok(run >= RUNS.at(-1) - 1 && run <= RUNS[0] * 1.1, `${why}: a short arrow at the part, not a line out from the caption (${run.toFixed(0)} px)`);
    return { part, t };
  };
  /** The ring round the part, RING_PAD out. */
  const ringed = async (name) => {
    const [part, ring] = [await seen(name), await box(".guide-ring")];
    return !!part && !!ring && Math.abs(ring.left - (part.left - RING_PAD)) <= 1 && Math.abs(ring.bottom - (part.bottom + RING_PAD)) <= 1;
  };
  /** Bottom center, just above where you type (today's dock: above its column), whole on screen, off the composer. */
  const atStage = async (w = 1440, h = 900) => {
    const [cap, composer, column] = [await box(".guide-caption"), await box('[data-guide="composer"]'), await box(".dock-inner")];
    const center = (b) => (b.left + b.right) / 2;
    const ok = Math.abs(center(cap) - center(composer)) <= 1.5 && cap.bottom <= Math.min(composer.top, column?.top ?? Infinity) - 4 && !overlap(cap, composer) && inside(cap, w, h);
    return ok || JSON.stringify({ cap, composer, column });
  };
  /** A color as the page computes it (a token, say), to compare with an element's. */
  const colorOf = (value) => evaluate(`(() => { const p = document.createElement("i"); p.style.color = ${JSON.stringify(value)}; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; })()`);
  const click = async (selector) => {
    const r = await box(selector);
    assert.ok(r, `${selector} to click`);
    const [x, y] = [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
    for (const type of ["mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  };
  const key = async (name, code, text) => {
    for (const type of ["keyDown", "keyUp"]) await cdp("Input.dispatchKeyEvent", { type, key: name, code: name, windowsVirtualKeyCode: code, ...(text && type === "keyDown" ? { text } : {}) });
  };
  // Every caption's life, from the page: when it showed and when it went.
  await evaluate(`window.__captions = []; new MutationObserver(() => {
    const el = document.querySelector(".guide-caption"), last = window.__captions.at(-1);
    if (el && (!last || last.el !== el)) { if (last && !last.gone) last.gone = performance.now(); window.__captions.push({ el, text: el.innerText, at: performance.now(), gone: 0 }); }
    if (!el && last && !last.gone) last.gone = performance.now();
  }).observe(document.body, { childList: true })`);

  step("a caption");
  // A caption: bottom center above where you type, its name first (✦: Claude joined as an AI), up for its time.
  const line = "Do you see the arrow? That's where you type.";
  guide("caption", null, line);
  assert.ok(await until(`!!document.querySelector(".guide-caption")`, 2000), "a caption shows");
  await sleep(250);
  assert.match(await words(), /^✦ Claude Do you see the arrow\?/);
  assert.equal(await atStage(), true, "bottom center, above the dock");
  assert.equal(await evaluate(`getComputedStyle(document.querySelector(".guide-caption .guide-by")).color`), await colorOf("var(--ai)"), "an AI's name uses its accent");
  await shot("0-caption");
  assert.ok(await until(`!document.querySelector(".guide-caption")`, captionMs(line) + 1500), "then it goes");
  const first = await evaluate(`window.__captions.map((c) => ({ text: c.text, ms: c.gone - c.at }))[0]`);
  assert.ok(first.ms >= captionMs(line) - 50 && first.ms <= captionMs(line) + 900, `the caption was up ${Math.round(first.ms)} ms, its time ${captionMs(line)}`);

  step("Markdown and pages");
  // Markdown as the map shows it: bold and code, never their marks. Two lines at a time, page by page.
  guide("caption", null, "Your **rent** is due `Friday`.");
  assert.ok(await until(`!!document.querySelector(".guide-caption strong")`, 2000), "bold shows as bold");
  assert.deepEqual(await evaluate(`[document.querySelector(".guide-caption strong").textContent, document.querySelector(".guide-caption code").textContent, /[*\`]/.test(document.querySelector(".guide-caption").innerText)]`), ["rent", "Friday", false]);
  const story = "Here's what I'd suggest for the dinner. Sunday at noon works for Lena, since she's back by then. Maya can bring the folding chairs, and Jun has the speaker. If it rains, we move it inside to your place, and we keep the playlist going.";
  guide("caption", null, story);
  assert.ok(await until(`document.querySelector(".guide-caption")?.innerText.includes("Here's what")`, 2000));
  await sleep(300);
  const shown = await evaluate(`(() => { const t = document.querySelector(".guide-caption .guide-line"), lh = parseFloat(getComputedStyle(t.parentElement).lineHeight);
    return { lines: Math.round(t.getBoundingClientRect().height / lh), text: t.innerText.replace(/\\s+/g, " ") }; })()`);
  assert.ok(shown.lines <= 2 && !shown.text.includes("playlist"), `two lines at a time: ${JSON.stringify(shown)}`);
  await shot("1-caption-paged");
  assert.ok(await until(`document.querySelector(".guide-caption")?.innerText.includes("playlist")`, 3 * captionMs(story) / 2), "the next page follows once read");
  await evaluate(`document.querySelector(".guide-caption")?.dispatchEvent(new PointerEvent("pointerleave"))`);

  step("a point at the composer");
  // The composer, right under the caption: its ring and no arrow (the caption is at it), in the top layer.
  guide("point", "composer", "Type your answer here.");
  assert.ok(await until(`["near", "aimed"].includes(document.querySelector(".guide-layer")?.dataset.state)`, 2000), "a point lands");
  await sleep(300);
  assert.equal(await words(), "✦ Claude Type your answer here.", "its words take the caption's place");
  assert.equal(await layer(), "near", "no arrow: the caption is at it already");
  assert.ok(await ringed("composer"), "its ring");
  assert.ok(await evaluate(`document.querySelector(".guide-layer").matches(":popover-open")`), "in the top layer");
  assert.equal(await atStage(), true, "the caption stays at the stage");
  await shot("2-point-composer");

  step("Esc");
  await key("Escape", 27);
  assert.ok(await until(`!document.querySelector(".guide-layer") && !document.querySelector(".guide-caption")`, 1000), "Esc takes the point down, and its words");

  step("a far thread");
  // A thread far down the map: scrolled into view between the header and the dock, the arrow from the caption on it.
  const far = "thread:T25";
  assert.equal((await seen(far)).whole, false, "the far thread starts out of view");
  guide("point", far, "Your concert tickets are here.");
  assert.ok(await until(`(() => { const r = document.querySelector('[data-guide="${far}"]').getBoundingClientRect(); return r.top > 100 && r.bottom < innerHeight - 120; })()`, 3000), "scrolled into view");
  await sleep(900);
  assert.ok((await seen(far)).whole, "whole between the header and the dock");
  await lands(far, "a far thread");
  assert.ok(await ringed(far), "the thread ringed");
  assert.equal(await evaluate(`getComputedStyle(document.querySelector(".guide-arrow-line")).stroke`), await colorOf("var(--ai)"), "an AI's arrow uses its accent");
  await shot("3-point-thread");
  step("following");
  // It follows the part: the page scrolls (up: the far card is at the page's end), then the window narrows and the
  // cards reflow.
  const before = (await tip()).y;
  await evaluate(`scrollBy({ top: -60, behavior: "instant" })`);
  for (let frame = 0; frame < 60 && (await tip()).y <= before + 20; frame++) await sleep(50);
  assert.ok((await tip()).y > before + 20, `the arrow moves with the page (${before} → ${(await tip()).y})`);
  await lands(far, "scrolled toward the caption, what's left above it");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(1200);
  await lands(far, "after the cards reflow");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(800);

  step("a click elsewhere");
  await click(".brand");
  assert.ok(await until(`!document.querySelector(".guide-layer")`, 1000), "a click elsewhere takes the point down");

  step("a folded thought");
  // A thought in a folded card: the arrow on its card, the caption saying Show opens it; Show is the way, so the point
  // stays and moves on to the thought itself.
  guide("point", "point:seed", "This is the seedling idea.");
  assert.ok(await until(`document.querySelector(".guide-layer")?.dataset.state === "aimed"`, 2000));
  await sleep(700);
  await lands("thread:T2b", "the card a folded thought is in");
  assert.equal(await words(), "✦ Claude This is the seedling idea. It's in “Tomato Seedlings”: Show opens it.");
  await shot("4-point-folded");
  await click('[data-guide="thread:T2b"] .thread-toggle');
  assert.ok(await until(`!!document.querySelector('[data-guide="point:seed"]') && document.querySelector(".guide-caption")?.innerText.indexOf("Show opens it") < 0`, 2000), "Show leads the arrow on");
  await sleep(700);
  await lands("point:seed", "the thought, once its card opens");
  assert.equal(await words(), "✦ Claude This is the seedling idea.");

  step("Pictures");
  // In the Palace: a thread is its picture; search is on the Map, said so, and the Map button leads there.
  await key("Escape", 27);
  await click('[data-guide="view:palace"]');
  assert.ok(await until(`!!document.querySelector('[data-guide="palace"]')`, 2000), "the Palace opens");
  await sleep(500);
  guide("point", "thread:T3", "Your midterm.");
  assert.ok(await until(`document.querySelector(".guide-layer")?.dataset.state === "aimed"`, 2000));
  await sleep(600);
  await lands("thread:T3", "a thread's picture in the Palace");
  guide("point", "search", "Search finds the words you used.");
  await sleep(700);
  await lands("view:map", "the way to search");
  assert.equal(await words(), "✦ Claude Search finds the words you used. Search is in Cards: switch to it here.");
  await shot("5-point-other-view");
  await click('[data-guide="view:map"]');
  assert.ok(await until(`document.querySelector(".guide-caption")?.innerText.indexOf("switch") < 0`, 2000), "the Map button leads the arrow on");
  await sleep(600);
  await lands("search", "search, once on the Map");

  step("the Features button in Apps");
  // The Catalog button is in Apps: the arrow on Apps, and opening Apps leads it on to the button.
  await key("Escape", 27);
  await evaluate(`scrollTo({ top: 0, behavior: "instant" })`);
  if (await evaluate(`document.querySelector(".apps-title").getAttribute("aria-expanded") === "true"`)) await click(".apps-title");
  assert.ok(await until(`!document.querySelector('[data-guide="catalog"]')`, 1000), "Apps closed");
  guide("point", "catalog", "More views live in Features.");
  assert.ok(await until(`document.querySelector(".guide-layer")?.dataset.state === "aimed"`, 2000), "the arrow is on Apps, seen");
  await sleep(600);
  await lands("apps", "the Apps panel the Catalog is in");
  assert.equal(await words(), "✦ Claude More views live in Features. The Features button is in Apps: open Apps.");
  await click(".apps-title");
  assert.ok(await until(`!!document.querySelector('[data-guide="catalog"]') && document.querySelector(".guide-caption")?.innerText.indexOf("open Apps") < 0`, 2000), "opening Apps leads the arrow on");
  await sleep(800);
  await lands("catalog", "the Catalog button");
  await key("Escape", 27);

  step("a part that's nowhere");
  // A part that's nowhere: no arrow, said where; someone else's clear leaves it, the sender's takes it down.
  guide("point", "nope", "Look at this.");
  assert.ok(await until(`document.querySelector(".guide-layer")?.dataset.state === "alone"`, 2000), "no arrow for a name not on screen");
  assert.equal(await words(), "✦ Claude Look at this. Nothing called “nope” is on this screen.");
  assert.equal(await atStage(), true, "said at the stage, whole on screen");
  guide("point", null, "", "Sam");
  await sleep(300);
  assert.equal(await layer(), "alone", "someone else's clear leaves it");
  guide("point", null, "");
  assert.ok(await until(`!document.querySelector(".guide-layer")`, 1000), "the sender's clear takes it down");

  // A pixel as drawn, from a 1 × 1 screenshot: hit tests can't say what's on top (the arrow's layer takes no pointer,
  // and an open sheet makes the page around it unclickable, a caption over it too).
  const pixel = async (x, y) => {
    const [left, top] = await evaluate(`[scrollX, scrollY]`);
    const { data } = await cdp("Page.captureScreenshot", { format: "png", clip: { x: x + left, y: y + top, width: 1, height: 1, scale: 1 } });
    const png = Buffer.from(data, "base64"), idat = [];
    for (let at = 8; at < png.length;) {
      const n = png.readUInt32BE(at), type = png.toString("ascii", at + 4, at + 8);
      if (type === "IDAT") idat.push(png.subarray(at + 8, at + 8 + n));
      at += 12 + n;
    }
    const [, r, g, b] = inflateSync(Buffer.concat(idat));
    return [r, g, b];
  };
  /** The caption's own plate in its right padding, mid-height: nothing is drawn over it. */
  const onTop = async (selector) => {
    const r = await box(selector);
    const rgb = await pixel(Math.floor(r.right - 5), Math.floor((r.top + r.bottom) / 2));
    const plate = await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backgroundColor`);
    const expected = plate.match(/[\d.]+/g).slice(0, 3).map(Number);
    return rgb.every((value, i) => Math.abs(value - expected[i]) <= 1) || `${rgb}, expected ${plate}, in ${JSON.stringify(r)}`;
  };

  step("over an open sheet");
  await click('[data-guide="recap"]');
  assert.ok(await until(`!!document.querySelector("dialog.recap-sheet[open]")`, 2000), "Recap opens");
  guide("caption", null, "I'll wait while you read your recap.");
  assert.ok(await until(`document.querySelector(".guide-caption")?.innerText.includes("I'll wait")`, 2000));
  await sleep(250);
  assert.equal(await onTop(".guide-caption"), true, "the caption is over the open sheet, not under its shade");
  await shot("6-caption-over-sheet");
  await key("Escape", 27);
  assert.ok(await until(`!document.querySelector("dialog.recap-sheet[open]")`, 2000), "Recap closes");

  step("holding a caption");
  // The pointer on a caption holds it past its time; off it, it goes.
  guide("caption", null, "Hold me.");
  assert.ok(await until(`document.querySelector(".guide-caption")?.innerText.includes("Hold me.")`, 2000), "the next caption replaces the last");
  await sleep(100);
  const held = await box(".guide-caption");
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: (held.left + held.right) / 2, y: (held.top + held.bottom) / 2 });
  await sleep(captionMs("Hold me.") + 700);
  assert.ok(await evaluate(`!!document.querySelector(".guide-caption") && !document.querySelector(".guide-caption[data-leaving]")`), "held while the pointer is on it");
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 720, y: 300 });
  assert.ok(await until(`!document.querySelector(".guide-caption")`, 1500 + 1500), "off it, it goes");

  step("a hidden page");
  // Nor does its time run while the page is hidden (you're in another window): it's there when you come back.
  const hide = (hidden) => evaluate(`Object.defineProperty(document, "hidden", { configurable: true, get: () => ${hidden} }), document.dispatchEvent(new Event("visibilitychange"))`);
  guide("caption", null, "Said while you were in another window.");
  assert.ok(await until(`document.querySelector(".guide-caption")?.innerText.includes("another window")`, 2000));
  await hide(true);
  await sleep(captionMs("Said while you were in another window.") + 700);
  assert.ok(await evaluate(`!!document.querySelector(".guide-caption") && !document.querySelector(".guide-caption[data-leaving]")`), "kept while the page is hidden");
  await hide(false);
  await sleep(1000);
  assert.ok(await evaluate(`!!document.querySelector(".guide-caption")`), "back on the page, its time starts then");
  assert.ok(await until(`!document.querySelector(".guide-caption")`, captionMs("Said while you were in another window.") + 1000), "then it goes");
  await evaluate(`delete document.hidden`);

  // ---- Your words: the mic on (a stand-in microphone, a tone through a real stream, and a real tap), as bricks-check
  // starts it, so the core's words reach this tab.
  step("the mic");
  await evaluate(`navigator.mediaDevices.getUserMedia = async () => { const ctx = new AudioContext(); const tone = ctx.createOscillator();
    const out = ctx.createMediaStreamDestination(); tone.connect(out); tone.start(); return out.stream; }`);
  await click('[data-guide="mic"]');
  assert.ok(await until(`document.querySelector('[data-guide="mic"]')?.getAttribute("aria-pressed") === "true"`, 5000), "the mic starts");
  const say = (text) => core.send({ type: "partial", text });
  /** Quiet for a natural pause: what the Friend holds may be said now. */
  const pause = async () => { say(""); await sleep(NATURAL_PAUSE_MS + 200); };

  step("talked over");
  // Your words while a caption is up: it steps back at once, and the line you didn't get to read waits, talked over.
  const remark = "The rent card is the one at the top left.";
  guide("caption", null, remark);
  assert.ok(await until(`document.querySelector(".guide-caption")?.innerText.includes("rent card")`, 2000));
  await sleep(200);
  const spoke = Date.now();
  say("so anyway the");
  assert.ok(await until(`!document.querySelector(".guide-caption")`, 600), "it steps back at once");
  assert.ok(Date.now() - spoke < 700, `within a press of your first words (${Date.now() - spoke} ms)`);
  assert.ok(await until(`[...document.querySelectorAll(".guide-held-card")].some((c) => c.innerText.includes("rent card") && c.innerText.includes("Talked over"))`, 1000), "what you didn't read waits in the held stack");
  await shot("7-talked-over");
  // Continue says it again, as a caption.
  await pause();
  await evaluate(`[...document.querySelectorAll(".guide-held-card")].find((c) => c.innerText.includes("rent card")).querySelector("button").click()`);
  assert.ok(await until(`document.querySelector(".guide-caption")?.innerText.includes("rent card") && !document.querySelector(".guide-held-card")`, 1500), "Continue says it, out of the stack");
  await key("Escape", 27);
  await evaluate(`document.querySelector(".guide-caption") && document.querySelector(".guide-caption").dispatchEvent(new PointerEvent("pointerleave"))`);

  step("its own voice");
  // The caption's own words coming back through the mic aren't you talking over it.
  await until(`!document.querySelector(".guide-caption")`, captionMs(remark) + 2000);
  const echo = "Look at the garden card, two rows down.";
  guide("caption", null, echo);
  assert.ok(await until(`document.querySelector(".guide-caption")?.innerText.includes("garden card")`, 2000));
  say("look at the garden card");
  await sleep(500);
  assert.ok(await evaluate(`!!document.querySelector(".guide-caption") && !document.querySelector(".guide-caption[data-leaving]")`), "its own voice doesn't step it back");
  say("no I meant the rent one");
  assert.ok(await until(`!document.querySelector(".guide-caption")`, 600), "yours does");

  step("a held question waits for your pause");
  // While you talk, a question waits in the held stack (main words bold); a caption said then waits too. At your pause
  // (NATURAL_PAUSE_MS without words) the question is asked: its caption at the stage, ink buttons with keys, an arrow
  // at what it's about; out of the stack.
  await evaluate(`document.querySelectorAll(".guide-held-card button:last-child").forEach((b) => b.click())`);
  say("and then on Friday we could");
  const ask = "Quick thing: you said Friday. Rent is due Friday?";
  guide("hold", "thread:T1", ask);
  guide("caption", null, "Said while you talk.");
  assert.ok(await until(`[...document.querySelectorAll(".guide-held-card")].some((c) => c.innerText.includes("Quick thing") && c.innerText.includes("asks when you stop"))`, 1500), "held while you talk");
  assert.equal(await evaluate(`document.querySelector(".guide-held-card strong")?.textContent`), "Rent is due Friday?", "its main words bold");
  assert.equal(await evaluate(`!!document.querySelector(".guide-caption")`), false, "nothing said over you");
  // One thing at a time: the next in line shows, the rest are a count that opens them.
  assert.equal(await evaluate(`document.querySelectorAll(".guide-held-card").length`), 1, "one card at a time");
  assert.equal(await evaluate(`document.querySelector(".guide-held-more")?.innerText.replace(/\s+/g, " ")`), "1 more held", "the rest a count");
  await click(".guide-held-more");
  assert.ok(await until(`[...document.querySelectorAll(".guide-held-card")].some((c) => c.innerText.includes("Said while you talk") && c.innerText.includes("says when you stop"))`, 1000), "a caption said while you talk waits too, behind the count");
  await click(".guide-held-more");
  // Urgent (the Interrupt level): it jumps the line, shown and asked first.
  core.send({ type: "guide", kind: "hold", target: null, text: "The landlord's deadline is today?", by: "Claude", at_ms: Date.now(), urgent: true });
  assert.ok(await until(`document.querySelectorAll(".guide-held-card").length === 1 && document.querySelector(".guide-held-card").innerText.includes("Interrupt") && document.querySelector(".guide-held-card").innerText.includes("deadline")`, 1500), "the urgent one is next in line");
  assert.equal(await evaluate(`document.querySelector(".guide-held-more")?.innerText.replace(/\s+/g, " ")`), "2 more held", "nothing dropped");
  const stack = await box(".guide-held");
  assert.ok(inside(stack, 1440, 900) && stack.right >= 1440 - GUTTER - 1, `bottom right, whole on screen (${JSON.stringify(stack)})`);
  assert.ok(!overlap(stack, await box('[data-guide="composer"]')), "clear of the composer");
  await shot("8-held-while-talking");
  await sleep(NATURAL_PAUSE_MS + 400);
  assert.equal(await evaluate(`!!document.querySelector(".guide-caption")`), false, "your words keep it waiting, however long the turn");
  say("");
  const quiet = Date.now();
  assert.ok(await until(`!!document.querySelector(".guide-caption[data-asking]")`, NATURAL_PAUSE_MS + 1500), "asked at your pause");
  assert.ok(Date.now() - quiet >= NATURAL_PAUSE_MS - 150, `not before a natural pause (${Date.now() - quiet} ms)`);
  assert.match(await words(), /^✦ Claude · Interrupt The landlord's deadline is today\?/, "the urgent one first, marked");
  await shot("9a-asked-urgent");
  await key("Escape", 27);
  // Then, a beat later, the next in line.
  assert.ok(await until(`document.querySelector(".guide-caption[data-asking]")?.innerText.includes("Quick thing")`, NATURAL_PAUSE_MS + 1500), "one per pause: the next comes up after a beat");
  assert.match(await words(), /^✦ Claude Quick thing: you said Friday\. Rent is due Friday\? Go ahead ↵ Later L Drop it esc or talk over me to stop$/);
  assert.equal(await atStage(), true, "at the stage");
  assert.equal(await evaluate(`[...document.querySelectorAll(".guide-held-card")].some((c) => c.innerText.includes("Quick thing"))`), false, "no sentence twice: out of the stack");
  await until(`document.querySelector(".guide-layer")?.dataset.state === "aimed"`, 2000);
  await sleep(600);
  await lands("thread:T1", "a question's evidence");
  const ink = await evaluate(`(() => { const b = getComputedStyle(document.querySelector(".guide-btn.guide-primary")), p = document.createElement("i"); document.body.append(p);
    const color = (v) => { p.style.color = v; return getComputedStyle(p).color; }; const out = [b.backgroundColor, color("var(--ink)"), color("var(--ai)")]; p.remove(); return out; })()`);
  assert.ok(ink[0] === ink[1] && ink[0] !== ink[2], `Go ahead uses the primary ink (${ink})`);
  await shot("9-asked");
  // Go ahead (↵ from the page): its buttons go, it stays with its arrow its reading time.
  await evaluate(`document.activeElement?.blur()`);
  await key("Enter", 13, "\r");
  assert.ok(await until(`!document.querySelector(".guide-caption[data-asking]") && !!document.querySelector(".guide-caption")`, 1000), "↵ goes ahead");
  assert.equal(await layer(), "aimed", "its arrow stays with it");
  await key("Escape", 27);
  assert.ok(await until(`!document.querySelector(".guide-caption") && !document.querySelector(".guide-layer")`, 1000), "Esc takes it and its arrow down");

  step("Later, Drop it, talked over");
  // The caption said while you talked comes next at the same pause, once the question is done.
  assert.ok(await until(`document.querySelector(".guide-caption")?.innerText.includes("Said while you talk")`, NATURAL_PAUSE_MS + 1500), "the line said while you talked, at the pause");
  await key("Escape", 27);
  await evaluate(`document.querySelector(".guide-caption")?.dispatchEvent(new PointerEvent("pointerleave"))`);
  await until(`!document.querySelector(".guide-caption")`, captionMs("Said while you talk.") + 1500);
  // Later (L): back to the stack, waiting for you; Answer asks it again; Drop it (esc): gone.
  guide("hold", null, "Should I add the lease date to your calendar?");
  assert.ok(await until(`!!document.querySelector(".guide-caption[data-asking]")`, NATURAL_PAUSE_MS + 1500), "asked (you're quiet)");
  await key("l", 76, "l");
  assert.ok(await until(`!document.querySelector(".guide-caption") && [...document.querySelectorAll(".guide-held-card")].some((c) => c.innerText.includes("lease date") && c.innerText.includes("Later"))`, 1000), "L puts it off, back in the stack");
  await sleep(NATURAL_PAUSE_MS + 400);
  assert.equal(await evaluate(`!!document.querySelector(".guide-caption")`), false, "put off, it doesn't ask by itself");
  await evaluate(`[...document.querySelectorAll(".guide-held-card")].find((c) => c.innerText.includes("lease date")).querySelector("button").click()`);
  assert.ok(await until(`!!document.querySelector(".guide-caption[data-asking]")`, 1000), "Answer asks it now");
  await key("Escape", 27);
  assert.ok(await until(`!document.querySelector(".guide-caption") && !document.querySelector(".guide-held-card")`, 1000), "esc drops it");
  // Talked over before you could read it: back in the stack, marked so.
  guide("hold", null, "One more: is the late fee still ten dollars?");
  assert.ok(await until(`!!document.querySelector(".guide-caption[data-asking]")`, NATURAL_PAUSE_MS + 1500));
  say("yes and");
  assert.ok(await until(`!document.querySelector(".guide-caption") && [...document.querySelectorAll(".guide-held-card")].some((c) => c.innerText.includes("late fee") && c.innerText.includes("Talked over"))`, 1000), "talked over at once: back in the stack");
  // Typing is talking too: nothing is asked while the box holds a half-typed thought.
  await evaluate(`document.querySelectorAll(".guide-held-card button:last-child").forEach((b) => b.click())`);
  say("");
  await click('[data-guide="composer"] textarea');
  for (const ch of "half a tho") await key(ch, ch.toUpperCase().charCodeAt(0), ch);
  guide("hold", null, "Is this about rent?");
  await sleep(NATURAL_PAUSE_MS + 800);
  assert.equal(await evaluate(`!!document.querySelector(".guide-caption")`), false, "not asked over a half-typed thought");
  await evaluate(`(() => { const t = document.querySelector('[data-guide="composer"] textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    set.call(t, ""); t.dispatchEvent(new Event("input", { bubbles: true })); t.blur(); })()`);
  assert.ok(await until(`!!document.querySelector(".guide-caption[data-asking]")`, NATURAL_PAUSE_MS + 3500), "asked once the box is empty and you've paused");
  await key("Escape", 27);
  await click('[data-guide="mic"]');
  await until(`document.querySelector('[data-guide="mic"]')?.getAttribute("aria-pressed") !== "true"`, 3000);

  step("a view brick");
  // Canvas exposes the same thread target contract as the Cards view.
  await click('[data-guide="view:spine"]');
  assert.ok(await until(`!!document.querySelector('.spine-frame.spine-ready .spine-head[data-thread="T1"]')`, 8000), "Canvas is ready");
  await sleep(800);
  guide("point", "thread:T1", "Your rent is this topic.");
  assert.ok(await until(`document.querySelector(".guide-layer")?.dataset.state === "aimed"`, 2000), "the arrow is on the Canvas topic");
  await sleep(600);
  const canvasTopic = await box('.spine-head[data-thread="T1"]');
  const at3 = await tip();
  assert.ok(Math.min(Math.abs(at3.y - (canvasTopic.top - TIP_GAP)), Math.abs(at3.y - (canvasTopic.bottom + TIP_GAP)), Math.abs(at3.x - (canvasTopic.left - TIP_GAP)), Math.abs(at3.x - (canvasTopic.right + TIP_GAP))) <= 1.5,
    `the arrow lands on the Canvas topic (${JSON.stringify({ at3, canvasTopic })})`);
  assert.equal(await words(), "✦ Claude Your rent is this topic.");
  await shot("5b-point-canvas");
  await key("Escape", 27);
  await click('[data-guide="view:map"]');
  assert.ok(await until(`!!document.querySelector('[data-guide="thread:T1"]') && !document.querySelector('.spine-frame')`, 8000), "back to Cards");
  await sleep(600);

  step("Reduce Motion");
  // Reduce Motion: the far thread comes into view at once, and the arrow isn't drawn out: it's there.
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }, { name: "prefers-color-scheme", value: "light" }] });
  await evaluate(`scrollTo({ top: 0, behavior: "instant" })`);
  await sleep(300);
  guide("point", far, "At once.");
  await sleep(150);
  assert.ok((await seen(far)).whole, "in view at once, no smooth scroll");
  assert.equal(await evaluate(`getComputedStyle(document.querySelector(".guide-arrow-line")).animationName`), "none", "no drawing out");
  await lands(far, "under Reduce Motion");
  await key("Escape", 27);

  step("dark");
  // Dark: a question asked with its arrow, for the eye (no assertion past landing).
  if (shots) {
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }, { name: "prefers-color-scheme", value: "dark" }] });
    guide("hold", "thread:T1", "Rent is the one you're on. **Pay it Thursday?**");
    await until(`!!document.querySelector(".guide-caption[data-asking]")`, NATURAL_PAUSE_MS + 2000);
    await sleep(900);
    await shot("10-dark");
    await key("Escape", 27);
  }
  await page.close();
  page = null;

  step("a phone");
  // A phone: the caption a card the screen's width over the dock, the point's arrow from it; the held stack a chip.
  page = await openPage(`http://127.0.0.1:${core.port}/?cards`, { width: 390, height: 844 });
  ({ evaluate, until } = page);
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await toured();
  assert.ok(await until(`!!document.querySelector('[data-guide="thread:T1"]')`, 8000));
  await sleep(600);
  guide("point", "thread:T1", "Tap here to open your rent.");
  assert.ok(await until(`["aimed", "near"].includes(document.querySelector(".guide-layer")?.dataset.state) && !!document.querySelector(".guide-caption")`, 2000));
  await sleep(500);
  const card = await box(".guide-caption");
  assert.ok(inside(card, 390, 844) && card.right - card.left >= 390 - 2 * GUTTER - 1, `the caption is the screen's width, whole (${JSON.stringify(card)})`);
  assert.ok(!overlap(card, await box('[data-guide="composer"]')), "off the composer");
  if (await layer() === "aimed") await lands("thread:T1", "a thread on a phone");
  guide("hold", null, "Want me to set a reminder for Thursday?");
  core.send({ type: "partial", text: "" });
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, "no sideways scroll");
  await shot("11-phone");
  await page.close();
  page = null;

  // The shell owns the space between its notice and composer, even while the caption is in the top layer.
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    step(`shell captions at ${width}`);
    page = await openPage(`http://127.0.0.1:${core.port}/?shell=2`, { width, height });
    ({ evaluate, until } = page);
    await toured();
    assert.ok(await until(`!!document.querySelector('#shell-caption') && !!document.querySelector('[data-guide="search"]')`, 8000), "the shell opens");
    await evaluate(`document.fonts.ready.then(() => true)`);
    const emptySlot = `document.querySelector('#shell-caption').getBoundingClientRect().height === 0`;
    assert.ok(await until(emptySlot, 1000), "an empty caption slot takes no space");
    for (const scheme of ["light", "dark"]) {
      step(`shell captions at ${width}, ${scheme}`);
      await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
      core.send({ type: "notice", message: "Your map is saved." });
      guide("point", "search", "");
      guide("caption", null, "Find a topic here. Your **rent** is still on the map. Keep your plans together.");
      assert.ok(await until(`document.querySelectorAll('#shell-caption .guide-caption').length === 1 && ['aimed', 'near'].includes(document.querySelector('.guide-layer')?.dataset.state)`, 2000), "one caption is portaled into the shell");
      await sleep(250);
      const checkSlot = async () => {
        const [cap, slot, composer, notice] = await Promise.all([box(".guide-caption"), box("#shell-caption"), box('[data-guide="composer"]'), box('[data-guide="notice"]')]);
        assert.equal(await evaluate(`document.querySelectorAll('.guide-caption').length`), 1, "exactly one caption on the page");
        assert.ok(slot.bottom > slot.top && Math.abs((slot.bottom - slot.top) - (cap.bottom - cap.top)) <= 1, "the slot reserves the rendered caption height");
        assert.ok(inside(cap, width, height), `the shell caption stays inside the viewport (${JSON.stringify(cap)})`);
        assert.ok(!overlap(cap, composer) && !overlap(cap, notice) && notice.bottom <= cap.top && cap.bottom <= composer.top, "between notice and composer without overlap");
        assert.ok(Math.abs(cap.top - slot.top) <= 1 && Math.abs(cap.bottom - slot.bottom) <= 1, "the visible caption follows its reserved box");
        assert.ok(await evaluate(`(() => { const line = document.querySelector('.guide-line'); return line.getBoundingClientRect().height <= 2 * parseFloat(getComputedStyle(line.parentElement).lineHeight) + 1; })()`), "sentence pages fit two lines at the slot's width");
        if (await layer() === "aimed") await lands("search", "the shell caption's arrow");
        else assert.ok(await ringed("search"), "without a clear arrow path, the ring still identifies Find exactly");
      };
      await checkSlot();
      await shot(`shell-caption-${width}-${scheme}`);
      await evaluate(`document.querySelector('[data-guide="composer"]').style.height = '88px'`);
      await sleep(100);
      await checkSlot();
      await evaluate(`document.querySelector('[data-guide="composer"]').style.removeProperty('height')`);
      // A point's words replace a caption; clearing that point then takes its words down too.
      guide("point", "search", "Find your topic here.");
      guide("point", null, "");
      assert.ok(await until(`!document.querySelector('.guide-caption') && ${emptySlot}`, 1000), "clearing the caption releases the slot");

      await evaluate(`(() => { const dialog = document.createElement('dialog'); dialog.id = 'guide-sheet'; document.body.append(dialog); dialog.showModal(); })()`);
      guide("point", "search", "Find your topic here.");
      assert.ok(await until(`document.querySelector('#shell-caption .guide-caption')?.matches(':popover-open')`, 2000), "the shell caption keeps its manual popover over a dialog");
      await sleep(200);
      assert.equal(await onTop(".guide-caption"), true, "the shell caption is visible over the open dialog");
      guide("point", null, "");
      assert.ok(await until(`!document.querySelector('.guide-caption') && ${emptySlot}`, 1000), "the point's caption releases the slot too");
      await evaluate(`document.querySelector('#guide-sheet').remove()`);
    }
    if (width === 1440) {
      step("shell caption paging follows unread words through a resize");
      await evaluate(`navigator.mediaDevices.getUserMedia = async () => { const ctx = new AudioContext(); const tone = ctx.createOscillator();
        const out = ctx.createMediaStreamDestination(); tone.connect(out); tone.start(); return out.stream; }`);
      await click('[data-guide="mic"]');
      assert.ok(await until(`document.querySelector('[data-guide="mic"]')?.getAttribute('aria-pressed') === 'true'`, 5000));
      const source = Array.from({ length: 80 }, (_, i) => `word${i}`);
      const captionWords = () => evaluate(`document.querySelector('.guide-caption .guide-text')?.textContent.trim() ?? null`);
      const resizeSlot = (size) => evaluate(`document.querySelector('#shell-caption').style.width = '${size}px'`);
      for (const [from, to] of [[300, 640], [640, 300]]) {
        await resizeSlot(from);
        guide("caption", null, `**${source.join(" ")}**`);
        assert.ok(await until(`document.querySelector('.guide-caption .guide-text')?.textContent.startsWith('word0 ')`, 2000));
        await sleep(100);
        const firstPage = await captionWords();
        let start = firstPage.split(/\s+/).length;
        assert.ok(await until(`document.querySelector('.guide-caption .guide-text')?.textContent.startsWith(${JSON.stringify(source[start] + " ")})`, captionMs(firstPage) + 1200), "the second page starts after the words already read");
        const shownAt = Date.now();
        const before = await captionWords();
        if (to < from) await sleep(2200);
        await resizeSlot(to);
        assert.ok(await until(`document.querySelector('.guide-caption')?.getBoundingClientRect().width <= ${to} && document.querySelector('.guide-caption .guide-text')?.textContent !== ${JSON.stringify(before)}`, 1000), "the page is rebuilt at the new slot width");
        const after = await captionWords();
        assert.ok(after.startsWith(source[start] + " "), "resizing keeps the source position, without repeating or skipping words");
        assert.ok(after.split(/\s+/).length * (to > from ? 1 : -1) > before.split(/\s+/).length * (to > from ? 1 : -1), "the slot width changes how many unread words fit");
        assert.equal(await evaluate(`document.querySelector('.guide-caption strong')?.textContent`), after, "a bold span stays open across the source position");
        if (to < from) {
          start += after.split(/\s+/).length;
          assert.ok(await until(`document.querySelector('.guide-caption .guide-text')?.textContent.startsWith(${JSON.stringify(source[start] + " ")})`, Math.max(0, captionMs(after) - (Date.now() - shownAt)) + 1000), "resizing retains elapsed reading time");
        }
        say("so anyway another thought");
        assert.ok(await until(`!document.querySelector('.guide-caption') && !!document.querySelector('.guide-held-text')`, 1000), "talking over the resized page holds its unread remainder");
        assert.equal(await evaluate(`document.querySelector('.guide-held-text').textContent.trim()`), source.slice(start).join(" "), "the held remainder contains every unread word once, in order");
        await evaluate(`document.querySelectorAll('.guide-held-card button:last-child').forEach((button) => button.click())`);
        await pause();
      }
      await evaluate(`document.querySelector('#shell-caption').style.removeProperty('width')`);
    }
    await page.close();
    page = null;
  }
} catch (error) {
  failed = error;
} finally {
  await page?.close();
  core.close();
  clearTimeout(stuck);
}
if (failed) { console.error(`guide-check failed at “${doing}”:`, failed.stack ?? failed.message); process.exit(1); }
console.log("guide-check: the names, the rules, and on the page: the caption at the stage, its Markdown and pages; the arrow at the named part, followed, taken down, led on to a hidden part, said when nowhere; over a sheet, gone once read, held by the pointer and a hidden page; talked over at once, not by its own voice; a held question asked at your pause with Go ahead, Later, Drop it; a phone; Reduce Motion");
