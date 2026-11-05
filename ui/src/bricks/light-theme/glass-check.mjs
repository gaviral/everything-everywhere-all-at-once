import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { standInCore, openPage, ready } from '../../../../scripts/headless.mjs';

if (ready()) throw Error(ready());
const screenshots = process.env.LIGHT_THEME_SHOTS || mkdtempSync(join(tmpdir(), 'e2a2o-glass-'));
mkdirSync(screenshots, { recursive: true });
const now = Date.now();
const threads = ['Example · A place for ideas', 'The first conversation', 'What we carry forward'].map((title, i) => ({
  id: `T${i}`, title, parent_id: i === 2 ? 'T0' : null, status: 'open', last_point: '',
  touched_ms: now, tags: [], picture: null, dropped_by: '',
}));
const lines = [
  ['T0', 'Mira', 'Start with a conversation. Give every good idea room to breathe.'],
  ['T1', 'Rowan', 'A quiet place to think together, with the important threads always in view.'],
  ['T0', 'Rowan', 'Let the conversation wander. We can keep the connections without losing the moment.'],
  ['T2', 'Mira', 'Keep the questions we want to come back to.'],
  ['T0', 'Mira', 'Then bring the next small step into focus.'],
];
const thoughts = lines.map(([thread_id, speaker, text], i) => ({
  id: `p${i}`, speaker, text, point: text, thread_id, placed: true, unclear: '', guess: '',
  heard: '', fixed: '', complete: true, at_ms: now - (lines.length - i) * 1000, place_ms: 3000, decided: false,
}));
const world = { threads, thoughts, active: 'T0', active_by: { Mira: 'T0', Rowan: 'T0' },
  suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [] };

const core = await standInCore(() => [{ type: 'snapshot', world }]);
let browser;
try {
  browser = await openPage(`http://127.0.0.1:${core.port}/?light&sample`, {
    width: 1920, height: 1080, preserveProfile: true,
  });
  const { evaluate, until, page } = browser;
  await page('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-color-scheme', value: 'light' },
    { name: 'prefers-reduced-transparency', value: 'no-preference' },
  ] });
  assert(await until('!!document.querySelector(".light-theme-switch") && !!document.querySelector(".spine-ready")', 15000));
  assert.equal(await evaluate('document.documentElement.dataset.lightTheme'), 'paper', 'new visits keep Warm paper');
  // Block capture at the browser API boundary; this check never starts a microphone.
  await evaluate(`navigator.mediaDevices.getUserMedia = () => { throw Error('Microphone forbidden in Glass check'); }`);
  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 't', code: 'KeyT', windowsVirtualKeyCode: 84 });
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 't', code: 'KeyT', windowsVirtualKeyCode: 84 });
  assert(await until('!!document.querySelector(".shell-turns")'));
  const geometry = () => evaluate(`['.shell-rail', '.shell-composer', '.spine-frame'].map(s => {
    const r = document.querySelector(s).getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
  })`);
  const before = await geometry();
  await evaluate(`Array.from(document.querySelectorAll('.light-theme-switch button')).find(e => e.textContent === 'Glass').click()`);
  assert(await until('document.documentElement.dataset.lightTheme === "glass"'));
  assert.deepEqual(await geometry(), before, 'Glass preserves chat, composer and canvas geometry');
  assert.equal(await evaluate(`document.querySelector('.light-theme-switch button[aria-pressed="true"]').textContent`), 'Glass');
  assert.match(await evaluate(`getComputedStyle(document.querySelector('.shell-rail')).backdropFilter`), /blur\(18px\)/);
  await page('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-color-scheme', value: 'dark' },
    { name: 'prefers-reduced-transparency', value: 'no-preference' },
  ] });
  assert.equal(await evaluate('getComputedStyle(document.documentElement).colorScheme'), 'light', 'Glass stays warm under a dark system preference');
  await evaluate('document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))');
  const { data } = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const png = Buffer.from(data, 'base64');
  assert.equal(png.readUInt32BE(16), 1920);
  assert.equal(png.readUInt32BE(20), 1080);
  writeFileSync(join(screenshots, 'glass.png'), png);
  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.shell-rail')).backdropFilter`), 'none', 'Reduce Transparency removes blur');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.shell-rail')).backgroundColor`), 'rgb(250, 245, 235)', 'Reduce Transparency uses opaque warm panels');
  await page('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-color-scheme', value: 'dark' },
    { name: 'prefers-reduced-transparency', value: 'no-preference' },
  ] });
  await page('Page.reload');
  assert(await until('document.documentElement.dataset.lightTheme === "glass" && !!document.querySelector(".spine-ready")', 15000), 'Glass choice persists');
  await evaluate(`localStorage.setItem('e2a2o.bricks', JSON.stringify({'light-theme': false}))`);
  await page('Page.navigate', { url: `http://127.0.0.1:${core.port}/?sample` });
  assert(await until('!!document.querySelector(".spine-ready") && !document.querySelector(".light-theme-switch")', 15000));
  assert.equal(await evaluate('document.documentElement.dataset.lightTheme'), undefined, 'feature off removes Glass');
  assert.equal(await evaluate('getComputedStyle(document.documentElement).colorScheme'), 'dark', 'feature off restores the default system theme');
  console.log('PASS Glass: selection, unchanged geometry, reduced transparency, persistence, default restoration; 1920×1080 screenshot saved.');
  console.log(`Screenshots saved to ${screenshots}.`);
} finally {
  await browser?.close();
  await core.close();
}
