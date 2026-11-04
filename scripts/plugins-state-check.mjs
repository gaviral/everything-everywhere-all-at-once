// Held-lane regressions: built UI, isolated storage and synthetic delayed uploads only.
import assert from "node:assert/strict";
import { ready, standInCore, openPage } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP plugins-state-check: ${why}`); process.exit(3); }
const at = Date.now();
const world = { threads: [{ id: "T1", title: "Synthetic topic", parent_id: null, status: "open", last_point: "Synthetic thought", touched_ms: at, tags: [], picture: null, dropped_by: "" }],
  thoughts: [{ id: "p1", thread_id: "T1", speaker: "you", text: "Synthetic thought", point: "Synthetic thought", placed: true, complete: true, unclear: "", guess: "", heard: "", fixed: "", at_ms: at, place_ms: 1 }],
  active: "T1", active_by: { you: "T1" }, apps: [], apps_seeded: true, suggestions: [], actions: [], merged: {}, recaps: [], notes: {}, proposals: [], ai: [] };
const core = await standInCore(() => [{ type: "snapshot", world }]);
let browser;
const timeout = setTimeout(() => { console.error("plugins-state-check: timed out"); process.exit(1); }, 90_000);
try {
  for (const denied of [false, true]) {
    browser = await openPage("about:blank", { width: 1440, height: 900 });
    const { page, evaluate, until } = browser;
    const check = async (expression, label) => {
      if (!await until(expression, 8000)) assert.fail(`${denied ? "memory" : "durable"}: ${label}: ${JSON.stringify(await evaluate(`({errors:window.errors,spine:document.querySelector('.spine-frame')?.className,bricks:[...document.querySelectorAll('[data-brick]')].map(e=>e.dataset.brick),text:document.body.innerText.slice(0,1200)})`))}`);
    };
    const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const catalog = async () => { await click('[data-guide="catalog"]'); await check(`!!document.querySelector('[data-row="plugins"]')`, "Features"); };
    const plugins = async () => { await evaluate(`document.activeElement?.blur(); document.dispatchEvent(new KeyboardEvent('keydown',{key:'p',bubbles:true}))`); await check(`!!document.querySelector('[data-plugin-row="import"]')`, "Plugins"); };
    const toggle = id => click(`[data-plugin-row="${id}"] button`);
    await page("Page.enable");
    const init = `
      localStorage.setItem('e2a2o.toured','1');
      localStorage.setItem('e2a2o.features',JSON.stringify({plugins:true,import:true}));
      localStorage.setItem('e2a2o.bricks',JSON.stringify({countdown:true}));
      localStorage.setItem('e2a2o.countdown',JSON.stringify([{label:'Original deadline',at:'2027-01-01T12:00:00Z'}]));
      window.uploads=0; window.errors=[]; window.mediaAttempts=0;
      if(navigator.mediaDevices) navigator.mediaDevices.getUserMedia=()=>{window.mediaAttempts++;return Promise.reject(Error('Synthetic check: microphone unavailable'))};
      addEventListener('error',e=>{if(!e.message.startsWith('ResizeObserver'))errors.push(e.message)});
      const realFetch=window.fetch.bind(window);
      window.fetch=(url,options)=>String(url).startsWith('/import?') ? (window.uploads++,new Promise(resolve=>window.finishUpload=(failure=false)=>resolve(new Response(JSON.stringify(failure?{error:'Synthetic upload refusal'}:{id:'preview-1',file:'synthetic.json',format:'JSON',conversations:1,total:1,already:0,messages:1,words:4,from_ms:${at},to_ms:${at},parts:1,extract_model:'muse-spark',merge_model:'muse-spark',cost:0}),{status:failure?400:200,headers:{'content-type':'application/json'}})))) : realFetch(url,options);
      ${denied ? `indexedDB.open=()=>{throw Error('Synthetic storage denied')}; const get=Storage.prototype.getItem,set=Storage.prototype.setItem;
        Storage.prototype.getItem=function(k){if(k.startsWith('e2a2o.plugin-state:'))throw Error('Synthetic storage denied');return get.call(this,k)};
        Storage.prototype.setItem=function(k,v){if(k.startsWith('e2a2o.plugin-state:'))throw Error('Synthetic storage denied');return set.call(this,k,v)};` : ""}
    `;
    new Function(init); // Validate the synthetic page setup before navigation.
    await page("Page.addScriptToEvaluateOnNewDocument", { source: init });
    await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/` });
    await check(`!!document.querySelector('.spine-ready') && !!document.querySelector('.countdown')`, "mounted");
    await catalog();
    await click('[data-row="plugins"] [role="switch"]');
    await check(`document.querySelector('[data-row="plugins"] [role="switch"]').getAttribute('aria-checked')==='false'`, "gate off");
    await evaluate(`document.querySelector('.countdown-card').click()`);
    await check(`!!document.querySelector('.countdown input[type="text"]')`, "deadline editor");
    await evaluate(`(()=>{const e=document.querySelector('.countdown input[type="text"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Newest edit while gate off'); e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click('[data-row="plugins"] [role="switch"]');
    await check(`document.querySelector('.countdown input[type="text"]')?.value==='Newest edit while gate off'`, "gate on keeps live deadline edit");
    await plugins();
    await toggle("countdown"); await check(`!document.querySelector('.countdown')`, "deadline unmounted");
    await toggle("countdown"); await check(`document.querySelector('.countdown input[type="text"]')?.value==='Newest edit while gate off'`, "fresh mount keeps newest edit");
    // A request accepted before unload belongs to the host; its result reaches the new form.
    for (const failure of [false, true]) {
      await click('[data-guide="import"]');
      await check(`!!document.querySelector('.import-dialog[open]')`, "Import dialog");
      if (failure) await evaluate(`[...document.querySelectorAll('.import-dialog button')].find(e=>e.textContent==='Choose another file').click()`);
      await evaluate(`(()=>{const input=document.querySelector('.import-dialog input[type=file]'),data=new DataTransfer();data.items.add(new File(['[]'],'synthetic.json',{type:'application/json'}));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await check(`document.querySelector('.import-dialog [role=status]')?.textContent.includes('Reading')`, "upload pending");
      await click('.import-close');
      await toggle("import"); await check(`!document.querySelector('[data-guide="import"]')`, "Import unmounted");
      await toggle("import"); await click('[data-guide="import"]');
      await check(`document.querySelector('.import-dialog [role=status]')?.textContent.includes('Reading')`, "remounted pending form");
      await evaluate(`window.finishUpload(${failure})`);
      await check(failure ? `document.querySelector('.import-dialog [role=alert]')?.textContent==='Synthetic upload refusal'` : `document.querySelector('.import-file')?.textContent==='synthetic.json'`, failure ? "host refusal reaches mounted form" : "host preview reaches mounted form");
      await click('.import-close');
    }
    assert.equal(await evaluate("window.uploads"), 2, "no replayed upload");
    assert.equal(core.heard.filter(message => message.type === "import_start").length, 0, "preview never starts an import");
    assert.deepEqual(await evaluate("window.errors"), []);
    assert.equal(await evaluate("window.mediaAttempts"), 0);
    console.log(`PASS ${denied ? "memory" : "durable"}: gate edit retained; pending Import preview/refusal reaches remounted form; no duplicate upload`);
    await browser.close(); browser = null;
  }
} finally { clearTimeout(timeout); await browser?.close(); await core.close(); }
