// One focused browser check. All map/model traffic is synthetic; no microphone is requested.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "../../../node_modules/vite/dist/node/index.js";
import { openPage } from "../../../../scripts/headless.mjs";

const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import Buddy, { styles } from ${JSON.stringify(fileURLToPath(new URL("./index.tsx", import.meta.url)))};
const style = document.createElement('style'); style.textContent = styles; document.head.append(style);
const thought = { id:'rollback', thread_id:'release', point:'Rollback owner is undecided.', text:'Rollback owner is undecided.', placed:true };
let map = { thoughts:[thought], threads:[{id:'release',title:'Release plan'}], me:'Tester', visitKey:'one', connected:true, partial:'Never send this live dictation' };
window.calls = [];
const actions = { annotate:(...args) => {window.calls.push(args); return true;}, openThought:() => true };
const root = createRoot(document.getElementById('root'));
function draw() {root.render(<Buddy map={map} actions={actions} />);}
window.changeThought = () => {map={...map,thoughts:[{...thought,point:'Rollback now has an owner.'}]};draw();};
window.switchVisit = () => {map={...map,visitKey:'two'};draw();};
draw();`;

const output = await build({ configFile: false, root: fileURLToPath(new URL("../../../", import.meta.url)), logLevel: "warn",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [{ name: "buddy-check", resolveId: id => id === "buddy-check" || id.endsWith("/buddy-check") ? "\0buddy-check.tsx" : null,
    load: id => id === "\0buddy-check.tsx" ? fixture : null }],
  build: { write: false, minify: false, lib: { entry: "buddy-check", name: "BuddyCheck", formats: ["iife"] } } });
const bundle = (Array.isArray(output) ? output : [output]).flatMap(result => result.output)
  .find(item => item.type === "chunk").code;
let requests = 0;
const server = createServer(async (req, res) => {
  if (req.url === "/bundle.js") { res.setHeader("Content-Type", "text/javascript; charset=utf-8"); res.end(bundle); return; }
  if (req.url?.startsWith("/flow/run")) {
    requests++;
    let body = ""; for await (const chunk of req) body += chunk;
    const sent = JSON.parse(body);
    assert.ok(!body.includes("Never send this live dictation"));
    assert.equal(JSON.parse(sent.input)[0].id, "rollback");
    const output = JSON.stringify({ id: "rollback", line: "Who will own this rollback?", answers: ["I'll own the rollback", "Let's choose together"] });
    res.setHeader("Content-Type", "application/x-ndjson");
    res.end(JSON.stringify({ delta: output }) + "\n" + JSON.stringify({ done: true, question: null })); return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#1e1d1b;color:#eee;font-family:Arial}#source{position:absolute;left:150px;top:160px;width:210px;padding:20px;border:1px solid #777;border-radius:18px}</style><div id="source" data-guide="point:rollback">Rollback owner is undecided.</div><div id="root"></div><script>window.checkErrors=[];addEventListener('error',event=>window.checkErrors.push(event.message));</script><script src="/bundle.js"></script></html>`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await openPage(`http://127.0.0.1:${server.address().port}`, { width: 1280, height: 900, preserveProfile: true });
  const { evaluate, until, page } = browser;
  assert.ok(await until(`document.body.textContent.includes('Example · not your map')`, 5000), "labelled example appears");
  assert.equal(requests, 0, "opening never starts a model");
  const click = label => evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`);
  await click("I'll own the rollback");
  assert.ok(await until(`document.body.textContent.includes('Example reply only')`, 1000));
  assert.equal(await evaluate("window.calls.length"), 0, "example never writes to map");
  const oldPosition = await evaluate("document.querySelector('.canvas-buddy-demo-bead').style.left");
  await click("Follow the bead ↗");
  assert.ok(await until(`document.body.textContent.includes('What would make this ready to launch?')`, 1000));
  assert.notEqual(await evaluate("document.querySelector('.canvas-buddy-demo-bead').style.left"), oldPosition, "bead moves to next subject");
  await evaluate(`(()=>{const input=document.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'A team review first');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  assert.ok(await until(`!document.querySelector('[aria-label="Send reply"]').disabled`, 1000));
  await evaluate(`document.querySelector('form').requestSubmit()`);
  assert.ok(await until(`document.body.textContent.includes('A team review first') && document.body.textContent.includes('Example reply only')`, 1000));
  await click("Read my map");
  assert.ok(await until(`document.body.textContent.includes('Who will own this rollback?')`, 2000), "one grounded live note");
  assert.equal(requests, 1);
  assert.ok(await until(`document.querySelector('.canvas-buddy-live-bead').dataset.visible==='true'`, 1000));
  await click("I'll own the rollback");
  assert.ok(await until("window.calls.length===1", 1000));
  assert.deepEqual(await evaluate("window.calls[0]"), ["rollback", "Rollback owner is undecided.", "I'll own the rollback"]);
  assert.ok(await until(`document.body.textContent.includes('Waiting for the map to receive it')`, 1000), "queued is not claimed saved");
  await click("Notice another thing ↗");
  assert.ok(await until(`!!document.querySelector('[aria-label="Send reply"]')`, 2000));
  await evaluate("window.changeThought()");
  assert.ok(await until(`document.body.textContent.includes('This thought changed')`, 1000));
  assert.equal(await evaluate(`document.querySelector('.canvas-buddy-choices button').disabled`), true, "stale reply cannot be sent");
  await evaluate("window.switchVisit()");
  assert.ok(await until(`document.body.textContent.includes('Example · not your map')`, 1000), "visit resets private state");
  await page("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.ok(await until(`document.querySelector('.canvas-buddy-home').getBoundingClientRect().right<=innerWidth`, 1000), "phone fits");
  await page("Emulation.setEmulatedMedia", { features: [{name:"prefers-reduced-motion",value:"reduce"}] });
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.canvas-buddy-demo-bead')).transitionDuration`), "0s");
  await evaluate(`document.querySelector('[aria-label="Tuck canvas buddy away"]').click()`);
  assert.ok(await until(`!!document.querySelector('.canvas-buddy-wake')`, 1000));
  assert.deepEqual(await evaluate("window.checkErrors"), []);
  console.log("PASS canvas-buddy: example, bead targets, tap/type replies, grounded request, exact annotation, stale guard, visit reset, phone and reduced motion. Synthetic model only.");
} catch (error) {
  console.error("REAL canvas-buddy check failure:", error);
  if (browser) console.error(await browser.evaluate(`({ errors:window.checkErrors, text:document.body.innerText })`));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
