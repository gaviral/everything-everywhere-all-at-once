// Mounted app, fresh profile, synthetic World only. No core/model/microphone required.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ready, standInCore, openPage, sleep } from './headless.mjs';
assert.equal(ready(), '', 'installed browser and built UI required');
const title = 'Synthetic topic  with preserved spaces\nand complete title';
const words = 'W'.repeat(180) + '\n\n' + Array.from({length:35},(_,i)=>`Paragraph ${i + 1}  preserves spaces.\nMore recognized words.`).join('\n\n');
const point = 'Complete displayed point  with spaces\nand another line.';
const now = Date.now();
const thought = (id,text,point,at)=>({id,text,point,thread_id:'T1',speaker:'you',placed:true,unclear:'',complete:true,at_ms:at,place_ms:0});
const world = {threads:[{id:'T1',title,parent_id:null,status:'open',last_point:point,touched_ms:now,tags:[],picture:null,dropped_by:''}],thoughts:[thought('s1',words,point,now-1000),thought('s2','Second source words','Second ordered point',now)],active:'T1',active_by:{you:'T1'},stay_here:'T1',suggestions:[],actions:[],merged:{},apps:[],apps_seeded:true,recaps:[],notes:{},proposals:[],topics:{}};
const core = await standInCore(()=>[{type:'snapshot',world}]);
let browser;
const out = process.env.SHOTS || join(tmpdir(),'e2a2o-i-content');
mkdirSync(out,{recursive:true});
try {
  browser = await openPage(`http://127.0.0.1:${core.port}/`);
  const {page,evaluate,until} = browser;
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  assert.ok(await until(`!!document.querySelector('.spine-point')`));
  assert.equal(await evaluate(`document.querySelectorAll('[aria-label="Inspect full content"]').length`),0,'fresh profile off');
  const features = async () => {
    await evaluate(`document.querySelector('[data-tab="catalog"]')?.click();`);
    if (!await until(`!!document.querySelector('[role="switch"][aria-label="Full content"]')`,500)) {
      await evaluate(`[...document.querySelectorAll('button')].find(b=>b.dataset.guide === 'catalog')?.click()`);
    }
    assert.ok(await until(`!!document.querySelector('[role="switch"][aria-label="Full content"]')`),'Features opens');
  };
  await features();
  assert.equal(await evaluate(`document.querySelector('[aria-label="Full content"]').getAttribute('aria-checked')`),'false');
  await click('[role="switch"][aria-label="Full content"]');
  await click('[aria-label="Close the panel"]');
  await page('Page.reload');
  assert.ok(await until(`!!document.querySelector('.spine-point [aria-label="Inspect full content"]')`),'enabled survives reload');
  await sleep(600);
  const camera = ()=>evaluate(`document.querySelector('.spine-frame .react-flow__viewport').style.transform`);
  const key = key=>page('Input.dispatchKeyEvent',{type:'keyDown',key,...(key==='Enter'?{text:'\r'}:{}),windowsVirtualKeyCode:({Enter:13,Tab:9,Escape:27})[key]??0});
  const open = async selector => {
    // Keep hover from revealing the tools: enter the node, then Tab to Inspect and press Enter.
    await page('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
    await evaluate(`window.source = document.querySelector(${JSON.stringify(selector)}); source.closest('.spine-tools').parentElement.querySelector(':scope > button, :scope > [role="button"]').focus();`);
    for (let i=0;i<20 && !await evaluate('document.activeElement === source');i++) {
      await key('Tab');
      await page('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab'});
    }
    assert.equal(await evaluate('document.activeElement === source'),true,'keyboard reaches Inspect');
    await key('Enter');
    await page('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter'});
    assert.ok(await until(`document.querySelector('dialog.full-content')?.open`));
    assert.equal(await evaluate(`getComputedStyle(source.closest('.spine-tools')).display`),'none','source actions hide while inspector has focus');
  };
  const original = await camera();
  await open('.spine-point [aria-label="Inspect full content"]');
  assert.equal(await evaluate(`document.querySelector('[data-full-title]').textContent`),title);
  assert.equal(await evaluate(`document.querySelector('[data-full-words]').textContent`),words);
  assert.equal(await evaluate(`document.querySelector('[data-full-point]').textContent`),point);
  assert.equal(await evaluate(`document.querySelector('[data-full-displayed]').textContent`),point);
  const metrics = ()=>evaluate(`(()=>{const e=document.querySelector('.full-content-card'),s=getComputedStyle(e),r=e.getBoundingClientRect();return {w:r.width,h:r.height,white:s.whiteSpace,overflow:s.overflow,line:s.webkitLineClamp,font:s.fontSize}})()`);
  const natural = await metrics();
  assert.ok(natural.w>=2100,'unbroken line exceeds 2,100px');
  assert.equal(natural.white,'pre'); assert.equal(natural.overflow,'visible'); assert.equal(natural.line,'none'); assert.equal(natural.font,'16px');
  // Travel to the far right/bottom and back using the actual inspector camera.
  const rightSteps = Math.max(0, Math.ceil((natural.w + 24 - 1400) / 100));
  const downSteps = Math.max(0, Math.ceil((natural.h + 96 - 860) / 100));
  for(let i=0;i<rightSteps;i++) await key('ArrowRight');
  for(let i=0;i<downSteps;i++) await key('ArrowDown');
  const far = await evaluate(`(()=>{const r=document.querySelector('.full-content-card').getBoundingClientRect();return {right:r.right,bottom:r.bottom}})()`);
  assert.ok(far.right>100 && far.right<1440 && far.bottom>100 && far.bottom<900,'both far ends reached');
  for(let i=0;i<rightSteps;i++) await key('ArrowLeft');
  for(let i=0;i<downSteps;i++) await key('ArrowUp');
  assert.ok(await evaluate(`document.querySelector('.full-content-card').getBoundingClientRect().x>=23`),'start reached again');
  const shot = async name => { const {data}=await page('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,name+'.png'),Buffer.from(data,'base64')); };
  await shot('desktop');
  await click('.full-content-toolbar button[aria-pressed]');
  const wrapped = await metrics();
  assert.ok(wrapped.w<natural.w && wrapped.h>natural.h,'Wrap resizes content');
  assert.equal(await evaluate(`document.querySelector('[data-full-words]').textContent`),words);
  await click('.full-content-toolbar button');
  assert.ok(await until(`!document.querySelector('.full-content')`));
  await sleep(100);
  assert.equal(await camera(),original,'thought close restores exact camera');
  assert.equal(await evaluate('document.activeElement === source'),true,'thought source focus returns');
  await open('.spine-point [aria-label="Inspect full content"]');
  await click('.full-content-toolbar button[aria-pressed]');
  await page('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await page('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await shot('phone-wrap');
  assert.ok(await evaluate(`Array.from(document.querySelectorAll('.full-content-toolbar button')).every(e=>{const r=e.getBoundingClientRect();return r.x>=0&&r.right<=390&&r.y>=0&&r.bottom<844})`),'fixed controls reachable at 390px');
  await click('.full-content-toolbar button');
  assert.ok(await until(`!document.querySelector('.full-content')`));
  assert.equal(await evaluate('document.activeElement === source'),true,'source focus returns');
  // Restore desktop before comparing the map camera; resizing itself legitimately changes map layout.
  await page('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await sleep(300);
  const beforeTopic = await camera();
  await open('.spine-head [aria-label="Inspect full content"]');
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('[data-full-point]')).map(e=>e.textContent)`),[point,'Second ordered point']);
  assert.equal(await evaluate(`document.querySelector('[data-full-title]').textContent`),title);
  await key('Escape');
  assert.ok(await until(`!document.querySelector('.full-content')`));
  await sleep(100);
  assert.equal(await camera(),beforeTopic,'exact camera restored');
  assert.equal(await evaluate('document.activeElement === source'),true);
  await features(); await click('[role="switch"][aria-label="Full content"]'); await click('[aria-label="Close the panel"]');
  assert.equal(await evaluate(`document.querySelectorAll('[aria-label="Inspect full content"]').length`),0,'disabled removes actions');
  assert.equal(await evaluate(`!!document.querySelector('.full-content')`),false);
  await page('Page.reload');
  assert.ok(await until(`!!document.querySelector('.spine-point')`));
  assert.equal(await evaluate(`document.querySelectorAll('[aria-label="Inspect full content"]').length`),0,'disabled survives reload');
  assert.equal(core.heard.filter(m=>m.type==='position').length,0,'inspection never writes positions');
  console.log('i-content-check: ok (fresh off, Features/reload, exact source strings, natural sizing, both ends, Wrap, topic order, keyboard open without hover, focus/camera, disable; desktop/390px screenshots in '+out+')');
} finally { await browser?.close(); core.close(); }
