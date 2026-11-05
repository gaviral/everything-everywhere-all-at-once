// Synthetic events and PCM only. No real capture device, speech service, journal or model.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { standInCore, openPage, ready, sleep } from './headless.mjs';
import { expectRecognizedWords } from './recognized-words.mjs';
if (ready()) { console.log(`SKIP c10: ${ready()}`); process.exitCode = 3; }
else {
const output = mkdtempSync(join(tmpdir(), 'e2a2o-c10-'));
const world = { threads: [], thoughts: [], active: null, active_by: {}, anchors: {}, notes: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], proposals: [], ai: ['E2A2O'] };
const core = await standInCore(() => [{ type: 'snapshot', world }], { onMessage(message) {
  if (message.type === 'listen') core.send({ type: 'status', listening: message.on, note: '' });
} });
assert.ok(![4360,4399].includes(core.port));
let browser;
const logs = { explicit: [], session: [], guards: [] };
try {
  browser = await openPage('about:blank');
  const { page, evaluate, until } = browser;
  await page('Page.enable');
  await page('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('e2a2o.toured','1');
    window.spoken=[]; window.tracks=[]; window.contexts=[]; window.micStarts=0; window.cancelled=0;
    Object.defineProperty(window,'speechSynthesis',{configurable:true,value:Object.assign(new EventTarget(),{
      getVoices:()=>[{name:'Synthetic voice',lang:'en-US',localService:true}],speak:u=>spoken.push(u),cancel:()=>cancelled++
    })});
    window.SpeechSynthesisUtterance=class {constructor(text){this.text=text}};
    class Node {constructor(){this.port={postMessage:s=>this.capture=s,close(){}}} connect(n){return n} disconnect(){}}
    window.AudioContext=class {constructor(){contexts.push(this)} state='running';sampleRate=24000;destination={};audioWorklet={addModule:async()=>{}};
      resume(){if(window.deferResume)return new Promise(resolve=>window.finishResume=()=>{this.state='running';resolve()});this.state='running';return Promise.resolve()} close(){this.state='closed';return Promise.resolve()}
      createMediaStreamSource(){return new Node()} createGain(){return Object.assign(new Node(),{gain:{value:1}})}};
    window.AudioWorkletNode=class extends Node {constructor(){super();window.writer=this}};
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:()=>{
      micStarts++; if(window.denyMic)return Promise.reject(new DOMException('Synthetic denial','NotAllowedError'));
      return new Promise(resolve=>window.allowMic=()=>{const track={stop(){this.stopped=true},getSettings:()=>({echoCancellation:true})};tracks.push(track);resolve({getTracks:()=>[track]})});
    }}});
  ` });
  await page('Page.navigate', { url: `http://127.0.0.1:${core.port}/` });
  const wait = async (expression, why = expression) => assert.ok(await until(expression), why);
  await wait(`!!document.querySelector('[data-guide="mic"]')`);
  assert.equal(await evaluate(`!!document.querySelector('.voice-policy-comparison')`), false, 'fresh profile default off');
  assert.equal(await evaluate('micStarts'), 0);
  const localActions = [];
  const click = async selector => {
    const point = await evaluate(`(async()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b)throw Error('missing '+${JSON.stringify(selector)});b.scrollIntoView({block:'nearest'});await new Promise(r=>setTimeout(r,120));const r=b.getBoundingClientRect();if(!b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))throw Error('obscured '+${JSON.stringify(selector)});return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    for (const type of ['mousePressed','mouseReleased']) await page('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
    localActions.push(selector);
  };
  const key = async (key, code, windowsVirtualKeyCode, text) => {
    for (const type of ['keyDown','keyUp']) await page('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode, ...(type==='keyDown'&&text?{text}:{}) });
  };
  const feature = '[role="switch"][aria-label="Compare voice turns"]';
  const toggleFeature = async () => {
    await evaluate('document.activeElement?.blur()');
    await key('c','KeyC',67,'c');
    await wait(`!!document.querySelector(${JSON.stringify(feature)})`);
    const before = await evaluate(`document.querySelector(${JSON.stringify(feature)}).getAttribute('aria-checked')`);
    await click(feature);
    await wait(`document.querySelector(${JSON.stringify(feature)}).getAttribute('aria-checked')!==${JSON.stringify(before)}`,'Features switch changes');
    await key('Escape','Escape',27);
  };
  await toggleFeature();
  // Reply generation remains the existing, independently opted-in Meta partner capability.
  await key('c','KeyC',67,'c');
  await wait(`!!document.querySelector('[role="switch"][aria-label="Conversation partner"]')`);
  await click('[role="switch"][aria-label="Conversation partner"]');
  await key('Escape','Escape',27);
  await wait(`!!document.querySelector('.voice-policy-comparison')`);
  assert.equal(await evaluate('micStarts'), 0, 'enable never captures');
  assert.equal(await evaluate(`document.querySelector('.voice-policy-comparison').dataset.mode`), 'explicit');
  const record = async (lane, event) => logs[lane].push({ event, fixture: true, ...await evaluate(`({micStarts, open:tracks.filter(t=>!t.stopped).length, facts:[...document.querySelectorAll('[data-fact]')].map(e=>[e.dataset.fact,e.textContent]), queued:spoken.length})`) });
  const mic = '[data-guide="mic"]';
  const action = name => `[data-action="${name}"]`;
  const openCapture = async selector => {
    await click(selector);
    await wait(`document.querySelector(${JSON.stringify(mic)}).dataset.state==='starting'`);
    await evaluate('allowMic()');
    await wait(`document.querySelector(${JSON.stringify(mic)}).getAttribute('aria-pressed')==='true'`);
  };
  const pcm = () => evaluate(`(()=>{const a=new Int16Array([123,-456,789]);writer.port.onmessage({data:{frame:a.buffer,generation:writer.capture.generation}});return [...a]})()`);
  let reply = 0;
  const speak = async () => {
    const n = await evaluate('spoken.length');
    core.send({ type: 'command_reply', speak: true, reply_id: `fixture-${++reply}`, text: 'Synthetic reply. The reply text stays available while the comparison shows microphone, placement and playback facts separately. These synthetic words allow time to inspect the controls without making a real device or service claim. '.repeat(4) });
    await wait(`spoken.length===${n+1}`);
    await evaluate(`spoken[${n}].onstart()`);
    return n;
  };
  const shot = async (mode, name, width, dark, large = false, height = 900) => {
    await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await page('Emulation.setEmulatedMedia', { features: [{name:'prefers-color-scheme',value:dark?'dark':'light'},{name:'prefers-reduced-motion',value:'reduce'}] });
    await evaluate(`document.documentElement.style.fontSize='${large?200:100}%'`);
    await sleep(80);
    assert.ok(await evaluate(`(()=>{const s=document.querySelector('.voice-policy-comparison');return s.getBoundingClientRect().right<=innerWidth&&[...s.querySelectorAll('button')].every(b=>{b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect();return r.height>=44&&r.top>=0&&r.bottom<=innerHeight&&b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})})()`), `${mode}/${name}: controls reachable`);
    writeFileSync(join(output, `${mode}-${name}.png`), Buffer.from((await page('Page.captureScreenshot',{format:'png'})).data,'base64'));
  };
  for (const mode of ['explicit','session']) {
    if (mode === 'session') {
      await click('input[value="session"]'); // value is set explicitly by the component
      assert.equal(await evaluate('tracks.filter(t=>!t.stopped).length'),0);
      assert.equal(await evaluate('micStarts'),2,'selection alone does not capture');
    }
    const actionStart = localActions.length;
    const before = await evaluate('micStarts');
    await openCapture(mode==='explicit' ? mic : action('start-conversation'));
    await record(mode,'local-start');
    for (let turn=0;turn<2;turn++) {
      assert.deepEqual(await pcm(),[123,-456,789],`${mode}: first samples retained`);
      core.send({type:'partial',text:`Synthetic turn ${turn+1} first words`});
      await expectRecognizedWords(browser, `Synthetic turn ${turn+1} first words`);
      const n = await speak();
      await record(mode,`turn-${turn+1}-playing`);
      assert.equal(await evaluate('writer.capture.bargeIn'),false,'comparison isolates local barge-in');
      if(mode==='explicit') await wait('tracks.every(t=>t.stopped)');
      else {
        await wait(`document.querySelector('[data-fact="capture"]').textContent==='Mic paused · Speaking'`);
        assert.deepEqual(await pcm(),[0,0,0]);
      }
      if(turn===0) {
        for(const [name,width,dark,large] of [['desktop-light',1440,false,false],['desktop-dark',1440,true,false],['phone-light',390,false,false],['phone-dark',390,true,false],['phone-large',390,false,true]]) await shot(mode,name,width,dark,large);
        await shot(mode,'phone-keyboard',390,false,false,520);
        await page('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
        await evaluate(`document.documentElement.style.fontSize='100%'`);
        if(mode==='session') await evaluate(`contexts.at(-1).state='suspended';window.deferResume=true`);
        await evaluate(`spoken[${n}].onend()`);
        if(mode==='session') {
          await wait(`document.querySelector('[data-fact="capture"]').textContent==='Starting'`,'resume stays Starting until context actually runs');
          await evaluate('finishResume();window.deferResume=false');
        }
      } else {
        await evaluate(`document.querySelector('${action('stop-reply')}').focus()`);
        await key('Enter','Enter',13,'\r');
        await wait(`document.querySelector('[data-fact="playback"]').textContent==='Reply stopped'`);
        assert.equal(await evaluate(`document.activeElement?.tagName`),'TEXTAREA','keyboard focus returns to composer');
        await evaluate(`spoken[${n}].onend();spoken[${n}].onstart()`);
        core.send({type:'command_reply',speak:true,reply_id:`fixture-${reply}`,text:'Old queued audio'});
        await sleep(80);
        assert.equal(await evaluate('spoken.length'),n+1,'stopped old audio never queued');
      }
      if(mode==='explicit') {
        assert.equal(await evaluate('tracks.filter(t=>!t.stopped).length'),0);
        assert.equal(await evaluate('micStarts'),before+turn+1,'reply end/stop never starts explicit capture');
        if(turn===0) await openCapture(mic);
      } else {
        await wait(`document.querySelector('[data-fact="capture"]').textContent==='Listening'`);
        assert.deepEqual(await pcm(),[123,-456,789],'resumed first PCM prefix retained');
      }
      await record(mode,`turn-${turn+1}-ended`);
    }
    const expectedStarts=mode==='explicit'?2:1;
    assert.equal(await evaluate('micStarts'),before+expectedStarts);
    const captureActions = localActions.slice(actionStart).filter(s=>s===mic || s===action('start-conversation'));
    assert.equal(captureActions.length,expectedStarts);
    logs[mode].push({capture_start_actions:captureActions.length,selectors:captureActions,stop_reply_keyboard_actions:1,device_starts:expectedStarts,automatic_transcription_resumes:mode==='session'?2:0});
    if(mode==='session') {
      await click(action('stop-conversation'));
      await wait('tracks.every(t=>t.stopped)');
      await evaluate('spoken.forEach(u=>{u.onend();u.onstart()})');
      assert.equal(await evaluate('micStarts'),before+1,'stopped session rejects delayed callbacks');
    }
    logs[mode].push({total_pointer_actions:localActions.length-actionStart,keyboard_stop_reply_actions:1,stop_conversation_pointer_actions:mode==='session'?1:0,scope:'two turns plus explicit session stop; excludes feature/mode setup'});
  }
  await openCapture(mic);
  const unstartedReply = await speak();
  await wait('tracks.every(t=>t.stopped)');
  await evaluate(`spoken[${unstartedReply}].onend()`);
  assert.equal(await evaluate('tracks.filter(t=>!t.stopped).length'),0,'Started session mode without Start conversation never resumes');
  await evaluate(`document.querySelector('textarea').focus()`);
  await page('Input.insertText',{text:'Synthetic unsent typed words'});
  // Active and pending sessions expire on off, disconnect, mode switch and permission failure.
  for (const reason of ['off','disconnect','mode','denied','pending-off','pending-resume','leaving']) {
    if(reason==='denied') await evaluate('window.denyMic=true');
    if(reason==='pending-off') {
      await click(action('start-conversation'));
      await wait(`document.querySelector('${mic}').dataset.state==='starting'`);
      await toggleFeature();
      await evaluate('allowMic()');
      await wait('tracks.every(t=>t.stopped)');
    } else if(reason==='denied') {
      await click(action('start-conversation'));
      await wait(`document.querySelector('${mic}').dataset.state==='blocked'`);
      await evaluate('window.denyMic=false');
      assert.equal(await evaluate(`document.querySelector('${action('start-conversation')}').disabled`),false,'denial ends token');
    } else {
      await openCapture(action('start-conversation'));
      await speak();
      if(reason==='pending-resume') {
        await evaluate(`contexts.at(-1).state='suspended';window.deferResume=true;spoken.at(-1).onend()`);
        await wait(`document.querySelector('[data-fact="capture"]').textContent==='Starting'`);
        await click(action('stop-conversation'));
        await evaluate('finishResume();window.deferResume=false');
      }
      if(reason==='off') await toggleFeature();
      if(reason==='disconnect') core.drop();
      if(reason==='mode') {
        await evaluate(`document.querySelector('input[value="session"]').focus()`);
        await key('ArrowLeft','ArrowLeft',37);
        await wait(`document.querySelector('.voice-policy-comparison').dataset.mode==='explicit'`);
        assert.equal(await evaluate('document.activeElement?.value'),'explicit','mode keyboard focus stays on selected radio');
      }
      if(reason==='leaving') await evaluate(`dispatchEvent(new Event('pagehide'))`);
      await wait('tracks.every(t=>t.stopped)');
    }
    const starts=await evaluate('micStarts');
    await evaluate('spoken.forEach(u=>{u.onend();u.onstart()})');
    await sleep(reason==='disconnect'?1400:100);
    assert.equal(await evaluate('micStarts'),starts,`${reason}: no late/reconnect restart`);
    assert.equal(await evaluate(`document.querySelector('textarea').value`),'Synthetic unsent typed words',`${reason}: editable draft retained`);
    await expectRecognizedWords(browser, 'Synthetic turn 2 first words', `${reason}: recognized words retained`);
    await record('guards',reason);
    if(reason==='off'||reason==='pending-off') await toggleFeature();
    if(reason!=='leaving') await click('input[value="session"]');
  }
  await page('Page.reload');
  await wait(`!!document.querySelector('.voice-policy-comparison')`);
  assert.equal(await evaluate(`document.querySelector('.voice-policy-comparison').dataset.mode`),'explicit','switch persists; mode/session does not');
  assert.equal(await evaluate('micStarts'),0,'reload never captures or replays audio');
  assert.equal(await evaluate('spoken.length'),0);
  await toggleFeature();
  assert.equal(await evaluate(`!!document.querySelector('.voice-policy-comparison')`),false);
  writeFileSync(join(output,'explicit-events.json'),JSON.stringify(logs.explicit,null,2));
  writeFileSync(join(output,'session-events.json'),JSON.stringify(logs.session,null,2));
  writeFileSync(join(output,'guards.json'),JSON.stringify(logs.guards,null,2));
  console.log(`PASS c10 fixture: default-off, two modes, token guards, retained words/PCM, no old audio, A=2/B=1 start actions, reload/off, keyboard, both themes, desktop/390px/200%, reduced motion. Evidence: ${output}`);
 } catch(error) {
  console.error('c10 fixture state:', await browser?.evaluate(`({starts:window.micStarts,tracks:window.tracks?.map(t=>!!t.stopped),speech:window.spoken?.length,comparison:document.querySelector('.voice-policy-comparison')?.textContent.slice(0,360)})`).catch(()=>null));
  throw error;
} finally { await browser?.close(); core.close(); }
}
