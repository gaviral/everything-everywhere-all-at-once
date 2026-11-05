// No extra dependencies: run with `node scripts/call-check.mjs` (after the UI is built; precheck builds it first).
// A call: two or more on one map, each window's Talk tab (ui/src/talk/, behind ?shell=2 until the shell's rail hosts
// it) showing who's here, what was said, who has the floor and how far each has read (core/src/call.rs tells it).
//  1. The rules (talk/turns.ts and talk/call-core.ts, through Vite): a split turn is one turn, a margin note a turn of
//     its own; read marks, the newer of two, what's unread and where each person has read; how a code, a time, a
//     state and "who hears you" read.
//  2. On the built UI in headless Chrome over a stand-in core that answers as the core does (exit 3, precheck's WARN,
//     without Chrome or ui/dist): alone, no Talk; a second window starts the call and Talk opens in both; "Speaking
//     now…" shows on the other window while someone has the floor, then their turn's words as it ends; the read line
//     moves as turns are read and the mark reaches the core and the other window; turns said while Talk was closed
//     wait on its pill and below the read line; a late joiner on a phone gets Join code and Leave in Talk's sheet and
//     "Joined … · N turns before you · Catch up", which scrolls to them; words picked in a turn take a reply that
//     reaches both windows as a margin note; the Friend's level set in one window shows in the other; the Friend's
//     caption is "Speaking now…" while it's up and its words a turn once it's down (never both); a turn's time points
//     at its place on the map; who leaves is shown as left.
// CALL_SHOTS=<folder> also saves the 1440 and 390 shots there (call-1440.png, call-390.png).
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { uiServer } from "./ui-server.mjs";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

// ---- 1. The rules.
const server = await uiServer();
let T, C, A, M;
try {
  T = await server.ssrLoadModule("/src/talk/turns.ts");
  C = await server.ssrLoadModule("/src/talk/call-core.ts");
  A = await server.ssrLoadModule("/src/annotate-core.ts");
  M = await server.ssrLoadModule("/src/bricks/spine/margin.tsx");
} finally { await server.close(); }

const minute = 60_000;
const said = (id, speaker, text, at, extra = {}) => ({ id, speaker, text, point: text, thread_id: "T1", placed: true, unclear: "", complete: true, at_ms: at, place_ms: 900, ...extra });
{
  const t = [said("a", "Colleague", "Pasta night.", 10), said("b", "Colleague", "Everyone brings a dessert.", 10), said("c", "Designer", "Yes please!", 20, { thread_id: "N1" }),
    said("d", "Designer", "  ", 25), said("e", "Friend", "Split the desserts?", 30), said("f", "Colleague", "Before", 5)];
  const turns = T.turnsOf(t, [{ id: "T1" }, { id: "N1", anchor: { thought_id: "b", quote: "brings a dessert" } }]);
  assert.deepEqual(turns.map((x) => [x.key, x.speaker, x.parts.length]), [["f", "Colleague", 1], ["a", "Colleague", 2], ["c", "Designer", 1], ["e", "Friend", 1]], "in the order said; a split turn is one; no empty turn");
  assert.deepEqual(turns[2].note, { threadId: "N1", thoughtId: "b", quote: "brings a dessert" }, "a margin note is a turn of its own, with its words");
  assert.equal(Object.hasOwn(turns[2].note, "context"), false, "legacy target omits the absent optional field");
  const source = t.find((part) => part.id === "b");
  const quote = "brings a dessert", at = source.text.indexOf(quote);
  const context = { source_text: source.text, source_speaker: source.speaker, start: at, end: at + quote.length };
  const anchor = { thought_id: source.id, quote, context };
  const withContext = T.turnsOf(t, [{ id: "N1", anchor }]).find((turn) => turn.key === "c").note;
  assert.deepEqual(withContext, { threadId: "N1", thoughtId: "b", quote, context }, "defined immutable context is forwarded exactly");
  assert.equal(withContext.context, context, "target preserves the actual source-context object");
  assert.deepEqual(M.anchorOf({ anchor: { thought_id: "b", quote } }), { thoughtId: "b", quote }, "spine legacy target omits context too");
  assert.equal(M.anchorOf({ anchor }).context, context, "spine target forwards defined context unchanged");
  assert.equal(A.anchorRange(quote, undefined, source.text), null, "legacy targets do not guess a persisted occurrence");
  assert.deepEqual(JSON.parse(A.annotateMessage("b", quote, "Reply", context).message).context, context, "wire preserves the exact defined source revision/range");
  assert.equal(T.turnIndex(turns, "b"), 1, "a turn's second part is in it");
  assert.equal(T.newerMark(turns, "a", "e"), "e");
  assert.equal(T.newerMark(turns, "gone", "c"), "c", "a mark that left the map counts for nothing");
  assert.equal(T.newerMark(turns, null, undefined), null);
  assert.deepEqual(T.unreadOf(turns, 1, "Colleague", 0).map((x) => x.key), ["c", "e"], "unread: after the mark, not yours");
  assert.deepEqual(T.unreadOf(turns, -1, "Designer", 8).map((x) => x.key), ["a", "e"], "from the call's start only");
  assert.ok(T.readFor(turns[0]) === T.DWELL_MS && T.readFor({ parts: [{ text: "word ".repeat(40) }] }) > 10_000, "read: at least the dwell, longer for more words");
  assert.deepEqual([...T.readersAt(turns, [{ name: "Designer", ai: false, read: "b" }, { name: "Friend", ai: true, read: "e" }, { name: "Colleague", ai: false, read: "a" }], "Colleague")], [[1, ["Designer"]]], "where the others read, not you, not an AI");
  assert.equal(C.shownCode("k7m2x9qp"), "K7M2 X9QP");
  assert.equal(C.shownCode("k7q4m2"), "K7Q 4M2");
  assert.ok(!/AM|PM/.test(C.clock(Date.UTC(2026, 10, 2, 19, 37))), "a time without AM or PM");
  const call = { started_ms: 1, level: "speak", level_by: "", people: [
    { name: "Colleague", ai: false, joined_ms: 1, here: true, left_ms: null, mic: true, speaking: false, read: null },
    { name: "Friend", ai: true, joined_ms: 2, here: true, left_ms: null, mic: false, speaking: false, read: null },
    { name: "Designer", ai: false, joined_ms: 3, here: true, left_ms: null, mic: false, speaking: true, read: null },
    { name: "Reviewer", ai: false, joined_ms: 4, here: false, left_ms: Date.UTC(2026, 10, 2, 19, 52), mic: false, speaking: false, read: null }] };
  assert.deepEqual(C.ordered(call, "Designer").map((p) => p.name), ["Designer", "Colleague", "Reviewer", "Friend"], "you first, then people, then AI participants");
  assert.equal(C.heardBy(call, "Colleague"), "Designer and the AI helper hear you");
  assert.equal(C.heardBy({ ...call, people: call.people.slice(0, 2) }, "Colleague"), "the AI helper hears you");
  assert.deepEqual(call.people.map((p) => C.stateWord(p)).slice(0, 3), ["mic on", "here", "speaking"]);
  assert.match(C.stateWord(call.people[3]), /^left \d/);
  assert.ok(C.inCall(call) && C.inCall({ ...call, people: call.people.slice(0, 2) }) && !C.inCall({ ...call, people: call.people.slice(0, 1) }), "two here make a call, an AI participant too");
  assert.equal(C.peopleHere(call), 2);
}

// ---- 2. The page.
const why = ready();
if (why) {
  console.log(`call-check: the rules hold; the page part skipped: ${why}`);
  process.exit(3);
}
const shots = process.env.CALL_SHOTS || "";
if (shots) mkdirSync(shots, { recursive: true });

// Guest's farewell: six turns before the call, then the call's. Fictional people.
const now = Date.now();
const start = now - 11 * minute;
const thread = (id, title, parent = null) => ({ id, title, parent_id: parent, status: "open", last_point: "", touched_ms: now - 30 * minute, tags: [], picture: null, dropped_by: "" });
const world = {
  recaps: [], suggestions: [], actions: [], merged: {}, proposals: [], apps: [], apps_seeded: true, notes: {}, positions: {},
  threads: [thread("T1", "Guest’s farewell dinner"), thread("T2", "Gift for Guest"), thread("N1", "Everyone brings a dessert", "T1")],
  anchors: { N1: { thought_id: "c1", quote: "everyone brings a dessert" } },
  ai: ["Friend"], active: "T1", active_by: { Colleague: "T1", Designer: "T1", Reviewer: "T1" },
  thoughts: [
    said("e1", "Colleague", "Dinner before Guest leaves on the 14th.", start - 30 * minute),
    said("e2", "Colleague", "A photo book of the flat.", start - 28 * minute, { thread_id: "T2" }),
    said("e3", "Designer", "Everyone signs one card.", start - 27 * minute, { thread_id: "T2" }),
    said("e4", "Colleague", "Somewhere quiet, so we can actually talk.", start - 25 * minute),
    said("e5", "Designer", "Guest loves anything with pasta.", start - 24 * minute),
    said("e6", "Colleague", "Keep it small, ten people at most.", start - 22 * minute),
    said("c1", "Colleague", "Okay. Pasta night, and everyone brings a dessert.", start + 1 * minute, { point: "Pasta night: everyone brings a dessert." }),
    said("n1", "Friend", "Desserts could be split so nobody brings the same one.", start + 1.2 * minute, { thread_id: "N1" }),
    said("c2", "Designer", "Dinner at our place, 7 pm. Decided.", start + 2 * minute, { point: "Dinner at our place, 7 pm.", decided: true }),
    said("c3", "Designer", "Guest’s away that Saturday. She’s back Sunday around noon.", start + 3 * minute, { point: "Guest away Saturday, back Sunday noon." }),
    said("n2", "Designer", "yes please!", start + 4 * minute, { thread_id: "N1" }),
  ],
};
const person = (name, extra = {}) => ({ name, ai: false, joined_ms: start, here: true, left_ms: null, mic: false, speaking: false, read: null, ...extra });
let people = [];
let level = { level: "speak", level_by: "" };
const callMsg = () => ({ type: "call", started_ms: start, people, ...level });
const here = () => people.filter((p) => p.here).length;
const setPerson = (name, change) => { people = people.map((p) => (p.name === name ? { ...p, ...change } : p)); };
let tell = () => {};
// As the core's World::apply, for the changes this check makes: so a window that joins later gets the map as it is.
const keep = (change) => {
  if (change.type === "thread_added") world.threads.push(change.thread);
  if (change.type === "anchored") world.anchors[change.thread_id] = { thought_id: change.thought_id, quote: change.quote, ...(change.context === undefined ? {} : { context: change.context }) };
  if (change.type === "thought_added") world.thoughts.push(change.thought);
  if (change.type === "thought_placed") world.thoughts = world.thoughts.map((t) => (t.id === change.thought_id ? { ...t, placed: true, point: change.point, thread_id: change.thread_id } : t));
};
const commit = (changes) => { for (const change of changes) { keep(change); core.send({ type: "change", change }); } };
let n = 0;
// Each window's latest read mark, by who sent it.
const marks = {};
const core = await standInCore((query) => {
  const name = query.get("name") || "you";
  if (people.some((p) => p.name === name)) setPerson(name, { here: true, left_ms: null });
  else people.push(person(name, { joined_ms: name === "Reviewer" ? Date.now() : start }));
  // The Friend's bridge comes with Designer, as in the demo's call.
  if (name === "Designer" && !people.some((p) => p.ai)) people.push(person("Friend", { ai: true }));
  // As the core: a call once two are here, told to the windows already in, and first in this one's catch-up.
  const on = here() >= 2;
  if (on) tell();
  return [...(on ? [callMsg()] : []), { type: "snapshot", world }, { type: "placing", now: null, retries: [] }];
}, {
  door: { room: true, member: true, code: "k7m2x9qp", invite: "http://192.168.1.5:4321/?room=k7m2x9qp" },
  onMessage: (message, query) => {
    const name = query.get("name") || "you";
    if (message.type === "read") { marks[name] = message.thought_id; setPerson(name, { read: message.thought_id }); tell(); }
    if (message.type === "level") { level = { level: message.level, level_by: name }; tell(); }
    if (message.type === "annotate") {
      const changes = A.noteChanges(world, name, message.thought_id, message.quote, message.text, Date.now(), { thread: () => `N${++n + 1}`, thought: () => `note-${n}-${Math.random().toString(36).slice(2, 7)}` }, message.context);
      if (changes) commit(changes);
    }
  },
  onClose: (query) => { setPerson(query.get("name") || "you", { here: false, left_ms: Date.now(), speaking: false }); tell(); },
});
tell = () => core.send(callMsg());
// A turn as the core makes one: its thought, placed. Each a moment after the last (two at the same moment from one
// speaker are one turn the placer cut in two).
let last = 0;
const turn = (id, speaker, text, at = (last = Math.max(Date.now(), last + 1000))) => {
  commit([{ type: "thought_added", thought: { ...said(id, speaker, text, at), placed: false, thread_id: "T1" } },
    { type: "thought_placed", thought_id: id, thread_id: "T1", point: text, unclear: "", complete: true, place_ms: 900 }]);
};

let doing = "opening the pages";
const step = (name) => { doing = name; };
const pages = [];
setTimeout(async () => {
  console.error(`call-check: stuck at “${doing}” after 3 minutes`);
  core.close();
  await Promise.race([Promise.all(pages.map((p) => p.close())), sleep(4000)]).catch(() => {});
  process.exit(1);
}, 180_000).unref();

/** A window of `name`'s: joined (this tab remembers it), the tour seen, at ?shell=2. For the shots, dressed as the
 *  revamp's page will be: the Spine as the map (on under ?shell=2 once the shell lands), Apps and the install hint
 *  put away. */
async function windowOf(name, size) {
  const page = await openPage(`http://127.0.0.1:${core.port}/?shell=2`, size);
  pages.push(page);
  await page.until(`document.readyState === "complete"`);
  await page.evaluate(`sessionStorage.setItem("e2a2o.joined", ${JSON.stringify(name)}); localStorage.setItem("e2a2o.name", ${JSON.stringify(name)}); localStorage.setItem("e2a2o.toured", "1")`);
  if (shots) await page.evaluate(`localStorage.setItem("e2a2o.bricks", JSON.stringify({ spine: true }))`);
  await page.page("Page.reload", {});
  assert.ok(await page.until(`!!document.querySelector('[data-guide="composer"]')`, 8000), `${name}'s map opens`);
  if (shots) {
    await page.until(`!!document.querySelector('[data-guide="view:spine"]')`, 8000);
    await page.evaluate(`document.querySelector('[data-guide="view:spine"]').click()`);
    await page.evaluate(`document.querySelector(".apps-panel.is-open .apps-title")?.click(); [...document.querySelectorAll("button")].find((b) => b.textContent === "Not now")?.click()`);
  }
  return page;
}
const text = (page, selector) => page.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].map((el) => el.textContent).join(" | ")`);
const click = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const shot = async (page, name) => {
  if (!shots) return;
  const { data } = await page.page("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(shots, `${name}.png`), Buffer.from(data, "base64"));
};

let failed = null;
try {
  step("Colleague alone");
  people.push(person("Colleague", { here: false, mic: true }));
  const colleague = await windowOf("Colleague", { width: 1440, height: 900 });
  await sleep(500);
  assert.equal(await colleague.evaluate(`!!document.querySelector(".talk-rail, .talk-pill")`), false, "alone, no Talk");

  step("Designer joins: the call starts");
  const designer = await windowOf("Designer", { width: 1440, height: 900 });
  for (const [page, who] of [[colleague, "Colleague"], [designer, "Designer"]]) {
    assert.ok(await page.until(`!!document.querySelector(".talk-rail .talk-people")`, 4000), `${who}'s Talk opens with two people here`);
  }
  assert.match(await text(colleague, ".talk-person"), /You.*mic on.*Designer.*here.*AI helper.*here/, "the people row: you first, the Friend last");
  assert.match(await text(colleague, ".talk-start"), /Call started .* · 6 earlier turns/, "earlier turns fold away");
  assert.match(await text(colleague, ".talk-code"), /Join code.*K7M2 X9QP/);
  assert.equal(await colleague.evaluate(`!!document.querySelector(".talk-leave")`), true, "Leave");
  assert.match(await text(colleague, ".talk-on"), /on “everyone brings a dessert”.*on “everyone brings a dessert”/, "the Friend's note and its reply, each on its words");
  assert.match(await text(colleague, ".talk-turn .talk-level"), /Comment/, "the AI helper's note names its level");

  step("Speaking now…");
  setPerson("Designer", { speaking: true, mic: true });
  tell();
  assert.ok(await colleague.until(`[...document.querySelectorAll(".talk-live")].some((el) => el.textContent.includes("Designer") && el.textContent.includes("Speaking now…"))`, 3000), "Colleague sees Designer has the floor");
  assert.ok(await designer.until(`[...document.querySelectorAll(".talk-live")].some((el) => el.textContent.includes("You"))`, 3000), "Designer sees her own turn under way");
  assert.match(await text(colleague, ".talk-person"), /Designer\s*speaking/);
  turn("c4", "Designer", "What if we do it at the park instead? The usual spot.");
  setPerson("Designer", { speaking: false });
  tell();
  assert.ok(await colleague.until(`!document.querySelector(".talk-live") && document.querySelector(".talk-turns").textContent.includes("The usual spot.")`, 3000), "her words come as Speaking now… goes");

  step("the read line moves");
  // Colleague has read what's there (each turn in view for its reading time), closes Talk (he looks away), and four turns come.
  const until = async (done, ms) => { for (let waited = 0; !done() && waited < ms; waited += 100) await sleep(100); return done(); };
  assert.ok(await until(() => marks.Colleague === "c4", 8000), `Colleague's window reads the turns in view: its mark is ${marks.Colleague}`);
  await click(colleague, ".talk-close");
  assert.ok(await colleague.until(`!document.querySelector(".talk-rail") && !!document.querySelector(".talk-pill")`, 2000), "Talk closes to its pill");
  turn("c5", "Designer", "Park works if it doesn’t rain.");
  turn("c6", "Designer", "Bring the big blanket?");
  turn("c7", "Colleague", "Park if it doesn’t rain; Saturday?");
  turn("c8", "Designer", "Saturday it is.");
  assert.ok(await colleague.until(`document.querySelector(".talk-pill")?.textContent === "Talk · 3 new"`, 3000), `the pill counts what waits from the others: ${await text(colleague, ".talk-pill")}`);
  const waiting = await text(colleague, ".talk-pill");
  await click(colleague, ".talk-pill");
  assert.ok(await colleague.until(`!!document.querySelector(".talk-read-line")`, 3000), "a read line where Colleague left off");
  const lineAfter = () => colleague.evaluate(`document.querySelector(".talk-read-line")?.previousElementSibling?.dataset.turn ?? "gone"`);
  const first = await lineAfter();
  await shot(colleague, "call-1440-read-line");
  const moved = await colleague.until(`(document.querySelector(".talk-read-line")?.previousElementSibling?.dataset.turn ?? "gone") !== ${JSON.stringify(first)}`, 9000);
  assert.ok(moved, `the read line moves as the turns are read (it stayed after turn ${first})`);
  await colleague.evaluate(`document.querySelector(".talk-scroll").scrollTop = 1e6`);
  assert.ok(await colleague.until(`!document.querySelector(".talk-read-line")`, 8000), "once all is read, no line");
  assert.equal(marks.Colleague, "c8", "Colleague's mark reaches the core as it moves");
  assert.ok(await designer.until(`[...document.querySelectorAll(".talk-seen")].some((el) => el.title.includes("Colleague read up to here"))`, 3000), "Designer sees how far Colleague has read");

  step("a late joiner on a phone");
  const reviewer = await windowOf("Reviewer", { width: 390, height: 844 });
  assert.ok(await reviewer.until(`/^Talk · \\d+ new/.test(document.querySelector(".talk-pill-phone")?.textContent ?? "")`, 4000), "on a phone, Talk waits on its pill with what's new");
  await sleep(400);
  await shot(reviewer, "call-390-pill");
  await click(reviewer, ".talk-pill-phone");
  assert.ok(await reviewer.until(`!!document.querySelector(".talk-sheet .talk-people")`, 3000), "it opens as a sheet");
  assert.match(await text(reviewer, ".talk-sheet .talk-code"), /Join code.*K7M2 X9QP/, "the join code on a phone");
  assert.equal(await reviewer.evaluate(`!!document.querySelector(".talk-sheet .talk-leave")`), true, "Leave on a phone");
  assert.ok(await reviewer.until(`/Joined .* · \\d+ turns before you.*Catch up/.test(document.querySelector(".talk-catch-up")?.textContent ?? "")`, 3000), "Catch up for what was said before Reviewer came");
  await click(reviewer, ".talk-catch-up");
  assert.ok(await reviewer.until(`(() => {
    const turn = [...document.querySelectorAll("[data-turn]")].find((el) => el.textContent.includes("Pasta night"));
    const box = document.querySelector(".talk-scroll").getBoundingClientRect(), r = turn?.getBoundingClientRect();
    return !!r && r.top >= box.top - 1 && r.top < box.bottom - 20;
  })()`, 3000), "Catch up scrolls to the first turn Reviewer missed");
  await shot(reviewer, "call-390");

  step("a reply on picked words reaches both windows");
  await designer.evaluate(`(() => {
    const part = [...document.querySelectorAll("[data-part]")].find((el) => el.textContent.includes("Saturday?"));
    const words = part.firstChild, at = words.textContent.indexOf("Saturday");
    const range = document.createRange(); range.setStart(words, at); range.setEnd(words, at + "Saturday".length);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    part.closest(".talk-words").dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  })()`);
  const replyStart = `[...document.querySelectorAll(".talk-reply-start")].find((b) => /Reply to “Saturday”/.test(b.textContent))`;
  assert.ok(await designer.until(`!!${replyStart}`, 2000), "picked words offer a reply");
  await designer.evaluate(`${replyStart}.click()`);
  assert.ok(await designer.until(`document.activeElement?.id === "talk-reply-field"`, 2000), "the reply box takes the keys");
  await designer.page("Input.insertText", { text: "Sunday works better for Guest" });
  await designer.page("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await designer.page("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  const note = core.heard.find((m) => m.type === "annotate");
  assert.ok(note && note.thought_id === "c7" && note.quote === "Saturday" && note.text === "Sunday works better for Guest", `the note goes as a margin note on those words: ${JSON.stringify(note)}`);
  for (const [page, who] of [[colleague, "Colleague"], [designer, "Designer"]]) {
    assert.ok(await page.until(`[...document.querySelectorAll(".talk-turn")].some((el) => el.textContent.includes("on “Saturday”") && el.textContent.includes("Sunday works better for Guest"))`, 3000), `the note reaches ${who}'s window`);
  }

  step("the Friend's level");
  await colleague.evaluate(`[...document.querySelectorAll(".talk-level-step")].find((b) => b.textContent === "Ask").click()`);
  assert.deepEqual(core.heard.filter((m) => m.type === "level").at(-1), { type: "level", level: "hand" });
  assert.ok(await designer.until(`document.querySelector('.talk-level-step[aria-checked="true"]')?.textContent === "Ask" && document.querySelector(".talk-meter-says").textContent.includes("Set by Colleague")`, 3000), "Designer's meter shows Colleague's level");
  await colleague.evaluate(`[...document.querySelectorAll(".talk-level-step")].find((b) => b.textContent === "Speak").click()`);

  step("the Friend's caption: Speaking now…, then its words as a turn");
  const line = "Maybe ask Guest which day suits her?";
  core.send({ type: "guide", kind: "caption", target: null, text: line, by: "Friend", at_ms: Date.now() });
  assert.ok(await colleague.until(`!!document.querySelector(".talk-live-ai")`, 3000), "the Friend's caption shows as Speaking now…");
  assert.equal(await colleague.evaluate(`document.querySelector(".talk-turns").textContent.includes(${JSON.stringify(line)})`), false, "its words aren't in Talk while the caption says them");
  assert.ok(await colleague.until(`!document.querySelector(".talk-live-ai") && document.querySelector(".talk-turns").textContent.includes(${JSON.stringify(line)})`, 15000), "once said, its words are a turn");
  assert.match(await colleague.evaluate(`[...document.querySelectorAll(".talk-turn")].find((el) => el.textContent.includes(${JSON.stringify(line)}))?.textContent ?? ""`), /Speak/, "naming its level");

  step("a turn's time shows it on the map");
  await colleague.evaluate(`[...document.querySelectorAll(".talk-turn")].find((el) => el.textContent.includes("Saturday it is."))?.querySelector("button.talk-time")?.click()`);
  assert.ok(await colleague.until(`document.body.textContent.includes("Here on the map")`, 3000), "an arrow at its point says where it is");
  await colleague.page("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await colleague.page("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });

  step("the 1440 shot: the Friend speaks, a turn waits below the read line");
  if (shots) {
    turn("c9", "Designer", "I can bring the speaker for music.");
    core.send({ type: "guide", kind: "caption", target: null, text: "Quick thing: Designer said Guest is away Saturday. Sunday works?", by: "Friend", at_ms: Date.now() });
    await colleague.until(`!!document.querySelector(".talk-live-ai")`, 2000);
    await sleep(300);
    await shot(colleague, "call-1440");
  }

  step("Designer leaves");
  await designer.close();
  pages.splice(pages.indexOf(designer), 1);
  assert.ok(await colleague.until(`/Designer\s*left/.test(document.querySelector(".talk-people")?.textContent ?? "")`, 4000), `Colleague sees Designer left: ${await text(colleague, ".talk-person")} / ${JSON.stringify(people.map((p) => [p.name, p.here]))}`);
  console.log(`call-check: ok (the rules; two windows and a late one: the floor, the read line (${waiting}), catch up, a reply on both, the level, the Friend's caption kept${shots ? `; shots in ${shots}` : ""})`);
} catch (error) {
  failed = error;
} finally {
  core.close();
  await Promise.all(pages.map((p) => p.close().catch(() => {})));
}
if (failed) { console.error(`call-check: failed at “${doing}”`); console.error(failed.stack ?? failed.message); process.exit(1); }
