import {fixture,assert,randomUUID,sleep,readFileSync,writeFileSync,join,thought,appendFileSync} from './c10-fixture.mjs';
const f=await fixture('c10-discuss');
try {
  await f.start();let first=await f.connection();let second=await f.connection('Sam');
  assert.deepEqual(first.world.discussions,[]);
  first.send({type:'annotate',thought_id:'p1',quote:'blue venue',text:'Check the opening hours.'});await first.barrier();
  let w=await f.snapshot();const id=Object.keys(w.anchors)[0];assert.ok(id);
  const original={anchor:w.anchors[id],replies:w.thoughts.filter(t=>t.thread_id===id).map(t=>t.id)};
  const operation=async(c,status,revision,request_id=randomUUID())=>{c.send({type:'set_discussion',thread_id:id,status,observed_revision:revision,request_id});return c.wait(m=>m.type==='discussion_result'&&m.request_id===request_id)};
  assert.equal((await operation(first,'resolved',0)).ok,false,'operation alone cannot enable');
  second.send({type:'discussion_feature',on:true});await second.barrier();
  assert.equal((await operation(first,'resolved',0)).ok,false,'another connection cannot opt this one in');
  const request=randomUUID();let saved=await operation(second,'resolved',0,request);assert.ok(saved.ok);assert.equal(saved.discussion.actor,'Sam');
  assert.ok((await operation(second,'resolved',0,request)).ok,'same identity replay');
  assert.equal((await operation(second,'open',0)).ok,false,'stale write refused');
  first.send({type:'annotate',thought_id:'p1',quote:'blue venue',text:'A new reply.'});await first.barrier();
  w=await f.snapshot();assert.equal(w.discussions[0].status,'resolved');assert.equal(w.thoughts.find(t=>t.id==='p1').text,thought.text);
  const b=await f.page();const {evaluate,until,click,features,closeFeatures,key,page,shot}=b;
  assert.equal(await evaluate('document.querySelectorAll(".discussion-controls").length'),0,'fresh profile off');
  await features();assert.equal(await evaluate(`document.querySelector('[role=switch][aria-label="Discussion status"]').getAttribute("aria-checked")`),'false');
  await click('[role=switch][aria-label="Discussion status"]');await closeFeatures();
  await click('.discussion-shelf > button');await click('.discussion-shelf [data-discussion] button:first-of-type');
  assert.ok(await until('!!document.querySelector(".discussion-dialog[open]")'));
  assert.ok((await evaluate('document.querySelector(".discussion-dialog").textContent')).includes('Resolved by Sam'));
  assert.ok((await evaluate('document.querySelector(".discussion-dialog").textContent')).includes('New reply on resolved discussion'));
  assert.equal(await evaluate('document.querySelector(".discussion-dialog input").checked'),false);
  await click('.discussion-dialog input');
  for(const width of [1440,390])for(const theme of ['light','dark']){
    await page('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    await page('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme},{name:'prefers-reduced-motion',value:'reduce'}]});
    await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.querySelector('.discussion-dialog').style.fontSize='200%'`);
    await evaluate('document.querySelector(".discussion-dialog button").focus()');
    await sleep(150);await shot(`${width}-${theme}`);
    const geometry = await evaluate('(()=>{const b=document.activeElement.getBoundingClientRect(),d=document.querySelector(".discussion-dialog").getBoundingClientRect();return {button:{top:b.top,bottom:b.bottom},dialog:{top:d.top,bottom:d.bottom},active:document.activeElement.textContent}})()');
    writeFileSync(join(f.dir,'shots',`${width}-${theme}-geometry.json`),JSON.stringify(geometry));
    assert.ok(geometry.button.top>=geometry.dialog.top&&geometry.button.bottom<=geometry.dialog.bottom,`status control reachable in scrolled dialog: ${JSON.stringify(geometry)}; ${f.dir}`);
    assert.ok(await evaluate('(()=>{const e=document.querySelector(".discussion-dialog");return e.scrollWidth<=e.clientWidth+1})()'),'dialog reflows at 200%');
    await key('Tab','Tab',9);
    assert.equal(await evaluate('document.activeElement.textContent'),'Close discussion','Close reachable by keyboard after resize');
    assert.ok(await evaluate('(()=>{const b=document.activeElement.getBoundingClientRect(),d=document.querySelector(".discussion-dialog").getBoundingClientRect();return b.top>=d.top&&b.bottom<=d.bottom})()'),'Close scrolls into the dialog above the composer');
    if(width===390)await shot(`${width}-${theme}-close-focus`);
  }
  await key('Escape','Escape',27);assert.ok(await until('!document.querySelector(".discussion-dialog")'));
  assert.ok((await evaluate('document.activeElement.textContent')).startsWith('Open discussion'),'focus returns');
  second.ws.close();await sleep(100);second=await f.connection('Sam');assert.equal((await operation(second,'open',1)).ok,false,'disconnect clears opt-in');
  second.send({type:'discussion_feature',on:true});await second.barrier();assert.ok((await operation(second,'open',1)).ok);
  await f.stop();await f.start();w=await f.snapshot();assert.equal(w.discussions[0].status,'open');assert.deepEqual(w.anchors[id],original.anchor);assert.deepEqual(w.thoughts.filter(t=>t.thread_id===id).slice(0,1).map(t=>t.id),original.replies);
  // Production dialog source honesty with changed, repeated, moved and deleted synthetic sources.
  let c=await f.connection();c.send({type:'discussion_feature',on:true});await c.barrier();assert.ok((await operation(c,'resolved',2)).ok);
  await page('Page.reload');assert.ok(await until('!!document.querySelector(".discussion-shelf")'));
  // Source alterations affect only this stopped synthetic journal. Captured quote/thread/replies stay fixed.
  const scenarios = [
    { changes:[{type:'thread_added',thread:{...w.threads.find(t=>t.id==='T1'),id:'T2',title:'Another topic'}},{type:'thought_moved',thought_id:'p1',from:'T1',thread_id:'T2'}], expected:'Open source' },
    { changes:[{type:'thought_repointed',thought_id:'p1',point:'blue venue and blue venue'}], expected:'Anchor ambiguous' },
    { changes:[{type:'thought_repointed',thought_id:'p1',point:'The opening time changed.'}], expected:'Source changed' },
    { changes:[{type:'thought_skipped',thought_id:'p1'}], expected:'Source no longer on map' },
  ];
  for (const scenario of scenarios) {
    await f.stop();appendFileSync(f.journal,scenario.changes.map(JSON.stringify).join('\n')+'\n');await f.start();await page('Page.reload');
    assert.ok(await until('!!document.querySelector(".discussion-shelf")'));
    await click('.discussion-shelf > button');await click('.discussion-shelf [data-discussion] button:first-of-type');
    assert.ok(await until('!!document.querySelector(".discussion-dialog[open]")'));
    assert.ok((await evaluate('document.querySelector(".discussion-dialog").textContent')).includes(scenario.expected),scenario.expected);
    assert.equal(await evaluate('document.querySelector(".discussion-dialog blockquote").textContent'),'blue venue');
    await key('Escape','Escape',27);
  }
  await features();await click('[role=switch][aria-label="Discussion status"]');await closeFeatures();
  assert.ok(await until('document.querySelectorAll(".discussion-controls").length===0'));
  const before=readFileSync(f.journal,'utf8');await sleep(100);assert.equal(readFileSync(f.journal,'utf8'),before,'off makes no new status writes');
  assert.deepEqual(b.errors,[]);assert.deepEqual(b.external,[]);
  writeFileSync(join(f.dir,'receipt.json'),JSON.stringify({state:'pass',kind:'synthetic core and browser',checks:['default off','socket opt-in','identity','actor','stale refusal','reply stays resolved','restart','same anchor and reply IDs','four view/theme screenshots','200%','reduced motion','Escape focus','off'],limitations:['No physical device or human acceptance.']},null,2));
  console.log(`PASS c10-discuss: isolated journal/socket/browser; evidence ${f.dir}`);
} finally {await f.close();}
