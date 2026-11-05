// Synthetic page acceptance: camera controls, source attribution, routing and shelf; no model or native service.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ready, standInCore, openPage } from './headless.mjs';

const unavailable = ready();
if (unavailable) { console.log(`SKIP spine-controls-check: ${unavailable}`); process.exit(3); }
const shots = process.env.SHOTS ?? mkdtempSync(join(tmpdir(), 'spine-controls-'));
mkdirSync(shots, { recursive: true });
const now = Date.now() - 180000;
const thread = (id, title, parent_id = null) => ({ id, title, parent_id, status: 'open', last_point: '', touched_ms: now, tags: [], picture: null, dropped_by: '' });
const thought = (id, thread_id, text, speaker = 'you') => ({ id, thread_id, speaker, text, point: text, placed: true, complete: true, at_ms: now, place_ms: null, unclear: '' });
const seed = () => ({ threads: [thread('T1', 'Balcony garden'), thread('T2', 'Electric bill and the date the late fee begins'), thread('T3', 'Call home'), thread('T4', 'Pot sizes', 'T1')],
  thoughts: [thought('a', 'T1', 'Basil needs morning sun'), thought('b', 'T1', 'Keep mint in a separate pot'), thought('c', 'T2', 'Check when the late fee begins'), thought('d', 'T2', 'Confirm the transfer date'), thought('e', 'T3', 'Ask about Sunday'), thought('f', 'T4', 'Choose a wide pot'), thought('g', 'T4', 'Leave space for roots')],
  active: 'T1', active_by: { you: 'T1' }, recaps: [], suggestions: [], actions: [], proposals: [], merged: {}, apps: [], apps_seeded: true, notes: {} });

for (const [width, height] of [[1440, 900], [390, 844], [320, 844]]) for (const scheme of ['light', 'dark']) {
  let world = seed(), browser;
  const core = await standInCore(() => [{ type: 'snapshot', world }], { onMessage(message) {
    if (message.type === 'stay') {
      world = { ...world, stay_here: message.thread_id };
      core.send({ type: 'change', change: { type: 'stay_changed', thread_id: message.thread_id } });
    }
  } });
  try {
    browser = await openPage('about:blank', { width, height });
    const { page, evaluate, until } = browser;
    await page('Page.enable');
    await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    // These acceptance cases exercise opted-in presentation features. Fresh defaults have their own check.
    await page('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('e2a2o.features', JSON.stringify({'quiet-solo-attribution':true,'placement-details':true,'stable-topic-titles':true,'phone-topic-overview':true}))` });
    await page('Page.navigate', { url: `http://127.0.0.1:${core.port}/` });
    assert.ok(await until(`!!document.querySelector('.spine-ready [data-thought="a"]')`, 10000), 'source map is ready');
    const key = async (key, code = key, windowsVirtualKeyCode) => {
      for (const type of ['keyDown', 'keyUp']) await page('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode });
    };
    const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const touch = async selector => {
      const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      assert.ok(point.x>0&&point.x<width&&point.y>0&&point.y<height, 'touch target is on screen');
      await page('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, radiusX: 1, radiusY: 1 }] });
      await page('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const presentation = async (id, on) => {
      await click('[data-guide="catalog"]');
      const control = `[data-row="${id}"] [role="switch"]`;
      assert.ok(await until(`!!document.querySelector(${JSON.stringify(control)})`), `${id} has its own switch`);
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(control)}).getAttribute('aria-checked')`), String(!on), `${id} changes from its current choice`);
      await click(control);
      assert.ok(await until(`document.querySelector(${JSON.stringify(control)}).getAttribute('aria-checked')===${JSON.stringify(String(on))}`), `${id} records its new choice`);
      await click('.shell-rail-close');
    };
    const shot = async name => writeFileSync(join(shots, `${width}-${scheme}-${name}.png`), Buffer.from((await page('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    assert.equal(await evaluate(`document.querySelectorAll('.spine-point > .spine-text > .spine-speaker, .spine-point > .spine-who-me').length`), 0, 'solo thoughts have one quiet dot');
    assert.ok(await evaluate(`document.querySelector('[data-thought="a"] .spine-text').getAttribute('aria-label').startsWith('you:')`), 'solo author remains accessible');
    await evaluate(`document.querySelector('#type-a-thought').focus()`);
    await page('Input.insertText', { text: 'Keep this draft unchanged' });
    const identity = await evaluate(`localStorage.getItem('e2a2o.last-map.you')`);
    assert.ok(identity, 'fixture has a real map identity');
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-zoom-stop]')].map(e=>e.textContent.replace(/[123]/g,'').trim())`), ['Words', 'Titles', 'Pictures']);
    assert.ok(await evaluate(`document.querySelector('[data-camera-follow]').textContent.includes('Following')`), 'follow state is explicit at every width');
    await click('[data-camera-follow]');
    assert.ok(await until(`document.querySelector('[data-camera-follow]').getAttribute('aria-pressed')==='false'`), 'auto-follow can be turned off');
    await click('[data-camera-follow]');
    assert.ok(await until(`document.querySelector('[data-camera-follow]').getAttribute('aria-pressed')==='true'`), 'auto-follow can be restored');
    const shelfCamera = await evaluate(`document.querySelector('.react-flow__viewport').style.transform`);
    await click('.spine-shelf-head');
    assert.ok(await until(`!!document.querySelector('.spine-shelf-empty')`), 'empty Shelf opens a useful explanation');
    assert.equal(await evaluate(`document.querySelector('.spine-shelf-empty strong').textContent`), 'Keep things at hand');
    assert.equal(await evaluate(`document.querySelector('.react-flow__viewport').style.transform`), shelfCamera, 'opening Shelf preserves the map camera');
    await shot('shelf');
    await key('Escape', 'Escape', 27);
    assert.ok(await until(`!document.querySelector('.spine-shelf-empty') && document.activeElement.matches('.spine-shelf-head')`), 'Escape closes Shelf and returns focus');
    await key('s', 'KeyS', 83);
    assert.ok(await until(`!!document.querySelector('.spine-shelf-empty')`), 'S opens the empty Shelf too');
    await click('.spine-shelf-close');
    if (width === 390 && scheme === 'light') {
      await presentation('quiet-solo-attribution', false);
      assert.ok(await until(`document.querySelector('[data-thought="a"] .spine-speaker')?.textContent==='you'`), 'quiet attribution OFF restores the visible author');
      await presentation('quiet-solo-attribution', true);
      assert.ok(await until(`!document.querySelector('[data-thought="a"] > .spine-text > .spine-speaker')`), 'quiet attribution ON restores the quiet point');
      const title = await evaluate(`document.querySelector('.spine-head[data-thread="T1"] .spine-title').textContent`);
      await presentation('stable-topic-titles', false);
      assert.ok(await until(`getComputedStyle(document.querySelector('.spine-head[data-thread="T1"] .spine-title')).backgroundColor==='rgba(0, 0, 0, 0)'`), 'readable titles OFF restores the ordinary title treatment');
      assert.equal(await evaluate(`document.querySelector('.spine-head[data-thread="T1"] .spine-title').textContent`), title, 'title presentation never changes the source name');
      await presentation('stable-topic-titles', true);
      assert.ok(await until(`getComputedStyle(document.querySelector('.spine-head[data-thread="T1"] .spine-title')).backgroundColor!=='rgba(0, 0, 0, 0)'`), 'readable titles ON restores the landmark');
    }
    await shot('read');
    await click('[data-zoom-stop="pictures"]');
    assert.ok(await until(`document.querySelector('.spine-frame').classList.contains('spine-stop-pictures')`), 'Overview is a real distant map mode');
    if (width < 600) {
      assert.ok(await until(`(()=>{const v=document.querySelector('.react-flow__viewport');return new DOMMatrix(getComputedStyle(v).transform).a>=0.379})()`), 'phone Overview preserves a readable landmark scale');
      assert.ok(await until(`(()=>{const label=document.querySelector('.react-flow__node[data-id="t:T3"] .spine-label');if(!label||label.textContent!=='Call home'||!label.checkVisibility())return false;const zoom=new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a;return parseFloat(getComputedStyle(label).fontSize)*zoom>=12.9})()`), 'one-thought topic keeps its real name at a readable size');
    }
    if (width < 600) assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-overview-thread]')].map(e=>e.dataset.overviewThread)`), ['T1','T2','T3','T4'], 'phone Overview keeps every topic and tangent readable');
    if (width === 390 && scheme === 'light') {
      await presentation('phone-topic-overview', false);
      assert.ok(await until(`!document.querySelector('.spine-overview-index')`), 'phone overview OFF removes its topic strip');
      assert.ok(await evaluate(`!!document.querySelector('[data-zoom-stop="words"]')`), 'the Read route remains available while the strip is off');
      await presentation('phone-topic-overview', true);
      assert.ok(await until(`document.querySelectorAll('[data-overview-thread]').length===4`), 'phone overview ON restores every real destination');
    }
    await shot('overview');
    if (width < 600) {
      await evaluate(`(()=>{const b=document.querySelector('[data-overview-thread="T4"]');b.parentElement.scrollLeft=b.offsetLeft})()`);
      await touch('[data-overview-thread="T4"]');
      assert.ok(await until(`!!document.querySelector('.spine-card[data-thread="T4"].spine-card-open') && document.querySelector('[data-zoom-stop="words"]').getAttribute('aria-pressed')==='true'`), 'a phone overview destination opens its exact tangent at reading size');
    }
    await click('[data-zoom-stop="words"]');
    assert.ok(await until(`document.querySelector('[data-zoom-stop="words"]').getAttribute('aria-pressed')==='true' && !!document.querySelector('[data-thought="a"] .spine-text')`), 'phone and desktop have a visible route back to Read');
    assert.ok(await until(`(()=>{const e=document.querySelector('[data-thought="b"] .spine-text');if(!e)return false;const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<document.querySelector('.dock').getBoundingClientRect().top})()`), 'Read restores the active source at a readable position');
    assert.equal(await evaluate(`document.querySelector('#type-a-thought').value`), 'Keep this draft unchanged', 'zoom preserves the exact draft');
    assert.equal(await evaluate(`localStorage.getItem('e2a2o.last-map.you')`), identity, 'zoom preserves map identity');
    await click('.spine-head[data-thread="T1"] .stay-here');
    assert.ok(await until(`!!document.querySelector('.spine-head[data-thread="T1"] .staying-here')`), 'routing is explicit and shared');
    assert.equal(await evaluate(`document.querySelector('.spine-head[data-thread="T1"] .staying-here span').textContent`), 'Staying here');
    await click('.spine-head[data-thread="T1"] .staying-here button');
    assert.ok(await until(`!document.querySelector('.staying-here')`), 'Stop releases routing');
    const fresh = { ...thought('new', null, 'Water the herbs on Friday'), placed: false };
    core.send({ type: 'change', change: { type: 'thought_added', thought: fresh } });
    core.send({ type: 'route', route: { stage: 'decided', thought_id: 'new', path: ['T1'], new: false, skipped: false, pick: { action: 'add', thread_id: 'T1' }, rule: null, why: 'Same garden', lane: 0, lanes: 1, ms: 1200, model: 'muse-spark-1.3' } });
    core.send({ type: 'change', change: { type: 'thought_placed', thought_id: 'new', thread_id: 'T1', point: fresh.text, complete: true, unclear: '', place_ms: 1200 } });
    assert.ok(await until(`!!document.querySelector('.spine-landing details')`), 'landing retains its confirmation and optional details');
    assert.deepEqual(await evaluate(`(()=>{const e=document.querySelector('.spine-landing');return [e.querySelector('span').textContent,e.querySelector('details').open]})()`), ['Placed here', false]);
    await click('.spine-landing summary');
    assert.ok(await evaluate(`document.querySelector('.spine-placement-details').open && document.querySelector('.spine-placement-details p').textContent==='Placement: 1.2 s · Model: Muse Spark 1.3'`), 'Details shows only the actual supplied model and placement time');
    assert.ok(await until(`(()=>{const r=document.querySelector('.spine-placement-details p').getBoundingClientRect();return r.left>=11&&r.right<=innerWidth-11})()`), 'placement Details stays wholly readable on a narrow screen');
    if (width === 390 && scheme === 'light') {
      await presentation('placement-details', false);
      assert.ok(await until(`!document.querySelector('.spine-placement-details') && document.querySelector('.spine-placement-inline')?.textContent==='Placement: 1.2 s · Model: Muse Spark 1.3'`), 'placement Details OFF shows the same actual metadata inline');
      assert.equal(await evaluate(`document.querySelector('.spine-landing > span').textContent`), 'Placed here', 'confirmation remains visible with Details off');
      await presentation('placement-details', true);
      assert.ok(await until(`!!document.querySelector('.spine-placement-details') && !document.querySelector('.spine-placement-inline')`), 'placement Details ON restores the optional disclosure');
      await click('.spine-placement-details summary');
    }
    await shot('details');
    await evaluate(`document.querySelector('.spine-placement-details summary').focus()`);
    await key('Escape', 'Escape', 27);
    assert.equal(await evaluate(`document.querySelector('.spine-placement-details').open`), false, 'Escape closes placement details');
    world = seed(); world.thoughts.push(thought('colleague', 'T1', 'I can bring the pots', 'Colleague'), thought('helper', 'T1', 'Keep roots away from standing water', 'Helper')); world.ai = ['Helper'];
    core.send({ type: 'snapshot', world });
    assert.ok(await until(`[...document.querySelectorAll('.spine-speaker')].some(e=>e.textContent==='Colleague')`), 'mixed-author names stay explicit');
    assert.ok(await evaluate(`[...document.querySelectorAll('.spine-speaker')].some(e=>e.textContent.includes('Helper')&&e.textContent.includes('AI helper'))`), 'AI helper keeps a readable origin');
    await shot('mixed');
    assert.equal(await evaluate(`document.querySelector('#type-a-thought').value`), 'Keep this draft unchanged', 'routing, Details and author changes preserve the exact draft');
    assert.equal(await evaluate(`localStorage.getItem('e2a2o.last-map.you')`), identity, 'all controls keep the original map identity');
    if (width === 320 && scheme === 'dark') {
      await click('[data-guide="catalog"]');
      assert.ok(await until(`!!document.querySelector('[data-row="conversation-spine"] [role="switch"]')`));
      await click('[data-row="conversation-spine"] [role="switch"]'); await click('.shell-rail-close');
      assert.ok(await until(`!!document.querySelector('.spine-conversation-turn')`), 'the existing conversation projection is enabled explicitly');
      await click('[data-zoom-stop="pictures"]');
      assert.ok(await until(`!!document.querySelector('[data-overview-thread="T1"]')`));
      await touch('[data-overview-thread="T1"]');
      assert.ok(await until(`(()=>{const e=document.querySelector('.react-flow__node[data-id="t:T1"] .spine-conversation-head');if(!e||e.querySelector('strong')?.textContent!=='Balcony garden')return false;const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<document.querySelector('.dock').getBoundingClientRect().top&&document.querySelector('[data-zoom-stop="words"]').getAttribute('aria-pressed')==='true'})()`), 'Overview also reveals the actual topic through the existing conversation lens');
      assert.equal(await evaluate(`document.querySelector('#type-a-thought').value`), 'Keep this draft unchanged', 'projection navigation preserves the draft');
      await shot('projection-read');
    }
    assert.ok(!core.heard.some(m => ['text', 'listen', 'sample', 'import'].includes(m.type)), 'no capture, microphone or import was triggered');
    assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth+1`), false, 'controls fit the narrow viewport');
    console.log(`spine-controls: ${width} ${scheme} passed`);
  } catch (error) {
    if (browser) writeFileSync(join(shots, `${width}-${scheme}-failure.png`), Buffer.from((await browser.page('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    throw error;
  } finally { await browser?.close(); core.close(); }
}
console.log(`spine-controls-check: passed; synthetic screenshots ${shots}`);
