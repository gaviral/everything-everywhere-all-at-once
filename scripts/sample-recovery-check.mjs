// The real debug-break fixture, through the existing sample/return commands; no key or invented completion.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { standInCore, ready } from './headless.mjs';
import { uiServer } from './ui-server.mjs';
import { capturePage, empty } from './capture-fixture.mjs';
if (ready()) { console.log(`SKIP sample-recovery-check: ${ready()}`); process.exit(3); }
globalThis.location = new URL('http://localhost/');
const loader = await uiServer();
let fixture;
try {
  const {apply} = await loader.ssrLoadModule('/src/core.ts');
  fixture = readFileSync(new URL('../samples/debug-break.jsonl',import.meta.url),'utf8').trim().split('\n').map(JSON.parse).map(change=>({speaker:'you',...change})).reduce(apply,empty());
} finally { await loader.close(); }
const source = fixture.thoughts.find(t=>!t.complete);
assert.ok(source,'real fixture has unfinished words');
for(const [width,height] of [[1440,900],[390,844]]) for(const scheme of ['light','dark']) {
  const state={world:empty()}, heard=[];
  const core=await standInCore(()=>[{type:'map_identity',id:'sample-map'},{type:'snapshot',world:state.world},{type:'notice',message:'MODEL_API_KEY is not set: listening and placement are off.'}],{
    door:{room:false,member:true,sample:true,samples:[{id:'student-week',label:"A student's week"},{id:'debug-break',label:'A bug, then a call'}]},
    onMessage(m){heard.push(m);if(m.type==='heartbeat')core.send(m);
      if(m.type==='sample'){assert.equal(m.name,'debug-break');state.world=structuredClone(fixture);core.send({type:'snapshot',world:state.world});core.send({type:'notice',message:'MODEL_API_KEY is not set: listening and placement are off.'});}
      if(m.type==='text'&&m.text==='Where was I?'){
        core.send({type:'text_received',id:m.id});core.send({type:'capture_saved',capture:{id:m.id,text:m.text,thought_ids:[]},replay:false});
        core.send({type:'change',change:{type:'active_changed',thread_id:source.thread_id,speaker:'you'}});
        core.send({type:'found',thread_id:source.thread_id,thought_id:source.id,message:'Back to the unfinished thought'});
      }
    },
  });
  core.state=state;
  let browser;
  try{
    browser=await capturePage(core,{width,height,scheme});const {evaluate,until}=browser;
    await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Try an unfinished thought').click()`);
    assert.ok(await until(`document.body.textContent.includes('SAMPLE')&&!!document.querySelector('.spine-ready')`), 'example visibly stamped SAMPLE');
    assert.ok(await until(`document.body.textContent.includes(${JSON.stringify(source.text)})`,10000),'unfinished original words available');
    await evaluate(`[...document.querySelectorAll('.sample-recovery-actions button')].find(b=>b.textContent==='Where was I?').click()`);
    assert.ok(await until(`document.querySelector('.spine-point[data-thought="${source.id}"]')?.textContent.includes(${JSON.stringify(source.text)})`),'return reveals its exact source');
    assert.ok(heard.some(m=>m.type==='text'&&m.text==='Where was I?'),'existing return command used');
    await evaluate(`[...document.querySelectorAll('.sample-recovery-actions button')].find(b=>b.textContent==='Pictures').click()`);
    assert.ok(await until(`!!document.querySelector('.palace')`),'Pictures opens without a key');
    assert.equal(state.world.thoughts.length,fixture.thoughts.length,'example command invents no completion');
  }finally{await browser?.close();core.close();}
}
console.log('sample-recovery-check: ok (real unfinished example, SAMPLE, exact return, Pictures; four size/theme cases)');
