// Built UI in Chrome, synthetic contacts only: shared email card, countdown, Esc/button Stop, dry run and Features.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { ready, standInCore, openPage } from "./headless.mjs";
async function waitFor(test) {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    if (test()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.fail("email page did not connect or acknowledge its switch");
}
const why = ready();
if (why) { console.log(`SKIP email-page-check: ${why}`); process.exit(3); }
const world = { threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [] };
let id = 0;
const card = (state = "counting") => ({ type: "send_card", id, channel: "email", to: "Recipient", subject: "the cut is ready", text: "Hi Recipient, the cut is ready.", state, in_ms: state === "counting" ? 8000 : 0, live: false, message: state === "dry_run" ? "Dry run: nothing sent. With EMAIL_SEND=on it would have gone to Recipient." : "" });
const core = await standInCore(() => [{ type: "snapshot", world }], {
  door: { room: false, member: true, email: true },
  onMessage: (message) => { if (message.type === "stop_send") core.send(card("stopped")); },
});
try {
  for (const width of [1440, 390]) {
    const browser = await openPage(`http://127.0.0.1:${core.port}/`, { width, height: width === 390 ? 844 : 900 });
    try {
      const { evaluate: run, until, page } = browser;
      const key = async (key, code, windowsVirtualKeyCode) => {
        await page("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode });
        await page("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
      };
      assert.ok(await until(`!!document.querySelector('.shell-composer')`));
      await waitFor(() => core.connected() > 0);
      id++; core.send(card());
      assert.ok(await until(`document.querySelector('.send-card-head')?.textContent === 'Email to Recipient · dry run'`));
      assert.deepEqual(await run(`[...document.querySelectorAll('.send-card-subject, .send-card-text')].map(e=>e.textContent)`), ["Subject: the cut is ready", "Hi Recipient, the cut is ready."]);
      assert.ok(await run(`document.querySelector('.send-card-status').textContent.startsWith('Sends in ') && document.querySelector('.send-card-stop').checkVisibility()`));
      assert.ok(await run(`(()=>{const r=document.querySelector('.send-card').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.bottom<=innerHeight})()`));
      assert.ok(await until(`Number(getComputedStyle(document.querySelector('.send-card')).opacity) >= .99`));
      writeFileSync(`/tmp/e2a2o-email-${width}.png`, Buffer.from((await page("Page.captureScreenshot", { format: "png" })).data, "base64"));
      await key("Escape", "Escape", 27);
      assert.ok(await until(`document.querySelector('.send-card')?.classList.contains('is-stopped')`));
      id++; core.send(card());
      assert.ok(await until(`!!document.querySelector('.send-card-stop')`));
      await run(`document.querySelector('.send-card-stop').click()`);
      assert.ok(await until(`document.querySelector('.send-card')?.classList.contains('is-stopped')`));
      id++; core.send(card());
      assert.ok(await until(`!!document.querySelector('.send-card-stop')`));
      core.send(card("dry_run"));
      assert.ok(await until(`document.querySelector('.send-card-status')?.textContent.includes('EMAIL_SEND=on')`));
      assert.ok(await run(`document.querySelector('.send-card').textContent.includes('Subject: the cut is ready')`));
      await run(`document.activeElement?.blur()`);
      await key("c", "KeyC", 67);
      assert.ok(await until(`!!document.querySelector('[data-row="email"] [role="switch"]')`));
      await run(`document.querySelector('[data-row="email"] [role="switch"]').click()`);
      assert.ok(await until(`document.querySelector('[data-row="email"] [role="switch"]').getAttribute('aria-checked') === 'false'`));
      await waitFor(() => core.heard.some((m) => m.type === "email" && m.on === false));
    } finally { await browser.close(); }
  }
} finally { core.close(); }
const demo = await standInCore(() => [{ type: "snapshot", world }]);
let browser;
try {
  browser = await openPage(`http://127.0.0.1:${demo.port}/`);
  assert.ok(await browser.until(`!!document.querySelector('.shell-composer')`));
  // Shell shortcuts apply outside a field; a fresh empty map focuses its composer.
  await browser.evaluate(`document.activeElement?.blur()`);
  await browser.page("Input.dispatchKeyEvent", { type: "keyDown", key: "c", code: "KeyC", windowsVirtualKeyCode: 67 });
  await browser.page("Input.dispatchKeyEvent", { type: "keyUp", key: "c", code: "KeyC", windowsVirtualKeyCode: 67 });
  assert.ok(await browser.until(`!!document.querySelector('.shell-catalog')`));
  assert.equal(await browser.evaluate(`!!document.querySelector('[data-row="email"]')`), false, "Demo's Features list is unchanged");
} finally { await browser?.close(); demo.close(); }
console.log("email-page-check: desktop/phone card, subject/body, countdown, Esc/button Stop, dry run, Features switch and Demo pass");
