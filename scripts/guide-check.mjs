// No extra dependencies: run with `node scripts/guide-check.mjs` (after the UI is built; precheck builds it first).
// Another participant shows you a part of the screen and says a line in the corner (docs/guide.md: the core relays
// `point` and `caption`, core/src/guide.rs; ui/src/Guide.tsx draws them). Held here:
//  1. The rules (ui/src/guide-core.ts, through Vite): docs/guide.md lists exactly the names the code knows, and each
//     fixed name is on an element; where the arrow and its caption go; how long a caption stays; one point at a time;
//     where a part that isn't on screen is instead.
//  2. On the built UI in headless Chrome over a stand-in core (exit 3, precheck's WARN, without Chrome or ui/dist): the
//     arrow lands on the named part, scrolled into view, and follows it; Esc and a click take it down; Show on the card
//     a thought is in and the Map button lead it on to the part; a part not on screen is said, not guessed; a caption
//     shows bottom-left, off the composer and over an open sheet, goes once read and holds under the pointer; a phone
//     keeps both on screen; Reduce Motion scrolls at once and moves nothing.
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
const { NAMES, place, aimAt, arrowLength, captionMs, CAPTION_SHORTEST_MS, guided, NOTHING, instead, label, GUTTER, TIP_GAP, HOLE_PAD } = rules;

// The docs list every name the code knows and no other; each fixed name is on an element, each made one has its maker.
const listed = [...read("docs/guide.md").matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
assert.deepEqual(listed.toSorted(), [...Object.keys(NAMES), "thread:<id>", "point:<id>", "view:<id>"].toSorted(), "docs/guide.md lists each name guide-core.ts knows");
const src = readdirSync(new URL("ui/src/", root)).filter((f) => f.endsWith(".tsx")).map((f) => read(`ui/src/${f}`)).join("\n");
for (const name of Object.keys(NAMES)) assert.ok(src.includes(`data-guide="${name}"`), `no element in ui/src has data-guide="${name}"`);
for (const made of ["thread:${thread.id}", "point:${thought.id}", "view:${brick.info.id}"]) assert.ok(src.includes(`data-guide={\`${made}\`}`), `no element is named ${made}`);

// Where the arrow goes: onto the composer from above, its caption above it; a header button from below; a caption kept
// whole on screen at its edge; a card taller than the screen from the side, at its head; a phone's shorter arrow.
const laptop = { width: 1440, height: 900 }, size = { width: 220, height: 58 };
let p = place({ left: 340, top: 820, right: 1100, bottom: 872 }, laptop, size);
assert.equal(p.side, "above");
assert.deepEqual(p.tip, { x: 720, y: 820 - TIP_GAP });
assert.ok(p.caption.top + size.height <= p.tail.y && p.caption.left <= 720 && p.caption.left + size.width >= 720, "the caption sits on the arrow's tail");
assert.equal(place({ left: 1200, top: 14, right: 1280, bottom: 50 }, laptop, size).side, "below");
p = place({ left: 1386, top: 14, right: 1430, bottom: 50 }, laptop, size);
assert.ok(p.caption.left >= GUTTER && p.caption.left + size.width <= laptop.width - GUTTER, "the caption stays whole on screen");
p = place({ left: 400, top: 40, right: 1040, bottom: 890 }, laptop, size);
assert.ok(p.side === "left" || p.side === "right", p.side);
assert.equal(p.tip.y, 40 + 28, "at a tall card's head");
// A card of the page, between the header (180) and the dock (700): below would fit on the screen, but only over the
// dock, so the arrow comes from the side, and its caption stays between the two.
const card = { left: 130, top: 190, right: 714, bottom: 595 };
assert.equal(place(card, laptop, size).side, "below");
p = place(card, { ...laptop, top: 180, bottom: 700 }, size);
assert.equal(p.side, "right");
assert.ok(p.caption.top >= 180 + GUTTER && p.caption.top + size.height <= 700 - GUTTER, "between the header and the dock");
const phone = { width: 390, height: 844 };
p = place({ left: 330, top: 776, right: 370, bottom: 816 }, phone, { width: 260, height: 76 });
assert.equal(arrowLength(phone.width), 52);
assert.equal(p.side, "above");
assert.ok(p.caption.left >= GUTTER && p.caption.left + 260 <= phone.width - GUTTER);
// What it aims at: the part as seen between the header and the dock; past the band, a sliver at the edge it's past.
const band = { top: 120, bottom: 760, width: 1440 };
assert.deepEqual(aimAt({ left: 400, top: 100, right: 1000, bottom: 300 }, band), { box: { left: 400, top: 120, right: 1000, bottom: 300 }, seen: true });
assert.deepEqual(aimAt({ left: 400, top: -200, right: 1000, bottom: 80 }, band), { box: { left: 400, top: 120, right: 1000, bottom: 120 }, seen: false });
assert.deepEqual(aimAt({ left: 400, top: 900, right: 1000, bottom: 1000 }, band), { box: { left: 400, top: 760, right: 1000, bottom: 760 }, seen: false });

// How long a caption stays: 4 s at least; a long one outlasts being spoken at the bridge's 200 words a minute.
assert.equal(captionMs("Look here."), CAPTION_SHORTEST_MS);
assert.ok(captionMs(Array(70).fill("word").join(" ")) >= (70 / 200) * 60_000 + 1000, "a long caption outlasts its words spoken");

// One point at a time; only its sender takes it down; the same words again are a new caption.
const msg = (kind, target, text, by = "Claude") => ({ type: "guide", kind, target, text, by, at_ms: 1 });
let s = guided(NOTHING, msg("point", "composer", "Type here"), 1);
s = guided(s, msg("point", "mic", ""), 2);
assert.equal(s.point.target, "mic");
assert.equal(guided(s, msg("point", null, "", "Sam"), 3), s, "someone else's clear leaves it");
assert.equal(guided(s, msg("point", null, ""), 4).point, null);
s = guided(guided(s, msg("caption", null, "Hello"), 5), msg("caption", null, "Hello"), 6);
assert.equal(s.caption.n, 6);

// A part not on screen: what reveals it and where it is, by rule; no rule, no arrow.
const T = (id, title, parent_id = null) => ({ id, title, parent_id, status: "open", last_point: "", touched_ms: 0, tags: [], picture: null, dropped_by: "" });
const said = (id, thread_id, placed = true) => ({ id, speaker: "you", text: id, point: id, thread_id, placed, unclear: "", complete: true, at_ms: 0, place_ms: null });
const map = { threads: [T("T1", "Rent"), T("T2", "Garden"), T("T3", "Seedlings", "T2"), T("T4", "Old")], thoughts: [said("a", "T3"), said("p", "T1", false)], merged: { T4: "T1" } };
const at = (over = {}) => ({ map, view: "map", query: "", focus: false, shown: (n) => ["thread:T1", "thread:T2"].includes(n), folded: (id) => id === "T2", ...over });
assert.deepEqual(instead("thread:T3", at()), { via: "thread:T2", line: "“Seedlings” is folded inside “Garden”: Show opens it." });
assert.deepEqual(instead("thread:T3", at({ query: "rent" })), { via: "search", line: "“Seedlings” is hidden by your search: clear it to see it." });
assert.deepEqual(instead("thread:T3", at({ focus: true })), { via: "focus", line: "“Seedlings” is hidden by Focus: turn Focus off to see it." });
assert.deepEqual(instead("thread:T1", at({ view: "palace", shown: () => false })), { via: "view:map", line: "“Rent” is on the Map: switch to the Map here." });
assert.deepEqual(instead("thread:T4", at()), { via: "thread:T1", line: "It's part of “Rent” now." });
assert.deepEqual(instead("thread:T9", at()), { via: null, line: "That thread isn't on this map." });
assert.deepEqual(instead("point:a", at()), { via: "thread:T2", line: "It's in “Seedlings”, folded inside “Garden”: Show opens it." });
assert.deepEqual(instead("point:a", at({ shown: (n) => n === "thread:T3", folded: () => true })), { via: "thread:T3", line: "It's in “Seedlings”: Show opens it." });
assert.deepEqual(instead("point:a", at({ view: "palace", shown: (n) => n === "thread:T3", folded: () => false })), { via: "thread:T3", line: "It's in “Seedlings”: open it here." });
assert.deepEqual(instead("point:p", at()), { via: "pending", line: "It's still finding its place." });
assert.deepEqual(instead("catalog", at()), { via: "apps", line: "The Catalog button is in Apps: open Apps." });
assert.deepEqual(instead("search", at({ view: "palace" })), { via: "view:map", line: "Search is on the Map: switch to it here." });
assert.deepEqual(instead("undo", at()), { via: null, line: "Undo shows on a notice you can take back, and none is up now." });
assert.deepEqual(instead("nope", at()), { via: null, line: "Nothing called “nope” is on this screen." });
assert.equal(label("point:a", map), "a thought in “Seedlings”");
assert.equal(label("thread:T4", map), "“Rent”");

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
const world = { threads, thoughts, active: "T1", active_by: { you: "T1" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [] };
const core = await standInCore(() => [{ type: "snapshot", world }]);
const guide = (kind, target, text, by = "Claude") => core.send({ type: "guide", kind, target, text, by, at_ms: Date.now() });
// Never stuck: past 3 minutes (it takes about one), it fails naming the step it was on.
let doing = "opening the page";
const step = (name) => { doing = name; };
setTimeout(() => { console.error(`guide-check: stuck at “${doing}” after 3 minutes`); core.close(); process.exit(1); }, 180_000).unref();

let page = null;
let failed = null;
try {
  page = await openPage(`http://127.0.0.1:${core.port}/`);
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
    const bottom = floating ? innerHeight : Math.min(innerHeight, edge(".dock", "top") ?? Infinity);
    return { left: r.left, right: r.right, top: Math.max(r.top, top), bottom: Math.min(r.bottom, bottom), whole: r.top >= top && r.bottom <= bottom };
  })()`);
  const tip = () => evaluate(`(() => {
    const m = document.querySelector(".guide-arrow > g")?.getAttribute("transform")?.match(/translate\\(([-\\d.]+) ([-\\d.]+)\\) rotate\\((-?\\d+)\\)/);
    return m && { x: +m[1], y: +m[2], turn: +m[3] };
  })()`);
  const layer = () => evaluate(`document.querySelector(".guide-layer")?.dataset.state ?? null`);
  const words = () => evaluate(`document.querySelector(".guide-tip")?.innerText.replace(/\\s+/g, " ") ?? null`);
  const box = (selector) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r && { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })()`);
  const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const inside = (a, w, h, gutter = GUTTER) => a.left >= gutter - 0.5 && a.top >= gutter - 0.5 && a.right <= w - gutter + 0.5 && a.bottom <= h - gutter + 0.5;
  /** The arrowhead touches the part's facing edge (TIP_GAP out), within its span. */
  const lands = async (name, why) => {
    const [part, t] = [await seen(name), await tip()];
    assert.ok(part && t, `${why}: an arrow and its part (${JSON.stringify({ part, t })})`);
    const near = (a, b) => Math.abs(a - b) <= 1.5;
    const ok = t.turn === 90 ? near(t.y, part.top - TIP_GAP) && t.x >= part.left && t.x <= part.right
      : t.turn === -90 ? near(t.y, part.bottom + TIP_GAP) && t.x >= part.left && t.x <= part.right
      : t.turn === 0 ? near(t.x, part.left - TIP_GAP) && t.y >= part.top && t.y <= part.bottom
      : near(t.x, part.right + TIP_GAP) && t.y >= part.top && t.y <= part.bottom;
    assert.ok(ok, `${why}: the arrow lands on ${name} (tip ${JSON.stringify(t)}, part ${JSON.stringify(part)})`);
    return { part, t };
  };
  const click = async (selector) => {
    const r = await box(selector);
    assert.ok(r, `${selector} to click`);
    const [x, y] = [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
    for (const type of ["mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  };
  const key = async (name, code) => {
    for (const type of ["keyDown", "keyUp"]) await cdp("Input.dispatchKeyEvent", { type, key: name, code: name, windowsVirtualKeyCode: code });
  };
  // Every caption's life, from the page: when it showed and when it went.
  await evaluate(`window.__captions = []; new MutationObserver(() => {
    const el = document.querySelector(".guide-caption"), last = window.__captions.at(-1);
    if (el && (!last || last.el !== el)) { if (last && !last.gone) last.gone = performance.now(); window.__captions.push({ el, text: el.innerText, at: performance.now(), gone: 0 }); }
    if (!el && last && !last.gone) last.gone = performance.now();
  }).observe(document.body, { childList: true })`);

  step("a caption");
  // A caption: bottom-left, who said it, off the composer; its life is measured while the points below run.
  const line = "Do you see the arrow? That's where you type.";
  guide("caption", null, line);
  assert.ok(await until(`!!document.querySelector(".guide-caption")`, 2000), "a caption shows");
  await sleep(250);
  const cap = await box(".guide-caption"), composer = await box('[data-guide="composer"]');
  assert.match(await evaluate(`document.querySelector(".guide-caption").innerText`), /^Claude\s+Do you see the arrow\?/);
  assert.ok(Math.abs(cap.left - GUTTER) <= 0.5 && !overlap(cap, composer) && inside(cap, 1440, 900), `bottom-left, off the composer (${JSON.stringify({ cap, composer })})`);
  // A pixel as drawn, from a 1 × 1 screenshot: hit tests can't say what's on top (the arrow's layer takes no pointer,
  // and an open sheet makes the page around it unclickable, a caption over it too).
  const pixel = async (x, y) => {
    // The clip is in the page's coordinates: the viewport's point plus how far it's scrolled.
    const [left, top] = await evaluate(`[scrollX, scrollY]`);
    const { data } = await cdp("Page.captureScreenshot", { format: "png", clip: { x: x + left, y: y + top, width: 1, height: 1, scale: 1 } });
    const png = Buffer.from(data, "base64"), idat = [];
    for (let at = 8; at < png.length;) {
      const n = png.readUInt32BE(at), type = png.toString("ascii", at + 4, at + 8);
      if (type === "IDAT") idat.push(png.subarray(at + 8, at + 8 + n));
      at += 12 + n;
    }
    // One pixel: every filter leaves it as it is (no neighbors), after the row's filter byte.
    const [, r, g, b] = inflateSync(Buffer.concat(idat));
    return [r, g, b];
  };
  /** The card's own white in its right padding, mid-height, or the pixel found there: nothing is drawn over it. */
  const onTop = async (selector) => {
    const r = await box(selector);
    const rgb = await pixel(Math.floor(r.right - 6), Math.floor((r.top + r.bottom) / 2));
    return Math.min(...rgb) >= 250 || `${rgb} at ${Math.floor(r.right - 6)},${Math.floor((r.top + r.bottom) / 2)} in ${JSON.stringify(r)}`;
  };

  step("a point at the composer");
  // The composer: the arrow comes down onto it with its caption, a ring around it; in the top layer.
  guide("point", "composer", "Type your answer here.");
  assert.ok(await until(`document.querySelector(".guide-layer")?.dataset.state === "aimed"`, 2000), "a point lands");
  await sleep(300);
  const { part } = await lands("composer", "the composer");
  assert.equal((await tip()).turn, 90, "from above");
  assert.equal(await words(), "Claude Type your answer here.");
  assert.ok(await evaluate(`document.querySelector(".guide-layer").matches(":popover-open")`), "in the top layer");
  const hole = await box(".guide-hole");
  assert.ok(Math.abs(hole.left - (part.left - HOLE_PAD)) <= 1 && Math.abs(hole.bottom - (part.bottom + HOLE_PAD)) <= 1, `the spotlight rings it (${JSON.stringify(hole)})`);
  assert.ok(inside(await box(".guide-tip"), 1440, 900), "its caption is whole on screen");
  await shot("1-point-composer");
  // The corner caption stays over the point's shade: what's said is never dimmed.
  assert.equal(await onTop(".guide-caption"), true, "the corner caption is over a later point's spotlight, not shaded by it");
  assert.equal(await evaluate(`getComputedStyle(document.querySelector(".guide-caption")).opacity`), "1");

  step("Esc");
  // Esc takes it down.
  await key("Escape", 27);
  assert.ok(await until(`!document.querySelector(".guide-layer")`, 1000), "Esc takes the point down");

  step("a far thread");
  // A thread far down the map: scrolled into view between the header and the dock, the arrow on it.
  const far = "thread:T25";
  assert.equal((await seen(far)).whole, false, "the far thread starts out of view");
  guide("point", far, "Your concert tickets are here.");
  assert.ok(await until(`(() => { const r = document.querySelector('[data-guide="${far}"]').getBoundingClientRect(); return r.top > 100 && r.bottom < innerHeight - 120; })()`, 3000), "scrolled into view");
  await sleep(900);
  assert.ok((await seen(far)).whole, "whole between the header and the dock");
  await lands(far, "a far thread");
  await shot("2-point-thread");
  step("following");
  // It follows the part: the page scrolls (up: the far card is at the page's end), then the window narrows and the
  // cards reflow.
  const before = (await tip()).y;
  await evaluate(`scrollBy({ top: -60, behavior: "instant" })`);
  await sleep(120);
  assert.ok(Math.abs((await tip()).y - (before + 60)) <= 1.5, `the arrow moves with the page (${before} → ${(await tip()).y})`);
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(1200);
  await lands(far, "after the cards reflow");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(800);

  step("a click elsewhere");
  // A click elsewhere takes it down.
  await click(".brand");
  assert.ok(await until(`!document.querySelector(".guide-layer")`, 1000), "a click elsewhere takes the point down");

  step("a folded thought");
  // A thought in a folded card: the arrow on its card, saying Show opens it; Show is the way, so the point stays and
  // moves on to the thought itself.
  guide("point", "point:seed", "This is the seedling idea.");
  assert.ok(await until(`document.querySelector(".guide-layer")?.dataset.state === "aimed"`, 2000));
  await sleep(700);
  await lands("thread:T2b", "the card a folded thought is in");
  assert.equal(await words(), "Claude This is the seedling idea. It's in “Tomato Seedlings”: Show opens it.");
  await shot("3-point-folded");
  await click('[data-guide="thread:T2b"] .thread-toggle');
  assert.ok(await until(`!!document.querySelector('[data-guide="point:seed"]') && document.querySelector(".guide-tip")?.innerText.indexOf("Show opens it") < 0`, 2000), "Show leads the arrow on");
  await sleep(700);
  await lands("point:seed", "the thought, once its card opens");
  assert.equal(await words(), "Claude This is the seedling idea.");
  await shot("4-point-opened");

  step("the Palace");
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
  assert.equal(await words(), "Claude Search finds the words you used. Search is on the Map: switch to it here.");
  await shot("5-point-other-view");
  await click('[data-guide="view:map"]');
  assert.ok(await until(`document.querySelector(".guide-tip")?.innerText.indexOf("switch") < 0`, 2000), "the Map button leads the arrow on");
  await sleep(600);
  await lands("search", "search, once on the Map");

  step("the Catalog in Apps");
  // The Catalog button is in Apps: the arrow on Apps (above the map's tools: on screen, not scrolled under them), and
  // opening Apps leads it on to the button.
  await key("Escape", 27);
  await evaluate(`scrollTo({ top: 0, behavior: "instant" })`);
  if (await evaluate(`document.querySelector(".apps-title").getAttribute("aria-expanded") === "true"`)) await click(".apps-title");
  assert.ok(await until(`!document.querySelector('[data-guide="catalog"]')`, 1000), "Apps closed");
  guide("point", "catalog", "More views live in the Catalog.");
  assert.ok(await until(`document.querySelector(".guide-layer")?.dataset.state === "aimed"`, 2000), "the arrow is on Apps, seen");
  await sleep(600);
  await lands("apps", "the Apps panel the Catalog is in");
  assert.equal(await words(), "Claude More views live in the Catalog. The Catalog button is in Apps: open Apps.");
  await click(".apps-title");
  assert.ok(await until(`!!document.querySelector('[data-guide="catalog"]') && document.querySelector(".guide-tip")?.innerText.indexOf("open Apps") < 0`, 2000), "opening Apps leads the arrow on");
  await sleep(800);
  await lands("catalog", "the Catalog button");
  await key("Escape", 27);

  step("a part that's nowhere");
  // A part that's nowhere: no arrow, said where; someone else's clear leaves it, the sender's takes it down.
  guide("point", "nope", "Look at this.");
  assert.ok(await until(`document.querySelector(".guide-layer")?.dataset.state === "alone"`, 2000), "no arrow for a name not on screen");
  assert.equal(await words(), "Claude Look at this. Nothing called “nope” is on this screen.");
  assert.ok(inside(await box(".guide-tip"), 1440, 900), "said whole on screen");
  await sleep(300);
  await shot("6-point-nowhere");
  guide("point", null, "", "Sam");
  await sleep(300);
  assert.equal(await layer(), "alone", "someone else's clear leaves it");
  guide("point", null, "");
  assert.ok(await until(`!document.querySelector(".guide-layer")`, 1000), "the sender's clear takes it down");

  step("the caption's time");
  // The first caption went once read: its time, and gone within the fade.
  const first = await evaluate(`window.__captions.map((c) => ({ text: c.text, ms: c.gone - c.at }))[0]`);
  assert.ok(first.ms >= captionMs(line) - 50 && first.ms <= captionMs(line) + 900, `the caption was up ${Math.round(first.ms)} ms, its time ${captionMs(line)}`);

  step("over an open sheet");
  // Over an open sheet: Recap open, a caption shows over it, on top.
  await click('[data-guide="recap"]');
  assert.ok(await until(`!!document.querySelector("dialog.recap-sheet[open]")`, 2000), "Recap opens");
  guide("caption", null, "I'll wait while you read your recap.");
  assert.ok(await until(`document.querySelector(".guide-caption")?.innerText.includes("I'll wait")`, 2000));
  await sleep(250);
  assert.equal(await onTop(".guide-caption"), true, "the caption is over the open sheet, not under its shade");
  await shot("7-caption-over-sheet");
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
  assert.ok(await evaluate(`!!document.querySelector(".guide-caption") && !document.querySelector(".guide-caption.leaving")`), "held while the pointer is on it");
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 720, y: 300 });
  assert.ok(await until(`!document.querySelector(".guide-caption")`, 1500 + 1500), "off it, it goes");

  step("a hidden page");
  // Nor does its time run while the page is hidden (you're in another window): it's there when you come back.
  const hide = (hidden) => evaluate(`Object.defineProperty(document, "hidden", { configurable: true, get: () => ${hidden} }), document.dispatchEvent(new Event("visibilitychange"))`);
  guide("caption", null, "Said while you were in another window.");
  assert.ok(await until(`document.querySelector(".guide-caption")?.innerText.includes("another window")`, 2000));
  await hide(true);
  await sleep(captionMs("Said while you were in another window.") + 700);
  assert.ok(await evaluate(`!!document.querySelector(".guide-caption") && !document.querySelector(".guide-caption.leaving")`), "kept while the page is hidden");
  await hide(false);
  await sleep(1000);
  assert.ok(await evaluate(`!!document.querySelector(".guide-caption")`), "back on the page, its time starts then");
  assert.ok(await until(`!document.querySelector(".guide-caption")`, captionMs("Said while you were in another window.") + 1000), "then it goes");
  await evaluate(`delete document.hidden`);

  step("Reduce Motion");
  // Reduce Motion: the far thread comes into view at once, and the arrow doesn't move in.
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }, { name: "prefers-color-scheme", value: "light" }] });
  await evaluate(`scrollTo({ top: 0, behavior: "instant" })`);
  await sleep(300);
  guide("point", far, "At once.");
  await sleep(150);
  assert.ok((await seen(far)).whole, "in view at once, no smooth scroll");
  assert.equal(await evaluate(`getComputedStyle(document.querySelector(".guide-arrow-move")).animationName`), "none", "no arrow motion");
  await lands(far, "under Reduce Motion");
  await key("Escape", 27);

  step("dark");
  // Dark: the same point, for the eye (no assertion past landing).
  if (shots) {
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }, { name: "prefers-color-scheme", value: "dark" }] });
    guide("point", "thread:T1", "Rent is the one you're on.");
    guide("caption", null, "This is your map in the dark.");
    await sleep(900);
    await shot("8-dark");
    await key("Escape", 27);
  }
  await page.close();
  page = null;

  step("a phone");
  // A phone: the arrow onto the mic, its caption whole on screen; the corner caption over the dock, off the composer.
  page = await openPage(`http://127.0.0.1:${core.port}/`, { width: 390, height: 844 });
  ({ evaluate, until } = page);
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await toured();
  assert.ok(await until(`!!document.querySelector('[data-guide="thread:T1"]')`, 8000));
  await sleep(600);
  guide("point", "mic", "Tap here to talk.");
  guide("caption", null, "On a phone, the mic is at the bottom right.");
  assert.ok(await until(`document.querySelector(".guide-layer")?.dataset.state === "aimed" && !!document.querySelector(".guide-caption")`, 2000));
  await sleep(500);
  await lands("mic", "the mic on a phone");
  assert.ok(inside(await box(".guide-tip"), 390, 844), "the point's caption is whole on a phone");
  const phoneCap = await box(".guide-caption"), phoneComposer = await box('[data-guide="composer"]');
  assert.ok(inside(phoneCap, 390, 844) && !overlap(phoneCap, phoneComposer), `the corner caption is whole and off the composer (${JSON.stringify({ phoneCap, phoneComposer })})`);
  const phoneTip = await box(".guide-tip"), phoneArrow = await box(".guide-arrow > g");
  assert.ok(!overlap(phoneCap, phoneTip) && !overlap(phoneCap, phoneArrow), `the corner caption is clear of the point (${JSON.stringify({ phoneCap, phoneTip, phoneArrow })})`);
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, "no sideways scroll");
  await shot("9-phone");
} catch (error) {
  failed = error;
} finally {
  await page?.close();
  core.close();
}
if (failed) { console.error(failed.stack ?? failed.message); process.exit(1); }
console.log("guide-check: the names, the rules, and on the page: an arrow on the named part, followed, taken down, led on to a hidden part, said when nowhere; a caption off the composer, over a sheet, gone once read, held by the pointer; a phone; Reduce Motion");
