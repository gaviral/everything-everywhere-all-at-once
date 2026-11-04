// Explicit live-service smoke test. Leaves its temporary browser profile and screenshots for inspection.
// Explicit live check on a temporary map: FILM_URL=http://localhost:4458 node scripts/film-chain-live.mjs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const base = process.env.FILM_URL;
assert(base, 'Set FILM_URL to the isolated live core explicitly');
const artifacts = mkdtempSync(join(tmpdir(), 'film-chain-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${artifacts}/profile`, '--no-first-run', '--no-default-browser-check', '--use-mock-keychain', '--password-store=basic', '--window-size=1920,1080', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let browser;
try {
  const address = await new Promise((resolve, reject) => {
    let log = ''; const timer = setTimeout(() => reject(new Error('Chrome did not start')), 15000);
    chrome.stderr.on('data', d => { log += d; const match = log.match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    chrome.once('exit', () => { clearTimeout(timer); reject(new Error('Chrome exited')); });
  });
  browser = new WebSocket(address); await new Promise(resolve => browser.addEventListener('open', resolve, { once: true }));
  let n = 0; const waiting = new Map();
  browser.onmessage = ({data}) => { const m = JSON.parse(data); if (m.id) { const item = waiting.get(m.id); waiting.delete(m.id); if (m.error) item?.reject(new Error(m.error.message)); else item?.resolve(m.result); } };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++n; waiting.set(id, {resolve, reject}); browser.send(JSON.stringify({ id, method, params, sessionId })); });
  const {targetId} = await send('Target.createTarget', {url:'about:blank'});
  const {sessionId} = await send('Target.attachToTarget', {targetId, flatten:true});
  const cdp = (m,p) => send(m,p,sessionId);
  const evaluate = async expression => { const r = await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const until = async (expression, timeout = 60000) => { const end = Date.now()+timeout; while(Date.now()<end) { if(await evaluate(`!!(${expression})`)) return; await new Promise(r=>setTimeout(r,100)); } throw new Error(`Timed out: ${expression}\n${await evaluate('document.body.innerText')}`); };
  const type = async (selector,text,enter=false) => { assert(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)); await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus();document.querySelector(${JSON.stringify(selector)}).select()`); await cdp('Input.insertText',{text}); if(enter) { await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13}); await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13}); } };
  const click = async selector => { assert(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); };

  const screenshot = async name => { const {data} = await cdp('Page.captureScreenshot',{format:'png'}); writeFileSync(join(artifacts,`${name}.png`),Buffer.from(data,'base64')); };
  await cdp('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:`${base}/?flow&rehearse`});
  await until(`!!document.querySelector('.flow-canvas-launch')`);
  await evaluate(`window.filmEvents=[]; window.filmSocket=new WebSocket(location.origin.replace('http','ws')+'/ws'); filmSocket.onmessage=e=>filmEvents.push(JSON.parse(e.data)); new Promise(r=>filmSocket.onopen=r)`);
  const say=async text=>evaluate(`filmSocket.send(JSON.stringify({type:'text',id:crypto.randomUUID(),text:${JSON.stringify(text)}}))`);
  await say('I want to invite my neighbor to help plant tomatoes at the community garden this Saturday at 10 for one hour. I am unsure what tone to use.');
  await until(`filmEvents.some(e=>e.type==='change'&&e.change.type==='thought_placed')`);
  await screenshot('01-captured');
  await evaluate(`window.flowStreams=[]; const nativeFetch=window.fetch; window.fetch=async (...args)=>{const response=await nativeFetch(...args);if(String(args[0]).includes('/flow/run')){const log={request:JSON.parse(args[1].body),events:[]};flowStreams.push(log);const reader=response.clone().body.getReader();void(async()=>{const decoder=new TextDecoder();let pending='';for(;;){const r=await reader.read();pending+=decoder.decode(r.value,{stream:!r.done});const lines=pending.split('\\n');pending=lines.pop()||'';for(const line of lines.filter(Boolean))log.events.push(JSON.parse(line));if(r.done)break;}})();}return response;};`);
  await say('Run that through three boxes: first ask me which tone I want before drafting the invitation, then point out what could go wrong, then write a short message.');
  await until(`document.querySelectorAll('.flow-canvas-box').length===3`);
  await until(`document.querySelector('.flow-canvas-running')`);
  // A real editable draft exercises the same hold rule as partial speech, without claiming a microphone take.
  await type('[data-guide="composer"] textarea', 'Still thinking about another topic');
  await say('Separately, I need to repair the bicycle before the weekend.');
  await until(`filmEvents.some(e=>e.type==='change'&&e.change.type==='thought_added'&&e.change.thought.text.includes('repair the bicycle'))`);
  await say('Where was I?');
  await until(`document.querySelector('.flow-canvas-status').textContent.includes('1 held')`);
  assert.equal(await evaluate(`!!document.querySelector('.flow-canvas-question')`),false,'the question waits while there is a draft');
  assert.equal(await evaluate(`document.querySelectorAll('.flow-canvas-box').length`),3,'a passing thought never edits the boxes');
  assert.equal(await evaluate(`!!document.querySelector('.flow-canvas-error')`),false,'talking during the run never errors');
  await screenshot('02-held'); console.log('PASS capture, concurrent tangent, and held question while busy');
  await type('[data-guide="composer"] textarea', '');
  await until(`!!document.querySelector('.flow-canvas-question')`);
  assert(await evaluate(`document.querySelector('.flow-canvas-question p').textContent.length>8`));
  await screenshot('03-question'); console.log('PASS real Spark question shown after the pause');
  await say('Warm, friendly and very casual.');
  await until(`document.querySelector('.flow-canvas-status').textContent.startsWith('Run complete')`,120000);
  await until(`filmEvents.some(e=>e.type==='change'&&e.change.type==='thought_added'&&e.change.thought.speaker==='Flow')`);
  const origin = await evaluate(`filmEvents.find(e=>e.type==='change'&&e.change.type==='thought_placed').change.thread_id`);
  const result = await evaluate(`filmEvents.find(e=>e.type==='change'&&e.change.type==='thought_added'&&e.change.thought.speaker==='Flow').change.thought`);
  assert.equal(result.thread_id,origin,'result returns to the original topic, not the bicycle tangent');
  assert(await evaluate(`flowStreams.every(s=>s.events.some(e=>e.done&&e.ms>0))`),'real service completed every streamed call');
  assert(await evaluate(`flowStreams.some(s=>s.events.some(e=>e.question))`),'the question came from Spark');
  await screenshot('04-returned');
  await say('Open the second box');
  await until(`!!document.querySelector('.flow-canvas-inspect')`);
  const before=await evaluate(`document.querySelector('.flow-canvas-inspect textarea').value`);
  await until(`!document.querySelector('.flow-canvas-mic').disabled`);
  await say('Make it kinder.');
  await until(`document.querySelector('.flow-canvas-inspect textarea').value!==${JSON.stringify(before)}`);
  await until(`document.querySelector('.flow-canvas-status').textContent.startsWith('Run complete')||!!document.querySelector('.flow-canvas-question')`,120000);
  // Editing uses the same original source; answer any newly needed question explicitly.
  if(await evaluate(`!!document.querySelector('.flow-canvas-question')`)) {await say('Warm and casual.');await until(`document.querySelector('.flow-canvas-status').textContent.startsWith('Run complete')`,120000);}
  await say('Send that to Phone');
  await until(`filmEvents.some(e=>e.type==='send_card'&&e.state==='counting')`);
  assert.equal(await evaluate(`filmEvents.filter(e=>e.type==='send_card').at(-1).live`),false,'real sending stays off');
  assert(await evaluate(`filmEvents.filter(e=>e.type==='send_card').at(-1).text === filmEvents.filter(e=>e.type==='change'&&e.change.type==='thought_added'&&e.change.thought.speaker==='Flow').at(-1).change.thought.text`), 'send card contains the exact final box result');
  assert(await evaluate(`(()=>{const button=document.querySelector('.send-card-stop'),r=button.getBoundingClientRect();return button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`), 'Stop is visibly reachable above Flow');
  await screenshot('05-send-card');
  await say('Stop');
  await until(`filmEvents.some(e=>e.type==='send_card'&&e.state==='stopped')`);
  assert.equal(await evaluate(`filmEvents.some(e=>e.type==='send_card'&&e.state==='sent')`),false,'Stop prevents sending');
  await cdp('Emulation.setDeviceMetricsOverride',{width:3840,height:2160,deviceScaleFactor:1,mobile:false});
  await until(`new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a>=1.9`);
  assert(await evaluate(`parseFloat(getComputedStyle(document.querySelector('.send-card-text')).fontSize)>=38`), 'send card has TV-sized text');
  await screenshot('06-tv');
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await screenshot('07-phone');
  assert(await evaluate(`document.querySelector('.flow-canvas').getBoundingClientRect().right <= innerWidth`));
  console.log('PASS live Spark: captured thought, explicit boxes, concurrent tangent, held question at pause, spoken answer, original-topic result, second-box edit, dry-run send card and spoken Stop.');
  console.log(`Artifacts: ${artifacts}`);
} finally {
  browser?.close();
  chrome.kill('SIGTERM');
  await new Promise(resolve => { if(chrome.exitCode !== null) resolve(); else chrome.once('exit',resolve); });
  chrome.stderr.destroy();
  chrome.unref();
}
