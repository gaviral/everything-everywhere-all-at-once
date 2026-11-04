// Adapted from the stranded keyless-thought check: same one-second visibility, persistence, no false flight,
// mic explanation and welcome-position checks. Canonical pending words are in the measured dock, not a fake point.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { captureCore, capturePage, typeCapture, empty } from './capture-fixture.mjs';
import { ready, sleep } from './headless.mjs';
if (ready()) { console.log(`SKIP keyless-thought-check: ${ready()}`); process.exit(3); }
for (const [width, height] of [[1440,900],[390,844]]) for (const scheme of ['light','dark']) for (const populated of [false,true]) {
  const seed = empty();
  if (populated) {
    seed.threads.push({ id:'T1', title:'Rent', parent_id:null, status:'open', last_point:'Pay rent', touched_ms:1, tags:[], picture:null, dropped_by:'' });
    seed.active='T1'; seed.active_by={you:'T1'};
    seed.thoughts.push({ id:'old', speaker:'you', text:'Pay rent', point:'Pay rent', thread_id:'T1', placed:true, complete:true, at_ms:1 });
  }
  const core = await captureCore({key:false, seed});
  let browser;
  try {
    browser = await capturePage(core,{width,height,scheme});
    const {evaluate,until,page} = browser, label=`${width} ${scheme} ${populated?'populated':'empty'}`;
    const top = await evaluate('document.querySelector(".shell-welcome h1")?.getBoundingClientRect().top ?? null');
    const words = 'I need to call the dentist about Thursday';
    await typeCapture(browser,words);
    assert.ok(await until(`document.querySelector('.capture-item')?.textContent.includes(${JSON.stringify(words)})`,1000), `${label}: original words visible within one second`);
    assert.equal(await evaluate('document.querySelectorAll(".capture-item").length'),1,'one canonical pending source');
    assert.ok(await until('document.querySelector(".capture-state")?.textContent === "Saved · placing needs an AI key"'), 'Saved only after persistence receipt');
    const id=await evaluate('document.querySelector(".capture-item").dataset.capture');
    await sleep(5700);
    assert.equal(await evaluate('document.querySelectorAll(".bubble-flight-bubble").length'),0,'no false placement flight');
    assert.equal(await evaluate('document.querySelector(".capture-item").dataset.capture'),id,'source survives the flight timeout');
    const geometry=await evaluate(`(() => { const r=document.querySelector('.capture-item').getBoundingClientRect(), c=document.querySelector('[data-guide="composer"]').getBoundingClientRect(); return {left:r.left,right:r.right,bottom:r.bottom,composer:c.top,dashed:getComputedStyle(document.querySelector('.capture-item')).borderTopStyle}; })()`);
    assert.ok(geometry.left>=0&&geometry.right<=width&&geometry.bottom<=geometry.composer,'pending source stays clear of the composer and screen edges');
    assert.equal(geometry.dashed,'dashed','unplaced words are distinguished from placed points');
    if(process.env.SHOTS){mkdirSync(process.env.SHOTS,{recursive:true});const {data}=await page('Page.captureScreenshot',{format:'png'});writeFileSync(join(process.env.SHOTS,`keyless-${width}-${scheme}-${populated?'populated':'empty'}.png`),Buffer.from(data,'base64'));}
    if(top!==null) assert.ok(Math.abs(await evaluate('document.querySelector(".shell-welcome h1").getBoundingClientRect().top')-top)<=2,'welcome title stays in place');
    await page('Page.reload');
    assert.ok(await until(`document.querySelector('.capture-item[data-capture="${id}"]')?.textContent.includes(${JSON.stringify(words)})`), 'same ID and original words after reload');
    assert.ok(await until('document.querySelector(".mic")?.dataset.state === "nokey"'), 'key status restored after reload');
    const mic = await evaluate('(()=>{const r=document.querySelector(".mic").getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()');
    for(const type of ['mousePressed','mouseReleased']) await page('Input.dispatchMouseEvent',{type,...mic,button:'left',clickCount:1});
    assert.ok(await until('document.querySelector(".ai-setup[open]")?.textContent.includes("Set up AI")'), 'mic failure opens explicit AI setup');
    assert.ok(await evaluate('document.querySelector(".ai-setup").textContent.includes("saving typed thoughts")'), 'setup explains typed thoughts remain available');
    await evaluate('document.querySelector(".ai-setup button").click()');
    assert.ok(await until('!document.querySelector(".ai-setup")'), 'setup closes back to the map');
    assert.equal(await evaluate('document.querySelector(".capture-item").dataset.capture'), id, 'setup preserves the pending source');
    for(let i=0;i<6;i++) await typeCapture(browser,`Additional saved thought ${i}`);
    assert.ok(await until('document.querySelectorAll(".capture-item").length===7'), 'every capture remains reachable, including beyond the old five-item limit');
    assert.equal(core.state.world.thoughts.filter(t=>!t.placed).length,7);
  } finally { await browser?.close(); core.close(); }
}
console.log('keyless-thought-check: ok (eight size/theme/map cases; one-second visibility, durable IDs, mic recovery, no false flight)');
