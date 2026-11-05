// Synthetic speech through owned Chrome + real core. ASR events and placement are local fixtures.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPage, sleep } from './headless.mjs';
import { decodeEventLog } from './event-log-fixture.mjs';
const root = resolve(new URL('..', import.meta.url).pathname);
const before = process.argv.includes('--before');
const output = resolve(process.env.SHOTS || join(tmpdir(), `voice-identity-${before?'before':'after'}-${Date.now()}`));
mkdirSync(output, {recursive:true});
const words = 'The amber lantern belongs beside the blue notebook.';
execFileSync('/usr/bin/say', ['-r','180','-o',join(output,'speech.aiff'),words]);
execFileSync('/usr/bin/afconvert', [join(output,'speech.aiff'),join(output,'speech.wav'),'-f','WAVE','-d','LEI16@24000','-c','1']);
const wav = readFileSync(join(output,'speech.wav'));
let samples = 0, sourcePcm;
for(let at=12;at+8<=wav.length;) { const size=wav.readUInt32LE(at+4); if(wav.toString('ascii',at,at+4)==='data') {samples=size/2;sourcePcm=wav.subarray(at+8,at+8+size);} at+=8+size+(size%2); }
assert.ok(samples>24000);
const frames = Math.ceil(samples/1920)+10;
const binary = process.env.VOICE_IDENTITY_TEST_BINARY;
assert.ok(binary,'set VOICE_IDENTITY_TEST_BINARY to the executable printed by the focused cargo test');
let server, browser;
const logs=[];
async function start(replay=false) {
  // Never consume a stale readiness file; preserve the previous receipt.
  if(existsSync(join(output,'ready.json'))) copyFileSync(join(output,'ready.json'),join(output,'first-ready.json'));
  const old = existsSync(join(output,'ready.json')) ? readFileSync(join(output,'ready.json'),'utf8') : '';
  server=spawn(binary,['--exact','asr::tests::identity::chrome_fixture_core','--ignored','--nocapture'],{cwd:root,env:{PATH:process.env.PATH,VOICE_IDENTITY_DATA:output,VOICE_IDENTITY_FRAMES:String(frames),VOICE_IDENTITY_REPLAY:replay?'1':'0'},stdio:['ignore','pipe','pipe']});
  for(const pipe of [server.stdout,server.stderr]) pipe.on('data',b=>logs.push(b.toString()));
  for(let i=0;i<200;i++) {
    assert.equal(server.exitCode,null,logs.join(''));
    if(existsSync(join(output,'ready.json'))) {const text=readFileSync(join(output,'ready.json'),'utf8');if(text!==old)return JSON.parse(text).port;}
    await sleep(50);
  }
  throw Error('fixture core did not start');
}
async function stop() {if(server?.exitCode===null){const ended=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await ended;}}
try {
  const port=await start();
  assert.ok(![4360,4399].includes(port));
  browser=await openPage('about:blank');
  const {page,evaluate,until}=browser;
  await page('Page.enable');
  await page('Page.addScriptToEvaluateOnNewDocument',{source:`
    localStorage.setItem('e2a2o.toured','1'); window.events=[]; window.errors=[];
    const WS=window.WebSocket; window.WebSocket=class extends WS { constructor(...args){super(...args);this.addEventListener('message',e=>events.push(JSON.parse(e.data)));} };
    addEventListener('error',e=>errors.push(e.message));
    // The native MediaStream audio clock is device dependent on headless macOS. Feed the
    // generated PCM through the UI capture callback at explicit 80ms cadence, never a device.
    class Node { connect(n){return n} disconnect(){} }
    window.AudioContext=class { state='running';sampleRate=24000;destination={};audioWorklet={addModule:async()=>{}};
      createMediaStreamSource(){return new Node()}createGain(){return Object.assign(new Node(),{gain:{value:1}})}
      close(){this.state='closed';clearInterval(window.fixtureTimer);return Promise.resolve()}
    };
    window.AudioWorkletNode=class extends Node {constructor(){super();let generation=0,at=0;
      this.port={postMessage:s=>generation=s.generation,close:()=>clearInterval(window.fixtureTimer)};
      window.fixtureTimer=setInterval(()=>{
        const frame=new Int16Array(1920);frame.set(window.fixturePcm.subarray(at,at+1920));at+=1920;
        this.port.onmessage?.({data:{frame:frame.buffer,generation}});
      },80);
    }};
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{
      const wav=await (await fetch('/fixture.wav')).arrayBuffer(),v=new DataView(wav);
      for(let at=12;at+8<wav.byteLength;){const size=v.getUint32(at+4,true);
        if(v.getUint32(at,false)===0x64617461){window.fixturePcm=new Int16Array(wav.slice(at+8,at+8+size));break;}
        at+=8+size+(size%2);
      }
      if(!window.fixturePcm)throw Error('missing synthetic PCM');
      return {getTracks:()=>[{stop:()=>clearInterval(window.fixtureTimer),getSettings:()=>({echoCancellation:true})}]};
    }}});
  `});
  await page('Page.navigate',{url:`http://127.0.0.1:${port}/?film`});
  assert.ok(await until(`!!document.querySelector('[data-guide="mic"]') && !document.querySelector('[data-guide="mic"]').disabled && document.querySelector('[data-guide="mic"]').dataset.state==='off'`));
  const click=async selector=>{
    const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    for(const type of ['mousePressed','mouseReleased'])await page('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
  };
  const shot=async name=>writeFileSync(join(output,name+'.png'),Buffer.from((await page('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await click('[data-guide="mic"]');
  assert.ok(await until(`document.querySelector('[data-guide="mic"]').dataset.state==='listening'`,10000),'service acknowledged listening');
  assert.ok(await until(`events.some(e=>e.type==='change' && e.change.type==='thought_placed')`,20000),'one phrase saved and placed');
  await sleep(700); await shot('placed-before-stop');
  await click('[data-guide="mic"]');
  assert.ok(await until(`events.some(e=>e.type==='status' && !e.listening)`),'mic stop completed');
  await sleep(300);
  await shot('stopped');
  const journal=decodeEventLog(readFileSync(join(output,'journal.jsonl'),'utf8'));
  const additions=journal.filter(e=>e.type==='thought_added');
  assert.equal(additions.length,1);assert.equal(additions[0].thought.text,words);
  assert.equal(journal.filter(e=>e.type==='thought_placed').length,1);
  writeFileSync(join(output,'app-events.json'),JSON.stringify(await evaluate('events'),null,2));
  await stop();
  const replayPort=await start(true);assert.ok(![4360,4399].includes(replayPort));
  await page('Page.navigate',{url:`http://127.0.0.1:${replayPort}/?film`});
  assert.ok(await until(`!!document.querySelector('.spine-ready')`,10000));await sleep(800);
  await shot('replay');
  const cards=await evaluate(`document.querySelectorAll('.recovery-panel article').length`);
  const placed=await evaluate(`document.querySelectorAll('[data-thought="${additions[0].thought.id}"]').length`);
  assert.ok(placed>0,'saved thought visibly replayed');
  assert.equal(cards,before?1:0,'saved phrase has no unfinished duplicate after keyless replay');
  const observed=JSON.parse(readFileSync(join(output,'asr-observed.json'),'utf8'));
  const receivedPcm=readFileSync(join(output,'mic-pcm.raw'));
  assert.ok(receivedPcm.subarray(0,sourcePcm.length).equals(sourcePcm),'the complete generated speech arrived unchanged in PCM');
  const times=observed.mic_frame_times_ms;const cadence=(times.at(-1)-times[0])/(times.length-1);
  assert.ok(cadence>65 && cadence<100,`normal 80ms cadence: ${cadence}`);
  assert.deepEqual(await evaluate('errors'),[]);
  writeFileSync(join(output,'summary.json'),JSON.stringify({fixture:true,capture_callback_fixture:true,native_worklet_in_browser:false,full_source_pcm_equal:true,before,phrase:words,thoughts:1,placed:1,unfinished:cards,mic_frames:times.length,mean_cadence_ms:cadence,external_calls:0,limitations:'ASR events and placement are synthetic. Missing live upstream event IDs and sequence are not established.'},null,2));
  console.log(`PASS ${before?'defect reproduced':'fixed'}: one saved/placed thought, mic stop, keyless journal replay, unfinished=${cards}, cadence=${cadence.toFixed(1)}ms; ${output}`);
} finally {
  if(browser) {
    writeFileSync(join(output,'last-ui.json'),JSON.stringify(await browser.evaluate(`({text:document.body.innerText,events,errors,mic:document.querySelector('[data-guide="mic"]')?.outerHTML})`).catch(String),null,2));
    const screenshot=await browser.page('Page.captureScreenshot',{format:'png'}).catch(()=>null);
    if(screenshot)writeFileSync(join(output,'last-ui.png'),Buffer.from(screenshot.data,'base64'));
  }
  await browser?.close();await stop();writeFileSync(join(output,'core.log'),logs.join(''));
}
