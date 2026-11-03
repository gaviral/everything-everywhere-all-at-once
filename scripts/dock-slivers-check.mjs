// The new shell's stage (the composer and the cards over it: Finish it, a notice) over a view that scrolls, and the
// Countdown's editor over the Live outline. The morning walk (2026-11-03) found: the stage's cards stand 10 px apart and
// the words of Cards ran through that gap (a half-hidden "Add to Reminders" between the card and the composer); the
// stage covered the proposals at the foot of Cards at 900 px tall, and the end of the list couldn't clear a taller stage
// (a notice over the card); and the editor, 360 px wide, left 40 px of the 400 px Live outline showing past its edge.
// A real browser at laptop and phone sizes, light and dark, a map shaped as the demo's (a card to finish, an action, a
// suggestion, a "Did you mean"), real taps to open Cards and the Palace from the Catalog. What a person sees is read from
// the screen's own pixels: the gap's, and where the page's words end. SHOTS=dir saves each state; without it nothing is
// written.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP dock-slivers-check: ${why}`); process.exit(3); }
process.once("uncaughtException", (error) => { console.error(`dock-slivers-check: ${error.message}`); process.exit(1); });
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const now = Date.now() - 3 * 60_000;
const thread = (id, title, extra = {}) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "", ...extra });
const thought = (id, text, thread_id, extra = {}) => ({ id, speaker: "you", text, point: text, thread_id, placed: true, unclear: "", guess: "", heard: "", fixed: "",
  complete: true, at_ms: now, place_ms: 2000, decided: false, ...extra });
// Eight topics, as the demo's map has: the one you are on with three branches, a topic left off (its last words trail away:
// Finish it is offered) with a branch, and two more. Each has what the demo shows on a card.
const world = {
  threads: [
    thread("T1", "Hackathon plan", { tags: [{ name: "hackathon", kept: false }, { name: "deadline", kept: false }] }),
    thread("T1a", "Demo recording plan", { parent_id: "T1" }), thread("T1b", "README sections", { parent_id: "T1" }), thread("T1c", "Submission checklist", { parent_id: "T1" }),
    thread("T2", "Rent is due", { status: "dropped", dropped_by: "you" }), thread("T2a", "Electric bill autopay", { parent_id: "T2" }),
    thread("T3", "Group project meeting", { tags: [{ name: "school", kept: false }, { name: "group-project", kept: false }] }),
    thread("T4", "Mom's birthday", { tags: [{ name: "family", kept: false }, { name: "birthday", kept: false }] }),
  ],
  thoughts: [
    thought("a1", "Deadline tomorrow 9 PM, need to record demo", "T1"), thought("a2", "Repo ready, precheck passes, README not done", "T1"),
    thought("a3", "Write README before recording", "T1"), thought("a4", "Priority: README, record, submit; rent now; text Priya", "T1"),
    thought("b1", "Plan the shots", "T1a"), thought("b2", "Record twice", "T1a"), thought("b3", "Cut to two minutes", "T1a"), thought("b4", "Music off", "T1a"), thought("b5", "Title card last", "T1a"),
    thought("c1", "Install steps", "T1b"), thought("c2", "What it is", "T1b"), thought("c3", "Honest limits", "T1b"),
    thought("d1", "Repo public", "T1c"), thought("d2", "Video link", "T1c"), thought("d3", "Form filled", "T1c"), thought("d4", "Deadline", "T1c"),
    thought("r1", "Rent due Nov 1, forgot the transfer", "T2"),
    thought("r2", "It's already the 3rd so it's technically late, I need to do it right now before they charge a fee", "T2", { complete: false }),
    thought("e1", "Set up autopay for electric bill", "T2a"), thought("e2", "BC Hydra portal, need account number", "T2a", { unclear: "BC Hydra", guess: "BC Hydro" }),
    thought("e3", "Electric bill can wait until after hackathon", "T2a"),
    thought("g1", "Group presentation Wednesday, Priya's slides missing", "T3"), thought("g2", "Text Priya tonight, check Marcus's data section", "T3"),
    thought("g3", "Rehearse before Wednesday morning", "T3"), thought("g4", "Group presentation and hackathon deadline same week", "T3"),
    thought("g5", "Group stuff this afternoon, hackathon tonight and tomorrow AM", "T3"),
    thought("m1", "Mom's birthday Friday, no gift yet", "T4"), thought("m2", "She wants the cooking class on Main Street", "T4"),
    thought("m3", "Book online tonight if under sixty dollars", "T4"), thought("m4", "Book cooking class on phone during downtime", "T4"),
  ],
  active: "T1", active_by: { you: "T1" },
  suggestions: [
    { id: "sg-1", thread_id: "T3", text: "Could combine the rehearsal with a Zoom call so everyone can run through the slides together", status: "new" },
    { id: "sg-2", thread_id: "T4", text: "Look for class options for easier scheduling and a gift voucher at the same shop", status: "new" },
  ],
  actions: [
    { id: "ac-1", thread_id: "T2", kind: "reminder", title: "Transfer rent to landlord", when: "Today", status: "new", done_ms: null },
    { id: "ac-2", thread_id: "T3", kind: "reminder", title: "Text Priya about slides", when: "Today", status: "new", done_ms: null },
  ],
  proposals: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {},
};
// The Canvas with the Live outline and the Countdown: the topic you are on and one more, nothing left off, so the stage is
// the composer alone and the outline stands over the Countdown as it does when you talk.
const calm = { ...world, threads: world.threads.filter((t) => ["T1", "T3"].includes(t.id)), thoughts: world.thoughts.filter((t) => ["T1", "T3"].includes(t.thread_id)),
  suggestions: [], actions: [] };
let shown = world;
const core = await standInCore(() => [{ type: "snapshot", world: shown }]);

/** What the page's own color is allowed to be off by where nothing but its color should show: the two cards' soft shadows
 *  reach into the gap (at most 5 of 255 measured); words and card edges are 25 or more, and a letter 200. */
const BLANK = 12;
/** How far above the stage the page's color starts fading in (shell.css): the clearance the other views keep over it. */
const FADE = 12;

let browser = null;
let runs = 0;
const summary = [];
try {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    for (const scheme of ["light", "dark"]) {
      const label = `${width}x${height} ${scheme}`;
      shown = world;
      browser = await openPage("about:blank", { width, height });
      const { page, evaluate, until } = browser;
      // As in cards-esc-check: Page.enable is required for the storage script to run.
      await page("Page.enable");
      // `bricks`: the bricks switched on; the Countdown then holds a deadline, as it does when the editor is worth opening.
      const seed = (bricks) => `
        localStorage.clear(); sessionStorage.clear();
        localStorage.setItem("e2a2o.toured", "1");
        localStorage.setItem("e2a2o.features", JSON.stringify({ cards: true, pictures: true }));
        ${bricks ? `localStorage.setItem("e2a2o.bricks", JSON.stringify(${JSON.stringify(bricks)}));
        localStorage.setItem("e2a2o.countdown", JSON.stringify([{ label: "Rent due", at: new Date(Date.now() + 72 * 3600000).toISOString() }]));` : ""}
        window.__errors = [];
        addEventListener("error", e => {
          if (!/^ResizeObserver loop/.test(e.message)) __errors.push(e.message || "Resource failed: " + e.target?.src);
        }, true);
        addEventListener("unhandledrejection", e => __errors.push(String(e.reason)));
        const error = console.error;
        console.error = (...args) => { __errors.push(args.map(String).join(" ")); error.apply(console, args); };`;
      let seeded = (await page("Page.addScriptToEvaluateOnNewDocument", { source: seed(null) })).identifier;
      await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
      await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "no-preference" }] });
      const frames = () => evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      const shoot = async (name) => {
        if (!shots) return;
        // The pointer rests in the corner, where it hovers nothing: a point under the last tap would show its tools.
        await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
        await frames();
        const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        writeFileSync(join(shots, `dock-${name}-${width}-${scheme}.png`), Buffer.from(data, "base64"));
      };
      // A real tap: scrolled to the middle of its window, shown, whole inside it, and the thing at its centre is itself.
      const where = (selector) => evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return "not there";
        el.scrollIntoView({ block: "center", behavior: "instant" });
        if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return "not shown";
        const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (r.width <= 0 || r.height <= 0 || r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight) return "outside the window";
        const hit = document.elementFromPoint(x, y);
        return hit && el.contains(hit) ? { x, y } : "covered by " + (hit?.closest("[class]")?.getAttribute("class") ?? hit?.tagName);
      })()`);
      const tap = async (selector, what) => {
        let found = await where(selector);
        for (let waited = 0; typeof found !== "object" && waited < 4000; waited += 100) { await sleep(100); found = await where(selector); }
        assert.equal(typeof found, "object", `${label}: ${what} is on screen and takes a tap (${found})`);
        await page("Input.dispatchMouseEvent", { type: "mouseMoved", ...found });
        for (const type of ["mousePressed", "mouseReleased"]) await page("Input.dispatchMouseEvent", { type, ...found, button: "left", clickCount: 1 });
        await sleep(200);
      };
      const open = async (id, view) => {
        await tap('[data-guide="catalog"]', "Catalog");
        await tap(`[data-row="${id}"] .shell-link`, `${id}'s Show`);
        assert.ok(await until(`document.documentElement.dataset.view === "${view}" && !document.querySelector('[data-slot="rail"]')`, 5000), `${label}: Show opens ${id}`);
        await sleep(600);
      };
      /** The most the page's own pixels differ from its color along the gap between the stage's card and its composer. */
      const gap = async () => {
        const geo = await evaluate(`(() => {
          const cards = document.querySelector(".shell-cards").getBoundingClientRect(), composer = document.querySelector(".shell-composer").getBoundingClientRect(), stage = document.querySelector(".shell-stage").getBoundingClientRect();
          return { top: cards.bottom, bottom: composer.top, left: stage.left, right: stage.right, bg: getComputedStyle(document.documentElement).getPropertyValue("--space").trim() };
        })()`);
        assert.ok(geo.bottom - geo.top >= 4, `${label}: the stage's card and composer stand apart (${(geo.bottom - geo.top).toFixed(0)} px)`);
        await frames();
        const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        const strip = await evaluate(`(async () => {
          const img = new Image(); img.src = "data:image/png;base64,${data}"; await img.decode();
          const canvas = document.createElement("canvas"); canvas.width = img.width; canvas.height = img.height;
          const g = canvas.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
          const one = document.createElement("canvas").getContext("2d"); one.fillStyle = ${JSON.stringify(geo.bg)}; one.fillRect(0, 0, 1, 1);
          const bg = one.getImageData(0, 0, 1, 1).data;
          const geo = ${JSON.stringify(geo)}, x0 = Math.round(geo.left + 20), x1 = Math.round(geo.right - 20), y0 = Math.ceil(geo.top), y1 = Math.floor(geo.bottom);
          let most = 0, at = null;
          for (let y = y0; y < y1; y++) {
            const d = g.getImageData(x0, y, x1 - x0, 1).data;
            for (let i = 0; i < d.length; i += 4) {
              const off = Math.max(Math.abs(d[i] - bg[0]), Math.abs(d[i + 1] - bg[1]), Math.abs(d[i + 2] - bg[2]));
              if (off > most) { most = off; at = { x: x0 + i / 4, y }; }
            }
          }
          return { most, at, size: img.width + "x" + img.height };
        })()`);
        assert.ok(strip.size === `${width}x${height}`, `${label}: the screenshot is the window's size (${strip.size})`);
        return { ...strip, rows: Math.floor(geo.bottom) - Math.ceil(geo.top) };
      };
      const healthy = async (when) => {
        assert.deepEqual(await evaluate("__errors"), [], `${label}: browser errors ${when}`);
        assert.equal(await evaluate("!!document.querySelector('.brick-broke, .crash')"), false, `${label}: broken UI ${when}`);
        assert.ok(await evaluate("Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth + 1"), `${label}: sideways overflow ${when}`);
      };
      const band = () => evaluate(`getComputedStyle(document.querySelector(".app.shell"), "::after").content`);

      // ── Cards, with Finish it's card over the composer ──
      await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/?shell=2` });
      assert.ok(await until('!!document.querySelector(".app.shell .spine-frame.spine-ready")', 10000), `${label}: the shell opens on the Canvas`);
      await evaluate("document.fonts.ready.then(() => true)");
      assert.equal(await band(), "none", `${label}: the Canvas has no band under the stage (it keeps its own words clear of it)`);
      await open("cards", "cards");
      assert.ok(await until('!!document.querySelector(".pullback")', 8000), `${label}: Finish it's card is offered over the composer`);
      core.send({ type: "unfold", thread_id: null, open: true });
      await sleep(700);
      await evaluate("window.scrollTo(0, 0)");
      assert.equal(await band(), '""', `${label}: Cards has the page's color under the stage`);
      const blank = await gap();
      assert.ok(blank.most <= BLANK, `${label}: the page's words show in the ${blank.rows} px between the stage's card and its composer (${blank.most} of 255 off the page's color at ${JSON.stringify(blank.at)}; at most ${BLANK})`);
      await shoot("cards");
      await healthy("on Cards");

      // The end of the list clears the stage, however tall it is: a notice over the card makes it taller than the 180 px
      // the page used to keep, and the last card ended under it.
      await evaluate("window.scrollTo(0, 1e6)");
      core.send({ type: "notice", message: "Saved the map to your Downloads folder." });
      assert.ok(await until('!!document.querySelector(".shell-stage .notice")', 3000), `${label}: a notice shows over the stage's card`);
      await sleep(500);
      await evaluate("window.scrollTo(0, 1e6)");
      await sleep(200);
      const end = await evaluate(`(() => {
        const stage = document.querySelector(".shell-stage").getBoundingClientRect();
        const cards = [...document.querySelectorAll("main.map .thread")].filter((card) => card.getClientRects().length);
        return { stageTop: stage.top, last: Math.max(...cards.map((card) => card.getBoundingClientRect().bottom)), scrolled: Math.round(window.scrollY), room: document.documentElement.scrollHeight - innerHeight };
      })()`);
      assert.ok(end.scrolled >= end.room - 2, `${label}: the page is scrolled to its end (${end.scrolled} of ${end.room})`);
      assert.ok(end.last <= end.stageTop - FADE + 0.5, `${label}: the last card ends at ${end.last.toFixed(0)}, ${(end.last - end.stageTop).toFixed(0)} px under the stage's top (${end.stageTop.toFixed(0)}), not clear of it by ${FADE}`);
      await shoot("cards-end");
      summary.push(`${label}: gap ${blank.most}/255 off, last card ${(end.stageTop - end.last).toFixed(0)} px clear of the stage`);

      // ── The Palace, the demo's last frame: its pictures and captions end above the band at laptop size ──
      await evaluate("window.scrollTo(0, 0)");
      await tap(".shell-bl .shell-button", "Back to the Canvas");
      assert.ok(await until('document.documentElement.dataset.view === "map" && !!document.querySelector(".spine-frame.spine-ready")', 5000), `${label}: Back to the Canvas`);
      assert.equal(await band(), "none", `${label}: back on the Canvas the band is gone`);
      await open("pictures", "palace");
      assert.equal(await band(), '""', `${label}: the Palace has the page's color under the stage`);
      const palace = await evaluate(`(() => {
        const stage = document.querySelector(".shell-stage").getBoundingClientRect();
        const tiles = [...document.querySelectorAll(".palace-tile")];
        return { stageTop: stage.top, tiles: tiles.length, bottom: Math.max(...tiles.map((tile) => tile.getBoundingClientRect().bottom)), top: Math.min(...tiles.map((tile) => tile.getBoundingClientRect().top)) };
      })()`);
      assert.equal(palace.tiles, world.threads.length, `${label}: every topic has its picture`);
      if (width >= 1440) assert.ok(palace.bottom <= palace.stageTop - FADE + 0.5, `${label}: the Palace's pictures end at ${palace.bottom.toFixed(0)}, under the band that starts at ${(palace.stageTop - FADE).toFixed(0)}`);
      await shoot("palace");
      await healthy("on the Palace");

      // ── The Countdown's editor over the Live outline, on the Canvas ──
      shown = calm;
      await page("Page.removeScriptToEvaluateOnNewDocument", { identifier: seeded });
      seeded = (await page("Page.addScriptToEvaluateOnNewDocument", { source: seed({ countdown: true, "live-outline": true }) })).identifier;
      await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/?shell=2` });
      assert.ok(await until('!!document.querySelector(".spine-frame.spine-ready") && !!document.querySelector(".live-outline") && !!document.querySelector(".countdown-card")', 10000), `${label}: the Canvas opens with the Live outline and the Countdown`);
      assert.equal(await evaluate('!!document.querySelector(".pullback")'), false, `${label}: nothing is offered over the composer, so the outline stands over the Countdown`);
      await sleep(800);
      const outline = await evaluate(`(() => { const r = document.querySelector(".live-outline").getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height, seen: getComputedStyle(document.querySelector(".live-outline")).visibility }; })()`);
      assert.equal(outline.seen, "visible", `${label}: the Live outline shows before the editor opens`);
      await shoot("editor-closed");
      await tap(".countdown-card", "the Countdown card");
      assert.ok(await until('!!document.querySelector(".countdown-editor")', 3000), `${label}: a tap on the card opens its editor`);
      await sleep(300);
      // The editor opens over the outline (they share the corner), and no word of the outline that shows is part under it, part
      // out: a sliver of a word past the editor's edge.
      const slivers = await evaluate(`(() => {
        const editor = document.querySelector(".countdown-editor").getBoundingClientRect();
        const box = document.querySelector(".live-outline").getBoundingClientRect();
        const meets = (r) => r.left < editor.right && r.right > editor.left && r.top < editor.bottom && r.bottom > editor.top;
        const out = [];
        for (const el of document.querySelectorAll(".live-outline *")) {
          const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          if (!own || getComputedStyle(el).visibility === "hidden") continue;
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0 || !meets(r)) continue;
          const inside = r.left >= editor.left - 0.5 && r.right <= editor.right + 0.5 && r.top >= editor.top - 0.5 && r.bottom <= editor.bottom + 0.5;
          if (!inside) out.push((el.textContent.trim().slice(0, 24)) + " " + Math.round(r.left) + "–" + Math.round(r.right) + " × " + Math.round(r.top) + "–" + Math.round(r.bottom));
        }
        return { editor: [Math.round(editor.left), Math.round(editor.right), Math.round(editor.top), Math.round(editor.bottom)], over: meets(box), out };
      })()`);
      assert.equal(slivers.over, true, `${label}: the editor opens over the Live outline (editor ${JSON.stringify(slivers.editor)}), so there is a sliver to look for`);
      assert.deepEqual(slivers.out, [], `${label}: words of the Live outline are part under the Countdown editor, part past its edge (editor ${JSON.stringify(slivers.editor)})`);
      assert.equal(await evaluate('getComputedStyle(document.querySelector(".countdown-editor")).visibility'), "visible", `${label}: the editor itself shows`);
      await shoot("editor-open");
      await tap(".countdown-close", "the editor's close");
      assert.ok(await until('!document.querySelector(".countdown-editor")', 3000), `${label}: the editor shuts`);
      const back = await evaluate(`(() => { const r = document.querySelector(".live-outline").getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height, seen: getComputedStyle(document.querySelector(".live-outline")).visibility }; })()`);
      assert.deepEqual(back, outline, `${label}: the Live outline is back where it was when the editor shuts`);
      await healthy("with the editor shut");
      runs++;
      await browser.close();
      browser = null;
    }
  }
} finally {
  if (browser) await browser.close();
  core.close();
}
console.log(`dock-slivers-check: ok (${runs} runs: the page's words never show between the stage's card and its composer, the end of Cards clears a stage with a notice over its card, the Palace's pictures end above the band, the Countdown's editor leaves no word of the Live outline showing; laptop and phone, light and dark)`);
if (process.env.VERBOSE) console.log(summary.join("\n"));
