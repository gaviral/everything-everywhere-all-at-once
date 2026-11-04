// Built app, fake core and browser speech: feature gating, visible state and cancellation without a model key.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";
if (ready()) { console.log(`SKIP partner-check: ${ready()}`); process.exit(3); }
const world = { threads: [], thoughts: [], active: null, active_by: {}, anchors: {}, notes: {}, suggestions: [], actions: [], merged: {}, apps: [], recaps: [], proposals: [], ai: [] };
const core = await standInCore(() => [{ type: "snapshot", world }], { port: 48262 });
let browser;
try {
  browser = await openPage("about:blank");
  const { page, evaluate, until } = browser;
  await page("Page.enable");
  await page("Page.addScriptToEvaluateOnNewDocument", { source: `
    localStorage.setItem('e2a2o.toured','1'); window.spoken=[]; window.cancelled=0; window.errors=[];
    addEventListener('error',e=>{if(!e.message.startsWith('ResizeObserver')) errors.push(e.message)});
    Object.defineProperty(window,'speechSynthesis',{configurable:true,value:Object.assign(new EventTarget(),{
      getVoices:()=>[{name:'Test English',lang:'en-US',default:true,localService:true}],
      speak:u=>{spoken.push(u);queueMicrotask(()=>u.onstart?.());},cancel:()=>cancelled++
    })});
    window.SpeechSynthesisUtterance=class {constructor(text){this.text=text}};
  ` });
  await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/` });
  if (!await until(`!!document.querySelector('#type-a-thought')`, 10000)) throw Error(JSON.stringify(await evaluate(`({url:location.href,body:document.body.innerText.slice(0,500),errors:window.errors})`)));
  assert.equal(await evaluate(`!!document.querySelector('.partner-status')`), false, "partner stays absent by default");
  assert.ok(!core.heard.some((m) => m.type === "partner" && m.on), "no automatic opt-in");
  // Use the actual Features switch, not a preset that changes the film path.
  await evaluate(`document.querySelector('[data-guide="catalog"]')?.click()`);
  assert.ok(await until(`!!document.querySelector('[role="switch"][aria-label="Conversation partner"]')`), "Features exposes the opt-in");
  assert.equal(await evaluate(`document.querySelector('[aria-label="Conversation partner"][role="switch"]').getAttribute('aria-checked')`), "false");
  await evaluate(`document.querySelector('[aria-label="Conversation partner"][role="switch"]').click()`);
  assert.ok(await until(`!!document.querySelector('.partner-status')`));
  await sleep(80);
  assert.ok(core.heard.some((m) => m.type === "partner" && m.on), "opt-in reaches the core");
  // Return to the canvas; the rail's close/back behavior belongs to the existing shell.
  await evaluate(`document.querySelector('[data-guide="catalog"]')?.click()`);
  core.send({ type: "partner_state", state: "thinking", message: "Thinking…" });
  assert.ok(await until(`document.querySelector('.partner-status')?.textContent.includes('Thinking')`));
  const shot = async (name) => {
    const result = await page("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(tmpdir(), `e2a2o-partner-${name}.png`), Buffer.from(result.data, "base64"));
  };
  await shot("desktop");
  await evaluate(`document.querySelector('.partner-status button').focus()`);
  assert.equal(await evaluate(`document.activeElement.textContent`), "Stop reply");
  await page("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await page("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await sleep(60);
  assert.ok(core.heard.some((m) => m.type === "partner_cancel"), `keyboard Cancel reaches core: ${JSON.stringify(core.heard)}`);
  core.send({ type: "partner_state", state: "cancelled", message: "Reply cancelled." });
  assert.ok(await until(`![...document.querySelectorAll('.partner-status button')].some(b => b.textContent === 'Stop reply')`));
  core.send({ type: "guide", kind: "caption", target: null, text: "Try one small step.", by: "E2A2O", at_ms: Date.now(), speak: true });
  core.send({ type: "partner_state", state: "idle", message: "Ready for your next question." });
  assert.ok(await until(`spoken.length===1 && document.querySelector('.partner-status').textContent.includes('Reply playing')`));
  await evaluate(`document.querySelector('.partner-status button').click()`);
  assert.ok(await until(`!document.querySelector('.partner-status').textContent.includes('Reply playing')`), "Cancel stops browser speech immediately");
  assert.ok(await evaluate(`cancelled>0`));
  core.send({ type: "partner_state", state: "error", message: "Couldn't answer just now. Try asking again." });
  assert.ok(await until(`document.querySelector('.partner-status').textContent.includes("Couldn't answer")`));
  assert.equal(await evaluate(`spoken.length`), 1, "errors never speak");
  core.send({ type: "partner_state", state: "thinking", message: "Thinking…" });
  await page("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await sleep(120);
  assert.ok(await evaluate(`(()=>{const b=document.querySelector('.partner-status button').getBoundingClientRect();return b.x>=0&&b.right<=innerWidth&&b.y>=0&&b.bottom<=innerHeight&&b.height>=44})()`), "Cancel reachable at phone width");
  await shot("phone");
  await evaluate(`document.documentElement.style.fontSize='200%'`);
  await sleep(80);
  assert.ok(await evaluate(`(()=>{const b=document.querySelector('.partner-status button').getBoundingClientRect();return b.x>=0&&b.right<=innerWidth&&b.y>=0&&b.bottom<=innerHeight})()`), "Cancel reachable with enlarged text");
  await shot("large-text");
  await evaluate(`document.documentElement.style.fontSize='100%'`);
  await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await sleep(80);
  await shot("dark");
  await evaluate(`document.querySelector('[data-guide="catalog"]').click()`);
  assert.ok(await until(`!!document.querySelector('[role="switch"][aria-label="Conversation partner"]')`));
  await evaluate(`document.querySelector('[role="switch"][aria-label="Conversation partner"]').click()`);
  assert.ok(await until(`!document.querySelector('.partner-status')`), "disable removes the partner control");
  const beforeLate = await evaluate(`spoken.length`);
  core.send({ type: "guide", kind: "caption", target: null, text: "A stale partner reply.", by: "E2A2O", at_ms: Date.now(), speak: true });
  core.send({ type: "partner_state", state: "thinking", message: "Thinking…" });
  await sleep(80);
  assert.equal(await evaluate(`spoken.length`), beforeLate, "disabled window ignores a late partner caption");
  assert.ok(!await evaluate(`document.body.textContent.includes('A stale partner reply.')`));
  assert.ok(core.heard.some((m) => m.type === "partner" && !m.on));
  await evaluate(`document.querySelector('[role="switch"][aria-label="Conversation partner"]').click();document.querySelector('[data-guide="catalog"]').click()`);
  core.send({ type: "partner_state", state: "thinking", message: "Thinking…" });
  assert.ok(await until(`document.querySelector('.partner-status')?.textContent.includes('Thinking')`));
  core.drop();
  assert.ok(await until(`!document.querySelector('.partner-status').textContent.includes('Thinking')`), "disconnect clears stale thinking");
  assert.deepEqual(await evaluate(`errors`), []);
  console.log(`partner UI passed: default off, Features opt-in, thinking, keyboard Cancel, speech Cancel, error, disconnect, phone, enlarged text, dark mode and disable (:${core.port})`);
} finally { await browser?.close(); core.close(); }
