// One isolated, synthetic example; no model calls or microphone access.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { openPage, ready, standInCore } from './headless.mjs';

assert.equal(ready(), '', 'built UI and Chrome available');
const before = process.argv.includes('--before');
const now = 1800000000000;
const lines = [
  'Example · A little room to think',
  'Keep the original thought. Give the next idea room to arrive.',
  'A quiet sheet, warm ink, and a thread to follow.',
];
const world = {
  threads: [{ id: 'T1', title: 'A little room to think', parent_id: null, status: 'open', last_point: '', touched_ms: now, tags: [], picture: null, dropped_by: '' }],
  thoughts: lines.map((text, i) => ({ id: `p${i}`, thread_id: 'T1', speaker: 'you', text, point: text, complete: true, placed: true, at_ms: now + i * 1000, place_ms: 0 })),
  active: 'T1', active_by: { you: 'T1' }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, notes: {}, recaps: [], proposals: [], positions: {},
};
const core = await standInCore(() => [{ type: 'snapshot', world }]);
mkdirSync('docs/looks', { recursive: true });
let browser;

async function openExample(scheme) {
  browser = await openPage('about:blank', { width: 1920, height: 1080, preserveProfile: true });
  const { page, until } = browser;
  await page('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('e2a2o.toured','1');
    localStorage.setItem('e2a2o.install-hint','1');
    navigator.mediaDevices.getUserMedia=()=>{throw Error('Microphone forbidden')};
  ` });
  await page('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' },
  ] });
  await page('Page.navigate', { url: `http://127.0.0.1:${core.port}/?sample` });
  assert.ok(await until(`!!document.querySelector('.spine-ready [data-thought="p2"]')`), 'example thoughts appear');
  for (const type of ['keyDown', 'keyUp']) await page('Input.dispatchKeyEvent', { type, key: 't', code: 'KeyT', windowsVirtualKeyCode: 84 });
  assert.ok(await until(`!!document.querySelector('.shell-turns')`), 'chat appears');
  await browser.evaluate('document.fonts.ready');
}

async function capture(scheme) {
  await browser.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const suffix = before ? `-before${scheme === 'light' ? '-light' : ''}` : scheme === 'light' ? '-light' : '';
  writeFileSync(`docs/looks/look-restore${suffix}.png`, Buffer.from((await browser.page('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
}

async function checkWarmInk() {
  const colors = await browser.evaluate(`(() => {
    const rgb=(selector,property)=>getComputedStyle(document.querySelector(selector))[property].match(/[\\d.]+/g).slice(0,3).map(Number);
    return {sheet:rgb('body','backgroundColor'), ink:rgb('body','color'),
      chat:rgb('.shell-turn-text','color'), rail:rgb('.shell-rail','backgroundColor'),
      accent:rgb('.map-capture','borderLeftColor'), entry:rgb('.cc-map-entry','backgroundColor')};
  })()`);
  for (const [role, [r, g, b]] of Object.entries(colors)) assert.ok(r >= g && g >= b, `${role} is warm neutral or gold: ${r},${g},${b}`);
  const luminance = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  for (const [foreground, background] of [['ink','sheet'], ['chat','rail'], ['accent','sheet']]) {
    const fg = luminance(colors[foreground]), bg = luminance(colors[background]);
    assert.ok((Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05) >= 4.5, `${foreground} has readable contrast`);
  }
}

async function checkOtherLooks() {
  await browser.page('Page.navigate', { url: `http://127.0.0.1:${core.port}/?sample&light` });
  assert.ok(await browser.until(`document.documentElement.dataset.lightTheme==='paper'`), 'Warm paper is the default Look');
  for (const type of ['keyDown', 'keyUp']) await browser.page('Input.dispatchKeyEvent', { type, key: 't', code: 'KeyT', windowsVirtualKeyCode: 84 });
  assert.ok(await browser.until(`!!document.querySelector('.shell-turn-text')`), 'Warm paper chat appears');
  await checkWarmInk();
  for (const name of ['Cool studio', 'High contrast', 'Warm paper']) {
    await browser.evaluate(`[...document.querySelectorAll('.light-theme-switch button')].find(b=>b.textContent===${JSON.stringify(name)}).click()`);
    assert.ok(await browser.until(`document.querySelector('.light-theme-switch button[aria-pressed="true"]')?.textContent===${JSON.stringify(name)}`), `${name} remains selectable`);
  }
}

try {
  for (const scheme of ['dark', 'light']) {
    await openExample(scheme);
    if (!before) await checkWarmInk();
    await capture(scheme);
    if (!before && scheme === 'light') await checkOtherLooks();
    await browser.close(); browser = null;
  }
  console.log(before ? 'Captured before: dark and light at 1920×1080.' : 'PASS look-restore: visible example + chat, warm dark/light ink, contrast, Warm paper default, all light Looks; 1920×1080 captures.');
} finally { await browser?.close(); core.close(); }
