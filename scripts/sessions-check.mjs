// Synthetic turns only. Pure partition tests plus the actual off/on and two-lens happy path.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { uiServer } from './ui-server.mjs';
import { ready, standInCore, openPage, sleep } from './headless.mjs';

const start = new Date(2026, 10, 3, 9).getTime();
const minute = 60000;
const topic = (id, title) => ({ id, title, parent_id: null, status: 'open', last_point: '', touched_ms: start, tags: [], picture: null, dropped_by: '' });
const threads = [topic('garden', 'Garden plans'), topic('weekend', 'Weekend trip')];
const texts = ['Plant herbs by the sunny window.', 'Bring small pots and fresh soil.', 'Take the train to the coast.', 'Pack a light bag for the walk.', 'Water the herbs before leaving.', 'Leave time to watch the sunset.'];
const times = [0, 2, 240, 242, 1440, 1442];
const thoughts = texts.map((text, i) => ({ id: `s${i+1}`, text, point: text, thread_id: i % 2 ? 'weekend' : 'garden', speaker: 'you', at_ms: start + times[i] * minute, placed: true, complete: true, unclear: '', place_ms: 0 }));
const input = { threads, thoughts, notes: {}, rooms: new Map(), positions: {}, shelf: new Map(), open: null, me: 'you', speakers: new Map() };
const server = await uiServer();
try {
  const { sessions, SESSION_GAP_MS } = await server.ssrLoadModule('/src/bricks/spine/sessions.ts');
  const { lensLayout } = await server.ssrLoadModule('/src/bricks/spine/lenses.ts');
  const turns = thoughts.map(t => ({ key: t.id, at: t.at_ms }));
  const before = JSON.stringify(turns);
  assert.equal(sessions([]).length, 0);
  assert.equal(sessions(turns).length, 3, 'three gap-separated sittings');
  assert.deepEqual(sessions([...turns].reverse()), sessions(turns), 'sorts without changing caller input');
  assert.equal(JSON.stringify(turns), before);
  assert.equal(sessions([{key:'a',at:start},{key:'b',at:start+SESSION_GAP_MS}]).length, 1, 'cutoff is inclusive');
  assert.equal(sessions([{key:'a',at:start},{key:'b',at:start+SESSION_GAP_MS+1}]).length, 2);
  const midnight = new Date(2026,10,4).getTime();
  assert.equal(sessions([{key:'a',at:midnight-1},{key:'b',at:midnight+1}]).length, 2, 'overnight breaks');
  assert.equal(sessions([0,1,2,3].map(i=>({key:String(i),at:start+i*120*minute}))).length, 4, 'three interior big gaps produce four sessions');
  const time = lensLayout(input, 'time'), topics = lensLayout(input, 'topics');
  assert.equal(time.items.filter(i=>i.session).length, 3);
  assert.deepEqual(time.items.filter(i=>i.session).map(i=>i.box.x), [0,396,792]);
  const cards = l => l.items.filter(i=>i.kind==='point').map(i=>[i.key,i.text,i.thoughts]).sort();
  assert.deepEqual(cards(time), cards(topics), 'same keys, full words and split memberships');
  const split = lensLayout({...input, thoughts:[...thoughts, {...thoughts[0], id:'s1b',thread_id:'weekend'}]},'topics');
  assert.deepEqual(split.byKey.get('p:s1').thoughts,['s1','s1b']);
  console.log('PASS sessions unit: calibrated cutoff, three sittings, boundaries, overnight, sorting, no mutation, identical cards');
} finally { await server.close(); }
if (ready()) throw new Error(ready());
const world = { threads, thoughts, active:'garden', active_by:{you:'garden'}, stay_here:null, anchors:{}, notes:{}, suggestions:[], actions:[], merged:{}, apps:[], apps_seeded:true, recaps:[], proposals:[], ai:[] };
const core = await standInCore(()=>[{type:'snapshot',world}], {port:0});
let browser;
try {
  browser = await openPage('about:blank', {width:1440,height:900});
  const {page,evaluate,until} = browser;
  await page('Page.enable');
  await page('Page.addScriptToEvaluateOnNewDocument', {source:`localStorage.setItem('e2a2o.toured','1'); window.errors=[]; addEventListener('error', e=>{if(!e.message.startsWith('ResizeObserver')) errors.push(e.message)});`});
  const url = `http://127.0.0.1:${core.port}/`;
  const click = async selector => {
    const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    assert.ok(await evaluate(`!!document.elementFromPoint(${p.x},${p.y})?.closest(${JSON.stringify(selector)})`),`reachable ${selector}`);
    for(const type of ['mousePressed','mouseReleased']) await page('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});
  };
  const key=async(key,code,n)=>{for(const type of ['keyDown','keyUp']) await page('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:n});};
  const setting=async()=>{await key('c','KeyC',67); assert.ok(await until(`!!document.querySelector('[data-row="conversation-spine"]')`)); await click('[data-row="conversation-spine"] button[role="switch"]');await key('Escape','Escape',27);await sleep(650);};
  await page('Page.navigate',{url});
  assert.ok(await until(`!!document.querySelector('.spine-ready .spine-point')`,10000));await sleep(700);
  const geometry=()=>evaluate(`JSON.stringify([...document.querySelectorAll('.react-flow__node')].map(e=>({id:e.dataset.id,at:e.style.transform,text:e.textContent})))`);
  const off=await geometry();
  assert.equal(await evaluate(`document.querySelectorAll('.spine-lenses').length`),0);
  await setting();
  assert.ok(await until(`document.querySelectorAll('[data-session]').length===3`));
  assert.equal(await evaluate(`document.querySelector('.spine-frame').dataset.lens`),'time');
  assert.ok(await evaluate(`(()=>{const r=document.querySelector('[data-thought="s6"]').getBoundingClientRect(); return r.x>=0 && r.right<innerWidth && r.y>=0 && r.bottom<innerHeight})()`),'opens on newest session');
  const ids=()=>evaluate(`JSON.stringify([...document.querySelectorAll('.spine-conversation-turn')].map(e=>[e.dataset.thought,e.querySelector('.spine-words').textContent]).sort())`);
  const same=await ids();
  const positions=()=>evaluate(`JSON.stringify([...document.querySelectorAll('.react-flow__node')].map(e=>[e.dataset.id,e.style.transform]))`);
  const timeBoxes=await positions();
  core.send({type:'change',change:{type:'thought_placed',thought_id:'s3',thread_id:'weekend',point:thoughts[2].point,unclear:'',complete:true,place_ms:0}});
  assert.ok(await until(`!!document.querySelector('[data-thought="s3"] button[aria-label="Topic: Weekend trip"]')`));
  assert.equal(await positions(),timeBoxes, 'classification keeps chronological geometry');
  core.send({type:'change',change:{type:'thought_placed',thought_id:'s3',thread_id:'garden',point:thoughts[2].point,unclear:'',complete:true,place_ms:0}});
  assert.ok(await until(`!!document.querySelector('[data-thought="s3"] button[aria-label="Topic: Garden plans"]')`));
  const shot=async(name)=>{if(!process.env.SHOTS)return;mkdirSync(process.env.SHOTS,{recursive:true});const s=await page('Page.captureScreenshot',{format:'png'});writeFileSync(`${process.env.SHOTS}/${name}.png`,Buffer.from(s.data,'base64'));};
  await shot('i-sessions-time');
  const change=async view=>{
    // The newest card is the one in the reading area on opening and remains our anchor both ways.
    await evaluate(`window.anchorBefore=document.querySelector('[data-thought="s6"]').getBoundingClientRect().toJSON();window.anchorMoves=[];window.otherMoves=[];window.originalNodes=[...document.querySelectorAll('.spine-conversation-turn')];window.trackRunning=true;function track(){if(!window.trackRunning)return;const r=document.querySelector('[data-thought="s6"]').getBoundingClientRect();anchorMoves.push(Math.hypot(r.x-anchorBefore.x,r.y-anchorBefore.y));otherMoves.push(document.querySelector('[data-id="p:s1"]').style.transform);requestAnimationFrame(track)}requestAnimationFrame(track)`);
    await click(`.spine-lenses button:nth-child(${view==='time'?1:2})`);
    assert.ok(await until(`document.querySelector('.spine-frame').dataset.lens===${JSON.stringify(view)}`));
    await sleep(500);
    await evaluate('window.trackRunning=false');
    const max=await evaluate('Math.max(...anchorMoves)');
    assert.ok(max<2,`anchor moved ${max}px`);
    assert.ok(await evaluate(`originalNodes.every(e=>e.isConnected)`),'same DOM cards fly');
    assert.equal(await ids(),same);
    console.log(`PASS ${view}: anchor max drift ${max.toFixed(3)} px; same cards`);
    return await evaluate('new Set(otherMoves).size');
  };
  assert.ok(await change('topics')>3,'non-anchor cards glide through intermediate positions');
  await shot('i-sessions-topics');
  await page('Page.navigate',{url});assert.ok(await until(`document.querySelector('.spine-ready')?.dataset.lens==='topics'`,10000));
  await sleep(600);
  // Reload chooses the latest turn; it can be in either topic, so return to time first without asserting an old origin.
  await click('.spine-lenses button:first-child');await sleep(600);
  await change('topics');await change('time');
  await page('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.ok(await change('topics')<=2,'reduced motion changes places once, with a crossfade');
  await page('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await sleep(650);
  assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth`));
  await click('.spine-lenses button:first-child');await sleep(300);
  assert.equal(await ids(),same);
  await shot('i-sessions-phone');
  await page('Emulation.setDeviceMetricsOverride',{width:720,height:450,deviceScaleFactor:2,mobile:false});await sleep(300);
  assert.ok(await evaluate(`(()=>{const r=document.querySelector('.spine-lenses').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()`),'control at enlarged viewport');
  await page('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await sleep(300);
  // Overview captures show all three session columns and both topic places, after the opening/anchor checks.
  await key('0','Digit0',48); await sleep(500); await shot('i-sessions-time');
  await click('.spine-lenses button:nth-child(2)'); await sleep(300);
  await key('0','Digit0',48); await sleep(500); await shot('i-sessions-topics');
  await setting();
  assert.equal(await geometry(),off,'setting off restores original nodes, words and positions');
  assert.equal(await evaluate(`document.querySelectorAll('.spine-lenses').length`),0);
  assert.deepEqual(await evaluate('window.errors'),[]);
  assert.ok(!core.heard.some(m=>m.type==='stay_here'),'the feature never bypasses routing');
  console.log(`PASS page: off-state identity, persistence, intermediate motion, reduced-motion crossfade, phone, enlarged viewport; port ${core.port}`);
} catch(error) {
  if(browser&&process.env.SHOTS){const s=await browser.page('Page.captureScreenshot',{format:'png'});mkdirSync(process.env.SHOTS,{recursive:true});writeFileSync(`${process.env.SHOTS}/i-sessions-failure.png`,Buffer.from(s.data,'base64'));}
  throw error;
} finally {await browser?.close();core.close();}
