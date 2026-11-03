// Actual synthesized speech -> browser PCM capture -> core -> live ASR -> visible-card dismissal.
// Requires MODEL_API_KEY; unlike notices-page-check, this does not inject recognized words or server events.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ready, openPage, sleep } from './headless.mjs';
const why = ready() || (!process.env.MODEL_API_KEY ? 'MODEL_API_KEY is required for live speech recognition' : '');
if (why) { console.log(`SKIP notices-speech-page-check: ${why}`); process.exit(3); }
const target = '/private/tmp/e2a2o-r-notices-target';
const binary = join(target, 'debug/e2a2o-core');
execFileSync('cargo', ['build', '--manifest-path', 'core/Cargo.toml'], {
  cwd: new URL('../', import.meta.url), env: { ...process.env, CARGO_TARGET_DIR: target }, stdio: 'pipe',
});
assert.ok(existsSync(binary));
const temp = mkdtempSync(join(tmpdir(), 'notices-speech-'));
const port = Number(process.env.NOTICES_SPEECH_PORT ?? 4834);
const clips = ['Stop showing this.', 'Show those again.'].map((text, i) => {
  const input = join(temp, `${i}.txt`), aiff = join(temp, `${i}.aiff`), wav = join(temp, `${i}.wav`);
  writeFileSync(input, text);
  execFileSync('say', ['-v', 'Samantha', '-o', aiff, '-f', input]);
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@24000', '-c', '1', aiff, wav]);
  return readFileSync(wav).toString('base64');
});
const server = spawn(binary, [], { cwd: new URL('../core/', import.meta.url), stdio: 'ignore', env: {
  ...process.env, PORT: String(port), E2A2O_DATA: join(temp, 'data'), E2A2O_UI: resolve(new URL('../ui/dist', import.meta.url).pathname),
} });
const stopServer = () => { if (server.exitCode === null) server.kill('SIGTERM'); };
process.once('exit', stopServer);
let browser;
try {
  let up = false;
  for (let i = 0; i < 100 && !up; i++) { up = await fetch(`http://127.0.0.1:${port}/room`).then(r => r.ok).catch(() => false); if (!up) await sleep(100); }
  assert.ok(up, 'isolated core started');
  browser = await openPage('about:blank', { debugPort: port + 1 });
  const { page, evaluate, until } = browser;
  await page('Page.enable');
  await page('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('e2a2o.toured','1'); window.asrListening = null;
    const NativeSocket = WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(...args) { super(...args); this.addEventListener('message', e => {
        try { const m = JSON.parse(e.data); if (m.type === 'status') window.asrListening = m.listening; } catch {}
      }); }
    };
  ` });
  await page('Page.navigate', { url: `http://127.0.0.1:${port}/?shell=2` });
  assert.ok(await until(`!!document.querySelector('#type-a-thought')`));
  await evaluate(`document.querySelector('#type-a-thought').focus()`);
  await page('Input.insertText', { text: 'stop listening' });
  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  assert.ok(await until(`document.querySelector('.notice')?.textContent.includes('already off')`));
  for (const [i, clip] of clips.entries()) {
    await evaluate(`navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext({sampleRate:24000}), out = ctx.createMediaStreamDestination(), source = ctx.createBufferSource();
      source.buffer = await ctx.decodeAudioData(Uint8Array.from(atob(${JSON.stringify(clip)}), c=>c.charCodeAt(0)).buffer);
      source.connect(out); source.start(ctx.currentTime + 1); return out.stream;
    }`);
    await evaluate(`document.querySelector('button.mic').click()`);
    assert.ok(await until(`document.querySelector('button.mic')?.getAttribute('aria-pressed') === 'true'`), 'mic started');
    if (i === 0) {
      const at = await evaluate(`(()=>{const r=document.querySelector('.notice').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await page('Input.dispatchMouseEvent', { type:'mouseMoved', ...at });
      assert.ok(await until(`JSON.parse(localStorage.getItem('e2a2o.hiddenNotices')||'[]').includes('microphone') && !document.querySelector('.notice')`, 25000), 'recognized speech dismissed and silenced the visible kind');
    } else {
      assert.ok(await until(`localStorage.getItem('e2a2o.hiddenNotices') === '[]'`, 25000), 'recognized speech restored notices');
    }
    await evaluate(`document.querySelector('button.mic').click()`);
    assert.ok(await until(`document.querySelector('button.mic')?.getAttribute('aria-pressed') !== 'true'`));
    assert.ok(await until(`window.asrListening === false`, 6000), 'voice service finished the stream');
  }
  console.log('PASS live speech recognition through dismissal and restoration');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await Promise.race([new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve)), sleep(3000)]);
  if (server.exitCode === null) server.kill('SIGKILL');
  process.removeListener('exit', stopServer);
  rmSync(temp, { recursive: true, force: true });
}
