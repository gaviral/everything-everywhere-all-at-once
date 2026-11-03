// No extra dependencies: run with `node scripts/bricks-check.mjs` (every brick) or `node scripts/bricks-check.mjs <id>`
// (one brick, as its builder does: done when this passes). The rules of docs/bricks.md, held:
// 1. Every folder in ui/src/bricks is a brick: a brick.json the app accepts (bricks-core.ts `infoProblems`, the same
//    rule), and an index.tsx whose default export is the brick.
// 2. A brick imports from the app only ../contract; otherwise React, Motion, React Flow (a canvas: pan, zoom, drag)
//    and files in its own folder. No other brick, no package the app doesn't have.
// 3. Its CSS styles only its own classes: every selector names a class starting with its id, its keyframes too, and
//    every class it styles is one its code uses (as css-check holds the app's).
// 4. contract.ts runs no app code: what it takes from the app is types only.
// 5. In the built playground (headless Chrome): each brick mounts on a sample map, on an empty one and at a phone's
//    width without an error, with nothing running off the side; a view or a card shows something.
// 6. In the built app (all bricks): at their defaults they add nothing to the first screen; the Catalog lists every
//    brick; each view brick switched on joins Map and Palace, shows in the map's place and hands back to the map, and
//    stays on after a reload; `?level` still shows the Level meter, and without it there is none.
// Bubbles, beyond that: one bubble per thread, a landing ripples only its bubble (in the playground and from the core)
//    and moves none, and a bubble opens its thread on the map, moving your place there.
// Spine, beyond that: a head per topic and a card per tangent; a landing pulses its point once and moves nothing that
//    was there; a drag places a point where it's dropped (asked as a position, a mark left on its line) and its pin puts
//    it back; a thread opens on the map. Your thought on its way has a dashed slot (`data-slot="slot:<id>"`) under the
//    tip of the thread you're on, and lands in it with its landing note. It follows your talk; a hand on the map holds
//    it: a landing then moves nothing, and out of view gets an edge chip that stays until seen; the chip's click goes
//    there in 400 ms or less, and F follows again. Under Reduce Motion the camera cuts, with a ring for a second where it
//    went, and a landing rings without moving. In the app: a landing from the core pulses, a place someone else gave
//    moves the point there, and a drag reaches the core as a position.
//    Margin notes: double-click a point's words, take more with a shift-click or a drag (Esc lets them go), Reply, type,
//    Enter; the host is asked (`annotate`) for that thought, those words and that text, the words show underlined and the
//    note beside them, tied by a string from where they end; it stays over another landing and tucks under its point at
//    390 px; typing it moves no camera. In the app, notes are the map's (a thread tied to words in `anchors`): they stay over
//    a new snapshot and a reload, another person's unanswered question folds to "…?" until it's opened, while yours and an
//    answered one show.
//    Zoom stops: 1 2 3 are Words · Titles · Pictures and 0 sees all; each changes what's drawn, the control shows the one
//    that's on, and none fires while a field (the reply box, the app's composer) has the keyboard.
// Tiny transcript, beyond that: it takes the live words from the dock (`showsLiveWords`); nothing for a typed thought;
//    words said show as they come, and stay with the first-use hint after the turn until a click, which is for good;
//    the hint says what it is, and its slider has a label you can see. In the app: off, the dock's line has your words;
//    on, they show in it alone, inside the composer's box where its "Or type a thought" sits, a long turn's newest words
//    in view; your own typing keeps the box (the words wait above it); at a turn's end its words stay until its thought
//    comes, which takes them at once, and go by themselves when none does.
// Bubble flight, in the app: your thought lifts above the composer and drifts toward the Spine's slot; placed, it
//    glides into the slot in at most 400 ms, settles its words there and hands the ring to the Spine. Under Reduce
//    Motion there's no bubble until you ask: a hint comes once at a quiet pause, its switch keeps Show the flight,
//    Escape dismisses it for good, and the flight you asked for moves frame by frame even with CSS animations off.
// Countdown, beyond that: its deadlines kept in this browser (a store that throws changes nothing), the nearer first as
//    "<label> in 21 h 14 m" with past ones off, amber under three hours, a phone's one line with the label cut and the
//    time kept, the editor by keyboard; in the app the card and its editor cover no control of the page.
// The contract's own names (contract.ts), on a full run: its rules without a page (which brick added a thought, the
//    threads a brick is handed with each note's anchor, a note as the window sends it, a hint as the guide shows it);
//    in the playground, each event as a brick hears it and each action answered; in the app, the slots on today's
//    layout, "what just happened?" opening the Notice timeline (off: a notice says where to switch it on), and its
//    clock clear of Tiny transcript's line on a phone.
// Exit 3 (precheck's WARN) when 5 and 6 can't run here (no Chrome or no ui/dist); 1 to 4 must pass first either way.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { uiServer } from "./ui-server.mjs";
import { openPage, ready, sleep, standInCore } from "./headless.mjs";

const root = new URL("..", import.meta.url).pathname;
const bricksDir = join(root, "ui/src/bricks");
const only = process.argv[2];
const folders = readdirSync(bricksDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
if (only) assert.ok(folders.includes(only), `no folder ui/src/bricks/${only} (bricks: ${folders.join(", ")})`);
const checked = only ? [only] : folders;
const problems = [];
const fail = (where, what) => problems.push(`${where}: ${what}`);
const read = (path) => readFileSync(path, "utf8");
const filesIn = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? filesIn(join(dir, d.name)).map((f) => join(d.name, f)) : [d.name]);

// 1. brick.json and index.tsx, judged by the app's own rule.
globalThis.location = new URL("http://localhost:4321/");
const server = await uiServer();
let infos = {};
try {
  const { infoProblems, discover } = await server.ssrLoadModule("/src/bricks-core.ts");
  for (const folder of folders) {
    const dir = join(bricksDir, folder);
    let info = null;
    try { info = JSON.parse(read(join(dir, "brick.json"))); } catch (error) { if (checked.includes(folder)) fail(folder, `brick.json: ${existsSync(join(dir, "brick.json")) ? error.message : "missing"}`); }
    if (!info) continue;
    infos[`./bricks/${folder}/brick.json`] = info;
    if (!checked.includes(folder)) continue;
    for (const wrong of infoProblems(info, folder)) fail(folder, `brick.json: ${wrong}`);
    if (!existsSync(join(dir, "index.tsx"))) fail(folder, "no index.tsx");
    else if (!/^export default\b/m.test(read(join(dir, "index.tsx")))) fail(folder, "index.tsx has no default export (the brick's component)");
  }
  // Across bricks: no two take the same address flag (the app's discover says so as it loads them).
  const loaders = Object.fromEntries(folders.filter((f) => existsSync(join(bricksDir, f, "index.tsx"))).map((f) => [`./bricks/${f}/index.tsx`, async () => ({})]));
  const { problems: across } = discover(infos, loaders);
  for (const [folder, wrong] of Object.entries(across)) for (const w of wrong) if (/^flag ?/.test(w) && / too$/.test(w) && checked.includes(folder)) fail(folder, w);
  if (!only) await contractRules(server);
} finally {
  await server.close();
}

/** The contract's rules, without a page (contract.ts, through Vite as the app runs them). */
async function contractRules(server) {
  const { senders } = await server.ssrLoadModule("/src/bricks-core.ts");
  const notes = await server.ssrLoadModule("/src/annotate-core.ts");
  const guide = await server.ssrLoadModule("/src/guide-core.ts");
  // `landed`'s `by`: the thought that comes back with a brick's words, yours and new, is that brick's; so is the rest of
  // it the placer cut off; not someone else's words, nor yours long after, nor a snapshot's.
  const template = { id: "_template", name: "Template" };
  const yours = (id, text, at_ms = 5, speaker = "you") => ({ id, speaker, text, placed: false, thread_id: null, at_ms });
  const sent = senders();
  sent.see([], "you", 0, 1);
  sent.sent("Ask Priya  about the slides", template, 1000);
  sent.see([yours("t1", "Ask Priya about the slides")], "you", 1500, 1);
  assert.equal(sent.by("t1"), template, "a brick's thought is that brick's");
  sent.see([yours("t1", "Ask Priya"), yours("t2", "about the slides")], "you", 1600, 1);
  assert.equal(sent.by("t2"), template, "and so is the rest the placer cut off");
  sent.sent("Water the plants", template, 2000);
  sent.see([yours("t1", "Ask Priya"), yours("t2", "about the slides"), yours("t3", "Water the plants", 9, "Sam")], "you", 2100, 1);
  assert.equal(sent.by("t3"), undefined, "someone else's words aren't the brick's");
  sent.see([yours("t4", "Water the plants", 10)], "you", 2000 + 61_000, 1);
  assert.equal(sent.by("t4"), undefined, "yours a minute later aren't");
  sent.sent("Book the room for Thursday", template, 62_000);
  sent.see([yours("t6", "the room", 12)], "you", 62_100, 1);
  assert.equal(sent.by("t6"), undefined, "your few words inside a brick's aren't its");
  const long = `${"word ".repeat(1300)}end`;
  sent.sent(long, template, 63_000);
  sent.see([yours("t7", long.slice(0, 6000).trim(), 13), yours("t8", long.slice(6000).trim(), 14)], "you", 63_100, 1);
  assert.deepEqual([sent.by("t7"), sent.by("t8")], [template, template], "each part of one sent in parts is the brick's");
  sent.sent("Call mom", template, 70_000);
  sent.see([yours("t5", "Call mom", 11)], "you", 70_100, 2);
  assert.equal(sent.by("t5"), undefined, "a snapshot's thoughts are only learned");
  // The threads a brick is handed: a note's with its anchor, the same array while nothing changes.
  const threadsFor = notes.anchoredThreads();
  const threads = [{ id: "T1" }, { id: "N3" }], anchors = { N3: { thought_id: "a", quote: "the lease" } };
  const handed = threadsFor(threads, anchors);
  assert.equal(threadsFor(threads, anchors), handed, "the same array while neither changes");
  assert.deepEqual([handed[0], handed[1].anchor], [threads[0], anchors.N3]);
  assert.equal(notes.anchoredThreads()(threads, undefined), threads, "no notes: the map's own array");
  // A note as the window sends it, bounded as the core bounds it.
  assert.deepEqual(JSON.parse(notes.annotateMessage("a", " the\n lease ", " Month to month? ").message), { type: "annotate", thought_id: "a", quote: "the lease", text: "Month to month?" });
  for (const [quote, text] of [["", "x"], ["the lease", "  "], ["the lease", "x".repeat(6001)], ["y".repeat(6001), "x"]]) assert.ok("refused" in notes.annotateMessage("a", quote, text), `sent: ${quote.slice(0, 9)} ${text.slice(0, 9)}`);
  // A hint as the guide shows it: an arrow at a part, or a caption; refused, nothing shows.
  const points = [];
  const stop = guide.watchPoint((point) => points.push(point && { target: point.target, text: point.text, by: point.by }));
  assert.equal(guide.showHint("Drag  to resize", "tiny-transcript:size", "Tiny transcript"), true);
  assert.deepEqual(points.at(-1), { target: "tiny-transcript:size", text: "Drag to resize", by: "Tiny transcript" });
  assert.equal(guide.showHint("Said in the corner", null, "Template"), true);
  for (const [text, target] of [["two\nlines", "composer"], ["x".repeat(141), "composer"], ["x", "not a name!"], ["   ", null], ["x", ""]]) {
    assert.equal(guide.showHint(text, target, "Template"), false, `shown: ${JSON.stringify([text.slice(0, 9), target])}`);
  }
  assert.equal(points.length, 1, "a caption or a refused hint points at nothing");
  guide.dismissPoint();
  assert.equal(points.at(-1), null, "taken down: pointing at nothing");
  stop();
  // The slot names in contract.ts are the ones docs/bricks.md lists.
  const contractSlots = [...read(join(bricksDir, "contract.ts")).match(/export const SLOTS = \[([^\]]*)\]/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const listed = [...read(join(root, "docs/bricks.md")).matchAll(/^\| `([^`]+)` \| .* \| .* \|$/gm)].map((m) => m[1]).filter((name) => !name.startsWith("slot:"));
  assert.deepEqual(listed, contractSlots, "docs/bricks.md lists contract.ts's slots, in its order");
}

// 2. Imports. 3. CSS. Per checked brick.
const PACKAGES = ["react", "react-dom", "react/jsx-runtime", "motion/react", "@xyflow/react", "@xyflow/react/dist/base.css"];
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\w"'`\\])\/\/.*$/gm, "$1");

/** What's wrong with one source file of the brick in `dir` (`file`, relative to it; `text`, comments out). */
function sourceProblems(dir, file, text) {
  const out = [];
  const specs = [...text.matchAll(/\bfrom\s*["']([^"']+)["']/g), ...text.matchAll(/\bimport\s*["']([^"']+)["']/g), ...text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
  for (const spec of specs) {
    if (PACKAGES.includes(spec)) continue;
    // Relative: inside the brick's own folder, or the contract beside it.
    const to = spec.startsWith(".") ? resolve(dir, dirname(file), spec) : "";
    if (to && (to.startsWith(`${dir}/`) || to === join(bricksDir, "contract") || to === join(bricksDir, "contract.ts"))) continue;
    out.push(`imports "${spec}": a brick takes from the app only ../contract; otherwise React, Motion, React Flow and its own files`);
  }
  // The page has one header, the app's: the map measures every <header> to keep a landing clear of it (App.tsx
  // `mapTop`), and styles.css styles them all.
  if (/<header\b/.test(text)) out.push("draws a <header>: use a div (the app's header is the page's only one)");
  // A part's name for a hint or the guide: the brick's own, starting with its id, or a thread's or point's (a view's).
  const own = dir.split("/").at(-1).replace(/^_/, "");
  for (const [, name] of text.matchAll(/data-guide=\{?\s*["'`]([^"'`$]*)/g)) {
    if (!(name === own || name.startsWith(`${own}:`) || name.startsWith(`${own}-`) || name.startsWith("thread:") || name.startsWith("point:"))) {
      out.push(`data-guide="${name}": a brick's own parts are named starting with "${own}" (threads and points: thread:<id>, point:<id>)`);
    }
  }
  return out;
}

/** What's wrong with one of the brick's stylesheets (`css`, comments out): `prefix` is its id without "_", `words` every
 *  word in its code's strings. */
function sheetProblems(css, prefix, words) {
  const out = [];
  const mine = (name) => name === prefix || name.startsWith(`${prefix}-`);
  for (const [, name] of css.matchAll(/@keyframes\s+([\w-]+)/g)) if (!mine(name)) out.push(`@keyframes ${name}: keyframes are page-wide, so its name starts with "${prefix}-"`);
  // Every rule's selectors, inside @media, @container and @supports too; a keyframes block's steps aren't selectors.
  const body = css.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  for (const [, selectors] of body.matchAll(/([^{};@]+?)\s*\{[^{}]*\}/g)) {
    for (const selector of selectors.split(/,(?![^(]*\))/).map((s) => s.trim()).filter(Boolean)) {
      if (![...selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].some((m) => mine(m[1]))) out.push(`"${selector}" styles more than this brick: every selector names a class starting with "${prefix}"`);
    }
  }
  for (const name of new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]))) if (!words.has(name)) out.push(`.${name} is styled but no code in the brick uses it`);
  return out;
}
const wordsIn = (text) => new Set([...text.matchAll(/"([^"\\\n]*)"|'([^'\\\n]*)'|`([^`\\]*)`/g)].map((m) => (m[1] ?? m[2] ?? m[3]).replace(/\$\{[^}]*\}/g, " ")).flatMap((s) => s.trim().split(/\s+/)));

// The net catches what it says it does: each kind of breach, planted in a brick named "pin", is caught.
{
  const dir = join(bricksDir, "pin");
  for (const planted of [`import { World } from "../../core";`, `import x from "../bubbles/index";`, `import lodash from "lodash";`, `const m = import("../../App");`, `return <header>Pin</header>;`,
    `return <i data-guide="composer" />;`, `return <i data-guide={\`mic\`} />;`]) {
    assert.ok(sourceProblems(dir, "index.tsx", planted).length, `the check misses: ${planted}`);
  }
  for (const fine of [`import { useState } from "react";`, `import { useBrickEvent } from "../contract";`, `import "./pin.css";`, `import { motion } from "motion/react";`,
    `import { ReactFlow } from "@xyflow/react";`, `import "@xyflow/react/dist/base.css";`, `return <i data-guide="pin" />;`, `return <i data-guide="pin:size" />;`,
    `return <i data-guide={\`point:\${id}\`} />;`]) {
    assert.deepEqual(sourceProblems(dir, "index.tsx", fine), [], `the check refuses: ${fine}`);
  }
  assert.deepEqual(sourceProblems(dir, "parts/more.tsx", `import { a } from "../index";`), [], "a file in a subfolder may import the brick's own files");
  const used = wordsIn(`"pin pin-ring on"`);
  for (const planted of [".thread { display: none; }", "button { color: red; }", ".pin, .map { color: red; }", "@keyframes spin { to { rotate: 1turn; } }",
    "@media (max-width: 560px) { .palette { color: red; } }", ".pin-gone { color: red; }"]) {
    assert.ok(sheetProblems(planted, "pin", used).length, `the check misses: ${planted}`);
  }
  for (const fine of [".pin { color: red; }", ".pin-ring.on, .pin:hover .pin-ring { color: red; }", "@container (min-width: 84px) { .pin-ring { display: none; } }",
    "@keyframes pin-spin { from { rotate: 0; } to { rotate: 1turn; } }"]) {
    assert.deepEqual(sheetProblems(fine, "pin", used), [], `the check refuses: ${fine}`);
  }
}

for (const folder of checked) {
  const dir = join(bricksDir, folder);
  const files = filesIn(dir);
  let used = "";
  for (const file of files.filter((f) => /\.tsx?$/.test(f))) {
    const text = code(read(join(dir, file)));
    used += `\n${text}`;
    for (const wrong of sourceProblems(dir, file, text)) fail(`${folder}/${file}`, wrong);
  }
  const words = wordsIn(used);
  for (const sheet of files.filter((f) => f.endsWith(".css"))) {
    for (const wrong of sheetProblems(read(join(dir, sheet)).replace(/\/\*[\s\S]*?\*\//g, ""), folder.replace(/^_/, ""), words)) fail(`${folder}/${sheet}`, wrong);
  }
}

// 4. The contract runs nothing of the app's: types only from it, React's hooks for useBrickEvent.
const contract = read(join(bricksDir, "contract.ts"));
for (const [line, spec] of [...contract.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => [m[0], m[1]])) {
  if (spec !== "react") fail("contract.ts", `${line.trim()}: only types come from the app`);
}

assert.deepEqual(problems, [], `\n${problems.join("\n")}\n`);
const kinds = Object.values(infos).map((i) => i.kind);
const why = ready() || (existsSync(join(root, "ui/dist/bricks.html")) ? "" : "no ui/dist/bricks.html (build the UI first)");
if (why) { console.log(`SKIP bricks-check pages: ${why} (the folders' rules pass: ${checked.length} bricks)`); process.exit(3); }

// 5. Each brick in the built playground: a sample map, an empty one, a phone's width.
const now = Date.now();
const thread = (id, title, extra = {}) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "", ...extra });
const thought = (id, text, thread_id) => ({ id, speaker: "you", text, point: text, thread_id, placed: true, unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: now, place_ms: 2000, decided: false });
const app = (id, name, watcher, enabled) => ({ id, name, purpose: `${name}.`, watcher, prompt: null, publishers: [{ kind: "card", text: "" }], enabled, request: "", cooldown_secs: 60, created_ms: 0, last_run_ms: 0 });
const seeds = [app("app-argument", "Argument resolver", { kind: "new_thought", min_points: 2 }, false), app("app-volume", "Volume watcher", { kind: "volume", level: 0.087, seconds: 3 }, false),
  app("app-search", "Search-first", { kind: "app_request" }, true)];
const titles = ["Rent due Friday", "Garden plans", "Trip to Lisbon", "Pottery class", "Mia's birthday"];
const world = (threads) => ({ threads, thoughts: threads.flatMap((t, i) => Array.from({ length: i + 1 }, (_, n) => thought(`${t.id}-${n}`, `${t.title}, point ${n + 1}`, t.id))),
  active: threads[0]?.id ?? null, active_by: threads[0] ? { you: threads[0].id } : {}, suggestions: [], actions: [], merged: {}, apps: seeds, apps_seeded: true, recaps: [], notes: {}, proposals: [] });
const full = world([...titles.map((title, i) => thread(`T${i + 1}`, title)), thread("T6", "Garden soil", { parent_id: "T2" })]);
const empty = world([]);
let shown = full;
const core = await standInCore(() => [{ type: "snapshot", world: shown }]);
const base = `http://127.0.0.1:${core.port}`;
const page = await openPage(`${base}/bricks.html`, { width: 1280, height: 860 });
const { evaluate, until, page: cdp } = page;
const settle = () => evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`).then(() => sleep(250));
const go = async (url) => { await cdp("Page.navigate", { url }); await sleep(150); };
const width = (w, h) => cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
// Every way out ends the page, the browser and the stand-in core: the `finally` below, and the one-brick run, which exits
// from inside the try (process.exit skips a `finally` and would leave a headless Chrome running).
const cleanup = async () => { try { await page.close(); } finally { core.close(); } };
try {
  // Notice timeline: a panel fed by the app's notices (on("notice")), so it's checked in the app. On an empty map and a
  // full one: no clock before a notice; your ask opens the list (empty, it says so) and leaves focus where you typed,
  // someone else's doesn't; a burst keeps each one, the same words twice and an error in the lane's words; the newest 50;
  // a map update; Esc (focus back to the clock) and a click outside close it; at 320, 390 and 1280 px, dark, with
  // reduced motion, the list stays in the window, scrolls and opens without motion.
  if (checked.includes("notice-timeline")) {
    if (infos["./bricks/notice-timeline/brick.json"].kind !== "panel") fail("notice-timeline", "brick.json: a panel, as its spec says");
    const previousSwitches = await evaluate(`localStorage.getItem("e2a2o.bricks")`);
    await evaluate(`localStorage.setItem("e2a2o.bricks", JSON.stringify({ "notice-timeline": true }))`);
    // "What just happened?" is the core's command: it tells only the asker's windows (a view), and lands nothing. The
    // same words from someone else are only their thought.
    const ask = (id, speaker = "you") => speaker === "you" ? core.send({ type: "view", view: "notices" })
      : core.send({ type: "change", change: { type: "thought_added", thought: { ...thought(id, "What just happened?", null), placed: false, speaker } } });
    const entries = `[...document.querySelectorAll(".notice-timeline-entry")].map((li) => ({ text: li.querySelector(".notice-timeline-text").textContent, kind: li.dataset.kind }))`;
    for (const [label, seed] of [["empty", empty], ["full", full]]) {
      const where = `notice-timeline (${label} map)`;
      shown = seed;
      await go(`${base}/`);
      if (!await until(`!!document.querySelector(".notice-timeline")`, 8000)) { fail(where, "never mounted"); continue; }
      if (await evaluate(`!!document.querySelector(".notice-timeline-clock")`)) fail(where, "a clock before any notice");
      await evaluate(`document.querySelector(".composer textarea, .composer input")?.focus()`);
      ask(`ask-${label}`);
      if (!await until(`!!document.querySelector(".notice-timeline-empty")`, 3000)) fail(where, "your ask before any notice doesn't open the list, saying it's empty");
      if (!await evaluate(`!!document.activeElement?.closest(".composer")`)) fail(where, "your ask took focus from the composer");
      await evaluate(`document.querySelector(".notice-timeline-close").click()`);
      core.send({ type: "notice", message: "First notice" });
      if (!await until(`!!document.querySelector(".notice-timeline-clock") && !document.querySelector(".notice-timeline-panel")`, 3000)) fail(where, "× doesn't close the list, or a notice brings no clock");
      // One burst, one render: none may be lost, the same words twice included.
      for (const message of ["Repeated notice", "Repeated notice"]) core.send({ type: "notice", message });
      core.send({ type: "error", message: "Couldn't place a thought: the model timed out" });
      await evaluate(`document.querySelector(".notice-timeline-clock").click()`);
      if (!await until(`document.querySelectorAll(".notice-timeline-entry").length === 4 && document.activeElement === document.querySelector(".notice-timeline-panel")`, 3000)) fail(where, "the clock opens no list, or the list doesn't take focus");
      const burst = JSON.stringify(await evaluate(entries));
      if (burst !== JSON.stringify([{ text: "Couldn't place a thought. It's saved and will retry automatically.", kind: "error" },
        { text: "Repeated notice", kind: "notice" }, { text: "Repeated notice", kind: "notice" }, { text: "First notice", kind: "notice" }])) fail(where, `a burst kept as ${burst}`);
      await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
      if (!await until(`!document.querySelector(".notice-timeline-panel") && document.activeElement === document.querySelector(".notice-timeline-clock")`, 2000)) fail(where, "Esc doesn't close the list, focus back on the clock");
      for (let i = 0; i < 55; i++) core.send({ type: "notice", message: `Kept ${i}` });
      await until(`document.querySelector(".notice > span")?.textContent === "Kept 54"`, 3000);
      ask(`ask-other-${label}`, "Sam");
      await settle();
      if (await evaluate(`!!document.querySelector(".notice-timeline-panel")`)) fail(where, "someone else's ask opens your list");
      ask(`ask-again-${label}`);
      if (!await until(`!!document.querySelector(".notice-timeline-panel")`, 3000)) fail(where, "your ask doesn't open the list");
      const kept = (await evaluate(entries)).map((entry) => entry.text);
      if (kept.length !== 50 || kept[0] !== "Kept 54" || kept.at(-1) !== "Kept 5") fail(where, `keeps ${kept.length}, ${kept[0]} to ${kept.at(-1)}, not the newest 50`);
      await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }, { name: "prefers-reduced-motion", value: "reduce" }] });
      for (const [w, h] of [[320, 568], [390, 844], [1280, 860]]) {
        await width(w, h);
        await settle();
        const box = await evaluate(`(() => { const p = document.querySelector(".notice-timeline-panel"), r = p.getBoundingClientRect(), s = getComputedStyle(p);
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, scrolls: p.scrollHeight > p.clientHeight, sideways: document.documentElement.scrollWidth - innerWidth,
            animation: s.animationName, transition: s.transitionDuration }; })()`);
        if (box.left < 15 || box.right > w - 15 || box.top < 0 || box.bottom > h || box.sideways > 1) fail(where, `the list leaves the window at ${w} px: ${JSON.stringify(box)}`);
        if (!box.scrolls || box.animation !== "none" || box.transition !== "0s") fail(where, `at ${w} px the list doesn't scroll, or moves as it opens`);
      }
      await evaluate(`document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))`);
      if (!await until(`!document.querySelector(".notice-timeline-panel")`, 2000)) fail(where, "a click outside doesn't close the list");
      if (seed === full) {
        core.send({ type: "change", change: { type: "thread_retitled", thread_id: "T1", was: titles[0], title: "Rent paid" } });
        await until(`document.querySelector(".map-change")?.textContent.includes("Rent paid")`, 3000);
        await evaluate(`document.querySelector(".notice-timeline-clock").click()`);
        if (!await until(`document.querySelector('.notice-timeline-entry[data-kind="map-change"]')?.textContent.includes("Rent paid")`, 3000)) fail(where, "a map update isn't kept");
      }
      if (await evaluate(`!!document.querySelector(".brick-broke")`)) fail(where, "it broke");
      await cdp("Emulation.setEmulatedMedia", { features: [] });
    }
    await evaluate(previousSwitches === null ? `localStorage.removeItem("e2a2o.bricks")` : `localStorage.setItem("e2a2o.bricks", ${JSON.stringify(previousSwitches)})`);
    shown = full;
  }
  for (const folder of checked) {
    const info = infos[`./bricks/${folder}/brick.json`];
    for (const [sample, w] of [["student-week", 1280], ["empty", 1280], ["student-week", 390]]) {
      const where = `${folder} in the playground (${sample}, ${w} px)`;
      await width(w, w < 600 ? 844 : 860);
      await go(`${base}/bricks.html?brick=${folder}&sample=${sample}`);
      if (!await until(`document.querySelector(".playground")?.dataset.brickShown === ${JSON.stringify(folder)}`, 8000)) { fail(where, "the playground never showed it"); continue; }
      await settle();
      const state = await evaluate(`(() => {
        const mount = document.querySelector('[data-brick="${folder}"]');
        return { broke: document.querySelector(".brick-broke")?.textContent ?? "", errors: document.querySelector(".playground").dataset.errors,
          mounted: !!mount, shows: !!mount && (mount.textContent.trim().length > 0 || mount.querySelector("svg, canvas, img, video") !== null),
          sideways: document.documentElement.scrollWidth - innerWidth };
      })()`);
      if (state.broke) fail(where, `it broke: "${state.broke}"`);
      if (state.errors !== "0") fail(where, `${state.errors} errors (the playground's log says which)`);
      if (!state.mounted) fail(where, "not mounted");
      if ((info.kind === "view" || info.kind === "card") && !state.shows) fail(where, `a ${info.kind} that shows nothing`);
      if (state.sideways > 1) fail(where, `the page scrolls sideways by ${state.sideways} px`);
    }
  }
  // The proof bricks do what they say: the template hears a landing; Bubbles ripples where a thought lands.
  await width(1280, 860);
  // Countdown: a panel that keeps its deadlines in this browser (`e2a2o.countdown`). Its logic runs in the playground on
  // a clock the check holds (and ticks by hand, as the 30 s timer and a return to the tab would): an empty store says
  // "No deadlines" and Add (Enter opens the editor, Add adds a row, a change and Remove are kept, Esc gives focus back
  // to the card); two deadlines and a past one show the nearer first, "<label> in 21 h 14 m" and "in 2 d 5 h", on a
  // real button naming both, in plain ink, a saved instant shown in local time; the minutes round down ("in 60 min"
  // never, "in 1 min" for the last); amber from under three hours, light and dark, nothing moving; the time brought up
  // to date by the timer and by a return to the tab, past ones off; on a phone one line and the nearest only, a long
  // label cut and its time kept; a store that throws still lets you add one and see it. In the app, where the page's own
  // controls are, the card and its editor stay in the window and cover none of them, at 1440, 1024, 390 and 320 px.
  if (checked.includes("countdown")) {
    const where = "countdown";
    const info = infos["./bricks/countdown/brick.json"];
    if (info.kind !== "panel" || info.defaultOn !== false || info.demoSafe !== true || info.name !== "Countdown") fail(where, "brick.json: Countdown must be a demo-safe panel, off by default");
    // What the check changes in this browser's storage, put back at the end.
    const keys = ["e2a2o.countdown", "e2a2o.bricks", "e2a2o.toured"];
    const saved = JSON.parse(await evaluate(`JSON.stringify(${JSON.stringify(keys)}.map((key) => localStorage.getItem(key)))`));
    const fixed = Date.UTC(2030, 4, 7, 12);
    const hour = 3_600_000, minute = 60_000;
    const entry = (label, ms) => ({ label, at: new Date(fixed + ms).toISOString() });
    let injected;
    // The playground with this store (and its clock held at `fixed`, `window.countdownNow` to move it, `countdownTick` the
    // brick's own 30 s timer) before the brick starts, or with its storage throwing.
    const load = async (entries, throws = false) => {
      // A script for every new document only runs once the Page domain is enabled.
      await cdp("Page.enable");
      if (injected) await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: injected });
      ({ identifier: injected } = await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `
        localStorage.setItem("e2a2o.countdown", ${JSON.stringify(JSON.stringify(entries))});
        window.countdownNow = ${fixed};
        Date.now = () => window.countdownNow;
        const interval = window.setInterval;
        window.setInterval = (fn, ms, ...args) => {
          if (ms === 30000) window.countdownTick = fn;
          return interval(fn, ms, ...args);
        };
        ${throws ? `for (const method of ["getItem", "setItem"]) {
          const original = Storage.prototype[method];
          Storage.prototype[method] = function(key, ...args) {
            if (key === "e2a2o.countdown") throw new Error("Storage unavailable");
            return original.call(this, key, ...args);
          };
        }` : ""}
      ` }));
      await go(`${base}/bricks.html?brick=countdown&sample=empty`);
      if (!await until(`!!document.querySelector(".countdown-card")`, 8000)) fail(where, "never mounted");
      await settle();
    };
    /** Moves the held clock, and has the brick's timer fire. */
    const tick = (ms) => evaluate(`window.countdownNow = ${fixed + ms}; window.countdownTick?.()`);
    const nearest = () => evaluate(`document.querySelector(".countdown-nearest")?.textContent ?? null`);
    const input = (selector, value) => evaluate(`(() => {
      const field = document.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, ${JSON.stringify(value)});
      field.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    const edit = async () => {
      await evaluate(`document.querySelector(".countdown-card").focus()`);
      // A key press that types ("\r") is the one a button answers with a click.
      for (const type of ["keyDown", "keyUp"]) await cdp("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, ...(type === "keyDown" ? { text: "\r" } : {}) });
      if (!await until(`!!document.querySelector(".countdown-editor")`, 2000)) fail(where, "Enter doesn't open the editor");
    };
    const escape = () => evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    try {
      await cdp("Emulation.setTimezoneOverride", { timezoneId: "America/Vancouver" });
      await load([]);
      if (!await evaluate(`document.querySelector(".countdown-card").textContent.includes("No deadlines") && document.querySelector(".countdown-add-label").textContent === "Add"`)) fail(where, "empty store doesn't show No deadlines and Add");
      await edit();
      if (!await evaluate(`document.activeElement === document.querySelector(".countdown-add")`)) fail(where, "empty editor doesn't focus Add");
      await evaluate(`document.querySelector(".countdown-add").click()`);
      if (!await until(`document.activeElement === document.querySelector('.countdown-field input[type="text"]')`, 2000)) fail(where, "a new row doesn't take focus in its label");
      await input('.countdown-field input[type="text"]', "Feature freeze");
      await input('.countdown-field input[type="datetime-local"]', "2030-05-08T10:15");
      if (!await until(`JSON.parse(localStorage.getItem("e2a2o.countdown"))[0]?.label === "Feature freeze" && JSON.parse(localStorage.getItem("e2a2o.countdown"))[0]?.at === "2030-05-08T17:15:00.000Z"`, 2000)) fail(where, "changes aren't saved, or local time isn't converted correctly");
      await evaluate(`document.querySelector(".countdown-remove").click()`);
      if (!await until(`localStorage.getItem("e2a2o.countdown") === "[]" && !document.querySelector(".countdown-row") && document.activeElement === document.querySelector(".countdown-add")`, 2000)) fail(where, "Remove doesn't save, or doesn't leave focus on Add");
      await escape();
      if (!await until(`!document.querySelector(".countdown-editor") && document.activeElement === document.querySelector(".countdown-card")`, 2000)) fail(where, "Esc doesn't close and return focus");

      await load([entry("Submission", 53 * hour), entry("Already done", -hour), entry("Feature freeze", 21 * hour + 14 * minute)]);
      const lines = await evaluate(`[...document.querySelectorAll(".countdown-nearest, .countdown-next")].map((line) => line.textContent)`);
      if (JSON.stringify(lines) !== JSON.stringify(["Feature freeze in 21 h 14 m", "Submission in 2 d 5 h"])) fail(where, `wrong order, formatting or expired deadline: ${JSON.stringify(lines)}`);
      const accessible = await evaluate(`(() => { const b = document.querySelector(".countdown-card"); return b.tagName === "BUTTON" && b.getAttribute("aria-label").includes("Feature freeze in 21 h 14 m") && b.getAttribute("aria-label").includes("Submission in 2 d 5 h") && !document.querySelector(".countdown [aria-live], .countdown [role=status], .countdown [role=alert]"); })()`);
      if (!accessible) fail(where, "needs a real button with the full text and no live announcements");
      if (!await evaluate(`getComputedStyle(document.querySelector(".countdown-nearest")).color === getComputedStyle(document.querySelector(".countdown-card")).color`)) fail(where, "a distant deadline doesn't use plain ink");
      await edit();
      if (!await evaluate(`document.querySelector('input[type="datetime-local"]').value === "2030-05-09T10:00"`)) fail(where, "saved dates aren't displayed in local time");
      await evaluate(`document.querySelector(".countdown-close").click()`);

      // Where it changes unit: days only over 48 h; the minutes round down, never 60, never 0. (`left`: the time left.)
      await load([entry("Later", 49 * hour)]);
      for (const [left, text] of [[49 * hour, "2 d 1 h"], [48 * hour + minute, "2 d 0 h"], [48 * hour, "48 h 0 m"], [hour, "1 h 0 m"], [59.5 * minute, "59 min"], [30_000, "1 min"]]) {
        await tick(49 * hour - left);
        if (!await until(`document.querySelector(".countdown-nearest")?.textContent === ${JSON.stringify(`Later in ${text}`)}`, 2000)) fail(where, `with ${left / minute} min left it says ${JSON.stringify(await nearest())}, not "Later in ${text}"`);
      }

      // A phone: one line and the nearest only; a long label gives way and the time stays.
      await load([entry("Submission", 53 * hour), entry("Feature freeze", 21 * hour + 14 * minute)]);
      await width(390, 844);
      const phone = await evaluate(`(() => {
        const b = document.querySelector(".countdown-card"), r = b.getBoundingClientRect(), n = document.querySelector(".countdown-nearest");
        return { next: getComputedStyle(document.querySelector(".countdown-next")).display, oneLine: n.getBoundingClientRect().height <= parseFloat(getComputedStyle(n).lineHeight) + 1,
          fits: r.left >= 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth + 1 };
      })()`);
      if (phone.next !== "none" || !phone.oneLine || !phone.fits) fail(where, `phone card isn't one line with only the nearest: ${JSON.stringify(phone)}`);
      await edit();
      if (!await evaluate(`(() => { const r = document.querySelector(".countdown-editor").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()`)) fail(where, "phone editor leaves the screen");
      await load([entry("A deadline named with far more words than one line of a phone's width can hold", 2 * hour)]);
      const long = await evaluate(`(() => {
        const card = document.querySelector(".countdown-card").getBoundingClientRect(), label = document.querySelector(".countdown-label"), time = document.querySelector(".countdown-time");
        return { cut: label.scrollWidth > label.clientWidth, timeInside: time.getBoundingClientRect().right <= card.right && time.getBoundingClientRect().left >= card.left, time: time.textContent };
      })()`);
      if (!long.cut || !long.timeInside || long.time !== "in 2 h 0 m") fail(where, `a long label should be cut and its time kept: ${JSON.stringify(long)}`);
      await width(1280, 860);

      await load([entry("Soon", 3 * hour), entry("Later", 5 * hour)]);
      if (await evaluate(`!!document.querySelector(".countdown-nearest.countdown-soon")`)) fail(where, "amber begins before under three hours");
      await tick(minute);
      if (!await until(`!!document.querySelector(".countdown-nearest.countdown-soon")`, 2000)) fail(where, "30 s timer isn't registered or doesn't refresh");
      for (const scheme of ["light", "dark"]) {
        await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "reduce" }] });
        const appearance = await evaluate(`(() => {
          const line = document.querySelector(".countdown-nearest"), probe = document.createElement("span");
          probe.style.color = "var(--amber)"; document.body.append(probe);
          const amber = getComputedStyle(probe).color; probe.remove();
          return { amber: getComputedStyle(line).color === amber,
            still: [...document.querySelectorAll(".countdown, .countdown *")].every((el) => getComputedStyle(el).animationName === "none" && getComputedStyle(el).transitionDuration === "0s") };
        })()`);
        if (!appearance.amber || !appearance.still) fail(where, `${scheme}: not app amber or moves under reduced motion`);
      }
      await evaluate(`window.countdownNow = ${fixed + 3 * hour + 18 * minute}; document.dispatchEvent(new Event("visibilitychange"))`);
      if (!await until(`document.querySelector(".countdown-nearest")?.textContent === "Later in 1 h 42 m" && !document.querySelector(".countdown-next")`, 2000)) fail(where, "returning to the visible tab doesn't drop past deadlines immediately");
      await tick(4 * hour + 18 * minute);
      if (!await until(`document.querySelector(".countdown-nearest")?.textContent === "Later in 42 min"`, 2000)) fail(where, "under one hour doesn't use minutes");
      await tick(5 * hour);
      if (!await until(`!!document.querySelector(".countdown-empty")`, 2000)) fail(where, "expired deadlines don't leave No deadlines");

      await load([], true);
      await edit();
      await evaluate(`document.querySelector(".countdown-add").click()`);
      await input('.countdown-field input[type="text"]', "Still works");
      if (!await until(`document.querySelector(".countdown-nearest")?.textContent === "Still works in 1 h 0 m"`, 2000)) fail(where, "throwing storage prevents editing in memory");
      if (await evaluate(`!!document.querySelector(".brick-broke") || document.querySelector(".playground").dataset.errors !== "0"`)) fail(where, "throwing storage crashes or logs an uncaught error");

      // In the app, which has controls of its own: the card sits above the dock and covers none, and its editor, at its
      // tallest (six rows), stays under the header and above the card, covering none of the dock's.
      await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: injected });
      injected = undefined;
      await cdp("Emulation.setTimezoneOverride", { timezoneId: "" });
      await cdp("Emulation.setEmulatedMedia", { features: [] });
      await go(`${base}/bricks.html`); // A page with the real clock and storage again.
      const rows = ["Feature freeze", "Submission", "Demo video", "Pitch", "Practice", "Thank-you notes"].map((label, i) => ({ label, at: new Date(Date.now() + (21 + 9 * i) * hour + 14 * minute).toISOString() }));
      await evaluate(`localStorage.setItem("e2a2o.bricks", JSON.stringify({ countdown: true })); localStorage.setItem("e2a2o.toured", "1"); localStorage.setItem("e2a2o.countdown", ${JSON.stringify(JSON.stringify(rows))})`);
      shown = full;
      // What a person touches in the page's fixed parts and first screen, found by their parts' names.
      const controls = `(() => {
        scrollTo(0, 0);
        const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
        return [...document.querySelectorAll("header, .apps-panel, .map-tools, .dock")].flatMap((part) => [...part.querySelectorAll("button, input, textarea, select, a[href]")])
          .filter((el) => !el.closest(".countdown") && getComputedStyle(el).visibility !== "hidden").map((el) => ({ name: (el.getAttribute("aria-label") || el.textContent || el.placeholder || el.tagName).trim().slice(0, 24), part: el.closest("header, .apps-panel, .map-tools, .dock").className || "header", box: box(el) }))
          .filter(({ box: b }) => b.right - b.left > 1 && b.bottom - b.top > 1 && b.right > 0 && b.left < innerWidth && b.bottom > 0 && b.top < innerHeight);
      })()`;
      const meets = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
      for (const [w, h] of [[1440, 900], [1024, 768], [390, 844], [320, 568]]) {
        const at = `countdown in the app at ${w} px`;
        await width(w, h);
        await go(`${base}/`);
        if (!await until(`!!document.querySelector(".countdown-card") && !!document.querySelector(".dock")`, 8000)) { fail(at, "no card"); continue; }
        await settle();
        const all = await evaluate(controls);
        if (all.length < 6) fail(at, `found only ${all.length} controls of the page to keep clear of: the check can't see its parts`);
        const place = await evaluate(`(() => { const r = document.querySelector(".countdown-card").getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, dock: document.querySelector(".dock").getBoundingClientRect().top, header: document.querySelector("header").getBoundingClientRect().bottom }; })()`);
        if (place.left < 0 || place.right > w || place.top < place.header || place.bottom > place.dock) fail(at, `the card leaves the free part of the window: ${JSON.stringify(place)}`);
        for (const control of all) if (meets(place, control.box)) fail(at, `the card covers "${control.name}" (${control.part})`);
        await evaluate(`document.querySelector(".countdown-card").click()`);
        await until(`!!document.querySelector(".countdown-editor")`, 2000);
        await settle();
        const editor = await evaluate(`(() => { const r = document.querySelector(".countdown-editor").getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, scrolls: document.querySelector(".countdown-editor").scrollHeight > document.querySelector(".countdown-editor").clientHeight }; })()`);
        if (editor.left < 0 || editor.right > w || editor.top < place.header || editor.bottom > place.top) fail(at, `the editor leaves the free part of the window: ${JSON.stringify(editor)}`);
        for (const control of all) if (control.part.includes("dock") && meets(editor, control.box)) fail(at, `the editor covers "${control.name}" in the dock`);
        await escape();
        if (!await until(`!document.querySelector(".countdown-editor")`, 2000)) fail(at, "Esc doesn't close the editor in the app");
        if (await evaluate(`!!document.querySelector(".brick-broke")`)) fail(at, "it broke");
      }
    } finally {
      if (injected) await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: injected });
      await cdp("Emulation.setTimezoneOverride", { timezoneId: "" });
      await cdp("Emulation.setEmulatedMedia", { features: [] });
      await width(1280, 860);
      await go(`${base}/bricks.html`); // Fresh native clock and storage methods before putting the storage back.
      await evaluate(`${JSON.stringify(keys)}.forEach((key, i) => { const was = ${JSON.stringify(saved)}[i]; if (was === null) localStorage.removeItem(key); else localStorage.setItem(key, was); })`);
      shown = full;
    }
  }
  // Tiny transcript: a panel that takes the live words from the dock (`showsLiveWords`); nothing before words are
  // said, nor for a typed thought; said words show as they come, inside a 320 px screen's edges, and stay with the
  // first-use hint after the turn ends (time to try the slider) until a click dismisses both, for good.
  if (checked.includes("tiny-transcript")) {
    const where = "tiny-transcript (empty map, 320 px)";
    const info = infos["./bricks/tiny-transcript/brick.json"];
    if (info.kind !== "panel") fail("tiny-transcript", "brick.json: a panel, as its spec says");
    if (info.showsLiveWords !== true) fail("tiny-transcript", "brick.json: showsLiveWords true, so the dock's big line leaves the words to it");
    const press = (label) => evaluate(`[...document.querySelectorAll(".playground-bar button")].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
    const shownNow = () => evaluate(`document.querySelector(".tiny-transcript-text")?.textContent ?? ""`);
    await width(320, 844);
    await go(`${base}/bricks.html?brick=tiny-transcript&sample=empty`);
    await until(`document.querySelector(".playground")?.dataset.brickShown === "tiny-transcript"`, 8000);
    await settle();
    if (await evaluate(`!!document.querySelector(".tiny-transcript")`)) fail(where, "shows a transcript before anything is said");
    await press("Add a thought");
    await sleep(1600);
    if (await evaluate(`!!document.querySelector(".tiny-transcript")`)) fail(where, "shows a typed thought: only words as they're said");
    await press("Say a thought");
    if (!await until(`!!document.querySelector(".tiny-transcript-text")`, 1000)) fail(where, "doesn't show your words as you say them");
    else {
      const first = await shownNow();
      if (!await until(`(document.querySelector(".tiny-transcript-text")?.textContent ?? "").length > ${first.length}`, 1500)) fail(where, "the words don't grow as you talk");
      const box = await evaluate(`(() => { const r = document.querySelector(".tiny-transcript-text").getBoundingClientRect(); return { left: r.left, right: r.right, width: innerWidth }; })()`);
      if (box.left < 7.5 || box.right > box.width - 7.5) fail(where, "the transcript runs past the screen's edges");
      // The turn ends (the playground's "Say a thought": a word every 250 ms, the end 600 ms after the last).
      if (!await until(`document.querySelector(".playground-map").textContent.includes("2 placed")`, 6000)) fail(where, "the thought said never landed");
      if (!await evaluate(`!!document.querySelector(".tiny-transcript-hint input[type=range]") && !!document.querySelector(".tiny-transcript-text")`)) fail(where, "the first-use hint left with the turn, before it was dismissed");
      else {
        // It says what it's for, and the slider's name is on screen, not only read out.
        const hint = await evaluate(`(() => { const hint = document.querySelector(".tiny-transcript-hint"), range = hint.querySelector("input[type=range]"), label = range.labels?.[0];
          const words = [...hint.querySelectorAll("p")].map((p) => p.textContent.trim()).join(" ");
          return { words, label: label ? label.innerText.trim() : "", wide: label ? label.getBoundingClientRect().width : 0, named: range.getAttribute("aria-label") ?? "" }; })()`);
        if (hint.words !== "Your words as you speak, kept small; slide to resize") fail(where, `the first-use hint says "${hint.words}", not what it is ("Your words as you speak, kept small; slide to resize")`);
        if (!hint.label.startsWith("Text size") || hint.wide < 100) fail(where, `the size slider has no label you can see (its label: "${hint.label}", ${hint.wide} px wide${hint.named ? `; aria-label "${hint.named}" only` : ""})`);
      }
      await evaluate(`document.body.click()`);
      if (!await until(`!document.querySelector(".tiny-transcript")`, 2000)) fail(where, "keeps showing words once the turn is over and the hint dismissed");
      await press("Say a thought");
      if (!await until(`!!document.querySelector(".tiny-transcript-text")`, 1000)) fail(where, "doesn't show your words the second time");
      else if (await evaluate(`!!document.querySelector(".tiny-transcript-hint")`)) fail(where, "the first-use hint came back once dismissed");
    }
    await width(1280, 860);
  }
  if (checked.includes("_template")) {
    await go(`${base}/bricks.html?brick=_template&sample=student-week`);
    await until(`!!document.querySelector(".template")`, 8000);
    await evaluate(`[...document.querySelectorAll(".playground-bar button")].find((b) => b.textContent === "Add a thought").click()`);
    if (!await until(`document.querySelector(".template")?.textContent.includes("last landed on")`, 4000)) fail("_template", "never heard the thought it added land");
  }
  // The contract in the playground (a full run): each event as a brick hears it ("What it heard", newest first) and
  // each action answered as the app would, called as the shown brick would call it (`brickActions`).
  if (!only) {
    const where = "the contract (playground)";
    await go(`${base}/bricks.html?brick=_template&sample=student-week`);
    await until(`!!document.querySelector(".template")`, 8000);
    const press = (label) => evaluate(`[...document.querySelectorAll(".playground-bar button")].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
    const heard = (name) => evaluate(`[...document.querySelectorAll('.playground-heard li[data-event="${name}"]')].map((li) => JSON.parse(li.textContent.slice(li.textContent.indexOf(": ") + 2)))`);
    const logged = (words) => until(`document.querySelector(".playground-log").textContent.includes(${JSON.stringify(words)})`, 3000);
    const call = (code) => evaluate(`window.brickActions.${code}`);
    // landed: placed by the model its route named, in its time, by you; then one the brick added, by the brick.
    await press("Add a thought");
    let first = null;
    if (!await until(`!!document.querySelector('.playground-heard li[data-event="landed"]')`, 4000)) fail(where, "no landed heard");
    else {
      [first] = await heard("landed");
      if (first.model !== "Muse Spark 1.3" || first.ms !== 1200 || first.by?.kind !== "person" || first.by.name !== "you" || !first.mine) fail(where, `a thought you added landed as ${JSON.stringify(first)}`);
    }
    await call(`addThought("Book the room for Thursday")`);
    if (!await until(`document.querySelector(".playground-heard")?.textContent.includes('"kind":"brick"')`, 4000)) fail(where, "a thought the brick added never landed by it");
    else {
      const landed = (await heard("landed")).find((l) => l.by.kind === "brick");
      if (landed.by.id !== "_template" || landed.by.name !== "Template" || landed.model !== "Muse Spark 1.3") fail(where, `a thought the brick added landed as ${JSON.stringify(landed)}`);
    }
    // words: as they grow, then "" at the turn's end.
    await press("Say a thought");
    await sleep(700);
    const growing = (await heard("words")).filter(Boolean);
    if (growing.length < 2 || growing[0].length <= growing[1].length) fail(where, `words heard as ${JSON.stringify(growing)}, not growing`);
    if (!await until(`[...document.querySelectorAll('.playground-heard li[data-event="words"]')].some((li) => li.textContent === 'words: ""')`, 5000)) fail(where, "no words \"\" at the turn's end");
    // pointing: at a thread with its id, by who points; then null.
    await press("Point at a thread");
    const [pointing] = await heard("pointing");
    if (!pointing?.target.startsWith("thread:") || pointing.threadId !== pointing.target.slice(7) || pointing.by !== "Friend") fail(where, `pointing heard as ${JSON.stringify(pointing)}`);
    await press("Stop pointing");
    if ((await heard("pointing"))[0] !== null) fail(where, "pointing stopped isn't heard as null");
    // asked: "what just happened?".
    await press("Ask what just happened");
    if (JSON.stringify((await heard("asked"))[0]) !== '{"what":"notices"}') fail(where, "asked isn't heard as { what: \"notices\" }");
    // annotate: a note on the words starts it, the same words again answer in it, other words start another; a point
    // that isn't on the map is refused.
    if (first) {
      const notes = (n) => until(`document.querySelector(".playground-map").textContent.includes(" ${n} notes")`, 3000);
      if (!await call(`annotate(${JSON.stringify(first.thoughtId)}, "the slides", "Which slides?")`) || !await notes(1) || !await logged("a new note on those words")) fail(where, "a note doesn't start its thread");
      if (!await call(`annotate(${JSON.stringify(first.thoughtId)}, " the  slides ", "The deck from Monday")`) || !await logged("a reply in their note") || !await notes(1)) fail(where, "a note on the same words doesn't answer in it");
      if (!await call(`annotate(${JSON.stringify(first.thoughtId)}, "Friday", "Which Friday?")`) || !await notes(2)) fail(where, "other words don't start a note of their own");
      if (await call(`annotate("not-a-thought", "x", "y")`) !== false) fail(where, "a note on a point that isn't there isn't refused");
    }
    // openCatalog and hint, answered as the app would; a hint that isn't one line is refused.
    await call(`openCatalog("spine")`);
    if (!await logged("openCatalog spine → in the app: the Catalog opens at that brick's row")) fail(where, "openCatalog(id) isn't answered");
    if (await call(`hint("Drag to resize", "template")`) !== true || !await logged("hint “Drag to resize” at template → in the app: an arrow at it, from Template")) fail(where, "a hint isn't answered");
    if (await call(`hint("two\\nlines")`) !== false) fail(where, "a hint of two lines isn't refused");
    // The Friend, an AI participant: listed as one, its thought landing by it.
    await press("The Friend says one");
    if (!await until(`document.querySelector(".playground-map").textContent.includes("AI: Friend")`, 3000)) fail(where, "the Friend isn't listed as an AI");
    if (!await until(`document.querySelector(".playground-heard")?.textContent.includes('"name":"Friend"')`, 4000)) fail(where, "the Friend's thought never landed by it");
    if (await evaluate(`document.querySelector(".playground").dataset.errors !== "0" || !!document.querySelector(".brick-broke")`)) fail(where, "the contract's calls caused an error");
  }
  // Bubble flight: a panel; a thought of yours on its way leaves as a bubble (the playground has no composer, so the check
  // lends one) that stays inside a phone's screen, never takes the pointer and goes once the thought is placed; with
  // reduced motion there's none (the app stops every animation then, styles.css).
  if (checked.includes("bubble-flight")) {
    if (infos["./bricks/bubble-flight/brick.json"].kind !== "panel") fail("bubble-flight", "brick.json: a panel, as its spec says");
    for (const [w, reduced] of [[1280, false], [390, false], [1280, true]]) {
      const where = `bubble-flight (empty map, ${w} px${reduced ? ", reduced motion" : ""})`;
      await width(w, w < 600 ? 844 : 860);
      await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }] });
      await go(`${base}/bricks.html?brick=bubble-flight&sample=empty`);
      await until(`document.querySelector(".playground")?.dataset.brickShown === "bubble-flight"`, 8000);
      await settle();
      await evaluate(`(() => {
        const composer = Object.assign(document.createElement("div"), { className: "composer" });
        composer.style.cssText = "position:fixed;left:8px;right:8px;bottom:16px;height:44px";
        document.body.append(composer);
        [...document.querySelectorAll(".playground-bar button")].find((b) => b.textContent === "Add a thought").click();
      })()`);
      if (reduced) {
        await sleep(400);
        if (await evaluate(`!!document.querySelector(".bubble-flight-bubble")`)) fail(where, "a bubble shows with reduced motion");
        continue;
      }
      if (!await until(`!!document.querySelector(".bubble-flight-bubble")`, 1000)) { fail(where, "no bubble for a thought on its way"); continue; }
      const bubble = await evaluate(`(() => { const b = document.querySelector(".bubble-flight-bubble"), r = b.getBoundingClientRect();
        return { left: r.left, right: r.right, width: innerWidth, pointer: getComputedStyle(b).pointerEvents }; })()`);
      if (bubble.left < 0 || bubble.right > bubble.width) fail(where, "a bubble runs past the screen's edges");
      if (bubble.pointer !== "none") fail(where, "a bubble takes the pointer");
      if (!await until(`!document.querySelector(".bubble-flight-bubble")`, 4000)) fail(where, "a bubble stays after its thought is placed");
      if (await evaluate(`document.querySelector(".playground").dataset.errors !== "0" || !!document.querySelector(".brick-broke")`)) fail(where, "a thought caused an error");
    }
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    await width(1280, 860);
  }
  if (checked.includes("bubbles")) {
    await go(`${base}/bricks.html?brick=bubbles&sample=student-week`);
    await until(`!!document.querySelector(".bubbles-bubble")`, 8000);
    const n = await evaluate(`({ bubbles: document.querySelectorAll(".bubbles-bubble").length, threads: Number(document.querySelector(".playground-map").textContent.match(/(\\d+) threads/)[1]) })`);
    if (n.bubbles !== n.threads) fail("bubbles", `${n.bubbles} bubbles for ${n.threads} threads`);
    const before = await evaluate(`[...document.querySelectorAll(".bubbles-bubble")].map((b) => b.style.left + b.style.top).join("|")`);
    await evaluate(`[...document.querySelectorAll(".playground-bar button")].find((b) => b.textContent === "Add a thought").click()`);
    if (!await until(`!!document.querySelector(".bubbles-ripple")`, 4000)) fail("bubbles", "no ripple where the thought landed");
    const after = await evaluate(`[...document.querySelectorAll(".bubbles-bubble")].map((b) => b.style.left + b.style.top).join("|")`);
    if (before !== after) fail("bubbles", "a landing moved bubbles (each keeps its place)");
    await evaluate(`document.querySelector(".bubbles-face").click()`);
    if (!await until(`document.querySelector(".playground-log").textContent.includes("openThread")`, 2000)) fail("bubbles", "a bubble doesn't open its thread");
  }
  // Read progress: an input, so it needs the app's cards (the playground draws none). Nothing on an empty map or one
  // where every point is yours; a tap on another's point marks it, kept over a reload, with a dot on the one after it
  // (on a dark phone, reduced motion); a point under the dock isn't read, however long it sits there.
  if (checked.includes("read-progress")) {
    if (infos["./bricks/read-progress/brick.json"].kind !== "input") fail("read-progress", "brick.json: an input, as its spec says");
    const previousSwitches = await evaluate(`localStorage.getItem("e2a2o.bricks")`);
    await evaluate(`localStorage.setItem("e2a2o.bricks", JSON.stringify({ "read-progress": true }))`);
    for (const [label, fixture] of [["empty", empty], ["only me", full]]) {
      shown = fixture;
      await width(390, 844);
      await go(`${base}/`);
      if (!await until(`!!document.querySelector('[data-brick="read-progress"]')`, 8000)) fail("read-progress", `${label}: never mounted`);
      await settle();
      const state = await evaluate(`({ marks: document.querySelectorAll(".read-progress-point, .read-progress-dot, .read-progress-mark").length,
        content: document.querySelector('[data-brick="read-progress"]')?.textContent.trim(),
        broke: !!document.querySelector(".brick-broke"), sideways: document.documentElement.scrollWidth - innerWidth })`);
      if (state.marks || state.content) fail("read-progress", `${label}: should render nothing`);
      if (state.broke || state.sideways > 1) fail("read-progress", `${label}: broke or overflows at phone width`);
    }
    const friend = (id, text, at) => ({ ...thought(id, text, "read-progress-check"), speaker: "friend", at_ms: at });
    shown = world([thread("read-progress-check", "Read here")]);
    shown.thoughts = [friend("read-progress-0", "Participant point 1", now), friend("read-progress-1", "Participant point 2", now + 1)];
    const key = "e2a2o.brick.read-progress.read-progress-check";
    await evaluate(`localStorage.removeItem(${JSON.stringify(key)})`);
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }, { name: "prefers-reduced-motion", value: "reduce" }] });
    await go(`${base}/`);
    const firstPoint = `document.getElementById("point-read-progress-0")`;
    if (!await until(`${firstPoint}?.classList.contains("read-progress-point")`, 8000)) fail("read-progress", "doesn't attach to another participant's point");
    else {
      await evaluate(`${firstPoint}.click()`);
      if (!await until(`${firstPoint}.classList.contains("read-progress-mark") && localStorage.getItem(${JSON.stringify(key)}) === "read-progress-0"`, 2000)) fail("read-progress", "a tap doesn't mark and save the thought");
      await go(`${base}/`);
      if (!await until(`${firstPoint}?.classList.contains("read-progress-mark")`, 8000)) fail("read-progress", "the saved mark doesn't survive a reload");
      const state = await evaluate(`({ dot: !!document.querySelector("#point-read-progress-1 .read-progress-dot"),
        broke: !!document.querySelector(".brick-broke"), sideways: document.documentElement.scrollWidth - innerWidth })`);
      if (!state.dot || state.broke || state.sideways > 1) fail("read-progress", "unread dot missing, brick broke, or overflows on a dark phone with reduced motion");
    }
    // Under the dock: a long card, your points first, then another's two, scrolled to sit behind the dock.
    await evaluate(`localStorage.removeItem(${JSON.stringify(key)})`);
    shown = world([thread("read-progress-check", "Read here")]);
    shown.thoughts = [...Array.from({ length: 9 }, (_, n) => ({ ...thought(`mine-${n}`, `My point ${n + 1}`, "read-progress-check"), at_ms: now - 9000 + n })),
      friend("read-progress-0", "Participant point 1", now), friend("read-progress-1", "Participant point 2", now + 1)];
    await width(390, 600);
    await go(`${base}/`);
    if (await until(`!!document.querySelector("#point-read-progress-1.read-progress-point") && !!document.querySelector(".dock")`, 8000)) {
      await settle();
      const under = await evaluate(`(() => { const dock = document.querySelector(".dock").getBoundingClientRect().top;
        window.scrollBy({ top: -(dock - document.getElementById("point-read-progress-0").getBoundingClientRect().top + 4), behavior: "instant" });
        return [0, 1].every((n) => document.getElementById("point-read-progress-" + n).getBoundingClientRect().top > dock - 1); })()`);
      await sleep(2000);
      if (!under) fail("read-progress", "the check couldn't put another's points behind the dock");
      else if (await evaluate(`localStorage.getItem(${JSON.stringify(key)}) !== null`)) fail("read-progress", "a point behind the dock was taken as read");
    } else fail("read-progress", "the long card's points never showed");
    await evaluate(`localStorage.removeItem(${JSON.stringify(key)}); ${previousSwitches === null ? 'localStorage.removeItem("e2a2o.bricks")' : `localStorage.setItem("e2a2o.bricks", ${JSON.stringify(previousSwitches)})`}`);
    await cdp("Emulation.setEmulatedMedia", { features: [] });
    await width(1280, 860);
    shown = full;
  }
  // A press, a few moves and a release, as a hand drags: the canvas moves things on mouse events, not clicks.
  const drag = async (from, to, steps = 10) => {
    const at = (type, x, y) => cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
    await at("mousePressed", from.x, from.y);
    for (let i = 1; i <= steps; i++) { await at("mouseMoved", from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps); await sleep(20); }
    await at("mouseReleased", to.x, to.y);
  };
  const middle = (selector) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r && { x: r.left + Math.min(40, r.width / 2), y: r.top + Math.min(10, r.height / 2) }; })()`);
  const nodesAt = `Object.fromEntries([...document.querySelectorAll(".react-flow__node")].map((n) => [n.dataset.id, n.style.transform]))`;
  if (checked.includes("spine")) {
    // Motion as the app has it, whatever this machine's own Reduce Motion is (a check before this one hands it back).
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    await go(`${base}/bricks.html?brick=spine&sample=student-week`);
    if (!await until(`!!document.querySelector(".spine-frame.spine-ready")`, 8000)) fail("spine", "the canvas never showed");
    await settle();
    const n = await evaluate(`({ heads: document.querySelectorAll(".spine-head").length, cards: document.querySelectorAll(".spine-card").length })`);
    // student-week: four topics (Hackathon plan, Rent is due, Group project meeting, Mom's birthday) and four tangents.
    if (n.heads !== 4 || n.cards !== 4) fail("spine", `${n.heads} heads and ${n.cards} cards for 4 topics and 4 tangents`);
    const before = await evaluate(nodesAt);
    await evaluate(`[...document.querySelectorAll(".playground-bar button")].find((b) => b.textContent === "Add a thought").click()`);
    if (!await until(`document.querySelectorAll(".spine-ring").length === 1`, 4000)) fail("spine", "no single pulse where the thought landed");
    await sleep(500);
    const after = await evaluate(nodesAt);
    const moved = Object.keys(before).filter((key) => after[key] !== before[key]);
    if (moved.length) fail("spine", `a landing moved ${moved.join(", ")} (each keeps its place)`);
    const point = await middle(`.react-flow__node[data-id="p:th-2"] .spine-text`);
    if (!point) fail("spine", "no point th-2 on the canvas");
    else {
      await drag(point, { x: point.x + 60, y: point.y + 260 });
      if (!await until(`document.querySelector(".playground-log").textContent.includes("position th-2 → placed at")`, 3000)) fail("spine", "a drag doesn't ask to place the point");
      if (!await until(`!!document.querySelector(".spine-notch") && !!document.querySelector('.react-flow__node[data-id="p:th-2"] .spine-pinned')`, 2000)) fail("spine", "a point placed by hand leaves no mark on its line, or isn't shown as placed");
      await evaluate(`document.querySelector('.react-flow__node[data-id="p:th-2"] .spine-tool-pin')?.click()`);
      if (!await until(`document.querySelector(".playground-log").textContent.includes("position th-2 → back to the layout") && !document.querySelector(".spine-notch")`, 3000)) fail("spine", "its pin doesn't put it back");
    }
    await evaluate(`document.querySelector('[aria-label="Open Hackathon plan on the map"]').click()`);
    if (!await until(`document.querySelector(".playground-log").textContent.includes("openThread Hackathon plan")`, 2000)) fail("spine", "a thread doesn't open on the map");

    // Round 2: the slot, the follow and a hand that holds it, edge chips, the camera's pace, Reduce Motion.
    const press = (label) => evaluate(`[...document.querySelectorAll(".playground-bar button")].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
    const key = async (k) => { for (const type of ["keyDown", "keyUp"]) await cdp("Input.dispatchKeyEvent", { type, key: k, code: `Key${k.toUpperCase()}`, text: type === "keyDown" ? k : undefined }); };
    const nodeAt = (selector) => evaluate(`(() => { const n = document.querySelector(${JSON.stringify(selector)})?.closest(".react-flow__node");
      const m = n?.style.transform.match(/translate\\(([-\\d.]+)px, ([-\\d.]+)px\\)/); return m ? { id: n.dataset.id, x: +m[1], y: +m[2] } : null; })()`);
    const following = () => evaluate(`document.querySelector(".spine-follow")?.getAttribute("aria-pressed")`);
    const view = () => evaluate(`document.querySelector(".react-flow__viewport").style.transform`);
    // A press on the empty canvas in the frame's right half, dragged 600 px left: a hand moving the map.
    const handPan = async () => {
      const from = await evaluate(`(() => { const f = document.querySelector(".spine-frame").getBoundingClientRect();
        for (let y = f.top + 80; y < f.bottom - 200; y += 16) for (let x = f.right - 40; x > f.left + f.width / 2 + 100; x -= 16)
          if (document.elementFromPoint(x, y)?.classList.contains("react-flow__pane")) return { x, y };
        return null; })()`);
      if (!from) return false;
      await drag(from, { x: from.x - 600, y: from.y }, 12);
      return true;
    };
    const spineAgain = async () => {
      await go(`${base}/bricks.html?brick=spine&sample=student-week`);
      if (!await until(`!!document.querySelector(".spine-frame.spine-ready")`, 8000)) fail("spine", "the canvas never showed (again)");
      await settle();
    };
    await spineAgain();
    if (await following() !== "true") fail("spine", "it doesn't open following your talk (Following, pressed)");
    // The slot: under the tip of the thread you're on, named for the flight; the point lands in it, with its note.
    const tip = await nodeAt(".spine-on");
    await press("Add a thought");
    if (!await until(`!!document.querySelector('.spine-slot[data-slot^="slot:pg-"]')`, 1000)) fail("spine", "no dashed slot for your thought on its way");
    else {
      const slot = await nodeAt('.spine-slot[data-slot^="slot:pg-"]');
      const id = (await evaluate(`document.querySelector('.spine-slot[data-slot^="slot:pg-"]').dataset.slot`)).slice("slot:".length);
      if (!tip || !slot || slot.x !== tip.x || slot.y <= tip.y) fail("spine", `the slot isn't under the tip of the thread you're on (tip ${JSON.stringify(tip)}, slot ${JSON.stringify(slot)})`);
      if (!await until(`!document.querySelector(".spine-slot") && !!document.querySelector('.react-flow__node[data-id="p:${id}"]')`, 3000)) fail("spine", "the slot doesn't give way to its point once it lands");
      else {
        const point = await nodeAt(`.react-flow__node[data-id="p:${id}"] .spine-point`);
        if (!slot || !point || point.x !== slot.x || Math.abs(point.y - slot.y) > 1) fail("spine", `the point didn't land in its slot (slot ${JSON.stringify(slot)}, point ${JSON.stringify(point)})`);
        // The landing names its model once its route says (the playground's comes 40 ms after the change, as the core's does).
        const landingNote = `document.querySelector('.react-flow__node[data-id="p:${id}"] .spine-landing')?.textContent ?? ""`;
        await until(`(${landingNote}) !== ""`, 2000);
        const note = await evaluate(landingNote);
        if (note !== "Muse Spark 1.3 put this here in 1.2 s") fail("spine", `the landing note says "${note}", not the model and how long placing took ("Muse Spark 1.3 put this here in 1.2 s")`);
      }
    }
    // A hand on the map holds the view; a landing then moves nothing, and out of view an edge chip says where.
    await sleep(600);
    if (!await handPan()) fail("spine", "no empty canvas to drag (the check's)");
    else if (!await until(`document.querySelector(".spine-follow")?.getAttribute("aria-pressed") === "false"`, 1500)) fail("spine", "a hand on the map doesn't hold the view");
    else {
      await sleep(300);
      const held = await view();
      await press("Add a thought");
      if (!await until(`!!document.querySelector(".spine-cue")`, 3000)) fail("spine", "a landing out of view, while the view is held, shows no edge chip");
      else {
        // Longer than the old chips' 5 s: it stays until it's seen, and the view stays where the hand left it.
        await sleep(5600);
        if (await view() !== held) fail("spine", "the view moved while a hand held it");
        const stayed = await evaluate(`!!document.querySelector(".spine-cue")`);
        if (!stayed) fail("spine", "an edge chip left before it was seen");
        // Its click goes there: one glide of 400 ms or less (or, past a screen, a 200 ms cross-fade), and the chip goes.
        const took = !stayed ? 0 : await evaluate(`new Promise((resolve) => {
          const viewport = document.querySelector(".react-flow__viewport");
          let last = viewport.style.transform;
          const began = performance.now();
          let changed = -1;
          document.querySelector(".spine-cue").click();
          const tick = (t) => {
            if (viewport.style.transform !== last) { last = viewport.style.transform; changed = t; }
            if ((changed > 0 && t - changed > 300) || t - began > 3000) resolve(changed < 0 ? -1 : Math.round(changed - began)); else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        })`);
        if (took < 0) fail("spine", "an edge chip's click doesn't go there");
        else if (took > 450) fail("spine", `an edge chip's move took ${took} ms (a glide is 400 ms at most)`);
        if (!await until(`!document.querySelector(".spine-cue")`, 1500)) fail("spine", "an edge chip stays once its landing is in view");
      }
      await key("f");
      if (!await until(`document.querySelector(".spine-follow")?.getAttribute("aria-pressed") === "true"`, 1000)) fail("spine", "F doesn't follow your talk again");
    }
    // Reduce Motion: the camera cuts (one frame, then still) with a ring for a second where it went; a landing rings in
    // place of its pulse.
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await spineAgain();
    if (!await handPan()) fail("spine", "no empty canvas to drag under Reduce Motion (the check's)");
    else {
      await until(`document.querySelector(".spine-follow")?.getAttribute("aria-pressed") === "false"`, 1500);
      await sleep(300);
      const cut = await evaluate(`new Promise((resolve) => {
        const viewport = document.querySelector(".react-flow__viewport");
        const before = viewport.style.transform;
        document.querySelector(".spine-follow")?.click();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const first = viewport.style.transform;
          setTimeout(() => resolve({ moved: first !== before, still: viewport.style.transform === first, ring: !!document.querySelector(".spine-cut") }), 300);
        }));
      })`);
      if (!cut.moved || !cut.still) fail("spine", `under Reduce Motion the camera glides instead of cutting (${JSON.stringify(cut)})`);
      if (!cut.ring) fail("spine", "under Reduce Motion no ring shows where the camera cut to");
      else if (!await until(`!document.querySelector(".spine-cut")`, 1500)) fail("spine", "the ring where the camera cut stays past its second");
      await press("Add a thought");
      if (!await until(`!!document.querySelector(".spine-point.spine-cut")`, 3000)) fail("spine", "under Reduce Motion a landing shows no ring");
      if (await evaluate(`[...document.querySelectorAll(".spine-ring")].some((ring) => getComputedStyle(ring).display !== "none")`)) fail("spine", "under Reduce Motion a landing still pulses");
    }
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });

    // Round 3: margin notes and zoom stops. Words and keys go in as a hand sends them (real mouse and key events), so a press
    // that lands on the wrong thing, or a key a field should keep, shows here.
    {
      const mouse = (type, x, y, extra = {}) => cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });
      // A click, a double-click (count 2) or a shift-click (modifiers 8).
      const click = async ({ x, y }, count = 1, modifiers = 0) => {
        await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers });
        for (let n = 1; n <= count; n++) for (const type of ["mousePressed", "mouseReleased"]) await mouse(type, x, y, { clickCount: n, modifiers });
      };
      const tap = async (name, { code, vk, text } = {}) => {
        for (const type of ["keyDown", "keyUp"]) await cdp("Input.dispatchKeyEvent", { type, key: name, code, windowsVirtualKeyCode: vk, text: type === "keyDown" ? text : undefined });
      };
      const digit = (d) => tap(d, { code: `Digit${d}`, vk: 48 + Number(d), text: d });
      const typed = async (words) => { for (const ch of words) await tap(ch, { code: ch === " " ? "Space" : undefined, text: ch }); };
      const lit = () => evaluate(`[...document.querySelectorAll(".spine-stop")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.firstChild.textContent).join()`);
      // Calm once nothing moves (a glide is 400 ms at most): the view and every thing's place unchanged for 240 ms.
      const calm = async () => {
        let last = "", same = 0;
        for (let i = 0; i < 50 && same < 3; i++) {
          const at = await evaluate(`document.querySelector(".react-flow__viewport").style.transform + JSON.stringify(${nodesAt})`);
          same = at === last ? same + 1 : 0;
          last = at;
          await sleep(80);
        }
      };

      // 1. Margin notes (margin.tsx). The playground answers `annotate` as the core would (annotate-core.ts `noteChanges`) and logs the
      // call, so a note made here is the map's, as in the app: a thread under the point's, tied to the words in `anchors`.
      // Where `words` are in point `id`, in screen px: a real range over its text, so a press or a drag lands on them.
      const wordsAt = (id, words) => evaluate(`(() => {
        const text = document.querySelector('.react-flow__node[data-id="p:${id}"] .spine-text');
        if (!text) return null;
        const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const at = node.textContent.indexOf(${JSON.stringify(words)});
          if (at < 0) continue;
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + ${words.length});
          const r = range.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, right: r.right };
        }
        return null;
      })()`);
      const picking = () => evaluate(`({ words: getSelection().toString(), on: !!document.querySelector(".spine-selecting"), reply: document.querySelector(".spine-reply-ask")?.getAttribute("aria-label") ?? "" })`);
      // One note as a person makes it: a double-click on `first`, `extend` to take more, Reply, the typing, Enter.
      const makeNote = async (what, id, first, extend, words, text) => {
        // A failed note reloads the page, so the next one starts from a clean canvas (a key that zoomed it out, a box left open).
        const no = async (why) => { fail("spine (notes)", `${what}: ${why}`); await spineAgain(); return false; };
        const at = await wordsAt(id, first);
        if (!at) return no(`the check can't find “${first}” in point ${id}`);
        await click(at, 2);
        if (!await until(`getSelection().toString() === ${JSON.stringify(first)} && !!document.querySelector(".spine-reply-ask")`, 2000)) return no(`a double-click on “${first}” doesn't pick it and offer Reply (${JSON.stringify(await picking())})`);
        await extend();
        if (!await until(`getSelection().toString() === ${JSON.stringify(words)} && document.querySelector(".spine-reply-ask")?.getAttribute("aria-label") === ${JSON.stringify(`Reply to “${words}”`)}`, 2000)) return no(`it doesn't take more than the word: wanted “${words}”, got ${JSON.stringify(await picking())}`);
        const ask = await evaluate(`(() => { const r = document.querySelector(".spine-reply-ask").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
        // The button is what's asserted. Its ↵ (Enter) isn't: with the focus still on the picked words, Enter goes to the words' own
        // key handler (it picks the point and swallows the key), so the reply opens only once the focus has moved off them.
        await click(ask);
        if (!await until(`document.activeElement === document.querySelector(".spine-reply-field")`, 1500)) return no("Reply doesn't open a box with the cursor in it");
        // Typed as a hand types it: digits and F are the canvas's keys, and a box keeps them.
        const rested = { view: await view(), lit: await lit(), following: await following() };
        await typed(text);
        const value = await evaluate(`document.querySelector(".spine-reply-field")?.value`);
        const moved = { view: await view(), lit: await lit(), following: await following() };
        const wrong = [];
        if (value !== text) wrong.push(`the box has ${JSON.stringify(value)}, not ${JSON.stringify(text)}`);
        if (JSON.stringify(moved) !== JSON.stringify(rested)) wrong.push(`the camera moved (${JSON.stringify(rested)} → ${JSON.stringify(moved)})`);
        if (wrong.length) return no(`typing the reply: ${wrong.join("; ")} (its digits and letters are the canvas's keys, and a box keeps them)`);
        await tap("Enter", { code: "Enter", vk: 13, text: "\r" });
        if (!await until(`!document.querySelector(".spine-reply") && [...document.querySelectorAll(".spine-quote")].some((q) => q.textContent === ${JSON.stringify(words)})`, 2000)) return no("Enter doesn't send the reply and underline its words");
        return true;
      };
      // What the page shows for the note on `words`: the underlined words, the note, the strings (screen px).
      const tied = (words) => evaluate(`(() => {
        const quotes = [...document.querySelectorAll(".spine-quote")];
        const quote = quotes.find((q) => q.textContent === ${JSON.stringify(words)});
        if (!quote) return { found: false, quotes: quotes.length };
        const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
        const note = document.querySelector('.spine-margin[data-margin="' + quote.dataset.margin + '"]');
        const ends = [...quote.getClientRects()];
        return { found: true, quotes: quotes.length, underline: getComputedStyle(quote).textDecorationLine, end: ends[ends.length - 1].toJSON(), column: box(quote.closest(".spine-text")),
          note: note && { ...box(note), text: note.textContent, role: note.getAttribute("role") },
          dots: [...document.querySelectorAll(".spine-link-end-note")].map((c) => { const r = c.getBoundingClientRect(); return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; }),
          strings: [...document.querySelectorAll(".spine-link-note")].map(box) };
      })()`);
      // Each made note shows tied to its exact words: those words, and only those, underlined; the note in the column to the
      // right of its point, level with them; a string from where the words end to the note.
      const looksTied = async (stage, made) => {
        await settle();
        await calm();
        for (const { words, text } of made) {
          const t = await tied(words);
          const bad = (why) => fail("spine (notes)", `${stage}: the note on “${words}” ${why}`);
          if (!t.found) { bad(`has no underlined words (${t.quotes} underlined)`); continue; }
          if (t.quotes !== made.length) fail("spine (notes)", `${stage}: ${t.quotes} stretches underlined for ${made.length} notes (only the words picked)`);
          if (!t.underline.includes("underline")) bad(`isn't underlined (${t.underline})`);
          if (!t.note) { bad("isn't shown beside its words"); continue; }
          if (!t.note.text.includes(text) || t.note.role !== "note") bad(`doesn't say ${JSON.stringify(text)} as a note (${JSON.stringify(t.note)})`);
          if (t.note.left < t.column.right || Math.abs(t.note.top - t.end.top) > 14) bad(`isn't beside its words, level with them (note ${JSON.stringify(t.note)}; the words end at ${Math.round(t.end.right)}, ${Math.round(t.end.top)})`);
          const dot = t.dots.find((d) => Math.abs(d.x - (t.end.right + 3)) <= 3 && Math.abs(d.y - (t.end.top + t.end.bottom) / 2) <= 6);
          if (!dot) bad(`has no string starting where its words end (they end at ${Math.round(t.end.right)}, ${Math.round((t.end.top + t.end.bottom) / 2)}; strings start at ${JSON.stringify(t.dots.map((d) => [Math.round(d.x), Math.round(d.y)]))})`);
          else if (!t.strings.some((s) => Math.abs(s.left - dot.x) <= 3 && Math.abs(s.right - (t.note.left - 4)) <= 3)) bad("has a string that doesn't reach the note");
        }
      };

      await spineAgain();
      const made = [];
      // A: a shift-click takes the words up to it; the reply is started by Reply's button.
      const A = { id: "th-2", first: "precheck", words: "precheck passes", text: "Only 2 of 3 runs pass" };
      const shiftToPasses = async () => { const to = await wordsAt(A.id, "passes"); if (to) await click({ x: to.right - 2, y: to.y }, 1, 8); };
      if (await makeNote("a note by double-click and shift-click", A.id, A.first, shiftToPasses, A.words, A.text)) made.push(A);
      // B: a drag across the words takes them (the point stays: a drag moves a point only when its words aren't being picked).
      const B = { id: "th-1", first: "Deadline", words: "need to record", text: "Check 1 first, then 0" };
      const dragAcross = async () => {
        const from = await wordsAt(B.id, "need"), to = await wordsAt(B.id, "record");
        if (!from || !to) return;
        const spot = () => evaluate(`document.querySelector('.react-flow__node[data-id="p:${B.id}"]').style.transform`);
        const was = await spot();
        await drag({ x: from.left + 1, y: from.y }, { x: to.right - 1, y: to.y }, 8);
        if (await spot() !== was) fail("spine (notes)", "a drag across picked words moved the point instead of taking the words");
      };
      if (await makeNote("a note by double-click and drag", B.id, B.first, dragAcross, B.words, B.text)) made.push(B);
      // Esc lets picked words go, and the Reply with them.
      const goer = await wordsAt("th-3", "README");
      if (goer) await click(goer, 2);
      if (!goer || !await until(`!!document.querySelector(".spine-reply-ask")`, 2000)) fail("spine (notes)", `a double-click on “README” picks nothing (${JSON.stringify(await picking())})`);
      else {
        await tap("Escape", { code: "Escape", vk: 27 });
        if (!await until(`!document.querySelector(".spine-reply-ask") && !document.querySelector(".spine-selecting") && getSelection().toString() === ""`, 1500)) fail("spine (notes)", `Esc doesn't let picked words go (${JSON.stringify(await picking())})`);
      }
      if (made.length) {
        await looksTied("just made", made);
        // The host is asked for what was picked and said: which thought, which words, what text (the playground logs the call; the
        // first note on words starts their note, so it says "a new note").
        const log = await evaluate(`[...document.querySelectorAll(".playground-log li")].map((li) => li.textContent)`);
        for (const { id, words, text } of made) if (!log.includes(`annotate ${id} “${words}”: “${text}” → a new note on those words`)) fail("spine (notes)", `the host wasn't asked for ${JSON.stringify([id, words, text])} (asked: ${JSON.stringify(log.filter((line) => line.startsWith("annotate")))})`);
        // A new map (another thought lands): the notes stay on their words.
        await press("Add a thought");
        if (!await until(`!!document.querySelector('.react-flow__node[data-id^="p:pg-"]')`, 4000)) fail("spine (notes)", "the check's thought never landed");
        else await looksTied("after another thought landed", made);
        // A phone's width (the window narrows): the note tucks under its point (no column beside it, so no string), words still
        // underlined.
        await width(390, 844);
        await settle();
        await calm();
        for (const { id, words, text } of made) {
          const t = await evaluate(`(() => {
            const node = document.querySelector('.react-flow__node[data-id="p:${id}"]');
            const quote = [...(node?.querySelectorAll(".spine-quote") ?? [])].find((q) => q.textContent === ${JSON.stringify(words)});
            const tuck = quote && node.querySelector('.spine-tuck[data-margin="' + quote.dataset.margin + '"]');
            const under = node?.querySelector(".spine-text")?.getBoundingClientRect() ?? { left: 0, right: 0, bottom: 0 }, r = tuck?.getBoundingClientRect();
            return { underlined: !!quote && getComputedStyle(quote).textDecorationLine.includes("underline"), tuck: r && { left: r.left, right: r.right, top: r.top, text: tuck.textContent },
              under: { left: under.left, right: under.right, bottom: under.bottom }, beside: document.querySelectorAll(".spine-margin").length, strings: document.querySelectorAll(".spine-link-note").length,
              sideways: document.documentElement.scrollWidth - innerWidth };
          })()`);
          const bad = (why) => fail("spine (notes)", `at 390 px the note on “${words}” ${why} (${JSON.stringify(t)})`);
          if (!t.underlined) bad("isn't on underlined words");
          if (!t.tuck) bad("doesn't tuck under its point");
          else if (t.tuck.top < t.under.bottom - 1 || t.tuck.left < t.under.left - 1 || t.tuck.right > t.under.right + 1 || !t.tuck.text.includes(text)) bad("isn't under its point's words, in their column, with what was said");
          if (t.beside || t.strings) bad("still hangs beside the point (a column and a string)");
          if (t.sideways > 1) bad("makes the page scroll sideways");
        }
        await width(1280, 860);
      }

      // 2. Zoom stops (corner.tsx): 1 2 3 are Words · Titles · Pictures, 0 sees all. Each changes what's drawn, the control
      // shows the one that's on, and no key fires while a field has the keyboard (the reply box above, the composer below).
      await spineAgain();
      const level = () => evaluate(`(() => {
        const frame = document.querySelector(".spine-frame").getBoundingClientRect();
        const inside = [...document.querySelectorAll(".react-flow__node")].every((node) => { const r = node.getBoundingClientRect();
          return r.left >= frame.left - 2 && r.right <= frame.right + 2 && r.top >= frame.top - 2 && r.bottom <= frame.bottom + 2; });
        return {
          zoom: +(document.querySelector(".react-flow__viewport").style.transform.match(/scale\\(([-\\d.]+)\\)/)?.[1] ?? 0),
          lit: [...document.querySelectorAll(".spine-stop")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.firstChild.textContent).join(),
          words: document.querySelectorAll(".spine-text").length, bars: document.querySelectorAll(".spine-point .spine-bars").length,
          heads: [...document.querySelectorAll(".spine-head .spine-title")].map((t) => t.textContent).sort().join(" | "),
          labels: [...document.querySelectorAll(".spine-label")].map((l) => l.textContent).sort().join(" | "),
          pictures: document.querySelector(".spine-frame").classList.contains("spine-stop-pictures"),
          cards: [...document.querySelectorAll(".spine-card")].map((c) => getComputedStyle(c).visibility).join(),
          tile: Math.round(document.querySelector(".spine-tile").getBoundingClientRect().width), inside };
      })()`);
      const goTo = async (k, want) => {
        await digit(k);
        if (!await until(`[...document.querySelectorAll(".spine-stop")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.firstChild.textContent).join() === ${JSON.stringify(want)}`, 2500)) {
          fail("spine (zoom stops)", `${k} doesn't light ${want} on the control (it shows ${await lit() || "none"})`);
          return null;
        }
        await calm();
        return level();
      };
      const judge = (what, shows, rules) => {
        const wrong = rules.filter(([ok]) => !ok).map(([, why]) => why);
        if (wrong.length) fail("spine (zoom stops)", `${what}: ${wrong.join("; ")} (${JSON.stringify(shows)})`);
      };
      const atWords = await level();
      const control = await evaluate(`({ stops: [...document.querySelectorAll(".spine-stop")].map((b) => b.textContent).join(), all: document.querySelector(".spine-camera-row .spine-pill")?.textContent })`);
      if (control.stops !== "Words1,Titles2,Pictures3" || control.all !== "See all0") fail("spine (zoom stops)", `the control reads ${JSON.stringify(control)}, not Words 1 · Titles 2 · Pictures 3 and See all 0`);
      judge("it opens at Words", atWords, [[atWords.lit === "Words", "the control doesn't show Words"], [atWords.words > 0 && !atWords.bars, "not every word shows"],
        [!atWords.labels && !atWords.pictures, "a far-out look is on at reading size"], [!atWords.inside, "the check's map fits the screen at reading size, so See all couldn't be told from Words"]]);
      const atTitles = await goTo("2", "Titles");
      if (atTitles) judge("2 (Titles)", atTitles, [[atTitles.zoom < atWords.zoom, "the view didn't zoom out"], [!atTitles.words && atTitles.bars > 0, "words didn't turn to bars"],
        [atTitles.labels === atWords.heads, "the topics' titles don't show"], [!atTitles.pictures, "it has the Pictures look"], [!atTitles.cards.includes("hidden"), "tangent cards are gone"], [atTitles.inside, "the whole map isn't in view"]]);
      const atPictures = await goTo("3", "Pictures");
      if (atPictures) judge("3 (Pictures)", atPictures, [[atPictures.pictures, "the Pictures look isn't on"], [!!atPictures.cards && !atPictures.cards.split(",").some((v) => v !== "hidden"), "tangent cards still show"],
        [!atTitles || atPictures.tile > atTitles.tile * 1.5, "each topic's picture isn't bigger than at Titles"], [atPictures.inside, "the whole map isn't in view"]]);
      const atBack = await goTo("1", "Words");
      if (atBack) judge("1 (Words)", atBack, [[atBack.zoom >= atWords.zoom, "the view isn't back at reading size"], [atBack.words > 0 && !atBack.bars, "not every word shows"], [!atBack.labels && !atBack.pictures, "a far-out look stays on"]]);
      // Far out, with no stop asked for, the control says Titles: it tells where the view is.
      const atAll = await goTo("0", "Titles");
      if (atAll) judge("0 (See all)", atAll, [[atAll.zoom < atWords.zoom, "the view didn't zoom out"], [atAll.inside, "the whole map isn't in view"], [!atAll.pictures, "it has the Pictures look"]]);

      // 3. In the app, where the stand-in core can send what the playground can't: notes as the core keeps them (a thread under the
      // point's, tied to words in `anchors`), another person's among them, and the app's own composer, which has the keyboard
      // when the app opens.
      {
        const previousSwitches = await evaluate(`localStorage.getItem("e2a2o.bricks")`);
        await evaluate(`localStorage.setItem("e2a2o.bricks", JSON.stringify({ spine: true }))`);
        // T1's one point is "Rent due Friday, point 1": Sam asks about "Friday" (unanswered), you asked about "Rent due", and Sam's
        // question on "point 1" is answered.
        const quoted = { N1: "Friday", N2: "Rent due", N3: "point 1" };
        const said = (id, by, text, after) => ({ ...thought(id, text, id.split("-")[0]), speaker: by, at_ms: now + after });
        shown = { ...full, threads: [...full.threads, ...Object.entries(quoted).map(([id, quote]) => thread(id, quote, { parent_id: "T1" }))],
          thoughts: [...full.thoughts, said("N1-0", "Sam", "Which Friday?", 10), said("N2-0", "you", "Is it paid?", 11), said("N3-0", "Sam", "Which one?", 12), said("N3-1", "you", "The first", 13)],
          anchors: Object.fromEntries(Object.entries(quoted).map(([id, quote]) => [id, { thought_id: "T1-0", quote }])) };
        const openSpine = async () => {
          await go(`${base}/`);
          if (!await until(`document.querySelectorAll(".thread").length > 0`, 8000)) return false;
          await evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent === "Skip tour")?.click()`);
          await evaluate(`[...document.querySelectorAll(".palace-switch button")].find((b) => b.textContent === "Spine")?.click()`);
          if (!await until(`!!document.querySelector(".spine-frame.spine-ready")`, 8000)) return false;
          await settle();
          return true;
        };
        const notesShown = () => evaluate(`(() => {
          const box = (el) => { const r = el?.getBoundingClientRect(); return r && { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
          const quote = (id) => document.querySelector('.spine-quote[data-margin="' + id + '"]');
          const fold = document.querySelector('.spine-fold[data-fold-for="N1"]');
          return { quotes: ["N1", "N2", "N3"].map((id) => quote(id)?.textContent ?? null).join(" | "),
            underlined: [...document.querySelectorAll(".spine-quote")].every((q) => getComputedStyle(q).textDecorationLine.includes("underline")),
            folds: [...document.querySelectorAll(".spine-fold")].map((f) => f.dataset.foldFor + " " + f.textContent).join(),
            fold: fold && { ...box(fold), shown: getComputedStyle(fold).visibility === "visible" }, words: box(quote("N1")),
            notes: Object.fromEntries([...document.querySelectorAll(".spine-margin")].map((m) => [m.dataset.margin, m.textContent])),
            tangents: [...document.querySelectorAll(".spine-card")].map((c) => c.dataset.thread).filter((id) => /^N/.test(id)).join() };
        })()`);
        // What the notes show, with N1's question folded (nobody has opened it here) or open.
        const judgeNotes = (stage, look, folded) => {
          const bad = (why) => fail("spine (notes)", `in the app, ${stage}: ${why} (${JSON.stringify(look)})`);
          if (look.quotes !== "Friday | Rent due | point 1" || !look.underlined) bad("each note's own words aren't underlined");
          if (look.tangents) bad("a note is drawn as a tangent card");
          if (look.folds !== (folded ? "N1 …?" : "")) bad(folded ? "another person's unanswered question should fold to “…?”, and nothing else should" : "an opened question still shows its “…?”");
          else if (folded) {
            if (!look.fold.shown || look.fold.left < look.words.right - 2 || look.fold.left > look.words.right + 24 || look.fold.top > look.words.bottom || look.fold.bottom < look.words.top) bad("the “…?” isn't right after its words");
            if ("N1" in look.notes) bad("a folded question's note shows before it's opened");
          } else if (!look.notes.N1?.includes("Which Friday?")) bad("an opened question doesn't show");
          if (!look.notes.N2?.includes("Is it paid?")) bad("your own question is hidden from you (it shows at once)");
          if (!look.notes.N3?.includes("Which one?") || !look.notes.N3.includes("The first")) bad("an answered question doesn't show with its answer");
        };
        if (!await openSpine()) fail("spine (notes)", "the Spine never showed in the app");
        else {
          judgeNotes("when it opens", await notesShown(), true);
          await evaluate(`document.querySelector('.spine-fold[data-fold-for="N1"]')?.click()`);
          const opened = await until(`!document.querySelector(".spine-fold") && !!document.querySelector('.spine-margin[data-margin="N1"]')`, 2000);
          if (!opened) fail("spine (notes)", "in the app, the “…?” doesn't open the question");
          else judgeNotes("once the question is opened", await notesShown(), false);
          // A new snapshot, as the core sends one when a window reconnects: the notes stay, and the question opened stays open.
          core.send({ type: "snapshot", world: shown });
          await settle();
          await calm();
          judgeNotes("after a new snapshot", await notesShown(), !opened);
          // A reload: the map alone brings the notes back (nothing is kept in the window), the question folded again.
          if (!await openSpine()) fail("spine (notes)", "the Spine never showed in the app after a reload");
          else {
            judgeNotes("after a reload", await notesShown(), true);
            // The composer has the keyboard when the app opens: the camera's keys are typed into it, and move nothing.
            await evaluate(`document.querySelector(".composer textarea")?.focus()`);
            const rested = { view: await view(), lit: await lit(), following: await following() };
            await typed("2 3 0 f");
            const value = await evaluate(`document.querySelector(".composer textarea")?.value`);
            const moved = { view: await view(), lit: await lit(), following: await following() };
            if (value !== "2 3 0 f") fail("spine (zoom stops)", `typing in the composer left ${JSON.stringify(value)}, not "2 3 0 f"`);
            if (JSON.stringify(moved) !== JSON.stringify(rested)) fail("spine (zoom stops)", `typing in the composer moved the camera (${JSON.stringify(rested)} → ${JSON.stringify(moved)})`);
            // The same keys do work once the keyboard is the canvas's.
            await evaluate(`document.activeElement?.blur()`);
            await digit("2");
            if (!await until(`[...document.querySelectorAll(".spine-stop")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.firstChild.textContent).join() === "Titles"`, 2500)) fail("spine (zoom stops)", "in the app, 2 doesn't show Titles once the composer lets go of the keyboard");
          }
        }
        await evaluate(previousSwitches === null ? `localStorage.removeItem("e2a2o.bricks")` : `localStorage.setItem("e2a2o.bricks", ${JSON.stringify(previousSwitches)})`);
        shown = full;
      }
    }
  }
  // Brick chip: a panel that marks the app's points (the playground draws none), so it's checked in the app. Nothing on
  // the map that was there, nor on an empty one; a chip naming the brick on each point that lands after, anyone's,
  // first in the point's tools; quiet at rest; pointed at, it shows clear of Delete, Move and the placing time; on a
  // phone (touch, dark, reduced motion) a tap shows it in the row under the words, at once; a card folded and opened
  // gets its chips back; switched off, none stay.
  if (checked.includes("brick-chip")) {
    if (infos["./bricks/brick-chip/brick.json"].kind !== "panel") fail("brick-chip", "brick.json: a panel, as its spec says");
    const previousSwitches = await evaluate(`localStorage.getItem("e2a2o.bricks")`);
    const switched = (on) => evaluate(`localStorage.setItem("e2a2o.bricks", JSON.stringify({ "brick-chip": ${on} })); window.dispatchEvent(new StorageEvent("storage", { key: "e2a2o.bricks" }))`);
    const chips = `document.querySelectorAll(".brick-chip").length`;
    await switched(true);
    shown = full;
    await go(`${base}/`);
    if (!await until(`!!document.querySelector('[data-brick="brick-chip"]') && !!document.querySelector(".points li")`, 8000)) fail("brick-chip", "never mounted on a full map");
    else {
      await evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent === "Skip tour")?.click()`);
      await settle();
      if (await evaluate(chips)) fail("brick-chip", "chips on points that were on the map before");
      core.send({ type: "change", change: { type: "thought_added", thought: thought("chip-1", "Ask the landlord about the broken heater before the weekend", "T1") } });
      core.send({ type: "change", change: { type: "thought_added", thought: { ...thought("chip-2", "The bike is fine", "T1"), speaker: "Sam" } } });
      if (!await until(`${chips} === 2`, 4000)) fail("brick-chip", "no chip on each new point, yours and someone else's");
      const chip = (id) => `document.querySelector("#point-${id} .brick-chip")`;
      const marks = await evaluate(`[...document.querySelectorAll(".brick-chip")].map((c) => ({ text: c.textContent, first: c === c.parentElement.firstElementChild && c.parentElement.matches(".move-point"), opacity: getComputedStyle(c).opacity }))`);
      if (marks.some((m) => m.text !== "Brick chip" || !m.first || m.opacity !== "0")) fail("brick-chip", `not the brick's name, first in the point's tools and quiet at rest: ${JSON.stringify(marks)}`);
      const at = await evaluate(`(() => { const r = document.getElementById("point-chip-1").getBoundingClientRect(); return { x: r.left + 20, y: r.top + 6 }; })()`);
      await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
      if (!await until(`getComputedStyle(${chip("chip-1")}).opacity === "1"`, 2000)) fail("brick-chip", "pointing at the point doesn't show its chip");
      // Clear of the point's own tools and its time: the chip's box crosses none of theirs.
      const clear = `(() => { const c = ${chip("chip-1")}.getBoundingClientRect(), p = document.getElementById("point-chip-1");
        return [...p.querySelectorAll(".move-button, .speed")].every((o) => { const r = o.getBoundingClientRect(); return c.right <= r.left + 0.5 || c.left >= r.right - 0.5 || c.bottom <= r.top + 0.5 || c.top >= r.bottom - 0.5; })
          && c.left >= 0 && c.right <= innerWidth; })()`;
      if (!await evaluate(clear)) fail("brick-chip", "the chip covers Delete, Move or the placing time, or leaves the window");
      await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
      if (!await until(`getComputedStyle(${chip("chip-1")}).opacity === "0"`, 2000)) fail("brick-chip", "the pointer gone, its chip stays");
      await evaluate(`document.querySelector("#thread-T1 > .thread-head .thread-toggle").click()`);
      await until(`!document.getElementById("point-chip-1")`, 3000);
      await evaluate(`document.querySelector("#thread-T1 > .thread-head .thread-toggle").click()`);
      if (!await until(`${chips} === 2`, 3000)) fail("brick-chip", "a card folded and opened doesn't get exactly its chips back");
      await width(390, 844);
      await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }, { name: "prefers-reduced-motion", value: "reduce" }] });
      await settle();
      await evaluate(`document.getElementById("point-chip-1").focus()`);
      const phone = await evaluate(`(() => { const c = ${chip("chip-1")}, s = getComputedStyle(c), words = document.querySelector("#point-chip-1 > span:not(.sr-only)").getBoundingClientRect();
        return { touch: matchMedia("(hover: none)").matches, shown: s.opacity, instant: s.transitionDuration === "0s", color: s.color, below: c.getBoundingClientRect().top >= words.bottom - 1,
          sideways: document.documentElement.scrollWidth - innerWidth }; })()`);
      if (!phone.touch || phone.shown !== "1" || !phone.instant || phone.color !== "rgb(196, 165, 255)" || !phone.below || phone.sideways > 1 || !await evaluate(clear)) fail("brick-chip", `a tap on a dark phone, reduced motion: ${JSON.stringify(phone)}`);
      await cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
      await cdp("Emulation.setEmulatedMedia", { features: [] });
      await width(1280, 860);
      await switched(false);
      if (!await until(`!document.querySelector('[data-brick="brick-chip"]') && ${chips} === 0`, 3000)) fail("brick-chip", "switched off, chips stay");
      await switched(true);
      await until(`!!document.querySelector('[data-brick="brick-chip"]')`, 3000);
      await settle();
      if (await evaluate(chips)) fail("brick-chip", "switched off and on, the old chips come back");
      core.send({ type: "snapshot", world: empty });
      await until(`!!document.querySelector(".empty h1")`, 3000);
      if (await evaluate(`${chips} || document.querySelector('[data-brick="brick-chip"]').textContent.trim().length`)) fail("brick-chip", "shows something on an empty map");
      if (await evaluate(`!!document.querySelector(".brick-broke")`)) fail("brick-chip", "it broke");
    }
    await evaluate(previousSwitches === null ? `localStorage.removeItem("e2a2o.bricks")` : `localStorage.setItem("e2a2o.bricks", ${JSON.stringify(previousSwitches)})`);
  }
  if (only) { assert.deepEqual(problems, [], `\n${problems.join("\n")}\n`); await cleanup(); console.log(`bricks-check: ok (${only}: its folder's rules and the playground)`); process.exit(0); }

  // 6. The app with every brick at its default; then each view brick switched on in the Catalog.
  const appBricks = folders.filter((f) => !f.startsWith("_")).map((f) => infos[`./bricks/${f}/brick.json`]).filter(Boolean);
  const brickNames = appBricks.map((info) => info.name);
  const viewBricks = appBricks.filter((info) => info.kind === "view");
  shown = empty;
  await go(`${base}/`);
  await until(`!!document.querySelector(".empty h1")`, 8000);
  await settle();
  const first = await evaluate(`({ bricks: document.querySelectorAll("[data-brick]").length, catalog: !!document.querySelector(".catalog, .apps-catalog"),
    level: !!document.querySelector(".level-meter") })`);
  if (first.bricks || first.catalog || first.level) fail("app's first screen", `bricks at their defaults show up: ${JSON.stringify(first)}`);
  shown = full;
  await go(`${base}/`);
  await until(`document.querySelectorAll(".thread").length > 0`, 8000);
  await settle();
  // The slots today's layout has: one each, and no name the contract doesn't know. No stage yet: today's dock spans the
  // window, so a view's corners (the Spine's) would sit under it beside one.
  const slots = await evaluate(`[...document.querySelectorAll("[data-slot]")].map((el) => el.dataset.slot)`);
  for (const name of ["top-left", "top-right", "status"]) if (slots.filter((s) => s === name).length !== 1) fail("the app's slots", `${slots.filter((s) => s === name).length} data-slot="${name}", not one`);
  if (slots.includes("stage")) fail("the app's slots", "a stage on today's dock: the Spine's corners would go beside it, under the dock");
  const named = [...read(join(bricksDir, "contract.ts")).match(/export const SLOTS = \[([^\]]*)\]/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  for (const name of slots) if (!named.includes(name) && !name.startsWith("slot:")) fail("the app's slots", `data-slot="${name}" isn't a contract name`);
  const views = () => evaluate(`[...document.querySelectorAll(".palace-switch button")].map((b) => b.textContent)`);
  assert.deepEqual(await views(), ["Map", "Palace"], "at their defaults, no brick joins Map and Palace");
  await evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent === "Skip tour")?.click()`);
  // "What just happened?" with the Notice timeline off: the answer says where to switch it on, and the view stays.
  const viewButton = (name) => `[...document.querySelectorAll(".palace-switch button")].find((b) => b.textContent === ${JSON.stringify(name)})`;
  await evaluate(`${viewButton("Palace")}.click()`);
  core.send({ type: "view", view: "notices" });
  if (!await until(`(document.querySelector(".notice > span")?.textContent ?? "").includes("Notice timeline is off")`, 3000)) fail("what just happened (Notice timeline off)", "no notice says where to switch it on");
  if (await evaluate(`document.querySelector(".palace-switch button[aria-pressed=true]")?.textContent`) !== "Palace") fail("what just happened", "the ask switched the view");
  await evaluate(`${viewButton("Map")}.click()`);
  await until(`!!document.querySelector("main.map .thread")`, 3000);
  // Tiny transcript off (its default): the dock's big line shows your words, as ever. A tab takes live words only while
  // its own mic is on, so the mic starts first, as live-page-check starts it: a stand-in microphone (a tone through a
  // real MediaStream) and a real tap.
  const tiny = appBricks.find((info) => info.id === "tiny-transcript");
  const timeline = appBricks.find((info) => info.id === "notice-timeline");
  const tapMic = async () => {
    const at = await evaluate(`(() => { const r = document.querySelector("button.mic").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    for (const type of ["mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
  };
  if (tiny) {
    await evaluate(`navigator.mediaDevices.getUserMedia = async () => { const ctx = new AudioContext(); const tone = ctx.createOscillator();
      const out = ctx.createMediaStreamDestination(); tone.connect(out); tone.start(); return out.stream; }`);
    await tapMic();
    if (!await until(`!!document.querySelector(".status.capturing")`, 5000)) fail("the dock", "a tap on the mic didn't start it, so no live words reach this tab");
    core.send({ type: "partial", text: "The rent is due" });
    if (!await until(`document.querySelector(".dock .live.words")?.textContent.includes("The rent is due")`, 3000)) fail("the dock", "with Tiny transcript off, its live line doesn't show your words");
    core.send({ type: "partial", text: "" });
    // Its first-use hint is checked in the playground; here it would only cover the dock.
    await evaluate(`localStorage.setItem("e2a2o.brick.tiny-transcript.hinted", "true")`);
  }
  await evaluate(`document.querySelector(".apps-title").click()`);
  await until(`!!document.querySelector(".apps-catalog button")`, 3000);
  await evaluate(`document.querySelector(".apps-catalog button").click()`);
  if (!await until(`!!document.querySelector("dialog.catalog[open]")`, 3000)) fail("Catalog", "doesn't open from the Apps panel");
  const listed = await evaluate(`[...document.querySelectorAll(".catalog-row strong")].map((s) => s.textContent)`);
  for (const name of brickNames) if (!listed.includes(name)) fail("Catalog", `doesn't list ${name}`);
  if (listed.length !== brickNames.length) fail("Catalog", `lists ${listed.length} bricks, the folders hold ${brickNames.length}`);
  const switchFor = (name) => `[...document.querySelectorAll(".catalog-row")].find((r) => r.querySelector("strong").textContent === ${JSON.stringify(name)}).querySelector("[role=switch]")`;
  for (const { name } of [...viewBricks, ...(tiny ? [tiny] : []), ...(timeline ? [timeline] : [])]) {
    await evaluate(`${switchFor(name)}.click()`);
    if (await evaluate(`${switchFor(name)}.getAttribute("aria-checked")`) !== "true") fail("Catalog", `${name}'s switch didn't turn on`);
  }
  await evaluate(`document.querySelector(".catalog-close").click()`);
  if (!await until(`!document.querySelector("dialog.catalog")`, 2000)) fail("Catalog", "× doesn't close it");
  // Tiny transcript on: your words from the core show in it, 11 px, and not in the dock (never twice); a long turn
  // keeps its newest words in view, its start behind the "…"; at the turn's end the words go.
  if (tiny) {
    const long = "So for the garden this year it's tomatoes along the fence, beans up the trellis, and the herbs by the kitchen door where the morning light is best";
    core.send({ type: "partial", text: long });
    if (!await until(`document.querySelector(".tiny-transcript-text")?.textContent === ${JSON.stringify(long)}`, 3000)) fail("Tiny transcript", "switched on, it doesn't show your words as they're heard");
    else {
      if (await evaluate(`!!document.querySelector(".dock .live")`)) fail("Tiny transcript", "the dock's big line still shows: your words show twice");
      // Inside the composer's box, over its field, on the box's color: where its "Or type a thought" sits, under them.
      const inBox = `(() => { const words = document.querySelector(".tiny-transcript-text"), t = words.getBoundingClientRect(), composer = document.querySelector(".composer");
        const b = composer.getBoundingClientRect(), f = composer.querySelector("textarea").getBoundingClientRect();
        return { inside: t.left >= b.left - 0.5 && t.right <= b.right + 0.5 && t.top >= b.top - 0.5 && t.bottom <= b.bottom + 0.5,
          overField: Math.abs(t.left - f.left) < 1 && Math.abs(t.right - f.right) < 1 && Math.abs((t.top + t.bottom) / 2 - (f.top + f.bottom) / 2) < 2,
          covers: getComputedStyle(words).backgroundColor === getComputedStyle(composer).backgroundColor, above: t.bottom <= b.top + 0.5 }; })()`;
      const boxed = await evaluate(inBox);
      if (!boxed.inside || !boxed.overField) fail("Tiny transcript", `its words aren't inside the composer's box, where its "Or type a thought" sits: ${JSON.stringify(boxed)}`);
      if (!boxed.covers) fail("Tiny transcript", "its words don't cover the box's own hint text, so both show at once");
      // The words at the line's right end, measured letter by letter (a caret probe can't see words that let the
      // pointer through): the newest ones, which are also the ones said stronger.
      const line = await evaluate(`(() => {
        const text = document.querySelector(".tiny-transcript-text"), box = text.getBoundingClientRect(), style = getComputedStyle(text);
        const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT), range = document.createRange();
        let at = 0, end = -1;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          for (let i = 0; i < node.length; i++) {
            range.setStart(node, i); range.setEnd(node, i + 1);
            const r = range.getBoundingClientRect();
            if (r.width && r.left >= box.left - 0.5 && r.right <= box.right + 0.5) end = at + i + 1;
          }
          at += node.length;
        }
        return { size: style.fontSize, clipped: text.scrollWidth > text.clientWidth || text.querySelector("bdi").getBoundingClientRect().left < box.left, end,
          stronger: [...text.querySelectorAll("bdi > span")].at(-1)?.textContent ?? "" };
      })()`);
      if (line.size !== "11px") fail("Tiny transcript", `its words are ${line.size}, not 11 px`);
      if (!line.clipped) fail("Tiny transcript", "the long turn fits, so its end isn't checked (make it longer)");
      if (line.end < long.length - 3) fail("Tiny transcript", `a long turn shows its start, not the words being said now (the line ends at character ${line.end} of ${long.length})`);
      if (line.stronger !== long.split(" ").slice(-3).join(" ")) fail("Tiny transcript", `the words said stronger are "${line.stronger}", not the newest three`);
      // Your own typing keeps the box: the words wait just above it, clear of what you typed; cleared, they're back.
      const draft = (value) => evaluate(`(() => { const field = document.querySelector(".composer textarea");
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, ${JSON.stringify(value)});
        field.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      await draft("Buy candles");
      if (!await until(`(${inBox}).above`, 1500)) fail("Tiny transcript", "with something typed in the box, the words still cover it");
      await draft("");
      if (!await until(`(${inBox}).inside`, 1500)) fail("Tiny transcript", "the box emptied, the words don't come back into it");
      // On a phone, the Notice timeline's clock sits clear of the line (it ran 10 px into it).
      if (timeline) {
        core.send({ type: "notice", message: "A notice for the clock" });
        for (const [w, h] of [[390, 844], [320, 568]]) {
          await width(w, h);
          if (!await until(`!!document.querySelector(".notice-timeline-clock") && !!document.querySelector(".tiny-transcript-text")`, 3000)) { fail("Notice timeline", `no clock, or no line, at ${w} px`); continue; }
          await settle();
          const apart = await evaluate(`(() => { const c = document.querySelector(".notice-timeline-clock").getBoundingClientRect(), t = document.querySelector(".tiny-transcript-text").getBoundingClientRect();
            return c.bottom <= t.top || c.right <= t.left || c.left >= t.right || c.top >= t.bottom; })()`);
          if (!apart) fail("Notice timeline", `its clock covers Tiny transcript's line at ${w} px`);
        }
        await width(1280, 860);
      }
    }
    core.send({ type: "partial", text: "" });
    if (!await until(`!document.querySelector(".tiny-transcript")`, 2000)) fail("Tiny transcript", "keeps showing words once the turn is over");
    // A turn's words stay until its thought comes, and go the moment it does: they turn into it where they were.
    core.send({ type: "partial", text: "Ask Maya to bring the folding chairs" });
    await until(`!!document.querySelector(".tiny-transcript-text")`, 2000);
    core.send({ type: "partial", text: "" });
    await sleep(300);
    if (!await evaluate(`!!document.querySelector(".tiny-transcript-text")`)) fail("Tiny transcript", "a turn's words went before its thought came");
    core.send({ type: "change", change: { type: "thought_added", thought: { ...thought("said-1", "Ask Maya to bring the folding chairs", null), placed: false } } });
    if (!await until(`!document.querySelector(".tiny-transcript")`, 500)) fail("Tiny transcript", "a turn's words stay once its thought came");
    core.send({ type: "change", change: { type: "thought_placed", thought_id: "said-1", thread_id: "T2", point: "Ask Maya to bring the folding chairs", unclear: "", complete: true, place_ms: 2000 } });
    await tapMic();
    if (!await until(`!document.querySelector(".status.capturing")`, 3000)) fail("the dock", "a second tap on the mic didn't stop it");
  }
  const switched = ["Map", "Palace", ...viewBricks.map((info) => info.name)].join();
  if ((await views()).join() !== switched) fail("Catalog", `switched on, the view switch says ${await views()}, not ${switched}`);
  // Each view shows in the map's place, with something in it, and Map brings the map back.
  for (const { id, name } of viewBricks) {
    await evaluate(`[...document.querySelectorAll(".palace-switch button")].find((b) => b.textContent === ${JSON.stringify(name)}).click()`);
    if (!await until(`!!document.querySelector('main.brick-view[data-brick="${id}"]')?.textContent.trim() && !document.querySelector("main.map")`, 4000)) fail(name, "doesn't show in the map's place");
    if (id === "bubbles") {
      const drawn = await evaluate(`document.querySelectorAll("[data-brick=bubbles] .bubbles-bubble").length`);
      if (drawn !== full.threads.length) fail("Bubbles", `${drawn} bubbles for ${full.threads.length} threads`);
      // A thought the core places reaches the brick as `landed` (the app's host, not the playground's): its bubble ripples.
      core.send({ type: "change", change: { type: "thought_added", thought: thought("landing-1", "Flights to Lisbon booked", "T3") } });
      if (!await until(`!!document.querySelector('[data-brick="bubbles"] [data-thread="T3"] .bubbles-ripple')`, 3000)) fail("Bubbles", "a thought landing in the app doesn't ripple its bubble");
      if (await evaluate(`document.querySelectorAll(".bubbles-ripple").length`) !== 1) fail("Bubbles", "a landing rippled more than its own bubble");
      const target = await evaluate(`(() => { const face = document.querySelectorAll(".bubbles-face")[2]; face.click(); return face.dataset.thread; })()`);
      if (!await until(`document.querySelector(".palace-switch button[aria-pressed=true]")?.textContent === "Map" && !!document.getElementById(${JSON.stringify(`thread-${target}`)})`, 3000)) fail("Bubbles", "a bubble doesn't open the map at its thread");
      await sleep(200);
      if (!core.heard.some((m) => m.type === "focus" && m.thread_id === target)) fail("Bubbles", `opening ${target} didn't move your place there (no focus sent)`);
    }
    if (id === "spine") {
      await until(`!!document.querySelector(".spine-frame.spine-ready")`, 4000);
      core.send({ type: "change", change: { type: "thought_added", thought: thought("landing-2", "Seeds for the garden", "T2") } });
      // A pulse, or under Reduce Motion (this machine's own, if a check before handed it back) a ring that stays a second.
      if (!await until(`!!document.querySelector('[data-brick="spine"] .spine-ring, [data-brick="spine"] .spine-point.spine-cut')`, 3000)) fail("Spine", "a thought landing in the app doesn't ring its point");
      core.send({ type: "change", change: { type: "positioned", id: "T4-0", x: 2400, y: 1600, by: "Claude", at_ms: Date.now() } });
      if (!await until(`(document.querySelector('.react-flow__node[data-id="p:T4-0"]')?.style.transform ?? "").includes("2400px, 1600px")`, 3000)) fail("Spine", "a point someone else placed doesn't go there");
      // A margin note from the core (the contract's anchored tangent): its words marked on the point, the note beside them.
      core.send({ type: "change", change: { type: "thread_added", thread: thread("N9", "Point 1", { parent_id: "T1" }) } });
      core.send({ type: "change", change: { type: "anchored", thread_id: "N9", thought_id: "T1-0", quote: "point 1" } });
      core.send({ type: "change", change: { type: "thought_added", thought: thought("note-1", "Due on the first?", "N9") } });
      if (!await until(`document.querySelector('.spine-quote[data-margin="N9"]')?.textContent === "point 1" && (document.querySelector('.spine-margin[data-margin="N9"]')?.textContent ?? "").includes("Due on the first?")`, 3000)) {
        fail("Spine", "a margin note from the core isn't tied to its words, with the note beside them");
      }
      // Once the canvas has settled (a glide is 0.3 s, the camera's at most 0.9 s): a press lands where it's aimed.
      await sleep(1000);
      const tip = await middle(`.react-flow__node[data-id="p:T1-0"] .spine-text`);
      if (!tip) fail("Spine", "no point T1-0 on the canvas");
      else {
        await drag(tip, { x: tip.x + 50, y: tip.y + 180 });
        await sleep(200);
        if (!core.heard.some((m) => m.type === "position" && m.id === "T1-0" && typeof m.x === "number" && typeof m.y === "number")) fail("Spine", "a drag doesn't reach the core as a position");
      }
    }
    await evaluate(`[...document.querySelectorAll(".palace-switch button")].find((b) => b.textContent === "Map").click()`);
    if (!await until(`!!document.querySelector("main.map .thread")`, 3000)) fail(name, "Map doesn't bring the map back");
  }
  await go(`${base}/`);
  await until(`document.querySelectorAll(".thread").length > 0`, 8000);
  if ((await views()).join() !== switched) fail("Catalog", "a switch isn't kept after a reload (it's this browser's)");
  await evaluate(`localStorage.removeItem("e2a2o.bricks")`);
  if (appBricks.some((info) => info.flag === "level")) {
    await go(`${base}/?level`);
    if (!await until(`!!document.querySelector(".level-meter")`, 4000)) fail("Level meter", "?level doesn't show it");
    await go(`${base}/`);
    await until(`document.querySelectorAll(".thread").length > 0`, 8000);
    await settle();
    if (await evaluate(`!!document.querySelector(".level-meter")`)) fail("Level meter", "shows without ?level");
  }
  // Bubble flight in the app: the real composer, the Spine's slot, and the once-only Reduce Motion hint.
  {
    const where = "Bubble flight (app, Spine)";
    const previousSwitches = await evaluate(`localStorage.getItem("e2a2o.bricks")`);
    const clearFlightSettings = `localStorage.removeItem("e2a2o.brick.bubble-flight.show"); localStorage.removeItem("e2a2o.brick.bubble-flight.hinted")`;
    const openSpine = async () => {
      shown = full;
      await go(`${base}/`);
      const switchReady = await until(`[...document.querySelectorAll(".palace-switch button")].some((b) => b.textContent === "Spine")`, 8000);
      await evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent === "Skip tour")?.click()`);
      await evaluate(`[...document.querySelectorAll(".palace-switch button")].find((b) => b.textContent === "Spine")?.click()`);
      const ready = await until(`!!document.querySelector(".spine-frame.spine-ready")`, 4000);
      if (!switchReady || !ready) fail(where, `The Spine did not become ready: switch available ${switchReady}, frame ready ${ready}.`);
      await sleep(1200);
      await settle();
      return switchReady && ready;
    };
    const add = (id) => core.send({ type: "change", change: { type: "thought_added", thought: { ...thought(id, "Ask Maya to bring the folding chairs", null), placed: false } } });
    const place = (id) => core.send({ type: "change", change: { type: "thought_placed", thought_id: id, thread_id: "T1", point: "Ask Maya to bring the folding chairs", unclear: "", complete: true, place_ms: 2600 } });
    try {
      await evaluate(`localStorage.setItem("e2a2o.bricks", JSON.stringify({ "spine": true, "bubble-flight": true })); ${clearFlightSettings}`);
      await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
      await width(1280, 860);
      if (await openSpine()) {
        const sent = Date.now();
        add("fly-1");
        const appeared = await until(`!!document.querySelector('.bubble-flight-bubble[data-flight="fly-1"]') && !!document.querySelector('[data-slot="slot:fly-1"]')`, 1000);
        if (!appeared) {
          const found = await evaluate(`({ bubble: !!document.querySelector('.bubble-flight-bubble[data-flight="fly-1"]'), slot: !!document.querySelector('[data-slot="slot:fly-1"]') })`);
          fail(where, `The bubble and slot did not both appear within 1000 ms: ${JSON.stringify(found)}.`);
        }
        const position = `(() => {
          const bubble = document.querySelector('.bubble-flight-bubble[data-flight="fly-1"]')?.getBoundingClientRect();
          const slot = document.querySelector('[data-slot="slot:fly-1"]')?.getBoundingClientRect();
          const composer = document.querySelector(".composer")?.getBoundingClientRect();
          if (!bubble || !slot || !composer) return null;
          const x = bubble.left + bubble.width / 2, y = bubble.top + bubble.height / 2;
          return { x, y, bottom: bubble.bottom, composerTop: composer.top,
            distance: Math.hypot(x - slot.left - slot.width / 2, y - slot.top - slot.height / 2) };
        })()`;
        await sleep(Math.max(0, 300 - (Date.now() - sent)));
        const early = await evaluate(position);
        await sleep(Math.max(0, 1500 - (Date.now() - sent)));
        const drifted = await evaluate(position);
        if (!drifted || drifted.bottom >= drifted.composerTop) fail(where, `At 1500 ms the bubble was not above the composer: ${JSON.stringify(drifted)}.`);
        if (!early || !drifted || !(early.distance > 0) || drifted.distance > early.distance * 0.85) fail(where, `The distance to the slot did not shrink by at least 15% from 300 to 1500 ms: early ${JSON.stringify(early)}, later ${JSON.stringify(drifted)}.`);

        // Start observing before the core places it; each last-frame comparison uses that frame's slot too.
        const measuring = evaluate(`new Promise((resolve) => {
          const start = performance.now();
          const initial = document.querySelector('.bubble-flight-bubble[data-flight="fly-1"]');
          const presentAtStart = !!initial;
          // The glide counts from the frame its point is on the map (it was drifting before that, which isn't the glide).
          let transform = initial?.style.transform, placedAt = null, lastChange = null, last = null;
          const frame = (now) => {
            const bubble = document.querySelector('.bubble-flight-bubble[data-flight="fly-1"]');
            if (placedAt === null && document.querySelector('[data-thought="fly-1"]')) placedAt = now;
            if (!bubble || now - start >= 2000) {
              resolve({ presentAtStart, gone: !bubble, elapsed: now - start,
                movingMs: placedAt === null || lastChange === null ? null : Math.round(lastChange - placedAt), last });
              return;
            }
            if (bubble.style.transform !== transform) {
              if (placedAt !== null) lastChange = now;
              transform = bubble.style.transform;
            }
            const words = bubble.querySelector(".bubble-flight-words")?.getBoundingClientRect();
            const slot = document.querySelector('[data-slot="slot:fly-1"]');
            const box = slot?.getBoundingClientRect();
            const text = slot && [...slot.querySelectorAll("*")].find((el) => (el.textContent ?? "").trim().startsWith("Ask Maya"));
            const line = text?.getBoundingClientRect();
            last = words && box ? { wordsY: words.top + words.height / 2, slotY: line ? line.top + line.height / 2 : box.top + box.height / 2,
              wordsLeft: words.left, textLeft: line ? line.left : box.left + 44 } : null;
            requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        })`);
        place("fly-1");
        const landing = await measuring;
        if (!landing.presentAtStart || !landing.gone || landing.elapsed > 900) fail(where, `The placed bubble did not leave the air within 900 ms: ${JSON.stringify(landing)}.`);
        if (landing.movingMs === null || landing.movingMs > 450) fail(where, `Placed, the bubble glided for ${landing.movingMs} ms, not 400 ms at most (a frame's slack: 450).`);
        if (!landing.last || Math.abs(landing.last.wordsY - landing.last.slotY) > 6 || Math.abs(landing.last.wordsLeft - landing.last.textLeft) > 12) fail(where, `The bubble's words didn't settle onto the point's in its slot (6 px up or down, 12 px across): ${JSON.stringify(landing.last)}.`);
        const ring = await until(`!!document.querySelector('[data-brick="spine"] .spine-ring, [data-brick="spine"] .spine-point.spine-cut')`, 1500);
        if (!ring) fail(where, `The Spine showed no landing ring within 1500 ms after the bubble left: ring ${ring}.`);
      }

      await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      await evaluate(clearFlightSettings);
      if (await openSpine()) {
        add("fly-2");
        const quietBubbles = await evaluate(`new Promise((resolve) => {
          const start = performance.now(); let most = 0;
          const frame = (now) => {
            most = Math.max(most, document.querySelectorAll(".bubble-flight-bubble").length);
            if (now - start >= 500) resolve(most); else requestAnimationFrame(frame);
          }; requestAnimationFrame(frame);
        })`);
        if (quietBubbles) fail(where, `Reduce Motion with Show the flight off showed ${quietBubbles} bubbles during 500 ms on the way.`);
        place("fly-2");
        const hint = await evaluate(`new Promise((resolve) => {
          const start = performance.now(); let most = 0;
          const frame = (now) => {
            most = Math.max(most, document.querySelectorAll(".bubble-flight-bubble").length);
            const hint = document.querySelector(".bubble-flight-hint");
            if (hint || now - start >= 4500) resolve({ bubbles: most, elapsed: now - start,
              text: hint?.textContent ?? null, checked: hint?.querySelector('button[role="switch"]')?.getAttribute("aria-checked") ?? null });
            else requestAnimationFrame(frame);
          }; requestAnimationFrame(frame);
        })`);
        if (hint.bubbles) fail(where, `Reduce Motion with Show the flight off showed ${hint.bubbles} bubbles after placement.`);
        if (!hint.text?.includes("Show the flight") || hint.checked !== "false" || hint.elapsed > 4500) fail(where, `The Reduce Motion hint did not offer an unchecked Show the flight switch within 4500 ms: ${JSON.stringify(hint)}.`);
        await evaluate(`document.querySelector('.bubble-flight-hint button[role="switch"]')?.click()`);
        await settle();
        const switched = await evaluate(`({ checked: document.querySelector('.bubble-flight-hint [role="switch"]')?.getAttribute("aria-checked") ?? null, show: localStorage.getItem("e2a2o.brick.bubble-flight.show") })`);
        if (switched.checked !== "true" || switched.show !== "true") fail(where, `The hint's switch did not enable and save Show the flight: ${JSON.stringify(switched)}.`);
        await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        const dismissed = await until(`!document.querySelector(".bubble-flight-hint") && localStorage.getItem("e2a2o.brick.bubble-flight.hinted") !== null`, 1000);
        if (!dismissed) {
          const state = await evaluate(`({ hint: !!document.querySelector(".bubble-flight-hint"), hinted: localStorage.getItem("e2a2o.brick.bubble-flight.hinted") })`);
          fail(where, `Escape did not dismiss and remember the hint within 1000 ms: ${JSON.stringify(state)}.`);
        }

        add("fly-3");
        const flying = await until(`!!document.querySelector('.bubble-flight-bubble[data-flight="fly-3"]')`, 1000);
        if (!flying) fail(where, `Reduce Motion with Show the flight on showed no bubble within 1000 ms: bubble ${flying}.`);
        const transforms = await evaluate(`new Promise((resolve) => {
          const start = performance.now(), values = new Set();
          const frame = (now) => {
            const bubble = document.querySelector('.bubble-flight-bubble[data-flight="fly-3"]');
            if (bubble?.style.transform) values.add(bubble.style.transform);
            if (now - start >= 1000) resolve(values.size); else requestAnimationFrame(frame);
          }; requestAnimationFrame(frame);
        })`);
        if (transforms < 5) fail(where, `The requested flight under Reduce Motion had ${transforms} distinct inline transforms in 1000 ms instead of at least 5.`);
        place("fly-3");
        const gone = await until(`!document.querySelector('[data-flight="fly-3"]')`, 1500);
        if (!gone) fail(where, `The requested flight under Reduce Motion stayed in the air past 1500 ms: gone ${gone}.`);
        const repeated = await evaluate(`new Promise((resolve) => {
          const start = performance.now(); let seen = false;
          const frame = (now) => {
            seen ||= !!document.querySelector(".bubble-flight-hint");
            if (now - start >= 4000) resolve(seen); else requestAnimationFrame(frame);
          }; requestAnimationFrame(frame);
        })`);
        if (repeated) fail(where, `The dismissed hint returned during 4000 ms of quiet: hint seen ${repeated}.`);
      }
    } finally {
      await cdp("Emulation.setEmulatedMedia", { features: [] });
      await evaluate(clearFlightSettings);
      await evaluate(previousSwitches === null ? `localStorage.removeItem("e2a2o.bricks")` : `localStorage.setItem("e2a2o.bricks", ${JSON.stringify(previousSwitches)})`);
      await width(1280, 860);
    }
  }
} finally {
  await cleanup();
}
assert.deepEqual(problems, [], `\n${problems.join("\n")}\n`);
console.log(`bricks-check: ok (${checked.length} bricks: ${kinds.join(", ")}; playground and app)`);
