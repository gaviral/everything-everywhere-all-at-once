// Rendering/event fixture for survivor 3; never presented as real-service audio evidence.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { standInCore, openPage, sleep } from './headless.mjs';
const now = Date.now();
const world = { threads: [{id:'T1', title:'Synthetic exchange', parent_id:null,status:'open',last_point:'',touched_ms:now,tags:[],picture:null,dropped_by:''}], thoughts: [], active:'T1',active_by:{you:'T1'},stay_here:'T1',anchors:{},notes:{},suggestions:[],actions:[],merged:{},apps:[],apps_seeded:true,recaps:[],proposals:[],ai:['E2A2O'] };
const core = await standInCore(() => [{type:'snapshot',world}], {onMessage(msg) {
  if (msg.type === 'listen') core.send({type:'status',listening:msg.on});
}});
let browser;
const events = [];
const send = msg => { events.push({at_ms:Date.now(),type:msg.type,state:msg.state,reply_id:msg.reply_id}); core.send(msg); };
const output = process.env.SHOTS || join(tmpdir(),'e2a2o-voice-events');
mkdirSync(output,{recursive:true});
try {
  browser = await openPage('about:blank');
  const {page,evaluate,until} = browser;
  await page('Page.enable');
  await page('Page.addScriptToEvaluateOnNewDocument',{source:`
    localStorage.setItem('e2a2o.toured','1'); localStorage.setItem('e2a2o.features',JSON.stringify({partner:true}));
    window.spoken=[]; window.cancelled=0; window.micStarts=0; window.tracks=[];
    Object.defineProperty(window,'speechSynthesis',{configurable:true,value:Object.assign(new EventTarget(),{
      getVoices:()=>[{name:'Fixture English',lang:'en-US',default:true}],speak:u=>spoken.push(u),cancel:()=>cancelled++
    })});
    window.SpeechSynthesisUtterance=class {constructor(text){this.text=text}};
    class Node { constructor(){this.port={postMessage:s=>this.capture=s,close(){}}} connect(n){return n} disconnect(){} }
    window.AudioContext=class {state='running';sampleRate=24000;destination={};audioWorklet={addModule:async()=>{}};
      createMediaStreamSource(){return new Node()} createGain(){return Object.assign(new Node(),{gain:{value:1}})}
      close(){this.state='closed';return Promise.resolve()}
    };
    window.AudioWorkletNode=class extends Node {constructor(){super();window.writer=this}};
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:()=>{
      micStarts++; if(window.denyMic) return Promise.reject(new DOMException('denied','NotAllowedError'));
      return new Promise(resolve=>window.allowMic=()=>{const track={stop(){this.stopped=true},getSettings:()=>({echoCancellation:true})};tracks.push(track);resolve({getTracks:()=>[track]})});
    }}});
  `});
  await page('Page.navigate',{url:`http://127.0.0.1:${core.port}/`});
  assert.ok(await until(`!!document.querySelector('[data-guide="mic"]') && !!document.querySelector('.partner-status')`));
  const click = async selector => {
    const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    for(const type of ['mousePressed','mouseReleased']) await page('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
  };
  await click('[data-guide="mic"]');
  assert.ok(await until(`document.querySelector('[data-guide="mic"]').dataset.state==='starting'`));
  assert.ok(!await evaluate(`document.querySelector('.shell-status-word').textContent.includes('Listening')`));
  await evaluate('allowMic()');
  assert.ok(await until(`document.querySelector('[data-guide="mic"]').dataset.state==='listening'`));
  send({type:'partial',text:'Synthetic first question'});
  assert.ok(await until(`document.querySelector('.voice-draft')?.textContent.includes('Synthetic first question')`));
  send({type:'change',change:{type:'thought_added',thought:{id:'pending-a',speaker:'you',text:'Unrelated synthetic thought',point:'',thread_id:'T1',placed:false,complete:true,at_ms:now,place_ms:0}}});
  assert.ok(await until(`document.querySelector('.shell-status-right').textContent.includes('waiting')`));
  assert.match(await evaluate(`document.querySelector('.shell-status-word').textContent`),/Listening/,'placement and capture facts coexist');
  send({type:'partner_state',state:'thinking',message:'Thinking…',reply_id:'reply-a'});
  send({type:'guide',kind:'caption',text:'Synthetic reply text stays available on the spine while you consider the next question. You can stop this reply immediately, keep the microphone action separate, and inspect your recognized draft words. This deliberately longer synthetic fixture gives the screenshot checks time to inspect both desktop and phone controls before the playback deadline.',by:'E2A2O',reply_id:'reply-a',at_ms:now,speak:true});
  assert.ok(await until(`spoken.length===1 && document.querySelector('.partner-status').dataset.playback==='queued'`));
  assert.match(await evaluate(`document.querySelector('.shell-status-word').textContent`),/Mic open.*paused/);
  await evaluate('spoken[0].onstart()');
  const pausedGeneration = await evaluate('writer.capture.generation');
  assert.deepEqual(await evaluate(`(()=>{const a=new Int16Array([123,-456]);writer.port.onmessage({data:{frame:a.buffer,generation:writer.capture.generation}});return [...a]})()`),[0,0],'reply samples cannot reach ASR');
  assert.ok(await until(`document.querySelector('.partner-status').dataset.playback==='playing'`));
  assert.match(await evaluate(`document.querySelector('[data-guide="mic"]').getAttribute('aria-label')`),/^Stop listening/);
  const shot=async name=>{
    events.push({at_ms:Date.now(),type:'frame',name,result_type:'fixture',destination:'T1',...await evaluate(`({
      mic:document.querySelector('[data-guide="mic"]').dataset.state,
      playback:document.querySelector('.partner-status').dataset.playback,
      viewport:{width:innerWidth,height:innerHeight},
      controls:[...document.querySelectorAll('.partner-status button')].map(b=>{const r=b.getBoundingClientRect();return {name:b.textContent,left:r.left,top:r.top,right:r.right,bottom:r.bottom,unobscured:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})
    })`)});
    const frame=await page('Page.captureScreenshot',{format:'png'});
    writeFileSync(join(output,name+'.png'),Buffer.from(frame.data,'base64'));
  };
  await shot('desktop');
  await page('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await sleep(120);
  assert.ok(await evaluate(`(()=>{const b=document.querySelector('.partner-status button');const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`),'Stop reply is unobscured on phone');
  await shot('phone-playing');
  await page('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.querySelector('.partner-status button').focus()`);
  for(const type of ['keyDown','keyUp']) await page('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:type==='keyDown'?'\r':undefined});
  assert.ok(await until(`cancelled>0 && document.querySelector('.partner-status').dataset.playback==='off'`),'keyboard Stop reply is immediate');
  assert.equal(await evaluate('tracks[0].stopped===true'),false,'Stop reply leaves mic action independent');
  events.push({at_ms:Date.now(),type:'local-stop-reply',playback:await evaluate(`document.querySelector('.partner-status').dataset.playback`)});
  assert.deepEqual(await evaluate(`(()=>{const a=new Int16Array([123,-456]);writer.port.onmessage({data:{frame:a.buffer,generation:${pausedGeneration}}});return [...a]})()`),[0,0],'late paused frame remains silent');
  assert.deepEqual(await evaluate(`(()=>{const a=new Int16Array([123,-456]);writer.port.onmessage({data:{frame:a.buffer,generation:writer.capture.generation}});return [...a]})()`),[123,-456],'first second-turn PCM prefix is accepted without restarting capture');
  const count=await evaluate('spoken.length');
  send({type:'guide',kind:'caption',text:'Late answer must stay silent.',by:'E2A2O',reply_id:'reply-a',at_ms:now,speak:true});
  await evaluate('spoken[0].onstart();spoken[0].onend();spoken[0].onerror()');
  await sleep(100);
  assert.equal(await evaluate('spoken.length'),count,'stopped reply cannot queue again');
  assert.equal(await evaluate('micStarts'),1,'no capture restart from late playback');
  send({type:'partial',text:'Second synthetic utterance starts here'});
  assert.ok(await until(`document.querySelector('.voice-draft').textContent.includes('Second synthetic utterance starts here')`));
  send({type:'partner_state',state:'thinking',message:'Thinking…',reply_id:'reply-b'});
  send({type:'guide',kind:'caption',text:'Second reply.',by:'E2A2O',reply_id:'reply-b',at_ms:now+1,speak:true});
  assert.ok(await until('spoken.length===2'));
  send({type:'partner_state',state:'thinking',message:'Stale thinking',reply_id:'reply-a'});
  await sleep(80);
  assert.equal(await evaluate(`document.querySelector('.partner-status').dataset.playback`),'queued','stale thinking cannot interrupt the next reply');
  await evaluate('spoken[1].onerror()');
  assert.ok(await until(`document.querySelector('.partner-status').dataset.playback==='failed' && document.querySelector('.partner-status').textContent.includes('Retry audio')`));
  for(const [name,width,height,large,dark] of [['phone',390,844,false,false],['large-text',390,844,true,false],['dark',390,844,false,true]]) {
    await page('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await evaluate(`document.documentElement.style.fontSize='${large?'200':'100'}%'`);
    await page('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:dark?'dark':'light'}]});
    await sleep(120);
    assert.ok(await evaluate(`(()=>{const buttons=[...document.querySelectorAll('.partner-status button')];return buttons.every(b=>{const r=b.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight&&r.height>=44&&b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})})()`),`${name}: actions reachable`);
    await shot(name);
  }
  await evaluate(`[...document.querySelectorAll('.partner-status button')].find(b=>b.textContent==='Retry audio').click()`);
  assert.ok(await until(`spoken.length===3 && spoken[2].text==='Second reply.'`),'retry uses retained reply words');
  await evaluate('spoken[2].onstart()');
  const beforeConversationStop = await evaluate('cancelled');
  await evaluate(`[...document.querySelectorAll('.partner-status button')].find(b=>b.textContent==='Stop conversation').click()`);
  assert.ok(await until(`cancelled>${beforeConversationStop}`),'Stop conversation cancels active playback locally');
  await evaluate('spoken[2].onstart();spoken[2].onend()');
  events.push({at_ms:Date.now(),type:'local-stop-conversation',capture:'off',playback:'off'});
  assert.ok(await until('tracks.every(t=>t.stopped)'));
  assert.ok(await until(`document.querySelector('[data-guide="mic"]').getAttribute('aria-pressed')==='false'`));
  assert.ok(await evaluate(`document.querySelector('.voice-draft').textContent.includes('Second synthetic utterance starts here')`),'stop retains recognized words');
  core.drop();
  assert.ok(await until(`document.querySelector('[data-guide="mic"]').dataset.state==='offline'`));
  await sleep(1200);
  assert.equal(await evaluate('micStarts'),1,'reconnect never starts recording');
  // Permission denial offers typing and retry without dropping retained words.
  await page('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate('window.denyMic=true');
  await click('[data-guide="mic"]');
  assert.ok(await until(`document.querySelector('[data-guide="mic"]').dataset.state==='blocked'`));
  assert.ok(await evaluate(`!!document.querySelector('textarea') && document.querySelector('.voice-draft').textContent.includes('Second synthetic utterance starts here')`));
  // A meaningful permission retry, followed by disconnect while capture is actually open.
  await evaluate('window.denyMic=false');
  await click('[data-guide="mic"]');
  assert.ok(await until('micStarts===3'));
  await evaluate('allowMic()');
  assert.ok(await until(`document.querySelector('[data-guide="mic"]').dataset.state==='listening'`));
  send({type:'partial',text:'Synthetic words retained after disconnect'});
  assert.ok(await until(`document.querySelector('.voice-draft').textContent.includes('Synthetic words retained after disconnect')`));
  core.drop();
  assert.ok(await until('tracks.every(t=>t.stopped)'),'disconnect closes an open mic');
  assert.ok(await until(`document.querySelector('[data-guide="mic"]').dataset.state!=='offline'`));
  assert.equal(await evaluate('micStarts'),3,'reconnect after capture failure never records');
  assert.ok(await evaluate(`document.querySelector('.voice-draft').textContent.includes('Synthetic words retained after disconnect')`));
  events.push({at_ms:Date.now(),type:'disconnect',capture:'off',recognized_draft_retained:true});
  assert.ok(core.heard.some(m=>m.type==='partner_cancel'));
  writeFileSync(join(output,'events.json'),JSON.stringify({result_type:'fixture',events,live_audio_verified:false},null,2));
  console.log('PASS voice-events fixture: independent capture/placement/playback, visible stop, stale reply rejection, retained Draft, reconnect, permission denial; desktop/phone/enlarged/dark');
} finally { await browser?.close(); core.close(); }
