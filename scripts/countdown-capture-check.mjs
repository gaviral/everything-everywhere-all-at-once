// The floating deadline card must leave the real canvas input usable, including on a narrow phone.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPage, ready, standInCore } from "./headless.mjs";

assert.equal(ready(), "", "built UI and an owned browser are required");
const shots = mkdtempSync(join(tmpdir(), "countdown-capture-"));
const world = { threads: [], thoughts: [], active: null, active_by: {}, recaps: [], suggestions: [], actions: [], proposals: [], merged: {}, apps: [], apps_seeded: true, notes: {} };
const core = await standInCore(() => [{ type: "snapshot", world }]);
let browser;
const inputAndCardUsable = `(() => {
  const input = document.querySelector('textarea[aria-label="Type a thought"]');
  const card = document.querySelector('.countdown-card');
  const composer = document.querySelector('.shell-composer');
  if (!input || !card || !composer) return false;
  const region = composer.closest('[data-map-capture="active"]') ?? composer;
  const field = input.getBoundingClientRect(), deadline = card.getBoundingClientRect(), form = region.getBoundingClientRect();
  const inside = r => r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
  const separate = deadline.right <= form.left || form.right <= deadline.left || deadline.bottom <= form.top || form.bottom <= deadline.top;
  return input.checkVisibility() && card.checkVisibility() && inside(field) && inside(deadline) && separate
    && input.contains(document.elementFromPoint(field.x + field.width / 2, field.y + field.height / 2))
    && document.documentElement.scrollWidth <= innerWidth;
})()`;
try {
  browser = await openPage("about:blank", { width: 320, height: 740 });
  const { page, evaluate, until } = browser;
  await page("Page.enable");
  await page("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('e2a2o.bricks', JSON.stringify({'intro-parts':false,countdown:true}));` });
  await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/` });
  const press = async key => {
    for (const type of ["keyDown", "keyUp"]) await page("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: key === "Enter" ? 13 : 27, ...(type === "keyDown" && key === "Enter" ? { text: "\r" } : {}) });
  };
  for (const width of [320, 390, 1440]) {
    await page("Emulation.setDeviceMetricsOverride", { width, height: 740, deviceScaleFactor: 1, mobile: false });
    assert.ok(await until(inputAndCardUsable, 10000), `${width}px: deadline and the actual thought input remain visible and reachable`);
    await evaluate(`document.querySelector('.countdown').style.fontSize='26px'`);
    assert.ok(await until(inputAndCardUsable, 10000), `${width}px: enlarged deadline leaves typing usable`);
    await evaluate(`document.querySelector('.countdown-card').focus()`);
    await press("Enter");
    assert.ok(await until(`!!document.querySelector('.countdown-editor')`), "Enter opens Deadlines");
    await press("Escape");
    assert.ok(await until(`!document.querySelector('.countdown-editor') && document.activeElement === document.querySelector('.countdown-card')`), "Escape closes Deadlines and restores focus");
    assert.ok(await until(inputAndCardUsable, 10000), "closing the editor leaves the thought input exposed");
    const { data } = await page("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(shots, `${width}.png`), Buffer.from(data, "base64"));
  }
  assert.ok(!core.heard.some(m => ["listen", "text", "sample", "import"].includes(m.type)), "layout and keyboard review send no microphone or content request");
  console.log(`PASS countdown-capture: 320/390/1440px, enlarged deadline, visible typing, Enter/Escape and focus return; ${shots}`);
} finally {
  await browser?.close();
  core.close();
}
