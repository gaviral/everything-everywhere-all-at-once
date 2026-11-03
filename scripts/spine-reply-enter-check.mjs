// Build with npm --prefix ui run build, then run node scripts/spine-reply-enter-check.mjs.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

const unavailable = ready();
if (unavailable) { console.error(`spine-reply-enter-check: ${unavailable}`); process.exit(3); }
const shots = process.env.SHOTS;
assert.ok(shots, "SHOTS must name the screenshot output directory");
mkdirSync(shots, { recursive: true });
const core = await standInCore(() => []);
try {
  for (const [width, height] of [[1440, 900], [390, 844]]) for (const theme of ["light", "dark"]) {
    const scene = await openPage(`http://127.0.0.1:${core.port}/bricks.html?brick=spine&sample=student-week`, { width, height });
    try {
      const { page, evaluate, until } = scene;
      const check = (condition, message) => assert.ok(condition, `${width}×${height} ${theme}: ${message}`);
      await page("Emulation.setDeviceMetricsOverride", { width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile: width === 390 });
      await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "no-preference" }] });
      check(await until(`!!document.querySelector('.spine-frame.spine-ready')`, 8000), "Spine ready");
      check(await evaluate(`innerWidth === ${width} && innerHeight === ${height}`), "actual device viewport dimensions");
      check(await evaluate(`matchMedia('(prefers-color-scheme: ${theme})').matches`), "requested color scheme");
      const tap = async (key, { code, vk, text } = {}) => {
        for (const type of ["keyDown", "keyUp"]) await page("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk, text: type === "keyDown" ? text : undefined });
      };
      const enter = () => tap("Enter", { code: "Enter", vk: 13, text: "\r" });
      const escape = () => tap("Escape", { code: "Escape", vk: 27 });
      const typed = async (text) => { for (const ch of text) await tap(ch, { code: ch === " " ? "Space" : undefined, text: ch }); };
      const click = async ({ x, y }, count = 1) => {
        await page("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
        for (let n = 1; n <= count; n++) for (const type of ["mousePressed", "mouseReleased"]) {
          await page("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: n });
        }
      };
      const wordsAt = (id, words) => evaluate(`(() => {
        const text = document.querySelector('.react-flow__node[data-id="p:${id}"] .spine-text');
        if (!text) return null;
        const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const at = node.textContent.indexOf(${JSON.stringify(words)});
          if (at < 0) continue;
          const range = document.createRange();
          range.setStart(node, at); range.setEnd(node, at + ${words.length});
          const r = range.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        return null;
      })()`);
      const log = () => evaluate(`[...document.querySelectorAll('.playground-log li')].map(li => li.textContent)`);
      const annotations = async () => (await log()).filter(line => line.startsWith("annotate "));
      const camera = () => evaluate(`(() => {
        const follow = document.querySelector('.spine-follow');
        // Corner hides the follow button on a narrow screen while following; holding shows it again.
        if (!follow && ${width} !== 390) throw new Error('desktop follow control missing');
        return { transform: document.querySelector('.react-flow__viewport').style.transform,
          stops: [...document.querySelectorAll('.spine-stop')].map(b => b.getAttribute('aria-pressed')),
          following: follow ? follow.getAttribute('aria-pressed') : 'true' };
      })()`);
      const calm = async () => {
        let last = "", same = 0;
        for (let n = 0; n < 60; n++) {
          const current = JSON.stringify(await camera());
          same = current === last ? same + 1 : 0;
          if (same >= 4) return;
          last = current; await sleep(80);
        }
        assert.fail("camera did not settle");
      };
      const noOverflow = async () => check(await evaluate(`document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth`), "no sideways page overflow");
      const selectWords = async () => {
        await calm();
        const at = await wordsAt("th-2", "precheck");
        check(at && at.x > 0 && at.x < width && at.y > 0 && at.y < height, "target words visible");
        await click(at, 2);
        check(await until(`getSelection().toString() === 'precheck' && !!document.querySelector('.spine-reply-ask')`), "real double-click selects exact words");
        check(await evaluate(`document.activeElement === document.querySelector('.react-flow__node[data-id="p:th-2"] .spine-text') && document.activeElement.closest('.spine-selecting') !== null`), "selected words retain focus before Enter");
      };
      const fieldOpen = async (quote) => {
        check(await until(`!!document.querySelector('.spine-reply-field') && document.activeElement === document.querySelector('.spine-reply-field')`), "reply field opens with focus");
        assert.equal(await evaluate(`document.querySelector('.spine-reply-field').getAttribute('aria-label')`), `Reply to “${quote}”`);
        assert.equal(await evaluate(`document.querySelector('.spine-reply-field').value`), "");
        await noOverflow();
      };

      // A point without picked words keeps Enter/Space selection and R-to-reply.
      for (const key of ["Enter", " "]) {
        await evaluate(`document.querySelector('.react-flow__node[data-id="p:th-2"] .spine-text').focus()`);
        await calm();
        const count = (await log()).filter(line => line.startsWith("select ")).length;
        await tap(key, { code: key === " " ? "Space" : "Enter", vk: key === " " ? 32 : 13, text: key === " " ? " " : "\r" });
        assert.equal((await log()).filter(line => line.startsWith("select ")).length, count + 1, `${key} selects ordinary point once`);
        check(await evaluate(`!document.querySelector('.spine-reply, .spine-reply-ask')`), "ordinary point key does not open reply");
      }
      const whole = await evaluate(`document.querySelector('.react-flow__node[data-id="p:th-2"] .spine-text').title`);
      await tap("R", { code: "KeyR", vk: 82, text: "R" });
      await fieldOpen(whole);
      await escape();
      check(await until(`!document.querySelector('.spine-reply')`), "R reply cancels");
      assert.deepEqual(await annotations(), [], "ordinary point keys send no annotations");

      // The regression: no blur, focus change or direct handler call between double-click and Enter.
      await selectWords();
      const picks = (await log()).filter(line => line.startsWith("select ")).length;
      await enter();
      await fieldOpen("precheck");
      assert.equal((await log()).filter(line => line.startsWith("select ")).length, picks, "Enter reaches Reply without picking the point again");
      assert.deepEqual(await annotations(), [], "opening sends no annotation");
      await calm();
      const before = await camera();
      const text = "Check 1 2 3 0 f F n s + - = r R";
      await typed(text);
      await sleep(500);
      assert.equal(await evaluate(`document.querySelector('.spine-reply-field').value`), text);
      assert.deepEqual(await camera(), before, "typing camera shortcuts leaves camera unchanged");
      assert.deepEqual(await annotations(), [], "typing sends no annotation");
      await noOverflow();
      const shot = await page("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(shots, `spine-reply-enter-${width}-${theme}.png`), Buffer.from(shot.data, "base64"));
      await enter();
      check(await until(`!document.querySelector('.spine-reply') && [...document.querySelectorAll('.spine-quote')].some(q => q.textContent === 'precheck')`), "Enter submits and marks the exact quote");
      await sleep(200);
      assert.deepEqual(await annotations(), [`annotate th-2 “precheck”: “${text}” → a new note on those words`], "exactly one annotation through the existing path");

      // Clicking Reply still opens; Escape cancels both a draft and picked words.
      await selectWords();
      const ask = await evaluate(`(() => { const r = document.querySelector('.spine-reply-ask').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await click(ask);
      await fieldOpen("precheck");
      await typed("cancel this");
      await escape();
      check(await until(`!document.querySelector('.spine-reply, .spine-reply-ask, .spine-selecting') && getSelection().toString() === ''`), "Escape cancels draft");
      await selectWords();
      await escape();
      check(await until(`!document.querySelector('.spine-reply-ask, .spine-selecting') && getSelection().toString() === ''`), "Escape cancels word selection");

      assert.equal((await annotations()).length, 1, "cancellation and point keys send no extra annotations");
      await noOverflow();
      assert.equal(await evaluate(`document.querySelector('.playground').dataset.errors`), "0");
    } finally { await scene.close(); }
  }
  console.log("spine-reply-enter-check: ok");
} finally { core.close(); }
