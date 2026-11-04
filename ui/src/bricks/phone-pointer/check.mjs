// Focused browser + actual bridge admission check against an entirely synthetic Mac.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ready, openPage } from "../../../../scripts/headless.mjs";

assert.equal(ready(), "", "Chrome and built UI are required");
const shots = mkdtempSync(join(tmpdir(), "phone-pointer-shots-"));
const fixture = spawn("python3", [new URL("./fixture.py", import.meta.url).pathname], {
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, stdio: ["pipe", "pipe", "pipe"],
});
let page;
try {
  const details = await new Promise((resolve, reject) => {
    let out = "", err = "";
    fixture.stderr.on("data", data => { err += data; });
    fixture.once("exit", code => reject(Error(`Fixture exited ${code}: ${err}`)));
    fixture.stdout.on("data", data => { out += data; if (out.includes("\n")) resolve(JSON.parse(out.split("\n")[0])); });
  });
  const { origin, pair } = details;
  const headers = { Authorization: `Bearer ${pair}`, "Content-Type": "application/json" };
  const stats = async () => (await fetch(`${origin}/fixture`)).json();
  const set = values => fetch(`${origin}/fixture`, { method: "POST", body: JSON.stringify(values) });
  assert.equal((await fetch(`${origin}/pointer/status`)).status, 403, "unpaired requests refused");
  assert.equal((await fetch(`${origin}/pointer/status`, { headers: { ...headers, Origin: "https://elsewhere.example" } })).status, 403, "other origins refused");
  assert.equal((await fetch(`${origin}/pointer/input`, { method: "POST", headers, body: JSON.stringify({ kind: "click", button: "left", x: 200 }) })).status, 400, "absolute-coordinate clicks refused");
  assert.equal((await fetch(`${origin}/pointer/frame`, { method: "POST", headers, body: "{}" })).status, 400, "frame needs explicit start");
  assert.equal((await fetch(`${origin}/native.swift`)).status, 404, "source files never served");
  assert.deepEqual(await stats(), { events: [], frames: 0 });

  page = await openPage("about:blank", { width: 390, height: 844, preserveProfile: true });
  await page.page("Page.enable");
  await page.page("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.pointerErrors=[];
    window.pointerEvents=[];
    for(const name of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture']) addEventListener(name,e=>{if(e.target.closest?.('.phone-pointer-pad'))pointerEvents.push({name,x:e.clientX,y:e.clientY,primary:e.isPrimary})},true);
    addEventListener('error',e=>pointerErrors.push(e.message));
    addEventListener('unhandledrejection',e=>pointerErrors.push(String(e.reason)));
  ` });
  const navigate = async suffix => {
    await page.page("Page.navigate", { url: `${origin}/bricks.html?brick=phone-pointer&sample=empty${suffix}` });
  };
  const click = selector => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const until = async (expression, label) => {
    const passed = await page.until(expression, 7000);
    if (!passed) {
      console.log("Check diagnostic", label, await page.evaluate(`({feature:document.querySelector('.phone-pointer')?.textContent, focused:document.hasFocus(), visibility:document.visibilityState, errors:window.pointerErrors, events:window.pointerEvents, pad:document.querySelector('.phone-pointer-pad')?.getBoundingClientRect().toJSON()})`), await stats());
      const { data } = await page.page("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(shots, "failure.png"), Buffer.from(data, "base64"));
      console.log("Diagnostic screenshot", join(shots, "failure.png"));
    }
    assert.ok(passed, label);
  };
  const waitEvent = async (count, label) => until(`fetch('/fixture').then(r=>r.json()).then(v=>v.events.length===${count})`, label);
  await navigate("");
  await until(`!!document.querySelector('.phone-pointer-launch')`, "off-by-default feature offers a launcher in its isolated playground");
  await click(".phone-pointer-launch");
  assert.ok(await page.evaluate(`document.querySelector('.phone-pointer-setup').textContent.includes('No connection yet')`));
  assert.deepEqual(await stats(), { events: [], frames: 0 }, "setup starts nothing");
  // A new phone visit is a document load; changing only a fragment would keep the setup mounted.
  await navigate(`&controller=1#pair=${pair}`);
  await until(`document.querySelector('.phone-pointer-status')?.textContent.includes('input ready')`, "paired controller ready");
  assert.equal(await page.evaluate("location.hash"), "", "pairing key removed from address");
  assert.equal(await page.evaluate(`document.querySelector('.phone-pointer-preview button').disabled`), true, "preview permission independent from input");
  assert.deepEqual(await stats(), { events: [], frames: 0 }, "pairing starts neither input nor preview");

  const pad = await page.evaluate(`(() => { const r=document.querySelector('.phone-pointer-pad').getBoundingClientRect(); return {x:r.x+50,y:r.y+80}; })()`);
  await page.page("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const touch = (type, x, y) => page.page("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  await touch("touchStart", pad.x, pad.y);
  await touch("touchMove", pad.x + 40, pad.y + 20);
  await touch("touchEnd", pad.x + 40, pad.y + 20);
  await waitEvent(1, "one drag produces relative motion");
  assert.deepEqual((await stats()).events[0], { kind: "move", dx: 64, dy: 32 });
  for (let n = 0; n < 2; n++) {
    await touch("touchStart", pad.x + n * 100, pad.y + 100);
    await touch("touchEnd", pad.x + n * 100, pad.y + 100);
  }
  await waitEvent(3, "taps click the current Mac pointer at different phone positions");
  assert.deepEqual((await stats()).events.slice(1), [{ kind: "click", button: "left" }, { kind: "click", button: "left" }]);
  await click(".phone-pointer-clicks button:last-child");
  await waitEvent(4, "right click delivered");
  await click('.phone-pointer-keyrow button:first-child');
  await click('[aria-label="ArrowRight"]');
  await waitEvent(5, "command + arrow delivered");
  assert.deepEqual((await stats()).events[4], { kind: "key", key: "ArrowRight", modifiers: ["command"] });
  await until(`document.querySelector('.phone-pointer-keyrow button').getAttribute('aria-pressed')==='false'`, "modifier cleared after key");
  const draft = text => page.evaluate(`(() => { const input=document.querySelector('.phone-pointer-keyboard form input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)}); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await draft("Example hello 🌿");
  await click('.phone-pointer-keyboard form button');
  await waitEvent(6, "Unicode text sent");
  assert.equal((await stats()).events[5].text, "Example hello 🌿");
  await set({ fail_input: true });
  await draft("Keep this unsent");
  await click('.phone-pointer-keyboard form button');
  await until(`document.querySelector('.phone-pointer-problem')?.textContent.includes('refused')`, "input refusal visible");
  assert.equal(await page.evaluate(`document.querySelector('.phone-pointer-keyboard form input').value`), "Keep this unsent", "failed input retains draft");
  await click('.phone-pointer-heading button');
  await until(`!document.querySelector('.phone-pointer-keyboard').disabled`, "connection manually checked");

  await set({ input_ready: false, preview_ready: true });
  await click('.phone-pointer-heading button');
  await until(`document.querySelector('.phone-pointer-keyboard').disabled && !document.querySelector('.phone-pointer-preview button').disabled`, "preview works with input permission off");
  await click('.phone-pointer-preview button');
  await until(`fetch('/fixture').then(r=>r.json()).then(v=>v.frames>0)`, "explicit start captures first synthetic frame");
  await until(`document.querySelector('.phone-pointer-preview img')?.complete`, "preview rendered");
  await page.evaluate(`dispatchEvent(new Event('blur'))`);
  await until(`document.querySelector('.phone-pointer-preview button')?.textContent==='Start preview' && !document.querySelector('.phone-pointer-preview img')`, "leaving pauses preview and clears frame");
  await page.evaluate(`dispatchEvent(new Event('focus'))`);
  await until(`!document.querySelector('.phone-pointer-preview button').disabled`, "return ready without capture restart");
  const paused = (await stats()).frames;
  // Absence of future work has no positive event to await: observe one polling interval plus margin.
  await page.evaluate(`new Promise(resolve=>setTimeout(resolve,1100))`);
  assert.equal((await stats()).frames, paused, "return never resumes capture automatically");
  await set({ input_ready: true });
  await click('.phone-pointer-heading button');
  await until(`!document.querySelector('.phone-pointer-keyboard').disabled`, "input ready with preview paused");
  await click('.phone-pointer-clicks button:first-child');
  await waitEvent(7, "input remains usable without preview");
  for (const width of [390, 320, 1440]) {
    await page.page("Emulation.setDeviceMetricsOverride", { width, height: width === 1440 ? 1000 : 844, deviceScaleFactor: 1, mobile: false });
    assert.ok(await page.evaluate(`(() => {const e=document.querySelector('.phone-pointer');return e.scrollWidth<=e.clientWidth})()`), `no overflow at ${width}px`);
    const { data } = await page.page("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(shots, `${width}.png`), Buffer.from(data, "base64"));
  }
  await click('.phone-pointer-close');
  await until(`!document.querySelector('.phone-pointer-preview')`, "closing unmounts controller and preview");
  assert.deepEqual(await page.evaluate("pointerErrors"), [], "no browser errors");
  console.log(`phone-pointer: PASS (synthetic Mac; admission, trackpad, taps, keyboard, refusal, independent preview, leave/return, 320/390/1440px). Screenshots: ${shots}`);
} finally {
  if (page) await page.close();
  const exited = once(fixture, "exit");
  fixture.stdin.end();
  await exited;
}
