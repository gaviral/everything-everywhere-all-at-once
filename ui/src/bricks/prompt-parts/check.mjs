// One focused check. Temporary build and isolated browser; no server, mic or live model.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { build } from "../../../node_modules/vite/dist/node/index.js";
import { iconBrowser } from "../../../../scripts/icon-set/browser.mjs";

const folder = dirname(fileURLToPath(import.meta.url));
const ui = resolve(folder, "../../..");
const artifacts = mkdtempSync(join(tmpdir(), "prompt-parts-check-"));
const manifest = JSON.parse(readFileSync(join(folder, "brick.json"), "utf8"));
const parts = JSON.parse(readFileSync(join(folder, "parts.json"), "utf8"));
assert.equal(manifest.defaultOn, false);
assert.equal(parts.length, 12);
assert.equal(new Set(parts.map(part => part.id)).size, 12);
assert.ok(parts.every(part => [part.name, part.job, part.prompt, part.takes, part.gives].every(Boolean)));
writeFileSync(join(artifacts, "tsconfig.json"), JSON.stringify({ extends: join(ui, "tsconfig.json"), include: [], files: [join(folder, "index.tsx"), join(ui, "src/vite-env.d.ts")] }));
const types = spawnSync(join(ui, "node_modules/.bin/tsc"), ["--project", join(artifacts, "tsconfig.json"), "--pretty", "false"], { encoding: "utf8" });
assert.equal(types.status, 0, `REAL: focused typecheck\n${types.stdout}${types.stderr}`);
const entry = join(artifacts, "entry.tsx");
writeFileSync(entry, `import React from ${JSON.stringify(join(ui, "node_modules/react/index.js"))};
import {createRoot} from ${JSON.stringify(join(ui, "node_modules/react-dom/client.js"))};
import PromptParts,{styles} from ${JSON.stringify(join(folder, "index.tsx"))};
import {PluginStateContext} from ${JSON.stringify(join(ui, "src/bricks/contract.ts"))};
const sheet=document.createElement('style');sheet.textContent=styles;document.head.append(sheet);
const store=new Map();const state={get:key=>store.get(key),set:(key,value)=>store.set(key,value)};
const map={thoughts:[{id:'one',thread_id:'topic',placed:true,text:'A synthetic selected thought about safe cache expiry.'}],active:'topic'};
const root=createRoot(document.getElementById('root'));
window.mount=()=>root.render(<PluginStateContext.Provider value={state}><PromptParts map={map}/></PluginStateContext.Provider>);
window.unmount=()=>root.render(null);window.mount();`);
// REAL harness correction: a standalone library bundle otherwise leaves React's
// process.env.NODE_ENV unresolved in Chrome. The application build already defines it.
const built = await build({ configFile: false, root: ui, define: { "process.env.NODE_ENV": '"production"' }, resolve: { alias: { react: join(ui, "node_modules/react"), "react-dom": join(ui, "node_modules/react-dom") } }, logLevel: "error", build: { write: false, minify: false, lib: { entry, formats: ["iife"], name: "PromptPartsCheck" } } });
const bundle = (Array.isArray(built) ? built[0] : built).output.find(row => row.type === "chunk").code;
const browser = await iconBrowser();
const errors = [];
const { page, evaluate } = browser;
async function until(expression) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise(done => setTimeout(done, 25));
  }
  throw new Error(`TIMING: condition did not arrive: ${expression}`);
}
const click = text => evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!button||button.disabled)throw Error('Missing/enabled button: '+${JSON.stringify(text)});button.click()})()`);
const fill = text => evaluate(`(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
try {
  browser.on("Runtime.exceptionThrown", event => errors.push(event.exceptionDetails.text));
  await page("Runtime.enable");
  await page("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  browser.on("Fetch.requestPaused", event => {
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="margin:0;background:#211f1c"><div id="root"></div></body></html>`;
    void page("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: "text/html" }], body: Buffer.from(html).toString("base64") });
  });
  await page("Page.addScriptToEvaluateOnNewDocument", { source: `window.calls=[];window.mode='json';window.captureCalls=0;
    navigator.mediaDevices.getUserMedia=()=>{window.captureCalls++;throw Error('No capture allowed');};
    window.fetch=async(url,options)=>{
      const body=JSON.parse(options.body);window.calls.push({path:new URL(url).pathname,body,room:new URL(url).searchParams.get('room')});
      if(window.mode==='pending')return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));
      if(window.mode==='error')return new Response('{}',{status:503});
      if(window.mode==='fallback'&&new URL(url).pathname!=='/flow/run')return new Response('{}',{status:404});
      if(window.mode==='fallback'){
        const text=JSON.stringify({delta:'A streamed answer from Spark.'})+'\\n'+JSON.stringify({done:true})+'\\n';const bytes=new TextEncoder().encode(text);
        return new Response(new ReadableStream({start(c){c.enqueue(bytes.slice(0,7));c.enqueue(bytes.slice(7));c.close();}}),{headers:{'content-type':'application/x-ndjson'}});
      }
      return new Response(JSON.stringify({output:body.part==='explain-diff'?'The cache now checks expiry.':'Summary: cache expiry is enforced. Validation: not provided.'}),{headers:{'content-type':'application/json'}});
    };` });
  await page("Emulation.setDeviceMetricsOverride", { width: 1512, height: 1300, deviceScaleFactor: 1, mobile: false });
  await page("Page.navigate", { url: "https://prompt-parts.test/?room=synthetic" });
  await until("!!document.getElementById('root')");
  await evaluate(bundle);
  await until("document.querySelectorAll('.prompt-parts-card').length===12");
  assert.equal(await evaluate("window.calls.length"), 0, "example never calls a model");
  assert.equal(await evaluate("document.querySelectorAll('.prompt-parts-answer').length"), 2);
  assert.ok(await evaluate("document.body.innerText.includes('Illustrative answers')"));
  writeFileSync(join(artifacts, "desktop.png"), Buffer.from((await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })).data, "base64"));
  await click("Run two parts↗");
  await until("document.querySelector('.prompt-parts-status').textContent.startsWith('Composition complete')");
  const calls = await evaluate("window.calls");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.input, "The cache now checks expiry.", "second part receives exactly the first answer");
  assert.equal(calls[1].body.part, "pr-description");
  assert.ok(calls.every(call => call.room === "synthetic"));
  await click("Use selected topic");
  await until("document.querySelector('textarea').value.includes('synthetic selected thought')");
  await evaluate("window.mode='error';window.calls=[]");
  await click("Run two parts↗");
  await until("document.querySelector('.prompt-parts-status').textContent.includes('unavailable')");
  assert.equal(await evaluate("window.calls.length"), 1, "a failed first part stops the chain");
  assert.ok(await evaluate("document.querySelector('textarea').value.includes('synthetic selected thought')"));
  await evaluate("window.mode='pending'");
  await click("Run two parts↗"); await until("document.body.innerText.includes('Running with Spark')"); await click("Stop");
  await until("document.querySelector('.prompt-parts-status').textContent.startsWith('Stopped.')");
  await evaluate("window.mode='fallback';window.calls=[]");
  await click("Run two parts↗");
  await until("document.querySelector('.prompt-parts-status').textContent.startsWith('Composition complete')");
  assert.equal(await evaluate("window.calls.length"), 4, "dedicated route fallback per part");
  assert.equal(await evaluate("window.calls[3].body.input"), "A streamed answer from Spark.");
  await fill("x".repeat(12001));
  assert.ok(await evaluate("document.querySelector('.prompt-parts-run').disabled"), "oversized input cannot run");
  await click("Load example ↗");
  await until("document.querySelector('textarea').value.startsWith('diff --git')");
  for (const width of [390, 320]) {
    await page("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: true });
    assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth"), `${width}px has no horizontal overflow`);
  }
  writeFileSync(join(artifacts, "phone.png"), Buffer.from((await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })).data, "base64"));
  assert.equal(await evaluate("window.captureCalls"), 0);
  assert.deepEqual(errors, []);
  console.log(`PASS: focused types, 12-part catalog, labelled example, two-part data flow, selected thought, failure/stop, streamed fallback, bounded input, 390/320px layout; no capture. Artifacts: ${artifacts}`);
} finally { await browser.close(); }
