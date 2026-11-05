// Synthetic same-turn memberships in the mounted production UI. No live core or account.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ready, standInCore, openPage, sleep } from './headless.mjs';

if (ready()) throw new Error(ready());
const shots = process.env.SHOTS || mkdtempSync(join(tmpdir(), 'e2a2o-topic-labels-'));
mkdirSync(shots, { recursive: true });
console.log(`turn-topic-labels evidence: ${shots}`);
const at = Date.UTC(2026, 10, 3, 12);
const draft = 'Keep this exact unsent draft: blue samples + rent?  ';
const longTitle = 'Try blue by the window before choosing the paint for the shared room — daylight and sunset comparison';
const report = [];
for (const long of [false, true]) {
  const titles = ['Paint the room', 'Rent', long ? longTitle : 'Try blue by the window'];
  const ids = ['room', 'rent', 'blue'];
  const threads = ids.map((id, i) => ({ id, title: titles[i], parent_id: null, status: 'open', last_point: '', touched_ms: at, tags: [], picture: null, dropped_by: '' }));
  const texts = ['Keep the room light.', 'Set aside the rent tonight.', 'Try blue by the window.'];
  const thoughts = ids.map((thread_id, i) => ({ id: `part-${thread_id}`, text: texts[i], point: texts[i], thread_id, speaker: 'you', at_ms: at, placed: true, complete: true, unclear: '', place_ms: 0 }));
  thoughts.push({ ...thoughts[0], id: 'next', speaker: 'Colleague', text: 'Compare the samples tomorrow.', point: 'Compare the samples tomorrow.', at_ms: at + 60000 });
  const world = { threads, thoughts, active: 'room', active_by: { you: 'room' }, stay_here: null, anchors: {}, notes: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], proposals: [], ai: [] };
  const originalWorld = JSON.stringify(world);
  const core = await standInCore(() => [{ type: 'snapshot', world }]);
  let browser;
  try {
    for (const width of [1440, 390]) {
      const phone = width === 390, height = phone ? 844 : 900;
      const name = `${phone ? 'phone' : 'desktop'}${long ? '-long' : ''}-conversation`;
      browser = await openPage('about:blank', { width, height });
      const { page, evaluate, until } = browser;
      await page('Page.enable');
      await page('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('e2a2o.toured','1');window.errors=[];addEventListener('error',e=>errors.push(e.message));` });
      await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: phone });
      await page('Emulation.setTouchEmulationEnabled', { enabled: phone });
      if (phone) await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await page('Page.navigate', { url: `http://127.0.0.1:${core.port}/` });
      assert.ok(await until(`!!document.querySelector('.spine-ready .spine-point')`, 10000), 'mounted built UI');
      await sleep(700);
      const key = async (key, code, n) => {
        for (const type of ['keyDown', 'keyUp']) await page('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: n, text: type === 'keyDown' && key === 'Enter' ? '\r' : undefined });
      };
      const click = async (selector, touch = false) => {
        const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        assert.ok(await evaluate(`!!document.elementFromPoint(${p.x},${p.y})?.closest(${JSON.stringify(selector)})`), `reachable ${selector}`);
        if (touch) {
          await page('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
          await page('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else for (const type of ['mousePressed', 'mouseReleased']) await page('Input.dispatchMouseEvent', { type, ...p, button: 'left', clickCount: 1 });
      };
      const geometry = () => evaluate(`JSON.stringify([...document.querySelectorAll('.react-flow__node')].map(e=>[e.dataset.id,e.style.transform,e.textContent]))`);
      const thoughtIds = () => evaluate(`Array.from(new Set([...document.querySelectorAll('[data-thought], [data-heads]')].flatMap(e=>[e.dataset.thought,...(e.dataset.heads||'').split(' ')]).filter(id=>${JSON.stringify(thoughts.map(t => t.id))}.includes(id)))).sort()`);
      const before = await geometry(), beforeIds = await thoughtIds();
      assert.deepEqual(beforeIds, thoughts.map(t => t.id).sort(), 'all original thought IDs mounted');
      assert.equal(await evaluate(`document.querySelectorAll('.spine-conversation-turn').length`), 0, 'Features default remains Off');
      await click('textarea[aria-label="Type a thought"]');
      await page('Input.insertText', { text: draft });
      await key('Escape', 'Escape', 27);
      await evaluate(`document.activeElement.blur()`);
      const setting = async () => {
        await key('c', 'KeyC', 67);
        assert.ok(await until(`!!document.querySelector('[data-row="conversation-spine"] button[role="switch"]')`), 'Features opens');
        await click('[data-row="conversation-spine"] button[role="switch"]');
        await key('Escape', 'Escape', 27);
        await sleep(700);
      };
      await setting();
      const turn = '[data-thought="part-room"]';
      assert.ok(await until(`document.querySelectorAll('${turn} .spine-turn-topics button').length===3`));
      const focusTurn = async () => {
        // Lens changes retain their anchor. Use the existing See all camera action before revisiting the turn.
        await key('0', 'Digit0', 48);
        await sleep(600);
        await evaluate(`document.querySelector('${turn} .spine-text').focus()`);
        await sleep(700);
      };
      await focusTurn();
      const metrics = await evaluate(`(()=>{const turn=document.querySelector('${turn}'),node=turn.closest('.react-flow__node'),nr=node.getBoundingClientRect();return [...turn.querySelectorAll('.spine-turn-topics button')].map(e=>{const r=e.getBoundingClientRect();const range=document.createRange();range.selectNodeContents(e);return {name:e.getAttribute('aria-label'),text:e.textContent,rect:r.toJSON(),textRects:[...range.getClientRects()].map(r=>r.toJSON()),client:e.clientHeight,scroll:e.scrollHeight,nodeBottom:nr.bottom,hit:!!document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.spine-turn-topics button')}})})()`);
      assert.deepEqual(metrics.map(m => m.name), titles.map(t => `Topic: ${t}`));
      for (const m of metrics) {
        assert.ok(m.rect.x >= 0 && m.rect.right <= width && m.rect.y >= 0 && m.rect.bottom <= height, `whole label: ${m.name}`);
        assert.ok(m.hit && m.scroll <= m.client, `no clipping or cover: ${m.name}`);
        assert.ok(m.rect.bottom <= m.nodeBottom + 1, 'canvas reserves shortcut height');
        assert.ok(m.textRects.every(r => r.left >= m.rect.left && r.right <= m.rect.right + 1 && r.top >= m.rect.top && r.bottom <= m.rect.bottom + 1), 'full text inside button');
      }
      assert.ok(await evaluate(`(()=>{const a=document.querySelector('${turn}').closest('.react-flow__node').getBoundingClientRect(),b=document.querySelector('[data-thought="next"]').closest('.react-flow__node').getBoundingClientRect();return a.bottom<b.top})()`), 'next turn clear of shortcuts');
      assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'), 'no sideways page overflow');
      // Natural Tab order reaches every named shortcut; preserve the existing visible focus ring.
      for (const title of titles) {
        await key('Tab', 'Tab', 9);
        assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`), `Topic: ${title}`);
        assert.ok(await evaluate(`document.activeElement.matches(':focus-visible') && getComputedStyle(document.activeElement).outlineStyle==='solid'`), 'visible keyboard focus');
      }
      const shot = async suffix => {
        const s = await page('Page.captureScreenshot', { format: 'png' });
        writeFileSync(`${shots}/${name}${suffix}.png`, Buffer.from(s.data, 'base64'));
      };
      await shot('');
      // Each shortcut visits its exact topic. Phone taps also exercise real touch input.
      for (const [i, id] of ids.entries()) {
        await click(`${turn} button[aria-label=${JSON.stringify(`Topic: ${titles[i]}`)}]`, phone);
        assert.ok(await until(`document.activeElement.closest('[data-id="t:${id}"]')!==null`), `correct ${id} destination`);
        assert.equal(await evaluate(`document.activeElement.querySelector('strong').textContent`), titles[i]);
        assert.equal(await evaluate(`document.querySelector('textarea[aria-label="Type a thought"]').value`), draft);
        await click('.spine-lenses button:first-child');
        await sleep(600); await focusTurn();
      }
      await key('Tab', 'Tab', 9); await key('Tab', 'Tab', 9);
      assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`), 'Topic: Rent');
      await key('Enter', 'Enter', 13);
      assert.ok(await until(`document.activeElement.closest('[data-id="t:rent"]')!==null`), 'keyboard visits Rent');
      await setting();
      assert.equal(await evaluate(`document.querySelector('textarea[aria-label="Type a thought"]').value`), draft, 'exact draft after Off');
      assert.equal(await geometry(), before, 'Off restores original view geometry and text');
      assert.deepEqual(await thoughtIds(), beforeIds, 'Off retains original thought IDs');
      assert.deepEqual(await evaluate('window.errors'), [], 'no browser errors');
      assert.equal(JSON.stringify(world), originalWorld, 'authoritative fixture unchanged');
      assert.ok(!core.heard.some(m => ['text', 'move', 'rename', 'delete', 'correct', 'unlink', 'stay', 'focus', 'sample', 'undo'].includes(m.type)), 'no thought or routing mutation messages');
      report.push({ name, width, height, touch: phone, reducedMotion: phone, labels: metrics, draftRetained: true, originalThoughtIds: beforeIds, offGeometryIdentical: true, destinations: ids, keyboardDestination: 'rent' });
      console.log(`PASS ${name}: full names, hit targets, focus, three destinations, keyboard Rent, exact draft, Off identity`);
      await browser.close(); browser = null;
    }
  } catch (error) {
    if (browser) {
      const s = await browser.page('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${shots}/failure.png`, Buffer.from(s.data, 'base64'));
    }
    throw error;
  } finally { await browser?.close(); core.close(); }
}
writeFileSync(`${shots}/results.json`, JSON.stringify(report, null, 2) + '\n');
