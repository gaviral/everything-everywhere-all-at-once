// Synthetic acceptance against an owned, keyless core and a fresh headless browser.
// No shared app, providers, microphone or account. Leaves temporary evidence for review.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { openPage, ready, sleep } from "./headless.mjs";
import { uiServer } from "./ui-server.mjs";
import { decodeJournal } from "./journal-fixture.mjs";

assert.equal(ready(), "", "built UI and Chrome required; this check never claims a skipped page pass");
const root = new URL("..", import.meta.url).pathname;
const evidence = mkdtempSync(join(tmpdir(), "c10-estimates-check-"));
const data = join(evidence, "data"), launch = join(evidence, "launch");
mkdirSync(data); mkdirSync(launch);
const actions = [
  { id: "effort-a", thread_id: "T1", title: "Review synthetic outline", kind: "reminder", when: "2026-12-01", status: "new", done_ms: null },
  { id: "effort-b", thread_id: "T2", title: "Prepare synthetic checklist", kind: "event", when: "2026-12-09", status: "done", done_ms: 100 },
];
const changes = [
  ...["T1", "T2"].map((id, i) => ({ type: "thread_added", thread: { id, title: i ? "Preparation" : "Outline", parent_id: null, status: "open", last_point: "", touched_ms: 1, tags: [], picture: null, dropped_by: "" } })),
  ...actions.map(action => ({ type: "action_proposed", action })), { type: "apps_seeded" },
];
writeFileSync(join(data, "journal.jsonl"), changes.map(c => JSON.stringify(c)).join("\n") + "\n");
const reserve = createServer();
await new Promise(resolve => reserve.listen(0, "127.0.0.1", resolve));
const port = reserve.address().port;
assert.ok(![4360, 4399].includes(port));
await new Promise(resolve => reserve.close(resolve));
const base = `http://127.0.0.1:${port}`;
let child, browser, wire;
const allReceived = [];
async function start() {
  child = spawn(resolve(root, "core/target/debug/e2a2o-core"), [], { cwd: launch,
    env: { PATH: process.env.PATH, PORT: String(port), E2A2O_DATA: data, E2A2O_UI: resolve(root, "ui/dist"), E2A2O_HOSTED: "1", RUST_LOG: "info" },
    stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", chunk => writeFileSync(join(evidence, "core.log"), chunk, { flag: "a" }));
  child.stderr.on("data", chunk => writeFileSync(join(evidence, "core.log"), chunk, { flag: "a" }));
  writeFileSync(join(evidence, "lifecycle.jsonl"), JSON.stringify({ event: "spawn", pid: child.pid, port }) + "\n", { flag: "a" });
  for (let n = 0; n < 1200; n++) {
    if (child.exitCode !== null) throw new Error(`owned core exited ${child.exitCode}`);
    if (await fetch(`${base}/room`, { signal: AbortSignal.timeout(1000) }).then(r => r.ok).catch(() => false)) return;
    await sleep(50);
  }
  throw new Error(`owned core did not become ready; evidence: ${evidence}`);
}
async function stop() {
  wire?.close(); wire = null;
  if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill("SIGTERM"); await exited; }
  if (child) writeFileSync(join(evidence, "lifecycle.jsonl"), JSON.stringify({ event: "stopped", pid: child.pid, exit: child.exitCode, signal: child.signalCode }) + "\n", { flag: "a" });
  child = null;
}
async function connect(name = "you") {
  const ws = new WebSocket(`${base.replace("http", "ws")}/ws?name=${encodeURIComponent(name)}`);
  const received = [];
  ws.addEventListener("message", e => { const value = JSON.parse(e.data); received.push(value); allReceived.push(value); });
  await once(ws, "open");
  const until = async predicate => {
    for (let n = 0; n < 150; n++) { const found = received.find(predicate); if (found) return found; await sleep(40); }
    throw new Error("expected socket receipt absent");
  };
  await until(m => m.type === "snapshot");
  return { ws, received, until, send: m => ws.send(JSON.stringify(m)) };
}
const request = (action, revision, minutes, more = {}) => ({ type: "set_action_estimate", request_id: crypto.randomUUID(), action_id: action.id, source_title: action.title, source_thread_id: action.thread_id, observed_revision: revision, minutes, reason: "", ...more });
try {
  // The brick's actual pure rules, not a duplicated implementation.
  const ssr = await uiServer();
  try {
    const rules = await ssr.ssrLoadModule("/src/bricks/action-estimates/rules.ts");
    for (const invalid of ["", "0", "1441", "1.5", "-1", "NaN"]) assert.ok(rules.durationError(invalid, ""));
    assert.equal(rules.durationError("1440", "x".repeat(160)), null);
    assert.ok(rules.durationError("15", "x".repeat(161)));
    assert.equal(rules.actionState("done"), "Handled");
  } finally { await ssr.close(); }
  await start();
  const isolated = await connect(); wire = isolated.ws;
  const disabled = request(actions[0], 0, 7); isolated.send(disabled);
  assert.equal((await isolated.until(m => m.request_id === disabled.request_id)).ok, false, "operation alone cannot opt in");
  browser = await openPage("about:blank");
  const { page, evaluate, until } = browser;
  const sent = [];
  const pageErrors = [];
  browser.on("Runtime.exceptionThrown", ({ exceptionDetails }) => pageErrors.push(exceptionDetails.exception?.description ?? exceptionDetails.text));
  await page("Runtime.enable");
  let binaryFrames = 0;
  browser.on("Network.webSocketFrameSent", ({ response }) => {
    if (response.opcode === 2) binaryFrames++;
    if (response.opcode === 1) { try { sent.push(JSON.parse(response.payloadData)); } catch { /* non-JSON frame is not an app operation */ } }
  });
  await page("Network.enable");
  await page("Page.navigate", { url: base });
  assert.ok(await until(`!!document.querySelector('[data-guide="catalog"]')`));
  assert.equal(await evaluate(`!!document.querySelector('.action-estimates')`), false, "fresh profile is off");
  assert.equal(sent.some(m=>m.type === "action_estimates" || m.type === "set_action_estimate"), false, "off starts no feature messages");
  const feature = `document.querySelector('[data-row="action-estimates"] [role="switch"]')`;
  await evaluate(`document.querySelector('[data-guide="catalog"]').click()`);
  assert.ok(await until(`!!${feature}`));
  assert.equal(await evaluate(`${feature}.getAttribute('aria-checked')`), "false");
  await evaluate(`${feature}.click(); document.querySelector('.shell-rail-close').click()`);
  assert.ok(await until(`!!document.querySelector('.action-estimates')`));
  await evaluate(`document.querySelector('.action-estimates > details').open=true`);
  assert.ok(await evaluate(`document.querySelector('.action-estimates').textContent.includes('Source topic: Outline · Proposed') && document.querySelector('.action-estimates').textContent.includes('Source topic: Preparation · Handled')`), "current actions and source states are available independently of agenda");
  const row = id => `document.querySelector('[data-estimate-action="${id}"]')`;
  async function clickRow(id, text) {
    await evaluate(`[...${row(id)}.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)}).click()`);
  }
  async function enter(id, minutes, why = "") {
    await clickRow(id, "Estimate effort");
    assert.ok(await until(`document.activeElement === ${row(id)}.querySelector('input[inputmode=numeric]')`), "editor receives focus");
    await evaluate(`(() => { const field=${row(id)}.querySelector('input[inputmode=numeric]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,${JSON.stringify(minutes)}); field.dispatchEvent(new Event('input',{bubbles:true})); const reason=${row(id)}.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(reason,${JSON.stringify(why)}); reason.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await clickRow(id, "Save estimate");
    assert.ok(await until(`${row(id)}.textContent.includes('Estimate saved to this map.') && !${row(id)}.querySelector('form')`), "matching server acknowledgement closes editor");
    assert.ok(await until(`document.activeElement === ${row(id)}.querySelector('.action-estimates-controls button')`), "save returns keyboard focus after render");
  }
  await enter("effort-a", "15", "Manual first pass");
  await enter("effort-b", "40");
  await evaluate(`document.querySelectorAll('.action-estimates-controls input[type=checkbox]').forEach(input=>input.click())`);
  assert.ok(await until(`document.querySelector('.action-estimates').textContent.includes('Estimated effort for 2 selected actions: 55 minutes')`));
  assert.deepEqual(isolated.received.filter(m => m.type === "change").map(m => m.change.type), ["action_estimate_set", "action_estimate_set"], "only estimate metadata changes");
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    await page("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    await evaluate(`document.querySelector('.action-estimates-body').scrollTop=0`);
    await sleep(100);
    const png = await page("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(evidence, `${width}-${theme}.png`), Buffer.from(png.data, "base64"));
  }
  await page("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const stillDisabled = request(actions[0], 1, 7); isolated.send(stillDisabled);
  assert.equal((await isolated.until(m => m.request_id === stillDisabled.request_id)).ok, false, "another connection's opt-in cannot activate this one");
  const journalBefore = readFileSync(join(data, "journal.jsonl"), "utf8");
  const saved = decodeJournal(journalBefore).filter(c => c.type === "action_estimate_set");
  assert.deepEqual(saved.map(c => [c.estimate.action_id, c.estimate.owner, c.estimate.minutes]), [["effort-a", "you", 15], ["effort-b", "you", 40]]);
  await stop(); await start();
  await page("Page.reload");
  assert.ok(await until(`!!document.querySelector('.action-estimates')`, 12000), "Features switch survives reload");
  await evaluate(`document.querySelector('.action-estimates > details').open=true`);
  assert.ok(await until(`${row('effort-a')}.textContent.includes('15 minutes') && ${row('effort-b')}.textContent.includes('40 minutes')`), "durable estimates survive restart");
  const restarted = await connect(); wire = restarted.ws;
  const world = restarted.received.find(m => m.type === "snapshot").world;
  assert.deepEqual(world.actions, actions, "dates, statuses, title, approval state unchanged");
  assert.deepEqual(world.action_estimates.map(e => [e.action_id, e.owner, e.minutes]), [["effort-a", "you", 15], ["effort-b", "you", 40]]);
  const reconnectDisabled = request(actions[0], 1, 7); restarted.send(reconnectDisabled);
  assert.equal((await restarted.until(m => m.request_id === reconnectDisabled.request_id)).ok, false, "new connection starts without opt-in after restart");
  restarted.send({ type: "action_estimates", on: true });
  await clickRow("effort-a", "Edit");
  const update = request(actions[0], 1, 20); restarted.send(update);
  assert.equal((await restarted.until(m => m.request_id === update.request_id)).ok, true);
  const stale = request(actions[0], 1, 25); restarted.send(stale);
  assert.equal((await restarted.until(m => m.request_id === stale.request_id)).ok, false, "stale revision refused");
  assert.ok(await until(`${row('effort-a')}.textContent.includes('20 minutes')`));
  await clickRow("effort-a", "Save estimate");
  assert.ok(await until(`${row('effort-a')}.textContent.includes('Estimate not saved: source or revision changed')`), "stale refusal is visible on the card");
  assert.equal(await evaluate(`${row('effort-a')}.querySelector('input[inputmode=numeric]').value`), "15", "stale refusal keeps draft");
  await clickRow("effort-a", "Cancel");
  await clickRow("effort-a", "Edit");
  await evaluate(`(() => { const field=${row('effort-a')}.querySelector('input[inputmode=numeric]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'21'); field.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await clickRow("effort-a", "Save estimate");
  assert.ok(await until(`${row('effort-a')}.textContent.includes('Your estimate: 21 minutes') && !${row('effort-a')}.querySelector('form')`), "Edit saves a corrected estimate with a matching acknowledgement");
  await clickRow("effort-a", "Clear");
  assert.ok(await until(`${row('effort-a')}.textContent.includes('Undo clear')`));
  await clickRow("effort-a", "Undo clear");
  assert.ok(await until(`${row('effort-a')}.textContent.includes('Your estimate: 21 minutes') && !${row('effort-a')}.textContent.includes('Undo clear')`));
  const other = await connect("Synthetic speaker");
  other.send({ type: "action_estimates", on: true });
  const attributed = request(actions[0], 0, 90); other.send(attributed);
  assert.equal((await other.until(m => m.request_id === attributed.request_id)).estimate.owner, "Synthetic speaker"); other.ws.close();
  assert.ok(await until(`${row('effort-a')}.textContent.includes('Synthetic speaker: 90 minutes')`));
  // Keyboard cancel and visual evidence: desktop + 390px, both themes, 200% text, reduced motion.
  await clickRow("effort-a", "Edit");
  await page("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await page("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  assert.ok(await until(`!${row('effort-a')}.querySelector('form') && document.activeElement===${row('effort-a')}.querySelector('.action-estimates-controls button')`), "Escape returns focus");
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    await page("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" }] });
    assert.ok(await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`));
    await evaluate(`document.documentElement.style.fontSize='200%'`);
    await clickRow("effort-a", "Edit");
    await evaluate(`${row('effort-a')}.querySelector('input[inputmode=numeric]').scrollIntoView({block:'center'})`);
    await sleep(100);
    assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`), "no horizontal page overflow at 200% text");
    assert.ok(await evaluate(`(() => { const field=${row('effort-a')}.querySelector('input[inputmode=numeric]').getBoundingClientRect(); const composer=document.querySelector('textarea.composer, #composer, .shell-composer, .composer')?.getBoundingClientRect(); return field.left>=0 && field.right<=innerWidth && field.top>=0 && field.bottom<=innerHeight && (!composer || field.bottom<=composer.top); })()`), "editor reachable above composer");
    const png = await page("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(evidence, `${width}-${theme}-200-reduced.png`), Buffer.from(png.data, "base64"));
    await clickRow("effort-a", "Cancel");
  }
  // A shortened viewport models space taken by a phone keyboard without opening any device input.
  await page("Emulation.setDeviceMetricsOverride", { width: 390, height: 560, deviceScaleFactor: 1, mobile: false });
  await clickRow("effort-a", "Edit");
  await evaluate(`${row('effort-a')}.querySelector('button[type=submit]').scrollIntoView({block:'center'})`);
  assert.ok(await evaluate(`(() => { const save=${row('effort-a')}.querySelector('button[type=submit]').getBoundingClientRect(); const composer=document.querySelector('.shell-composer').getBoundingClientRect(); return save.top>=0 && save.bottom<=composer.top; })()`), "Save remains reachable in a shortened phone viewport");
  await clickRow("effort-a", "Cancel");
  await evaluate(`document.documentElement.style.fontSize=''`);
  await page("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  // A transport failure keeps a typed duration and reason. Retry is always explicit.
  await clickRow("effort-a", "Edit");
  await evaluate(`(() => { const field=${row('effort-a')}.querySelector('input[inputmode=numeric]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'37'); field.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await stop();
  assert.ok(await until(`!document.querySelector('.action-estimates button[type=submit]') || document.querySelector('.action-estimates button[type=submit]').disabled`, 12000));
  assert.equal(await evaluate(`${row('effort-a')}.querySelector('input[inputmode=numeric]').value`), "37", "disconnect preserves editable draft");
  await start();
  assert.ok(await until(`!document.querySelector('.action-estimates button[type=submit]').disabled`, 15000));
  await clickRow("effort-a", "Cancel");
  const beforeOff = readFileSync(join(data, "journal.jsonl"), "utf8");
  await evaluate(`document.querySelector('[data-guide="catalog"]').click()`);
  assert.ok(await until(`!!${feature}`));
  await evaluate(`${feature}.click(); document.querySelector('.shell-rail-close').click()`);
  assert.ok(await until(`!document.querySelector('.action-estimates')`));
  const afterOffCount = sent.filter(m => m.type === "set_action_estimate").length;
  await sleep(150);
  assert.equal(readFileSync(join(data, "journal.jsonl"), "utf8"), beforeOff, "off retains records and starts no writes");
  assert.equal(sent.filter(m => m.type === "set_action_estimate").length, afterOffCount);
  assert.ok(sent.filter(m => m.type === "set_action_estimate").length >= 5, "DevTools observed the actual UI writes");
  assert.equal(binaryFrames, 0, "no microphone/audio frames");
  writeFileSync(join(evidence, "sent.json"), JSON.stringify(sent, null, 2));
  // The baseline partner hook sends an explicit off on every connection, including fresh default-off.
  // Keep that existing shutdown control; any enabling/request operation remains forbidden.
  const baselineStops = sent.filter(m => m.type === "partner" && m.on === false);
  assert.ok(baselineStops.length > 0, "existing partner shutdown was observed");
  const forbidden = sent.filter(m => !(m.type === "partner" && m.on === false) && /approve|item|listen|text|partner|app_|compose|import|note|send|recap/.test(m.type));
  assert.deepEqual(forbidden, [], "no approval, status, mic, model or connector operations");
  const afterOff = await connect(); wire = afterOff.ws;
  const retained = afterOff.received.find(m => m.type === "snapshot").world;
  assert.deepEqual(retained.actions, actions, "off leaves existing action state unchanged");
  assert.deepEqual(retained.action_estimates.map(e => [e.action_id, e.owner, e.minutes]), [["effort-a", "you", 21], ["effort-b", "you", 40], ["effort-a", "Synthetic speaker", 90]], "off retains exact metadata");
  await page("Page.reload");
  const reloaded = await until(`!!document.querySelector('[data-guide="catalog"]')`, 15000);
  if (!reloaded) {
    writeFileSync(join(evidence, "reload-errors.json"), JSON.stringify({ pageErrors, body: await evaluate('document.body.innerText') }, null, 2));
    const png = await page("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(evidence, "reload-failure.png"), Buffer.from(png.data, "base64"));
  }
  assert.ok(reloaded, `final reload reached Features; evidence: ${evidence}`);
  assert.equal(await evaluate(`!!document.querySelector('.action-estimates')`), false, "off survives reload");
  const proof = { result: "ok", actions: actions.map(a => a.id), total: 55, checks: ["fresh default off", "Features enable", "matching durable ack", "restart and attribution", "edit", "stale refusal", "clear and one Undo", "other owner display", "keyboard focus", "desktop and 390px both themes", "200% text", "reduced motion", "disconnect draft", "off retains metadata"], limitations: ["synthetic fixtures only", "native phone keyboard and human use unverified", "no model or external service exercised"] };
  writeFileSync(join(evidence, "result.json"), JSON.stringify(proof, null, 2));
  console.log(`c10-estimates-check: ok; screenshots and receipts: ${evidence}`);
} finally {
  await browser?.close();
  await stop();
}
