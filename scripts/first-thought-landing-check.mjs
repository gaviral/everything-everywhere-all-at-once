// Survivor 1: one recoverable source per capture, honest persistence, bounded visuals, and real destination IDs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { captureCore, capturePage, typeCapture, empty } from './capture-fixture.mjs';
import { ready, sleep } from './headless.mjs';
import { uiServer } from './ui-server.mjs';
const rust=spawnSync('cargo',['test','--quiet','--manifest-path','core/Cargo.toml','capture_'],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
assert.equal(rust.status,0,rust.stdout+rust.stderr);
if(ready()){console.log(`SKIP first-thought-landing-check pages: ${ready()}`);process.exit(3);}
globalThis.location=new URL('http://localhost/');
const modules=await uiServer();
try{
  const {brickEvents}=await modules.ssrLoadModule('/src/bricks-core.ts');
  const events=brickEvents(), seen=[];
  const event=id=>({thoughtId:id,threadId:'T1',mine:true,model:'fixture',ms:100,by:{kind:'person',name:'you'}});
  events.emit('landed',event('A'));events.emit('landed',event('B'));
  const off=events.on('landed',e=>seen.push(e.thoughtId),'spine');await Promise.resolve();
  assert.deepEqual(seen,['B'],'late mount receives newest landing only');off();
  const off2=events.on('landed',e=>seen.push(e.thoughtId),'spine');await Promise.resolve();
  assert.deepEqual(seen,['B'],'remount cannot replay the same landing twice');off2();
  const clock=Date.now;let now=clock();Date.now=()=>now;
  try{events.emit('landed',event('C'));now+=5001;events.on('landed',e=>seen.push(e.thoughtId),'late');await Promise.resolve();assert.deepEqual(seen,['B'],'five-second replay window');}finally{Date.now=clock;}
}finally{await modules.close();}
const shots=process.env.SHOTS??mkdtempSync(join(tmpdir(),'e2a2o-capture-frames-'));mkdirSync(shots,{recursive:true});
async function record(browser,name){
  const frames=[], sampled=[];
  await browser.page('Runtime.enable');
  await browser.page('Runtime.addBinding',{name:'recordCaptureFrame'});
  browser.on('Runtime.bindingCalled',({name,payload})=>{if(name==='recordCaptureFrame')sampled.push(JSON.parse(payload));});
  browser.on('Page.screencastFrame',({data,metadata,sessionId})=>{frames.push({at:metadata.timestamp,data});browser.page('Page.screencastFrameAck',{sessionId}).catch(()=>{});});
  await browser.page('Page.startScreencast',{format:'jpeg',quality:70,everyNthFrame:1});
  const watch=`(()=>{const tick=()=>{window.recordCaptureFrame(JSON.stringify({at:performance.timeOrigin+performance.now(),canonical:[...document.querySelectorAll('[data-capture]')].map(e=>e.dataset.capture),flight:[...document.querySelectorAll('[data-flight]')].map(e=>e.dataset.flight),targets:[...document.querySelectorAll('.spine-point[data-thought]')].map(e=>{const r=e.getBoundingClientRect();return{id:e.dataset.thought,left:r.left,right:r.right,top:r.top,bottom:r.bottom,hidden:getComputedStyle(e.querySelector('.spine-text')).visibility==='hidden'}})}));window.captureTick=requestAnimationFrame(tick)};tick()})()`;
  await browser.page('Page.addScriptToEvaluateOnNewDocument',{source:watch});
  await browser.evaluate(watch);
  return async()=>{
    for(let waited=0;sampled.length<12&&waited<2000;waited+=20) await sleep(20);
    await browser.page('Page.stopScreencast');await browser.evaluate('cancelAnimationFrame(window.captureTick)');
    assert.ok(sampled.length>10,'visibility sampled on animation frames, across reload too');
    for(const frame of sampled)assert.equal(new Set(frame.canonical).size,frame.canonical.length,'one canonical item per capture ID');
    writeFileSync(join(shots,name+'.json'),JSON.stringify(sampled));
    frames.sort((a,b)=>a.at-b.at);
    const grid=[];
    if(frames.length) for(let at=frames[0].at,n=0,index=0;at<=frames.at(-1).at;at+=.1,n++) {
      while(index+1<frames.length&&frames[index+1].at<=at)index++;
      writeFileSync(join(shots,`${name}-${n}.jpg`),Buffer.from(frames[index].data,'base64'));
      grid.push({requested_ms:Math.round(at*1000),source_ms:Math.round(frames[index].at*1000)});
    }
    assert.ok(grid.length,'100 ms frame grid saved');
    writeFileSync(join(shots,name+'-frame-times.json'),JSON.stringify(grid));
    const {data}=await browser.page('Page.captureScreenshot',{format:'png'});writeFileSync(join(shots,name+'-settled.png'),Buffer.from(data,'base64'));
    return sampled;
  };
}
for(const [width,height] of [[1440,900],[390,844]])for(const scheme of ['light','dark'])for(const reduced of [false,true]){
  const core=await captureCore({delay:1800,manualPlacement:true});let browser;
  try{
    browser=await capturePage(core,{width,height,scheme,reduced});const {evaluate,until,page}=browser;
    const finish=await record(browser,`${width}-${scheme}-${reduced?'reduced':'normal'}`);
    // Hold fixture placement until both durable receipts are visible; CDP work has no fixed completion time.
    await typeCapture(browser,'A: book the cooking class');
    assert.ok(await until('document.querySelectorAll(".capture-item[data-saved=true]").length===1 && document.querySelector("#type-a-thought").value===""'),'A retained before the next capture');
    await typeCapture(browser,'B: bring the notebook');
    assert.ok(await until('document.querySelectorAll(".capture-item[data-saved=true]").length===2 && document.querySelector("#type-a-thought").value===""'),'A and B retained before placement');
    const ids=[...core.state.accepted.keys()];assert.equal(ids.length,2);
    if(reduced)assert.equal(await evaluate('document.querySelectorAll("[data-flight]").length'),0,'reduced motion defaults to no flight');
    else assert.ok(await until('!!document.querySelector("[data-flight]")',1000),'ordinary capture lifts');
    for(const id of ids)core.place(id);
    assert.ok(await until('document.querySelectorAll(".spine-point[data-thought]").length===2',6000),`${width} ${scheme} reduced=${reduced}: both captures visibly land`);
    assert.ok(await until('!document.querySelector("[data-flight]")',3500),'visuals release');
    assert.ok(await until('!!document.querySelector(".spine-landing")'),'late-mounted Canvas gets landing note');
    for(const id of ids)assert.equal(core.state.commits.get(id),1,'at most one committed placement');
    await finish();await page('Page.reload');
    assert.ok(await until('document.querySelectorAll(".spine-point[data-thought]").length===2'),'placements survive reload');
    assert.deepEqual([...core.state.accepted.keys()],ids,'same IDs after reload');
    assert.deepEqual([...core.state.accepted.values()].map(capture=>capture.text),['A: book the cooking class','B: bring the notebook'],'original words and order after reload');
    assert.equal(await evaluate('document.querySelectorAll("[data-flight]").length'),0,'reload does not replay historical flight');
    console.log(`captures ${width} ${scheme} reduced=${reduced}: ok`);
  }finally{await browser?.close();core.close();}
}
for(const fault of ['local-storage','journal','lost-receipt','slow','rejected','live-reduce','offscreen-resize']){
  const seed=empty();
  if(fault==='offscreen-resize') {
    seed.threads=['T1','T2'].map(id=>({id,title:id,parent_id:null,status:'open',last_point:'Existing words',touched_ms:1,tags:[],picture:null,dropped_by:''}));
    seed.thoughts=['T1','T2'].map(id=>({id:'old-'+id,speaker:'you',text:'Existing '+id,point:'Existing '+id,thread_id:id,placed:true,complete:true,at_ms:1}));
    seed.active='T1';seed.active_by={you:'T1'};seed.positions={T2:{x:9000,y:200,by:'you',at_ms:1}};
  }
  const core=await captureCore({delay:fault==='slow'?6300:1800,seed});let browser;
  try{
    core.state.failSave=fault==='journal';core.state.loseReceipt=fault==='lost-receipt';core.state.reject=fault==='rejected';
    browser=await capturePage(core,{width:390,height:844});const {page,evaluate,until}=browser;
    if(fault==='offscreen-resize') assert.ok(await until('!!document.querySelector(".spine-ready")',10000),'populated offscreen fixture is ready before capture');
    const finish=await record(browser,fault);
    if(fault==='local-storage')await evaluate(`const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('e2a2o.waiting'))throw new DOMException('full','QuotaExceededError');return set.call(this,k,v)}`);
    const text=`Original words for ${fault}`;await typeCapture(browser,text);
    if(fault==='local-storage'){
      assert.equal(await evaluate('document.querySelector("textarea").value'),text,'failed local save retains editable draft');
      assert.equal(core.state.accepted.size,0);assert.equal(await evaluate('!!document.querySelector(".capture-item[data-saved=true]")'),false,'no false Saved');
      assert.ok(await until('!!document.querySelector(".recovery-panel")'),'B1 recovery panel mounted');
      core.state.loseReceipt=true;core.state.omitCaptureReceipt=true;
      await evaluate(`[...document.querySelectorAll('.recovery-panel button')].find(b=>b.textContent==='Send online').click()`);
      for(let i=0;i<100&&core.state.accepted.size===0;i++)await sleep(10);
      assert.equal(core.state.accepted.size,1,'explicit online action accepts once');
      assert.equal(await evaluate('document.querySelector("textarea").value'),text,'online send retains draft before its durable receipt');
      const accepted=[...core.state.accepted.values()][0];
      core.send({type:'text_received',id:accepted.id});
      assert.ok(await until(`document.querySelector('textarea').value===''&&!!document.querySelector('.capture-item[data-capture="${accepted.id}"][data-saved=true]')`),'receipt clears only the accepted draft and keeps its canonical words visible');
    }else{
      assert.ok(await until('!!document.querySelector(".capture-item")',1000),'canonical source remains reachable');
      const id=await evaluate('document.querySelector(".capture-item").dataset.capture');
      if(fault==='journal'){
        assert.equal(await evaluate('document.querySelector(".capture-item").dataset.saved'),'false','core journal failure cannot say Saved');
        core.state.failSave=false;await page('Page.reload');
        assert.ok(await until(`!!document.querySelector('.capture-item[data-capture="${id}"][data-saved=true]')`),'same source retried after reload');
      }else if(fault==='lost-receipt'){
        core.state.loseReceipt=false;await page('Page.reload');
        assert.ok(await until(`!!document.querySelector('.capture-item[data-capture="${id}"]')`),'lost receipt retains the same source ID');
      }else if(fault==='slow'){
        await sleep(5600);assert.equal(await evaluate('document.querySelectorAll("[data-flight]").length'),0,'five-second wait releases flight');
        assert.ok(await evaluate(`!!document.querySelector('.capture-item[data-capture="${id}"]')`),'timeout leaves original reachable');
      }else if(fault==='rejected'){
        assert.ok(await until('document.querySelector(".capture-state")?.textContent.includes("placement failed")'),'actionable placement failure');
        await evaluate('document.querySelector(".capture-item button").click()');
      }else if(fault==='live-reduce'){
        await page('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
        assert.ok(await until('!document.querySelector("[data-flight]")'),'live preference change safely settles');
      }else{
        await evaluate('document.querySelector("textarea").blur()');
        for(const type of ['keyDown','keyUp']) await page('Input.dispatchKeyEvent',{type,key:'f',code:'KeyF',windowsVirtualKeyCode:70});
        assert.ok(await until('document.querySelector(".spine-follow")?.getAttribute("aria-pressed") === "false"'), 'manual view is not Following');
        await page('Input.dispatchMouseEvent',{type:'mouseWheel',x:160,y:250,deltaY:50,deltaX:0});
        core.state.world.active='T2';
        await page('Emulation.setDeviceMetricsOverride',{width:320,height:568,deviceScaleFactor:1,mobile:true});
        assert.ok(await until('!document.querySelector("[data-flight]")'),'manual navigation and resize cancel obsolete visuals');
      }
      const thoughtId=core.state.accepted.get(id)?.thought_ids[0];
      assert.ok(await until(`!!document.querySelector('.spine-point[data-thought="${thoughtId}"]')`,8000),'placement remains rendered after fault/retry');
      assert.equal(core.state.accepted.size,1,'one accepted input ID');
      assert.equal(core.state.accepted.get(id).text,text,'original source words survive the handoff and retry');
      assert.equal([...core.state.commits.values()][0],1,'one committed placement');
      assert.ok(await until('!document.querySelector("[data-flight]")',3000),'no stuck flight');
      assert.ok(await until(`![...document.querySelectorAll('.spine-text')].some(e=>getComputedStyle(e).visibility==='hidden')`,1000),`${fault}: no hidden destination left behind`);
      assert.ok(await until('!!document.querySelector(".capture-placed button")'),'named placement receipt remains reachable');
      if(fault==='offscreen-resize') {
        const outside = await evaluate(`(()=>{const r=document.querySelector('.spine-point[data-thought="${thoughtId}"]').getBoundingClientRect();return r.right<0||r.left>innerWidth||r.bottom<0||r.top>innerHeight})()`);
        assert.ok(outside,'the fixture really places the target offscreen; no edge-clamped false landing');
        await evaluate('document.querySelector(".capture-placed button").click()');
        assert.ok(await until(`(()=>{const r=document.querySelector('.spine-point[data-thought="${thoughtId}"]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<innerHeight})()`),'explicit Show reveals the actual destination');
      }
    }
    await finish();
    console.log(`capture fault ${fault}: ok`);
  }finally{await browser?.close();core.close();}
}
console.log(`first-thought-landing-check: ok (IDs, persistence faults, A/B, replay, reduced motion, retry, timeout, resize; frames in ${shots})`);
