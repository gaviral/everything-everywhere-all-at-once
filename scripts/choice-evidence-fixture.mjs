// Owned, keyless fixture process and fresh browser only; no shared map or accounts.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtempSync,mkdirSync,writeFileSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {openPage,ready,sleep} from './headless.mjs';
export {sleep};
export async function fixture(name,changes=[]){
  assert.ok(['1','all'].includes(process.env.PRECHECK_PAGES),'Run with PRECHECK_PAGES=1 or all');assert.equal(ready(),'');
  const root=new URL('..',import.meta.url).pathname,out=realpathSync(mkdtempSync(join(tmpdir(),name+'-'))),data=join(out,'data'),launch=join(out,'launch');mkdirSync(data);mkdirSync(launch);
  writeFileSync(join(data,'journal.jsonl'),changes.map(JSON.stringify).join('\n')+'\n');
  const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;assert.ok(![4360,4399].includes(port));await new Promise(r=>reserve.close(r));
  const base=`http://127.0.0.1:${port}`;let child;const sockets=[];
  const start=async()=>{child=spawn(resolve(root,'core/target/debug/e2a2o-core'),[],{cwd:launch,env:{PATH:process.env.PATH,PORT:String(port),E2A2O_DATA:data,E2A2O_UI:resolve(root,'ui/dist'),PICTURES:'off'},stdio:['ignore','pipe','pipe']});
    const log=chunk=>writeFileSync(join(out,'core.log'),chunk,{flag:'a'});child.stdout.on('data',log);child.stderr.on('data',log);
    writeFileSync(join(out,'pids.jsonl'),JSON.stringify({event:'start',pid:child.pid,port})+'\n',{flag:'a'});
    for(let n=0;n<300;n++){if(child.exitCode!==null)throw Error(`owned core exited ${child.exitCode}; ${out}`);if(await fetch(base+'/room',{signal:AbortSignal.timeout(500)}).then(r=>r.ok).catch(()=>false))return;await sleep(50);}throw Error('owned core not ready '+out);};
  const stop=async()=>{for(const ws of sockets)ws.close();sockets.length=0;if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}child=null;};
  const connect=async(name='you',extra='')=>{const ws=new WebSocket(base.replace('http','ws')+'/ws?name='+encodeURIComponent(name)+extra);sockets.push(ws);const received=[];ws.onmessage=e=>received.push(JSON.parse(e.data));await once(ws,'open');
    const until=async predicate=>{for(let n=0;n<200;n++){const found=received.find(predicate);if(found)return found;await sleep(25);}throw Error('missing receipt '+out);};await until(m=>m.type==='snapshot');return {ws,received,until,send:m=>ws.send(JSON.stringify(m))};};
  const screenshots=async(browser,selector,controlText)=>{for(const width of [1440,390])for(const theme of ['light','dark'])for(const scale of [1,2]){
    await browser.page('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await browser.page('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme},{name:'prefers-reduced-motion',value:'reduce'}]});
    await browser.evaluate(`document.documentElement.style.fontSize=${JSON.stringify(scale*100+'%')};document.querySelector(${JSON.stringify(selector)}).scrollTop=0`);await sleep(100);
    assert.equal(await browser.evaluate(`document.documentElement.scrollWidth>innerWidth+1`),false,'no page overflow at '+width+'/'+scale);
    const png=await browser.page('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,`${width}-${theme}-${scale}.png`),Buffer.from(png.data,'base64'));
    if(controlText){
      const rect=await browser.evaluate(`(()=>{const b=[...document.querySelector(${JSON.stringify(selector)}).querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(controlText)});b.scrollIntoView({block:'center'});b.focus();const r=b.getBoundingClientRect();const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {top:r.top,bottom:r.bottom,visible:b.checkVisibility(),uncovered:b===top||b.contains(top)};})()`);
      assert.ok(rect.visible&&rect.uncovered&&rect.top>=0&&rect.bottom<=820,'primary control reachable above composer '+width+'/'+scale);
      const controls=await browser.page('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,`${width}-${theme}-${scale}-controls.png`),Buffer.from(controls.data,'base64'));
    }

  }};
  await start();return {out,data,base,start,stop,connect,screenshots,open:()=>openPage('about:blank'),close:stop};
}
export const thread={id:'schedule',title:'Travel plan',parent_id:null,status:'open',last_point:'',touched_ms:1,tags:[],picture:null,dropped_by:''};
export const thoughts=[['q','How should we travel?','Colleague'],['a','Take the train','Colleague'],['b','Take the bus','Reviewer'],['pro','Train is quicker','Reviewer'],['con','Train costs more','Colleague']].map(([id,text,speaker])=>({id,text,speaker,point:text,thread_id:thread.id,placed:true,unclear:'',guess:'',heard:'',fixed:'',complete:true,at_ms:1,place_ms:null,decided:false}));
export const seed=[{type:'thread_added',thread},...thoughts.map(thought=>({type:'thought_added',thought})),{type:'apps_seeded'}];
export async function toggle(browser,id,on){
  await browser.evaluate(`document.querySelector('[data-guide="catalog"]').click()`);
  const field=`document.querySelector('[data-row="${id}"] [role="switch"]')`;
  assert.ok(await browser.until(`!!${field}`),'Features row exists');
  assert.equal(await browser.evaluate(`${field}.getAttribute('aria-checked')`),String(!on));
  await browser.evaluate(`${field}.click();document.querySelector('.shell-rail-close').click()`);
}
export async function select(browser,selector,value){await browser.evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(selector)});s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
export async function click(browser,selector,text){await browser.evaluate(`[...document.querySelector(${JSON.stringify(selector)}).querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)}).click()`);}
