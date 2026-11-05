// Isolated synthetic acceptance. Retains screenshots and its disposable Chrome profile for review.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../../ui/node_modules/vite/dist/node/index.js";
import react from "../../ui/node_modules/@vitejs/plugin-react/dist/index.js";

const root = fileURLToPath(new URL("../../ui", import.meta.url));
const artifacts = mkdtempSync(join(tmpdir(), "live-area-check-"));
const chromePath = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(path => path && existsSync(path));
assert.ok(chromePath, "REAL: Chrome is required for visible acceptance");
const server = await createServer({ root, configFile: false, cacheDir: join(artifacts, "vite-cache"), plugins: [react()], server: { host: "127.0.0.1", port: 4417, strictPort: true, hmr: false } });
let chrome, socket;

async function checkJoinAndLifecycle() {
  const { StatusJoin } = await server.ssrLoadModule("/src/features/live-area/StatusJoin.ts");
  const { LiveAreaStore, STALE_AFTER_MS } = await server.ssrLoadModule("/src/features/live-area/LiveAreaStore.ts");
  const { SyntheticSource } = await server.ssrLoadModule("/src/features/live-area/SyntheticSource.ts");
  const { recordFreshness } = await server.ssrLoadModule("/src/features/live-area/FreshnessLabel.tsx");
  const identity = { runId: "run-a", branchId: "branch-a", buildId: "build-a" };
  const sample = { identity, agentId: "agent-a", agentName: "Agent A", task: "Task A", state: "running", sequence: 2, observedAt: 1000 };
  const joiner = new StatusJoin();
  assert.ok(joiner.acceptActivity(sample, 1));
  sample.task = "Mutated adapter object";
  assert.equal(joiner.rows()[0].activity.event.task, "Task A", "accepted records are isolated from adapter mutations");
  assert.equal(joiner.acceptActivity({ ...sample, sequence: 1 }, 1), false);
  assert.equal(joiner.acceptActivity({ ...sample, sequence: 3, observedAt: 999 }, 1), false);
  assert.equal(joiner.acceptActivity({ ...sample, sequence: 3, observedAt: 1e30 }, 1), false);
  assert.equal(joiner.acceptActivity({ ...sample, identity: { ...identity, buildId: "" } }, 1), false);
  assert.ok(joiner.acceptActivity({ ...sample, agentId: "agent-b" }, 1), "agents sharing a build keep separate records");
  assert.ok(joiner.acceptActivity({ ...sample, identity: { ...identity, branchId: "branch-b" } }, 1));
  assert.ok(joiner.acceptBuild({ identity: { ...identity, buildId: "other-build" }, sequence: 1, observedAt: 1000, state: "ready", label: "Wrong build" }, 1));
  assert.ok(joiner.rows().every(row => !row.build), "different builds never cross-join");
  assert.ok(joiner.acceptBuild({ identity, sequence: 2, observedAt: 1000, state: "ready", label: "Matching build" }, 1));
  assert.equal(joiner.rows().filter(row => row.build).length, 2, "only agents on the matching branch/build share build status");
  assert.equal(joiner.acceptBuild({ identity, sequence: 1, observedAt: 1000, state: "failed", label: "Old" }, 1), false);
  assert.ok(joiner.acceptVersion({ identity, sequence: 2, observedAt: 1000, branchLabel: "A", worktreeLabel: "A workspace", revision: "123" }, 1));
  assert.equal(joiner.acceptVersion({ identity, sequence: 1, observedAt: 1000, branchLabel: "Old", worktreeLabel: "Old", revision: "old" }, 1), false);
  const source = new SyntheticSource();
  let clock = 1000;
  const store = new LiveAreaStore({ activity: source }, () => clock);
  try {
    assert.equal(store.getSnapshot().enabled, false);
    assert.equal(source.count, 0);
    store.setEnabled(true);
    assert.equal(source.count, 1);
    source.emit(sample);
    assert.equal(store.getSnapshot().sources.activity.state, "connected");
    assert.equal(store.getSnapshot().sources.build.state, "unavailable");
    clock += STALE_AFTER_MS; store.refresh();
    assert.equal(store.getSnapshot().sources.activity.state, "stale");
    source.connection("disconnected");
    assert.equal(store.getSnapshot().sources.activity.state, "disconnected");
    source.connection("connected");
    assert.match(recordFreshness(store.getSnapshot().rows[0].activity, store.getSnapshot().sources.activity, clock), /Stale identity/);
    source.emit({ ...sample, task: "Obsolete", sequence: 1 });
    assert.equal(store.getSnapshot().rows[0].activity.event.task, "Mutated adapter object");
    assert.equal(store.getSnapshot().sources.activity.state, "waiting", "rejected replay cannot refresh connection");
    source.emit({ ...sample, task: "New", sequence: 3, observedAt: clock });
    assert.equal(recordFreshness(store.getSnapshot().rows[0].activity, store.getSnapshot().sources.activity, clock), "Current");
    store.setEnabled(false);
    assert.equal(source.count, 0);
    assert.equal(store.getSnapshot().rows[0].activity.event.task, "New", "off retains accepted data");
  } finally { store.setEnabled(false); }
  let observer;
  const late = new LiveAreaStore({ activity: { subscribe(value) { observer = value; value.connection("connected"); return () => {}; } } });
  late.setEnabled(true); late.setEnabled(false);
  observer.event(sample); observer.connection("connected");
  assert.equal(late.getSnapshot().rows.length, 0, "late callbacks after off cannot publish");
  const unavailable = new LiveAreaStore({ activity: { subscribe() { throw Error("source unavailable"); } } });
  try { unavailable.setEnabled(true); assert.equal(unavailable.getSnapshot().sources.activity.state, "unavailable"); }
  finally { unavailable.setEnabled(false); }
  console.log("PASS identity join, stale rejection, freshness, unavailable sources, off cleanup and retained data");
}

async function connectChrome() {
  chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${join(artifacts, "chrome-profile")}`, "--no-first-run", "--no-default-browser-check", "--use-mock-keychain", "--password-store=basic", "--mute-audio", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  console.log(`Chrome PID ${chrome.pid}`);
  const address = await new Promise((resolveAddress, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(Error("TIMING: Chrome did not announce DevTools within 20s")), 20_000);
    chrome.stderr.on("data", chunk => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolveAddress(match[1]); }
    });
    chrome.once("error", error => { clearTimeout(timer); reject(error); });
    chrome.once("exit", () => { clearTimeout(timer); reject(Error("REAL: Chrome exited before connection")); });
  });
  socket = new WebSocket(address);
  await once(socket, "open");
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(Error(message.error.message)); else request.resolve(message.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolveResult, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`TIMING: ${method}`)); }, 15_000);
    pending.set(id, { resolve: resolveResult, reject, timer });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);
  const evaluate = async expression => {
    const response = await page("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result.value;
  };
  return { page, evaluate };
}

async function checkVisible({ page, evaluate }) {
  const wait = async (expression, label) => {
    // The browser waits for the condition each frame; the deadline is only a failure bound.
    assert.ok(await evaluate(`new Promise(resolve => { const end = performance.now() + 8000; function check() { if (${expression}) resolve(true); else if (performance.now() >= end) resolve(false); else requestAnimationFrame(check); } check(); })`), label);
  };
  const click = label => evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent === ${JSON.stringify(label)}).click()`);
  const rowText = branch => evaluate(`document.querySelector('[data-branch="${branch}"]')?.textContent`);
  const shot = async name => writeFileSync(join(artifacts, `${name}.png`), Buffer.from((await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })).data, "base64"));
  await page("Page.enable");
  await page("Page.addScriptToEvaluateOnNewDocument", { source: `window.previewErrors = []; addEventListener('error', event => window.previewErrors.push(event.message)); addEventListener('unhandledrejection', event => window.previewErrors.push(String(event.reason)));` });
  await page("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await page("Page.navigate", { url: "http://127.0.0.1:4417/src/features/live-area/preview.html" });
  await wait(`document.querySelector('[role="switch"]')`, "preview mounted");
  assert.equal(await evaluate(`document.querySelector('[role="switch"]').getAttribute('aria-checked')`), "false", "fresh profile off");
  await click("Inspect subscriptions");
  await wait(`document.querySelector('output').textContent.endsWith('0')`, "off has no source subscriptions");
  await page("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await page("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  // Focus explicitly after the pointer-operated fixture control, then use a real key to toggle.
  await evaluate(`document.querySelector('[role="switch"]').focus()`);
  await page("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " });
  await page("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  await wait(`document.querySelector('[role="switch"]').getAttribute('aria-checked') === 'true'`, "keyboard turns feature on");
  await click("Inspect subscriptions");
  await wait(`document.querySelector('output').textContent.endsWith('3')`, "one subscription per provided source");
  await click("Send matching statuses");
  await wait(`document.querySelector('.la-selected')?.textContent.includes('Preview ready')`, "selected build status is visible before activity arrives");
  assert.match(await evaluate(`document.querySelector('.la-selected').textContent`), /no matching agent activity.*North workspace/s);
  await click("Send activity");
  await wait(`document.querySelectorAll('.la-row').length === 2`, "two agent rows");
  assert.match(await rowText("branch-north"), /Agent North.*Selected build.*done · Check navigation.*Preview ready.*North workspace/s);
  assert.match(await rowText("branch-south"), /Agent South.*Observed build.*waiting · Review layout/s);
  assert.match(await rowText("branch-south"), /Unavailable · no matching reload status.*Unavailable · no matching version reference/s);
  await click("Send matching statuses");
  await wait(`document.querySelector('[data-branch="branch-north"]').textContent.includes('Preview ready')`, "North gets matching build");
  assert.match(await rowText("branch-north"), /North workspace.*Revision abc1234/s);
  assert.doesNotMatch(await rowText("branch-south"), /Preview ready|North workspace|abc1234/);
  await shot("desktop-current");
  await click("Disconnect");
  await wait(`document.querySelector('.la-sources').textContent.includes('Activity: disconnected')`, "disconnect visible");
  assert.match(await rowText("branch-north"), /Disconnected · last known/);
  await click("Reconnect");
  await wait(`document.querySelector('[data-branch="branch-north"]').textContent.includes('Stale identity')`, "reconnect marks retained identities stale");
  await click("Send older event");
  assert.doesNotMatch(await rowText("branch-north"), /Obsolete/);
  assert.match(await rowText("branch-north"), /Stale identity/);
  await shot("desktop-reconnected-stale");
  await click("Send activity"); await click("Send matching statuses");
  await wait(`document.querySelector('[data-branch="branch-north"]').textContent.includes('done · Check navigation')`, "newer activity accepted");
  assert.doesNotMatch(await rowText("branch-north"), /Stale identity|Obsolete/);
  await page("Emulation.setDeviceMetricsOverride", { width: 320, height: 900, deviceScaleFactor: 1, mobile: true });
  await shot("narrow-320");
  assert.ok(await evaluate(`document.documentElement.scrollWidth <= 320`), "no horizontal overflow at 320px");
  const originalTextSize = await evaluate(`parseFloat(getComputedStyle(document.querySelector('.la-slot p')).fontSize)`);
  await evaluate(`document.documentElement.style.fontSize = '200%'`);
  assert.ok(await evaluate(`parseFloat(getComputedStyle(document.querySelector('.la-slot p')).fontSize) >= ${originalTextSize * 2}`), "app text itself doubles in size");
  await shot("narrow-enlarged");
  assert.ok(await evaluate(`document.documentElement.scrollWidth <= 320`), "enlarged text has no horizontal overflow");
  await click("Remove slots");
  await wait(`document.querySelector('.la-sources').textContent.includes('Reload: unavailable')`, "missing adapters reported unavailable");
  await click("Send activity");
  await wait(`document.querySelector('[data-branch="branch-north"]').textContent.includes('no matching reload status')`, "missing slots display honest placeholders");
  await click("Turn live area off"); await click("Inspect subscriptions");
  await wait(`document.querySelector('output').textContent.endsWith('0')`, "off removes every subscription");
  assert.equal(await evaluate(`document.querySelectorAll('.la-row').length`), 0, "off hides records");
  await click("Turn live area on");
  await wait(`document.querySelectorAll('.la-row').length === 2`, "reenabling retains records");
  assert.match(await rowText("branch-north"), /Stale identity/);
  await click("Turn live area off");
  assert.deepEqual(await evaluate("window.previewErrors"), [], "no page errors");
  console.log("PASS visible two-agent/two-branch routing, missing slots, disconnect/reconnect, older event rejection, keyboard, 320px/enlarged text and off cleanup");
}

try {
  await checkJoinAndLifecycle();
  await server.listen();
  await checkVisible(await connectChrome());
  console.log(`PASS live-area-check; synthetic proof only; artifacts ${artifacts}`);
} finally {
  socket?.close();
  if (chrome && chrome.exitCode === null) {
    const exited = once(chrome, "exit");
    chrome.kill("SIGTERM");
    await exited;
    chrome.stderr.destroy();
    console.log(`Chrome PID ${chrome.pid} exited`);
  }
  await server.close();
}
