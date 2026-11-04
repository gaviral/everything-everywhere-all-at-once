// Synthetic UI/provider protocol fixture plus separate real-core refusal tests.
// Production has no fixture switch or alternative provider endpoint.
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {standInCore,openPage,sleep} from './headless.mjs';
import {uiServer} from './ui-server.mjs';
import {fixture,seed,thread,toggle,click,select} from './choice-evidence-fixture.mjs';
const f=await fixture('c10-evidence',seed);let browser,stand;
try{
  const wire=await f.connect();const disabled={type:'keep_evidence',request_id:crypto.randomUUID(),extraction_id:crypto.randomUUID(),points:[{index:0,text:'Synthetic',region:null}]};
  wire.send(disabled);assert.equal((await wire.until(m=>m.request_id===disabled.request_id)).ok,false);
  wire.send({type:'image_evidence',on:true});wire.send({type:'evidence_chunk',request_id:disabled.extraction_id,target:'missing',title:'Missing',index:0,data:'AA=='});assert.equal((await wire.until(m=>m.request_id===disabled.extraction_id)).ok,false,'missing target refused by core');
  // No key ever enters this process; enabled invalid image must fail before provider work.
  const invalid=crypto.randomUUID();wire.send({type:'evidence_chunk',request_id:invalid,target:thread.id,title:thread.title,index:0,data:'PHN2ZyAvPg=='});wire.send({type:'extract_evidence',request_id:invalid});assert.equal((await wire.until(m=>m.request_id===invalid)).ok,false,'invalid image refused');
  const remote=await f.connect('Remote','&remote=1');remote.send({type:'image_evidence',on:true});remote.send({...disabled,request_id:crypto.randomUUID()});assert.ok(await remote.until(m=>m.type==='evidence_result'&&!m.ok),'remote refused');
  await f.stop();
  const ssr=await uiServer();try{const rules=await ssr.ssrLoadModule('/src/bricks/image-evidence/rules.ts');assert.ok(rules.imageError('image/svg+xml',20,new Uint8Array(20)));assert.ok(rules.imageError('image/png',rules.MAX_BYTES+1,new Uint8Array(20)));}finally{await ssr.close();}
  let world={questions:[],recaps:[],threads:[thread],thoughts:[],active:null,active_by:{},suggestions:[],actions:[],merged:{},proposals:[],apps:[],apps_seeded:true,evidence_kept:[]};
  let image='',proposalId='',providerCalls=0,keepCalls=0;const chunks=new Map();
  const points=[{index:0,text:'Workshop at ten',region:[0,0,1,.5]},{index:1,text:'Lunch at noon',region:[0,.5,1,.5]}];
  stand=await standInCore(()=>[{type:'snapshot',world}],{onMessage:m=>{
    const reply=(data)=>stand.send({type:'evidence_result',request_id:m.request_id,ok:true,message:'Fixture acknowledgement',data});
    if(m.type==='evidence_chunk')chunks.set(m.index,m.data);
    if(m.type==='extract_evidence'){providerCalls++;proposalId=m.request_id;image='data:image/webp;base64,'+[...chunks].sort((a,b)=>a[0]-b[0]).map(v=>v[1]).join('');reply({extraction_id:proposalId,preview:image,width:320,height:160,model:'muse-spark-1.3',points});}
    if(m.type==='keep_evidence'){
      keepCalls++;let record=world.evidence_kept.find(r=>r.request_id===m.request_id);
      if(!record){record={request_id:m.request_id,extraction_id:proposalId,image_id:m.request_id,actor:'you',target:thread.id,title:thread.title,width:320,height:160,model:'muse-spark-1.3',points:m.points,thought_ids:m.points.map(()=>crypto.randomUUID()),removed:false};
        world={...world,evidence_kept:[...world.evidence_kept,record],thoughts:m.points.map((p,i)=>({id:record.thought_ids[i],text:p.text,point:p.text,thread_id:thread.id,speaker:'Image evidence · you',placed:true,unclear:'',complete:true,at_ms:1,place_ms:null,decided:false}))};
        stand.send({type:'snapshot',world});writeFileSync(join(f.out,'ui-fixture-journal.json'),JSON.stringify(world));
      }reply({kept:record});
    }
    if(m.type==='undo_evidence'){world={...world,thoughts:[],evidence_kept:world.evidence_kept.map(r=>({...r,removed:true}))};stand.send({type:'snapshot',world});reply({undone:m.keep_id});}
    if(m.type==='cancel_evidence')reply({cancelled:true});
  }});
  browser=await openPage('about:blank');const errors=[];browser.on('Runtime.exceptionThrown',e=>errors.push(e.exceptionDetails.text));await browser.page('Runtime.enable');browser.on('Fetch.requestPaused',async e=>{await browser.page('Fetch.fulfillRequest',{requestId:e.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'image/webp'}],body:image.split(',')[1]});});await browser.page('Fetch.enable',{patterns:[{urlPattern:'*/evidence/*'}]});await browser.page('Page.navigate',{url:`http://127.0.0.1:${stand.port}/?shell=2`});assert.ok(await browser.until(`!!document.querySelector('[data-guide="catalog"]')`));
  assert.equal(await browser.evaluate(`!!document.querySelector('.image-evidence')`),false);assert.equal(stand.heard.some(m=>m.type==='image_evidence'),false);
  await toggle(browser,'image-evidence',true);assert.ok(await browser.until(`!!document.querySelector('.image-evidence')`));await browser.evaluate(`document.querySelector('.image-evidence > details').open=true`);
  // Real file input/change path, synthetic pixels, actual browser sanitization.
  await browser.evaluate(`(async()=>{const c=document.createElement('canvas');c.width=320;c.height=160;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,320,160);x.fillStyle='black';x.font='20px sans-serif';x.fillText('10:00 Workshop',12,45);x.fillText('12:00 Lunch',12,125);const blob=await new Promise(r=>c.toBlob(r,'image/png'));const dt=new DataTransfer();dt.items.add(new File([blob],'synthetic-schedule.png',{type:'image/png'}));const input=document.querySelector('.image-evidence input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  assert.ok(await browser.until(`document.querySelector('.image-evidence').textContent.includes('Preview ready')`));assert.equal(providerCalls,0);assert.equal(stand.heard.some(m=>m.type==='evidence_chunk'),false,'choosing and previewing send nothing');
  await select(browser,'.image-evidence select',thread.id);await click(browser,'.image-evidence','Extract');assert.ok(await browser.until(`document.querySelectorAll('.image-evidence-point').length===2`));assert.equal(providerCalls,1);
  await browser.evaluate(`document.querySelectorAll('.image-evidence-point input[type=checkbox]')[1].click()`);
  await f.screenshots(browser,'.image-evidence-body','Keep selected');
  await browser.evaluate(`(()=>{const b=[...document.querySelector('.image-evidence').querySelectorAll('button')].find(b=>b.textContent==='Keep selected');b.click();b.click();})()`);
  assert.ok(await browser.until(`!!document.querySelector('[aria-label="Original image evidence"]')`));assert.ok(await browser.until(`document.querySelector('[aria-label="Original image evidence"] img').naturalWidth===320`));assert.equal(keepCalls,1);assert.equal(world.thoughts.length,1);assert.equal(world.evidence_kept[0].points[0].text,'Workshop at ten');
  // The UI fixture snapshot reload is separate from the Rust real-journal restart check.
  world=JSON.parse(readFileSync(join(f.out,'ui-fixture-journal.json'),'utf8'));await browser.page('Page.reload');assert.ok(await browser.until(`!!document.querySelector('.image-evidence')`));await browser.evaluate(`document.querySelector('.image-evidence > details').open=true;document.querySelector('.image-evidence-body details').open=true`);
  await click(browser,'.image-evidence','Travel plan · kept by you');assert.ok(await browser.until(`!!document.querySelector('[aria-label="Original image evidence"]')`));
  await click(browser,'.image-evidence','Undo kept points');assert.ok(await browser.until(`!document.querySelector('.image-evidence').textContent.includes('Undo kept points')`));assert.equal(world.thoughts.length,0);
  await toggle(browser,'image-evidence',false);assert.equal(await browser.evaluate(`!!document.querySelector('.image-evidence')`),false);const before=stand.heard.filter(m=>m.type==='keep_evidence'||m.type==='extract_evidence').length;await sleep(200);assert.equal(stand.heard.filter(m=>m.type==='keep_evidence'||m.type==='extract_evidence').length,before);assert.deepEqual(errors,[]);
  writeFileSync(join(f.out,'result.json'),JSON.stringify({ok:true,providerCalls,keepCalls,limitations:['Browser uses injected synthetic protocol/provider response, not live Meta.','Real-core decoding, Keep, replay, Undo covered separately by c10_evidence Rust tests.']},null,2));console.log('PASS c10-evidence: real card synthetic provider fixture; real-core refusals; '+f.out);
}finally{await browser?.close();stand?.close();await f.close();}
