// The requested UI pass, through rendered controls and a synthetic core. No microphone or model.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ready, openPage, standInCore } from './headless.mjs';

assert.equal(ready(), '', 'build the UI and provide Chrome');
const shots = mkdtempSync(join(tmpdir(), 'ux-fold-'));
const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#427c66"/></svg>');
const seed = () => ({
  threads: [{ id: 'T1', title: 'Balcony garden', parent_id: null, status: 'open', last_point: '', touched_ms: 1, tags: [], picture, dropped_by: '' }],
  thoughts: [1, 2].map(n => ({ id: `p${n}`, thread_id: 'T1', speaker: 'you', text: `Leave space for the herbs ${n}`, point: `Leave space for the herbs ${n}`, placed: true, complete: true, at_ms: n, place_ms: null })),
  active: 'T1', active_by: { you: 'T1' }, recaps: [], suggestions: [], actions: [], proposals: [], merged: {}, apps: [], apps_seeded: true, notes: {},
});

async function checkSize(width, height) {
  const world = seed();
  const core = await standInCore(() => [{ type: 'snapshot', world }], { onMessage(message) {
    if (message.type === 'stay') {
      world.stay_here = message.thread_id;
      core.send({ type: 'change', change: { type: 'stay_changed', thread_id: message.thread_id } });
    }
    if (message.type === 'text') {
      const thought = { id: 'typed', thread_id: null, text: message.text, point: '', speaker: 'you', placed: false, complete: true, at_ms: Date.now() };
      world.thoughts.push(thought);
      core.send({ type: 'change', change: { type: 'thought_added', thought } });
      core.send({ type: 'capture_saved', capture: { id: message.id, text: message.text, thought_ids: ['typed'] }, replay: false });
      core.send({ type: 'text_received', id: message.id });
    }
  } });
  let browser;
  try {
    browser = await openPage('about:blank', { width, height, preserveProfile: true });
    const { page, evaluate, until } = browser;
    const click = async selector => {
      const at = await evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      for (const type of ['mousePressed', 'mouseReleased']) await page('Input.dispatchMouseEvent', { type, ...at, button: 'left', clickCount: 1 });
    };
    const key = async (key, code, n) => {
      for (const type of ['keyDown', 'keyUp']) await page('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: n });
    };
    const visible = selector => evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e||!e.checkVisibility())return false;const r=e.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()`);
    await page('Page.enable');
    await page('Page.addScriptToEvaluateOnNewDocument', { source: `
      localStorage.setItem('e2a2o.toured','1'); window.captureRequests=0;
      navigator.mediaDevices.getUserMedia=()=>{window.captureRequests++;throw Error('Microphone forbidden')};
    ` });
    await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page('Page.navigate', { url: `http://127.0.0.1:${core.port}/` });
    assert.ok(await until(`!!document.querySelector('.spine-ready [data-thought="p2"]')`), 'example map ready');
    assert.ok(await visible('.shell-find-word'), 'Find has a visible word');
    assert.ok(await visible('.learned-action-word'), 'Features has a visible word');
    if (width > 560) assert.ok(await visible('.shell-fullscreen-word'), 'desktop Full screen has a visible word');
    assert.equal(await evaluate(`document.querySelector('.shell-fullscreen').getAttribute('aria-label')`), 'Full screen');
    for (const selector of ['.shell-find-word', '.learned-action-word', '.shell-fullscreen', '.cc-map-entry']) {
      assert.ok(await evaluate(`(() => {const e=document.querySelector('${selector}'),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!hit&&(e.contains(hit)||e.closest('label,button,a')?.contains(hit));})()`), `${selector} stays unobscured`);
    }
    assert.equal(await evaluate(`document.querySelector('.shell-mapname').textContent`), 'Your map');
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-zoom-stop]')].map(e=>e.firstChild.textContent)`), ['Words', 'Titles', 'Pictures']);
    assert.ok(await evaluate(`document.querySelector('[data-camera-follow]').textContent.startsWith('Following')`));
    assert.ok(await evaluate(`document.querySelector('[data-camera-fit]').textContent.startsWith('See all')`));
    assert.equal(await evaluate(`document.querySelectorAll('.spine-tile img').length`), 0, 'topic images start off');
    assert.ok(await evaluate(`!!document.querySelector('.spine-letter') && document.querySelector('.spine-title').textContent.includes('Balcony garden')`), 'title visuals remain');
    assert.equal(await evaluate(`document.querySelectorAll('.spine-point > .spine-text > .spine-speaker').length`), 0, 'no repeated solo author');
    assert.equal(await evaluate(`document.querySelector('.mic-corner .mic').getAttribute('aria-label')`), 'Start listening');
    assert.equal(await evaluate(`document.querySelector('.shell-composer .mic')`), null);
    await evaluate(`document.querySelector('#type-a-thought').focus()`);
    await page('Input.insertText', { text: 'Keep the garden draft' });
    await click('[data-guide="catalog"]');
    assert.ok(await until(`!!document.querySelector('[data-row="topic-images"] [role="switch"]')`));
    const attribution = '[data-row="quiet-solo-attribution"] [role="switch"]';
    assert.equal(await evaluate(`document.querySelector('${attribution}').getAttribute('aria-checked')`), 'false');
    await click(attribution);
    assert.ok(await until(`!document.querySelector('.spine-point > .spine-text > .spine-speaker')`), 'quiet solo attribution hides repeated labels when enabled');
    const images = '[data-row="topic-images"] [role="switch"]';
    assert.equal(await evaluate(`document.querySelector('${images}').getAttribute('aria-checked')`), 'false');
    await click(images);
    assert.ok(await until(`!!document.querySelector('.spine-tile img.spine-picture-shown')`), 'images can be deliberately enabled');
    await click(images);
    assert.ok(await until(`!document.querySelector('.spine-tile img')`), 'switch-off restores title visuals');
    await key('Escape', 'Escape', 27);
    assert.ok(await until(`!document.querySelector('.shell-rail') && document.activeElement?.id==='type-a-thought'`), 'closing Features restores the draft focus');
    await evaluate(`document.querySelector('[data-guide="catalog"]').focus()`);
    await key('c', 'KeyC', 67);
    assert.ok(await until(`!!document.querySelector('.shell-catalog')`));
    assert.ok(await visible('.learned-action-word'), 'shortcut use keeps Features labelled by default');
    // The focused Features tooltip owns its first Escape; use the visible panel close control.
    await click('.shell-rail .shell-rail-close');
    assert.ok(await until(`!document.querySelector('.shell-rail')`));
    await click('.spine-head .stay-here');
    assert.ok(await until(`document.querySelector('.staying-here span')?.textContent==='Staying here'`));
    await click('.staying-here button');
    assert.ok(await until(`document.querySelector('.stay-here')?.textContent==='Stay here'`));
    for (const stop of ['titles', 'pictures', 'words']) {
      await click(`[data-zoom-stop="${stop}"]`);
      assert.ok(await until(`document.querySelector('[data-zoom-stop="${stop}"]').getAttribute('aria-pressed')==='true'`), `${stop} is usable`);
    }
    assert.equal(await evaluate(`document.querySelector('#type-a-thought').value`), 'Keep the garden draft');
    // Native browser full screen, without replacing the app or discarding the draft.
    await page('Runtime.evaluate', { expression: `document.querySelector('.shell-fullscreen').click()`, userGesture: true });
    assert.ok(await until(`document.fullscreenElement===document.documentElement`), 'whole app enters real browser full screen');
    assert.equal(await evaluate(`document.querySelector('.shell-fullscreen-word').textContent`), 'Exit full screen');
    await page('Runtime.evaluate', { expression: `document.exitFullscreen()`, awaitPromise: true, userGesture: true });
    assert.ok(await until(`!document.fullscreenElement && document.querySelector('.shell-fullscreen').getAttribute('aria-pressed')==='false'`), 'browser exit restores control state');
    assert.equal(await evaluate(`document.querySelector('#type-a-thought').value`), 'Keep the garden draft');
    await evaluate(`document.querySelector('#type-a-thought').form.requestSubmit()`);
    assert.ok(await until(`!!document.querySelector('[data-capture][data-saved="true"]')`), 'typed words are saved in the shared capture area');
    assert.ok(await evaluate(`document.querySelector('[data-capture][data-saved="true"]').textContent.includes('Saved')`), 'plain Saved label');
    assert.equal(await evaluate('window.captureRequests'), 0);
    assert.ok(!core.heard.some(m => m.type === 'listen'), 'no microphone action');
    writeFileSync(join(shots, `${width}.png`), Buffer.from((await page('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    console.log(`PASS ux-fold ${width}×${height}: labels, image defaults, routing, zoom, native full screen, saved typing`);
  } catch (error) {
    if (browser) {
      console.error(await browser.evaluate(`({active:document.activeElement?.outerHTML,rail:!!document.querySelector('.shell-rail'),query:document.querySelector('.shell-find input')?.value})`));
      writeFileSync(join(shots, `${width}-failure.png`), Buffer.from((await browser.page('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      console.error(`Failure screenshot: ${shots}/${width}-failure.png`);
    }
    throw error;
  } finally { await browser?.close(); core.close(); }
}

for (const [width, height] of [[1440, 900], [390, 844], [320, 844], [3840, 2160]]) await checkSize(width, height);
console.log(`Screenshots: ${shots}; browser profiles retained for reversible cleanup.`);
