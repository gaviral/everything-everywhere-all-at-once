// Shared isolated test support: synthetic data, owned processes, ephemeral ports, no accounts.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openPage, ready, sleep } from './headless.mjs';
export { assert, randomUUID, sleep, writeFileSync, readFileSync, appendFileSync, join };
export const thread = { id:'T1',title:'Venue',parent_id:null,status:'open',last_point:'',touched_ms:1,tags:[],picture:null,dropped_by:'' };
export const thought = { id:'p1',speaker:'you',text:'When does the blue venue open?',point:'When does the blue venue open?',thread_id:'T1',placed:true,unclear:'',guess:'',heard:'',fixed:'',complete:true,at_ms:1,place_ms:0,decided:false };
export const provider = { status:'completed',model:'synthetic-provider',output:[{type:'message',content:[{type:'output_text',text:'The venue opens at nine.',annotations:[{type:'url_citation',title:'Venue hours',url:'https://example.com/hours',start_index:0,end_index:23}]}]}] };
export async function fixture(name, { research = false } = {}) {
  assert.equal(ready(),'','built UI and Chrome required; use PRECHECK_PAGES=1');
  const root=resolve(new URL('..',import.meta.url).pathname);
  const dir=realpathSync(mkdtempSync(join(tmpdir(),`${name}-`)));
  for(const d of ['run','data','shots'])mkdirSync(join(dir,d));
  const journal=join(dir,'data/journal.jsonl'), fixturePath=join(dir,'provider.json');
  writeFileSync(journal,[{type:'apps_seeded'},{type:'thread_added',thread},{type:'thought_added',thought},{type:'active_changed',thread_id:'T1',speaker:'you'}].map(JSON.stringify).join('\n')+'\n');
  writeFileSync(fixturePath,JSON.stringify(provider));
  let child, browser, port, output=''; const sockets=new Set();
  const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));port=reservation.address().port;await new Promise(r=>reservation.close(r));assert.ok(![4360,4399].includes(port));
  async function start(){
    child=spawn(join(root,'core/target/debug/e2a2o-core'),[],{cwd:join(dir,'run'),env:{PATH:process.env.PATH,TMPDIR:tmpdir(),PORT:String(port),E2A2O_DATA:join(dir,'data'),E2A2O_UI:join(root,'ui/dist'),MODEL_API_KEY:'',PICTURES:'off',RUST_LOG:'warn',...(research?{E2A2O_RESEARCH_FIXTURE:fixturePath}:{})},stdio:['ignore','pipe','pipe']});
    output='';for(const s of [child.stdout,child.stderr])s.on('data',b=>{output=(output+b).slice(-2000)});
    for(let i=0;i<200;i++){if(child.exitCode!==null)throw Error('isolated core exited: '+output);try{if((await fetch(`http://127.0.0.1:${port}/room`,{signal:AbortSignal.timeout(500)})).ok)return;}catch{}await sleep(50);}throw Error('isolated core unavailable: '+output);
  }
  async function stop(){for(const s of sockets)s.close();sockets.clear();if(child&&child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;}child=null;}
  async function connection(name='you'){
    const ws=new WebSocket(`ws://127.0.0.1:${port}/ws?identity=1&name=${encodeURIComponent(name)}`),seen=[];sockets.add(ws);ws.addEventListener('message',e=>seen.push(JSON.parse(e.data)));await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
    const wait=async predicate=>{for(let i=0;i<200;i++){const k=seen.findIndex(predicate);if(k>=0)return seen.splice(k,1)[0];await sleep(25);}throw Error('missing receipt: '+JSON.stringify(seen).slice(-1200));};
    const world=(await wait(m=>m.type==='snapshot')).world;
    const send=m=>ws.send(JSON.stringify(m));
    const barrier=async()=>{const id=randomUUID();send({type:'heartbeat',id});await wait(m=>m.type==='heartbeat'&&m.id===id);};
    return {ws,seen,world,wait,send,barrier};
  }
  async function snapshot(){const c=await connection();c.ws.close();return c.world;}
  async function page(){
    browser=await openPage('about:blank',{width:1440,height:1000});const {page,evaluate,until}=browser;
    await page('Page.enable');await page('Runtime.enable');await page('Network.enable');
    const external=[],errors=[],sent=[];
    browser.on('Runtime.exceptionThrown',e=>errors.push(e.exceptionDetails.text));
    browser.on('Network.webSocketFrameSent',e=>{try{sent.push(JSON.parse(e.response.payloadData))}catch{}});
    const origin=`http://127.0.0.1:${port}`;
    browser.on('Fetch.requestPaused',e=>{const local=e.request.url.startsWith(origin+'/');if(!local)external.push(e.request.url);void page(local?'Fetch.continueRequest':'Fetch.failRequest',local?{requestId:e.requestId}:{requestId:e.requestId,errorReason:'BlockedByClient'});});
    await page('Fetch.enable',{patterns:[{urlPattern:'*'}]});
    await page('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('e2a2o.toured','1');`});
    await page('Page.navigate',{url:origin+'/'});assert.ok(await until('!!document.querySelector("#type-a-thought")',15000));
    const click=async selector=>{assert.ok(await until(`!!document.querySelector(${JSON.stringify(selector)})`),selector);const r=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of ['mousePressed','mouseReleased'])await page('Input.dispatchMouseEvent',{type,...r,button:'left',clickCount:1});};
    const key=async(key,code,n)=>{for(const type of ['keyDown','keyUp'])await page('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:n});};
    const features=async()=>{if(!await evaluate('!!document.querySelector(".shell-catalog")'))await click('[data-guide=catalog]');};
    const closeFeatures=()=>key('Escape','Escape',27);
    const shot=async name=>{const s=await page('Page.captureScreenshot',{format:'png'});writeFileSync(join(dir,'shots',name+'.png'),Buffer.from(s.data,'base64'));};
    return {...browser,click,key,features,closeFeatures,shot,external,errors,sent};
  }
  return {dir,journal,fixturePath,port,start,stop,connection,snapshot,page,async close(){await browser?.close();await stop();}};
}
