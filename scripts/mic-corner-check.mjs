// Isolated desktop/phone check: the browser's microphone is replaced by a refusal before navigation.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPage, ready, standInCore } from './headless.mjs';

assert.equal(ready(), '', 'build the UI and provide Chrome');
const shots = mkdtempSync(join(tmpdir(), 'mic-corner-'));
const example = () => ({
  threads: [{ id: 'garden', title: 'Balcony garden', parent_id: null, status: 'open', last_point: '', touched_ms: 1, tags: [], picture: null, dropped_by: '' }],
  thoughts: [{ id: 'herbs', thread_id: 'garden', speaker: 'you', text: 'Leave space for herbs', point: 'Leave space for herbs', placed: true, complete: true, at_ms: 1 }],
  active: 'garden', active_by: { you: 'garden' }, recaps: [], suggestions: [], actions: [], proposals: [], merged: {}, apps: [], apps_seeded: true, notes: {},
});

for (const [width, height] of [[1440, 900], [390, 844]]) {
  const core = await standInCore(() => [{ type: 'snapshot', world: example() }], {
    onMessage(message) {
      if (message.type === 'text') {
        core.send({ type: 'capture_saved', capture: { id: message.id, text: message.text, thought_ids: [] }, replay: false });
        core.send({ type: 'text_received', id: message.id });
      }
    },
  });
  let browser;
  try {
    browser = await openPage('about:blank', { width, height, preserveProfile: true });
    const { page, evaluate, until } = browser;
    await page('Page.enable');
    await page('Page.addScriptToEvaluateOnNewDocument', { source: `
      localStorage.setItem('e2a2o.toured', '1');
      window.micAttempts = 0;
      navigator.mediaDevices.getUserMedia = async () => {
        window.micAttempts++;
        throw new DOMException('Synthetic refusal; no device requested', 'NotAllowedError');
      };
    ` });
    await page('Page.navigate', { url: `http://127.0.0.1:${core.port}/` });
    assert.ok(await until(`!!document.querySelector('.spine-ready') && document.querySelector('.mic')?.dataset.state === 'off'`), 'example and inactive mic ready');
    const cleanComposer = async () => {
      assert.deepEqual(await evaluate(`(() => { const form = document.querySelector('[data-guide="composer"]'); return {
        mic: !!form.querySelector('.mic'), text: form.textContent.trim(), placeholder: form.querySelector('textarea').placeholder,
        status: !!document.querySelector('.shell-status-word'),
      }; })()`), { mic: false, text: '', placeholder: 'Type a thought', status: false });
    };
    const corner = async () => {
      const r = await evaluate(`(() => { const e = document.querySelector('.mic-corner .mic'), r = e.getBoundingClientRect(); return {
        count: document.querySelectorAll('button.mic').length, x: r.x, y: r.y, width: r.width, height: r.height,
        hit: e.contains(document.elementFromPoint(r.x+r.width/2, r.y+r.height/2)), shortcut: e.getAttribute('aria-keyshortcuts'),
      }; })()`);
      assert.equal(r.count, 1);
      assert.equal(r.width, 44); assert.equal(r.height, 44);
      assert.ok(r.x >= width - 70 && r.x + r.width <= width && r.y >= height - 70 && r.y + r.height <= height, 'small bottom-right control');
      assert.ok(r.hit, 'control is unobscured');
      assert.match(r.shortcut, /(?:Meta|Control)\+D/i);
      return { x: r.x + 22, y: r.y + 22 };
    };
    await cleanComposer();
    assert.equal(await evaluate('window.micAttempts'), 0);
    assert.equal(await evaluate(`!!document.querySelector('.mic-corner-note')`), false, 'no unsolicited refusal note');
    await corner();
    await evaluate(`document.querySelector('#type-a-thought').focus()`);
    await page('Input.insertText', { text: 'Water the herbs tomorrow' });
    for (const type of ['keyDown', 'keyUp']) await page('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    assert.ok(await until(`document.querySelector('#type-a-thought').value === ''`), 'Enter still adds');
    assert.equal(core.heard.filter(m => m.type === 'text' && m.text === 'Water the herbs tomorrow').length, 1, 'one typed thought sent');
    const at = await corner();
    for (const type of ['mousePressed', 'mouseReleased']) await page('Input.dispatchMouseEvent', { type, ...at, button: 'left', clickCount: 1 });
    assert.ok(await until(`document.querySelector('.mic')?.dataset.state === 'blocked' && !!document.querySelector('.mic-corner-note')`), 'intentional tap shows refusal beside mic');
    assert.match(await evaluate(`document.querySelector('.mic-corner-note').textContent`), /Microphone blocked/);
    assert.equal(await evaluate('window.micAttempts'), 1, 'only the refusal stub was called');
    await cleanComposer();
    await corner();
    const meta = await evaluate(`/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)`);
    for (const type of ['keyDown', 'keyUp']) await page('Input.dispatchKeyEvent', { type, key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68, modifiers: meta ? 4 : 2 });
    assert.ok(await until('window.micAttempts === 2'), 'existing keyboard shortcut reaches the same control');
    assert.ok(!core.heard.some(m => m.type === 'listen' && m.on), 'no capture started');
    await cleanComposer();
    writeFileSync(join(shots, `${width}.png`), Buffer.from((await page('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    // Classic mode keeps model progress available outside its text-only composer too.
    await page('Page.navigate', { url: `http://127.0.0.1:${core.port}/?shell=1` });
    assert.ok(await until(`!!document.querySelector('.composer textarea') && !document.querySelector('.mic')?.disabled`));
    core.send({ type: 'step', id: 1, step: 'placer', model: 'muse-spark-1.2', done: false, ok: false, ms: 0 });
    assert.ok(await until(`document.querySelector('.model-line')?.textContent.includes('Muse Spark 1.2')`), 'model progress remains visible');
    assert.equal(await evaluate(`!!document.querySelector('.composer .model-line, .composer .mic')`), false, 'progress and mic stay outside classic composer');
    await cleanComposer();
    await corner();
    console.log(`PASS mic corner ${width}×${height}: placement, text-only composers, Enter, refusal, shortcut, model progress; no device requested`);
  } finally { await browser?.close(); core.close(); }
}
console.log(`Screenshots: ${shots}; isolated browser profiles retained.`);
