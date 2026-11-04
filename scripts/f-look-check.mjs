// The eight first-look fixes, on the built app and real keyless Rust core with synthetic sample data.
// Build UI and core first. PRECHECK_PAGES=all SHOTS=directory node scripts/f-look-check.mjs
// 1440x900 desktop and 390x844 phone, both themes, at 2x pixels to match the original review.
// Keeps captures and temporary data; stops only the two cores and Chrome processes it starts.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, mkdtempSync, cpSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { openPage, ready, sleep } from './headless.mjs';
const root = fileURLToPath(new URL("../", import.meta.url));
const out = resolve(process.env.SHOTS || mkdtempSync(join(tmpdir(), "f-look-shots-")));
mkdirSync(out, { recursive: true });
const why = ready();
if (why) { console.log(`SKIP f-look-check: ${why}`); process.exit(3); }
const base = mkdtempSync(join(tmpdir(), "f-look-fixture-"));
const servers = {};
const children = [];
const logs = [];
try {
  for (const name of ["empty", "sample"]) {
    const data = join(base, name);
    mkdirSync(data);
    if (name === "sample") {
      const source = readFileSync(join(root, "samples/student-week.jsonl"), "utf8");
      const events = source.trim().split("\n").map(line => JSON.parse(line));
      const rent = events.find(e => e.type === "thread_added" && e.thread.title === "Rent is due").thread;
      const said = events.filter(e => e.type === "thought_added" && e.thought.thread_id === rent.id)
        .map(e => e.thought).sort((a,b) => a.at_ms - b.at_ms).at(-1);
      // Test-only recorded departure: the repository sample predates the pause protocol.
      const pause = { id: "look-rent-pause", thought_id: said.id, thread_id: rent.id, speaker: said.speaker,
        revision: 1, excerpt: said.text, at_ms: said.at_ms, offer_after_ms: 0, resolved: false, hidden: false, later_count: 0 };
      writeFileSync(join(data, "journal.jsonl"), source.trimEnd() + "\n" + JSON.stringify({type:"paused", pause}) + "\n");
      cpSync(join(root,"samples/images/student-week"),join(data,"images"),{recursive:true});
    }
    const socket = createServer();
    await new Promise(r => socket.listen(0,"127.0.0.1",r));
    const port = socket.address().port;
    assert.ok(![4360,4399].includes(port));
    await new Promise(r => socket.close(r));
    const fd = openSync(join(base,`${name}.log`),"a"); logs.push(fd);
    const child = spawn(join(root,"core/target/debug/e2a2o-core"),[],{cwd:base,stdio:["ignore",fd,fd],
      env:{PATH:process.env.PATH,MODEL_API_KEY:"",PORT:String(port),RUST_LOG:"warn",E2A2O_DATA:data,
        E2A2O_UI:join(root,"ui/dist"),E2A2O_SAMPLES:join(root,"samples")}});
    children.push(child); servers[name]={port};
    let up=false;
    for(let i=0;i<100;i++) {
      if(child.exitCode !== null) throw Error(`${name} core exited: ${readFileSync(join(base,`${name}.log`),"utf8")}`);
      try { up=(await fetch(`http://127.0.0.1:${port}/room`)).ok; } catch {}
      if(up)break; await sleep(50);
    }
    assert.ok(up,`${name} core starts`);
  }
const results=[];
const save=(path,data)=>{if(existsSync(path))renameSync(path,path+'.previous-'+Date.now());writeFileSync(path,data)};
for(const [device,width,height] of [['desktop',1440,900],['phone',390,844]].filter(([device])=>!process.env.LOOK_DEVICE||process.env.LOOK_DEVICE===device)) for(const scheme of ['light','dark']){
 let browser;
 try{
  browser=await openPage('about:blank',{width,height});
  const {page,evaluate,until}=browser;
  await page('Page.enable');
  await page('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:device==='phone'});
  await page('Emulation.setTouchEmulationEnabled',{enabled:device==='phone'});
  await page('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme},{name:'prefers-reduced-motion',value:'reduce'}]});
  await page('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('e2a2o.toured','1');localStorage.setItem('e2a2o.install-hint','1');localStorage.setItem('e2a2o.features',JSON.stringify({pictures:true}));window.lookErrors=[];addEventListener('error',e=>{if(!/^ResizeObserver loop/.test(e.message))lookErrors.push(e.message)});addEventListener('unhandledrejection',e=>lookErrors.push(String(e.reason)));`});
  const check=async(exp,description)=>{const ok=await until(exp,10000);if(!ok){console.log(await evaluate('document.body.innerText'));const {data}=await page('Page.captureScreenshot',{format:'png'});save(`${out}/${device}-${scheme}-failure.png`,Buffer.from(data,'base64'))}assert.ok(ok,`${device}-${scheme}: ${description}`)};
  const key=async(key,code=key,keyCode=key.length===1?key.toUpperCase().charCodeAt(0):27)=>{for(const type of ['keyDown','keyUp'])await page('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:keyCode})};
  const click=async(selector)=>{
   const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
   for(const type of ['mousePressed','mouseReleased'])await page('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});
  };
  const shot=async(screen)=>{
   await sleep(250);
   const {data}=await page('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
   const png=Buffer.from(data,'base64');
   assert.equal(png.readUInt32BE(16),width*2,'capture width matches the review');
   assert.equal(png.readUInt32BE(20),height*2,'capture height matches the review');
   save(`${out}/${device}-${scheme}-${screen}.png`,png);
  };
  const clean=()=>check(`!document.querySelector('.brick-broke,.crash') && lookErrors.length===0`,'no UI errors');
  await page('Page.navigate',{url:`http://127.0.0.1:${servers.empty.port}/`});
  await check(`!!document.querySelector('.map-capture-setup') && document.body.innerText.includes('No AI key')`,'empty key explanation');
  await check(`!(/MODEL_API_KEY|\\.env/.test(document.body.innerText))`,'empty screen has no technical setup text');
  await clean();await shot('empty');
  await click('.map-capture-setup');await check(`!!document.querySelector('.ai-setup[open]')`,'setup opens');
  await check(`document.querySelector('.ai-setup').innerText.includes('MODEL_API_KEY')`,'technical setup behind action');
  await shot('setup');await key('Escape','Escape',27);
  await check(`!document.querySelector('.ai-setup')`,'Escape closes setup');
  await page('Page.navigate',{url:`http://127.0.0.1:${servers.sample.port}/?sample`});
  await check(`!!document.querySelector('.shell-welcome') || !!document.querySelector('.spine-ready')`,'sample available');
  if(await evaluate(`!!document.querySelector('.map-capture-example')`))await click('.map-capture-example');
  await check(`!!document.querySelector('.spine-ready')`,'map ready');
  await check(`!!document.querySelector('.pullback .pullback-quote')`,'recorded reminder appears');
  await evaluate('document.fonts.ready');await sleep(600);
  const geometry=await evaluate(`(()=>{const box=s=>document.querySelector(s)?.getBoundingClientRect().toJSON();return {head:box('.spine-head'),controls:box('.spine-corner-row'),stage:box('.shell-stage'),band:getComputedStyle(document.documentElement).getPropertyValue('--shell-content-bottom'),clip:getComputedStyle(document.querySelector('.spine-flow')).clipPath}})()`);
  const spacing=await evaluate(`(()=>{
    const cards=[...document.querySelectorAll('.spine-card')];
    const overlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
    return {cards:cards.length,collision:cards.some(a=>{const pill=a.querySelector(':scope > .stay-control, :scope > .staying-here');return pill&&cards.some(b=>b!==a&&overlap(pill.getBoundingClientRect(),b.getBoundingClientRect()))}),
      clear:innerHeight-parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--shell-content-bottom')),
      controls:Math.min(...[...document.querySelectorAll('.spine-corner,.spine-corner-row,.shell-stage,.countdown-card')].map(e=>e.getBoundingClientRect()).filter(r=>r.width&&r.height).map(r=>r.top))};
  })()`);
  assert.ok(spacing.cards>=3,'the sample includes stacked tangents');
  assert.equal(spacing.collision,false,'Stay here covers no other tangent');
  assert.ok(spacing.clear<=spacing.controls-8,'map ends above lower controls');
  if(device==='phone') {
    const opening=await evaluate(`(()=>{
      const words=document.querySelector('.spine-point.spine-on .spine-text');
      const input=document.querySelector('[data-map-capture=active]');
      const mic=input?.querySelector('.mic'),m=mic?.getBoundingClientRect();
      const covers=[...document.querySelectorAll('[data-slot="top-left"],[data-slot="top-right"],.sample-recovery-actions')]
        .filter(e=>getComputedStyle(e).visibility!=='hidden').map(e=>e.getBoundingClientRect()).filter(r=>r.width&&r.height);
      return {top:Math.max(0,...covers.map(r=>r.bottom)),words:words?.getBoundingClientRect().toJSON(),input:input?.getBoundingClientRect().toJSON(),micHit:!!m&&mic.contains(document.elementFromPoint(m.x+m.width/2,m.y+m.height/2))};
    })()`);
    assert.ok(opening.words && opening.words.height>0 && opening.words.top>=opening.top+8 && opening.words.bottom<=spacing.clear
      && opening.words.left>=0 && opening.words.right<=width,'current thought stays readable between the phone controls');
    const inputReadable=opening.input && opening.input.top>=opening.top+8 && opening.input.bottom<=spacing.clear
      && opening.input.left>=0 && opening.input.right<=width && opening.micHit;
    if(!inputReadable) {
      await check(`!!document.querySelector('.capture-return button')`,'explicit source navigation keeps a route back to input');
      await click('.capture-return button');
      await check(`(()=>{const e=document.querySelector('[data-map-capture=active]'),r=e?.getBoundingClientRect(),m=e?.querySelector('.mic'),b=m?.getBoundingClientRect();return r&&r.left>=0&&r.right<=innerWidth&&r.top>=${opening.top+8}&&r.bottom<=${spacing.clear}&&!!b&&m.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2))})()`,'return restores a readable input and reachable microphone');
    }
  }
  await clean();await shot('map');
  await click('.shell-find input');await shot('find');await key('Escape','Escape',27);
  await key('y','KeyY',89);await check(`!!document.querySelector('.shell-history')`,'History opens');
  await check(`document.querySelector('.shell-history').innerText.includes('This copy has no AI key') && !(/MODEL_API_KEY|\\.env/.test(document.querySelector('.shell-history').innerText))`,'History has plain explanation');
  await shot('history');
  await click('.shell-history > .shell-row-button');await check(`!!document.querySelector('.ai-setup[open]')`,'History opens setup');await key('Escape','Escape',27);
  await key('Escape','Escape',27);
  await key('t','KeyT',84);await check(`!!document.querySelector('.shell-turns')`,'Talk opens');await shot('talk');await key('Escape','Escape',27);
  await key('c','KeyC',67);await check(`!!document.querySelector('.shell-catalog')`,'Features opens');
  await evaluate(`(()=>{const r=[...document.querySelectorAll('.shell-catalog-row')].find(e=>e.innerText.includes('Source attribution'));r?.scrollIntoView({block:'center'});})()`);
  await check(`document.querySelector('.shell-catalog').innerText.includes('Shows who added a point')`,'complete attribution phrase');
  await shot('features');await key('Escape','Escape',27);
  await key(',','Comma',188);await check(`!!document.querySelector('.shell-settings')`,'Settings opens');await shot('settings');
  await evaluate(`document.querySelector('.shell-settings').parentElement.scrollTop=9999`);await shot('settings-bottom');
  await check(`(()=>{const panel=document.querySelector('.shell-settings').parentElement;return panel.scrollTop+panel.clientHeight>=panel.scrollHeight-1&&getComputedStyle(panel).maskImage!=='none'})()`,'Settings end is padded, faded and reachable');
  await key('Escape','Escape',27);
  await key('r','KeyR',82);await check(`!!document.querySelector('.recap-sheet[open],.recap-dialog[open],dialog[open]')`,'Recap opens');
  if(device==='phone')await check(`getComputedStyle(document.querySelector('.recap-keyboard-hint')).display==='none'`,'phone hides keyboard hint');
  await check(`!!document.querySelector('.recap-footer button:not(:disabled)') && document.querySelector('.recap-footer').innerText.includes('Set up AI')`,'Recap setup action');await shot('recap');
  await click('.recap-footer button:not(:disabled)');await check(`!!document.querySelector('.ai-setup[open]') && !document.querySelector('.recap-sheet[open]')`,'Recap opens setup');await key('Escape','Escape',27);
  await click('.shell-composer textarea');await page('Input.insertText',{text:'pictures'});await key('Enter','Enter',13);
  await check(`!!document.querySelector('.palace')`,'gallery opens');await sleep(500);
  const gallery=await evaluate(`(()=>{const p=document.querySelector('.palace').getBoundingClientRect(),b=document.querySelector('.shell-bl').getBoundingClientRect();return {bottom:p.bottom,backTop:b.top,scroll:document.querySelector('.palace').scrollHeight,client:document.querySelector('.palace').clientHeight}})()`);
  assert.ok(gallery.bottom<=gallery.backTop-4,'gallery clear of back control');await clean();await shot('palace');
  await evaluate(`document.querySelector('.palace').scrollTop=9999`);await shot('palace-bottom');
  results.push({device,scheme,geometry,spacing,gallery,checks:'passed'});
  console.log(`${device}-${scheme}: captured screens and setup; layout/copy checks passed`);
 }finally{await browser?.close()}
}
save(`${out}/f-look-checks.json`,JSON.stringify(results,null,2)+'\n');

} finally {
  for(const child of children) if(child.exitCode === null) child.kill("SIGTERM");
  for(const child of children) if(child.exitCode === null && child.signalCode === null) await new Promise(r => child.once("exit",r));
  for(const fd of logs) closeSync(fd);
}
