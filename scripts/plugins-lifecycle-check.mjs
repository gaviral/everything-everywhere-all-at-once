// Round-one regressions on the built app, using synthetic jobs/audio and an isolated stand-in core.
import assert from "node:assert/strict";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP plugins-lifecycle-check: ${why}`); process.exit(3); }
const at = Date.now();
const world = {
  threads: [{ id: "T1", title: "Synthetic topic", parent_id: null, status: "open", last_point: "", touched_ms: at, tags: [], picture: null, dropped_by: "" }],
  active: "T1", active_by: { you: "T1" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], ai: [],
  thoughts: [{ id: "one", speaker: "you", text: "Synthetic thought", point: "Synthetic thought", thread_id: "T1", placed: true, unclear: "", complete: true, at_ms: at, place_ms: 1 }],
};
const job = n => ({ type: "job", id: `synthetic-${n}`, title: `Synthetic job ${n}`, status: "done", result: "Synthetic result", by: "Helper", at_ms: at + n, demo: true });
const core = await standInCore(() => [{ type: "snapshot", world }, ...Array.from({ length: 45 }, (_, n) => job(n))]);
let browser;
const failures = [];
const timeout = setTimeout(() => { console.error("plugins-lifecycle-check: timed out"); process.exit(1); }, 120_000);
try {
  browser = await openPage("about:blank", { width: 1440, height: 900 });
  const { page, evaluate, until } = browser;
  const diagnostics = () => evaluate(`(()=>{const box=document.querySelector('.work-spine-scroll');return {
    mic:{requests:fakeMic.requests,connections:fakeMic.connections,stops:fakeMic.stops,contexts:fakeMic.contexts.map(c=>c.state),state:document.querySelector('.mic')?.dataset.state},
    list:box&&{top:box.scrollTop,height:box.scrollHeight,client:box.clientHeight,latest:!!document.querySelector('.work-spine-latest')},
    saved:Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.endsWith(':job-following')||k.endsWith(':job-scroll')))
  }})()`);
  const check = async (expr, label) => {
    if (!await until(expr, 8000)) assert.fail(`${label}: ${JSON.stringify(await diagnostics())}`);
  };
  const click = async selector => {
    await check(`!!document.querySelector(${JSON.stringify(selector)})`, selector);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  const toggle = id => click(`[data-plugin-row="${id}"] button`);
  await page("Page.enable");
  await page("Page.addScriptToEvaluateOnNewDocument", { source: `
    localStorage.setItem('e2a2o.toured', '1');
    localStorage.setItem('e2a2o.features', JSON.stringify({plugins:true}));
    localStorage.setItem('e2a2o.bricks', JSON.stringify({'work-spine':true}));
    window.fakeMic = {requests:0, connections:0, stops:0, contexts:[], captureContexts:[]};
    class FakeContext {
      constructor() { this.state='running'; this.sampleRate=24000; this.destination={}; this.audioWorklet={addModule:async()=>{}}; fakeMic.contexts.push(this); }
      createMediaStreamSource() { return {connect(){fakeMic.connections++},disconnect(){}}; }
      createGain() { return {gain:{value:1},connect(){return this}}; }
      async resume() { this.state='running'; }
      async close() { this.state='closed'; }
    }
    window.AudioContext=FakeContext;
    window.AudioWorkletNode=class { constructor(){this.port={postMessage(){},close(){},onmessage:null}} connect(){return this} disconnect(){} };
    Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:()=>{
      fakeMic.requests++;
      fakeMic.captureContexts.push(fakeMic.contexts.at(-1));
      return new Promise(resolve=>{fakeMic.resolve=()=>resolve({getTracks:()=>[{
        stop(){fakeMic.stops++},getSettings(){return {echoCancellation:true}}
      }]})});
    }}});
  ` });
  await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/` });
  await check(`!!document.querySelector('.mic:not(:disabled)') && !!document.querySelector('.work-spine-scroll')`, "mounted mic and Work spine");
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'p',bubbles:true}))`);
  await check(`!!document.querySelector('[data-plugin-row="listening"] button')`, "Plugins controls");

  try {
    // The mic start requires a real browser gesture; all capture APIs above are fake.
    const tapMic = async () => {
      const { x, y } = await evaluate(`(()=>{const r=document.querySelector('.mic').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await page("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await page("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    };
    await tapMic();
    await check(`fakeMic.requests === 1 && document.querySelector('.mic').dataset.state === 'starting'`, "getUserMedia start is pending");
    await toggle("listening");
    await check(`!document.querySelector('.mic')`, "Listening unload hides mic");
    await evaluate(`fakeMic.resolve()`);
    await check(`fakeMic.stops === 1 && fakeMic.captureContexts.every(c=>c.state==='closed')`, "late stream and context released");
    assert.equal(await evaluate(`fakeMic.connections`), 0, "late stream never connects capture");
    assert.equal(core.heard.filter(m => m.type === "listen" && m.on).length, 0, "no late listen:on");
    await toggle("listening");
    await check(`document.querySelector('.mic')?.dataset.state === 'off'`, "reload leaves mic off");
    assert.equal(await evaluate(`fakeMic.requests`), 1, "reload never requests recording");
    // A new gesture still works, and unloading an active mic still releases it.
    await tapMic();
    await check(`fakeMic.requests === 2`, "fresh mic gesture");
    await evaluate(`fakeMic.resolve()`);
    await check(`document.querySelector('.mic')?.getAttribute('aria-pressed') === 'true'`, "fresh capture starts");
    assert.equal(core.heard.filter(m => m.type === "listen" && m.on).length, 1);
    await toggle("listening");
    await check(`fakeMic.stops === 2 && fakeMic.captureContexts.every(c=>c.state==='closed')`, "active capture unload releases resources");
    await toggle("listening");
    console.log("PASS Listening: pending start aborted, late stream released, reload idle, fresh gesture and active unload work");
  } catch (error) { failures.push(error); console.error(`FAIL Listening: ${error.message}`); }

  try {
    const scroll = `document.querySelector('.work-spine-scroll')`;
    const atFoot = `(${scroll}.scrollHeight - ${scroll}.scrollTop - ${scroll}.clientHeight < 2)`;
    await check(`${scroll}.scrollHeight > ${scroll}.clientHeight + 500`, "long synthetic job list");
    // An explicit scroll event makes state capture deterministic before immediate unload.
    await evaluate(`${scroll}.scrollTop=120; ${scroll}.dispatchEvent(new Event('scroll',{bubbles:true}))`);
    await check(`${scroll}.scrollTop === 120 && !!document.querySelector('.work-spine-latest')`, "reading older jobs");
    await toggle("work-spine");
    await check(`!${scroll}`, "Work spine unmounted");
    core.send(job(45));
    await toggle("work-spine");
    await check(`!!${scroll}`, "Work spine remounted");
    await sleep(900); // allow resize callbacks and mount layout to settle
    assert.equal(await evaluate(`${scroll}.scrollTop`), 120, "reload retains scroll through follow/resize");
    assert.ok(await evaluate(`!!document.querySelector('.work-spine-latest')`), "reload retains Latest affordance");
    core.send(job(46));
    await sleep(250);
    assert.equal(await evaluate(`${scroll}.scrollTop`), 120, "new jobs do not pull older reading to foot");
    await evaluate(`${scroll}.scrollTop=0; ${scroll}.dispatchEvent(new Event('scroll',{bubbles:true}))`);
    await toggle("work-spine");
    await check(`!${scroll}`, "top-of-list reading unmounted");
    await toggle("work-spine");
    await check(`!!${scroll} && ${scroll}.scrollTop === 0 && !!document.querySelector('.work-spine-latest')`, "zero scroll retains reading choice too");
    await sleep(250);
    assert.equal(await evaluate(`${scroll}.scrollTop`), 0);
    await click(".work-spine-latest");
    await check(atFoot, "Latest resumes following");
    await sleep(250);
    await check(`!document.querySelector('.work-spine-latest') && ${atFoot}`, "Latest settles in following mode");
    await toggle("work-spine");
    await check(`!${scroll}`, "following list unmounted");
    core.send(job(47));
    await toggle("work-spine");
    await check(`!!${scroll} && ${atFoot}`, "following survives reload with new jobs");
    core.send(job(48));
    await check(`!!document.querySelector('[data-job-id="synthetic-48"]') && ${atFoot}`, "following keeps tracking new jobs");
    assert.equal(await evaluate(`!!document.querySelector('.work-spine-latest')`), false);
    console.log("PASS Work spine: scroll 120 retained after unload/reload and new jobs; Latest and following restored");
  } catch (error) { failures.push(error); console.error(`FAIL Work spine: ${error.message}`); }
  assert.equal(failures.length, 0, "plugin lifecycle regressions");
} finally {
  clearTimeout(timeout);
  await browser?.close();
  await core.close();
}
