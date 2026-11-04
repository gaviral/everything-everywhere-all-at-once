// Mounted UI, synthetic World, fresh browser profile and ephemeral loopback ports only.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { openPage, ready, standInCore } from "./headless.mjs";
if (ready()) { console.log(`SKIP i-instances-check: ${ready()}`); process.exit(3); }
const threads = ["Garden plans", `Synthetic topic ${"with a long name ".repeat(12)}`].map((title, i) => ({
  id: `synthetic-${i}-${"long-identifier-".repeat(8)}`, title, parent_id: null, summary: "", collapsed: false,
}));
const thoughts = threads.map((t, i) => ({ id: `point-${i}`, text: `Synthetic point ${i}`, point: `Synthetic point ${i}`,
  thread_id: t.id, placed: true, at_ms: i + 1, speaker: "you", complete: true }));
const world = { threads, thoughts, active: null, active_by: {}, suggestions: [], actions: [], merged: {},
  apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [] };
const core = await standInCore(() => [{ type: "snapshot", world }]);
let browser;
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
try {
  browser = await openPage("about:blank", { width: 1440, height: 1000 });
  await browser.page("Page.enable");
  await browser.page("Page.addScriptToEvaluateOnNewDocument", { source: 'localStorage.setItem("e2a2o.toured", "1")' });
  await browser.page("Page.navigate", { url: `http://127.0.0.1:${core.port}/?sample` });
  const ev = s => browser.evaluate(s);
  const click = async s => { await ev(`document.querySelector(${JSON.stringify(s)}).click()`); };
  const key = async (key, code, n, text) => {
    await browser.page("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: n, ...(text ? { text } : {}) });
    await browser.page("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: n });
  };
  const features = async () => {
    await ev('document.activeElement?.blur()');
    await key("c", "KeyC", 67);
    assert.ok(await browser.until('!!document.querySelector("[data-row=view-instances] [role=switch]")'), "Features opens");
  };
  const switcher = '[data-row="view-instances"] [role="switch"]';
  assert.ok(await browser.until('!!document.querySelector("[data-guide=composer] textarea")'));
  assert.equal(await ev('!!document.querySelector(".view-instances")'), false, "fresh profile default off");
  await features();
  assert.equal(await ev(`document.querySelector('${switcher}').getAttribute("aria-checked")`), "false");
  await click(switcher);
  assert.ok(await browser.until('!!document.querySelector(".view-instances-trigger")'));
  await key("Escape", "Escape", 27);
  await click('.view-instances-trigger');
  assert.ok(await browser.until('!!document.querySelector(".view-instances-panel")'));
  const baseline = core.heard.length;
  const newButton = '.view-instances-definition > .view-instances-actions button';
  await click(newButton); await click(newButton);
  assert.ok(await browser.until('document.querySelectorAll(".view-instances-reader").length === 2'));
  const ids = await ev('[...document.querySelectorAll(".view-instances-reader")].map(e => e.dataset.instance)');
  assert.equal(new Set(ids).size, 2);
  // Long ID fixture stays browser-local, exercising identity and actions without changing the definition.
  const fill = async (selector, value) => {
    await ev(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await browser.page("Input.insertText", { text: value });
  };
  for (let i = 0; i < 2; i++) {
    await ev(`(() => { const e = document.querySelectorAll('.view-instances-reader select')[${i}];
      e.value = ${JSON.stringify(threads[i].id)}; e.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await fill(`.view-instances-placement:nth-of-type(${i + 1}) textarea`, `Local draft ${i + 1}`);
  }
  await click('.view-instances-reader .view-instances-actions button:last-child');
  await ev('document.querySelector(".view-instances-definition input").focus(); document.querySelector(".view-instances-definition input").select()');
  const heading = `Shared heading ${"long words ".repeat(12)}`;
  await browser.page("Input.insertText", { text: heading });
  const values = () => ev(`[...document.querySelectorAll('.view-instances-reader')].map(e => ({
    heading:e.querySelector('h4').textContent, topic:e.querySelector('select').value,
    draft:e.querySelector('textarea').value, expanded:e.querySelector('[aria-expanded]').getAttribute('aria-expanded') }))`);
  const expected = threads.map((t, i) => ({ heading, topic: t.id, draft: `Local draft ${i + 1}`, expanded: i ? "true" : "false" }));
  assert.deepEqual(await values(), expected, "shared heading, independent data and fold");
  await click('.view-instances-reader .view-instances-actions button');
  assert.equal(await ev('document.activeElement.className'), 'view-instances-definition', "definition link focuses shared definition");
  await click('.view-instances-links li:nth-child(2) button');
  assert.equal(await ev('document.activeElement.dataset.instance'), ids[1], "instance link focuses placement");
  for (const width of [1440, 390]) {
    await browser.page("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await browser.page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await ev('document.querySelector(".view-instances-panel").scrollTop = 0');
    for (const zoom of [1, 2]) {
      await ev(`document.querySelector('.view-instances').style.fontSize = '${14 * zoom}px'`);
      assert.equal(await ev('document.querySelector(".view-instances-panel").scrollWidth <= document.querySelector(".view-instances-panel").clientWidth + 1'), true, `fits at ${width}, text ${zoom}x`);
    }
    await ev('document.querySelector(".view-instances").style.fontSize = "14px"');
    if (shots) writeFileSync(`${shots}/instances-${width}-definition.png`, Buffer.from((await browser.page("Page.captureScreenshot", { format: "png" })).data, 'base64'));
    await click('.view-instances-links li:nth-child(2) button');
    assert.equal(await ev(`(() => { const r = document.querySelectorAll('.view-instances-reader')[1];
      const label = r.querySelector('p').getBoundingClientRect(), actions = r.querySelector('.view-instances-actions').getBoundingClientRect();
      return actions.top >= label.bottom && actions.right <= innerWidth; })()`), true, "ID and action rows separated");
    if (shots) writeFileSync(`${shots}/instances-${width}-reader.png`, Buffer.from((await browser.page("Page.captureScreenshot", { format: "png" })).data, 'base64'));
  }
  await key("Escape", "Escape", 27);
  assert.equal(await ev('document.activeElement.className'), 'view-instances-trigger', "Escape returns focus");
  await click('.view-instances-trigger'); assert.deepEqual(await values(), expected, "reopen retains state");
  await key("Escape", "Escape", 27);
  await features(); await click(switcher);
  assert.ok(await browser.until('!document.querySelector(".view-instances")'), "off unmounts all editors");
  await click(switcher); await key("Escape", "Escape", 27); await click('.view-instances-trigger');
  assert.deepEqual(await values(), expected, "off/on leaves records alone");
  assert.deepEqual(core.heard.slice(baseline).filter(m => !['heartbeat', 'identify'].includes(m.type)), [], "no socket mutation");
  await browser.page('Page.reload');
  assert.ok(await browser.until('!!document.querySelector(".view-instances-trigger")'));
  await click('.view-instances-trigger');
  assert.equal(await ev('document.querySelectorAll(".view-instances-reader").length'), 0, "reload ends labelled draft lifetime");
  assert.match(await ev('document.querySelector(".view-instances-panel").textContent'), /until page reload/);
  await key("Escape", "Escape", 27); await features(); await click(switcher); await key("Escape", "Escape", 27);
  assert.ok(await browser.until('!document.querySelector(".view-instances") && !!document.querySelector("[data-guide=composer] textarea")'), "ordinary page restored");
  console.log('i-instances-check: ok (Features, two independent readers, shared heading, links, focus, retention, reload, 390px, no mutations)');
} finally { await browser?.close(); core.close(); }
