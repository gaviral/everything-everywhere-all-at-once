// Real rendered input, synthetic voice/placement events. No model or microphone service is claimed by this check.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { captureCore, capturePage, typeCapture, empty } from './capture-fixture.mjs';
import { ready } from './headless.mjs';
if (ready()) { console.log(`SKIP capture-in-place-check: ${ready()}`); process.exit(3); }
const shots=process.env.SHOTS;
if(shots)mkdirSync(shots,{recursive:true});
for(const [width,height,scheme,reduced] of [[1440,900,'light',false],[390,844,'light',false],[1440,900,'dark',false],[390,844,'dark',false],[1440,900,'light',true],[320,568,'light',true]]) {
  const core=await captureCore({delay:1200});
  let browser;
  const label=`${width}-${scheme}-${reduced?'reduced':'motion'}`;
  try {
    browser=await capturePage(core,{width,height,scheme,reduced});
    const {evaluate,until,page}=browser;
    const settle=()=>evaluate(`new Promise(resolve=>{let prior='',same=0;const tick=()=>{const e=document.querySelector('[data-map-capture=active]'),r=e?.getBoundingClientRect(),s=r&&[r.x.toFixed(1),r.y.toFixed(1),r.height.toFixed(1)].join();same=s===prior?same+1:0;prior=s;if(same>=5)resolve(true);else requestAnimationFrame(tick)};tick()})`);
    const shot=async name=>{if(!shots)return;await settle();const {data}=await page('Page.captureScreenshot',{format:'png'});writeFileSync(`${shots}/${label}-${name}.png`,Buffer.from(data,'base64'));};
    const tapMic=async()=>{
      await settle();
      const at=await evaluate(`(()=>{const e=document.querySelector('button.mic'),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      for(const type of ['mousePressed','mouseReleased'])await page('Input.dispatchMouseEvent',{type,...at,button:'left',clickCount:1});
    };
    assert.ok(await until(`!!document.querySelector('.spine-ready')&&!!document.querySelector('[data-map-capture=active] textarea')`),'first input is on the map');
    await settle();
    const opening=await evaluate(`(()=>{const r=document.querySelector('[data-map-capture=active]').getBoundingClientRect();return{x:r.x,y:r.y,w:r.width}})()`);
    assert.ok(opening.x>=0&&opening.x<Math.max(60,width*.15)&&opening.y>=64&&opening.y<height*.35,`${label}: first thought starts upper left: ${JSON.stringify(opening)}`);
    await evaluate(`navigator.mediaDevices.getUserMedia=async()=>{const ctx=new AudioContext(),tone=ctx.createOscillator(),out=ctx.createMediaStreamDestination();tone.connect(out);tone.start();return out.stream;}`);
    await tapMic();
    assert.ok(await until(`document.querySelector('button.mic')?.getAttribute('aria-pressed')==='true'`),'mic capture opens from a real gesture');
    core.send({type:'status',listening:true});
    core.send({type:'partial',text:'Plant tomatoes near the sunny fence'});
    assert.ok(await until(`document.querySelector('.map-capture-live p')?.textContent==='Plant tomatoes near the sunny fence'`),'live words appear in the map');
    assert.equal(await evaluate(`document.querySelectorAll('.tiny-transcript,[data-flight]').length`),0,'one visible speech surface');
    assert.equal(await evaluate(`document.querySelector('[data-slot=status]').textContent.includes('Plant tomatoes')`),false,'no separate caption in bottom status');
    await shot('live');
    await evaluate(`window.captureFrames=[];window.sampleCapture=true;const sample=()=>{if(!window.sampleCapture)return;const visible=[...document.querySelectorAll('.map-capture-live p,[data-capture] p,.spine-point .spine-text')].some(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return e.textContent.includes('Plant tomatoes near the sunny fence')&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&r.right>0&&r.left<innerWidth&&r.bottom>60&&r.top<innerHeight-40});captureFrames.push(visible);requestAnimationFrame(sample)};sample()`);
    const id='spoken-garden' ,text='Plant tomatoes near the sunny fence';
    const thought={id:'voice-garden',speaker:'you',text,point:'',thread_id:null,placed:false,complete:true,at_ms:Date.now()};
    const capture={id,text,thought_ids:[thought.id]};
    core.state.world.thoughts.push(thought);core.state.accepted.set(id,capture);
    core.send({type:'change',change:{type:'thought_added',thought}});
    core.send({type:'capture_saved',capture,replay:false});
    core.send({type:'partial',text:''});
    assert.ok(await until(`document.querySelector('[data-capture="${id}"] p')?.textContent===${JSON.stringify(text)}`),'turn end retains exact words in place');
    assert.ok(await until(`document.querySelector('[data-capture="${id}"]')?.dataset.saved==='true'`),'Saved follows durable receipt');
    await shot('waiting');
    core.place(id);
    assert.ok(await until(`!!document.querySelector('.spine-point[data-thought="${thought.id}"]')`),'structured point replaces the turn');
    assert.ok(await until(`!document.querySelector('[data-capture="${id}"]')`),'pending copy retires after placement');
    await shot('landed');
    const continuity=await evaluate(`window.sampleCapture=false;captureFrames`);
    assert.ok(continuity.length>=5&&continuity.every(Boolean),`${label}: source or structured words remain visible on every sampled handoff frame`);
    const clear=await evaluate(`(()=>{const a=document.querySelector('[data-map-capture=active]').getBoundingClientRect(),p=document.querySelector('.spine-point').getBoundingClientRect();return{clear:a.right<=p.left||a.left>=p.right||a.bottom<=p.top||a.top>=p.bottom,gap:Math.min(Math.abs(a.left-p.right),Math.abs(a.top-p.bottom)),visible:a.left>=0&&a.right<=innerWidth&&a.top>=60&&a.bottom<innerHeight-30}})()`);
    assert.ok(clear.clear&&clear.visible,`${label}: next input is clear and visible: ${JSON.stringify(clear)}`);
    assert.ok(clear.gap<=120,`${label}: next thought stays near the landing`);
    await typeCapture(browser,'Keep a notebook of the garden plan');
    const typed=[...core.state.accepted.keys()].find(key=>key!==id);
    assert.ok(typed,'typing uses the same place');
    assert.ok(await until(`!!document.querySelector('.spine-point[data-thought="th-${typed}"]')`,6000),'typed thought lands');
    await shot('typed');
    // Speech while typing must never replace an editable draft.
    await evaluate(`document.querySelector('textarea').focus()`);
    await page('Input.insertText',{text:'An unfinished typed draft'});
    core.send({type:'partial',text:'A different spoken thought'});
    assert.ok(await until(`document.querySelector('.map-capture-live')?.textContent.includes('A different spoken thought')`));
    assert.equal(await evaluate(`document.querySelector('textarea').value`),'An unfinished typed draft','speech preserves typed draft');
    await tapMic();
    assert.ok(await until(`document.querySelector('button.mic')?.getAttribute('aria-pressed')==='false'`),'mic remains reachable and stops');
    assert.equal(await evaluate(`document.querySelector('textarea').value`),'An unfinished typed draft','stopping preserves draft');
    if(reduced)assert.equal(await evaluate(`getComputedStyle(document.querySelector('.capture-anchor')).transitionDuration`),'0s','reduced motion avoids sliding');
    if(width===1440&&!reduced&&scheme==='light') {
      await evaluate(`document.querySelector('textarea').style.setProperty('font-size','24px','important')`);
      await shot('enlarged-draft');
      assert.equal(await evaluate(`document.querySelector('textarea').value`),'An unfinished typed draft','enlarged draft remains editable');
    }
    await page('Page.reload');
    assert.ok(await until(`document.querySelectorAll('.spine-point[data-thought]').length===2`),'both saved thoughts survive reload');
    assert.equal(core.state.accepted.size,2,'reload does not resubmit captures');
    console.log(`PASS capture in place ${label}: voice turn, typed turn, nearby clear input, draft, stop, reload`);
  } catch(error) {
    if(shots&&browser){const {data}=await browser.page('Page.captureScreenshot',{format:'png'});writeFileSync(`${shots}/${label}-failure.png`,Buffer.from(data,'base64'));}
    throw error;
  } finally {await browser?.close();core.close();}
}

// Spines remain spines when another topic becomes active; precedence reads across each row.
{
  const seed=empty();
  for(let i=0;i<8;i++) {
    const id=`topic-${i}`;
    seed.threads.push({id,title:`Garden topic ${i+1}`,parent_id:null,status:'open',last_point:'A garden idea',touched_ms:i+1,tags:[],picture:null,dropped_by:''});
    seed.thoughts.push({id:`idea-${i}`,speaker:'you',text:`Garden idea ${i+1}`,point:`Garden idea ${i+1}`,thread_id:id,placed:true,complete:true,at_ms:i+1});
  }
  seed.active='topic-0';seed.active_by={you:'topic-0'};
  const core=await captureCore({seed});let b;
  try {
    b=await capturePage(core);
    assert.ok(await b.until('document.querySelectorAll(".spine-head").length===8'),'all created spines keep their headers');
    await b.evaluate('document.activeElement?.blur()');
    for(const type of ['keyDown','keyUp'])await b.page('Input.dispatchKeyEvent',{type,key:'0',code:'Digit0',windowsVirtualKeyCode:48});
    assert.ok(await b.until(`Array.from(document.querySelectorAll('.spine-head')).every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=50&&r.bottom<innerHeight-80})`),'See all reveals every spine');
    const boxes=await b.evaluate(`Array.from({length:8},(_,i)=>document.querySelector('.spine-head[data-thread="topic-'+i+'"]').getBoundingClientRect().toJSON())`);
    for(let i=1;i<6;i++)assert.ok(boxes[i].x>boxes[i-1].x&&Math.abs(boxes[i].y-boxes[0].y)<1,'first row reads left to right');
    assert.ok(boxes[6].y>boxes[0].bottom&&Math.abs(boxes[6].x-boxes[0].x)<1&&boxes[7].x>boxes[6].x,'next row starts below at the left');
    console.log('PASS capture in place: persistent spines read left to right, then top to bottom');
  } finally {await b?.close();core.close();}
}
