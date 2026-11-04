// Synthetic, isolated acceptance: owns its core and Chrome, data directory and ephemeral ports.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openPage, ready, sleep } from "./headless.mjs";
const root = new URL("../", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "c10-aliases-"));
const journal = join(dir, "journal.jsonl");
const thread = (id) => ({id,title:`Topic ${id}`,parent_id:null,status:"open",last_point:"",touched_ms:1,tags:[],picture:null,dropped_by:""});
writeFileSync(journal, ["A","B"].map(id => JSON.stringify({type:"thread_added",thread:thread(id)})).join("\n")+"\n"+JSON.stringify({type:"active_changed",thread_id:"A",speaker:"you"})+"\n");
let core, browser, port, logs="";
const sockets = new Set();
async function stop() {
  for (const ws of sockets) ws.close(); sockets.clear();
  if (core && core.exitCode === null) { const child=core; const ended=new Promise(r=>child.once("exit",r)); child.kill("SIGTERM"); await ended; }
  core=null;
}
async function start(reusePort) {
  if (reusePort) port = reusePort;
  else { const reservation=createServer(); await new Promise(r=>reservation.listen(0,"127.0.0.1",r));
    port=reservation.address().port; await new Promise(r=>reservation.close(r)); }
  assert.ok(port!==4360 && port!==4399);
  core=spawn(join(root,"core/target/debug/e2a2o-core"),[],{cwd:dir,env:{PATH:process.env.PATH,PORT:String(port),E2A2O_DATA:dir,E2A2O_UI:join(root,"ui/dist"),RUST_LOG:"warn"},stdio:["ignore","pipe","pipe"]});
  for(const stream of [core.stdout,core.stderr]) stream.on("data",d=>{logs=(logs+d).slice(-4000);});
  for(let n=0;n<100;n++){ if(core.exitCode!==null) throw Error(`Core exited: ${logs}`); try{if((await fetch(`http://127.0.0.1:${port}/room`)).ok)return;}catch{} await sleep(50); }
  throw Error(`Core did not start: ${logs}`);
}
async function connection(){
  const ws=new WebSocket(`ws://127.0.0.1:${port}/ws?identity=1`); const messages=[];
  ws.addEventListener("message",e=>messages.push(JSON.parse(e.data))); sockets.add(ws);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  const wait=async predicate=>{for(let n=0;n<100;n++){const i=messages.findIndex(predicate);if(i>=0)return messages.splice(i,1)[0];await sleep(30);}throw Error("Missing message; saw "+JSON.stringify(messages).slice(-1200));};
  const snapshot=(await wait(m=>m.type==="snapshot")).world;
  return {ws,snapshot,messages,wait,send:m=>ws.send(JSON.stringify(m)),barrier:async()=>{const id=randomUUID();ws.send(JSON.stringify({type:"heartbeat",id}));await wait(m=>m.type==="heartbeat"&&m.id===id);}};
}
const id=randomUUID(),phrase="Violet doorway",target={kind:"open_topic",topic_id:"B"};
const req=(operation,revision=0,extra={})=>({type:"alias_operation",request_id:randomUUID(),operation,id,revision,phrase,target,enabled:true,...extra});
async function operation(c,r){c.send(r);return c.wait(m=>m.type==="alias_result"&&m.request_id===r.request_id);}
try {
  await start(); let c=await connection();
  assert.equal(c.snapshot.aliases,undefined,"fresh journal has no aliases");
  c.send(req("save")); await c.wait(m=>m.type==="notice"&&m.message.includes("shortcuts is off"));
  assert.ok(!readFileSync(journal,"utf8").includes("alias_changed"));
  c.send({type:"voice_shortcuts",on:true}); await c.barrier();
  const before=readFileSync(journal,"utf8"); assert.equal((await operation(c,req("preview"))).ok,true);
  assert.equal(readFileSync(journal,"utf8"),before,"Preview is mutation-free");
  const save=req("save"); assert.equal((await operation(c,save)).ok,true); assert.equal((await operation(c,save)).ok,true);
  assert.equal((await operation(c,req("save",0,{phrase:"stale words"}))).ok,false);
  assert.equal((await operation(c,req("preview",1,{phrase:"Stop listening!"}))).ok,false);
  await stop(); await start(); c=await connection();
  assert.equal(c.snapshot.aliases[0].phrase,phrase);assert.equal(c.snapshot.aliases[0].revision,1);
  c.send({type:"voice_shortcuts",on:true});await c.barrier();
  c.send({type:"text",id:randomUUID(),text:"  VIOLET   doorway！？ "});await c.barrier();
  let observer=await connection();assert.equal(observer.snapshot.active_by.you,"B");assert.equal(observer.snapshot.thoughts.length,0,"matching navigation makes no model-placement thought");
  assert.ok(!c.messages.some(m=>m.type==="step"&&m.model),"matching navigation starts no model step");
  c.send({type:"focus",thread_id:"A"});await c.barrier();
  c.send({type:"text",text:"I saw a violet doorway in a longer sentence"});await c.barrier();
  observer=await connection();assert.equal(observer.snapshot.active_by.you,"A");assert.ok(observer.snapshot.thoughts.some(t=>t.text.includes("longer sentence")));
  // Another window of the same speaker never inherits this connection's opt-in.
  observer.send({type:"text",text:phrase});await observer.barrier();
  let state=(await connection()).snapshot;assert.equal(state.active_by.you,"A");assert.ok(state.thoughts.some(t=>t.text===phrase));
  c.send({type:"voice_shortcuts",on:false});await c.barrier();c.send({type:"text",text:phrase});await c.barrier();
  state=(await connection()).snapshot;assert.equal(state.active_by.you,"A");assert.equal(state.aliases.length,1);

  if(ready()) throw Error(`Browser acceptance unavailable: ${ready()}`);
  browser=await openPage("about:blank");const {page,evaluate,until}=browser;
  await page("Page.enable");
  await page("Page.addScriptToEvaluateOnNewDocument",{source:`localStorage.setItem('e2a2o.toured','1');`});
  await page("Page.navigate",{url:`http://127.0.0.1:${port}/`});
  assert.ok(await until(`!!document.querySelector('[data-guide="catalog"]')`));
  assert.equal(await evaluate(`!!document.querySelector('.voice-shortcuts')`),false,"fresh browser default-off");
  const click=async selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await click('[data-guide="catalog"]');assert.ok(await until(`!!document.querySelector('[data-row="voice-shortcuts"] [role="switch"]')`));
  assert.equal(await evaluate(`document.querySelector('[data-row="voice-shortcuts"] [role="switch"]').getAttribute('aria-checked')`),"false");
  await click('[data-row="voice-shortcuts"] [role="switch"]');
  await page("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape"});await page("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape"});
  assert.ok(await until(`!!document.querySelector('.voice-shortcuts')`));
  const setInput=async(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const s=Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set;s.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
  await setInput('.voice-shortcuts form input',"Amber doorway");
  await setInput('.voice-shortcuts form select',"open_topic");await setInput('.voice-shortcuts form label:last-of-type select',"B");
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.voice-shortcuts form button')).find(b=>b.textContent==='Save').disabled`),true);
  await click('.voice-shortcuts form button[type="submit"]');
  assert.ok(await until(`document.querySelector('.voice-shortcuts [role="status"]').textContent.includes('Open topic: Topic B (B)')`));
  await evaluate(`Array.from(document.querySelectorAll('.voice-shortcuts form button')).find(b=>b.textContent==='Save').click()`);
  assert.ok(await until(`document.querySelector('.voice-shortcuts [role="status"]').textContent.includes('Saved.')`));
  assert.ok(await until(`document.activeElement===document.querySelector('.voice-shortcuts form input')`),"save returns keyboard focus");
  await page("Page.reload");assert.ok(await until(`document.querySelector('.voice-shortcuts')?.textContent.includes('Amber doorway')`),"feature and record survive reload");
  // Preview/Test and Try now are separate paths; disabling/deleting offer deliberate Undo.
  let uiObserver=await connection();uiObserver.send({type:"focus",thread_id:"A"});await uiObserver.barrier();
  const beforeTest=readFileSync(journal,"utf8");
  await setInput('.voice-shortcuts > label input',"VIOLET doorway!");
  await evaluate(`Array.from(document.querySelectorAll('.voice-shortcuts > button')).find(b=>b.textContent==='Test alias').click()`);
  assert.ok(await until(`document.querySelector('.voice-shortcuts [role="status"]').textContent.includes('Preview:')`));
  assert.equal(readFileSync(journal,"utf8"),beforeTest,"Test alias never executes or saves");
  await evaluate(`Array.from(document.querySelectorAll('.voice-shortcuts li:first-child button')).find(b=>b.textContent==='Try now').click()`);
  assert.ok(await until(`document.querySelector('.voice-shortcuts [role="status"]').textContent.includes('applied')`));
  assert.equal((await connection()).snapshot.active_by.you,"B");
  for(const action of ["Disable","Delete"]){
    await evaluate(`Array.from(document.querySelectorAll('.voice-shortcuts li:first-child button')).find(b=>b.textContent===${JSON.stringify(action)}).click()`);
    assert.ok(await until(`Array.from(document.querySelectorAll('.voice-shortcuts > button')).some(b=>b.textContent==='Undo')`));
    await evaluate(`Array.from(document.querySelectorAll('.voice-shortcuts > button')).find(b=>b.textContent==='Undo').click()`);
    assert.ok(await until(`document.querySelector('.voice-shortcuts [role="status"]').textContent.includes('Saved.') && !Array.from(document.querySelectorAll('.voice-shortcuts > button')).some(b=>b.textContent==='Undo')`));
  }
  await setInput('.voice-shortcuts form input',"Editable transport draft");
  const ownedPort=port;await stop();
  assert.ok(await until(`document.querySelector('.voice-shortcuts form button[type="submit"]').disabled`));
  assert.equal(await evaluate(`document.querySelector('.voice-shortcuts form input').value`),"Editable transport draft");
  await start(ownedPort);
  assert.ok(await until(`!document.querySelector('.voice-shortcuts form button[type="submit"]').disabled`,10000));
  assert.equal(await evaluate(`document.querySelector('.voice-shortcuts form input').value`),"Editable transport draft");
  await evaluate(`Array.from(document.querySelectorAll('.voice-shortcuts form button')).find(b=>b.textContent==='Cancel edit').click()`);
  for(const width of [1440,390]) for(const theme of ["light","dark"]){
    await page("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:false});
    await page("Emulation.setEmulatedMedia",{features:[{name:"prefers-color-scheme",value:theme},{name:"prefers-reduced-motion",value:"reduce"}]});
    await evaluate(`document.documentElement.style.fontSize='';document.querySelector('.voice-shortcuts h2').scrollIntoView({block:'start'})`);
    await sleep(100);
    const normalShot=await page("Page.captureScreenshot",{format:"png"});writeFileSync(join(dir,`${width}-${theme}.png`),Buffer.from(normalShot.data,"base64"));
    await evaluate(`document.documentElement.style.fontSize='200%'`);
    await sleep(150);
    assert.ok(await evaluate(`(()=>{const c=document.querySelector('.voice-shortcuts'),r=c.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight&&c.scrollWidth<=c.clientWidth+1;})()`),`card reachable at ${width}, ${theme}, 200% text`);
    await evaluate(`document.querySelector('.voice-shortcuts form button[type=submit]').focus();document.querySelector('.voice-shortcuts form button[type=submit]').scrollIntoView({block:'center'})`);
    const shot=await page("Page.captureScreenshot",{format:"png"});writeFileSync(join(dir,`${width}-${theme}-200.png`),Buffer.from(shot.data,"base64"));
    await page("Input.dispatchKeyEvent",{type:"keyDown",key:"Tab",code:"Tab",windowsVirtualKeyCode:9});await page("Input.dispatchKeyEvent",{type:"keyUp",key:"Tab",code:"Tab",windowsVirtualKeyCode:9});
    assert.ok(await evaluate(`document.querySelector('.voice-shortcuts').contains(document.activeElement)`),"keyboard remains in card controls");
    assert.ok(await evaluate(`(()=>{for(const control of document.querySelectorAll('.voice-shortcuts input,.voice-shortcuts select,.voice-shortcuts button:not(:disabled)')){control.scrollIntoView({block:'center'});const r=control.getBoundingClientRect();let top=0,bottom=document.querySelector('.shell-composer').getBoundingClientRect().top;for(let p=control.parentElement;p;p=p.parentElement){if(/auto|scroll|hidden/.test(getComputedStyle(p).overflowY)){const b=p.getBoundingClientRect();top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom);}}if(r.top<top-1||r.bottom>bottom+1)return false;}return true;})()`),"all controls scroll into reach above composer");
  }
  await page("Emulation.setDeviceMetricsOverride",{width:390,height:520,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.querySelector('.voice-shortcuts form input').focus();document.querySelector('.voice-shortcuts form input').scrollIntoView({block:'nearest'})`);
  assert.ok(await evaluate(`(()=>{const r=document.activeElement.getBoundingClientRect(),c=document.querySelector('.voice-shortcuts').getBoundingClientRect();return r.top>=c.top&&r.bottom<=c.bottom&&c.bottom<=innerHeight;})()`),"editable control stays reachable in a reduced viewport");
  await evaluate(`document.documentElement.style.fontSize=''`);
  await page("Emulation.setDeviceMetricsOverride",{width:390,height:900,deviceScaleFactor:1,mobile:false});
  await click('[data-guide="catalog"]');assert.ok(await until(`!!document.querySelector('[data-row="voice-shortcuts"] [role="switch"]')`));
  await click('[data-row="voice-shortcuts"] [role="switch"]');assert.ok(await until(`!document.querySelector('.voice-shortcuts')`));
  await page("Page.reload");assert.ok(await until(`!!document.querySelector('[data-guide="catalog"]')`));assert.equal(await evaluate(`!!document.querySelector('.voice-shortcuts')`),false);
  await browser.close();browser=null;
  // Source removal is an isolated journal fixture while stopped, never a shared live map.
  await stop();appendFileSync(journal,JSON.stringify({type:"thread_removed",thread_id:"B"})+"\n");await start();c=await connection();
  assert.ok(c.snapshot.aliases.every(a=>a.target.kind!=="open_topic"||a.unavailable&&!a.enabled));
  assert.ok(c.snapshot.aliases.every(a=>a.target.topic_id==="B"),"no retargeting");
  writeFileSync(join(dir,"evidence.json"),JSON.stringify({result:"passed",screenshots:["1440-light.png","1440-dark.png","390-light.png","390-dark.png"],fixture:"synthetic keyless core; no microphone or real provider exercised"},null,2));
  console.log(`c10-aliases-check: ok; evidence ${dir}`);
} finally {if(browser)await browser.close();await stop();}
