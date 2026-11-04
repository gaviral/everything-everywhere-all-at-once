// Mounted built app, synthetic map and a stand-in socket. No model, mic or external writes.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";
const why = ready(); if (why) { console.log(`SKIP plugins-check: ${why}`); process.exit(3); }
const temp = mkdtempSync(join(tmpdir(), "plugins-check-"));
const prepared = join(temp, "counter");
execFileSync(process.execPath, ["scripts/package-plugin.mjs", "scripts/fixtures/plugins/counter", "--out", prepared], { stdio: "pipe" });
const assets = Object.fromEntries(readdirSync(prepared).map(name => [name, readFileSync(join(prepared, name), "utf8")]));
const at = Date.now();
const world = { threads: [{ id: "T1", title: "Synthetic topic", parent_id: null, status: "open", last_point: "", touched_ms: at, tags: [], picture: null, dropped_by: "" }], active: "T1", active_by: { you: "T1" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], ai: [], thoughts: [{ id: "one", speaker: "you", text: "Synthetic thought", point: "Synthetic thought", thread_id: "T1", placed: true, unclear: "", complete: true, at_ms: at, place_ms: 1 }] };
const core = await standInCore(() => [{ type: "snapshot", world }]);
let browser;
try {
 browser = await openPage("about:blank");
 const { page, evaluate, until } = browser;
 await page("Page.enable");
 await page("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("e2a2o.toured", "1"); window.pluginErrors=[]; addEventListener("error", e=>pluginErrors.push(e.message));` });
 const check = async (expr, label) => assert.ok(await until(expr, 8000), label);
 const click = async selector => { await check(`!!document.querySelector(${JSON.stringify(selector)})`, selector); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); };
 const navigate = async suffix => { await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/${suffix}` }); await check(`!!document.querySelector('[aria-label="Type a thought"]')`, "composer"); };
 await navigate("");
 await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'c',bubbles:true}))`);
 await check(`!!document.querySelector('[data-row="plugins"]')`, "Plugins feature exists off");
 assert.equal(await evaluate(`document.querySelector('[data-row="plugins"] [role="switch"]').getAttribute('aria-checked')`), "false");
 await click('[data-row="plugins"] [role="switch"]');
 await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'p',bubbles:true}))`);
 await check(`!!document.querySelector('[data-plugin-row="spine"] button')`, "Canvas switch");
 const manifestIds = readdirSync("ui/src/bricks", { withFileTypes: true }).filter(d=>d.isDirectory()&&!d.name.startsWith('_')).map(d=>d.name);
 const ids = await evaluate(`[...document.querySelectorAll('[data-plugin-row]')].map(e=>e.dataset.pluginRow)`);
 for (const id of manifestIds) assert.ok(ids.includes(id), id);
 const toggle = async id => click(`[data-plugin-row="${id}"] button`);
 const input = async (selector, text) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(text)}); e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await input('[aria-label="Type a thought"]', 'Unsent synthetic thought');
 for (const id of manifestIds) {
   const rowOn = () => `document.querySelector('[data-plugin-row="${id}"] button').textContent.startsWith('Unload')`;
   if (!(await evaluate(rowOn()))) await toggle(id);
   await sleep(120);
   await toggle(id); await sleep(60); await toggle(id);
 }
 assert.equal(await evaluate(`document.querySelector('[aria-label="Type a thought"]').value`), 'Unsent synthetic thought');
 // The actual directory input change handler receives the selected files, without a navigation or rebuild.
 const add = async (files=assets, folder="counter") => evaluate(`(()=>{const input=document.querySelector('[aria-label="Add plugin folder"]'); const transfer=new DataTransfer(); for(const [name,text] of Object.entries(${JSON.stringify(files)})){const f=new File([text],name);Object.defineProperty(f,'webkitRelativePath',{value:${JSON.stringify(folder)}+'/'+name});transfer.items.add(f);}input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await add(); await check(`!!document.querySelector('[data-plugin-row="counter"]')`, 'import row');
 assert.equal(await evaluate(`!!document.querySelector('.counter')`), false, 'import starts unloaded');
 await toggle('counter'); await check(`!!document.querySelector('.counter')`, 'mounted imported React with host runtime');
 await input('[aria-label="Plugin draft"]','Retained draft'); await click('.counter button');
 for(let n=0;n<20;n++){await toggle('counter');await check(`!document.querySelector('.counter')`, 'unmounted');await toggle('counter');await check(`!!document.querySelector('.counter')`, 'remounted');}
 assert.equal(await evaluate(`document.querySelector('[aria-label="Plugin draft"]').value`), 'Retained draft');
 assert.equal(await evaluate(`document.querySelector('.counter button').textContent`), 'Count 1');
 core.send({ type: 'notice', message: 'One callback after twenty reloads' });
 await check(`document.querySelector('.counter button')?.textContent === 'Count 2'`, 'one callback per event');
 await add(); await check(`document.querySelector('.plugins [role="alert"]')?.textContent.includes('Duplicate')`, 'duplicate rejected');
 const invalid={...assets,'plugin.json':'{"apiVersion":9,"entry":"index.js"}'};
 invalid['brick.json']=assets['brick.json'].replaceAll('counter','invalid');
 await add(invalid,'invalid'); await check(`document.querySelector('.plugins [role="alert"]')?.textContent.includes('API 1')`, 'API rejected');
 await navigate('');
 await check(`!!document.querySelector('.counter')`, 'IndexedDB restored and loaded after reopening page');
 assert.equal(await evaluate(`document.querySelector('[aria-label="Plugin draft"]').value`), 'Retained draft');
 await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'p',bubbles:true}))`);
 await check(`!!document.querySelector('.plugins')`, 'plugins open');
 await page('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
 await page('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'},{name:'prefers-reduced-motion',value:'reduce'}]});
 await sleep(150);
 const shot=await page('Page.captureScreenshot',{format:'png'});writeFileSync(join(temp,'plugins-390.png'),Buffer.from(shot.data,'base64'));
 assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth`),'390px no overflow');
 await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'c',bubbles:true}))`);
 await click('[data-row="plugins"] [role="switch"]');
 await check(`!document.querySelector('.counter')`, 'gate off unloads imported instance');
 await navigate('?shell=1');
 await check(`!!document.querySelector('.apps-title')`, 'classic Apps');
 // Read and toggle in one browser turn; a late first snapshot can open Apps between separate tool calls.
 await evaluate(`(()=>{const button=document.querySelector('.apps-title');if(button.getAttribute('aria-expanded')==='false')button.click();})()`);
 await click('[data-guide="catalog"]');
 await check(`!!document.querySelector('[data-row="plugins"]')`, 'classic Features exposes gate');
 // Denied package/state storage falls back to the current visit and remains usable.
 await click('[data-row="plugins"] [role="switch"]');
 await page("Page.addScriptToEvaluateOnNewDocument", { source: `indexedDB.open = () => { throw new Error('Storage denied'); }; const get=Storage.prototype.getItem; Storage.prototype.getItem=function(key){if(key.startsWith('e2a2o.plugin-state:'))throw new Error('Storage denied');return get.call(this,key)}; Storage.prototype.setItem=function(){throw new Error('Storage denied')};` });
 await navigate('');
 await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'p',bubbles:true}))`);
 await check(`!!document.querySelector('.plugins')`, 'denied-storage Plugins');
 await add(); await check(`!!document.querySelector('[data-plugin-row="counter"]')`, 'visit-only import');
 await check(`document.querySelector('.plugins').textContent.includes('For this visit only')`, 'honest fallback label');
 await toggle('counter'); await check(`!!document.querySelector('.counter')`, 'fallback mounts');
 await input('[aria-label="Plugin draft"]','Memory draft');
 await toggle('counter'); await toggle('counter');
 await check(`document.querySelector('[aria-label="Plugin draft"]')?.value === 'Memory draft'`, 'memory draft survives unmount');
 const bad = {...assets, 'brick.json':assets['brick.json'].replaceAll('counter','broken'), 'index.js':"throw new Error('Synthetic entry failure'); function Broken(){return null} export { Broken as default };"};
 await add(bad,'broken'); await check(`!!document.querySelector('[data-plugin-row="broken"]')`, 'throwing package isolated');
 await toggle('broken'); await check(`document.querySelector('[data-plugin-row="broken"]').textContent.includes('Failed')`, 'load failure shown');
 assert.ok(await evaluate(`!!document.querySelector('[aria-label="Type a thought"]')`),'composer survives failure');
 await add({...assets,'../escape.js':'export default null'},'counter');
 await check(`document.querySelector('.plugins [role="alert"]')?.textContent.includes('relative')`, 'traversal rejected');
 console.log(`plugins-check: ok (${manifestIds.length} bricks, prepared folder, host React, 20 unmounts, draft/counter persistence, duplicate/API rejection, off gate, denied storage, throwing entry, bad path, classic, 390px dark/reduced motion); screenshot ${temp}/plugins-390.png`);
} finally { await browser?.close(); await core.close(); }
