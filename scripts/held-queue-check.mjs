// A long queue in the original layout stays within the available space; every card can be reached by scrolling.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { openPage, ready, standInCore } from "./headless.mjs";
const why = ready();
if (why) { console.log(`SKIP held-queue-check: ${why}`); process.exit(3); }
const world = { threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [] };
const core = await standInCore(() => [{ type: "snapshot", world }]);
assert.ok(core.port >= 4620);
let page;
try {
  for (const width of [1440, 390]) {
    page = await openPage(`http://127.0.0.1:${core.port}/?shell=1`, { width, height: 844 });
    assert.ok(await page.until('!!document.querySelector("[data-guide=composer]")'));
    await page.evaluate('document.querySelector("[data-guide=composer] textarea").focus()');
    await page.page("Input.insertText", { text: "A thought I am still writing" });
    for (let i = 0; i < 40; i++) core.send({ type: "guide", kind: "hold", target: null, text: `Question ${i}?`, by: "Reviewer", at_ms: Date.now() });
    if (width === 390) {
      assert.ok(await page.until('document.querySelector(".guide-held-chip b")?.textContent === "40"'));
      await page.evaluate('document.querySelector(".guide-held-chip").click()');
    }
    assert.ok(await page.until('document.querySelector(".guide-held-more")?.textContent.includes("39")'));
    await page.evaluate('document.querySelector(".guide-held-more").click()');
    assert.ok(await page.until('document.querySelectorAll(".guide-held-card").length === 40'));
    assert.ok(await page.until(`(() => {
      const outer=document.querySelector('.guide-held[data-place="floating"]'), list=outer?.querySelector('.guide-held-cards');
      if (!list) return false;
      const r=outer.getBoundingClientRect(), composer=document.querySelector('[data-guide="composer"]').getBoundingClientRect();
      return r.top>=0 && r.bottom<=innerHeight && (r.left>=composer.right || r.right<=composer.left || r.bottom<=composer.top) && list.scrollHeight>list.clientHeight;
    })()`), "expanded queue fits clear of the composer and scrolls");
    assert.equal(await page.evaluate('document.querySelector(".guide-held-card").textContent.includes("Question 0?")'), true, "oldest question remains");
    await page.evaluate('document.querySelector(".guide-held-card:last-of-type button").focus()');
    assert.ok(await page.until(`(() => {
      const button=document.activeElement, r=button.getBoundingClientRect(), list=button.closest('.guide-held-cards').getBoundingClientRect();
      return button.closest('.guide-held-card').textContent.includes('Question 39?') && r.top>=list.top && r.bottom<=list.bottom;
    })()`), "keyboard focus scrolls the last question into reach");
    if (process.env.SHOTS) {
      mkdirSync(process.env.SHOTS, { recursive: true });
      const { data } = await page.page("Page.captureScreenshot", { format: "png" });
      writeFileSync(`${process.env.SHOTS}/queue-${width}.png`, Buffer.from(data, "base64"));
    }
    await page.page("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    await page.page("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    assert.ok(await page.until('document.querySelector(".guide-caption")?.textContent.includes("Question 39?")'), "the last question can be opened");
    await page.close(); page = null;
  }
  console.log(`Held queue passed in headless Chrome on ${core.port}: 40 cards retained, desktop/phone scrolling, keyboard access to last question.`);
} finally { await page?.close(); core.close(); }
