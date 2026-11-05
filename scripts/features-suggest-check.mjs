// Synthetic browser fixture + real keyless core. Only owned processes, disposable data and an OS-assigned port.
// The browser injects proposal text; production has no fake-model path. Real Meta/device behavior is not asserted.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPage, ready, sleep } from "./headless.mjs";

assert.equal(ready(), "", `Browser check requires built UI and Chrome: ${ready()}`);
const root = new URL("../", import.meta.url).pathname;
const data = mkdtempSync(join(tmpdir(), "c10-suggest-check-"));
const reserve = createServer();
await new Promise(resolve => reserve.listen(0, "127.0.0.1", resolve));
const port = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
assert.ok(![4360, 4399].includes(port));
const url = `http://127.0.0.1:${port}`;
const now = Date.now();
const original = "Review the synthetic outline before the planning session";
const shorter = "Review the outline";
const thought = (id, point, at_ms) => ({ id, speaker: "you", text: `Original synthetic words for ${id}. Keep these words.`, point,
  placed: true, thread_id: "T1", at_ms, place_ms: 0, unclear: "", complete: true });
const seed = [
  { type: "thread_added", thread: { id: "T1", title: "Synthetic outline", parent_id: null, status: "open", last_point: "Check the synthetic drawing", touched_ms: now, tags: [] } },
  { type: "thought_added", thought: thought("older", original, now - 2000) },
  { type: "thought_added", thought: thought("newer", "Check the synthetic drawing", now - 1000) },
];
writeFileSync(join(data, "journal.jsonl"), seed.map(JSON.stringify).join("\n") + "\n");
let core, browser;
let logs = "";
const sockets = [];
const journal = () => readFileSync(join(data, "journal.jsonl"), "utf8");
// Storage keeps committed changes inside versioned batches; old flat rows remain readable.
const edits = () => journal().trim().split("\n").map(JSON.parse)
  .flatMap(row => row.type === "journal_batch" && row.version === 1 ? row.changes : [row])
  .filter(change => change.type === "point_edited");
const stop = async () => {
  if (core && core.exitCode === null) { const exit = once(core, "exit"); core.kill("SIGTERM"); await exit; }
};
async function start() {
  // A temporary cwd avoids loading project .env files. No inherited key, adapters or personal data settings.
  core = spawn(join(root, "core/target/debug/e2a2o-core"), [], { cwd: data, stdio: ["ignore", "ignore", "pipe"], env: {
    PATH: process.env.PATH, PORT: String(port), E2A2O_DATA: data, MODEL_API_KEY: "", E2A2O_UI: join(root, "ui/dist"),
    E2A2O_HOSTED: "0", ROOM_CODE: "", PUBLIC_URL: "", E2A2O_TRACE: "0", RUST_LOG: "warn",
  } });
  core.stderr.on("data", chunk => { logs += chunk; });
  for (let i = 0; i < 150; i++) {
    assert.equal(core.exitCode, null, "isolated core must stay running");
    if (await fetch(`${url}/room`).then(r => r.ok).catch(() => false)) return;
    await sleep(100);
  }
  throw new Error("isolated core did not start");
}
async function client() {
  const ws = new WebSocket(`${url.replace("http", "ws")}/ws`);
  const messages = [];
  ws.addEventListener("message", e => messages.push(JSON.parse(e.data)));
  sockets.push(ws);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const wait = async predicate => {
    for (let i = 0; i < 150; i++) { const found = messages.find(predicate); if (found) return found; await sleep(30); }
    throw new Error("missing expected core response");
  };
  await wait(m => m.type === "snapshot");
  return { ws, messages, wait, send: m => ws.send(JSON.stringify(m)) };
}
try {
  await start();
  const a = await client(), b = await client();
  const edit = { type: "edit_point", request_id: "raw-off", thought_id: "older", observed: original, replacement: shorter };
  a.send(edit);
  assert.equal((await a.wait(m => m.request_id === "raw-off")).ok, false, "operation alone cannot opt in");
  assert.equal(edits().length, 0);
  a.send({ type: "shorter_point", request_id: "generate-off", thought_id: "older", observed: original });
  assert.equal((await a.wait(m => m.request_id === "generate-off")).failed, true, "off cannot generate");
  a.send({ type: "review_text_edits", on: true });
  b.send({ ...edit, request_id: "other-window-off" });
  assert.equal((await b.wait(m => m.request_id === "other-window-off")).ok, false, "opt-in is per connection");
  a.send({ type: "shorter_point", request_id: "keyless", thought_id: "older", observed: original });
  assert.equal((await a.wait(m => m.request_id === "keyless")).failed, true, "missing-model handling keeps a typed route");
  await sleep(100);
  assert.equal(b.messages.some(m => m.request_id === "keyless"), false, "proposal is sender scoped");
  a.ws.close(); b.ws.close();
  const fresh = await client();
  fresh.send({ ...edit, request_id: "reconnected-off" });
  assert.equal((await fresh.wait(m => m.request_id === "reconnected-off")).ok, false, "disconnect clears opt-in");
  fresh.ws.close();

  browser = await openPage("about:blank");
  const { page, evaluate } = browser;
  const until = (expression, ms = 15000) => browser.until(`!!(${expression})`, ms);
  await page("Page.enable");
  await page("Page.addScriptToEvaluateOnNewDocument", { source: `
    localStorage.setItem('e2a2o.toured','1'); window.wire=[]; window.sent=[]; window.errors=[];
    window.fakeShorter=${JSON.stringify(shorter)}; window.fakeDelay=40; window.c10socket=null;
    const NativeWebSocket=window.WebSocket;
    window.WebSocket=class extends NativeWebSocket {
      constructor(...args){ super(...args); window.c10socket=this; this.addEventListener('message', e=>wire.push(JSON.parse(e.data))); }
      send(data){
        if(typeof data==='string'){
          const m=JSON.parse(data); sent.push(m);
          if(m.type==='shorter_point'){
            setTimeout(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'point_proposal',request_id:m.request_id,thought_id:m.thought_id,text:fakeShorter,failed:false})})),fakeDelay);
            return;
          }
        }
        return super.send(data);
      }
    };
    addEventListener('error',e=>{if(!e.message.startsWith('ResizeObserver')) errors.push(e.message)});
  ` });
  await page("Page.navigate", { url });
  const point = '[data-heads~="older"]';
  const action = `${point} [aria-label="Suggest a shorter point"]`;
  const dialog = '.text-edit-review[open]';
  const proposal = `${dialog} textarea`;
  const clickLabel = async label => evaluate(`([...document.querySelectorAll('${dialog} button')].find(b=>b.textContent===${JSON.stringify(label)}))?.click()`);
  const typeProposal = async text => evaluate(`(()=>{const t=document.querySelector('${proposal}');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(text)});t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const openReview = async () => {
    assert.ok(await until(`document.querySelector(${JSON.stringify(action)})`), "older point has an action");
    await evaluate(`document.querySelector('${point} .spine-text').focus();document.querySelector('${point} .spine-text').click();document.querySelector(${JSON.stringify(action)}).focus();document.querySelector(${JSON.stringify(action)}).click()`);
    assert.ok(await until(`document.querySelector('${proposal}')`));
  };
  const key = async key => {
    await page("Input.dispatchKeyEvent", { type: "keyDown", key, code: key === "Escape" ? "Escape" : key.toUpperCase() });
    await page("Input.dispatchKeyEvent", { type: "keyUp", key, code: key === "Escape" ? "Escape" : key.toUpperCase() });
  };
  const features = async () => {
    await evaluate("document.activeElement?.blur()");
    await key("c");
    assert.ok(await until(`document.querySelector('[data-row="review-text-edits"] [role="switch"]')`), "Features has the setting");
  };
  assert.ok(await until(`document.querySelector('${point}')`), "two synthetic points placed");
  assert.equal(await evaluate(`!!document.querySelector(${JSON.stringify(action)})`), false, "fresh profile is default off");
  assert.equal(await evaluate("sent.some(m=>m.type==='shorter_point'||m.type==='edit_point')"), false);
  await features();
  assert.equal(await evaluate(`document.querySelector('[data-row="review-text-edits"] [role="switch"]').getAttribute('aria-checked')`), "false");
  await evaluate(`document.querySelector('[data-row="review-text-edits"] [role="switch"]').click();
    const told=sent.filter(m=>m.type==='review_text_edits'&&m.on).length;
    const other=document.querySelector('[data-row="export"] [role="switch"]');other.click();other.click();
    if(sent.filter(m=>m.type==='review_text_edits'&&m.on).length!==told)throw Error('unrelated switches repeated review opt-in');
    document.querySelector('.shell-rail-close').click()`);
  await openReview();
  await clickLabel("Make shorter");
  assert.ok(await until(`document.querySelector('${proposal}').value===${JSON.stringify(shorter)}`));
  assert.equal(edits().length, 0, "model proposal does not mutate the journal");
  assert.ok(await evaluate(`document.querySelector('${dialog}').textContent.includes('Before')&&document.querySelector('${dialog}').textContent.includes('After')&&!!document.querySelector('${dialog} del')`));
  await clickLabel("Accept");
  assert.ok(await until(`document.querySelector('${dialog} [role="status"]').textContent==='Point saved.'`), "only a matching write acknowledgement succeeds");
  assert.equal(edits().length, 1);
  assert.deepEqual([edits()[0].thought_id, edits()[0].old_point, edits()[0].new_point, edits()[0].actor], ["older", original, shorter, "you"]);
  await page("Page.reload");
  assert.ok(await until(`wire.some(m=>m.type==='snapshot'&&m.world.thoughts.find(t=>t.id==='older')?.point===${JSON.stringify(shorter)})`));
  const reloaded = await evaluate("wire.find(m=>m.type==='snapshot').world");
  assert.deepEqual(reloaded.thoughts.find(t => t.id === "older"), { ...seed[1].thought, point: shorter, guess: "", heard: "", fixed: "", decided: false });
  assert.equal(reloaded.threads[0].touched_ms, now, "no conversational recency refresh");
  await openReview();
  await clickLabel("Undo point edit");
  assert.ok(await until(`document.querySelector('${dialog} [role="status"]').textContent==='Point restored.'`));
  assert.equal(edits().length, 2);
  assert.equal(edits()[1].undo_of, edits()[0].request_id);
  await clickLabel("Close");

  // Reject and keyboard Close are inert and return focus to the selected action.
  await openReview(); await typeProposal("A rejected synthetic proposal");
  const beforeReject = journal();
  await clickLabel("Reject");
  assert.equal(journal(), beforeReject);
  assert.ok(await until(`document.activeElement===document.querySelector(${JSON.stringify(action)})`));
  await openReview(); await key("Escape");
  assert.ok(await until(`!document.querySelector('${dialog}')`));
  assert.ok(await until(`document.activeElement===document.querySelector(${JSON.stringify(action)})`));

  // Another opted-in connection changes the source while the first review stays open.
  await openReview(); await typeProposal("My retained proposal");
  const writer = await client();
  writer.send({ type: "review_text_edits", on: true });
  writer.send({ ...edit, request_id: "concurrent", replacement: "A newer synthetic point" });
  assert.equal((await writer.wait(m => m.request_id === "concurrent")).ok, true);
  await clickLabel("Accept");
  assert.ok(await until(`document.querySelector('${dialog} [role="status"]').textContent.includes('changed or left')`));
  assert.equal(await evaluate(`document.querySelector('${proposal}').value`), "My retained proposal");
  assert.equal(edits().length, 3);
  assert.ok(await evaluate(`!!document.querySelector('${dialog} [role="alert"]')`));
  writer.ws.close();

  // Lost transport keeps an editable draft; a late generation cannot replace intervening typing.
  await evaluate("window.fakeDelay=1200");
  await clickLabel("Reject");
  await openReview(); await clickLabel("Make shorter"); await typeProposal("Manual proposal during generation");
  assert.ok(await until(`document.querySelector('${dialog} [role="status"]').textContent.includes('typed proposal is kept')`));
  assert.equal(await evaluate(`document.querySelector('${proposal}').value`), "Manual proposal during generation");
  await evaluate("c10socket.close()");
  assert.ok(await until(`document.querySelector('${dialog} [role="status"]').textContent.includes('Connection lost')`));
  assert.equal(await evaluate(`document.querySelector('${proposal}').value`), "Manual proposal during generation");
  assert.ok(await until("c10socket.readyState===WebSocket.OPEN"));
  assert.equal(edits().length, 3);

  // Inspect desktop + phone, both themes, 200% text and reduced motion. Controls scroll into view above composer.
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    await page("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" }] });
    await evaluate("document.documentElement.style.fontSize='200%'");
    await sleep(100);
    await evaluate(`document.querySelector('${dialog} footer').scrollIntoView({block:'end'})`);
    const geometry = await evaluate(`(()=>{const d=document.querySelector('${dialog}'),r=d.getBoundingClientRect(),f=d.querySelector('footer').getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,footerTop:f.top,footerBottom:f.bottom,scroll:d.scrollWidth,width:d.clientWidth};})()`);
    assert.ok(geometry.left >= 0 && geometry.right <= width + 1 && geometry.footerTop >= 0 && geometry.footerBottom <= 900 && geometry.scroll <= geometry.width + 1, JSON.stringify(geometry));
    const capture = await page("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(data, `${width}-${theme}-200-reduced.png`), Buffer.from(capture.data, "base64"));
  }
  await page("Emulation.setDeviceMetricsOverride", { width: 390, height: 500, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.querySelector('${proposal}').focus();document.querySelector('${dialog} footer').scrollIntoView({block:'end'})`);
  assert.ok(await evaluate(`document.querySelector('${dialog} footer').getBoundingClientRect().bottom<=500`), "controls reachable in a shortened viewport");
  await evaluate("document.documentElement.style.fontSize=''");
  await page("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await clickLabel("Reject");
  await openReview();
  await evaluate("window.fakeDelay=1200");
  await clickLabel("Make shorter");
  await clickLabel("Reject");
  await features();
  await evaluate(`document.querySelector('[data-row="review-text-edits"] [role="switch"]').click();document.querySelector('.shell-rail-close').click()`);
  await sleep(1400);
  assert.ok(await until(`!document.querySelector(${JSON.stringify(action)})`));
  assert.equal(await evaluate(`!!document.querySelector('${dialog}')`), false, "late generation cannot reopen a disabled review");
  assert.equal(edits().length, 3);
  assert.ok(await evaluate("sent.some(m=>m.type==='review_text_edits'&&m.on===false)"));
  assert.equal(await evaluate(`document.querySelector('${point} .spine-text').textContent.includes('A newer synthetic point')`), true, "off preserves point rendering");

  // Restart the real core: accepted records replay; a new connection remains opted out.
  await page("Page.navigate", { url: "about:blank" });
  await stop(); await start();
  const restarted = await client();
  const state = restarted.messages.find(m => m.type === "snapshot").world;
  assert.equal(state.thoughts.find(t => t.id === "older").point, "A newer synthetic point");
  assert.equal(state.thoughts.find(t => t.id === "older").text, seed[1].thought.text);
  restarted.send({ ...edit, request_id: "after-restart", observed: "A newer synthetic point" });
  assert.equal((await restarted.wait(m => m.request_id === "after-restart")).ok, false);
  restarted.ws.close();
  // A joined presentation must choose one real source before exposing proposal controls.
  await stop();
  writeFileSync(join(data, "journal.jsonl"), journal() + JSON.stringify({ type: "thought_noted", thought_id: "newer", note: { continues: "older" } }) + "\n");
  await start();
  await page("Page.navigate", { url });
  assert.ok(await until(`document.querySelector('${point}')`));
  assert.equal(await evaluate(`!!document.querySelector(${JSON.stringify(action)})`), false, "off persists after restart");
  await features();
  await evaluate(`document.querySelector('[data-row="review-text-edits"] [role="switch"]').click();document.querySelector('.shell-rail-close').click()`);
  assert.ok(await until(`document.querySelector(${JSON.stringify(action)})`));
  await evaluate(`document.querySelector('${point} .spine-text, ${point} .spine-aside-face')?.focus();document.querySelector(${JSON.stringify(action)}).focus();document.querySelector(${JSON.stringify(action)}).click()`);
  assert.ok(await until(`document.querySelector('${dialog}')?.textContent.includes('Select one source thought first')`));
  assert.equal(await evaluate(`!!document.querySelector('${proposal}')`), false);
  const beforeSourceSelection = journal();
  await evaluate(`document.querySelector('${dialog} .review-source').click()`);
  assert.ok(await until(`document.querySelector('${proposal}')`));
  assert.ok(await evaluate(`document.querySelector('${dialog}').textContent.includes(${JSON.stringify(seed[1].thought.text)})`));
  assert.equal(journal(), beforeSourceSelection);
  await key("Escape");
  assert.deepEqual(await evaluate("errors"), []);
  console.log(`c10-suggest-check: ok; synthetic fixture + keyless core; evidence ${data}`);
} catch (error) {
  console.error(`c10-suggest-check evidence: ${data}`);
  if (browser) {
    const capture = await browser.page("Page.captureScreenshot", {format:"png"}).catch(() => null);
    if (capture) writeFileSync(join(data,"failure.png"),Buffer.from(capture.data,"base64"));
    const state = await browser.evaluate("({text:document.body.innerText,errors:window.errors,wire:window.wire,html:document.body.innerHTML.slice(0,20000)})").catch(() => null);
    writeFileSync(join(data,"failure.json"),JSON.stringify(state,null,2));
  }
  throw error;
} finally {
  for (const ws of sockets) ws.close();
  if (browser) await browser.close();
  await stop();
  writeFileSync(join(data, "core.log"), logs);
}
