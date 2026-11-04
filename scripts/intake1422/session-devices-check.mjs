// Explicit opt-in, synthetic inputs only. No real room, device permissions or audio.
import assert from "node:assert/strict";
import { createServer as httpServer } from "node:http";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { createServer, build } from "../../ui/node_modules/vite/dist/node/index.js";
import react from "../../ui/node_modules/@vitejs/plugin-react/dist/index.js";

if (!process.argv.includes("--enable-session-devices")) {
  console.log("OFF: opt in with node scripts/intake1422/session-devices-check.mjs --enable-session-devices");
  process.exit(0);
}
const ui = fileURLToPath(new URL("../../ui/", import.meta.url));
const namespace = "/src/intake1422/session-devices/";
const artifacts = mkdtempSync(join(tmpdir(), "session-devices-proof-"));

async function checkParts() {
  const server = await createServer({ root: ui, configFile: false, server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, logLevel: "error" });
  try {
    const load = name => server.ssrLoadModule(`${namespace}${name}.ts`);
    const { syntheticFixture, syntheticDevices } = await load("synthetic-fixture");
    const { SessionSync } = await load("session-sync");
    const { deviceIdentity } = await load("device-identity");
    const profile = new Map(), storage = { getItem: key => profile.get(key) ?? null, setItem: (key, value) => profile.set(key, value) };
    assert.equal(deviceIdentity(storage, () => "opaque-1", "Phone").id, deviceIdentity(storage, () => "opaque-2", "Tablet").id);
    const fixture = syntheticFixture(), { runtime, emit, capture } = fixture;
    const phone = syntheticDevices[0].id, desktop = syntheticDevices[2].id;
    const rows = () => runtime.requests.rows("review");
    const request = (device, requestedBy = device) => { const row = runtime.request("review", device, requestedBy); assert.ok(row); return row.requestId; };
    const confirm = (id, device) => { assert.equal(runtime.confirm(id, device, true), true); assert.equal(rows().find(row => row.requestId === id).state, "confirmed"); };
    const listener = () => runtime.authority.inspect("review", runtime.now()).lease;
    assert.equal(runtime.enabled(), false);
    assert.equal(fixture.subscribers(), 0);
    fixture.connectAll();
    assert.equal(runtime.roster.count("review", runtime.now()), 0);
    assert.equal(runtime.request("review", phone, phone), null);
    runtime.sync("review"); runtime.sync("other"); runtime.setEnabled(true); fixture.connectAll();
    assert.equal(fixture.subscribers(), 1);
    assert.equal(runtime.roster.count("review", runtime.now()), 3);
    assert.equal(runtime.roster.count("other", runtime.now()), 0);
    for (const version of [3, 1, 2, 2]) emit({ kind: "document", event: { sessionId: "review", version, id: `e${version}`, text: `part${version}` } });
    assert.equal(runtime.sync("review").text(), "part1 part2 part3");
    assert.equal(runtime.sync("review").cursor().version, 3);
    assert.equal(runtime.sync("other").text(), "");
    const restored = new SessionSync("review", runtime.sync("review").snapshot());
    assert.equal(restored.text(), "part1 part2 part3");
    assert.equal(restored.receive({ sessionId: "other", version: 4, id: "wrong-session", text: "wrong" }), false);
    assert.equal(restored.receive({ sessionId: "review", version: 4, id: "e1", text: "duplicate ID" }), false);
    assert.equal(restored.receive({ sessionId: "review", version: 3, id: "conflict", text: "wrong" }), false);
    assert.throws(() => new SessionSync("other", restored.snapshot()), /Invalid sync snapshot/);
    fixture.presence(2, "disconnected");
    assert.equal(runtime.roster.count("review", runtime.now()), 2);
    assert.equal(runtime.roster.rows("review", runtime.now()).find(row => row.device.id === desktop).visibleStatus, "disconnected");
    emit({ kind: "presence", event: { sessionId: "review", device: syntheticDevices[2], revision: 1, status: "connected", expiresAt: 99999 } });
    assert.equal(runtime.roster.count("review", runtime.now()), 2, "late connect cannot resurrect a disconnected endpoint");
    fixture.presence(2, "connected");
    emit({ kind: "document", event: { sessionId: "review", version: 5, id: "e5", text: "part5" } });
    assert.equal(runtime.sync("review").cursor().version, 3);
    emit({ kind: "document", event: { sessionId: "review", version: 3, id: "e3", text: "part3" } });
    emit({ kind: "document", event: { sessionId: "review", version: 4, id: "e4", text: "part4" } });
    assert.equal(runtime.sync("review").text(), "part1 part2 part3 part4 part5");
    const remote = request(desktop);
    assert.equal(rows().find(row => row.requestId === remote).state, "requested");
    assert.equal(listener(), null); assert.deepEqual(capture, []);
    assert.equal(runtime.confirm(remote, phone, true), false, "requesting device cannot confirm for remote endpoint");
    assert.equal(runtime.activate(remote), false);
    const local = request(phone);
    const superseded = request(desktop, syntheticDevices[1].id);
    const selectedInstead = request(phone, syntheticDevices[1].id);
    assert.equal(runtime.confirm(superseded, desktop, true), false, "changing target invalidates the prior controller request");
    runtime.stop(selectedInstead);
    const previouslyConfirmed = request(desktop, syntheticDevices[1].id);
    confirm(previouslyConfirmed, desktop);
    const changedTarget = request(phone, syntheticDevices[1].id);
    assert.equal(runtime.activate(previouslyConfirmed), false, "a confirmation cannot survive changing its controller's selection");
    runtime.stop(changedTarget);
    confirm(remote, desktop); confirm(local, phone);
    const winners = await Promise.all([Promise.resolve().then(() => runtime.activate(remote)), Promise.resolve().then(() => runtime.activate(local))]);
    assert.equal(winners.filter(Boolean).length, 1);
    assert.equal(capture.filter(row => row.active).length, 1);
    const lease = listener(); assert.ok(lease);
    runtime.authority.release("review", lease.fence + 1, runtime.now());
    assert.equal(listener().fence, lease.fence, "stale release cannot stop current listener");
    fixture.advance(5000);
    assert.equal(listener(), null);
    assert.equal(capture.at(-1).active, false);
    assert.equal(runtime.activate(remote), false, "expired listener cannot restart");
    const expired = request(desktop); fixture.advance(10000);
    assert.equal(runtime.confirm(expired, desktop, true), false);
    const denied = request(desktop);
    assert.equal(runtime.confirm(denied, desktop, false), false);
    assert.equal(rows().find(row => row.requestId === denied).state, "denied");
    assert.equal(runtime.activate(denied), false);
    const old = request(desktop), replacement = request(desktop);
    assert.equal(runtime.confirm(old, desktop, true), false);
    confirm(replacement, desktop); assert.equal(runtime.activate(replacement), true);
    runtime.stop(replacement); assert.equal(listener(), null);
    assert.equal(runtime.activate(replacement), false);
    const disconnected = request(phone); confirm(disconnected, phone); assert.equal(runtime.activate(disconnected), true);
    fixture.presence(0, "disconnected"); assert.equal(listener(), null);
    fixture.presence(0, "connected"); assert.equal(runtime.activate(disconnected), false);
    const off = request(desktop); confirm(off, desktop); assert.equal(runtime.activate(off), true);
    runtime.setEnabled(false);
    assert.equal(listener(), null); assert.equal(fixture.subscribers(), 0);
    const savedText = runtime.sync("review").text();
    emit({ kind: "document", event: { sessionId: "review", version: 6, id: "e6", text: "ignored while off" } });
    runtime.setEnabled(true);
    assert.equal(runtime.sync("review").text(), savedText);
    assert.equal(runtime.activate(off), false); assert.equal(listener(), null);
    assert.ok(fixture.resumed.some(cursor => cursor.sessionId === "review" && cursor.version === 5));
    fixture.advance(21000);
    assert.equal(runtime.roster.count("review", runtime.now()), 0);
    assert.ok(runtime.roster.rows("review", runtime.now()).some(row => row.visibleStatus === "stale"));
    assert.equal(runtime.request("review", desktop, desktop), null);
    runtime.setEnabled(false);
    const expiryFixture = syntheticFixture();
    expiryFixture.runtime.setEnabled(true); expiryFixture.connectAll();
    const expiryRequest = expiryFixture.runtime.request("review", phone, phone);
    assert.ok(expiryRequest);
    assert.equal(expiryFixture.runtime.confirm(expiryRequest.requestId, phone, true), true);
    assert.equal(expiryFixture.runtime.activate(expiryRequest.requestId), true);
    expiryFixture.emit({ kind: "presence", event: { sessionId: "review", device: syntheticDevices[0], revision: 2, status: "connected", expiresAt: 1002 } });
    expiryFixture.advance(2);
    assert.equal(expiryFixture.runtime.authority.inspect("review", expiryFixture.runtime.now()).lease, null, "presence expiry releases an unexpired listener lease");
    assert.equal(expiryFixture.capture.at(-1).active, false);
    expiryFixture.runtime.setEnabled(false);
    console.log("PASS: identity, real-event counts, exact-session ordered replay, cursor resume, request/confirmation/lease lifecycle, off switch");
  } finally { await server.close(); }
}
function checkRust() {
  const source = fileURLToPath(new URL("../../core/src/intake1422_session_devices/mod.rs", import.meta.url));
  const binary = join(artifacts, "authority-tests");
  for (const [command, args] of [["rustc", ["--edition=2021", "--test", source, "-o", binary]], [binary, []]]) {
    const result = spawnSync(command, args, { encoding: "utf8" });
    process.stdout.write(result.stdout ?? ""); process.stderr.write(result.stderr ?? "");
    assert.equal(result.status, 0, `${command} must pass: ${result.error ?? ""}`);
  }
}

async function memoryPreview() {
  const output = await build({ root: ui, configFile: false, plugins: [react()], logLevel: "error", build: { write: false, rolldownOptions: { input: `${ui}src/intake1422/session-devices/preview.html` } } });
  const files = new Map(output.output.map(file => [`/${file.fileName}`, file.type === "asset" ? file.source : file.code]));
  const server = httpServer((request, response) => {
    const path = new URL(request.url, "http://synthetic").pathname;
    const file = files.get(path);
    if (file === undefined) { response.writeHead(404).end(); return; }
    response.writeHead(200, { "Content-Type": path.endsWith(".html") ? "text/html" : path.endsWith(".css") ? "text/css" : "text/javascript" }).end(file);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  return { url: `http://127.0.0.1:${server.address().port}${namespace}preview.html`, close: () => new Promise(resolve => server.close(resolve)) };
}
async function browserSession() {
  const executable = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  assert.ok(existsSync(executable), "MISSING: Chrome executable for visible synthetic check");
  const profile = join(artifacts, "synthetic-chrome-profile");
  const chrome = spawn(executable, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--mute-audio", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  console.log(`Synthetic Chrome PID ${chrome.pid}; artifacts ${artifacts}`);
  let socket;
  const stop = async () => {
    socket?.close();
    if (chrome.exitCode === null && chrome.signalCode === null) {
      const exited = once(chrome, "exit"); chrome.kill("SIGTERM"); await exited;
    }
    chrome.stderr.destroy();
  };
  try {
    const devtools = await new Promise((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(() => reject(new Error("Chrome startup timed out")), 15000);
      chrome.stderr.on("data", data => { output += data; const match = output.match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
      chrome.once("exit", () => { clearTimeout(timeout); reject(new Error("Chrome exited during startup")); });
      chrome.once("error", error => { clearTimeout(timeout); reject(error); });
    });
    socket = new WebSocket(devtools); await once(socket, "open");
    let serial = 0; const waiting = new Map();
    socket.addEventListener("message", event => { const result = JSON.parse(event.data); if (result.id) { waiting.get(result.id)?.(result); waiting.delete(result.id); } });
    const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++serial, timeout = setTimeout(() => { waiting.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
      waiting.set(id, result => { clearTimeout(timeout); result.error ? reject(new Error(result.error.message)) : resolve(result.result); });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    const page = (method, params) => call(method, params, sessionId);
    const evaluate = async expression => {
      const result = await page("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description ?? "Browser evaluation failed");
      return result.result.value;
    };
    // Waits on DOM state through mutation observation. Timeout reports a failed condition.
    const until = expression => evaluate(`new Promise((resolve, reject) => {
      const matches = () => { try { return !!(${expression}); } catch { return false; } };
      if (matches()) { resolve(true); return; }
      const observer = new MutationObserver(() => { if (matches()) { observer.disconnect(); clearTimeout(timeout); resolve(true); } });
      const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('DOM condition timed out: ' + ${JSON.stringify(expression)})); }, 8000);
      observer.observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
    })`);
    await page("Page.enable");
    await page("Page.addScriptToEvaluateOnNewDocument", { source: `
      window.captureApiCalls = 0; window.previewErrors = [];
      addEventListener('error', event => window.previewErrors.push(event.message));
      addEventListener('unhandledrejection', event => window.previewErrors.push(String(event.reason)));
      if(navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => { window.captureApiCalls++; throw new Error('Audio is forbidden in this check'); };
    ` });
    return { page, evaluate, until, stop };
  } catch (error) { await stop(); throw error; }
}

async function checkVisible() {
  const preview = await memoryPreview();
  let browser;
  try {
    browser = await browserSession();
    const { page, evaluate, until } = browser;
    const panels = `Array.from(document.querySelectorAll('.session-devices'))`;
    const panelText = index => `document.querySelectorAll('.session-devices')[${index}].innerText`;
    const click = (index, text) => evaluate(`(() => { const scope = ${index === null ? "document" : `document.querySelectorAll('.session-devices')[${index}]`}; const button = Array.from(scope.querySelectorAll('button')).find(button => button.textContent === ${JSON.stringify(text)}); if (!button || button.disabled) throw new Error('Button unavailable: ' + ${JSON.stringify(text)}); button.click(); })()`);
    await page("Page.navigate", { url: preview.url });
    await until(`document.body.textContent.includes('Device sharing is off')`);
    assert.equal(await evaluate(`document.querySelectorAll('.session-devices').length`), 0);
    await page("Page.navigate", { url: `${preview.url}?feature=intake1422-session-devices` });
    await until(`${panels}.length === 3 && ${panels}.every(panel => panel.innerText.includes('3 connected devices'))`);
    await click(null, "Replay out-of-order changes");
    await until(`${panels}.every(panel => panel.innerText.includes('A shared shape appears.') && panel.innerText.includes('Version 3'))`);
    await evaluate(`(() => { const select = document.querySelectorAll('.session-devices select')[1]; select.value='other'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await until(`${panelText(1)}.includes('0 connected devices') && ${panelText(1)}.includes('No shared changes yet')`);
    assert.ok(await evaluate(`${panelText(0)}.includes('A shared shape appears.')`));
    await evaluate(`(() => { const select = document.querySelectorAll('.session-devices select')[1]; select.value='review'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await until(`${panelText(1)}.includes('3 connected devices')`);
    await click(null, "Disconnect Desktop");
    await until(`${panels}.every(panel => panel.innerText.includes('2 connected devices') && panel.innerText.includes('disconnected'))`);
    await click(null, "Connect three devices");
    await until(`${panels}.every(panel => panel.innerText.includes('3 connected devices'))`);
    await click(0, "Request Desktop");
    await until(`${panelText(2)}.includes('Desktop: requested')`);
    assert.ok(await evaluate(`${panels}.every(panel => panel.innerText.includes('No listener'))`));
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('.session-devices')[0].querySelectorAll('button')).some(button => button.textContent.includes('Simulate local confirmation'))`), false);
    await click(2, "Simulate local confirmation");
    await until(`${panelText(2)}.includes('Desktop: confirmed')`);
    await click(2, "Grant synthetic listener");
    await until(`${panels}.every(panel => panel.innerText.includes('Synthetic listener: Desktop'))`);
    await page("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await evaluate("document.fonts.ready");
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, "phone view must fit without horizontal scrolling");
    const shot = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    writeFileSync(join(artifacts, "three-client-views.png"), Buffer.from(shot.data, "base64"));
    await click(null, "Advance lease clock");
    await until(`${panels}.every(panel => panel.innerText.includes('No listener'))`);
    await click(0, "Request Phone");
    await click(2, "Request Desktop");
    await click(0, "Simulate local confirmation");
    await click(2, "Simulate local confirmation");
    await evaluate(`(() => { for (const index of [0,2]) Array.from(document.querySelectorAll('.session-devices')[index].querySelectorAll('button')).find(button => button.textContent === 'Grant synthetic listener').click(); })()`);
    await until(`${panels}.every(panel => panel.innerText.includes('Synthetic listener: Phone'))`);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('.session-devices')[0].querySelectorAll('[aria-label="Input requests"] li')).filter(row => row.innerText.includes(': active')).length`), 1);
    await click(0, "Stop");
    await until(`${panels}.every(panel => panel.innerText.includes('No listener'))`);
    await click(0, "Request Desktop");
    await click(2, "Simulate denial");
    await until(`${panelText(2)}.includes('Desktop: denied')`);
    await click(null, "Switch off");
    await until(`${panels}.every(panel => panel.innerText.includes('Device sharing is off'))`);
    await click(null, "Switch on");
    await until(`${panels}.every(panel => panel.innerText.includes('No listener') && panel.innerText.includes('A shared shape appears.'))`);
    await click(null, "Expire presence");
    await until(`${panels}.every(panel => panel.innerText.includes('0 connected devices') && panel.innerText.includes('stale'))`);
    assert.equal(await evaluate("window.captureApiCalls"), 0);
    assert.deepEqual(await evaluate("window.previewErrors"), []);
    console.log("PASS: three rendered client views, count 3→2→3, exact-session isolation/return, pending→confirmed→active→expired, denied, stale, default off, preserved document; zero audio API calls");
  } finally { await browser?.stop(); await preview.close(); }
}
async function showPreview() {
  const preview = await memoryPreview();
  console.log(`Synthetic preview PID ${process.pid}: ${preview.url}?feature=intake1422-session-devices`);
  console.log("Explicit opt-in; no microphone or real transport. Stop this PID to close the preview.");
  await new Promise(resolve => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
  await preview.close();
}
try {
  if (process.argv.includes("--preview")) await showPreview();
  else {
  await checkParts();
  checkRust();
  await checkVisible();
  console.log(`PASS session-devices; synthetic artifacts retained at ${artifacts}`);
  console.log("MISSING: host wiring, real-network/physical-device evidence, physical local listener confirmation. Full integration gate belongs to the hub.");
  }
} catch (error) {
  console.error(error); process.exitCode = 1;
}
