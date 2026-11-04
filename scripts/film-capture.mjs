// Real-app film capture. No model fixtures, microphone, saved credentials or generated results.
// FILM_URL=http://127.0.0.1:4466 FILM_OUT=/path/to/clips node scripts/film-capture.mjs
// Optional FILM_CLIPS=draw,draw-back and FILM_PROFILE=/scratch/profile resume a take.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const url = new URL(process.env.FILM_URL || 'http://127.0.0.1:4466');
assert(['localhost', '127.0.0.1'].includes(url.hostname), 'Use an isolated local core');
assert(!['4360', '4399'].includes(url.port), 'Reserved port');
const output = resolve(process.env.FILM_OUT || 'film-clips');
const profile = process.env.FILM_PROFILE || mkdtempSync(join(tmpdir(), 'film-chrome-'));
const take = join(output, 'takes', new Date().toISOString().replaceAll(':', '-'));
mkdirSync(take, { recursive: true });
const story = 'Saturday is our free repair night at the hall and Mira wants a plan by tonight.';
const flags = '?film&bricks=quiet-screen,clarify,draw,crew';
let chrome;
const launchChrome = () => spawn(process.env.FILM_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
  '--no-default-browser-check', '--use-mock-keychain', '--password-store=basic',
  '--disable-background-networking', '--disable-sync', '--window-size=1920,1080', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let socket, current, pointer = { x: 1420, y: 900 };
const pending = new Map(), listeners = new Map();
let nextId = 0, session;
const rows = new Map(), requests = new Map();
const note = (event, detail = {}) => current?.events.push({ ms: Date.now() - current.start, event, ...detail });

async function connect() {
  chrome = launchChrome();
  const address = await new Promise((resolveAddress, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => reject(Error('Chrome startup timed out')), 15000);
    chrome.stderr.on('data', data => {
      buffer += data;
      const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timeout); resolveAddress(match[1]); }
    });
    chrome.once('exit', () => { clearTimeout(timeout); reject(Error('Chrome exited')); });
  });
  socket = new WebSocket(address);
  await new Promise(resolveOpen => socket.addEventListener('open', resolveOpen, { once: true }));
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const reply = pending.get(message.id); pending.delete(message.id);
      if (message.error) reply?.reject(Error(message.error.message)); else reply?.resolve(message.result);
    } else for (const listener of listeners.get(message.method) || []) listener(message.params);
  };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await send('Target.attachToTarget', { targetId, flatten: true }));
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  await cdp('Browser.setPermission', { permission: { name: 'microphone' }, setting: 'denied', origin: url.origin });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  listeners.set('Page.screencastFrame', [frame => {
    void cdp('Page.screencastFrameAck', { sessionId: frame.sessionId });
    if (!current) return;
    const file = `frame-${String(current.frames.length).padStart(6, '0')}.jpg`;
    writeFileSync(join(current.folder, file), Buffer.from(frame.data, 'base64'));
    current.frames.push({ file, timestamp: frame.metadata.timestamp, received_ms: Date.now() - current.start });
  }]);
  listeners.set('Network.requestWillBeSent', [({ requestId, request }) => {
    const path = new URL(request.url).pathname;
    if (/^\/(clarify|draw|crew|flow)/.test(path)) requests.set(requestId, Date.now());
  }]);
  listeners.set('Network.responseReceived', [({ requestId, response }) => {
    const path = new URL(response.url).pathname;
    if (/^\/(clarify|draw|crew|flow)/.test(path)) note('response', { path, status: response.status, wait_ms: requests.has(requestId) ? Date.now() - requests.get(requestId) : null });
  }]);
  await navigate(flags);
}
function send(method, params = {}, sessionId) {
  return new Promise((resolveReply, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve: resolveReply, reject });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
}
const cdp = (method, params = {}) => send(method, params, session);
async function evaluate(expression) {
  const response = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
}
async function until(expression, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await evaluate(`!!(${expression})`)) return; await delay(150); }
  throw Error(`Condition timed out: ${expression}`);
}
async function navigate(query) {
  await cdp('Page.navigate', { url: `${url.origin}/${query}` });
  await until('window.e2a2oFilm && document.querySelector("[data-guide=composer] textarea")');
  await evaluate(`window.e2a2oFilm.caption('Fictional example'); Object.assign(document.querySelector('.film-caption').style,{fontSize:'18px',top:'auto',bottom:'20px',left:'50%',padding:'8px 16px'})`);
  assert(await evaluate('document.documentElement.classList.contains("quiet-screen")'), 'Quiet screen must be on');
}
async function move(x, y, duration = 550, down = false) {
  const from = { ...pointer }, steps = Math.max(8, Math.ceil(duration / 20));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, ease = t * t * (3 - 2 * t), bend = Math.sin(t * Math.PI) * 13;
    pointer = { x: from.x + (x - from.x) * ease + bend, y: from.y + (y - from.y) * ease + Math.sin(t * Math.PI * 3) * 2 };
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...pointer, button: down ? 'left' : 'none', buttons: down ? 1 : 0 });
    await evaluate(`window.e2a2oFilm.cursor(${JSON.stringify({ ...pointer, press: down })})`);
    await delay(duration / steps);
  }
}
async function click(selector) {
  await until(`document.querySelector(${JSON.stringify(selector)})`);
  const box = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await move(box.x, box.y);
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...box, button: 'left', buttons: 1, clickCount: 1 });
  await delay(85);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...box, button: 'left', buttons: 0, clickCount: 1 });
  note('click', { selector });
}
async function type(text, selector = '[data-guide="composer"] textarea', submit = true) {
  await click(selector);
  for (const char of text) {
    await cdp('Input.insertText', { text: char });
    await delay(42 + Math.random() * 65 + (/[,.]/.test(char) ? 150 : 0));
  }
  note('typed', { text });
  if (submit) {
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  }
}
async function words(text) {
  const parts = text.split(' ');
  for (let i = 1; i <= parts.length; i++) {
    await evaluate(`window.e2a2oFilm.words(${JSON.stringify(parts.slice(0, i).join(' '))})`);
    await delay(230 + Math.random() * 120);
  }
  await delay(600);
  await evaluate('window.e2a2oFilm.words("")');
  note('spoken-input', { text, microphone: false });
}
async function box(left, top, width, height, name) {
  const r = await evaluate('(()=>{const r=document.querySelector(".draw-page").getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()');
  const p = (x, y) => ({ x: r.x + x * r.w, y: r.y + y * r.h });
  const start = p(left, top); await move(start.x, start.y);
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...pointer, button: 'left', buttons: 1, clickCount: 1 });
  for (const [x, y] of [[left + width, top + .003], [left + width - .002, top + height], [left - .003, top + height - .002], [left, top]]) {
    const end = p(x, y); await move(end.x, end.y, 500 + Math.random() * 180, true);
  }
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...pointer, button: 'left', buttons: 0, clickCount: 1 });
  await words(`This is ${name}`);
}
async function screenshot(path) {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path, Buffer.from(data, 'base64'));
}
async function encode(record) {
  assert(record.frames.length > 1, 'No screencast frames');
  const list = [];
  // Chrome can deliver screencast frames out of timestamp order. Keep the raw
  // delivery order in JSON, but present the actual capture timeline in the MP4.
  assert(record.frames.every(frame => Number.isFinite(frame.timestamp)), 'Missing capture timestamp');
  const frames = [...record.frames].sort((a, b) => a.timestamp - b.timestamp);
  record.encoding = { fps: 30, frame_order: frames.map(frame => record.frames.indexOf(frame)) };
  for (let i = 0; i < frames.length; i++) {
    list.push(`file '${frames[i].file}'`);
    const duration = i + 1 < frames.length ? frames[i + 1].timestamp - frames[i].timestamp : Math.max(1 / 30, record.duration_ms / 1000 - (frames[i].timestamp - frames[0].timestamp));
    list.push(`duration ${Math.max(1 / 1000, duration).toFixed(6)}`);
  }
  list.push(`file '${frames.at(-1).file}'`);
  writeFileSync(join(record.folder, 'frames.ffconcat'), list.join('\n'));
  await new Promise((resolveRun, reject) => {
    const child = spawn(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(record.folder, 'frames.ffconcat'), '-vf', 'fps=30,scale=1920:1080', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', '-y', join(record.folder, `${record.name}.mp4`)], { stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = ''; child.stderr.on('data', data => { errors += data; });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolveRun() : reject(Error(errors || `ffmpeg ${code}`)));
  });
}
async function capture(name, action, real) {
  const folder = join(take, name); mkdirSync(folder, { recursive: true });
  current = { name, folder, start: Date.now(), frames: [], events: [], real, microphone: false, fictional: true };
  console.log(`Recording ${name}`);
  await cdp('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  try { await delay(650); await action(); await delay(name === 'ask' ? 100 : 2000); }
  catch (error) { current.error = error.message; console.log(`${name}: ${error.message}`); }
  await screenshot(join(folder, 'end.png'));
  await cdp('Page.stopScreencast');
  const record = current; current = null;
  record.duration_ms = Date.now() - record.start;
  await encode(record);
  writeFileSync(join(folder, 'timing.json'), JSON.stringify(record, null, 2));
  if (!record.error) {
    copyFileSync(join(folder, `${name}.mp4`), join(output, `${name}.mp4`));
    copyFileSync(join(folder, 'timing.json'), join(output, `${name}.json`));
  }
  rows.set(name, record);
  writeReadme();
  console.log(`${name}: ${(record.duration_ms / 1000).toFixed(1)}s, ${record.frames.length} frames${record.error ? ', retained failed take' : ''}`);
}
function writeReadme() {
  const path = join(output, 'README.md');
  const previous = existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(line => /^- /.test(line)) : [];
  const updated = previous.filter(line => ![...rows.keys()].some(name => line.startsWith(`- ${name}:`)));
  for (const [name, record] of rows) updated.push(`- ${name}: ${(record.duration_ms / 1000).toFixed(1)} seconds; ${record.real}; ${record.error ? `FAILED take: ${record.error}` : 'real-time model waits retained; shorten pauses editorially if needed'}.`);
  writeFileSync(path, '# Community repair night — fictional example\n\n1920×1080, constant 30 fps. Real app and live Muse services; typed/spoken input is scripted, microphone denied. Raw timestamps and failed takes are in takes/.\n\n' + updated.join('\n') + '\n');
}
const clips = {
  think: [async () => {
    await type(story);
    await until('document.querySelectorAll(".react-flow__node").length > 0');
  }, 'real typed thought, live Spark placement'],
  ask: [async () => {
    await until('document.querySelector(".clarify-note")?.textContent.includes("Mira")');
    assert(await evaluate('document.querySelector(".clarify-note p").textContent') === 'Who is Mira?', 'Expected Who is Mira?');
    note('question-visible'); await delay(2500);
    await type('Mira runs the volunteers');
    await until('!document.querySelector(".clarify-note")');
    note('question-answered');
  }, 'real Spark question, dotted underline and arrow; real saved answer'],
  draw: [async () => {
    await click('.draw-open');
    await until('document.querySelector(".draw-page")');
    await box(.14, .26, .24, .18, 'volunteer shifts');
    await box(.57, .26, .24, .18, 'what to bring');
    await box(.35, .66, .24, .18, 'flyer words');
    await until('document.querySelectorAll(".draw-part").length >= 3 && document.querySelector(".draw-said:not(.draw-looking)")', 120000);
    note('spark-marks-visible');
  }, 'real CDP pen strokes, film-only transcriber words, live Spark reading and teal marks'],
  'draw-back': [async () => {
    if (!await evaluate('!!document.querySelector(".draw-page")')) await click('.draw-open');
    await words('Draw it back');
    await until('document.querySelector(".draw-reply img")?.complete', 180000);
    note('muse-image-visible');
  }, 'live Muse Image drawing beside the original sketch'],
  crew: [async () => {
    if (!await evaluate('!!document.querySelector(".draw-page")')) await click('.draw-open');
    await words('Build all that. Build it.');
    await until('document.querySelector(".crew-foot")', 180000);
    assert(await evaluate('document.querySelectorAll(".crew-off").length') === 0, 'Crew turned a part off');
    note('all-parts-on-main');
  }, 'real sketch handoff, Spark parts, checked Git branches and promotion to main'],
  'crew-more': [async () => {
    await navigate(flags);
    await click('.crew-open');
    await type('Keep the volunteer shifts, what to bring, and flyer words for our free repair night. Add a repair sign-up list, a tool checklist, a welcome desk checklist, and a closing cleanup checklist. Seven separate parts, reusing the first three.', '.crew-ask textarea', false);
    await click('.crew-ask button');
    await until('document.querySelector(".crew-foot")', 240000);
    assert(await evaluate('document.querySelectorAll(".crew-branch").length >= 6 && document.querySelectorAll(".crew-branch").length <= 8'), 'Expected 6–8 parts');
    assert(await evaluate('document.querySelector(".crew-tree").textContent.includes("reused")'), 'Expected visible reused label');
    assert(await evaluate('document.querySelectorAll(".crew-off").length') === 0, 'Crew turned a part off');
    note('reused-and-main');
  }, 'second live Spark run with persistent part reuse and a larger Git tree'],
  parts: [async () => {
    await navigate(`${flags}&parts`);
    await until('document.querySelector(".pd-sequence button")');
    for (let i = 1; i <= 3; i++) {
      await click(`.pd-sequence li:nth-child(${i}) button`);
      await until(`document.querySelector('.pd-sequence li:nth-child(${i}) button').getAttribute('aria-current') === 'step'`);
      await delay(1600);
    }
    assert(await evaluate('document.querySelector(".part-dimensions-example").dataset.look') === 'paper');
  }, 'real Parts view, Paper look, three visible steps and source references'],
  flow: [async () => {
    await navigate(`${flags}&flow`);
    if (await evaluate('!!document.querySelector(".crew-close")')) await click('.crew-close');
    await type('For our free repair night at the hall, make a short invitation. I have not decided who it should address.');
    await type('Run that through three boxes: first ask me who the invitation is for before writing anything, then list what visitors should bring, then draft the flyer.');
    await until('document.querySelectorAll(".flow-canvas-box").length === 3');
    await type('Still thinking about the audience', '[data-guide="composer"] textarea', false);
    await until('document.querySelector(".flow-canvas-status")?.textContent.includes("held")', 120000);
    note('real-question-held'); await delay(2000);
    await click('[data-guide="composer"] textarea');
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await until('document.querySelector(".flow-canvas-question")');
    note('held-question-shown');
  }, 'three real Flow boxes and a live Spark question held during a draft'],
};
if (process.env.FILM_REENCODE === '1') {
  // Rebuild selected clips from their retained raw frames, without opening Chrome.
  for (const name of (process.env.FILM_CLIPS || Object.keys(clips).join(',')).split(',')) {
    const record = JSON.parse(readFileSync(join(output, `${name}.json`), 'utf8'));
    await encode(record);
    writeFileSync(join(record.folder, 'timing.json'), JSON.stringify(record, null, 2));
    copyFileSync(join(record.folder, `${name}.mp4`), join(output, `${name}.mp4`));
    copyFileSync(join(record.folder, 'timing.json'), join(output, `${name}.json`));
    console.log(`Re-encoded ${name} in capture timestamp order`);
  }
} else try {
  await connect();
  console.log(`Capture profile ready; takes: ${take}`);
  for (const name of (process.env.FILM_CLIPS || Object.keys(clips).join(',')).split(',')) {
    assert(clips[name], `Unknown clip ${name}`);
    await capture(name, ...clips[name]);
  }
  if ([...rows.values()].some(record => record.error)) process.exitCode = 1;
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
  await new Promise(done => chrome.exitCode !== null ? done() : chrome.once('exit', done));
  chrome.stderr.destroy(); chrome.unref();
}
