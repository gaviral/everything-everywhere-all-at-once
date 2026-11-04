// The built app in real Chrome: 12 pinned turns, 5 adjacent comments, original words and a held pan.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

const unavailable = ready();
if (unavailable) { console.log(`SKIP conversation-spine-check: ${unavailable}`); process.exit(3); }
const at = Date.now();
const topic = (id, title, parent_id = null) => ({ id, title, parent_id, status: "open", last_point: "", touched_ms: at, tags: [], picture: null, dropped_by: "" });
const thought = (n) => ({ id: `p${n}`, speaker: n % 2 ? "you" : "Sam", text: `Um, thought ${n}: keep the wall blue, and rent is due Friday.`, point: `Um, thought ${n}: keep the wall blue, and rent is due Friday.`, thread_id: "T1", placed: true, complete: true, at_ms: at + n, place_ms: 0 });
const world = { threads: [topic("T1", "Our room")], thoughts: Array.from({ length: 11 }, (_, i) => thought(i + 1)), active: "T1", active_by: { you: "T1" }, stay_here: "T1", anchors: {}, notes: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], proposals: [], ai: ["Helper"] };
const comment = (n, text) => {
  const id = `c${n}`, p = thought(n);
  const thread = topic(id, `On thought ${n}`, "T1");
  const note = { ...p, id: `reply${n}`, speaker: "Helper", thread_id: id, text, point: text };
  const anchor = { thought_id: p.id, quote: p.text };
  return { thread, note, anchor };
};
for (const n of [2, 5, 8, 11]) {
  const c = comment(n, n === 5 ? "Before we choose, can you check the wall in daylight and again after sunset? The blue may look different beside the window, so keep the sample there until we have both had a chance to see it." : `Which blue for thought ${n}?`);
  world.threads.push(c.thread); world.thoughts.push(c.note); world.anchors[c.thread.id] = c.anchor;
}
const core = await standInCore(() => [{ type: "snapshot", world }]);
assert.ok(core.port >= 4620, `spare port: ${core.port}`);
let browser;
try {
  browser = await openPage("about:blank", { width: 1440, height: 900 });
  const { page, evaluate, until } = browser;
  await page("Page.enable");
  await page("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('e2a2o.toured','1'); window.errors=[]; addEventListener('error',e=>{if(!e.message.startsWith('ResizeObserver')) errors.push(e.message)});` });
  await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/` });
  assert.ok(await until(`!!document.querySelector('.spine-ready .spine-original')`, 10000), "pinned spine opens");
  const camera = () => evaluate(`document.querySelector('.react-flow__viewport').style.transform`);
  const newestVisible = (n) => evaluate(`(() => { const r=document.querySelector('[data-thought="p${n}"] .spine-text').getBoundingClientRect(); return r.top>=0 && r.bottom<innerHeight && r.left>=0 && r.right<=innerWidth; })()`);
  assert.ok(await newestVisible(11), "newest thought opens in view");
  assert.equal(await evaluate(`document.querySelector('[data-thought="p11"] .spine-words').textContent`), "thought 11: keep the wall blue, and rent is due Friday.");
  const click = async (selector) => {
    const p = await evaluate(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    for (const type of ["mousePressed", "mouseReleased"]) await page("Input.dispatchMouseEvent", { type, ...p, button: "left", clickCount: 1 });
  };
  await click('[data-thought="p11"] .spine-original');
  assert.ok(await until(`document.querySelector('[data-thought="p11"] .spine-original').getAttribute('aria-expanded')==='true'`));
  assert.equal(await evaluate(`document.querySelector('[data-thought="p11"] .spine-words').textContent`), thought(11).text, "one click restores verbatim");
  await click('[data-thought="p11"] .spine-original');
  await click('.spine-follow'); // Explicitly resume after reading the original.
  await sleep(500);
  // A sustained real drag: arrivals cannot take the camera even before the hand lets go.
  await page("Input.dispatchMouseEvent", { type: "mousePressed", x: 1250, y: 220, button: "left", buttons: 1, clickCount: 1 });
  await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1250, y: 620, button: "left", buttons: 1 });
  const held = await camera();
  const send = (change) => core.send({ type: "change", change });
  const p = thought(12);
  send({ type: "thought_added", thought: { ...p, placed: false, point: "" } });
  send({ type: "thought_placed", thought_id: p.id, thread_id: "T1", point: p.text, unclear: "", complete: true, place_ms: 0 });
  const c = comment(12, "Should we try the blue by the window first?");
  send({ type: "thread_added", thread: c.thread });
  send({ type: "anchored", thread_id: c.thread.id, ...c.anchor });
  send({ type: "thought_added", thought: c.note });
  assert.ok(await until(`document.querySelectorAll('.spine-point').length===12 && document.querySelectorAll('.spine-margin').length===5`));
  await sleep(3000);
  assert.equal(await camera(), held, "arrival respects the hand during a long drag");
  await page("Input.dispatchMouseEvent", { type: "mouseReleased", x: 1250, y: 620, button: "left", buttons: 0, clickCount: 1 });
  await sleep(500);
  assert.equal(await camera(), held, "arrival respects recent pan after release");
  // Keep the old 60-second observation window: elapsed reading time must not override a manual pan.
  await sleep(60000);
  assert.equal(await evaluate(`document.querySelector('.spine-follow').getAttribute('aria-pressed')`), 'false', 'manual pan stays held until explicit Follow');
  assert.equal(await camera(), held, 'reading time does not move the held camera');
  await click('.spine-follow');
  assert.ok(await until(`document.querySelector('.spine-follow').getAttribute('aria-pressed')==='true'`), "explicit Follow resumes without another arrival");
  await sleep(700);
  assert.ok(await newestVisible(12), "newest thought is visible after explicit Follow");
  const rows = await evaluate(`(() => {
    const box=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
    return {points:[...document.querySelectorAll('.spine-point')].map(e=>({id:e.dataset.thought,...box(e.closest('.react-flow__node'))})),
      comments:[...document.querySelectorAll('.spine-margin')].map(e=>({id:e.dataset.margin,...box(e),clipped:[...e.querySelectorAll('.spine-entry-text')].some(t=>t.scrollHeight>t.clientHeight+1)}))};
  })()`);
  assert.deepEqual(rows.points.map(p => p.id), Array.from({ length: 12 }, (_, i) => `p${i+1}`), "spoken order");
  for (let i=1;i<rows.points.length;i++) assert.ok(rows.points[i].top>=rows.points[i-1].bottom, "thoughts do not overlap");
  for (const c of rows.comments) {
    const p=rows.points.find(p=>p.id===`p${c.id.slice(1)}`);
    assert.ok(c.left>=p.right && Math.abs(c.top-p.top)<2, `${c.id} beside its thought`);
    assert.equal(c.clipped,false, `${c.id} readable in full without hover`);
  }
  const last = rows.comments.find(c=>c.id==='c12');
  assert.ok(last.left>=0 && last.top>=0 && last.right<=1440 && last.bottom<=900, "newest comment in view too");
  const separate=(a,b)=>a.right<=b.left || b.right<=a.left || a.bottom<=b.top || b.bottom<=a.top;
  const all=[...rows.points,...rows.comments];
  for(let i=0;i<all.length;i++) for(let j=i+1;j<all.length;j++) assert.ok(separate(all[i],all[j]), `${all[i].id} and ${all[j].id} separate`);
  if(process.env.SHOTS) {
    mkdirSync(process.env.SHOTS,{recursive:true});
    const shot=await page('Page.captureScreenshot',{format:'png'});
    writeFileSync(`${process.env.SHOTS}/conversation-spine-1440.png`,Buffer.from(shot.data,'base64'));
  }
  // At phone width the same comments stay readable directly under their words.
  await page('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  assert.ok(await until(`!!document.querySelector('[data-thought="p12"] .spine-tuck')`, 5000));
  await sleep(3000);
  assert.ok(await newestVisible(12), 'newest thought remains visible after resize');
  assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), 'no sideways page overflow');
  assert.equal(await evaluate(`document.querySelector('[data-thought="p12"] .spine-tuck .spine-entry-text').textContent`), c.note.text);
  await evaluate(`document.querySelector('[data-thought="p12"] .spine-original').focus()`);
  for (const type of ['keyDown','keyUp']) await page('Input.dispatchKeyEvent', {type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:type==='keyDown'?'\r':undefined});
  assert.ok(await until(`document.querySelector('[data-thought="p12"] .spine-original').getAttribute('aria-expanded')==='true'`), 'original words open by keyboard');
  assert.equal(await evaluate(`document.querySelector('[data-thought="p12"] .spine-words').textContent`), p.text);
  if(process.env.SHOTS) {
    const shot=await page('Page.captureScreenshot',{format:'png'});
    writeFileSync(`${process.env.SHOTS}/conversation-spine-390.png`,Buffer.from(shot.data,'base64'));
  }
  assert.deepEqual(await evaluate('window.errors'),[]);
  console.log(`PASS conversation spine: 12 thoughts, 5 comments, original words, held pan, resumed follow; Chrome, port ${core.port}`);
} finally { await browser?.close(); core.close(); }
