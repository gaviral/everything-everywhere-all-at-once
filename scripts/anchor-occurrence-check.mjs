// Exact quote anchors: public action/protocol mirror and the built page. No model or personal data.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { uiServer } from './ui-server.mjs';
import { ready, standInCore, openPage, sleep } from './headless.mjs';
const server = await uiServer();
globalThis.location = new URL('http://localhost/');
const anchor = await server.ssrLoadModule('/src/annotate-core.ts');
const { apply } = await server.ssrLoadModule('/src/core.ts');
const source = 'At the paper bridge, turn left; near the wooden gate, turn left.';
const thought = {id:'source', speaker:'speaker-b', text:source, point:source, thread_id:'T1', placed:true, complete:true, unclear:'', at_ms:1, place_ms:0};
const context = {source_text:source, source_speaker:'speaker-b', start:54, end:63};
assert.equal(anchor.resolveContext(thought, 'turn left'), anchor.AMBIGUOUS);
assert.deepEqual(anchor.resolveContext(thought, 'turn left', context), context);
assert.deepEqual(anchor.anchorRange('turn left', context, source), {start:54,end:63});
assert.equal(anchor.anchorRange('turn left', context, 'At the paper bridge, turn left.'), null);
for (const text of [source, '🧭 café turn left; 路 turn left.']) {
  const offset = text.lastIndexOf('turn left');
  assert.equal(anchor.utf16Offset(text, anchor.codePointOffset(text, offset)), offset);
}
assert.equal(typeof anchor.resolveContext(thought, 'paper bridge'), 'object');
assert.deepEqual(JSON.parse(anchor.annotateMessage('source','turn left','Use the wider path.',context).message).context, context);
let world = {threads:[{id:'T1', title:'Route', parent_id:null, status:'open', last_point:source, touched_ms:1, tags:[], picture:null, dropped_by:''}],
  thoughts:[thought], active:'T1', active_by:{'speaker-a':'T1'}, anchors:{}, suggestions:[], actions:[], proposals:[], merged:{}, apps:[], apps_seeded:true, recaps:[], notes:{}};
const legacy = anchor.applyAnchored({...world, thoughts:[{...thought, point:'turn left then turn left'}]}, {type:'anchored',thread_id:'T1',thought_id:'source',quote:'turn left'});
assert.equal(legacy.anchors.T1.context, undefined);
const why = ready();
if (why) { await server.close(); throw new Error(why); }
let n=0, joins=0;
const core = await standInCore(() => { joins++; return [{type:'snapshot', world}]; }, {onMessage(message) {
  if(message.type !== 'annotate') return;
  const resolved = anchor.resolveContext(world.thoughts.find(t=>t.id===message.thought_id),message.quote,message.context);
  if(typeof resolved === 'string') { core.send({type:'notice',message:resolved}); return; }
  const changes=anchor.noteChanges(world,'speaker-a',message.thought_id,message.quote,message.text,Date.now(),{thread:()=>`N${++n}`,thought:()=>`reply${++n}`},message.context);
  for(const change of changes) {world=apply(world,change);core.send({type:'change',change});}
}});
const scene=await openPage('about:blank',{width:1440,height:1000});
const out=process.env.ANCHOR_EVIDENCE || mkdtempSync(join(tmpdir(), 'e2a2o-anchor-evidence-'));
mkdirSync(out,{recursive:true});
try {
  const {page,evaluate,until}=scene;
  await page('Page.enable');
  await page('Page.addScriptToEvaluateOnNewDocument',{source:`
    localStorage.setItem('e2a2o.name','speaker-a'); sessionStorage.setItem('e2a2o.joined','speaker-a'); localStorage.setItem('e2a2o.toured','1');
    window.testSocket=null; const Socket=WebSocket; window.WebSocket=class extends Socket { constructor(...args){super(...args);window.testSocket=this;} };
  `});
  await page('Page.navigate',{url:`http://127.0.0.1:${core.port}/?name=speaker-a`});
  assert.ok(await until(`!!document.querySelector('.spine-text')`,12000),'built source visible');
  // Activate selection through a real double click, then set a DOM range to the exact second occurrence.
  const target=await evaluate(`(()=>{const e=[...document.querySelectorAll('.spine-text')].find(e=>e.textContent.includes('paper bridge'));const r=e.getBoundingClientRect();return {x:r.left+20,y:r.top+10};})()`);
  for(const type of ['mousePressed','mouseReleased']) await page('Input.dispatchMouseEvent',{type,...target,button:'left',clickCount:2});
  assert.ok(await until(`!!document.querySelector('.spine-selecting .spine-text')`),'selection mode');
  await sleep(250);
  await evaluate(`(()=>{const e=document.querySelector('.spine-selecting .spine-words');const w=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let node=w.nextNode();const r=document.createRange();r.setStart(node,54);r.setEnd(node,63);getSelection().removeAllRanges();getSelection().addRange(r);})()`);
  assert.ok(await until(`document.querySelector('.spine-reply-ask')?.getAttribute('aria-label') === 'Reply to “turn left”' && getSelection().toString() === 'turn left'`),'Reply button');
  await evaluate(`document.querySelector('.spine-reply-ask').click()`);
  assert.ok(await until(`!!document.querySelector('.spine-reply-field') && document.activeElement === document.querySelector('.spine-reply-field')`));
  await page('Input.insertText',{text:'Use the wider path.'});
  assert.equal(await evaluate(`document.querySelector('.spine-reply-field').value`),'Use the wider path.');
  for (const type of ['keyDown','keyUp']) await page('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:type==='keyDown'?'\r':undefined});
  if (!await until(`!!document.querySelector('.spine-quote')`)) { console.log(JSON.stringify({heard:core.heard.filter(m=>m.type==='annotate'), anchors:world.anchors, text:await evaluate(`document.body.innerText.slice(-2000)`)},null,2)); throw new Error('quote marked'); }
  const sent=core.heard.find(m=>m.type==='annotate');
  assert.deepEqual(sent.context,context,'outgoing action carries exact range and revision');
  assert.equal(world.thoughts.find(t=>t.id.startsWith('reply')).speaker,'speaker-a');
  assert.equal(world.thoughts[0].speaker,'speaker-b');
  const checkRange=async()=>assert.equal(await evaluate(`(()=>{const q=document.querySelector('.spine-quote');const r=document.createRange();r.selectNodeContents(q.closest('.spine-words'));r.setEndBefore(q);return r.toString().length;})()`),54);
  await checkRange();
  const screenshot=async(name)=>writeFileSync(`${out}/${name}.png`,Buffer.from((await page('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await screenshot('repeated-before');
  const beforeReconnect=joins; core.drop();
  for(let i=0; joins===beforeReconnect && i<120; i++) await sleep(100);
  assert.ok(joins>beforeReconnect,'new snapshot after reconnect');
  assert.ok(await until(`!!document.querySelector('.spine-quote')`,12000)); await checkRange();
  await page('Page.reload'); assert.ok(await until(`!!document.querySelector('.spine-quote')`,12000)); await checkRange();
  await evaluate(`testSocket.send(JSON.stringify({type:'annotate',thought_id:'source',quote:'turn left',text:'Ambiguous request.'}))`);
  assert.ok(await until(`document.body.textContent.includes('Those words occur more than once')`),'visible ambiguity refusal');
  const change={type:'thought_repointed',thought_id:'source',point:'At the paper bridge, turn left.'};world=apply(world,change);core.send({type:'change',change});
  assert.ok(await until(`document.body.textContent.includes('Anchor unresolved')`),'visible stale status');
  assert.equal(await evaluate(`document.querySelectorAll('.spine-quote').length`),0,'no relocation to first phrase');
  await evaluate(`document.querySelector('.spine-anchor-status details').open=true`);
  await screenshot('repeated-after');
  await page('Page.reload');assert.ok(await until(`document.body.textContent.includes('Anchor unresolved')`,12000));
  const urls=await evaluate(`performance.getEntriesByType('resource').map(x=>x.name).filter(x=>/\\/assets\\//.test(x))`);
  const hashes=await Promise.all(urls.map(async url=>({path:new URL(url).pathname,sha256:createHash('sha256').update(Buffer.from(await (await fetch(url)).arrayBuffer())).digest('hex')})));
  writeFileSync(`${out}/observed.json`,JSON.stringify({base:execFileSync('git',['rev-parse','main'],{encoding:'utf8'}).trim(),sent,anchor:world.anchors,checks:['built selection 54:63','outbound context','reconnect','reload','speaker identities','visible ambiguity refusal','stale no relocation'],loaded_assets:hashes},null,2));
  console.log('anchor-occurrence-check: PASS (protocol mirror, built selection, reconnect/reload, ambiguity, stale revision; screenshots and loaded asset hashes saved)');
} finally { await scene.close();core.close();await server.close(); }
