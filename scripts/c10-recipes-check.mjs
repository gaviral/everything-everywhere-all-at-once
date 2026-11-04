// Real UI + real core, synthetic journal only; no model, account, mic or external adapter.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { openPage, ready, sleep } from './headless.mjs';
assert.equal(ready(), '', 'built UI and Chrome required');
const root = resolve(new URL('..', import.meta.url).pathname);
const dir = mkdtempSync(join(tmpdir(), 'c10-recipes-'));
mkdirSync(join(dir, 'run')); mkdirSync(join(dir, 'data')); mkdirSync(join(dir, 'shots'));
const original = { id: 'synthetic-original', name: 'Cover card', purpose: 'Show a card about the cover.', watcher: { kind: 'phrase', phrase: 'blue cover' }, prompt: null,
  publishers: [{ kind: 'card', text: 'Review the blue cover.' }], enabled: false, request: '', cooldown_secs: 30, created_ms: 1, last_run_ms: 0 };
const timer = { ...original, id: 'synthetic-timer', name: 'Old timer', watcher: { kind: 'time', at_ms: 1, every_secs: 0 } };
const journal = join(dir, 'data/journal.jsonl');
writeFileSync(journal, [{ type: 'apps_seeded' }, ...[original, timer].map(app => ({ type: 'app_registered', app }))].map(c => JSON.stringify(c)).join('\n') + '\n');
// Reserve an OS-selected ephemeral port, then let the isolated core own it. Never touch the two reserved app ports.
async function freePort() {
  const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r));
  const port = s.address().port; await new Promise(r => s.close(r));
  assert.ok(port > 1024 && ![4360, 4399].includes(port)); return port;
}
let child, browser;
let port = await freePort();
const start = async () => {
  child = spawn(join(root, 'core/target/debug/e2a2o-core'), [], { cwd: join(dir, 'run'), env: {
    PATH: process.env.PATH, TMPDIR: process.env.TMPDIR || tmpdir(), E2A2O_DATA: join(dir, 'data'), E2A2O_UI: join(root, 'ui/dist'), PORT: String(port),
    MODEL_API_KEY: '', PICTURES: 'off', RUST_LOG: 'warn',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) throw Error('isolated core exited: ' + output);
    try { if ((await fetch(`http://127.0.0.1:${port}/room`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await sleep(50);
  }
  throw Error('isolated core did not start: ' + output);
};
const stop = async () => {
  if (!child || child.exitCode !== null) return;
  const exit = new Promise(r => child.once('exit', r)); child.kill('SIGTERM'); await exit;
};
const messages = [];
async function connection() {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const seen = [];
  ws.addEventListener('message', e => { seen.push(JSON.parse(e.data)); });
  await new Promise((r, reject) => { ws.onopen = r; ws.onerror = reject; });
  const wait = async predicate => { for (let i=0;i<200;i++) { const m=seen.find(predicate); if(m) return m; await sleep(25); } throw Error('core receipt missing'); };
  const world = (await wait(m => m.type==='snapshot')).world;
  return { ws, seen, world, send: m => ws.send(JSON.stringify(m)), wait };
}
try {
  await start(); console.log('c10: isolated core ready');
  // An operation alone cannot activate the feature. Another connection's switch grants nothing here.
  let probe = await connection();
  const portable = { version: 1, ...Object.fromEntries(['name','purpose','watcher','prompt','publishers','cooldown_secs'].map(k=>[k,original[k]])) };
  probe.send({type:'save_recipe',save:{request_id:'ungated',recipe:portable,source:null}});
  assert.match((await probe.wait(m=>m.type==='recipe_result')).message,/Enable App recipes/);
  probe.ws.close();
  browser = await openPage('about:blank');
  const { page, evaluate, until } = browser;
  await page('Page.enable'); await page('Runtime.enable'); await page('Network.enable');
  const errors = [], external = [];
  browser.on('Runtime.exceptionThrown', e => errors.push(e.exceptionDetails.text));
  browser.on('Network.webSocketFrameSent', e=>{try{messages.push(JSON.parse(e.response.payloadData));}catch{}});
  const origin = `http://127.0.0.1:${port}`;
  browser.on('Fetch.requestPaused', e => { const local=e.request.url.startsWith(origin+'/'); if(!local) external.push(e.request.url); void page(local?'Fetch.continueRequest':'Fetch.failRequest', local?{requestId:e.requestId}:{requestId:e.requestId,errorReason:'BlockedByClient'}); });
  await page('Fetch.enable', {patterns:[{urlPattern:'*'}]});
  await page('Page.navigate',{url:origin+'/'});
  assert.ok(await until('!!document.querySelector("#type-a-thought")',15000));
  const click = async selector => {
    assert.ok(await until(`!!document.querySelector(${JSON.stringify(selector)})`),selector);
    const r=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    for(const type of ['mousePressed','mouseReleased']) await page('Input.dispatchMouseEvent',{type,...r,button:'left',clickCount:1});
  };
  const key=async (key,code,n)=>{for(const type of ['keyDown','keyUp']) await page('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:n});};
  const fill=async (selector,text)=>{
    await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.select()})()`);
    await page('Input.insertText',{text});
  };
  const features=async()=>{if(!await evaluate('!!document.querySelector(".shell-catalog")')) await click('[data-guide=catalog]');};
  const closeFeatures=async()=>{await key('Escape','Escape',27);};
  const expand=async()=>{if(!await evaluate('document.querySelector(".app-recipes details")?.open')) await click('.app-recipes summary');};
  const closeDialog=async()=>{await click('[data-recipe-close]');assert.ok(await until('!document.querySelector(".app-recipes-dialog")'));};
  const snapshot=async()=>{const p=await connection();p.ws.close();return p.world;};
  assert.equal(await evaluate('localStorage.getItem("e2a2o.bricks")'),null);
  assert.equal(await evaluate('!!document.querySelector("[data-brick=app-recipes]")'),false);
  assert.equal(messages.some(m=>m.type==='save_recipe'||m.type==='recipes_switch'&&m.on),false);
  await features();
  assert.equal(await evaluate(`document.querySelector('[role="switch"][aria-label="App recipes"]').getAttribute("aria-checked")`),'false');
  await click('[role=switch][aria-label="App recipes"]'); await closeFeatures();
  assert.ok(await until('!!document.querySelector(".app-recipes")'));
  await expand();
  await click('[data-recipe-app=synthetic-original] button:first-child');
  assert.ok(await until('!!document.querySelector(".app-recipes-dialog[open]")'));
  assert.equal(await evaluate('document.querySelectorAll(".app-recipes-preview p").length'),5);
  assert.deepEqual((await snapshot()).apps,[original,timer],'Preview journals no app');
  await key('Escape','Escape',27);
  assert.ok(await until('!document.querySelector(".app-recipes-dialog")'));
  assert.equal(await evaluate('document.activeElement.textContent'),'Preview recipe','focus returns');
  await click('[data-recipe-app=synthetic-original] button:nth-child(2)');
  await fill('[data-recipe-name]','Green cover'); await fill('[data-recipe-phrase]','green cover'); await fill('[data-recipe-card]','Review the green cover.');
  await evaluate('document.querySelector("[data-recipe-save]").click();document.querySelector("[data-recipe-save]").click()');
  assert.ok(await until('document.querySelector("[data-recipe-status]")?.textContent==="Saved disabled app."'));
  let world=await snapshot(); assert.equal(world.apps.length,3); assert.deepEqual(world.apps[0],original);
  const fork=world.apps.find(a=>a.name==='Green cover');assert.ok(fork&&!fork.enabled&&fork.id!==original.id);assert.equal(fork.last_run_ms,0);
  assert.equal(messages.filter(m=>m.type==='save_recipe').length,1,'double click sends one request');
  await closeDialog(); console.log('c10: Preview/Fork and double-save passed');
  // Export shows exactly the portable bytes and hands them to the shared download path only on Download.
  await click('[data-recipe-app=synthetic-original] button:nth-child(3)');
  const exported=await evaluate('document.querySelector("[data-recipe-bytes]").textContent');
  assert.deepEqual(JSON.parse(exported),portable);
  await evaluate(`window.recipeDownloads=[];window.recipeBlobs=[];window.originalCreate=URL.createObjectURL;URL.createObjectURL=b=>{window.recipeBlobs.push(b);return window.originalCreate(b)};window.originalClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.recipeDownloads.push({name:this.download,url:this.href})}`);
  await click('.app-recipes-footer button:first-child');
  assert.equal(await evaluate('window.recipeDownloads[0].name'),'app-recipe.json');
  assert.equal(await evaluate('window.recipeBlobs[0].type'),'application/json');
  assert.equal(await evaluate('window.recipeBlobs[0].text()'),exported);
  await closeDialog();
  const importFile=async (text,name='recipe.json')=>{
    const file=join(dir,name);writeFileSync(file,text);
    const doc=await page('DOM.getDocument'); const {nodeId}=await page('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'.app-recipes-file input'});
    await page('DOM.setFileInputFiles',{nodeId,files:[file]});
  };
  const journalBefore=readFileSync(journal,'utf8');
  await importFile(exported);
  assert.ok(await until('document.querySelector("#recipe-heading")?.textContent==="Import Preview"'));
  assert.equal(readFileSync(journal,'utf8'),journalBefore,'Import Preview is mutation-free');
  await evaluate('document.querySelector("[data-recipe-save]").click();document.querySelector("[data-recipe-save]").click()');
  assert.ok(await until('document.querySelector("[data-recipe-status]")?.textContent==="Saved disabled app."'));
  world=await snapshot();assert.equal(world.apps.length,4);assert.ok(world.apps.every(a=>!a.enabled));
  const imported=world.apps.at(-1);await closeDialog(); console.log('c10: portable export and import passed');
  // Only the existing per-app Features switch arms the saved recipe.
  await features(); await click(`[data-row="app-${imported.id}"] [role=switch]`); await closeFeatures();
  world=await snapshot();assert.equal(world.apps.find(a=>a.id===imported.id).enabled,true);
  // Import failures remain visible and write nothing.
  const beforeRefusal=readFileSync(journal,'utf8');
  for(const [text,pattern,name] of [[JSON.stringify({...portable,owner_id:'x'}),'Invalid recipe fields','unknown.json'],[JSON.stringify({...portable,publishers:[{kind:'external',account:'synthetic'}]}),'Not portable yet','external.json'],[JSON.stringify({...portable,watcher:timer.watcher}),'Not portable yet','timer.json'],[' '.repeat(32769),'32 KiB','oversized.json'],[Buffer.from([0xff,0xfe,0xff]),'encoded data','invalid-utf8.json']]) {
    await importFile(text,name);assert.ok(await until(`document.querySelector('.app-recipes [role=status]')?.textContent.includes(${JSON.stringify(pattern)})`));
    assert.equal(await evaluate('!!document.querySelector(".app-recipes-dialog")'),false);
  }
  await click('[data-recipe-app=synthetic-timer] button:nth-child(3)');
  assert.ok(await until('document.querySelector(".app-recipes [role=status]")?.textContent.includes("Not portable yet")'));
  assert.equal(readFileSync(journal,'utf8'),beforeRefusal);
  // Current source value must still match when Save fork takes the journal lock.
  await click('[data-recipe-app=synthetic-original] button:nth-child(2)');
  probe=await connection();probe.send({type:'toggle_app',id:original.id,enabled:true});await sleep(150);probe.ws.close();
  await click('[data-recipe-save]');assert.ok(await until('document.querySelector("[data-recipe-status]")?.textContent.includes("Original app changed")'));await closeDialog();
  probe=await connection();probe.send({type:'toggle_app',id:original.id,enabled:false});await sleep(150);probe.ws.close();
  // Reload/restart: copies and request identity survive; no auto-arm and no resubmission.
  const savedRequest=messages.find(m=>m.type==='save_recipe').save;
  await stop();await start();await page('Page.reload');assert.ok(await until('!!document.querySelector(".app-recipes")',15000));
  world=await snapshot();assert.equal(world.apps.length,4);assert.deepEqual(world.apps.find(a=>a.id===original.id),original);
  probe=await connection();probe.send({type:'recipes_switch',on:true});probe.send({type:'save_recipe',save:savedRequest});
  assert.equal((await probe.wait(m=>m.type==='recipe_result')).app_id,fork.id);probe.ws.close();
  assert.equal((await snapshot()).apps.length,4);
  await expand();await click('[data-recipe-app=synthetic-original] button:nth-child(2)');
  await fill('[data-recipe-name]','Draft survives disconnect');
  const sendsBeforeDrop=messages.filter(m=>m.type==='save_recipe').length;
  await stop();assert.ok(await until('document.querySelector("[data-recipe-save]")?.disabled'));
  assert.equal(await evaluate('document.querySelector("[data-recipe-name]").value'),'Draft survives disconnect');
  await start();assert.ok(await until('!document.querySelector("[data-recipe-save]")?.disabled',15000));
  assert.equal(await evaluate('document.querySelector("[data-recipe-name]").value'),'Draft survives disconnect');
  assert.equal(messages.filter(m=>m.type==='save_recipe').length,sendsBeforeDrop,'reconnect never retries a save');
  for(const [width,height,theme,textScale] of [[1440,900,'light',1],[1440,900,'dark',1],[390,844,'light',1],[390,844,'dark',1],[390,844,'dark',2],[390,430,'dark',1]]) {
    await page('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await page('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme},{name:'prefers-reduced-motion',value:'reduce'}]});
    await evaluate(`document.documentElement.style.fontSize=${JSON.stringify(textScale===2?'200%':'')}`);
    await sleep(120);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'no horizontal overflow');
    assert.equal(await evaluate(`(()=>{const r=document.querySelector('.app-recipes-footer').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()`),true,'actions reachable above keyboard');
    await key('Tab','Tab',9);
    await evaluate('document.querySelector("[data-recipe-save]").focus()');
    assert.notEqual(await evaluate('getComputedStyle(document.activeElement).outlineStyle'),'none','keyboard focus visible');
    const shot=await page('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    writeFileSync(join(dir,'shots',`${width}-${height}-${theme}-${textScale}.png`),Buffer.from(shot.data,'base64'));
  }
  await closeDialog();
  const beforeOff=await snapshot();
  await features();await click('[role=switch][aria-label="App recipes"]');await closeFeatures();
  assert.ok(await until('!document.querySelector("[data-brick=app-recipes]")'));
  await page('Page.reload');assert.ok(await until('!!document.querySelector("#type-a-thought")'));
  assert.equal(await evaluate('!!document.querySelector("[data-brick=app-recipes]")'),false);
  assert.deepEqual((await snapshot()).apps,beforeOff.apps,'off preserves original and saved apps');
  probe=await connection();probe.send({type:'save_recipe',save:{...savedRequest,request_id:'off-attempt'}});assert.match((await probe.wait(m=>m.type==='recipe_result')).message,/Enable/);probe.ws.close();
  assert.equal((await snapshot()).apps.length,4);
  // Standalone playground uses its synthetic host, and never writes through the real core.
  const beforePlayground=readFileSync(journal,'utf8');
  await page('Page.navigate',{url:origin+'/bricks.html?brick=app-recipes&sample=empty'});
  assert.ok(await until('!!document.querySelector(".app-recipes")',15000),'loaded standalone recipe card');
  await expand();
  const playgroundApps=await evaluate('document.querySelectorAll(".app-recipes-apps li").length');
  await importFile(exported,'playground-recipe.json');
  assert.ok(await until('document.querySelector("#recipe-heading")?.textContent==="Import Preview"'));
  await click('[data-recipe-save]');
  assert.ok(await until('document.querySelector("[data-recipe-status]")?.textContent==="Synthetic saved disabled app."'));
  await closeDialog();
  assert.equal(await evaluate('document.querySelectorAll(".app-recipes-apps li").length'),playgroundApps+1);
  assert.equal(await evaluate('document.querySelector(".app-recipes-apps li:last-child span").textContent'),'Disabled');
  assert.equal(readFileSync(journal,'utf8'),beforePlayground,'playground never journals a core app');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  assert.equal(messages.some(m=>m.type==='listen'&&m.on),false,'no mic request');
  console.log(`c10-recipes-check: ok; real core + synthetic journal; evidence ${dir}`);
} finally { if(browser) await browser.close();await stop(); }
