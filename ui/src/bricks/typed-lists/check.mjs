// Only this feature: real browser interactions against synthetic source words.
// Retain this check's Vite cache, screenshots and Chrome profile; delete nothing.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../../../node_modules/vite/dist/node/index.js";
import { openPage } from "../../../../scripts/headless.mjs";
import { boardGroups, initialSchema, recordProblem, schemaProblem } from "./model.ts";

const folder = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(folder, "brick.json"), "utf8"));
assert.equal(manifest.defaultOn, false);
assert.equal(recordProblem("A card", initialSchema.fields, { due: "2026-02-30" }), "Due: enter a real calendar date.");
assert.equal(recordProblem("A card", initialSchema.fields, { due: "2028-02-29", stage: "Next" }), "");
assert.match(recordProblem("A card", initialSchema.fields, { stage: "Unknown" }), /choose one/);
assert.match(schemaProblem({ ...initialSchema, fields: initialSchema.fields.slice(1) }, initialSchema), /Keep existing fields/);
assert.match(schemaProblem({ ...initialSchema, fields: initialSchema.fields.map(f => f.id === "stage" ? { ...f, options: ["Next", "Done"] } : f) }, initialSchema), /Keep existing field types and options/);
assert.equal(boardGroups([{ values: {} }], initialSchema.fields[0]).at(-1).records.length, 1);

const artifacts = join(folder, ".check-artifacts");
mkdirSync(artifacts, { recursive: true });
const run = mkdtempSync(join(artifacts, "run-"));
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
import React, {useState} from "react";
import {createRoot} from "react-dom/client";
import Board, {styles} from "/src/bricks/typed-lists/index.tsx";
const style=document.createElement("style");style.textContent=styles;document.head.append(style);
const original="We need to rehearse the handoff on the big screen before Friday.";
const thought={id:"source-one",speaker:"Example teammate",text:original,point:"Rehearse the handoff",thread_id:"launch",placed:true,at_ms:10};
const base={visitKey:"first-map",me:"Check participant",thoughts:[thought]};
window.original=original;window.navigation=[];window.micAttempts=0;
if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=()=>{micAttempts++;throw Error("Mic forbidden")};
function Fixture(){const[map,setMap]=useState(base);const[shown,setShown]=useState(true);
window.changeSource=()=>setMap(old=>({...old,thoughts:[{...thought,text:"A revised original thought."}]}));
window.removeSource=()=>setMap(old=>({...old,thoughts:[]}));
window.switchVisit=()=>setMap({...base,visitKey:"second-map"});
window.switchPerson=()=>setMap({...base,me:"Another participant"});
return shown?React.createElement(Board,{map,actions:{closeView:()=>setShown(false),openThought:id=>{navigation.push(id);setShown(false);return true}}}):React.createElement("button",{id:"return",onClick:()=>setShown(true)},"Return to board")}
createRoot(document.querySelector("#root")).render(React.createElement(Fixture));
</script></body></html>`;
const server = await createServer({ root: resolve(folder, "../../.."), cacheDir: join(run, "vite-cache"),
  server: { host: "127.0.0.1", port: 0, hmr: false, ws: false, watch: null },
  plugins: [{ name: "thought-board-fixture", configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
    if (req.url !== "/thought-board-check") return next();
    res.setHeader("Content-Type", "text/html"); res.end(await vite.transformIndexHtml(req.url, fixture));
  }); } }],
});
let browser;
try {
  await server.listen();
  const port = server.httpServer.address().port;
  assert.ok(![4360, 4399].includes(port));
  browser = await openPage(`http://127.0.0.1:${port}/bricks.html?brick=typed-lists&sample=empty`, { width: 1920, height: 1080, preserveProfile: true });
  const { evaluate, until, page } = browser;
  const wait = async (expression, message) => {
    const passed = await until(expression, 15000);
    if (!passed) console.error("Visible failure state:", await evaluate("document.body.innerText"));
    assert.ok(passed, message);
  };
  const click = async text => {
    const result = await evaluate(`(() => { const button=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(text)}); if(!button||button.disabled)return false;button.focus();button.click();return true })()`);
    assert.ok(result, `Click ${text}`);
  };
  const set = async (selector, value) => {
    await evaluate(`(() => {const field=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(field instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(field,${JSON.stringify(value)});field.dispatchEvent(new Event(field instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`);
  };
  const setLabeled = async (label, value) => {
    await evaluate(`(() => {const wrapper=[...document.querySelectorAll('label')].find(label=>label.firstChild.textContent.trim()===${JSON.stringify(label)});const field=wrapper.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,${JSON.stringify(value)});field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  };
  await wait("document.querySelectorAll('.tl-card').length===3", "Auto-discovery opens three labelled examples on an empty map");
  assert.equal(await evaluate("document.querySelector('.tl-mode').textContent"), "Example board");
  await click("↗ Source words");
  await wait("!!document.querySelector('dialog[open]')", "Source words open");
  assert.match(await evaluate("document.querySelector('.tl-source').textContent"), /Illustrative words/);
  await click("Close ×");
  for (const [width, height, scheme] of [[1920, 1080, "light"], [1440, 1000, "dark"], [390, 844, "light"], [390, 844, "dark"]]) {
    await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "reduce" }] });
    await wait("document.documentElement.scrollWidth<=innerWidth+1", `${width}px fits without horizontal overflow`);
    const png = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    writeFileSync(join(run, `${width}-${scheme}.png`), Buffer.from(png.data, "base64"));
  }
  await page("Page.navigate", { url: `http://127.0.0.1:${port}/thought-board-check` });
  await wait("document.querySelectorAll('.tl-card').length===3", "Feature fixture ready");
  await page("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await click("Use my thoughts");
  await set('[aria-label="Source thought"]', "source-one");
  await click("Add linked card");
  await wait("!!document.querySelector('.tl-editor')", "Card editor opens");
  await setLabeled("Card title", "Prepare the handoff");
  await set('.tl-editor select', "Next");
  await set('.tl-editor input[type="date"]', "2026-11-06");
  await click("Keep card");
  await wait("document.querySelectorAll('.tl-card').length===1", "One live linked card, separate from examples");
  await set('.tl-card select', "In motion");
  await wait("document.querySelector('[data-tone=\"1\"] .tl-card')!==null", "Move updates the visible board column");
  await click("List");
  await wait("!!document.querySelector('.tl-list')", "List shows the same card");
  await click("↗ Source words");
  await wait("document.querySelector('.tl-source blockquote')?.textContent===window.original", "Fields and board moves preserve source words exactly");
  await click("Open original on map");
  await wait("!!document.querySelector('#return')", "Source jump leaves the board");
  assert.deepEqual(await evaluate("navigation"), ["source-one"]);
  await click("Return to board");
  await wait("document.querySelector('.tl-list .tl-card h3')?.textContent==='Prepare the handoff'", "Jump and return retains the card and list selection without the Plugins switch");
  assert.match(await evaluate("document.querySelector('.tl-card').textContent"), /In motion/);
  await click("↗ Source words");
  await wait("!!document.querySelector('dialog[open]') && document.querySelector('dialog').contains(document.activeElement)", "Dialog has opened and taken keyboard focus before Escape");
  await page("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await page("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await wait("!document.querySelector('dialog') && document.activeElement?.textContent==='↗ Source words'", "Escape closes detail and restores source-link focus");
  await evaluate("changeSource()");
  await click("↗ Source words");
  await wait("document.querySelector('.tl-source').textContent.includes('Source changed')", "Changed source is explicit");
  assert.equal(await evaluate("document.querySelector('.tl-source blockquote').textContent===original"), true);
  await click("Close ×");
  await evaluate("removeSource()");
  await click("↗ Source words");
  await wait("document.querySelector('.tl-source').textContent.includes('Source unavailable')", "Missing source keeps its captured words");
  assert.equal(await evaluate("document.querySelector('.tl-source button').disabled"), true);
  await click("Close ×");
  await click("Shape list");
  await setLabeled("List name", "Release checklist");
  await click("Keep list shape");
  await wait("document.querySelector('.thought-board h1').textContent==='Release checklist'", "List name updates visibly");
  assert.equal(await evaluate("document.querySelectorAll('.tl-card').length"), 1);
  await evaluate("switchVisit()");
  await wait("document.querySelector('.tl-mode').textContent==='Example board'", "A different map starts a separate visit");
  assert.equal(await evaluate("document.querySelector('.thought-board h1').textContent"), "Launch plan");
  await evaluate("switchPerson()");
  await wait("document.querySelectorAll('.tl-card').length===3", "A different participant gets no previous cards");
  assert.equal(await evaluate("micAttempts"), 0);
  console.log("PASS thought-board: discovery, examples, typed fields, move, list, exact source words, jump/return, Escape focus, changed/missing sources, schema rename, visit isolation, TV/phone light/dark; no microphone.");
  console.log(`Visual evidence retained at ${run}`);
} finally {
  await browser?.close();
  await server.close();
}
