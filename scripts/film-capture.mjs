// Real-app film capture. No model fixtures, physical microphone, saved credentials or generated results.
// FILM_SPOKEN=1 captures spoken and spoken-build using only Chrome's file-backed fake audio device.
// FILM_VOICE_DIR selects the supplied WAV folder; defaults to ../voice/user beside FILM_OUT.
// FILM_OUT=/path/to/clips node scripts/film-capture.mjs captures all ten clips.
// Without FILM_URL, builds and starts a fresh scratch core on 4466; Keychain supplies its key in memory.
// Set FILM_KEYCHAIN_SERVICE and FILM_KEYCHAIN_ACCOUNT to the private Muse Keychain entry.
// FILM_CLIPS=repair,board captures just the two Crew additions. FILM_SKIP_BUILD=1 uses existing builds.
// Set FILM_URL only to use an already-running isolated core. FILM_REENCODE=1 uses retained frames only.
// Optional FILM_CLIPS=draw,draw-back and FILM_PROFILE=/scratch/profile resume a take.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync, existsSync, readFileSync, realpathSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const url = new URL(process.env.FILM_URL || 'http://127.0.0.1:4466');
assert(['localhost', '127.0.0.1'].includes(url.hostname), 'Use an isolated local core');
assert(!['4360', '4399'].includes(url.port), 'Reserved port');
const output = resolve(process.env.FILM_OUT || 'film-clips');
const spokenMode = process.env.FILM_SPOKEN === '1';
assert(!spokenMode || !process.env.FILM_PROFILE, 'Spoken mode requires a new isolated Chrome profile');
const profile = process.env.FILM_PROFILE || mkdtempSync(join(tmpdir(), 'film-chrome-'));
const take = join(output, 'takes', new Date().toISOString().replaceAll(':', '-'));
mkdirSync(take, { recursive: true });
const story = 'Saturday is our free repair night at the hall and Organizer wants a plan by tonight.';
const flags = '?film&bricks=quiet-screen,clarify,draw,crew';
const repairBrief = 'Repair Night needs three parts: Volunteer Shifts with a volunteer count; Bring List with tools, gloves and spare parts to tick plus packed progress; Flyer Words with our free repair night invitation and a note for the welcome team.';
const runFile = promisify(execFile);
let core, scratchData, latestCrewRun;
const keptPartIds = new Set();
async function startScratchCore() {
  if (process.env.FILM_URL) return;
  const repo = fileURLToPath(new URL('../', import.meta.url));
  if (process.env.FILM_SKIP_BUILD !== '1') {
    console.log('Building UI and core');
    await Promise.all([
      runFile('npm', ['run', 'build'], { cwd: join(repo, 'ui'), maxBuffer: 8e6 }),
      runFile('cargo', ['build', '--locked'], { cwd: join(repo, 'core'), maxBuffer: 8e6 }),
    ]);
  }
  try { await fetch(url, { signal: AbortSignal.timeout(1000) }); throw Error('Scratch port is already occupied'); }
  catch (error) { if (error.message === 'Scratch port is already occupied') throw error; }
  const data = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'film-map-')));
  scratchData = data;
  const service = process.env.FILM_KEYCHAIN_SERVICE, account = process.env.FILM_KEYCHAIN_ACCOUNT;
  assert(service && account, 'Set FILM_KEYCHAIN_SERVICE and FILM_KEYCHAIN_ACCOUNT to the Muse Keychain entry');
  let key;
  try { ({ stdout: key } = await runFile('security', ['find-generic-password', '-s', service, '-a', account, '-w'])); }
  catch { throw Error('The Muse key is unavailable in Keychain'); }
  core = spawn(join(repo, 'core/target/debug/e2a2o-core'), [], { cwd: join(repo, 'core'),
    env: { ...process.env, MODEL_API_KEY: key.trim(), PORT: url.port, E2A2O_CODE_CANVAS: '1', E2A2O_DATA: data, E2A2O_UI: join(repo, 'ui/dist') }, stdio: 'ignore' });
  key = undefined;
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (core.exitCode !== null) throw Error('Scratch core exited before becoming ready');
    try { if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* wait for readiness */ }
    await delay(100);
  }
  throw Error('Scratch core did not become ready');
}
async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await new Promise(done => child.once('exit', done));
}
let chrome;
let fakeAudioFile, voiceCapture, voiceEvents = [], websocketClockOffsetMs;
const launchChrome = () => spawn(process.env.FILM_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
  '--no-default-browser-check', '--use-mock-keychain', '--password-store=basic',
  '--disable-background-networking', '--disable-sync', '--window-size=1920,1080',
  // macOS denies the file-backed audio utility access to this scratch WAV inside its sandbox.
  // This exception applies only to the newly-created, local-only, fake-device capture profile.
  ...(spokenMode ? ['--no-sandbox', '--enable-automation', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-audio-track-processing', `--use-file-for-fake-audio-capture=${fakeAudioFile}%noloop`] : []), 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let socket, current, pointer = { x: 1420, y: 900 };
const pending = new Map(), listeners = new Map();
let nextId = 0, session;
const rows = new Map(), requests = new Map();
const activeClarify = new Set();
const note = (event, detail = {}) => current?.events.push({ ms: Date.now() - current.start, event, ...detail });

async function connect() {
  assert(!spokenMode || (fakeAudioFile && existsSync(fakeAudioFile)), 'A prepared fake audio file is required before Chrome starts');
  chrome = launchChrome();
  if (spokenMode) chrome.stderr.on('data', data => appendFileSync(join(take,'chrome.stderr.log'),data));
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
  if (spokenMode) {
    const { arguments: args } = await send('Browser.getBrowserCommandLine');
    assert(args.includes('--use-fake-device-for-media-stream') && args.includes('--use-fake-ui-for-media-stream') && args.includes(`--use-file-for-fake-audio-capture=${fakeAudioFile}%noloop`), 'Fake-only capture flags were not applied');
    await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `window.__filmMedia=[];const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async(...args)=>{const stream=await get(...args);window.__filmMedia.push({at:Date.now(),tracks:stream.getAudioTracks().map(t=>({label:t.label,settings:t.getSettings()}))});const c=new AudioContext(),source=c.createMediaStreamSource(stream),analyser=c.createAnalyser(),silent=c.createGain();silent.gain.value=0;source.connect(analyser);analyser.connect(silent);silent.connect(c.destination);window.__filmInputPeak=0;const data=new Float32Array(analyser.fftSize),timer=setInterval(()=>{analyser.getFloatTimeDomainData(data);for(const sample of data)window.__filmInputPeak=Math.max(window.__filmInputPeak,Math.abs(sample));},10);setTimeout(()=>{clearInterval(timer);c.close();},15000);return stream;};` });
  }
  await cdp('Browser.setPermission', { permission: { name: 'microphone' }, setting: spokenMode ? 'granted' : 'denied', origin: url.origin });
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
    if (path === '/clarify') activeClarify.add(requestId);
    if (path === '/crew/promote') {
      const body = JSON.parse(request.postData || '{}');
      if (body.to === 'main') {
        latestCrewRun = body.run;
        for (const part of body.keep || []) keptPartIds.add(part.id);
        note('parts-kept', { count: body.keep?.length || 0, ids: (body.keep || []).map(part => part.id) });
      }
    }
  }]);
  listeners.set('Network.loadingFinished', [({ requestId }) => activeClarify.delete(requestId)]);
  listeners.set('Network.loadingFailed', [({ requestId }) => activeClarify.delete(requestId)]);
  listeners.set('Network.responseReceived', [({ requestId, response }) => {
    const path = new URL(response.url).pathname;
    if (/^\/(clarify|draw|crew|flow)/.test(path)) note('response', { path, status: response.status, wait_ms: requests.has(requestId) ? Date.now() - requests.get(requestId) : null });
  }]);
  if (spokenMode) observeVoice();
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
  assert(await evaluate('navigator.permissions.query({name:"microphone"}).then(p=>p.state)') === (spokenMode ? 'granted' : 'denied'), 'Unexpected capture permission');
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
async function clearDraft() {
  await click('[data-guide="composer"] textarea');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, commands: ['selectAll'] });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4 });
  await until(`(()=>{const input=document.querySelector('[data-guide="composer"] textarea');return input.selectionStart === 0 && input.selectionEnd === input.value.length})()`);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await until('document.querySelector("[data-guide=composer] textarea").value === ""');
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
async function box(left, top, width, height, name, typedName = false) {
  const r = await evaluate('(()=>{const r=document.querySelector(".draw-page").getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()');
  const p = (x, y) => ({ x: r.x + x * r.w, y: r.y + y * r.h });
  const start = p(left, top); await move(start.x, start.y);
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...pointer, button: 'left', buttons: 1, clickCount: 1 });
  for (const [x, y] of [[left + width, top + .003], [left + width - .002, top + height], [left - .003, top + height - .002], [left, top]]) {
    const end = p(x, y); await move(end.x, end.y, 500 + Math.random() * 180, true);
  }
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...pointer, button: 'left', buttons: 0, clickCount: 1 });
  if (typedName) await type(name, '.draw-tools input', true);
  else await words(`This is ${name}`);
}
async function screenshot(path) {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path, Buffer.from(data, 'base64'));
}
function contentCheck(name, passed, evidence) {
  current.checks ??= [];
  current.checks.push({ name, passed, evidence });
  if (!passed) {
    current.limitations ??= [];
    current.limitations.push(`REAL: ${name}`);
    console.log(`REAL content check: ${name}`);
  }
}
async function checkNoSecondQuestion() {
  const end = Date.now() + 20000;
  let quietSince = Date.now(), appeared = false, questions = [];
  while (Date.now() < end) {
    const text = await evaluate('document.querySelector(".clarify-note")?.innerText || ""');
    if (text) { appeared = true; if (!questions.includes(text)) questions.push(text); }
    if (activeClarify.size) quietSince = Date.now();
    if (!activeClarify.size && Date.now() - quietSince >= 4000) break;
    await delay(150);
  }
  contentCheck('no second question after answering Organizer', !appeared && !activeClarify.size, { questions, pending: activeClarify.size });
}
async function checkDrawClearance() {
  await delay(700); // Let the visible sheet transition finish before measuring it.
  const bounds = await evaluate(`(()=>{const ink=document.querySelector('.draw-ink').getBoundingClientRect(),said=document.querySelector('.draw-said').getBoundingClientRect();return {inkBottom:ink.bottom,saidTop:said.top,saidBottom:said.bottom,height:innerHeight}})()`);
  contentCheck('Draw sentence stays below all ink', bounds.inkBottom <= bounds.saidTop + 1 && bounds.saidBottom <= bounds.height + 1, bounds);
}
async function checkCrewCounts() {
  const counts = await evaluate(`(()=>{const values=[...document.querySelectorAll('.crew-count dd')].map(x=>x.textContent);const foot=document.querySelector('.crew-foot').textContent;return {total:document.querySelectorAll('.crew-branch').length,merged:document.querySelectorAll('.crew-merged').length,shown:values[0],catalog:Number(foot.match(/next time: (\\d+)/)?.[1]),footer:foot}})()`);
  const kept = current.events.filter(event => event.event === 'parts-kept').at(-1);
  contentCheck('all merged parts are kept with the right count', counts.total === counts.merged && kept?.count === counts.total && counts.catalog === keptPartIds.size,
    { ...counts, keptThisRun: kept?.count, expectedCatalog: keptPartIds.size });
}
async function checkBoardFacts() {
  const text = await evaluate('document.querySelector(".crew-board").innerText');
  const unsupportedDays = text.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Sunday)\b/gi) || [];
  contentCheck('Crew keeps the supplied Saturday instead of inventing a day', unsupportedDays.length === 0, { unsupportedDays, boardText: text });
}
async function prepareSelectedClip(name) {
  if (name === 'ask' && !await evaluate('document.querySelectorAll("[data-thought]").length')) {
    await type(story);
    await until('document.querySelectorAll("[data-thought]").length > 0');
  }
  if (name === 'crew' && !await evaluate('JSON.parse(localStorage.getItem("e2a2o-draw-strokes") || "[]").length')) {
    if (!await evaluate('!!document.querySelector(".draw-page")')) await click('.draw-open');
    await box(.14, .26, .24, .18, 'volunteer shifts');
    await box(.57, .26, .24, .18, 'what to bring');
    await box(.35, .66, .24, .18, 'flyer words');
    await until('document.querySelectorAll(".draw-part").length >= 3', 120000);
  }
}
async function verifyClip(record) {
  const { stdout } = await runFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,avg_frame_rate', '-show_entries', 'format=duration', '-of', 'json', join(record.folder, `${record.name}.mp4`)]);
  const probe = JSON.parse(stdout), stream = probe.streams[0], seconds = Number(probe.format.duration);
  assert.deepEqual([stream.width, stream.height, stream.r_frame_rate, stream.avg_frame_rate], [1920, 1080, '30/1', '30/1']);
  const ordered = record.encoding.frame_order.map(index => record.frames[index]);
  assert(ordered.every((frame, index) => !index || frame.timestamp >= ordered[index - 1].timestamp));
  assert(ordered.every(frame => existsSync(join(record.folder, frame.file))));
  assert(Math.abs(seconds - record.duration_ms / 1000) < .2, 'Encoded timing drift');
  record.seconds = seconds;
  return { clip: record.name, seconds, width: 1920, height: 1080, fps: 30, raw_frames: ordered.length, capture_order_verified: true,
    ...(record.checks ? { checks: record.checks } : {}), ...(record.error ? { error: record.error } : {}),
    ...(record.observed ? { observed: record.observed } : {}), ...(record.limitations?.length ? { limitations: record.limitations } : {}) };
}
function saveVerification(verified) {
  const path = join(output, 'verification.json');
  const previous = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
  writeFileSync(path, JSON.stringify([...previous.filter(row => row.clip !== verified.clip), verified], null, 2) + '\n');
}
function observeVoice() {
  const sockets = new Set();
  listeners.set('Network.webSocketCreated', [event => { if (new URL(event.url).pathname === '/ws') sockets.add(event.requestId); }]);
  listeners.set('Network.webSocketWillSendHandshakeRequest', [event => {
    if (sockets.has(event.requestId)) websocketClockOffsetMs = (event.wallTime - event.timestamp) * 1000;
  }]);
  listeners.set('Network.webSocketFrameSent', [event => {
    if (!voiceCapture || !sockets.has(event.requestId)) return;
    if (event.response.opcode === 2) {
      const bytes = Buffer.from(event.response.payloadData, 'base64');
      const count = bytes.length / 2;
      appendFileSync(voiceCapture.pcm, bytes);
      voiceCapture.frames.push({ sample_start: voiceCapture.samples, sample_count: count,
        epoch_ms: websocketClockOffsetMs === undefined ? Date.now() : event.timestamp * 1000 + websocketClockOffsetMs });
      voiceCapture.samples += count;
      for(let i=0;i+1<bytes.length;i+=2)voiceCapture.peak=Math.max(voiceCapture.peak,Math.abs(bytes.readInt16LE(i)));
    } else {
      try { const value = JSON.parse(event.response.payloadData); if (value.type === 'listen') note('app-listen-control', { on: value.on }); } catch { /* unrelated frame */ }
    }
  }]);
  listeners.set('Network.webSocketFrameReceived', [event => {
    if (!sockets.has(event.requestId) || event.response.opcode !== 1) return;
    let value; try { value = JSON.parse(event.response.payloadData); } catch { return; }
    if (!['partial', 'change', 'status', 'error', 'notice', 'capture_saved'].includes(value.type)) return;
    if (value.type === 'change' && !['thought_added', 'thought_placed'].includes(value.change?.type)) return;
    const row = { epoch_ms: Date.now(), value };
    voiceEvents.push(row);
    if (voiceCapture) voiceCapture.events.push(row);
    if (value.type === 'partial') note('real-asr-partial', { text: value.text });
  }]);
}
function wavData(path) {
  const bytes = readFileSync(path);
  assert(bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE');
  for (let at = 12; at + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(at + 4);
    if (bytes.toString('ascii', at, at + 4) === 'data') return bytes.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size % 2);
  }
  throw Error('WAV data is missing');
}
function writePcmWav(path, data, rate = 48000) {
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
}
async function prepareVoiceFiles() {
  const directory = resolve(process.env.FILM_VOICE_DIR || join(dirname(output), 'voice/user'));
  const files = {};
  for (const name of ['thought', 'answer', 'build']) {
    const original = join(directory, `${name}.wav`), normalized = join(take, `${name}-48k.wav`), reference = join(take, `${name}-24k.pcm`);
    assert(existsSync(original), `Missing supplied voice file: ${name}.wav`);
    await runFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', original, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', '-y', normalized]);
    await runFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', original, '-ar', '24000', '-ac', '1', '-f', 's16le', '-y', reference]);
    files[name] = { original, normalized, reference, data: wavData(normalized) };
  }
  const silence = seconds => Buffer.alloc(Math.round(seconds * 48000) * 2);
  const conversation = join(take, 'conversation-fake-device.wav'), build = join(take, 'build-fake-device.wav');
  writePcmWav(conversation, Buffer.concat([silence(3), files.thought.data, silence(20), files.answer.data, silence(15)]));
  writePcmWav(build, Buffer.concat([silence(3), files.build.data, silence(18)]));
  return { files, conversation, build };
}
async function startFileVoice() {
  assert(spokenMode && fakeAudioFile && !process.env.FILM_PROFILE, 'File voice is confined to a fresh fake-device profile');
  const devices = await evaluate('navigator.mediaDevices.enumerateDevices().then(ds=>ds.filter(d=>d.kind==="audioinput").map(d=>({label:d.label,id:d.deviceId})))');
  assert(devices.length && devices.every(device => /fake/i.test(device.label)), 'Refusing capture: a non-fake audio input is present');
  voiceEvents = [];
  voiceCapture = { pcm: join(current.folder, 'sent-audio-24k.pcm'), samples: 0, peak:0, frames: [], events: [], devices, physical_microphone: false };
  writeFileSync(voiceCapture.pcm, Buffer.alloc(0));
  current.virtual_microphone = true;
  note('fake-device-verified', { devices });
  await click('.mic[data-guide="mic"]');
  await until('document.querySelector(".mic.on")', 15000);
  const media = await evaluate('window.__filmMedia');
  assert(media.length && media.every(call => call.tracks.every(track => /fake/i.test(track.label))), 'The app did not open the expected fake track');
  voiceCapture.media = media;
  note('file-capture-started', { file: basename(fakeAudioFile), media });
}
async function stopFileVoice() {
  if (await evaluate('!!document.querySelector(".mic.on")')) {
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'd', code: 'KeyD', modifiers: 4 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'd', code: 'KeyD', modifiers: 4 });
    await until('!document.querySelector(".mic.on")', 10000);
  }
  if (voiceCapture) { voiceCapture.input_peak=await evaluate('window.__filmInputPeak || 0');current.voice = voiceCapture; }
  voiceCapture = undefined;
}
const heardThoughts = () => voiceEvents.filter(event => event.value.type === 'change' && event.value.change.type === 'thought_added').map(event => event.value.change.thought);
async function waitVoice(predicate, what, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate()) return;
    const failure = voiceEvents.find(event => event.value.type === 'error');
    if (failure) throw Error(`Real voice path failed during ${what}: ${failure.value.message}`);
    await delay(150);
  }
  throw Error(`Real voice path timed out during ${what}; heard: ${heardThoughts().map(t=>t.text).join(' | ')}`);
}
function locateAudio(referenceBytes, capturedBytes) {
  const ref = new Int16Array(referenceBytes.buffer, referenceBytes.byteOffset, referenceBytes.length / 2);
  const pcm = new Int16Array(capturedBytes.buffer, capturedBytes.byteOffset, capturedBytes.length / 2);
  const envelope = samples => {
    const out = [];
    for (let at = 0; at + 240 <= samples.length; at += 240) { let sum = 0; for (let j = 0; j < 240; j++) sum += samples[at + j] ** 2; out.push(Math.sqrt(sum / 240)); }
    return out;
  };
  const r = envelope(ref), p = envelope(pcm);
  let best = -Infinity, offset = -1;
  for (let at = 0; at + r.length <= p.length; at++) {
    let cross = 0, a = 0, b = 0;
    for (let j = 0; j < r.length; j++) { cross += r[j] * p[at + j]; a += r[j] ** 2; b += p[at + j] ** 2; }
    const score = cross / (Math.sqrt(a * b) || 1);
    if (score > best) { best = score; offset = at * 240; }
  }
  assert(best > .7 && offset >= 0, `Supplied WAV not identifiable in the app's sent PCM (correlation ${best.toFixed(3)})`);
  const length = Math.min(12000, ref.length);
  let segment = 0, energy = -1;
  for (let at=0;at+length<=ref.length;at+=240) {
    let sum=0;for(let j=0;j<length;j+=2)sum+=ref[at+j]**2;
    if(sum>energy){energy=sum;segment=at;}
  }
  let refined=offset, waveform=-1;
  for(let shift=Math.max(0,offset-240);shift<=offset+240&&shift+segment+length<pcm.length;shift++) {
    let cross=0,a=0,b=0;
    for(let j=0;j<length;j+=2){const x=ref[segment+j],y=pcm[shift+segment+j];cross+=x*y;a+=x*x;b+=y*y;}
    const score=cross/(Math.sqrt(a*b)||1);if(score>waveform){waveform=score;refined=shift;}
  }
  return { sample_offset: waveform>.25?refined:offset, correlation: best, waveform_correlation:waveform, resolution_ms: waveform>.25?1000/24000:10 };
}
async function finishVoiceAudio(record, names, assets) {
  assert(record.voice?.frames.length, 'No audio PCM traversed the app WebSocket');
  const starts = record.voice.frames.map(frame => frame.epoch_ms - (frame.sample_start + frame.sample_count) / 24).sort((a,b)=>a-b);
  const origin = starts[Math.floor(starts.length / 2)] - record.start;
  const jitter = starts.map(start=>Math.abs(start-record.start-origin)).sort((a,b)=>a-b);
  const pcm = readFileSync(record.voice.pcm);
  record.audio = names.map(name => {
    const match = locateAudio(readFileSync(assets.files[name].reference), pcm);
    return { clip: record.name, wav: assets.files[name].original, offset_ms: origin + match.sample_offset / 24,
      duration_ms: assets.files[name].data.length / 96, ...match, method: 'correlated real outgoing PCM against supplied WAV; median WebSocket frame clock' };
  });
  record.audio_clock = { origin_ms: origin, median_frame_jitter_ms:jitter[Math.floor(jitter.length/2)], sample_rate:24000 };
  const silent = join(record.folder, 'silent.mp4'); copyFileSync(join(record.folder, `${record.name}.mp4`), silent);
  const args = ['-hide_banner', '-loglevel', 'error', '-i', silent];
  for (const audio of record.audio) args.push('-i', audio.wav);
  const filters = record.audio.map((audio,i)=>`[${i+1}:a]aresample=48000,adelay=${Math.max(0,Math.round(audio.offset_ms*48))}S:all=1[a${i}]`);
  filters.push(record.audio.map((_,i)=>`[a${i}]`).join('')+`amix=inputs=${record.audio.length}:normalize=0,apad[out]`);
  const muxed = join(record.folder, 'with-source-audio.mp4');
  args.push('-filter_complex', filters.join(';'), '-map','0:v','-map','[out]','-c:v','copy','-c:a','aac','-ar','48000','-ac','1','-t',String(record.seconds),'-y',muxed);
  await runFile('ffmpeg', args);
  copyFileSync(muxed, join(record.folder, `${record.name}.mp4`)); copyFileSync(muxed, join(output, `${record.name}.mp4`));
  writeFileSync(join(record.folder, 'timing.json'), JSON.stringify(record,null,2));
  writeFileSync(join(output, `${record.name}.json`), JSON.stringify(record,null,2));
}
async function closeBrowser() {
  socket?.close(); await stopProcess(chrome); chrome?.stderr.destroy(); chrome?.unref();
  socket = undefined; chrome = undefined; pending.clear(); listeners.clear(); voiceEvents = []; websocketClockOffsetMs = undefined;
}
async function spokenClips() {
  const assets = await prepareVoiceFiles();
  fakeAudioFile = assets.conversation; await connect();
  await capture('spoken', async () => {
    try {
      await startFileVoice();
      await waitVoice(()=>voiceEvents.some(e=>e.value.type==='partial' && e.value.text), 'live words');
      await waitVoice(()=>heardThoughts().length >= 1, 'first spoken thought');
      note('first-transcribed-thought', { text: heardThoughts()[0].text });
      contentCheck('words arrive live from Voice Transcribe', voiceEvents.filter(e=>e.value.type==='partial' && e.value.text).length > 1, { partials: voiceEvents.filter(e=>e.value.type==='partial' && e.value.text).map(e=>e.value.text) });
      await until('document.querySelector(".clarify-note")', 35000);
      const question = await evaluate('document.querySelector(".clarify-note").innerText');
      note('real-question-in-place', { question });
      contentCheck('Who is Organizer appears in place', question.includes('Who is Organizer?'), { question });
      await waitVoice(()=>heardThoughts().length >= 2, 'spoken answer');
      note('transcribed-answer', { text: heardThoughts()[1].text });
      await waitVoice(()=>voiceEvents.filter(e=>e.value.type==='change' && e.value.change.type==='thought_placed').length >= 2, 'answer placement');
      const normal = text => text.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
      contentCheck('spoken words match supplied thought and answer', normal(heardThoughts()[0].text) === normal(story) && normal(heardThoughts()[1].text) === normal('Organizer runs the volunteers'), heardThoughts().map(t=>t.text));
      await delay(2000);
    } finally { await stopFileVoice(); }
  }, 'person speaking through Chrome file capture, real Muse Voice Transcribe live words, Spark placement and question');
  try { await finishVoiceAudio(rows.get('spoken'), ['thought','answer'], assets); } catch(error) { rows.get('spoken').audio_error=error.message; console.log(`spoken audio: ${error.message}`); }
  await closeBrowser(); fakeAudioFile = assets.build; await connect();
  await click('.draw-open');
  await box(.14,.26,.24,.18,'volunteer shifts',true);
  await box(.57,.26,.24,.18,'what to bring',true);
  await box(.35,.66,.24,.18,'flyer words',true);
  await until('document.querySelectorAll(".draw-part").length >= 3',120000);
  await click('.draw-tools button:last-child');
  await capture('spoken-build', async () => {
    try {
      await startFileVoice();
      await click('.draw-open');
      await waitVoice(()=>heardThoughts().length >= 1, 'spoken build command');
      note('transcribed-build', { text: heardThoughts()[0].text });
      await until('document.querySelector(".crew-count")',60000);
      await until('document.querySelector(".crew-foot")?.textContent.includes("real commits")',180000);
      const transcript = heardThoughts()[0].text;
      contentCheck('spoken build WAV is transcribed verbatim', transcript.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim() === 'build all that', transcript);
      contentCheck('real spoken command starts Crew', await evaluate('!!document.querySelector(".crew-foot") && document.querySelectorAll(".crew-merged").length > 0'), { transcript, footer: await evaluate('document.querySelector(".crew-foot").textContent') });
      await delay(2000);
    } finally { await stopFileVoice(); }
  }, 'real sketch, supplied build voice through the app capture control and Muse Voice Transcribe, live Crew build');
  try { await finishVoiceAudio(rows.get('spoken-build'), ['build'], assets); } catch(error) { rows.get('spoken-build').audio_error=error.message; console.log(`spoken-build audio: ${error.message}`); }
  const record = rows.get('spoken');
  record.audio_manifest = [...(record.audio||[]),...(rows.get('spoken-build').audio||[])];
  for (const item of rows.values()) {
    writeFileSync(join(output,`${item.name}.json`),JSON.stringify(item,null,2));
    writeFileSync(join(item.folder,'timing.json'),JSON.stringify(item,null,2));
    const verified = await verifyClip(item);
    saveVerification({ ...verified, virtual_microphone: true, audio: item.audio || [], audio_error: item.audio_error || null });
  }
  writeReadme();
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
    const child = spawn(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(record.folder, 'frames.ffconcat'), '-vf', 'fps=30,scale=1920:1080', '-r','30','-fps_mode','cfr','-enc_time_base','1:30','-video_track_timescale','30000','-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', '-y', join(record.folder, `${record.name}.mp4`)], { stdio: ['ignore', 'ignore', 'pipe'] });
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
  // Keep capture clocks even when encoding or verification fails afterwards.
  writeFileSync(join(folder, 'timing.json'), JSON.stringify(record, null, 2));
  await encode(record);
  const verified = await verifyClip(record);
  writeFileSync(join(folder, 'timing.json'), JSON.stringify(record, null, 2));
  // The selected take is always this capture; failures remain explicit instead of silently selecting an older clip.
  copyFileSync(join(folder, `${name}.mp4`), join(output, `${name}.mp4`));
  copyFileSync(join(folder, 'timing.json'), join(output, `${name}.json`));
  saveVerification(verified);
  rows.set(name, record);
  writeReadme();
  console.log(`${name}: ${(record.duration_ms / 1000).toFixed(1)}s, ${record.frames.length} frames${record.error ? ', retained failed take' : ''}`);
}
function writeReadme() {
  const path = join(output, 'README.md');
  const previous = existsSync(path) ? readFileSync(path, 'utf8').split('\n') : ['# Community repair night — fictional example', '', '1920×1080, constant 30 fps. Live Muse services; scripted human-speed input, microphone denied, Quiet screen on. Raw frames and timestamps are in takes/.', ''];
  const updated = previous.filter(line => ![...rows.keys()].some(name => line.startsWith(`- ${name}:`)));
  const lastBullet = updated.findLastIndex(line => /^- /.test(line));
  const lines = [...rows].map(([name, record]) => `- ${name}: ${record.seconds.toFixed(1)} seconds; ${record.real}; ${record.error ? `FAILED take: ${record.error}` : record.limitations?.length ? record.limitations.join('; ') : 'real waits retained; shorten only editorially'}.`);
  updated.splice(lastBullet < 0 ? updated.length : lastBullet + 1, 0, ...lines);
  writeFileSync(path, updated.join('\n').replace('Eight silent clips', 'Silent clips') + '\n');
}
function writeRunSummary() {
  const path = join(output, 'README.md');
  const existing = readFileSync(path, 'utf8').split('\n').filter(line =>
    !line.startsWith('Observed app issues (unchanged):') && !line.startsWith('Selected take checks:') && !line.startsWith('Visible fix checks:'));
  const selected = JSON.parse(readFileSync(join(output, 'verification.json'), 'utf8'));
  const checks = selected.flatMap(record => (record.checks || []).map(check => ({ clip: record.clip, ...check })));
  const failed = checks.filter(check => !check.passed).map(check => `${check.clip}: ${check.name}`);
  const repairLabeled = selected.find(record => record.clip === 'repair')?.checks?.some(check => check.name === 'failed repairing label and fault disclosure stay visible' && check.passed);
  const repairStatus = repairLabeled ? 'Repair’s warm-red failure label and fault disclosure are verified during the run.' : 'Repair still lacks a verified visible failure label during the run.';
  existing.push('', `Selected take checks: ${checks.filter(check => check.passed).length}/${checks.length} visible-behavior checks passed.${failed.length ? ` Still wrong: ${failed.join('; ')}.` : ''} ${repairStatus}`, '');
  writeFileSync(path, existing.join('\n').replace('The latest take contains only repair and board; prior eight MP4s were retained.', 'The latest run selects freshly captured clips; all earlier raw takes remain available.'));
}

// These holds pause delivery of real responses, never change their contents or the UI.
let faultPart, holdFailure;
async function repairLabels() {
  return evaluate(`(()=>{
    const inspect=el=>{
      if(!el)return null;
      const r=el.getBoundingClientRect(),s=getComputedStyle(el),clippedBy=[];
      for(let parent=el.parentElement;parent;parent=parent.parentElement){
        const style=getComputedStyle(parent),box=parent.getBoundingClientRect();
        const clipsX=['hidden','clip','auto','scroll'].includes(style.overflowX);
        const clipsY=['hidden','clip','auto','scroll'].includes(style.overflowY);
        if((clipsX&&(r.left<box.left||r.right>box.right))||(clipsY&&(r.top<box.top||r.bottom>box.bottom)))clippedBy.push({tag:parent.tagName,bounds:{x:box.x,y:box.y,width:box.width,height:box.height}});
      }
      return {text:el.textContent,fill:s.fill,visible:r.width>0&&r.height>0&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&s.display!=='none'&&s.visibility!=='hidden'&&!clippedBy.length,clippedBy,bounds:{x:r.x,y:r.y,width:r.width,height:r.height}};
    };
    return {state:inspect(document.querySelector('.crew-fixing .crew-leaf-state')),disclosure:inspect(document.querySelector('.crew-foot'))};
  })()`);
}
function readableRepairLabels(labels) {
  const color = labels.state?.fill?.match(/[\d.]+/g)?.map(Number) || [];
  return labels.state?.visible && labels.state.text === 'failed · repairing'
    && color[0] > color[1] + 50 && color[1] > color[2]
    && labels.disclosure?.visible && labels.disclosure.text.includes('one fault added on purpose');
}
async function holdRepairResponse(event) {
  try {
    const request = JSON.parse(event.request.postData || '{}');
    const path = new URL(event.request.url).pathname;
    if (path === '/crew/build' && request.fault) {
      faultPart = request.part.id;
      const raw = await cdp('Fetch.getResponseBody', { requestId: event.requestId });
      const reply = JSON.parse(raw.base64Encoded ? Buffer.from(raw.body, 'base64').toString() : raw.body);
      note('real-fault-result', { part: faultPart, broke: reply.broke });
    }
    if (path === '/crew/build' && request.broke && request.part.id === faultPart) {
      await until('document.querySelector(".crew-fixing")', 10000);
      const before = await repairLabels();
      note('fixing-visible', { part: faultPart, hold_ms: 3500, labels: before });
      await screenshot(join(current.folder, 'fixing.png'));
      await delay(3500);
      const after = await repairLabels();
      contentCheck('failed repairing label and fault disclosure stay visible', !!readableRepairLabels(before) && !!readableRepairLabels(after), { before, after, hold_ms: 3500 });
    }
    if (path === '/crew/merge' && request.id === faultPart) {
      await until('[...document.querySelectorAll(".crew-trying")].some(x=>x.textContent.includes("fixed"))', 10000);
      note('repaired-visible', { part: faultPart, hold_ms: 3500 });
      await screenshot(join(current.folder, 'repaired.png'));
      await delay(3500);
    }
  } catch (error) { holdFailure = error; }
  finally { await cdp('Fetch.continueRequest', { requestId: event.requestId }); }
}
async function prepareRepair() {
  await navigate(`${flags}&crewfault`);
  await click('.crew-open');
  await type(repairBrief, '.crew-ask textarea', false);
  faultPart = undefined; holdFailure = undefined;
  listeners.set('Fetch.requestPaused', [event => { void holdRepairResponse(event); }]);
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*/crew/build', requestStage: 'Response' }, { urlPattern: '*/crew/merge', requestStage: 'Response' }] });
}
async function repair() {
  await click('.crew-ask button');
  await until('document.querySelector(".crew-foot")?.textContent.includes("real commits") && document.querySelectorAll(".crew-level-done").length === 2', 180000);
  await cdp('Fetch.disable');
  if (holdFailure) throw holdFailure;
  const observed = await evaluate(`({ tree: [...document.querySelectorAll('.crew-tree text')].map(x=>x.textContent).join(' '), footer: document.querySelector('.crew-foot').textContent, repaired: document.querySelector('.crew-count').textContent.includes('repaired'), off: document.querySelectorAll('.crew-off').length })`);
  assert(faultPart && observed.repaired && !observed.off, 'The real repair did not complete');
  assert(observed.footer.includes('one fault added on purpose'), 'Fault label must remain visible');
  assert(current.events.some(e => e.event === 'fixing-visible') && current.events.some(e => e.event === 'repaired-visible'));
  current.observed = observed;
  current.limitations = ['genuine repair/merge responses held 3.5s each for reading'];
  await checkCrewCounts();
  await checkBoardFacts();
  note('merged-visible', { part: faultPart });
  await delay(3500);
}
async function cardSelector(pattern) {
  const index = await evaluate(`Array.from(document.querySelectorAll('.crew-card')).findIndex(x => new RegExp(${JSON.stringify(pattern)}, 'i').test(x.querySelector('h3')?.textContent || ''))`);
  assert(index >= 0, `Missing board card: ${pattern}`);
  return `.crew-card:nth-child(${index + 1})`;
}
async function reveal(selector) {
  // Scroll with real wheel input; keep the fault disclosure/footer in the shot.
  for (let i = 0; i < 20; i++) {
    const rect = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();const p=document.querySelector('.crew-board').getBoundingClientRect();return {top:r.top,bottom:r.bottom,min:p.top+10,max:p.bottom-10,x:p.x+p.width/2,y:p.y+p.height/2}})()`);
    if (rect.top >= rect.min && rect.bottom <= rect.max) return;
    await move(rect.x, rect.y);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: rect.x, y: rect.y, deltaX: 0, deltaY: rect.bottom > rect.max ? 180 : -180 });
    await delay(150);
  }
  throw Error(`Board control is not reachable: ${selector}`);
}
async function board() {
  const bring = await cardSelector('bring|pack|suppl');
  const ticks = `${bring} .kit-list button`;
  assert(await evaluate(`document.querySelectorAll(${JSON.stringify(ticks)}).length`) >= 2, 'Bring List needs two items');
  for (let i = 1; i <= 2; i++) {
    const selector = `${bring} .kit-list li:nth-child(${i}) button`;
    await reveal(selector); await click(selector);
    await until(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-pressed') === 'true'`);
    note('bring-item-ticked', { item: i }); await delay(1000);
  }
  let counts = 0, answers = 0;
  const totalCounts = await evaluate('document.querySelectorAll(".crew-board .kit-count").length');
  for (let i = 0; i < totalCounts; i++) {
    const selector = `.crew-board .kit-count[data-film-control="count-${i}"]`;
    await evaluate(`document.querySelectorAll('.crew-board .kit-count')[${i}].dataset.filmControl='count-${i}'`);
    await reveal(selector);
    const before = await evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
    await click(selector); await until(`document.querySelector(${JSON.stringify(selector)}).textContent !== ${JSON.stringify(before)}`);
    counts++; note('board-count-changed'); await delay(800);
  }
  const notes = await evaluate('document.querySelectorAll(".crew-board .kit-note").length');
  for (let i = 0; i < notes; i++) {
    const selector = `.crew-board .kit-note[data-film-control="note-${i}"]`;
    await evaluate(`document.querySelectorAll('.crew-board .kit-note')[${i}].dataset.filmControl='note-${i}'`);
    await reveal(selector); await type('Welcome! Bring one broken item; our volunteers will help.', selector, false);
    answers++; note('board-answer-written');
  }
  current.observed = { checked: await evaluate(`document.querySelectorAll(${JSON.stringify(`${bring} .kit-list button[aria-pressed="true"]`)}).length`), counts, answers };
  assert(current.observed.checked === 2 && counts + answers > 0, 'Board did not visibly change');
  current.real = `finished live Repair Night board: two Bring List ticks, ${counts} counter changes and ${answers} editable answers`;
  await checkBoardFacts();
  await delay(2500);
}
async function prepareBoard() {
  if (await evaluate('!!document.querySelector(".crew-foot")')) return;
  await navigate(flags);
  await click('.crew-open');
  await type(repairBrief, '.crew-ask textarea', false);
  await click('.crew-ask button');
  await until('document.querySelector(".crew-foot")', 180000);
}
async function captureGitGraph() {
  assert(scratchData && latestCrewRun, 'A local completed Crew run is required for its real Git graph');
  const repository = join(dirname(scratchData), `${basename(scratchData)}-crew`, latestCrewRun);
  const args = ['log', '--graph', '--oneline', '--all'];
  const { stdout } = await runFile('git', args, { cwd: repository });
  const graph = stdout.trimEnd().split('\n').slice(0, 24).join('\n');
  assert(graph.includes('Promote dev to staging') && graph.includes('Promote staging to main'), 'The actual graph must show both promotions');
  writeFileSync(join(take, 'git-graph.txt'), graph + '\n');
  await cdp('Page.navigate', { url: 'about:blank' });
  await until('document.readyState === "complete"');
  const displayed = await evaluate(`(()=>{
    document.documentElement.style.cssText='background:#0c0e12;color:#eef0f5;';
    document.body.style.cssText='margin:0;width:1920px;height:1080px;display:flex;align-items:center;justify-content:center;overflow:hidden;';
    const pre=document.createElement('pre');pre.textContent=${JSON.stringify(graph)};
    pre.style.cssText='margin:0;white-space:pre;font:32px/1.18 Menlo,Monaco,monospace;';
    document.body.replaceChildren(pre);
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=getComputedStyle(pre).font;
    const widest=Math.max(...pre.textContent.split('\\n').map(line=>ctx.measureText(line).width));
    const font=Math.min(32,32*1780/widest,900/(pre.textContent.split('\\n').length*1.18));pre.style.fontSize=font+'px';
    return {text:pre.textContent,fontSize:font,width:innerWidth,height:innerHeight};
  })()`);
  assert(displayed.text === graph && displayed.width === 1920 && displayed.height === 1080);
  await screenshot(join(take, 'git-graph.png'));
  copyFileSync(join(take, 'git-graph.png'), join(output, 'git-graph.png'));
  copyFileSync(join(take, 'git-graph.txt'), join(output, 'git-graph.txt'));
  saveVerification({ clip: 'git-graph', kind: 'still', seconds: 2, width: 1920, height: 1080,
    command: ['git', ...args], run: latestCrewRun, lines: graph.split('\n').length, exact_text_verified: true, font_size: displayed.fontSize });
  const readme = join(output, 'README.md');
  const lines = readFileSync(readme, 'utf8').split('\n').filter(line => !line.startsWith('- git-graph:'));
  lines.splice(lines.findLastIndex(line => line.startsWith('- ')) + 1, 0, '- git-graph: 2.0-second still hold; exact first 24 available lines of the completed Crew repository’s git log --graph --oneline --all; no output rewritten.');
  writeFileSync(readme, lines.join('\n'));
  console.log(`git-graph: ${graph.split('\n').length} real lines, 1920x1080, 2-second hold`);
}
const clips = {
  think: [async () => {
    await type(story);
    await until('document.querySelectorAll(".react-flow__node").length > 0');
  }, 'real typed thought, live Spark placement'],
  ask: [async () => {
    await until('document.querySelector(".clarify-note")?.textContent.includes("Organizer")');
    assert(await evaluate('document.querySelector(".clarify-note p").textContent') === 'Who is Organizer?', 'Expected Who is Organizer?');
    note('question-visible'); await delay(2500);
    await type('Organizer runs the volunteers');
    await until('!document.querySelector(".clarify-note")');
    note('question-answered');
    await checkNoSecondQuestion();
  }, 'real Spark question, dotted underline and arrow; real saved answer'],
  draw: [async () => {
    await click('.draw-open');
    await until('document.querySelector(".draw-page")');
    await box(.14, .26, .24, .18, 'volunteer shifts');
    await box(.57, .26, .24, .18, 'what to bring');
    await box(.35, .66, .24, .18, 'flyer words');
    await until('document.querySelectorAll(".draw-part").length >= 3 && document.querySelector(".draw-said:not(.draw-looking)")', 120000);
    note('spark-marks-visible');
    await checkDrawClearance();
  }, 'real CDP pen strokes, film-only transcriber words, live Spark reading and teal marks'],
  'draw-back': [async () => {
    if (!await evaluate('!!document.querySelector(".draw-page")')) await click('.draw-open');
    await words('Draw it back');
    await until('document.querySelector(".draw-reply img")?.complete', 180000);
    note('muse-image-visible');
    await checkDrawClearance();
  }, 'live Muse Image drawing beside the original sketch'],
  crew: [async () => {
    if (!await evaluate('!!document.querySelector(".draw-page")')) await click('.draw-open');
    await words('Build all that');
    await until('document.querySelector(".crew-foot")', 180000);
    assert(await evaluate('document.querySelectorAll(".crew-off").length') === 0, 'Crew turned a part off');
    note('all-parts-on-main');
    contentCheck('Build all that alone hands the sketch to Crew', !await evaluate('!!document.querySelector(".draw-page")'), { command: 'Build all that' });
    await checkCrewCounts();
    await checkBoardFacts();
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
    await checkCrewCounts();
    await checkBoardFacts();
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
    await clearDraft();
    await until('document.querySelector(".flow-canvas-question")');
    note('held-question-shown');
  }, 'three real Flow boxes and a live Spark question held during a draft'],
  repair: [repair, 'real intentional fault, warm-red failed · repairing label, checked repair and merge; live Spark plan; fault disclosure visible during the run'],
  board: [board, 'finished live Repair Night board: two Bring List ticks, live counts and editable answers'],
};
if (process.env.FILM_REENCODE === '1') {
  // Rebuild selected clips from their retained raw frames, without opening Chrome.
  for (const name of (process.env.FILM_CLIPS || Object.keys(clips).join(',')).split(',')) {
    const record = JSON.parse(readFileSync(join(output, `${name}.json`), 'utf8'));
    await encode(record);
    const verified = await verifyClip(record);
    writeFileSync(join(record.folder, 'timing.json'), JSON.stringify(record, null, 2));
    copyFileSync(join(record.folder, `${name}.mp4`), join(output, `${name}.mp4`));
    copyFileSync(join(record.folder, 'timing.json'), join(output, `${name}.json`));
    saveVerification(verified);
    console.log(`Re-encoded ${name} in capture timestamp order`);
  }
} else try {
  await startScratchCore();
  if (spokenMode) {
    console.log(`File-voice capture ready; takes: ${take}`);
    await spokenClips();
  } else {
    await connect();
    console.log(`Capture profile ready; takes: ${take}`);
    for (const name of (process.env.FILM_CLIPS || Object.keys(clips).join(',')).split(',')) {
      assert(clips[name], `Unknown clip ${name}`);
      await prepareSelectedClip(name);
      if (name === 'repair') await prepareRepair();
      if (name === 'board') await prepareBoard();
      await capture(name, ...clips[name]);
    }
  }
  if (!spokenMode && scratchData && latestCrewRun && !process.env.FILM_CLIPS) await captureGitGraph();
  writeRunSummary();
  if ([...rows.values()].some(record => record.error || record.audio_error || record.checks?.some(check => !check.passed))) process.exitCode = 1;
} finally {
  socket?.close();
  await stopProcess(chrome);
  chrome?.stderr.destroy(); chrome?.unref();
  await stopProcess(core);
}
