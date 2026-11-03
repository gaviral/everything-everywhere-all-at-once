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
//     reaches both windows as a margin note; the Friend's level set in one window shows in the other.
// CALL_SHOTS=<folder> also saves the 1440 and 390 shots there (call-1440.png, call-390.png).
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { uiServer } from "./ui-server.mjs";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

// ---- 1. The rules.
const server = await uiServer();
let T, C, A;
try {
  T = await server.ssrLoadModule("/src/talk/turns.ts");
  C = await server.ssrLoadModule("/src/talk/call-core.ts");
  A = await server.ssrLoadModule("/src/annotate-core.ts");
} finally { await server.close(); }

const minute = 60_000;
const said = (id, speaker, text, at, extra = {}) => ({ id, speaker, text, point: text, thread_id: "T1", placed: true, unclear: "", complete: true, at_ms: at, place_ms: 900, ...extra });
{
  const t = [said("a", "Sam", "Pasta night.", 10), said("b", "Sam", "Everyone brings a dessert.", 10), said("c", "Maya", "Yes please!", 20, { thread_id: "N1" }),
    said("d", "Maya", "  ", 25), said("e", "Friend", "Split the desserts?", 30), said("f", "Sam", "Before", 5)];
  const turns = T.turnsOf(t, [{ id: "T1" }, { id: "N1", anchor: { thought_id: "b", quote: "brings a dessert" } }]);
  assert.deepEqual(turns.map((x) => [x.key, x.speaker, x.parts.length]), [["f", "Sam", 1], ["a", "Sam", 2], ["c", "Maya", 1], ["e", "Friend", 1]], "in the order said; a split turn is one; no empty turn");
  assert.deepEqual(turns[2].note, { threadId: "N1", thoughtId: "b", quote: "brings a dessert" }, "a margin note is a turn of its own, with its words");
  assert.equal(T.turnIndex(turns, "b"), 1, "a turn's second part is in it");
  assert.equal(T.newerMark(turns, "a", "e"), "e");
  assert.equal(T.newerMark(turns, "gone", "c"), "c", "a mark that left the map counts for nothing");
  assert.equal(T.newerMark(turns, null, undefined), null);
  assert.deepEqual(T.unreadOf(turns, 1, "Sam", 0).map((x) => x.key), ["c", "e"], "unread: after the mark, not yours");
  assert.deepEqual(T.unreadOf(turns, -1, "Maya", 8).map((x) => x.key), ["a", "e"], "from the call's start only");
  assert.ok(T.readFor(turns[0]) === T.DWELL_MS && T.readFor({ parts: [{ text: "word ".repeat(40) }] }) > 10_000, "read: at least the dwell, longer for more words");
  assert.deepEqual([...T.readersAt(turns, [{ name: "Maya", ai: false, read: "b" }, { name: "Friend", ai: true, read: "e" }, { name: "Sam", ai: false, read: "a" }], "Sam")], [[1, ["Maya"]]], "where the others read, not you, not an AI");
  assert.equal(C.shownCode("k7m2x9qp"), "K7M2 X9QP");
  assert.equal(C.shownCode("k7q4m2"), "K7Q 4M2");
  assert.ok(!/AM|PM/.test(C.clock(Date.UTC(2026, 10, 2, 19, 37))), "a time without AM or PM");
  const call = { started_ms: 1, level: "speak", level_by: "", people: [
    { name: "Sam", ai: false, joined_ms: 1, here: true, left_ms: null, mic: true, speaking: false, read: null },
    { name: "Friend", ai: true, joined_ms: 2, here: true, left_ms: null, mic: false, speaking: false, read: null },
    { name: "Maya", ai: false, joined_ms: 3, here: true, left_ms: null, mic: false, speaking: true, read: null },
    { name: "Lee", ai: false, joined_ms: 4, here: false, left_ms: Date.UTC(2026, 10, 2, 19, 52), mic: false, speaking: false, read: null }] };
  assert.deepEqual(C.ordered(call, "Maya").map((p) => p.name), ["Maya", "Sam", "Lee", "Friend"], "you first, then people, then AI participants");
  assert.equal(C.heardBy(call, "Sam"), "Maya and the Friend hear you");
  assert.equal(C.heardBy({ ...call, people: call.people.slice(0, 2) }, "Sam"), "the Friend hears you");
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

// Lena's farewell: six turns before the call, then the call's. Fictional people.
const now = Date.now();
const start = now - 11 * minute;
const thread = (id, title, parent = null) => ({ id, title, parent_id: parent, status: "open", last_point: "", touched_ms: now - 30 * minute, tags: [], picture: null, dropped_by: "" });
const world = {
  recaps: [], suggestions: [], actions: [], merged: {}, proposals: [], apps: [], apps_seeded: true, notes: {}, positions: {},
  threads: [thread("T1", "Lena’s farewell dinner"), thread("T2", "Gift for Lena"), thread("N1", "Everyone brings a dessert", "T1")],
  anchors: { N1: { thought_id: "c1", quote: "everyone brings a dessert" } },
  ai: ["Friend"], active: "T1", active_by: { Sam: "T1", Maya: "T1", Lee: "T1" },
  thoughts: [
    said("e1", "Sam", "Dinner before Lena leaves on the 14th.", start - 30 * minute),
    said("e2", "Sam", "A photo book of the flat.", start - 28 * minute, { thread_id: "T2" }),
    said("e3", "Maya", "Everyone signs one card.", start - 27 * minute, { thread_id: "T2" }),
    said("e4", "Sam", "Somewhere quiet, so we can actually talk.", start - 25 * minute),
    said("e5", "Maya", "Lena loves anything with pasta.", start - 24 * minute),
    said("e6", "Sam", "Keep it small, ten people at most.", start - 22 * minute),
    said("c1", "Sam", "Okay. Pasta night, and everyone brings a dessert.", start + 1 * minute, { point: "Pasta night: everyone brings a dessert." }),
    said("n1", "Friend", "Desserts could be split so nobody brings the same one.", start + 1.2 * minute, { thread_id: "N1" }),
    said("c2", "Maya", "Dinner at our place, 7 pm. Decided.", start + 2 * minute, { point: "Dinner at our place, 7 pm.", decided: true }),
    said("c3", "Maya", "Lena’s away that Saturday. She’s back Sunday around noon.", start + 3 * minute, { point: "Lena away Saturday, back Sunday noon." }),
    said("n2", "Maya", "yes please!", start + 4 * minute, { thread_id: "N1" }),
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
  if (change.type === "anchored") world.anchors[change.thread_id] = { thought_id: change.thought_id, quote: change.quote };
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
  else people.push(person(name, { joined_ms: name === "Lee" ? Date.now() : start }));
  // The Friend's bridge comes with Maya, as in the demo's call.
  if (name === "Maya" && !people.some((p) => p.ai)) people.push(person("Friend", { ai: true }));
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
      const changes = A.noteChanges(world, name, message.thought_id, message.quote, message.text, Date.now(), { thread: () => `N${++n + 1}`, thought: () => `note-${n}-${Math.random().toString(36).slice(2, 7)}` });
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

/** A window of `name`'s: joined (this tab remembers it), the tour seen, at ?shell=2. */
async function windowOf(name, size) {
  const page = await openPage(`http://127.0.0.1:${core.port}/?shell=2`, size);
  pages.push(page);
  await page.until(`document.readyState === "complete"`);
  await page.evaluate(`sessionStorage.setItem("e2a2o.joined", ${JSON.stringify(name)}); localStorage.setItem("e2a2o.name", ${JSON.stringify(name)}); localStorage.setItem("e2a2o.toured", "1")`);
  await page.page("Page.reload", {});
  assert.ok(await page.until(`!!document.querySelector('[data-guide="composer"]')`, 8000), `${name}'s map opens`);
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
  step("Sam alone");
  people.push(person("Sam", { here: false, mic: true }));
  const sam = await windowOf("Sam", { width: 1440, height: 900 });
  await sleep(500);
  assert.equal(await sam.evaluate(`!!document.querySelector(".talk-rail, .talk-pill")`), false, "alone, no Talk");

  step("Maya joins: the call starts");
  const maya = await windowOf("Maya", { width: 1440, height: 900 });
  for (const [page, who] of [[sam, "Sam"], [maya, "Maya"]]) {
    assert.ok(await page.until(`!!document.querySelector(".talk-rail .talk-people")`, 4000), `${who}'s Talk opens with two people here`);
  }
  assert.match(await text(sam, ".talk-person"), /You.*mic on.*Maya.*here.*Friend.*here/, "the people row: you first, the Friend last");
  assert.match(await text(sam, ".talk-start"), /Call started .* · 6 earlier turns/, "earlier turns fold away");
  assert.match(await text(sam, ".talk-code"), /Join code.*K7M2 X9QP/);
  assert.equal(await sam.evaluate(`!!document.querySelector(".talk-leave")`), true, "Leave");
  assert.match(await text(sam, ".talk-on"), /on “everyone brings a dessert”.*on “everyone brings a dessert”/, "the Friend's note and its reply, each on its words");
  assert.match(await text(sam, ".talk-turn .talk-level"), /Note/, "the Friend's note names its level");

  step("Speaking now…");
  setPerson("Maya", { speaking: true, mic: true });
  tell();
  assert.ok(await sam.until(`[...document.querySelectorAll(".talk-live")].some((el) => el.textContent.includes("Maya") && el.textContent.includes("Speaking now…"))`, 3000), "Sam sees Maya has the floor");
  assert.ok(await maya.until(`[...document.querySelectorAll(".talk-live")].some((el) => el.textContent.includes("You"))`, 3000), "Maya sees her own turn under way");
  assert.match(await text(sam, ".talk-person"), /Maya\s*speaking/);
  turn("c4", "Maya", "What if we do it at the park instead? The usual spot.");
  setPerson("Maya", { speaking: false });
  tell();
  assert.ok(await sam.until(`!document.querySelector(".talk-live") && document.querySelector(".talk-turns").textContent.includes("The usual spot.")`, 3000), "her words come as Speaking now… goes");

  step("the read line moves");
  // Sam has read what's there (each turn in view for its reading time), closes Talk (he looks away), and four turns come.
  const until = async (done, ms) => { for (let waited = 0; !done() && waited < ms; waited += 100) await sleep(100); return done(); };
  assert.ok(await until(() => marks.Sam === "c4", 8000), `Sam's window reads the turns in view: its mark is ${marks.Sam}`);
  await click(sam, ".talk-close");
  assert.ok(await sam.until(`!document.querySelector(".talk-rail") && !!document.querySelector(".talk-pill")`, 2000), "Talk closes to its pill");
  turn("c5", "Maya", "Park works if it doesn’t rain.");
  turn("c6", "Maya", "Bring the big blanket?");
  turn("c7", "Sam", "Park if it doesn’t rain; Saturday?");
  turn("c8", "Maya", "Saturday it is.");
  assert.ok(await sam.until(`document.querySelector(".talk-pill")?.textContent === "Talk · 3 new"`, 3000), `the pill counts what waits from the others: ${await text(sam, ".talk-pill")}`);
  const waiting = await text(sam, ".talk-pill");
  await click(sam, ".talk-pill");
  assert.ok(await sam.until(`!!document.querySelector(".talk-read-line")`, 3000), "a read line where Sam left off");
  const lineAfter = () => sam.evaluate(`document.querySelector(".talk-read-line")?.previousElementSibling?.dataset.turn ?? "gone"`);
  const first = await lineAfter();
  await shot(sam, "call-1440-read-line");
  const moved = await sam.until(`(document.querySelector(".talk-read-line")?.previousElementSibling?.dataset.turn ?? "gone") !== ${JSON.stringify(first)}`, 9000);
  assert.ok(moved, `the read line moves as the turns are read (it stayed after turn ${first})`);
  await sam.evaluate(`document.querySelector(".talk-scroll").scrollTop = 1e6`);
  assert.ok(await sam.until(`!document.querySelector(".talk-read-line")`, 8000), "once all is read, no line");
  assert.equal(marks.Sam, "c8", "Sam's mark reaches the core as it moves");
  assert.ok(await maya.until(`[...document.querySelectorAll(".talk-seen")].some((el) => el.title.includes("Sam read up to here"))`, 3000), "Maya sees how far Sam has read");

  step("a late joiner on a phone");
  const lee = await windowOf("Lee", { width: 390, height: 844 });
  assert.ok(await lee.until(`/^Talk · \\d+ new/.test(document.querySelector(".talk-pill-phone")?.textContent ?? "")`, 4000), "on a phone, Talk waits on its pill with what's new");
  await click(lee, ".talk-pill-phone");
  assert.ok(await lee.until(`!!document.querySelector(".talk-sheet .talk-people")`, 3000), "it opens as a sheet");
  assert.match(await text(lee, ".talk-sheet .talk-code"), /Join code.*K7M2 X9QP/, "the join code on a phone");
  assert.equal(await lee.evaluate(`!!document.querySelector(".talk-sheet .talk-leave")`), true, "Leave on a phone");
  assert.ok(await lee.until(`/Joined .* · \\d+ turns before you.*Catch up/.test(document.querySelector(".talk-catch-up")?.textContent ?? "")`, 3000), "Catch up for what was said before Lee came");
  await click(lee, ".talk-catch-up");
  assert.ok(await lee.until(`(() => {
    const turn = [...document.querySelectorAll("[data-turn]")].find((el) => el.textContent.includes("Pasta night"));
    const box = document.querySelector(".talk-scroll").getBoundingClientRect(), r = turn?.getBoundingClientRect();
    return !!r && r.top >= box.top - 1 && r.top < box.bottom - 20;
  })()`, 3000), "Catch up scrolls to the first turn Lee missed");
  await shot(lee, "call-390");

  step("a reply on picked words reaches both windows");
  await maya.evaluate(`(() => {
    const part = [...document.querySelectorAll("[data-part]")].find((el) => el.textContent.includes("Saturday?"));
    const words = part.firstChild, at = words.textContent.indexOf("Saturday");
    const range = document.createRange(); range.setStart(words, at); range.setEnd(words, at + "Saturday".length);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    part.closest(".talk-words").dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  })()`);
  const replyStart = `[...document.querySelectorAll(".talk-reply-start")].find((b) => /Reply to “Saturday”/.test(b.textContent))`;
  assert.ok(await maya.until(`!!${replyStart}`, 2000), "picked words offer a reply");
  await maya.evaluate(`${replyStart}.click()`);
  assert.ok(await maya.until(`document.activeElement?.id === "talk-reply-field"`, 2000), "the reply box takes the keys");
  await maya.page("Input.insertText", { text: "Sunday works better for Lena" });
  await maya.page("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await maya.page("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  const note = core.heard.find((m) => m.type === "annotate");
  assert.ok(note && note.thought_id === "c7" && note.quote === "Saturday" && note.text === "Sunday works better for Lena", `the note goes as a margin note on those words: ${JSON.stringify(note)}`);
  for (const [page, who] of [[sam, "Sam"], [maya, "Maya"]]) {
    assert.ok(await page.until(`[...document.querySelectorAll(".talk-turn")].some((el) => el.textContent.includes("on “Saturday”") && el.textContent.includes("Sunday works better for Lena"))`, 3000), `the note reaches ${who}'s window`);
  }

  step("the Friend's level");
  await sam.evaluate(`[...document.querySelectorAll(".talk-level-step")].find((b) => b.textContent === "Hand").click()`);
  assert.deepEqual(core.heard.filter((m) => m.type === "level").at(-1), { type: "level", level: "hand" });
  assert.ok(await maya.until(`document.querySelector('.talk-level-step[aria-checked="true"]')?.textContent === "Hand" && document.querySelector(".talk-meter-says").textContent.includes("Set by Sam")`, 3000), "Maya's meter shows Sam's level");
  await sam.evaluate(`[...document.querySelectorAll(".talk-level-step")].find((b) => b.textContent === "Speak").click()`);

  step("the 1440 shot: the Friend speaks, a turn waits below the read line");
  if (shots) {
    setPerson("Sam", { read: "c7" });
    tell();
    turn("c9", "Maya", "I can bring the speaker for music.");
    core.send({ type: "guide", kind: "caption", target: null, text: "Quick thing: Maya said Lena is away Saturday. Sunday works?", by: "Friend", at_ms: Date.now() });
    await sam.until(`!!document.querySelector(".talk-live-ai")`, 2000);
    await sleep(300);
    await shot(sam, "call-1440");
  }

  step("Maya leaves");
  await maya.close();
  pages.splice(pages.indexOf(maya), 1);
  assert.ok(await sam.until(`/Maya\s*left/.test(document.querySelector(".talk-people")?.textContent ?? "")`, 4000), `Sam sees Maya left: ${await text(sam, ".talk-person")} / ${JSON.stringify(people.map((p) => [p.name, p.here]))}`);
  console.log(`call-check: ok (the rules; two windows and a late one: the floor, the read line ${waiting}, catch up, a reply on both, the level${shots ? `; shots in ${shots}` : ""})`);
} catch (error) {
  failed = error;
} finally {
  core.close();
  await Promise.all(pages.map((p) => p.close().catch(() => {})));
}
if (failed) { console.error(`call-check: failed at “${doing}”`); console.error(failed.stack ?? failed.message); process.exit(1); }
