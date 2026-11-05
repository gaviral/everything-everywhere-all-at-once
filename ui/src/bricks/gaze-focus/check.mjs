// One focused acceptance check. Synthetic canvas video only; never touches camera or microphone hardware.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../../node_modules/vite/dist/node/index.js';
import { openPage } from '../../../../scripts/headless.mjs';

const artifacts = mkdtempSync(join(tmpdir(), 'gaze-focus-check-'));
const root = new URL('../../../', import.meta.url).pathname;
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import Gaze from '/src/bricks/gaze-focus/index.tsx';
const root = createRoot(document.getElementById('root'));
window.sent = []; window.accept = true;
window.mountGaze = (full = false, visit = 'one') => {
  const threads = full ? [{id:'garden',title:'A shared garden'}, {id:'water',title:'Keep the rain'}] : [];
  const map = {threads, thoughts:[], connected:true, me:'demo',visitKey:visit};
  root.render(React.createElement(React.Fragment, null,
    full && React.createElement('div', {style:{display:'flex',gap:150,margin:'110px 350px',fontSize:32}},
      ...threads.map(t=>React.createElement('article',{'data-thread':t.id,key:t.id,style:{padding:35,borderRadius:30,background:'#203a34'}},t.title))),
    React.createElement(Gaze,{map,actions:{addThought:text=>{window.sent.push(text);return window.accept;}}})));
};
window.unmountGaze = () => root.render(null);
window.mountGaze();
`;
const server = await createServer({root, configFile:false, cacheDir:join(artifacts,'vite-cache'),
  optimizeDeps:{include:['react','react-dom/client']},
  server:{host:'127.0.0.1',port:0,hmr:false,ws:false,watch:null},
  plugins:[{name:'gaze-fixture',resolveId(id){if(id==='/gaze-fixture.js')return id;},load(id){if(id==='/gaze-fixture.js')return fixture;},
    configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url!=='/')return next();
      res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/',`<!doctype html><html><head><style>
      :root{--bg:#111b1a;--card:#1b2927;--ink:#f4f4e9;--muted:#bac7bd;--line:#42584e;--accent:#b9e5bc}body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui}
      </style></head><body><div id="root"></div><script type="module" src="/gaze-fixture.js"></script></body></html>`));});}}]});
let browser;
try {
  const rules = await server.ssrLoadModule('/src/bricks/gaze-focus/estimate.ts');
  assert.equal(JSON.parse(readFileSync(new URL('./brick.json',import.meta.url))).defaultOn,false);
  assert.deepEqual(rules.smooth({x:0,y:0},{x:1,y:1}),{x:.22,y:.22});
  assert.deepEqual(rules.facePosition({boundingBox:{x:0,y:0,width:80,height:60},landmarks:[{type:'eye',locations:[{x:20,y:15},{x:40,y:15}]}]},80,60),{x:.625,y:.25});
  assert.equal(rules.brightnessPosition(new Uint8ClampedArray(80*60*4),80,60),null);
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await openPage('about:blank',{width:1440,height:1000,preserveProfile:true});
  const {page,evaluate,until} = browser;
  await page('Page.enable');
  await page('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.cameraCalls=0;window.stops=0;window.faceX=40;window.nativeFails=false;window.deferCamera=false;
    navigator.mediaDevices.getUserMedia=async constraints=>{
      window.cameraCalls++;window.constraints=constraints;
      if(window.deferCamera)await new Promise(resolve=>window.resolveCamera=resolve);
      const canvas=document.createElement('canvas');canvas.width=80;canvas.height=60;
      const ctx=canvas.getContext('2d');ctx.fillStyle='black';ctx.fillRect(0,0,80,60);ctx.fillStyle='white';ctx.fillRect(10,5,30,50);
      const stream=canvas.captureStream(5);window.mockCanvas=canvas;
      for(const track of stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{window.stops++;stop();};}
      return stream;
    };
    window.FaceDetector=class{async detect(){if(window.nativeFails)throw Error('unsupported');return [{boundingBox:{x:window.faceX-10,y:15,width:20,height:30}}];}};
  `});
  await page('Page.navigate',{url:base});
  const wait = async (condition,label) => assert.ok(await until(condition,8000),`TIMING: ${label}`);
  const click = text => evaluate(`[...document.querySelectorAll('.gaze-focus button')].find(b=>b.textContent===${JSON.stringify(text)}).click()`);
  const fill = text => evaluate(`(()=>{const field=document.querySelector('.gaze-focus textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,${JSON.stringify(text)});field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait(`document.querySelector('.gaze-focus-current strong')?.textContent==='A shared garden'`,'demo shows an example topic');
  assert.equal(await evaluate('window.cameraCalls'),0,'demo requests no media');
  await page('Page.captureScreenshot',{format:'png'}).then(s=>writeFileSync(join(artifacts,'empty-demo.png'),Buffer.from(s.data,'base64')));
  await fill('Could this store rainwater?');
  await click('Send with focus ↗');
  await wait('window.sent.length===1','thought submitted');
  assert.match(await evaluate('window.sent[0]'),/Could this store rainwater\?[\s\S]*simulated demo, not measured gaze[\s\S]*example topic “A shared garden”/);
  await evaluate('window.mountGaze(true,"full")');
  await wait(`document.querySelector('.gaze-focus-current strong')?.textContent==='A shared garden' && !document.querySelector('.gaze-focus-example')`,'real topic receives demo focus');
  await wait(`document.querySelector('.gaze-focus-current strong')?.textContent==='Keep the rain'`,'simulated path moves to the next visible topic');
  await click('Pause');
  await wait(`document.querySelector('.gaze-focus-toggle small').textContent==='Paused · camera off' && !document.querySelector('.gaze-focus-halo')`,'pause clears highlight');
  await click('Use camera');
  await wait(`document.querySelector('.gaze-focus-toggle small').textContent==='Camera · local only'`,'explicit camera tap starts synthetic video');
  assert.equal(await evaluate('window.constraints.audio'),false,'microphone excluded');
  await wait(`document.querySelector('.gaze-focus-body').textContent.includes('Face / eye position · coarse')`,'native detector path');
  await click('Stop camera');
  await wait('window.stops===1','stop releases video track');
  await evaluate('window.nativeFails=true');
  await click('Use camera');
  await wait(`document.querySelector('.gaze-focus-body').textContent.includes('Brightness proxy · very coarse') && document.querySelector('.gaze-focus-toggle small').textContent==='Camera · local only'`,'native failure uses local brightness');
  await evaluate('window.dispatchEvent(new Event("pagehide"))');
  await wait('window.stops===2','leaving releases video track');
  await evaluate('window.deferCamera=true');
  await click('Use camera');
  await wait('typeof window.resolveCamera==="function"','permission request pending');
  await evaluate('window.unmountGaze()');
  await wait('!document.querySelector(".gaze-focus")','brick unmounted');
  await evaluate('window.resolveCamera()');
  await wait('window.stops===3','late permission result immediately released after unmount');
  await evaluate('window.mountGaze(false,"phone")');
  await page('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await wait(`!!document.querySelector('.gaze-focus-example') && !!document.querySelector('.gaze-focus-halo')`,'phone demo ready');
  assert.ok(await evaluate(`(()=>{const r=document.querySelector('.gaze-focus').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&r.top>=0;})()`),'panel fits phone');
  await page('Page.captureScreenshot',{format:'png'}).then(s=>writeFileSync(join(artifacts,'phone-demo.png'),Buffer.from(s.data,'base64')));
  console.log(`PASS gaze-focus: demo, live topic highlight, context send, native/fallback synthetic camera, cleanup and phone. Artifacts: ${artifacts}`);
} finally { await browser?.close(); await server.close(); }
