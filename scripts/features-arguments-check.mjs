// Actual card -> owned keyless core -> journal -> restart. All source text synthetic.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture,seed,thoughts,toggle,select,click,sleep} from './choice-evidence-fixture.mjs';
const f=await fixture('c10-arguments',seed);let browser;
const journalChanges=()=>readFileSync(join(f.data,'journal.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).flatMap(record=>{
  if(record.type!=='journal_batch')return [record];
  assert.equal(record.version,1,'supported journal batch');
  assert.ok(Array.isArray(record.changes)&&record.changes.every(change=>change&&typeof change.type==='string'),'complete journal changes');
  return record.changes;
});
try {
  const wire=await f.connect();
  const request={request_id:crypto.randomUUID(),choice_id:'test',revision:0,operation:'add',relation_id:'q',source_id:'q',observed:thoughts[0].text,role:'question'};
  wire.send({type:'save_choice',request});assert.equal((await wire.until(m=>m.request_id===request.request_id)).ok,false,'disabled connection refuses');
  browser=await f.open();const errors=[],sent=[];browser.on('Runtime.exceptionThrown',e=>errors.push(e.exceptionDetails.text));browser.on('Network.webSocketFrameSent',e=>{if(e.response.opcode===1)sent.push(JSON.parse(e.response.payloadData));});await browser.page('Runtime.enable');await browser.page('Network.enable');await browser.page('Page.navigate',{url:f.base+'/?shell=2'});
  assert.ok(await browser.until(`!!document.querySelector('[data-guide="catalog"]')`));
  assert.equal(await browser.evaluate(`!!document.querySelector('.choice-map')`),false);
  assert.equal(sent.some(m=>m.type==='choice_maps'||m.type==='save_choice'),false,'default-off sends no feature operations');
  await toggle(browser,'choice-map',true);
  async function showChoice(){
  await browser.evaluate(`document.querySelector('[data-guide="catalog"]').click()`);
  assert.ok(await browser.until(`!!document.querySelector('[data-row="choice-map"]')`));
  const opened=await browser.evaluate(`(()=>{const row=document.querySelector('[data-row="choice-map"]');const b=[...row.querySelectorAll('button')].find(b=>b.textContent==='Show');if(b){b.click();return true;}return false;})()`);
  if(!opened){await browser.evaluate(`document.querySelector('.shell-rail-close').click()`);await browser.evaluate(`document.querySelector('[data-guide="view:choice-map"]').click()`);}
  assert.ok(await browser.until(`!!document.querySelector('.choice-map')`),'Choice map view opens');
  }
  await showChoice();
  async function add(source,role,option=''){
    await select(browser,'.choice-map form select',source);await select(browser,'.choice-map form label:nth-child(2) select',role);
    if(option)await select(browser,'.choice-map form label:nth-child(3) select',option);
    const before=await browser.evaluate(`document.querySelectorAll('[data-choice-role]').length`);
    await click(browser,'.choice-map form','Add role');assert.ok(await browser.until(`document.querySelectorAll('[data-choice-role]').length===${before+1}`));
  }
  await add('q','question');await add('a','option');await add('b','option');
  const relationIds=()=>journalChanges().filter(c=>c.type==='choice_map_saved').at(-1).choice.relations;
  const a=relationIds().find(r=>r.source_id==='a').id;
  await add('pro','supports',a);await add('con','challenges',a);
  await browser.evaluate(`document.querySelector('[data-choice-role="option"] button:nth-child(2)').click()`);
  assert.ok(await browser.until(`document.querySelector('.choice-map').textContent.includes('Chosen by you')`));
  const records=relationIds();const saved=journalChanges().filter(c=>c.type==='choice_map_saved').at(-1).choice;
  const reviewer=await f.connect('Reviewer');reviewer.send({type:'choice_maps',on:true});const dissent={...request,request_id:crypto.randomUUID(),choice_id:saved.id,revision:saved.revision,operation:'choose',relation_id:records.find(r=>r.source_id==='b').id};reviewer.send({type:'save_choice',request:dissent});assert.equal((await reviewer.until(m=>m.request_id===dissent.request_id)).ok,true);
  // Same identity is idempotent; another participant's classification remains visible.
  reviewer.send({type:'save_choice',request:dissent});await sleep(100);
  assert.ok(await browser.until(`document.querySelector('.choice-map').textContent.includes('Chosen by Reviewer')`));
  reviewer.ws.close(); await sleep(250); await showChoice();
  assert.ok(await browser.evaluate(`document.querySelector('.choice-map').checkVisibility()`),'choice list is visible for screenshots');
  await f.screenshots(browser,'.choice-map','Add role');
  await browser.page('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await browser.evaluate(`document.documentElement.style.fontSize='100%'`);
  await click(browser,'[data-choice-role="option"]','Remove role');assert.ok(await browser.until(`document.querySelector('[aria-label="Confirm removal"]').textContent.includes('Remove 3 roles?')`));
  await browser.page('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await browser.page('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});assert.ok(await browser.until(`!document.querySelector('[aria-label="Confirm removal"]')`),'Esc cancels removal');
  await click(browser,'[data-choice-role="option"]','Remove role');await click(browser,'[aria-label="Confirm removal"]','Confirm remove');assert.ok(await browser.until(`document.querySelectorAll('[data-choice-role]').length===2`));await click(browser,'.choice-map','Undo removal');assert.ok(await browser.until(`document.querySelectorAll('[data-choice-role]').length===5`));
  await click(browser,'[data-choice-role="option"]','Open original');
  assert.ok(await browser.until(`!!document.activeElement.closest('[data-thought="a"]') || document.activeElement.id==='point-a'`),'Open original focuses exact source thought');
  const original=await wire.until(m=>m.type==='snapshot');assert.deepEqual(original.world.thoughts,thoughts);
  await f.stop();await f.start();await browser.page('Page.reload');assert.ok(await browser.until(`!!document.querySelector('[data-guide="catalog"]')`,12000));
  const reconnected=await f.connect();const world=(await reconnected.until(m=>m.type==='snapshot')).world;assert.equal(world.choice_maps[0].relations.filter(r=>!r.removed_by).length,5);assert.deepEqual(world.thoughts,thoughts);
  await toggle(browser,'choice-map',false);assert.equal(await browser.evaluate(`!!document.querySelector('.choice-map')`),false);assert.deepEqual(errors,[]);
  writeFileSync(join(f.out,'result.json'),JSON.stringify({ok:true,choice:world.choice_maps[0],limitations:['Synthetic fixture only; no human usability test.']},null,2));console.log('PASS c10-arguments: real UI, durable roles, per-connection gate, remove/Undo, restart; '+f.out);
}finally{await browser?.close();await f.close();}
