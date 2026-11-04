// Synthetic browser and routing proof. No shared application, microphone or model calls.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../ui/node_modules/vite/dist/node/index.js';
import react from '../ui/node_modules/@vitejs/plugin-react/dist/index.js';
import { openPage } from './headless.mjs';
const cacheDir = mkdtempSync(join(tmpdir(), 'sketch-exchange-vite-'));
const server = await createServer({ configFile:false, root:new URL('../ui',import.meta.url).pathname,
  plugins:[react()], cacheDir, server:{host:'127.0.0.1',port:0,hmr:false,ws:false,watch:null},
});
let browser;
try {
  const { SketchTransport } = await server.ssrLoadModule('/src/msg1351/sketch-exchange/SketchTransport.ts');
  const { validDrawing, sketchExchangeFeature } = await server.ssrLoadModule('/src/msg1351/sketch-exchange/contract.ts');
  assert.equal(sketchExchangeFeature.defaultEnabled,false);
  assert.equal(sketchExchangeFeature.imageCapability.available,false);
  const identities = ['tablet','tv','other'].map(id=>({id,label:id}));
  const listeners = new Map(); let sent=[];
  const adapters = identities.map(self=>({self,targets:identities.filter(s=>s.id!==self.id),
    subscribe:hear=>{listeners.set(self.id,hear);return()=>listeners.delete(self.id);},
    send:m=>{sent.push(structuredClone(m));listeners.get(m.to)?.(structuredClone(m));},
  }));
  const [source,tv,other] = adapters.map(a=>new SketchTransport(a));
  const drawing = [[[10,20],[30,40]]];
  assert.throws(()=>source.send('tv',drawing));
  for(const s of [source,tv,other])s.setEnabled(true);
  assert.throws(()=>source.send('',drawing));
  const id=source.send('tv',drawing);
  drawing[0][0][0]=999;
  assert.deepEqual(tv.exchanges[0].original,[[[10,20],[30,40]]]);
  assert.equal(source.exchanges[0].received,true);
  assert.equal(other.exchanges.length,0);
  listeners.get('tablet')({kind:'reply',exchangeId:id,from:'other',to:'tablet',drawing:[[[0,0]]]});
  assert.equal(source.exchanges[0].reply,undefined);
  tv.reply(id,[[[50,50],[100,100]]]);
  assert.deepEqual(source.exchanges[0].reply,tv.exchanges[0].reply);
  assert.equal(tv.exchanges[0].replyReceived,true);
  assert.deepEqual(source.exchanges[0].original,[[[10,20],[30,40]]]);
  assert.throws(()=>tv.reply(id,[[[1,2]]]));
  tv.setEnabled(false);source.send('tv',[[[1,1],[2,2]]]);
  assert.equal(source.exchanges[1].received,false);
  tv.setEnabled(true);assert.equal(tv.exchanges.length,1,'no reconnect replay');
  source.setEnabled(false);const count=sent.length;assert.throws(()=>source.send('tv',drawing));assert.equal(sent.length,count);
  assert.equal(validDrawing([[[NaN,0]]]),false);assert.equal(validDrawing([[[1001,0]]]),false);
  assert.equal(validDrawing([Array.from({length:2049},()=>[1,1])]),false);
  const broken=new SketchTransport({...adapters[0],send:()=>{throw Error('offline');}});
  broken.setEnabled(true);broken.send('tv',[[[1,2]]]);assert.equal(broken.exchanges.length,1);assert.match(broken.notice,/unavailable/);
  for(const s of [source,tv,other,broken])s.dispose();
  console.log('PASS routing: opt-in, exact target, original snapshot, reply correlation, bounds, disconnect, failed queue');
  await server.listen();
  const port=server.httpServer.address().port;
  browser=await openPage(`http://127.0.0.1:${port}/src/msg1351/sketch-exchange/preview.html`);
  const {evaluate,until,page}=browser;
  assert.ok(await until(`document.querySelectorAll('.sketch-exchange').length===3`,20000));
  const click=async(selector)=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const panel=i=>`.sketch-exchange:nth-child(${i})`;
  assert.ok(await evaluate(`[...document.querySelectorAll('.sketch-switch input')].every(e=>!e.checked)`));
  assert.ok(await evaluate(`document.querySelector('${panel(1)} > button').disabled`));
  for(let i=1;i<=3;i++)await click(`${panel(i)} .sketch-switch input`);
  assert.ok(await until(`[...document.querySelectorAll('.sketch-switch input')].every(e=>e.checked) && !document.querySelector('fieldset').disabled`));
  // Keyboard draws an accessible shape without requiring a pointer.
  await evaluate(`document.querySelector('${panel(1)} .sketch-actions button').focus()`);
  assert.equal(await evaluate(`document.activeElement.textContent`),'Add box','keyboard focus reaches enabled drawing action');
  await page('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});
  await page('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  assert.ok(await until(`document.querySelector('${panel(1)} .sketch-pad polyline')?.getAttribute('points').length>0`));
  // Add an actual pointer stroke to the original.
  const r=await evaluate(`document.querySelector('${panel(1)} .sketch-pad').getBoundingClientRect().toJSON()`);
  await page('Input.dispatchMouseEvent',{type:'mousePressed',x:r.x+30,y:r.y+30,button:'left',clickCount:1});
  await page('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x+90,y:r.y+70,button:'left',buttons:1});
  await page('Input.dispatchMouseEvent',{type:'mouseReleased',x:r.x+110,y:r.y+90,button:'left',clickCount:1});
  await evaluate(`const s=document.querySelector('${panel(1)} select');s.value='tv';s.dispatchEvent(new Event('change',{bubbles:true}))`);
  await click(`${panel(1)} > button`);
  assert.ok(await until(`document.querySelector('${panel(1)} [role=status]').textContent.includes('confirmed receipt')`));
  assert.equal(await evaluate(`document.querySelectorAll('${panel(3)} article').length`),0);
  const originals=await evaluate(`JSON.stringify([...document.querySelectorAll('${panel(1)} article [aria-label="Preserved original sketch"] polyline')].map(e=>e.getAttribute('points')))`);
  assert.equal(await evaluate(`JSON.stringify([...document.querySelectorAll('${panel(2)} article [aria-label="Preserved original sketch"] polyline')].map(e=>e.getAttribute('points')))`),originals);
  await click(`${panel(2)} article .sketch-actions button`);
  await click(`${panel(2)} article > button`);
  assert.ok(await until(`!!document.querySelector('[aria-label="Visual reply from selected display"]')`));
  assert.ok(await until(`document.querySelector('${panel(2)} [role=status]').textContent.includes('confirmed visual reply receipt')`));
  await click(`${panel(1)} .sketch-actions button:last-child`);
  assert.equal(await evaluate(`JSON.stringify([...document.querySelectorAll('${panel(1)} article [aria-label="Preserved original sketch"] polyline')].map(e=>e.getAttribute('points')))`),originals);
  const shot=async(name)=>{if(!process.env.SHOTS)return;mkdirSync(process.env.SHOTS,{recursive:true});const s=await page('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(join(process.env.SHOTS,name+'.png'),Buffer.from(s.data,'base64'));};
  await shot('sketch-exchange-desktop');
  await page('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.ok(await until(`document.documentElement.scrollWidth<=innerWidth`));
  await shot('sketch-exchange-phone');
  await page('Emulation.setDeviceMetricsOverride',{width:320,height:844,deviceScaleFactor:1,mobile:true});
  assert.ok(await until(`document.documentElement.scrollWidth<=innerWidth`));
  await evaluate(`document.documentElement.style.fontSize='200%'`);
  assert.ok(await until(`document.documentElement.scrollWidth<=innerWidth`));
  assert.ok(await evaluate(`parseFloat(getComputedStyle(document.querySelector('.sketch-exchange')).fontSize)>=32`));
  await shot('sketch-exchange-large-text');
  await evaluate(`document.documentElement.style.fontSize='100%';document.querySelector('${panel(1)} .sketch-pad').scrollIntoView({block:'center'})`);
  await page('Emulation.setTouchEmulationEnabled',{enabled:true});
  const touchRect=await evaluate(`document.querySelector('${panel(1)} .sketch-pad').getBoundingClientRect().toJSON()`);
  const strokeCount=await evaluate(`document.querySelectorAll('${panel(1)} .sketch-pad polyline').length`);
  await page('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touchRect.x+20,y:touchRect.y+20}]});
  await page('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touchRect.x+70,y:touchRect.y+50}]});
  await page('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.ok(await until(`document.querySelectorAll('${panel(1)} .sketch-pad polyline').length===${strokeCount+1}`));
  // Turn off the selected receiver, send and verify honest missing acknowledgment.
  await click(`${panel(2)} .sketch-switch input`);
  await click(`${panel(1)} .sketch-actions button`);
  await click(`${panel(1)} > button`);
  assert.ok(await until(`document.querySelectorAll('${panel(1)} article').length===2`));
  assert.match(await evaluate(`document.querySelector('${panel(1)} [role=status]').textContent`),/Waiting/);
  assert.equal(await evaluate(`document.querySelectorAll('${panel(2)} article').length`),1);
  await click(`${panel(2)} .sketch-switch input`);
  assert.equal(await evaluate(`document.querySelectorAll('${panel(2)} article').length`),1);
  await click(`${panel(1)} .sketch-switch input`);
  assert.equal(await evaluate(`document.querySelector('${panel(1)} > button').disabled`),true);
  console.log('PASS browser: three sessions, keyboard + pointer drawing, selected display receipt, visual reply, original retained, 320/390px + 200% text + touch, off/on interruption');
} finally { await browser?.close(); await server.close(); }
