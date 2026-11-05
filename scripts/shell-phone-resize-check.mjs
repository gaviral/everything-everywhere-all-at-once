// One populated shell, one ordinary held question, live viewport changes with no more core messages.
// SHOTS=dir saves post-resize laptop/phone states in light and dark, before the question is answered.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openPage, ready, standInCore } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP shell-phone-resize-check: ${why}`); process.exit(3); }
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const timeout = setTimeout(() => { console.error("shell-phone-resize-check: timed out"); process.exit(1); }, 120_000);

const now = Date.now();
const thread = (id, title) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "" });
const thought = (id, text, thread_id) => ({ id, speaker: "you", text, point: text, thread_id, placed: true, unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: now, place_ms: 2000, decided: false });
const world = {
  threads: [thread("T1", "Hackathon plan"), thread("T2", "Weekend picnic")],
  thoughts: [thought("a1", "Deadline tomorrow 9 PM, need to record demo", "T1"),
    thought("a2", "Repo ready, precheck passes, README not done", "T1"), thought("b1", "Bring the folding chairs", "T2")],
  active: "T1", active_by: { you: "T1" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true,
  recaps: [], notes: {}, proposals: [], ai: ["AI helper"],
  positions: { a1: { x: 0, y: 0, by: "you", at_ms: now }, b1: { x: 500, y: 0, by: "you", at_ms: now } },
};

try {
  for (const scheme of ["light", "dark"]) {
    let joins = 0;
    const core = await standInCore(() => { joins++; return [{ type: "snapshot", world }]; });
    let browser;
    try {
      browser = await openPage("about:blank", { width: 1440, height: 900 });
      const { page, evaluate, until } = browser;
      // Chrome accepts but ignores a new-document seed without Page.enable first.
      await page("Page.enable");
      await page("Page.addScriptToEvaluateOnNewDocument", { source: `
        localStorage.setItem("e2a2o.toured", "1");
        window.__phoneCheck = { errors: [], answer: 0, later: 0 };
        addEventListener("error", e => {
          if (e.message !== "ResizeObserver loop completed with undelivered notifications.")
            __phoneCheck.errors.push(e.message || "Resource failed: " + (e.target?.src || e.target?.href));
        }, true);
        addEventListener("unhandledrejection", e => __phoneCheck.errors.push(String(e.reason)));
        const error = console.error;
        console.error = (...args) => { __phoneCheck.errors.push(args.map(String).join(" ")); error.apply(console, args); };
      ` });
      await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "no-preference" }] });
      await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/?shell=2` });
      const check = async (expression, label) => assert.ok(await until(expression, 10000), `${scheme}: ${label}`);
      await check('!!document.querySelector(".app.shell .spine-ready") && !!window.e2a2oHold && document.readyState === "complete"', "populated Canvas loads");
      await evaluate('document.querySelector(".tour-skip")?.click()');
      await page("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await page("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await check('!document.querySelector(".tour-tip, .keys-panel")', "first-use hints dismissed");
      // Wait for fonts, rendering and finite browser animations, rather than guessing a delay.
      const settled = () => evaluate(`(async () => {
        await document.fonts.ready;
        do {
          await new Promise(requestAnimationFrame);
          await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().endTime !== Infinity).map(a => a.finished.catch(() => {})));
          await new Promise(requestAnimationFrame);
        } while (document.getAnimations().some(a => a.playState === "running" && a.effect?.getComputedTiming().endTime !== Infinity));
        return true;
      })()`);
      await settled();
      await evaluate(`window.e2a2oHold({ id: "resize-question", by: "Visitor", main: "Which day for the demo?", rest: "Keep this question while the window changes.",
        answer: () => { __phoneCheck.answer++; }, later: () => { __phoneCheck.later++; } })`);

      const presentation = (width, height, open) => {
        const phone = width <= 560;
        return `innerWidth === ${width} && innerHeight === ${height}
          && !!document.querySelector(".shell-wordmark") === ${!phone}
          && !!document.querySelector('[data-held-id="resize-question"]') === ${!phone || open}
          && !!document.querySelector('.shell-held-chip[aria-expanded="false"]') === ${phone && !open}
          && !!document.querySelector('.shell-held-chip[aria-expanded="true"]') === ${phone && open}`;
      };
      const state = async (width, height, open = false) => {
        const phone = width <= 560;
        const card = !phone || open;
        await check(presentation(width, height, open), `${width}: responsive wordmark and held presentation`);
        await settled();
        const actual = await evaluate(`(() => {
          const shown = e => e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
          const elements = [...document.querySelectorAll('.shell-corner, .shell-composer, [data-slot="held"], [data-held-id]')].filter(shown);
          const boxes = elements.map(e => { const r = e.getBoundingClientRect(); return { name: e.dataset.slot || e.className,
            left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, overflow: e.scrollWidth > e.clientWidth + 1 }; });
          return { ids: [...document.querySelectorAll('[data-held-id]')].map(e => e.dataset.heldId),
            count: document.querySelector('.shell-held-chip .shell-count')?.textContent,
            calls: [__phoneCheck.answer, __phoneCheck.later], errors: __phoneCheck.errors,
            overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth,
            broken: !!document.querySelector('.brick-broke, .crash'), canvas: !!document.querySelector('.spine-ready .spine-text'), boxes };
        })()`);
        assert.deepEqual(actual.ids, card ? ["resize-question"] : [], `${scheme}/${width}: same held id when revealed`);
        if (phone) assert.equal(actual.count, "1", `${scheme}/${width}: one retained question`);
        assert.deepEqual(actual.calls, [0, 0], `${scheme}/${width}: resizing never answers or drops the question`);
        assert.deepEqual(actual.errors, [], `${scheme}/${width}: browser errors`);
        assert.equal(actual.broken, false, "healthy shell");
        assert.equal(actual.canvas, true, "populated Canvas retained");
        assert.equal(actual.overflow, false, `${scheme}/${width}: no horizontal page overflow`);
        assert.ok(actual.boxes.length >= 4, "corners, composer and held region measured");
        for (const box of actual.boxes) {
          assert.ok(box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= width && box.top >= 0 && box.bottom <= height && !box.overflow,
            `${scheme}/${width}: ${box.name} fits the viewport: ${JSON.stringify(box)}`);
        }
        const corners = actual.boxes.filter(b => ["top-left", "top-right"].includes(b.name));
        assert.equal(corners.length, 2, "both top corners present");
        assert.ok(corners[0].right <= corners[1].left, "top corners do not overlap");
        assert.equal(joins, 1, "same page and core connection throughout resizing");
        assert.equal(core.connected(), 1, "core stays connected without further messages");
      };
      const resize = async (width, height, open = false) => {
        await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 560 });
        // Check the next rendered frames before waiting for animations: App's unrelated 400 ms clock
        // must not be what eventually refreshes the wordmark and the held presentation.
        assert.ok(await evaluate(`(async () => {
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
          return ${presentation(width, height, open)};
        })()`), `${scheme}/${width}: breakpoint updates on render without waiting for another App effect`);
        await state(width, height, open);
      };
      const shot = async (width, height, suffix = "") => {
        if (!shots) return;
        const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        const png = Buffer.from(data, "base64");
        assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [width, height], "screenshot dimensions");
        writeFileSync(join(shots, `shell-phone-resize-${width}x${height}-${scheme}${suffix}.png`), png);
      };
      const enter = async () => {
        // A real Enter carries its character; without text Chrome does not press a focused button.
        await page("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
        await page("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 0 });
      };

      await state(1440, 900);
      await resize(390, 844);
      await shot(390, 844);
      await resize(1440, 900);
      await shot(1440, 900);
      // The existing inclusive CSS breakpoint, in both directions, with the phone chip still closed.
      await resize(560, 844);
      await resize(561, 844);
      await resize(560, 844);
      await evaluate('document.querySelector(".shell-held-chip").focus()');
      await enter();
      await state(560, 844, true); // Native Enter opens the chip without calling Answer.
      await resize(561, 844);
      await resize(560, 844, true); // Open state survives a desktop visit.
      await resize(1440, 900);
      await resize(390, 844, true);
      await shot(390, 844, "-opened");
      await evaluate('document.querySelector(".shell-held-chip").focus()');
      await enter();
      await state(390, 844); // It still closes normally and keeps the entry.
      await resize(1440, 900);
      await resize(390, 844); // Closed state also survives a desktop visit.
      await evaluate('document.querySelector(".shell-held-chip").focus()');
      await enter();
      await state(390, 844, true);
      // Only this explicit Answer may consume the retained question and invoke its original callback.
      await evaluate('document.querySelector(".shell-held-acts button:first-child").focus()');
      await enter();
      await check('!document.querySelector("[data-slot=held]")', "explicit Answer removes question");
      assert.deepEqual(await evaluate('[__phoneCheck.answer, __phoneCheck.later]'), [1, 0], "original Answer callback exactly once; Later never called");
      assert.deepEqual(await evaluate('__phoneCheck.errors'), [], "no browser errors after answering");
    } finally { if (browser) await browser.close(); core.close(); }
  }
} finally { clearTimeout(timeout); }
console.log("shell-phone-resize-check: ok");
