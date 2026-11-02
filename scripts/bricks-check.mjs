// No extra dependencies: run with `node scripts/bricks-check.mjs` (every brick) or `node scripts/bricks-check.mjs <id>`
// (one brick, as its builder does: done when this passes). The rules of docs/bricks.md, held:
// 1. Every folder in ui/src/bricks is a brick: a brick.json the app accepts (bricks-core.ts `infoProblems`, the same
//    rule), and an index.tsx whose default export is the brick.
// 2. A brick imports from the app only ../contract; otherwise React, Motion and files in its own folder. No other
//    brick, no package the app doesn't have.
// 3. Its CSS styles only its own classes: every selector names a class starting with its id, its keyframes too, and
//    every class it styles is one its code uses (as css-check holds the app's).
// 4. contract.ts runs no app code: what it takes from the app is types only.
// 5. In the built playground (headless Chrome): each brick mounts on a sample map, on an empty one and at a phone's
//    width without an error, with nothing running off the side; a view or a card shows something.
// 6. In the built app (all bricks): at their defaults they add nothing to the first screen; the Catalog lists every
//    brick; each view brick switched on joins Map and Palace, shows in the map's place and hands back to the map, and
//    stays on after a reload; `?level` still shows the Level meter, and without it there is none.
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
} finally {
  await server.close();
}

// 2. Imports. 3. CSS. Per checked brick.
const PACKAGES = ["react", "react-dom", "react/jsx-runtime", "motion/react"];
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
    out.push(`imports "${spec}": a brick takes from the app only ../contract; otherwise React, Motion and its own files`);
  }
  // The page has one header, the app's: the map measures every <header> to keep a landing clear of it (App.tsx
  // `mapTop`), and styles.css styles them all.
  if (/<header\b/.test(text)) out.push("draws a <header>: use a div (the app's header is the page's only one)");
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
  for (const planted of [`import { World } from "../../core";`, `import x from "../bubbles/index";`, `import lodash from "lodash";`, `const m = import("../../App");`, `return <header>Pin</header>;`]) {
    assert.ok(sourceProblems(dir, "index.tsx", planted).length, `the check misses: ${planted}`);
  }
  for (const fine of [`import { useState } from "react";`, `import { useBrickEvent } from "../contract";`, `import "./pin.css";`, `import { motion } from "motion/react";`]) {
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
try {
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
  // The template does what it says: it hears the thought it added land.
  await width(1280, 860);
  if (checked.includes("_template")) {
    await go(`${base}/bricks.html?brick=_template&sample=student-week`);
    await until(`!!document.querySelector(".template")`, 8000);
    await evaluate(`[...document.querySelectorAll(".playground-bar button")].find((b) => b.textContent === "Add a thought").click()`);
    if (!await until(`document.querySelector(".template")?.textContent.includes("last landed on")`, 4000)) fail("_template", "never heard the thought it added land");
  }
  if (only) { assert.deepEqual(problems, [], `\n${problems.join("\n")}\n`); console.log(`bricks-check: ok (${only}: its folder's rules and the playground)`); process.exit(0); }

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
  const views = () => evaluate(`[...document.querySelectorAll(".palace-switch button")].map((b) => b.textContent)`);
  assert.deepEqual(await views(), ["Map", "Palace"], "at their defaults, no brick joins Map and Palace");
  await evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent === "Skip tour")?.click()`);
  await evaluate(`document.querySelector(".apps-title").click()`);
  await until(`!!document.querySelector(".apps-catalog button")`, 3000);
  await evaluate(`document.querySelector(".apps-catalog button").click()`);
  if (!await until(`!!document.querySelector("dialog.catalog[open]")`, 3000)) fail("Catalog", "doesn't open from the Apps panel");
  const listed = await evaluate(`[...document.querySelectorAll(".catalog-row strong")].map((s) => s.textContent)`);
  for (const name of brickNames) if (!listed.includes(name)) fail("Catalog", `doesn't list ${name}`);
  if (listed.length !== brickNames.length) fail("Catalog", `lists ${listed.length} bricks, the folders hold ${brickNames.length}`);
  const switchFor = (name) => `[...document.querySelectorAll(".catalog-row")].find((r) => r.querySelector("strong").textContent === ${JSON.stringify(name)}).querySelector("[role=switch]")`;
  for (const { name } of viewBricks) {
    await evaluate(`${switchFor(name)}.click()`);
    if (await evaluate(`${switchFor(name)}.getAttribute("aria-checked")`) !== "true") fail("Catalog", `${name}'s switch didn't turn on`);
  }
  await evaluate(`document.querySelector(".catalog-close").click()`);
  if (!await until(`!document.querySelector("dialog.catalog")`, 2000)) fail("Catalog", "× doesn't close it");
  const switched = ["Map", "Palace", ...viewBricks.map((info) => info.name)].join();
  if ((await views()).join() !== switched) fail("Catalog", `switched on, the view switch says ${await views()}, not ${switched}`);
  // Each view shows in the map's place, with something in it, and Map brings the map back.
  for (const { id, name } of viewBricks) {
    await evaluate(`[...document.querySelectorAll(".palace-switch button")].find((b) => b.textContent === ${JSON.stringify(name)}).click()`);
    if (!await until(`!!document.querySelector('main.brick-view[data-brick="${id}"]')?.textContent.trim() && !document.querySelector("main.map")`, 4000)) fail(name, "doesn't show in the map's place");
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
} finally {
  await page.close();
  core.close();
}
assert.deepEqual(problems, [], `\n${problems.join("\n")}\n`);
console.log(`bricks-check: ok (${checked.length} bricks: ${kinds.join(", ")}; playground and app)`);
