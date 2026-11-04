// Opt-in live acceptance: synthetic speech through Chrome's microphone worklet, real ASR and placement.
// MODEL_API_KEY stays in the owned core's environment. Nothing sends email or messages.
// VOICE_CORE_BINARY=/path/to/fresh/core MODEL_API_KEY=... node scripts/voice-live.mjs [baseline|accept]
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Own Chrome and preserve its throwaway profile with the evidence. No shared browser or user profile.
async function openPage(url,{chromeArgs=[]}={}) {
 const profile=join(out,'chrome');mkdirSync(profile);
 const chrome=spawn(process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',[
  '--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run',
  '--no-default-browser-check','--use-mock-keychain','--password-store=basic','--mute-audio',
  '--disable-background-timer-throttling','--disable-renderer-backgrounding','--window-size=1440,900',...chromeArgs,'about:blank'
 ],{stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((resolve,reject)=>{let err='';const timer=setTimeout(()=>reject(Error('Chrome startup timeout')),15000);chrome.stderr.on('data',d=>{err+=d;const m=err.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timer);resolve(m[1])}});chrome.once('exit',()=>{clearTimeout(timer);reject(Error('Chrome exited'))})});
 const ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let id=0;const pending=new Map();
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id && pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
 const cdp=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params,sessionId}))});
 const {targetId}=await cdp('Target.createTarget',{url:'about:blank'});const {sessionId}=await cdp('Target.attachToTarget',{targetId,flatten:true});
 const page=(method,params)=>cdp(method,params,sessionId);
 const evaluate=async expression=>{const r=await page('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);return r.result.value};
 const until=async(expression,ms=5000)=>{const deadline=Date.now()+ms;while(Date.now()<deadline){if(await evaluate(expression).catch(()=>false))return true;await sleep(25)}return false};
 await page('Page.enable');await page('Page.navigate',{url});
 return {page,evaluate,until,close:async()=>{ws.close();const done=new Promise(r=>chrome.exitCode!==null?r():chrome.once('exit',r));chrome.kill('SIGTERM');await Promise.race([done,sleep(3000)]);chrome.stderr.destroy();chrome.unref()}};
}
const mode=process.argv[2]||'accept';
assert.ok(['baseline','accept'].includes(mode));
assert.ok(process.env.MODEL_API_KEY,'explicit live credential required');
const root=new URL('../',import.meta.url).pathname;
const out=mkdtempSync(join(realpathSync(tmpdir()),'e2a2o-voice-live-')); mkdirSync(join(out,'map'));
console.log('Artifacts:',out);
const binary=process.env.VOICE_CORE_BINARY || join(root,'core/target/release/e2a2o-core');
const report={mode,synthetic:true,physicalMic:false,events:[],measurements:[]};
report.binarySha256=createHash('sha256').update(readFileSync(binary)).digest('hex');
report.sourceHashes=Object.fromEntries(['core/src/asr.rs','core/src/asr/sources.rs','core/src/main.rs','scripts/voice-live.mjs'].map(p=>[p,createHash('sha256').update(readFileSync(join(root,p))).digest('hex')]));
let core,browser;
const port=await new Promise((resolve,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
assert.ok(![4360,4399].includes(port));
const start=async()=>{
 core=spawn(binary,[],{cwd:join(root,'core'),env:{...process.env,PORT:String(port),E2A2O_DATA:join(out,'map'),E2A2O_UI:join(root,'ui/dist'),EMAIL_SEND:'off',MESSAGES_SEND:'off',HELPERS_RUN:'off',HELPERS_COMMIT:'off',PLACER_MODEL:'muse-spark-1.2',REFINER_MODEL:'muse-spark-1.3',PICTURES:'off',ROOM_CODE:'',PUBLIC_URL:'',E2A2O_HOSTED:'0'},stdio:['ignore','pipe','pipe']});
 // Never record the core's raw diagnostics or environment in the acceptance artifact.
 let diagnostic='';core.stdout.on('data',d=>{diagnostic+=d});core.stderr.on('data',d=>{diagnostic+=d});core.once('exit',code=>{if(code)console.error(diagnostic.replaceAll(process.env.MODEL_API_KEY,'[redacted]'))});
 for(let i=0;i<100;i++){if(await fetch(`http://127.0.0.1:${port}/room`).then(r=>r.ok).catch(()=>false))return;assert.equal(core.exitCode,null,'core alive');await sleep(100)}
 throw Error('core readiness timeout');
};
const stop=async()=>{if(core && core.exitCode===null){const done=new Promise(r=>core.once('exit',r));core.kill('SIGTERM');await done}};
const init=`(()=>{
 const epoch=()=>performance.timeOrigin+performance.now();
 window.V={events:[],frames:[],screen:[],inputs:[],snapshots:[]};
 const WS=WebSocket;window.WebSocket=class extends WS{constructor(...a){super(...a);this.addEventListener('message',e=>{if(typeof e.data==='string'){const m=JSON.parse(e.data);if(m.type==='snapshot')V.snapshots.push({t:epoch(),world:m.world});else V.events.push({t:epoch(),m})}})}send(d){if(typeof d!=='string'){const a=new Int16Array(d);V.frames.push({t:epoch(),samples:a.length,rms:Math.sqrt(a.reduce((s,x)=>s+(x/32768)**2,0)/a.length)})}return super.send(d)}};
 const AC=AudioContext;navigator.mediaDevices.getUserMedia=async()=>{const c=new AC({sampleRate:48000});await c.resume();const dest=c.createMediaStreamDestination();window.loadVoice=async b=>{window.voiceBuffer=await c.decodeAudioData(Uint8Array.from(atob(b),x=>x.charCodeAt(0)).buffer)};window.playVoice=()=>{const s=c.createBufferSource();s.buffer=voiceBuffer;s.connect(dest);const at=epoch();s.start();V.inputs.push({at,duration:voiceBuffer.duration});return {at,duration:voiceBuffer.duration}};return dest.stream};
 localStorage.setItem('e2a2o.toured','1');
 setInterval(()=>{const live=document.querySelector('.dock .live,.tiny-transcript');const text=live?.textContent||'';if(text && V.screen.at(-1)?.text!==text)V.screen.push({t:epoch(),text})},20);
})()`;
const synth=(text,name)=>{const a=join(out,name+'.aiff'),w=join(out,name+'.wav');execFileSync('say',['-v','Samantha','-r','190','-o',a,text]);execFileSync('afconvert',['-f','WAVE','-d','LEI16@24000','-c','1',a,w]);return readFileSync(w).toString('base64')};
const phrase=synth('The amber lantern belongs beside the blue notebook.','phrase');
const unfinished=synth('Before booking the workshop I need to choose','unfinished');
const command=synth('Stop listening.','command');
const clickMic=async()=>{const r=await browser.evaluate(`(()=>{const b=document.querySelector('button.mic');const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await browser.page('Input.dispatchMouseEvent',{type:'mousePressed',...r,button:'left',clickCount:1});await browser.page('Input.dispatchMouseEvent',{type:'mouseReleased',...r,button:'left',clickCount:1})};
const load=async b=>browser.evaluate(`loadVoice(${JSON.stringify(b)})`);
const tap=async()=>browser.evaluate('V');
const screenshot=async name=>{const s=await browser.page('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,name+'.png'),Buffer.from(s.data,'base64'))};
try{
 await start();browser=await openPage('about:blank',{chromeArgs:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']});
 await browser.page('Page.addScriptToEvaluateOnNewDocument',{source:init});await browser.page('Page.navigate',{url:`http://127.0.0.1:${port}/`});
 assert.ok(await browser.until(`!!document.querySelector('button.mic:not(:disabled)') && V.snapshots.length>0`,15000));
 await clickMic();assert.ok(await browser.until('!!window.loadVoice',5000));await load(phrase);
 // Match the failed rehearsal: microphone silence first, then synthetic playback.
 await sleep(1400);
 const input=await browser.evaluate('playVoice()');report.input=input;
 if(mode==='baseline'){
  await sleep(8000);report.tap=await tap();report.body=await browser.evaluate('document.body.innerText');await screenshot('baseline');
  assert.ok(report.tap.events.some(x=>x.m.type==='error' && /backlog/i.test(x.m.message)),'baseline reproduces service backlog');
  console.log('Baseline: Audio processing backlog too large reproduced');
 }else{
  assert.ok(await browser.until(`V.events.some(x=>x.m.type==='change' && x.m.change.type==='thought_placed')`,15000),'speech placed');
  report.tap=await tap();const added=report.tap.events.find(x=>x.m.type==='change' && x.m.change.type==='thought_added');const id=added.m.change.thought.id;
  assert.match(added.m.change.thought.text,/amber lantern.*blue notebook/i);
  assert.ok(await browser.until(`!!document.querySelector('[data-thought="${id}"]')`,5000),'thought on canvas');
  report.canvas=await browser.evaluate(`(()=>{const e=document.querySelector('[data-thought="${id}"]');const r=e.getBoundingClientRect();return {text:e.innerText,rect:{x:r.x,y:r.y,width:r.width,height:r.height},at:performance.timeOrigin+performance.now()}})()`);
  await screenshot('placed');
  const partial=report.tap.events.find(x=>x.m.type==='partial' && /amber/i.test(x.m.text));const placed=report.tap.events.find(x=>x.m.type==='change' && x.m.change.type==='thought_placed');
  report.measurements.push({name:'phrase',speechSeconds:input.duration,firstWordsFromStartMs:partial.t-input.at,firstVisibleWordsFromStartMs:report.tap.screen[0].t-input.at,placedFromEndMs:placed.t-input.at-input.duration*1000,canvasFromEndMs:report.canvas.at-input.at-input.duration*1000});
  assert.ok(report.measurements[0].canvasFromEndMs<5000,'visible canvas below 5s from speech end');
  assert.ok(report.canvas.rect.width>0 && report.canvas.rect.height>0,'visible canvas geometry');
  assert.ok(report.tap.screen.some(x=>/amber lantern/i.test(x.text)),'recognized words actually visible before placement');
  const gaps=report.tap.frames.slice(1).map((f,i)=>f.t-report.tap.frames[i].t).sort((a,b)=>a-b);
  report.pcm={frames:report.tap.frames.length,medianGapMs:gaps[Math.floor(gaps.length/2)],maxGapMs:Math.max(...gaps)};
  assert.ok(report.pcm.medianGapMs>60 && report.pcm.medianGapMs<100,'real-time worklet cadence');
  await load(unfinished);const next=await browser.evaluate('playVoice()');
  assert.ok(await browser.until(`V.events.some(x=>x.t>${next.at} && x.m.type==='partial' && /workshop/i.test(x.m.text))`,10000),'unfinished words received');
  report.beforeRestart=await tap();await screenshot('unfinished');await stop();await start();
  await browser.page('Page.reload');assert.ok(await browser.until(`V.snapshots.length>0 && !!document.querySelector('button.mic:not(:disabled)')`,15000));
  report.afterRestart=await tap();report.recoveryBody=await browser.evaluate('document.body.innerText');await screenshot('restarted');
  assert.ok(report.afterRestart.events.filter(x=>x.m.type==='recoverable_speech' && x.m.text).length===1,'one unfinished speech persisted');
  assert.match(report.recoveryBody,/Unfinished speech/);assert.match(report.recoveryBody,/workshop/i);
  const recovered=report.afterRestart.events.find(x=>x.m.type==='recoverable_speech' && x.m.text).m;
  const keep=await browser.evaluate(`(()=>{const b=[...document.querySelectorAll('.recovery-panel button')].find(b=>b.textContent==='Keep in this map');const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  for(const type of ['mousePressed','mouseReleased'])await browser.page('Input.dispatchMouseEvent',{type,...keep,button:'left',clickCount:1});
  assert.ok(await browser.until(`V.events.some(x=>x.m.type==='recoverable_speech' && x.m.id===${JSON.stringify(recovered.id)} && !x.m.text)`,5000),'recovery accepted');
  assert.ok(await browser.until(`V.events.some(x=>x.m.type==='change' && x.m.change.type==='thought_placed')`,12000),'recovered partial placed');
  report.keptRecovery=await tap();
  assert.equal(report.keptRecovery.events.filter(x=>x.m.type==='change' && x.m.change.type==='thought_added' && /workshop/i.test(x.m.change.thought.text)).length,1,'one recovered thought');
  const recoveredThought=report.keptRecovery.events.find(x=>x.m.type==='change' && x.m.change.type==='thought_added' && /workshop/i.test(x.m.change.thought.text)).m.change.thought;
  assert.equal(recoveredThought.complete,false,'kept speech remains unfinished');
  await screenshot('kept-recovery');
  await clickMic();assert.ok(await browser.until('!!window.loadVoice',5000));await load(command);await sleep(1400);const cmd=await browser.evaluate('playVoice()');
  assert.ok(await browser.until(`V.events.some(x=>x.t>${cmd.at} && x.m.type==='status' && !x.m.listening)`,12000),'spoken Stop listening stops mic');
  report.commandTap=await tap();const stopped=report.commandTap.events.find(x=>x.t>cmd.at && x.m.type==='status' && !x.m.listening);report.measurements.push({name:'Stop listening',stoppedFromEndMs:stopped.t-cmd.at-cmd.duration*1000});report.commandBody=await browser.evaluate('document.body.innerText');await screenshot('command');
  assert.ok(![...report.tap.events,...report.commandTap.events].some(x=>x.m.type==='error'),'no speech service errors');
  console.log(JSON.stringify(report.measurements));console.log('Restart recovery and spoken Stop listening passed');
 }
 report.passed=true;
}catch(e){report.error=String(e);console.error(report.error);process.exitCode=1;if(browser){report.failureTap=await tap().catch(()=>null);report.failureBody=await browser.evaluate('document.body.innerText').catch(()=>null)}}finally{if(browser)await browser.close();await stop();writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));console.log('Report:',join(out,'report.json'))}
