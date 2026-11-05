import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { uiServer } from './ui-server.mjs';
import { openPage } from './headless.mjs';

// Scoped Vite preview: loads only the lane component and synthetic references.
const server = await uiServer({ configFile: false, appType: 'spa' }, { port: 0 });
await server.listen();
const address = server.httpServer.address();
const url = `http://127.0.0.1:${address.port}/src/features/part-dimensions/preview.html`;
if (process.argv.includes('--preview')) {
  console.log(`Scoped synthetic preview: ${url}`);
  const close = async () => { await server.close(); process.exit(0); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
} else {
  let page;
  try {
    page = await openPage(url);
    const visible = expression => page.until(expression);
    const click = selector => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const text = `document.querySelector('.part-dimensions')?.textContent`;
    const expand = '.pd-tree[aria-label="UI contributors"] .pd-expand';
    const selected = '.pd-part[aria-pressed="true"]';
    const dimension = index => `.pd-dimensions button:nth-child(${index})`;
    assert.ok(await visible(`document.querySelector('#original-view') && !document.querySelector('.part-dimensions')`), 'off by default shows the original view');
    const original = await page.evaluate(`document.querySelector('#original-view').outerHTML`);
    await click('main > .pd-control input');
    assert.ok(await visible(`document.querySelectorAll('.pd-tree').length === 3`), 'selected step shows three named contributor hierarchies');
    assert.ok(await page.evaluate(`(() => { const steps=[...document.querySelectorAll('.pd-sequence li')].map(node=>node.getBoundingClientRect()); return steps.every((box,index)=>!index || box.left>steps[index-1].left); })()`), 'steps run left to right');
    await click('.pd-sequence li:nth-child(2) button');
    assert.ok(await visible(`document.querySelector('.pd-step h3')?.textContent==='Trace its contributors'`));
    await click(expand);
    assert.ok(await visible(`document.querySelector(${JSON.stringify(expand)})?.getAttribute('aria-expanded')==='true'`));
    await click('.pd-tree[aria-label="UI contributors"] [data-part-id="demo:selection"] .pd-part');
    assert.ok(await visible(`document.querySelectorAll('${selected}').length===2`), 'same ID and revision highlight in UI and functionality');
    assert.ok(await page.evaluate(`document.querySelectorAll('.pd-sequence [data-connected="true"]').length===3`), 'part connects to every referencing sequence step');
    await click(dimension(4));
    assert.ok(await visible(`document.querySelectorAll('.pd-tree').length===1 && document.querySelector('.pd-tree h3').textContent==='Data'`));
    await click('.pd-tree .pd-expand');
    assert.ok(await visible(`document.querySelector('${selected}')?.textContent.includes('demo:selection · v2')`), 'data view resolves the same canonical identity and revision');
    await click(dimension(2));
    assert.ok(await visible(`document.querySelector(${JSON.stringify(expand)})?.getAttribute('aria-expanded')==='true' && document.querySelector('${selected}')?.textContent.includes('demo:selection · v2')`), 'dimension return retains subtree and part selection');
    await click('.pd-sequence li:nth-child(1) button');
    await click('.pd-sequence li:nth-child(2) button');
    assert.ok(await visible(`document.querySelector(${JSON.stringify(expand)})?.getAttribute('aria-expanded')==='true'`), 'sequence return retains expansion');
    await click('main > .pd-control input');
    assert.ok(await visible(`!!document.querySelector('#original-view')`));
    assert.equal(await page.evaluate(`document.querySelector('#original-view').outerHTML`), original, 'off restores the original visible view unchanged');
    await click('main > .pd-control input');
    assert.ok(await visible(`document.querySelector('.pd-sequence [aria-current="step"] strong')?.textContent==='Trace its contributors' && !!document.querySelector('${selected}')`), 'switch return retains the visit');
    await click(dimension(1));
    await click('.part-dimensions header input');
    assert.ok(await visible(`!document.querySelector('.pd-guides')`), 'optional guide lines turn off');
    assert.ok(await page.evaluate(`${text}.includes('Presentation preview-1') && ${text}.includes('demo:selection · v2')`), 'presentation version stays distinct from source identity');
    await screenshot(page, 'desktop');
    await click('#changed-revision');
    assert.ok(await visible(`${text}.includes('Revision unavailable · requested v2, snapshot v5')`), 'changed source cannot silently substitute a revision');
    await click('#changed-revision');
    await click('#missing-part');
    assert.ok(await visible(`${text}.includes('Part unavailable in this snapshot')`), 'missing canonical reference is honest');
    await click('#missing-part');
    await click('#empty-sequence');
    assert.ok(await visible(`${text}.includes('No demo steps supplied.')`), 'empty input is visible');
    await click('#empty-sequence');
    await page.page('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    assert.ok(await visible(`document.documentElement.scrollWidth <= innerWidth`), '390px has no page overflow');
    await screenshot(page, 'phone');
    await page.page('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: false });
    assert.ok(await visible(`document.documentElement.scrollWidth <= innerWidth`), '320px has no page overflow');
    await page.evaluate(`document.documentElement.style.fontSize='200%'`);
    await screenshot(page, 'phone-enlarged-text');
    assert.ok(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`), 'enlarged text has no page overflow');
    await page.evaluate(`document.querySelector('.pd-dimensions button:nth-child(4)').focus()`);
    await page.page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await page.page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    assert.ok(await visible(`document.querySelectorAll('.pd-tree').length===1 && document.querySelector('.pd-tree h3').textContent==='Data'`), 'keyboard activates dimension control');
    await page.page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    assert.ok(await page.evaluate(`document.activeElement.matches('.pd-expand')`), 'keyboard moves into the contributor hierarchy');
    console.log('PASS part-dimensions: default off, three trees, sequence, canonical identity, cross-highlight, retained choices, guide toggle, revision/missing/empty states, keyboard, 320px/390px and enlarged text (synthetic scoped preview)');
  } finally { await page?.close(); await server.close(); }
}

async function screenshot(page, name) {
  if (!process.env.PART_DIMENSIONS_SCREEN_DIR) return;
  mkdirSync(process.env.PART_DIMENSIONS_SCREEN_DIR, { recursive: true });
  const { cssContentSize: size } = await page.page('Page.getLayoutMetrics');
  const capture = await page.page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 } });
  writeFileSync(resolve(process.env.PART_DIMENSIONS_SCREEN_DIR, `${name}.png`), Buffer.from(capture.data, 'base64'));
}
