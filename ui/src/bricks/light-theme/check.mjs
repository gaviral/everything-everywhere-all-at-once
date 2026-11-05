import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { standInCore, openPage, ready } from '../../../../scripts/headless.mjs';
import assert from 'node:assert/strict';

if (ready()) throw Error(ready());
const screenshots = process.env.LIGHT_THEME_SHOTS || mkdtempSync(join(tmpdir(), 'e2a2o-light-theme-'));
mkdirSync(screenshots, { recursive: true });
const now = Date.now();
const titles = ['The story we want to tell', 'A clearer first moment', 'What we will film'];
const threads = titles.map((title, i) => ({ id: `T${i}`, title, parent_id: null, status: 'open', last_point: '', touched_ms: now, tags: [], picture: null, dropped_by: '' }));
const thoughts = ['Start with a conversation, then show the map come alive.', 'Keep the important ideas visible as the discussion moves.', 'A warm, readable canvas makes the demo feel inviting.'].map((text, i) => ({ id: `p${i}`, speaker: 'you', text, point: text, thread_id: `T${i}`, placed: true, unclear: '', guess: '', heard: '', fixed: '', complete: true, at_ms: now, place_ms: 3000, decided: false }));
const world = { threads, thoughts, active: 'T0', active_by: { you: 'T0' }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [] };
const core = await standInCore(() => [{ type: 'snapshot', world }]);
let browser;
try {
  browser = await openPage(`http://127.0.0.1:${core.port}/?light&sample`, { width: 1920, height: 1080, preserveProfile: true });
  const { evaluate, until, page } = browser;
  const found = await until('!!document.querySelector(".light-theme-switch") && !!document.querySelector(".spine-ready")', 15000);
  assert(found, 'theme appears');
  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  for (const [id, name] of [['paper', 'Warm paper'], ['studio', 'Cool studio'], ['contrast', 'High contrast']]) {
    await evaluate(`Array.from(document.querySelectorAll('.light-theme-switch button')).find(e => e.textContent === ${JSON.stringify(name)}).click()`);
    assert(await until(`document.documentElement.dataset.lightTheme === ${JSON.stringify(id)}`));
    assert.equal(await evaluate(`document.querySelector('.light-theme-switch button[aria-pressed="true"]').textContent`), name);
    assert.equal(await evaluate(`getComputedStyle(document.documentElement).colorScheme`), 'light');
    await evaluate('document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))');
    const { data } = await page('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(screenshots, `${id}.png`), Buffer.from(data, 'base64'));
  }
  await evaluate(`localStorage.setItem('e2a2o.bricks', JSON.stringify({'light-theme': true}))`);
  await page('Page.navigate', { url: `http://127.0.0.1:${core.port}/?sample` });
  assert(await until('!!document.querySelector(".light-theme-switch")', 15000));
  await evaluate(`localStorage.setItem('e2a2o.bricks', JSON.stringify({'light-theme': false})); window.dispatchEvent(new StorageEvent('storage', { key: 'e2a2o.bricks' }))`);
  assert(await until('!document.querySelector(".light-theme-switch") && !document.documentElement.dataset.lightTheme'), 'switching off restores page');
  console.log(`Light theme: three looks, dark preference, and switch-off passed; screenshots saved to ${screenshots}.`);
} finally { await browser?.close(); await core.close(); }
