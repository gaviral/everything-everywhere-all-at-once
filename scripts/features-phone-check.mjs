// Deterministic synthetic UI evidence. No model, microphone, personal map, or journal is opened.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";
const unavailable = ready();
if (unavailable) { console.log(`SKIP c10-phone-check: ${unavailable}`); process.exit(3); }
const evidence = mkdtempSync(join(tmpdir(), "c10-phone-"));
const at = 1800000000000;
const topic = (id, title, parent_id = null) => ({ id, title, parent_id, status: "open", last_point: "", touched_ms: at, tags: [], picture: null, dropped_by: "" });
const point = (id, text, thread_id, n, speaker = "you") => ({ id, text, point: text, thread_id, speaker, at_ms: at+n, placed: true, complete: true, unclear: "", place_ms: 0 });
const world = { threads: [topic("T", "Reading plan"), topic("A", "First tangent", "T"), topic("B", "Nested tangent", "A"), topic("C", "Older tangent", "T"), topic("D", "Topic branch", "T")],
  thoughts: [point("p1", "Read point one.", "T", 1), point("a1", "Tangent one.", "A", 2, "Reader"), point("b1", "Keep the nested point.", "B", 3, "Helper"), point("p2", "Older point.", "T", 4), point("c1", "Return to that older point.", "C", 5), point("p3", "The latest point stays separate.", "T", 6), point("d1", "This branch names a topic only.", "D", 7)],
  anchors: { A: { thought_id: "p1", quote: "Read point one." }, B: { thought_id: "a1", quote: "Tangent one." }, C: { thought_id: "p2", quote: "Older point." } },
  active: "T", active_by: { you: "T" }, notes: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], proposals: [], ai: ["Helper"], positions: { p3: { x: 0, y: 500, by: "you", at_ms: at } } };
let current = structuredClone(world);
const core = await standInCore(() => [{ type: "snapshot", world: current }]);
assert.ok(![4360,4399].includes(core.port));
const logs = [];
let browser;
try {
 for (const theme of ["light", "dark"]) {
  browser = await openPage("about:blank", { width: 390, height: 844 });
  const { page, evaluate, until } = browser;
  await page("Page.enable");
  await page("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('e2a2o.toured','1'); window.errors=[]; addEventListener('error', e=>{if(!e.message.startsWith('ResizeObserver')) errors.push(e.message)});` });
  await page("Emulation.setEmulatedMedia", { features: [{name:"prefers-color-scheme",value:theme},{name:"prefers-reduced-motion",value:"reduce"}] });
  await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/` });
  assert.ok(await until(`!!document.querySelector('.spine-ready .spine-text')`,15000), "baseline opens");
  assert.equal(await evaluate(`!!document.querySelector('.phone-controls, .inline-phone')`), false, "fresh profile defaults off");
  const click = async selector => {
   await evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)}); if(!e) throw Error('Missing control: '+${JSON.stringify(selector)}); e.scrollIntoView({block:'nearest'}); e.click();})()`);
   await sleep(80);
  };
  const toggle = async () => {
   await click('.shell-tr button[data-guide="catalog"]');
   assert.ok(await until(`!!document.querySelector('[data-row="compare-phone-reading"] [role="switch"]')`));
   await click('[data-row="compare-phone-reading"] [role="switch"]');
   await click('.shell-rail-close');
  };
  await toggle();
  assert.ok(await until(`document.querySelector('.spine-frame').dataset.phoneReadingMode==='spatial'`), "enable retains A");
  const shot = async name => {const {data}=await page("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});writeFileSync(join(evidence,`${theme}-${name}.png`),Buffer.from(data,"base64"));};
  const draft = "Draft stays editable.";
  await evaluate(`(() => {const e=document.querySelector('.shell-composer textarea, .shell-composer input'); const setter=Object.getOwnPropertyDescriptor(e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set; setter.call(e,${JSON.stringify(draft)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const readDraft = () => evaluate(`document.querySelector('.shell-composer textarea, .shell-composer input').value`);
  const open = async (id, isPoint = false) => {
   await click('.phone-controls summary');
   await click(`[data-phone-${isPoint?"point":"open"}="${id}"]`);
   await sleep(80);
  };
  const bounds = async (id, inline) => {
   const result = await evaluate(`(() => {
    const f=document.querySelector('.spine-frame'), a=JSON.parse(f.dataset.phoneBounds), fr=f.getBoundingClientRect();
    const q=${JSON.stringify(inline ? '.inline-phone' : '.spatial-reading-mode')};
    const e=document.querySelector(q+' [data-heads~="${id}"]');
    if(!e) return {missing:true};
    const text=e.querySelector(${JSON.stringify(inline?'.inline-words':'.spine-text')});
    const range=document.createRange();range.selectNodeContents(text);
    const rects=[...range.getClientRects()].filter(r=>r.width&&r.height).map(r=>({l:r.left,r:r.right,t:r.top,b:r.bottom}));
    const controls=[...e.querySelectorAll('button')].filter(e=>e.checkVisibility()).map(e=>{const r=e.getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom}});
    return {area:{l:fr.left+a.x0,r:fr.left+a.x1,t:fr.top+a.y0,b:fr.top+a.y1},rects,controls,font:getComputedStyle(text).fontSize, words:text.textContent, focus:document.activeElement.closest('[data-heads]')?.dataset.heads};
   })()`);
   assert.equal(result.missing, undefined, `${id}: live point exists`);
   assert.ok(result.rects.length, `${id}: words measured`);
   const a=result.area;
   for(const r of result.rects) assert.ok(r.l>=a.l-1&&r.r<=a.r+1&&r.t>=a.t-1&&r.b<=a.b+1,`${id}: source words in usable rectangle ${JSON.stringify(result)}`);
   assert.ok(result.controls.length >= 1, `${id}: point actions measured`);
   for(const r of result.controls) assert.ok(r.l>=a.l-1&&r.r<=a.r+1&&r.t>=a.t-1&&r.b<=a.b+1,`${id}: action in usable rectangle ${JSON.stringify(result)}`);
   assert.equal(result.focus,id,`${id}: keyboard focus returns to exact point`);
   return result;
  };
  for(const [height, scale] of [[844,1],[560,1],[844,2],[560,2]]) {
   await page("Emulation.setEmulatedMedia",{features:[{name:"prefers-color-scheme",value:theme},{name:"prefers-reduced-motion",value:scale===2?"reduce":"no-preference"}]});
   await page("Emulation.setDeviceMetricsOverride",{width:390,height,deviceScaleFactor:1,mobile:false});
   await evaluate(`document.body.style.fontSize='${15*scale}px'`);
   await sleep(250);
   for(const mode of ["spatial","inline"]) {
    const inline=mode==='inline';
    if(await evaluate(`document.querySelector('.spine-frame').dataset.phoneReadingMode`) !== mode) await click(`.phone-controls button:nth-child(${inline?2:1})`);
    if(inline) assert.equal(await evaluate(`getComputedStyle(document.querySelector('.spatial-reading-mode')).opacity`),"0","inactive A cannot show through Inline");
    for(const [child,source] of [["A","p1"],["B","a1"],["C","p2"]]) {
     await open(child);
     assert.equal(await evaluate(`document.querySelector('.phone-back').dataset.sourceId`),source,`${child}: actual source identity`);
     // Real keyboard activation verifies Back and focus return.
     await evaluate(`document.querySelector('.phone-back').focus()`);
     await page("Input.dispatchKeyEvent",{type:"keyDown",key:"Enter",code:"Enter",windowsVirtualKeyCode:13,text:"\r"});
     await page("Input.dispatchKeyEvent",{type:"keyUp",key:"Enter",code:"Enter",windowsVirtualKeyCode:13});
     await sleep(150);
     const measured=await bounds(source,inline);
     assert.equal(parseFloat(measured.font),16*scale, "equal readable text scale");
     logs.push({theme,height,scale,mode,child,source,area:measured.area,font:measured.font});
    }
    await open("p1",true);
    assert.equal(await readDraft(),draft,"older point keeps composer draft");
    await bounds("p1",inline);
    if(height===844&&scale===1) { await shot(mode); await open("A"); await shot(`${mode}-nested`); }
    if(height===560&&scale===2) await shot(`${mode}-keyboard-200`);
   }
  }
  await open("D");
  assert.equal(await evaluate(`document.querySelector('.phone-back').textContent`), "Back to Tangent · Reading plan", "topic-only parent names its actual destination");
  assert.equal(await evaluate(`document.querySelector('.phone-back').dataset.sourceId`), undefined, "topic parent never invents a point");
  await open("A");
  current = { ...world, thoughts: world.thoughts.filter(p=>p.id!=="p1") };
  core.send({type:"snapshot",world:current});
  assert.ok(await until(`document.querySelector('.phone-back')?.disabled && document.querySelector('.phone-back').textContent.includes('[p1]')`),"deleted source keeps exact reference without redirection");
  current = structuredClone(world);core.send({type:"snapshot",world:current});
  assert.ok(await until(`!document.querySelector('.phone-back')?.disabled`));
  // Read-only inspection emits no routing or write operations.
  assert.equal(core.heard.some(m=>["focus","select","position","annotate","thought"].includes(m.type)),false,"inspection never pins routing or writes positions");
  const before=await evaluate(`document.querySelector('.react-flow__viewport').style.transform`);
  await click('.phone-controls button:first-child');
  const restored=await evaluate(`document.querySelector('.react-flow__viewport').style.transform`);
  assert.equal(restored,before,"Inline restores A camera and zoom");
  await page("Page.reload");
  assert.ok(await until(`document.querySelector('.spine-frame')?.dataset.phoneReadingMode==='spatial'`,15000),"reload keeps setting, starts Spatial");
  await page("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  assert.ok(await until(`!document.querySelector('.phone-controls, .inline-phone')`),"desktop has baseline Spatial only");
  await shot("desktop");
  await page("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await toggle();
  assert.ok(await until(`!document.querySelector('.phone-controls, .inline-phone')`),"off restores baseline");
  const messages=core.heard.length;
  await sleep(300);
  assert.equal(core.heard.slice(messages).some(m=>m.type!=="heartbeat"),false,"off creates no new operation");
  assert.deepEqual(await evaluate("errors"),[],"browser errors");
  await browser.close();browser=null;
 }
 writeFileSync(join(evidence,"measurements.json"),JSON.stringify({fixture:"synthetic; one snapshot; zero model calls; latency 0",port:core.port,logs},null,2));
 console.log(`c10-phone-check: ok (${logs.length} exact returns; 2 themes, keyboard height, 200% text, default/enable/reload/off; synthetic only). Evidence: ${evidence}`);
} catch (error) {
 writeFileSync(join(evidence,"failure.txt"),String(error.stack ?? error));
 writeFileSync(join(evidence,"measurements.json"),JSON.stringify({fixture:"synthetic",logs},null,2));
 if(browser) { const shot=await browser.page("Page.captureScreenshot",{format:"png"}).catch(()=>null); if(shot) writeFileSync(join(evidence,"failure.png"),Buffer.from(shot.data,"base64")); }
 console.error(`c10-phone-check evidence: ${evidence}`);
 throw error;
} finally {await browser?.close();core.close();}
