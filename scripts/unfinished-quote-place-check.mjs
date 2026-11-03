// The built UI with an already-dropped sample thread. Moves change membership, not the last spoken turn.
// SHOTS=dir saves the shell's incoming-move regression state at both sizes in both themes.
// With WORKTREE OUTPUT [/?shell=2] arguments, save the same fixture and print its absolute PNG paths as JSON.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [tree, output, ...paths] = process.argv.slice(2);
if (tree && (!output || paths.length > 1 || (paths.length === 1 && paths[0] !== "/?shell=2"))) {
  throw new Error("usage: unfinished-quote-place-check.mjs [WORKTREE OUTPUT [/?shell=2]]");
}
const { ready, standInCore, openPage, sleep } = await import(tree
  ? pathToFileURL(join(resolve(tree), "scripts/headless.mjs")) : new URL("./headless.mjs", import.meta.url));

const why = ready();
if (why) { console.log(`SKIP unfinished-quote-place-check: ${why}`); process.exit(3); }
const shots = output ? resolve(output) : process.env.SHOTS;
const shotPaths = [];
if (shots) mkdirSync(shots, { recursive: true });
const now = Date.now() - 10_000;
const quote = "I should choose the picnic spot before—";
const older = "Bring the folding chairs";
const imported = "Pack a picnic basket";
const future = "Check the riverside weather";
const thread = (id, title, extra = {}) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: now,
  tags: [], picture: null, dropped_by: "", ...extra });
const thought = (id, text, thread_id, extra = {}) => ({ id, speaker: "you", text, point: text, thread_id, placed: true,
  unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: now, place_ms: 2000, decided: false, ...extra });
// Original sample words; the newer herb thought belongs elsewhere when the picnic thread is left unfinished.
const world = {
  threads: [thread("T1", "Balcony herbs", { touched_ms: now + 1000 }), thread("T2", "Riverside picnic", { status: "dropped", dropped_by: "you" })],
  thoughts: [
    thought("herbs", "Water the balcony herbs", "T1", { at_ms: now - 2000 }),
    thought("p0", older, "T2", { at_ms: now - 1000 }),
    thought("p1", "Plant mint in its own pot", "T1", { at_ms: now + 1000 }),
    thought("p2", quote, "T2", { complete: false }),
    thought("sam", "Meet by the river", "T2", { speaker: "Sam" }),
    // Imports can be appended after newer words. A future-dated sample counts as the earliest, as in lastWordsOn.
    thought("imported", imported, "T2", { at_ms: now - 4000, place_ms: null }),
    thought("future", future, "T2", { at_ms: now + 3_600_000 }),
  ],
  active: "T1", active_by: { you: "T1" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true,
  recaps: [], notes: {}, proposals: [],
  positions: { p2: { x: 2200, y: 1800, by: "you", at_ms: now } },
};
let shown = world;
const core = await standInCore(() => [{ type: "snapshot", world: shown }], {
  onMessage: (message) => {
    if (message.type !== "focus") return;
    shown = { ...shown, active: message.thread_id, active_by: { you: message.thread_id } };
    core.send({ type: "change", change: { type: "active_changed", thread_id: message.thread_id, speaker: "you" } });
  },
});
let browser;
const timeout = setTimeout(() => { console.error("unfinished-quote-place-check: timed out"); process.exit(1); }, 180_000);
try {
  for (const [width, height] of [[1440, 900], [390, 844]]) for (const scheme of ["light", "dark"]) {
    browser = await openPage("about:blank", { width, height });
    const { page, evaluate, until } = browser;
    await page("Page.enable");
    await page("Page.addScriptToEvaluateOnNewDocument", { source: `
      localStorage.setItem("e2a2o.toured", "1");
      localStorage.setItem("e2a2o.features", JSON.stringify({ cards: true, pictures: true }));
      window.__errors = [];
      addEventListener("error", e => {
        if (!/^ResizeObserver loop/.test(e.message)) __errors.push(e.message || "Resource failed: " + e.target?.src);
      }, true);
      addEventListener("unhandledrejection", e => __errors.push(String(e.reason)));
      const error = console.error;
      console.error = (...args) => { __errors.push(args.map(String).join(" ")); error.apply(console, args); };
    ` });
    await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    for (const shell of [true, false]) {
      const label = `${shell ? "shell" : "legacy"}/${width}x${height}/${scheme}`;
      const check = async (expression, reason, ms = 8000) => assert.ok(await until(expression, ms), `${label}: ${reason}`);
      const tap = async (at) => {
        for (const type of ["mousePressed", "mouseReleased"]) await page("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
      };
      const healthy = async () => {
        assert.deepEqual(await evaluate("__errors"), [], `${label}: browser errors`);
        assert.equal(await evaluate('!!document.querySelector(".brick-broke, .crash")'), false, `${label}: healthy UI`);
        assert.equal(await evaluate('Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth + 1'), true, `${label}: no horizontal overflow`);
      };
      const settled = async () => {
        await evaluate('document.fonts.ready.then(() => true)');
        await sleep(700);
        const rect = () => evaluate(`(() => {
          const el = document.querySelector('.pullback'), r = el?.getBoundingClientRect();
          return { card: r ? [r.x, r.y, r.width, r.height, Number(getComputedStyle(el).opacity)] : null,
            canvas: document.querySelector('.react-flow__viewport')?.style.transform ?? null };
        })()`);
        const before = await rect();
        await sleep(100);
        assert.deepEqual(await rect(), before, `${label}: card layout settled`);
        await healthy();
      };
      const expectQuote = async (text, reason) => {
        await check('document.querySelectorAll(".pullback").length === 1', `${reason}: one unfinished card`);
        const expected = text ? `“${text}”` : null;
        await check(`(document.querySelector('.pullback-quote')?.textContent ?? null) === ${JSON.stringify(expected)}`, `${reason}: quote is ${JSON.stringify(expected)}`);
        await settled();
        assert.equal(await evaluate('document.querySelector(".pullback-title b").textContent'), "Riverside picnic", `${label}: offered thread`);
        assert.equal(await evaluate('document.querySelector(".pullback-quote")?.textContent ?? null'), expected, `${label}: ${reason}: settled quote`);
        assert.equal(await evaluate(`document.querySelector('.pullback').checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
          (!document.querySelector('.pullback-quote') || document.querySelector('.pullback-quote').checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))`), true, `${label}: card and quote displayed`);
        assert.deepEqual(await evaluate('[...document.querySelectorAll(".pullback-actions button")].map(el => el.textContent)'), ["Finish it", "Later"]);
      };
      const relay = (change) => core.send({ type: "change", change });
      const move = async (id, to, undo = false) => {
        const from = shown.thoughts.find(t => t.id === id).thread_id;
        shown = { ...shown, thoughts: shown.thoughts.map(t => t.id === id ? { ...t, thread_id: to } : t) };
        relay({ type: "thought_moved", thought_id: id, thread_id: to, from, ...(undo ? { undo: true } : {}) });
        // Prove the relay reached the rendered map before accepting an unchanged quote.
        await check(shell ? `!!document.querySelector('[data-thought="${id}"][data-thread="${to}"]')`
          : `!!document.querySelector('#thread-${to} #point-${id}')`, `${id} moved to ${to}`);
      };

      shown = world;
      await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/${shell ? "?shell=2" : "?cards"}` });
      await check(`!!document.querySelector('#type-a-thought') && !document.querySelector('.tour-tip')`, "sample loaded");
      if (shell) {
        await check('!!document.querySelector(".app.shell .spine-frame.spine-ready")', "populated Canvas ready");
        const bare = await evaluate(`(() => {
          for (let y = 100; y < innerHeight - 200; y += 40) for (let x = 20; x < innerWidth; x += 40) {
            if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) return { x, y };
          }
          return null;
        })()`);
        assert.ok(bare, `${label}: bare canvas is reachable`);
        await tap(bare);
        await check('!document.querySelector(".keys-panel")', "first-use key hint dismissed by canvas input");
      } else {
        // Expose both memberships in the original cards renderer without invoking Finish it or changing the offer.
        core.send({ type: "unfold", thread_id: null, open: true });
        await check('document.querySelector("#thread-T2 .thread-toggle")?.getAttribute("aria-expanded") === "true"', "legacy thread expanded");
      }
      // The actual pause/card condition, with no changes to clocks or product timing.
      await expectQuote(quote, "initial dropped thread ignores another speaker and appended older imports");
      await move("p1", "T2");
      await expectQuote(quote, "newer incoming move does not change the last spoken turn");
      if (shell && shots) {
        assert.equal(await evaluate(`(() => {
          const el = document.querySelector('[data-thought="herbs"] .spine-text'), r = el?.getBoundingClientRect();
          return !!r && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight &&
            el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
        })()`), true, `${label}: populated Canvas remains visible after move`);
        assert.equal(await evaluate(`(() => {
          const card = document.querySelector('.pullback'), r = card.getBoundingClientRect();
          return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight &&
            [...card.querySelectorAll('button, .pullback-quote')].every(el => {
              const b = el.getBoundingClientRect();
              return el.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2));
            });
        })()`), true, `${label}: quote and actions are visible and clear`);
        const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        const png = Buffer.from(data, "base64");
        assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [width, height]);
        const file = resolve(shots, `${output ? "look-1" : "unfinished-quote-place"}-${width}x${height}-${scheme}.png`);
        writeFileSync(file, png);
        shotPaths.push(file);
      }
      await move("p2", "T1");
      await expectQuote(older, "quoted words moved out: recompute from remaining words");
      await move("p2", "T2", true);
      await expectQuote(quote, "undo restores the quote");
      await move("p2", "T1");
      await expectQuote(older, "quoted words moved out again");
      await move("p0", "T1");
      await expectQuote(imported, "older import is the newest eligible word remaining");
      await move("imported", "T1");
      await expectQuote(future, "future-dated sample retains its earliest-word fallback");
      await move("future", "T1");
      await expectQuote(null, "no eligible words: omit quote despite incoming thought and other speaker");

      // A genuinely new spoken turn opens the thread, and trailing off offers its new words after the real pause.
      const spoken = thought("spoken", "Choose a shady picnic spot before—", "T2", { at_ms: Date.now(), complete: false });
      relay({ type: "thought_added", thought: spoken });
      relay({ type: "thread_touched", thread_id: "T2", last_point: spoken.point, at_ms: spoken.at_ms });
      await check('!document.querySelector(".pullback")', "new spoken turn opens thread and removes card");
      relay({ type: "thread_status", thread_id: "T2", status: "dropped", speaker: "you" });
      assert.equal(await evaluate('!!document.querySelector(".pullback-quote")'), false, `${label}: no offer during fresh-word pause`);
      await expectQuote(spoken.text, "newly dropped spoken turn quotes its own words");
      await healthy();
    }
    await browser.close();
    browser = null;
  }
  if (shots) assert.equal(shotPaths.length, 4, "all four incoming-move shell fixtures captured");
  console.log(output ? JSON.stringify(shotPaths) : "unfinished-quote-place-check: ok");
} finally {
  clearTimeout(timeout);
  if (browser) await browser.close();
  core.close();
}
