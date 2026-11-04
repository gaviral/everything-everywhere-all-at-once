// Overview (key 3) and Fit map (0) show every thread of the map, its tangents (side trips) too: each as its own small
// picture and name beside the topic it hangs from, its curve tying it to the point it came from. They used to drop out
// there (4 of the student week sample's 8 threads were left). The map is that sample as its journal replays it, with its
// pictures, plus three threads it lacks: a tangent of a tangent, one with a long name and no picture (its first letter
// shows), and a tangent off a topic that had none. Held, at laptop and phone sizes, light and dark (the shell, and once
// the classic page, ?shell=1):
//  - Overview, and Fit map while Overview is the stop: every thread has its picture or letter, on screen; each tangent's
//    curve starts on its parent (a topic's point or picture, a tangent's picture or name) and ends at its picture; from
//    the zoom where a name fits beside its card, the name too, whole at 13 px; on a laptop, no name or picture under a
//    control or on another's; a pointer on a tangent's picture or name reaches its button, and a click opens it (the
//    camera reads it at size) and its title folds it again.
//  - Topics and Read look as they did: tangents are cards of bars in Topics, and no tangent picture stands in either.
// Exits 3 without Chrome or ui/dist. SHOTS=<folder> saves a screenshot of each stop.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP spine-all-threads-check: ${why}`); process.exit(3); }
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

// ---- The map: the student week sample, replayed from its journal (what the window's reducer makes of the events the
// Spine reads), its pictures as data (the check's core serves only the page), and what it lacks.
const sample = (path) => new URL(`../samples/${path}`, import.meta.url);
const world = { threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], topics: {} };
const thread = (id) => world.threads.find((t) => t.id === id);
for (const line of readFileSync(sample("student-week.jsonl"), "utf8").split("\n")) {
  if (!line.trim()) continue;
  const event = JSON.parse(line);
  if (event.type === "thread_added") world.threads.push(event.thread);
  else if (event.type === "thought_added") world.thoughts.push(event.thought);
  else if (event.type === "thread_picture") thread(event.thread_id).picture = `data:image/webp;base64,${readFileSync(sample(`images/student-week/${event.path.split("/").at(-1)}`)).toString("base64")}`;
  else if (event.type === "thread_status") thread(event.thread_id).status = event.status;
  else if (event.type === "topics_assigned") for (const a of event.assigned) world.topics[a.thread_id] = a.topic;
  else if (event.type === "active_changed") { world.active = event.thread_id; world.active_by = { you: event.thread_id }; }
}
{
  const last = Math.max(...world.thoughts.map((t) => t.at_ms));
  const add = (id, title, parent_id) => world.threads.push({ id, title, parent_id, status: "open", last_point: "", touched_ms: last, tags: [], picture: null, dropped_by: "" });
  const say = (id, text, thread_id, n) => world.thoughts.push({ id, speaker: "you", text, point: text, thread_id, placed: true, unclear: "", guess: "", heard: "", fixed: "", complete: true,
    at_ms: last + n * 1000, place_ms: 2000, decided: false });
  add("T9", "Pottery class on Main Street, Saturday morning, ask about the seats", "T5");
  add("T10", "Book two seats", "T9");
  add("T11", "Group project: slides", "T3");
  say("x1", "Ask if the Saturday class has two seats left", "T9", 1);
  say("x2", "Bring cash for the deposit", "T9", 2);
  say("x3", "Two seats, one for Mom and one for me", "T10", 3);
  say("x4", "Pay online if the site allows it", "T10", 4);
  say("x5", "Slides for Thursday's meeting", "T11", 5);
  say("x6", "Ask Priya for her chart", "T11", 6);
  say("x7", "Send the deck to the group the night before", "T11", 7);
}
const ids = world.threads.map((t) => t.id);
const pictured = Object.fromEntries(world.threads.map((t) => [t.id, !!t.picture]));
const root = (t) => (t.parent_id ? root(thread(t.parent_id)) : t);
const tangents = world.threads.filter((t) => t.parent_id);
assert.ok(tangents.length >= 7 && world.threads.length === 11, "the map: the sample's eight threads and three more");

// ---- What the page says (run in the page).
/** Every thread's picture and name as the page shows it now, the controls over the map, and where each branch curve ends. */
function scan(ids) {
  const box = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
  const shown = (e) => !!e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const zoom = Number(document.querySelector(".react-flow__viewport").style.transform.match(/scale\(([\d.]+)\)/)[1]);
  const rows = ids.map((id) => {
    const node = document.querySelector(`.react-flow__node[data-id="t:${id}"]`);
    const tile = node?.querySelector(".spine-tile"), label = node?.querySelector(".spine-label"), face = node?.querySelector(".spine-card-face, .spine-title");
    const picture = tile?.querySelector(".spine-picture");
    const at = (b) => { const hit = b && document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2); return !!hit && !!face && face.contains(hit); };
    const tileBox = shown(tile) ? box(tile) : null, labelBox = shown(label) ? box(label) : null;
    return { id, kind: node?.querySelector(".spine-card") ? "card" : node?.querySelector(".spine-head") ? "head" : null, tile: tileBox, label: labelBox, name: label?.textContent ?? null,
      cut: label ? label.scrollHeight > label.clientHeight + 1 : null, font: label ? parseFloat(getComputedStyle(label).fontSize) * zoom : null,
      image: !!picture && picture.classList.contains("spine-picture-shown") && picture.complete && picture.naturalWidth > 0, letter: tile?.querySelector(".spine-letter")?.textContent ?? null,
      tileHit: at(tileBox), labelHit: at(labelBox), named: face?.getAttribute("aria-label") ?? null };
  });
  const onScreen = (path, length) => { const p = path.getPointAtLength(length), at = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()); return { x: at.x, y: at.y }; };
  const curves = [...document.querySelectorAll(".spine-link-branch")].filter(shown).map((path) => ({ start: onScreen(path, 0), end: onScreen(path, path.getTotalLength()) }));
  const dots = {};
  for (const point of document.querySelectorAll(".spine-point")) {
    const dot = point.querySelector(".spine-dot, .spine-who");
    if (dot) { const b = box(dot); (dots[point.dataset.thread] ??= []).push({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 }); }
  }
  const over = [...document.querySelectorAll(".shell-corner, .spine-corner, .shell-stage, .shell-status, .dock, header")].filter((e) => shown(e)).map(box)
    .filter((b) => b.right - b.left > 1 && b.bottom - b.top > 1);
  return { zoom, width: innerWidth, height: innerHeight, rows, curves, dots, over,
    bars: [...document.querySelectorAll(".spine-card .spine-bars")].filter(shown).length, pics: [...document.querySelectorAll(".spine-card-pic")].filter(shown).length,
    titles: [...document.querySelectorAll(".spine-card-title")].filter(shown).length };
}

const separate = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
const inside = (a, w, h) => a.left >= -0.5 && a.top >= -0.5 && a.right <= w + 0.5 && a.bottom <= h + 0.5;
const centre = (b) => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });

// Never stuck: a step that runs past STEP_LIMIT_MS fails the run, naming it (the page's own waits are bounded; a call
// Chrome never answers is not).
const STEP_LIMIT_MS = 60_000;
let doing = "starting", stuck = null;
const step = (name) => {
  doing = name;
  clearTimeout(stuck);
  stuck = setTimeout(() => { console.error(`spine-all-threads-check: stuck at “${doing}” for ${STEP_LIMIT_MS / 1000} seconds`); process.exit(1); }, STEP_LIMIT_MS).unref();
};

const core = await standInCore(() => [{ type: "snapshot", world }]);
const KEYS = { 1: 49, 2: 50, 3: 51, 0: 48 };
let failed = null;
try {
  const runs = [["?shell=2", 1440, 900, "light"], ["?shell=2", 1440, 900, "dark"], ["?shell=2", 390, 844, "light"], ["?shell=2", 390, 844, "dark"], ["?shell=1", 1440, 900, "light"]];
  for (const [query, width, height, scheme] of runs) {
    const label = `${query || "/"} ${width}x${height} ${scheme}`;
    step(`${label}: opening`);
    const scene = await openPage("about:blank", { width, height });
    try {
      const { page, evaluate, until } = scene;
      const phone = width < 600;
      // Without Page.enable, Chrome accepts the script below and never runs it.
      await page("Page.enable");
      await page("Page.addScriptToEvaluateOnNewDocument", { source: `
        localStorage.setItem("e2a2o.toured", "1");
        window.checkErrors = [];
        // Chrome reports a size observer whose change lands a frame later as a window error: not one.
        addEventListener("error", (e) => { if (!/^ResizeObserver loop/.test(e.message)) window.checkErrors.push(e.message); });
        addEventListener("unhandledrejection", (e) => window.checkErrors.push(String(e.reason)));
      ` });
      await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: phone });
      await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "no-preference" }] });
      await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/${query}` });
      assert.ok(await until(`!!document.querySelector(".spine-frame.spine-ready") && !document.querySelector(".tour-tip")`, 10000), `${label}: the Canvas opens`);
      assert.ok(await until(`document.fonts.status === "loaded"`, 8000), `${label}: fonts loaded`);
      assert.deepEqual(await evaluate(`[innerWidth, innerHeight, matchMedia("(prefers-color-scheme: dark)").matches]`), [width, height, scheme === "dark"], `${label}: the window`);

      /** The camera has stopped: its transform unchanged for three reads, nothing animating. */
      const settle = async (what) => {
        let last = null, same = 0;
        for (let waited = 0; waited < 6000 && same < 3; waited += 100) {
          const now = await evaluate(`document.querySelector(".react-flow__viewport").style.transform + document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getTiming().iterations !== Infinity).length`);
          same = now === last ? same + 1 : 0;
          last = now;
          await sleep(100);
        }
        assert.ok(same >= 3, `${label}: ${what}: the camera settles`);
      };
      const click = async (selector) => {
        const found = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect();
          const x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
          return { x, y, ok: e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && e.contains(hit), hit: hit && hit.tagName + "." + [...hit.classList].join(".") }; })()`);
        assert.ok(found?.ok, `${label}: a pointer reaches ${selector} (${JSON.stringify(found)})`);
        const at = { x: found.x, y: found.y };
        await page("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
        for (const type of ["mousePressed", "mouseReleased"]) await page("Input.dispatchMouseEvent", { type, ...at, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
      };
      // A click on empty canvas first, so the number keys reach the page and not the composer.
      const emptyCanvas = async () => {
        const at = await evaluate(`(() => { const f = document.querySelector(".spine-frame").getBoundingClientRect();
          for (let y = f.top + 80; y < f.bottom - 180; y += 16) for (let x = f.right - 20; x > f.left + 20; x -= 16) if (document.elementFromPoint(x, y)?.classList.contains("react-flow__pane")) return { x, y }; return null; })()`);
        assert.ok(at, `${label}: empty canvas to click`);
        for (const type of ["mousePressed", "mouseReleased"]) await page("Input.dispatchMouseEvent", { type, ...at, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
      };
      const key = async (digit) => { for (const type of ["keyDown", "keyUp"]) await page("Input.dispatchKeyEvent", { type, key: String(digit), code: `Digit${digit}`, windowsVirtualKeyCode: KEYS[digit] }); };
      /** A zoom stop: the desktop's buttons by pointer; a phone has none, so its number keys. */
      const stop = async (name) => {
        const digit = { Read: 1, Topics: 2, Overview: 3, "Fit map": 0 }[name];
        if (!phone) await click(name === "Fit map" ? `[data-camera-fit]` : `[data-zoom-stop="${({Read:"words",Topics:"titles",Overview:"pictures"})[name]}"]`);
        else { await emptyCanvas(); await key(digit); }
        await settle(name);
      };
      const shot = async (name) => {
        if (!shots) return;
        const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        const png = Buffer.from(data, "base64");
        assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [width, height], `${label}: the screenshot's size`);
        writeFileSync(join(shots, `${name}-${query === "?shell=1" ? "plain" : "shell"}-${width}x${height}-${scheme}.png`), png);
      };

      /** Overview (or Fit map while Overview is the stop): every thread there, and where it should be. */
      const pictures = async (what) => {
        step(`${label}: ${what}`);
        // A tangent's picture mounts only far out: wait for every picture to have decoded, not for a pause.
        const pictured_ = JSON.stringify(pictured);
        assert.ok(await until(`(${scan})(${JSON.stringify(ids)}).rows.every((r) => r.tile && (${pictured_}[r.id] ? r.image : !!r.letter))`, 8000),
          `${label}: ${what}: every thread has its picture or letter`);
        const seen = await evaluate(`(${scan})(${JSON.stringify(ids)})`);
        const where = `${label}: ${what}`;
        assert.ok(seen.zoom < 0.75, `${where}: zoomed out (${seen.zoom})`);
        for (const row of seen.rows) {
          const t = thread(row.id), detail = `${where}: ${t.title} (${t.parent_id ? "a tangent" : "a topic"}) ${JSON.stringify(row)}`;
          assert.equal(row.kind, t.parent_id ? "card" : "head", detail);
          assert.ok(row.tile && row.tile.right - row.tile.left >= 6, `every topic keeps its picture landmark: ${detail}`);
          if (!phone || what.includes("Fit map")) assert.ok(inside(row.tile, seen.width, seen.height), `Fit map keeps every landmark on screen: ${detail}`);
          else assert.ok(seen.zoom >= 0.38 && seen.rows.some(r => r.tile && inside(r.tile, seen.width, seen.height)), `phone Overview keeps readable landmarks and permits panning: ${detail}`);
          if (t.picture) assert.ok(row.image, `its picture shows: ${detail}`); else assert.equal(row.letter, t.title[0].toUpperCase(), `its first letter stands in: ${detail}`);
          assert.ok(row.named?.startsWith(t.title), `its button names it: ${detail}`);
          // A tangent's name from the zoom where it fits beside its card (nodes.tsx NAMED); a topic's always.
          if (!t.parent_id || seen.zoom >= 0.35) {
            assert.ok(row.label && row.name === t.title, `its name shows, whole text: ${detail}`);
            assert.ok(Math.abs(row.font - 13) < 0.5, `at 13 px: ${detail}`);
            if (!phone) {
              assert.ok(inside(row.label, seen.width, seen.height), `its name is on screen: ${detail}`);
              if (t.title.length <= 24) assert.equal(row.cut, false, `a short name isn't cut: ${detail}`);
            }
          } else assert.equal(row.label, null, `too far out for a name: ${detail}`);
          if (!phone && t.parent_id) assert.ok(row.tileHit && (!row.label || row.labelHit), `a pointer on its picture and name reaches its button: ${detail}`);
        }
        // Beside its parent: its curve ends at its picture and starts on the parent: a topic's point (the dot it came from) or
        // its picture; for a tangent of a tangent, the parent tangent's own picture or name.
        const within = (at, b, slack = 3) => !!b && at.x >= b.left - slack && at.x <= b.right + slack && at.y >= b.top - slack && at.y <= b.bottom + slack;
        for (const row of seen.rows.filter((r) => thread(r.id).parent_id)) {
          const t = thread(row.id), parent = thread(t.parent_id), up = seen.rows.find((r) => r.id === parent.id);
          const curve = seen.curves.find((c) => within(c.end, row.tile));
          assert.ok(curve, `${where}: a curve ends at ${t.title}'s picture (${JSON.stringify(seen.curves)})`);
          const onParent = parent.parent_id ? within(curve.start, up.tile) || within(curve.start, up.label)
            : within(curve.start, up.tile) || (seen.dots[parent.id] ?? []).some((d) => Math.hypot(d.x - curve.start.x, d.y - curve.start.y) <= 3);
          assert.ok(onParent, `${where}: ${t.title}'s curve starts on ${parent.title} (${JSON.stringify([curve.start, up.tile, up.label, seen.dots[parent.id]])})`);
        }
        assert.equal(seen.curves.length, tangents.length, `${where}: one curve for each tangent`);
        // A phone's whole map is at zoom 0.12, where topic pictures overlap one another already; the rest is for a laptop.
        if (!phone) {
          const parts = seen.rows.flatMap((r) => [["picture", r.tile], ["name", r.label]].filter(([, b]) => b).map(([what, b]) => ({ id: r.id, what, b })));
          for (const part of parts) {
            for (const o of seen.over) assert.ok(separate(part.b, o), `${where}: ${thread(part.id).title}'s ${part.what} is under a control ${JSON.stringify([part.b, o])}`);
            for (const other of parts) if (other.id !== part.id) assert.ok(separate(part.b, other.b), `${where}: ${thread(part.id).title}'s ${part.what} meets ${thread(other.id).title}'s ${other.what} ${JSON.stringify([part.b, other.b])}`);
          }
        }
        assert.deepEqual(await evaluate(`window.checkErrors`), [], `${where}: no errors in the page`);
        assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), `${where}: no sideways scroll`);
      };

      // The page fades in and the camera takes its first view: nothing is pressed until both have stopped.
      await settle("the Canvas opening");
      // Overview, then Fit map (the stop stays Overview), then the other stops.
      await stop("Overview");
      await pictures("Overview");
      await shot("pictures");
      await stop("Fit map");
      await pictures("Fit map after Overview");
      await shot("see-all");

      step(`${label}: Topics`);
      await stop("Topics");
      const titles = await evaluate(`(${scan})(${JSON.stringify(ids)})`);
      assert.equal(titles.pics, 0, `${label}: Topics shows no tangent picture`);
      assert.ok(titles.bars >= tangents.length, `${label}: Topics shows each tangent as a card of bars (${titles.bars})`);
      for (const row of titles.rows) assert.ok(row.kind === (thread(row.id).parent_id ? "card" : "head"), `${label}: Topics has ${thread(row.id).title}`);
      for (const row of titles.rows.filter((r) => !thread(r.id).parent_id)) assert.ok(row.label && row.name === thread(row.id).title, `${label}: Topics names the topic ${row.id}`);
      await shot("titles");

      step(`${label}: Read`);
      await stop("Read");
      const words = await evaluate(`(${scan})(${JSON.stringify(ids)})`);
      assert.equal(words.pics, 0, `${label}: Read shows no tangent picture`);
      assert.ok(words.zoom >= 0.75, `${label}: Read reads at size (${words.zoom})`);
      if (!phone) assert.ok(words.titles >= 1, `${label}: a tangent's title reads in Read (${words.titles})`);

      // A tangent's picture can be clicked, as its card in Topics can: it opens and the camera reads it at size; its title folds it.
      if (!phone) {
        step(`${label}: opening a tangent from Overview`);
        await stop("Overview");
        const card = `.react-flow__node[data-id="t:T4"] .spine-card-face`;
        await click(`${card} .spine-tile`);
        assert.ok(await until(`document.querySelector(${JSON.stringify(card)}).getAttribute("aria-expanded") === "true"`, 3000), `${label}: a click on a tangent's picture opens it`);
        await settle("the camera reading the open tangent");
        const { zoom } = await evaluate(`(${scan})([])`);
        const read = await evaluate(`(() => { const f = document.querySelector(".spine-frame").getBoundingClientRect();
          const shown = [...document.querySelectorAll('.spine-point[data-thread="T4"] .spine-text')].filter((e) => { const r = e.getBoundingClientRect();
            return e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && r.left >= f.left && r.right <= f.right && r.top >= f.top && r.bottom <= f.bottom; });
          return { zoom: ${zoom}, shown: shown.length }; })()`);
        assert.ok(read.zoom >= 0.75 && read.shown >= 1, `${label}: its points read on screen (${JSON.stringify(read)})`);
        await click(`${card} .spine-card-title`);
        assert.ok(await until(`document.querySelector(${JSON.stringify(card)}).getAttribute("aria-expanded") === "false"`, 3000), `${label}: its title folds it again`);
        assert.deepEqual(await evaluate(`window.checkErrors`), [], `${label}: no errors in the page`);
      }
    } finally { await scene.close(); }
  }
} catch (error) {
  failed = error;
} finally {
  core.close();
  clearTimeout(stuck);
}
if (failed) { console.error(`spine-all-threads-check failed at “${doing}”:`, failed.stack ?? failed.message); process.exit(1); }
console.log("spine-all-threads-check: Overview and Fit map show every thread, tangents beside their topic; Topics and Read as they were");
