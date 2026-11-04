// The new shell's Cards view and its keys (?shell=2). Cards opens from the Catalog's Show and stays open (Find and a
// spoken "expand …" keep it), with what a demo shows on a card within reach (Add to Reminders, a proposal, an idea,
// "Did you mean …?") and a way back that takes taps. A REAL Esc key press closes the rail, and only the rail: the next
// one folds the cards. A key event dispatched by a script passed that test while the real key failed (a listener the
// page takes off and puts back on every render is skipped by a key press whose earlier listener re-rendered in between;
// the map's Esc folds the cards), so each key here goes through the browser's own input path (CDP
// Input.dispatchKeyEvent), and so does each tap.
// Synthetic map, throwaway browser storage, the real built UI. SHOTS=dir saves the states at laptop and phone sizes,
// light and dark: catalog-show (Cards switched on, its Show), cards-open, rail-closed (after a real Esc).
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP cards-esc-check: ${why}`); process.exit(3); }
process.once("uncaughtException", (error) => { console.error(`cards-esc-check: ${error.message}`); process.exit(1); });

const now = Date.now();
const thread = (id, title) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "" });
const thought = (id, text, thread_id, extra = {}) => ({ id, speaker: "you", text, point: text, thread_id, placed: true, unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: now, place_ms: 2000, decided: false, ...extra });
// "Rent is due" is where the talk is, so its card is open with everything the AI added to it: a reminder to add, an idea
// to keep, a rename it asks about, and a word it may have misheard. The others start folded.
const world = {
  threads: [thread("T1", "Hackathon plan"), thread("T2", "Rent is due"), thread("T3", "Group project meeting")],
  thoughts: [
    thought("p0", "Deadline tomorrow 9 PM, need to record the demo", "T1"),
    thought("p1", "Repo ready, precheck passes, README not done", "T1"),
    thought("p2", "Rent due Nov 1, forgot the transfer", "T2"),
    thought("p3", "Ask muse bark about the lease", "T2", { unclear: "muse bark", guess: "Muse Spark" }),
    thought("p4", "Group presentation Wednesday", "T3"),
  ],
  active: "T2", active_by: { you: "T2" },
  suggestions: [{ id: "sg-1", thread_id: "T2", text: "Set up autopay", status: "new" }],
  actions: [{ id: "ac-1", thread_id: "T2", kind: "reminder", title: "Transfer rent to landlord", when: "Tomorrow", status: "new", done_ms: null }],
  proposals: [{ id: "pr-1", kind: "rename", thread_id: "T2", title: "Rent payment", status: "new" }],
  merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {},
};
let shown = world;
const move = (id) => {
  shown = { ...shown, active: id, active_by: { you: id } };
  core.send({ type: "change", change: { type: "active_changed", thread_id: id, speaker: "you" } });
};
const core = await standInCore(() => [{ type: "snapshot", world: shown }], {
  onMessage: (message) => { if (message.type === "focus") move(message.thread_id); },
});
const base = `http://127.0.0.1:${core.port}/`;
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

// What a person finds on a Cards card, by the label it is read out under; each must be on screen and take a tap there.
const DEMO = [
  ["Add to Reminders", 'button[aria-label="Add Transfer rent to landlord to Reminders"]'],
  ["a ✦ proposal's Rename", 'button[aria-label="Rename: Rename to “Rent payment”?"]'],
  ["an idea's Keep", 'button[aria-label="Keep suggestion: Set up autopay"]'],
  // The Canvas remains mounted behind Cards; inspect the correction in the shown view.
  ["Did you mean …? Yes", 'main[aria-label="Cards"] .did-you-mean button:not(.quiet)'],
];
const KEYS = { c: ["c", "KeyC", 67, "c"], y: ["y", "KeyY", 89, "y"], m: ["m", "KeyM", 77, "m"], Escape: ["Escape", "Escape", 27] };
let browser = null;
let runs = 0;

try {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    for (const scheme of ["light", "dark"]) {
      const label = `${width}x${height} ${scheme}`;
      shown = world;
      browser = await openPage("about:blank", { width, height });
      const { page, evaluate, until } = browser;
      // Without Page.enable, Chrome accepts the script below and never runs it.
      await page("Page.enable");
      await page("Page.addScriptToEvaluateOnNewDocument", { source: `
        localStorage.clear(); sessionStorage.clear();
        window.__errors = [];
        // A size observer whose change lands a frame later is reported as a window error by Chrome: not one.
        addEventListener("error", e => { if (!/^ResizeObserver loop/.test(e.message)) __errors.push(e.message || "Resource failed: " + e.target?.src); }, true);
        addEventListener("unhandledrejection", e => __errors.push(String(e.reason)));
        const error = console.error;
        console.error = (...args) => { __errors.push(args.map(String).join(" ")); error.apply(console, args); };
      ` });
      await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
      await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });

      const press = async (name) => {
        const [key, code, keyCode, text] = KEYS[name];
        await page("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode, ...(text ? { text } : {}) });
        await page("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode });
      };
      const tapAt = async ({ x, y }) => {
        await page("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
        for (const type of ["mousePressed", "mouseReleased"]) await page("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
      };
      // Where the first match can be tapped: scrolled to the middle of its window, shown, whole inside the window, and
      // the thing at its centre is itself (not the stage, a corner or the rail on top of it); else why not.
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
      const reach = async (selector, what) => {
        let found = await where(selector);
        for (let waited = 0; typeof found !== "object" && waited < 4000; waited += 100) { await sleep(100); found = await where(selector); }
        assert.equal(typeof found, "object", `${label}: ${what} is on screen and takes a tap (${found})`);
        return found;
      };
      const tap = async (selector, what) => { await tapAt(await reach(selector, what)); await sleep(150); };
      const state = () => evaluate(`({
        view: document.documentElement.dataset.view, rail: !!document.querySelector('[data-slot="rail"]'),
        cards: !!document.querySelector('main[aria-label="Cards"]'), canvas: !!document.querySelector('.spine-frame')?.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }),
        back: !!document.querySelector('.shell-bl'), tab: document.querySelector('[data-slot="rail"] [role="tab"][aria-selected="true"]')?.dataset.tab ?? null })`);
      const settles = async (want, what, ms = 3000) => {
        let at = await state();
        for (let waited = 0; waited < ms && !Object.entries(want).every(([k, v]) => at[k] === v); waited += 50) { await sleep(50); at = await state(); }
        for (const [k, v] of Object.entries(want)) assert.equal(at[k], v, `${label}: ${what} (${k}: wanted ${v}, got ${at[k]})`);
      };
      const healthy = async (when) => {
        assert.deepEqual(await evaluate("__errors"), [], `${label}: browser errors ${when}`);
        assert.equal(await evaluate("!!document.querySelector('.brick-broke, .crash')"), false, `${label}: broken UI ${when}`);
        assert.ok(await evaluate("Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth + 1"), `${label}: sideways overflow ${when}`);
      };
      const shoot = async (name) => {
        if (!shots) return;
        await evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
        const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        writeFileSync(join(shots, `${name}-${width}-${scheme}.png`), Buffer.from(data, "base64"));
      };

      await page("Page.navigate", { url: `${base}?shell=2` });
      assert.ok(await until(`document.readyState === "complete" && !!document.querySelector(".app.shell .spine-frame.spine-ready")`, 10000), `${label}: the shell opens on the Canvas`);
      await evaluate("document.fonts.ready.then(() => true)");
      await sleep(300);
      await settles({ view: "map", rail: false, cards: false, canvas: true, back: false }, "starts on the Canvas, rail closed");

      // ── A real Esc closes the rail, from the Canvas where the map's own Esc handler runs too ──
      await press("c");
      await settles({ rail: true, tab: "catalog" }, "a real C opens the Catalog");
      await press("Escape");
      await settles({ rail: false, view: "map" }, "a real Esc closes the Catalog");
      await shoot("rail-closed");
      await press("y");
      await settles({ rail: true, tab: "history" }, "a real Y opens History");
      await press("Escape");
      await settles({ rail: false }, "a real Esc closes History");

      // ── Cards: off until it's switched on, then Show opens it, and it stays ──
      await press("c");
      await settles({ rail: true, tab: "catalog" }, "a real C opens the Catalog again");
      assert.equal(await evaluate(`document.querySelector('[data-row="cards"] [role="switch"]')?.getAttribute("aria-checked")`), "false", `${label}: Cards starts off`);
      assert.equal(await evaluate(`!!document.querySelector('[data-row="cards"] .shell-link')`), false, `${label}: Cards has no Show while off`);
      await tap('[data-row="cards"] [role="switch"]', "Cards' switch");
      assert.ok(await until(`document.querySelector('[data-row="cards"] [role="switch"]')?.getAttribute("aria-checked") === "true"`, 2000), `${label}: the switch turns Cards on`);
      assert.ok(await until(`!!document.querySelector('[data-row="cards"] .shell-link')`, 2000), `${label}: Cards has its Show once on`);
      await reach('[data-row="cards"] .shell-link', "Cards' Show");
      await shoot("catalog-show");
      await tap('[data-row="cards"] .shell-link', "Cards' Show");
      await settles({ view: "cards", cards: true, canvas: false, rail: false, back: true }, "Show opens Cards, and the rail gets out of its way");
      // The view hands back to the map on the render after it opens; wait past that, and past a fresh snapshot.
      await sleep(900);
      core.send({ type: "snapshot", world: shown });
      await sleep(400);
      await settles({ view: "cards", cards: true, canvas: false }, "Cards stays open");
      await healthy("with Cards open");

      // What the demo shows on a card, within reach, and a tap on Add to Reminders reaching the core.
      await evaluate("window.scrollTo(0, 0)");
      await shoot("cards-open");
      for (const [what, selector] of DEMO) await reach(selector, what);
      await tap(DEMO[0][1], "Add to Reminders");
      for (let waited = 0; waited < 2000 && !core.heard.some((m) => m.type === "approve" && m.id === "ac-1"); waited += 50) await sleep(50);
      assert.ok(core.heard.some((m) => m.type === "approve" && m.id === "ac-1"), `${label}: Add to Reminders reaches the core`);

      // The way back takes taps (on a phone the composer used to sit on it), and Find keeps Cards.
      await reach(".shell-bl .shell-button", "Back to the Canvas");
      move("T1");
      core.send({ type: "found", thread_id: "T1", thought_id: "p0", message: "Found the requested point" });
      await reach("#point-p0", "a found point's words");
      await settles({ view: "cards", cards: true, canvas: false }, "Find leaves Cards open");
      // "Expand …", said aloud, opens that card where it is.
      core.send({ type: "unfold", thread_id: "T3", open: true });
      await reach("#point-p4", "an expanded card's point");
      await settles({ view: "cards", cards: true, canvas: false }, "expanding a card by voice leaves Cards open");

      // A real Esc with Cards under it closes the rail and nothing else; the next one folds the cards, as it does on today's page.
      await press("c");
      await settles({ rail: true, tab: "catalog" }, "a real C opens the Catalog over Cards");
      await press("Escape");
      await settles({ rail: false, view: "cards", cards: true }, "a real Esc closes the Catalog and leaves Cards");
      await sleep(300);
      assert.equal(await evaluate(`!!document.getElementById("point-p4")`), true, `${label}: the Esc that closed the rail left the open cards open`);
      await press("Escape");
      assert.ok(await until(`!document.getElementById("point-p4")`, 2000), `${label}: the next Esc folds the cards that are off your place`);
      await settles({ view: "cards", cards: true }, "folding the cards leaves Cards");

      // Back to the Canvas: the pill, then M after Show once more.
      await tap(".shell-bl .shell-button", "Back to the Canvas");
      await settles({ view: "map", cards: false, canvas: true, back: false }, "Back to the Canvas returns to it");
      await press("c");
      await settles({ rail: true, tab: "catalog" }, "C opens the Catalog on the Canvas again");
      assert.equal(await evaluate(`!!document.querySelector('[data-row="cards"] .shell-link')`), true, `${label}: Cards keeps its Show while it is on`);
      await tap('[data-row="cards"] .shell-link', "Cards' Show again");
      await settles({ view: "cards", cards: true, rail: false }, "Show opens Cards again");
      await press("m");
      await settles({ view: "map", cards: false, canvas: true }, "a real M returns to the Canvas");

      // Cards switched off while it is shown hands the window back to the Canvas.
      await press("c");
      await settles({ rail: true, tab: "catalog" }, "C opens the Catalog before Cards goes off");
      await tap('[data-row="cards"] .shell-link', "Cards' Show for the last time");
      await settles({ view: "cards", cards: true }, "Cards is shown once more");
      await press("c");
      await settles({ rail: true, tab: "catalog" }, "C opens the Catalog over Cards");
      await tap('[data-row="cards"] [role="switch"]', "Cards' switch");
      await settles({ view: "map", cards: false, canvas: true }, "switching Cards off while shown returns to the Canvas");
      await healthy("at the end");
      runs++;
      await browser.close();
      browser = null;
    }
  }
} finally {
  if (browser) await browser.close();
  core.close();
}
console.log(`cards-esc-check: ok (${runs} runs, laptop and phone, light and dark: a real Esc closes the rail and only the rail; Cards opens from the Catalog, stays open and reaches Add to Reminders, a proposal, an idea and "Did you mean"; the way back, Find, "expand", M and the switch)`);
