// Real shell, synthetic state. No microphone, provider, live app or account.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPage, ready, standInCore } from './headless.mjs';
import { empty } from './capture-fixture.mjs';
assert.equal(ready(), '', 'built UI and Chrome required');
const out = process.env.SHOTS || mkdtempSync(join(tmpdir(), 'learned-action-'));
const core = await standInCore(() => [{ type: 'snapshot', world: empty() }]);
let browser;
try {
 for (const width of [1440, 390, 320]) for (const scheme of ['light', 'dark']) {
  browser = await openPage('about:blank', { width, height: 900 });
  const { page, evaluate, until } = browser;
  await page('Page.enable');
  await page('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('e2a2o.features', JSON.stringify({'learned-action-labels':true}));localStorage.setItem('e2a2o.toured','1');localStorage.setItem('e2a2o.install-hint','1')" });
  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  const feature = '[data-guide="catalog"]';
  const word = `${feature} .learned-action-word`;
  const visible = selector => `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()`;
  const key = async (key, code, n, text) => { for (const type of ['keyDown', 'keyUp']) await page('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: n, ...(text && type === 'keyDown' ? { text } : {}) }); };
  const click = async selector => {
    const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    for (const type of ['mousePressed', 'mouseReleased']) await page('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
  };
  await page('Page.navigate', { url: `http://127.0.0.1:${core.port}/` });
  assert.ok(await until(`!!document.querySelector('#type-a-thought') && ${visible(word)}`), `${width} ${scheme}: fresh word is visible`);
  assert.ok(await evaluate(visible(`${feature} kbd`)), 'fresh C is visible');
  await evaluate("document.querySelector('#type-a-thought').focus()");
  await key('c', 'KeyC', 67, 'c');
  assert.ok(await until("document.querySelector('#type-a-thought').value==='c'"), 'C types in the composer');
  assert.ok(await evaluate(visible(word)), 'typing C does not learn the action');
  assert.equal(await evaluate("!!document.querySelector('.shell-catalog')"), false, 'typing does not open Features');
  await click(feature);
  assert.ok(await until("!!document.querySelector('.shell-catalog')"));
  assert.ok(await evaluate(visible(word)), 'mouse opening keeps the word');
  if (width === 390 && scheme === 'light') {
    const preference = '[data-row="learned-action-labels"] [role="switch"]';
    const toggle = async on => {
      assert.ok(await until(`!!document.querySelector('${preference}')`), 'learned controls has a Features switch');
      await evaluate(`document.querySelector('${preference}').scrollIntoView({block:'center',behavior:'instant'})`);
      await click(preference);
      assert.ok(await until(`document.querySelector('${preference}')?.getAttribute('aria-checked')==='${on}'`), 'the Features preference changes');
    };
    assert.equal(await evaluate(`document.querySelector('${preference}')?.getAttribute('aria-checked')`), 'true', 'learned controls explicitly enabled for this comparison');
    await toggle(false);
    await key('Escape', 'Escape', 27);assert.ok(await until("!document.querySelector('.shell-rail')"));
    await evaluate('document.activeElement?.blur()');await key('c', 'KeyC', 67);
    assert.ok(await until("!!document.querySelector('.shell-catalog')"), 'C still opens Features with learning off');
    assert.ok(await evaluate(visible(word)), 'off keeps the Features word');
    assert.ok(await evaluate(visible(`${feature} kbd`)), 'off keeps the visible shortcut');
    assert.equal(await evaluate("localStorage.getItem('e2a2o.learned-action.features')"), null, 'off records no new learning');
    await toggle(true);
    assert.ok(await evaluate(visible(word)), 'turning on alone does not claim the shortcut was learned');
  }
  await key('Escape', 'Escape', 27);assert.ok(await until("!document.querySelector('.shell-rail')"));
  await evaluate('document.activeElement?.blur()');
  await key('c', 'KeyC', 67);
  assert.ok(await until(`!!document.querySelector('.shell-catalog') && !document.querySelector(${JSON.stringify(word)})`), 'successful C opening learns the action');
  assert.ok(await evaluate(visible(`${feature} kbd`)), 'learned C stays visible');
  assert.equal(await evaluate(`document.querySelector('${feature}').getAttribute('aria-label')`), 'Features');
  await key('Escape', 'Escape', 27);assert.ok(await until("!document.querySelector('.shell-rail')"));
  assert.equal(await evaluate("document.querySelector('#type-a-thought').value"), 'c', 'learning and opening Features keep the exact unsent draft');
  await page('Page.reload');
  assert.ok(await until(`!!document.querySelector('${feature}') && !document.querySelector(${JSON.stringify(word)})`), 'learning survives reload');
  await evaluate(`document.querySelector('${feature}').focus()`);
  assert.ok(await until("document.querySelector('[role=tooltip]')?.textContent==='Turn features on or off. Press C for Features.'"), 'learned icon retains its useful tip');
  writeFileSync(join(out, `${width}-${scheme}-learned.png`), Buffer.from((await page('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await evaluate("localStorage.removeItem('e2a2o.learned-action.features')");await page('Page.reload');
  assert.ok(await until(visible(word)), 'fresh presentation can be restored');
  await evaluate("(()=>{const s=document.createElement('style');s.textContent='.learned-action-word{font-size:22px!important;line-height:26px!important}.learned-action kbd{font-size:22px!important;line-height:26px!important}';document.head.append(s)})()");
  assert.ok(await evaluate(visible(word)), '200% initial word stays in the viewport');
  assert.ok(await evaluate(visible(`${feature} kbd`)), '200% shortcut stays in the viewport');
  writeFileSync(join(out, `${width}-${scheme}-fresh-text200.png`), Buffer.from((await page('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await browser.close();browser = null;
  console.log(`PASS learned action ${width} ${scheme}: fresh, typing, mouse, C, reload, tip, 200% text, draft`);
 }
 assert.ok(!core.heard.some(m => ['text','listen'].includes(m.type)), 'learning never sends a thought or starts capture');
 console.log(`learned-action-check: evidence ${out}`);
} finally { await browser?.close();core.close(); }
