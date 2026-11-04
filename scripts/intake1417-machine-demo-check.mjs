import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const ui = fileURLToPath(new URL("../ui/", import.meta.url));
const source = "src/intake1417/machine-demo/";
const modules = process.env.MACHINE_DEMO_MODULES ? resolve(process.env.MACHINE_DEMO_MODULES) : join(ui, "node_modules");
const requireUI = createRequire(join(modules, "../package.json"));
const { createServer } = await import(requireUI.resolve("vite"));
const artifacts = mkdtempSync(join(tmpdir(), "machine-demo-check-"));
console.log(`Artifacts: ${artifacts}`);

function checkTypes() {
  const staging = join(artifacts, "typecheck");
  cpSync(join(ui, source), staging, { recursive: true });
  symlinkSync(modules, join(staging, "node_modules"));
  const result = spawnSync(join(modules, ".bin/tsc"), ["--ignoreConfig", "--noEmit", "--strict", "--noUnusedLocals", "--noUnusedParameters",
    "--skipLibCheck", "--target", "ES2022", "--lib", "ES2022,DOM", "--module", "ESNext", "--moduleResolution", "bundler",
    "--jsx", "react-jsx", "--types", "vite/client", "index.tsx", "preview.tsx"], { cwd: staging, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  console.log("PASS scoped TypeScript");
}

async function checkSuppliedFacts(server) {
  const { MachineInput } = await server.ssrLoadModule("/" + source + "MachineInput.ts");
  const { createMachineSession } = await server.ssrLoadModule("/" + source + "MachineRefresh.ts");
  const { syntheticParts, syntheticProfiles, createSyntheticAdapter } = await server.ssrLoadModule("/" + source + "synthetic.ts");
  const supplier = createSyntheticAdapter();
  const original = JSON.stringify(syntheticParts);
  const session = createMachineSession(syntheticParts, supplier.adapter);
  assert.equal(session.getSnapshot().enabled, false);
  assert.deepEqual(supplier.activity(), { reads: 0, subscriptions: 0 });
  session.refresh(); session.select("native-reminders");
  assert.equal(session.getSnapshot().selectedId, "portable-map");
  assert.equal(supplier.activity().reads, 0);
  session.setEnabled(true);
  const status = id => session.getSnapshot().matches.find(match => match.part.id === id).status;
  assert.equal(status("portable-map"), "available");
  assert.equal(status("native-reminders"), "unavailable");
  session.select("native-reminders");
  for (const [name, expected] of [["Mac · verified", "available"], ["Non-Mac", "unavailable"], ["Unknown evidence", "unknown"],
    ["Browser claims Mac", "unknown"], ["Hosted Mac", "unavailable"]]) {
    supplier.supply(syntheticProfiles[name]);
    assert.equal(status("native-reminders"), expected, name);
    assert.equal(status("portable-map"), "available", name);
    assert.equal(session.getSnapshot().selectedId, "native-reminders");
  }
  const now = "2026-11-04T22:00:00Z";
  for (const invalid of [null, [], "invalid", { facts: { automation: { value: "granted" } } }])
    assert.equal(Object.keys(MachineInput(invalid, now).facts).length, 0);
  for (const patch of [{ observedAt: "2026-11-05T00:00:00Z" }, { observedAt: "2026-02-30T00:00:00Z" },
    { observedAt: "" }, { source: "" }, { kind: "user-agent" }, { kind: "platform-research" }]) {
    const profile = structuredClone(syntheticProfiles["Mac · verified"]);
    profile.facts.automation.evidence = { ...profile.facts.automation.evidence, ...patch };
    supplier.supply(profile); assert.equal(status("native-reminders"), "unknown");
  }
  session.setEnabled(false);
  const before = supplier.activity().reads;
  supplier.supply(syntheticProfiles["Mac · verified"]); session.refresh();
  assert.equal(supplier.activity().reads, before);
  assert.equal(supplier.activity().subscriptions, 0);
  session.setEnabled(true); assert.equal(status("native-reminders"), "available");
  assert.equal(session.getSnapshot().selectedId, "native-reminders");
  session.setEnabled(true); assert.equal(supplier.activity().subscriptions, 1);
  session.dispose(); assert.equal(supplier.activity().subscriptions, 0);
  assert.equal(JSON.stringify(syntheticParts), original);
  let callback, reads = 0, disconnects = 0;
  const retained = createMachineSession(syntheticParts, { now: () => now, read: () => { reads++; return syntheticProfiles["Mac · verified"]; },
    subscribe(changed) { callback = changed; return () => { disconnects++; }; } });
  retained.setEnabled(true); const oldCallback = callback;
  retained.setEnabled(false); retained.setEnabled(true);
  const currentReads = reads; oldCallback(); assert.equal(reads, currentReads, "Ignore callbacks from an old subscription");
  retained.dispose(); assert.equal(disconnects, 2);
  const failed = createMachineSession(syntheticParts, { now: () => now, read() { throw new Error("private diagnostics"); } });
  failed.setEnabled(true);
  assert.equal(failed.getSnapshot().matches[1].status, "unknown");
  assert(!JSON.stringify(failed.getSnapshot()).includes("private diagnostics")); failed.dispose();
  assert.throws(() => createMachineSession([syntheticParts[0], syntheticParts[0]], supplier.adapter), /unique/);
  assert.throws(() => createMachineSession(syntheticParts, supplier.adapter, "missing"), /Unknown/);
  console.log("PASS supplied Mac/non-Mac/hosted/unknown evidence, malformed dates, refresh retention, off lifecycle, stale callbacks and read failure");
}

/** A new isolated Chrome profile. Retain temporary files; stop only the recorded child PID. */
async function openPreview(url) {
  const executable = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]
    .find(path => path && existsSync(path));
  assert(executable, "Chrome required for the visible check");
  const chrome = spawn(executable, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${join(artifacts, "chrome-profile")}`,
    "--no-first-run", "--no-default-browser-check", "--use-mock-keychain", "--password-store=basic", "--mute-audio", "about:blank"],
  { stdio: ["ignore", "ignore", "pipe"] });
  console.log(`Chrome PID ${chrome.pid}`);
  let socket;
  const close = async () => {
    socket?.close();
    const exit = new Promise(resolveExit => chrome.exitCode !== null ? resolveExit() : chrome.once("exit", resolveExit));
    if (chrome.exitCode === null) chrome.kill("SIGTERM");
    let timer;
    await Promise.race([exit, new Promise(resolveWait => { timer = setTimeout(resolveWait, 3000); })]);
    clearTimeout(timer);
    if (chrome.exitCode === null) { chrome.kill("SIGKILL"); await exit; }
    chrome.stderr.destroy(); chrome.unref();
    console.log(`Chrome PID ${chrome.pid} stopped`);
  };
  try {
    const endpoint = await new Promise((resolveEndpoint, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error("Chrome startup timed out")), 15000);
      chrome.stderr.on("data", data => {
        output += data;
        const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timer); resolveEndpoint(match[1]); }
      });
      chrome.once("error", error => { clearTimeout(timer); reject(error); });
      chrome.once("exit", () => { clearTimeout(timer); reject(new Error("Chrome exited before readiness")); });
    });
    socket = new WebSocket(endpoint);
    await new Promise((opened, reject) => { socket.onopen = opened; socket.onerror = reject; });
    const pending = new Map(); let sequence = 0;
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (!pending.has(message.id)) return;
      const { resolveResult, reject, timer } = pending.get(message.id); pending.delete(message.id); clearTimeout(timer);
      if (message.error) reject(new Error(message.error.message)); else resolveResult(message.result);
    };
    const command = (method, params = {}, sessionId) => new Promise((resolveResult, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
      pending.set(id, { resolveResult, reject, timer }); socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const { targetId } = await command("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await command("Target.attachToTarget", { targetId, flatten: true });
    const page = (method, params) => command(method, params, sessionId);
    const evaluate = async expression => {
      const result = await page("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      assert(!result.exceptionDetails, result.exceptionDetails?.text);
      return result.result.value;
    };
    await page("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await page("Page.navigate", { url });
    return { page, evaluate, close };
  } catch (error) { await close(); throw error; }
}

async function checkVisible(browser) {
  const { evaluate, page } = browser;
  const waitText = async text => assert(await evaluate(`new Promise(resolve => {
    const ready = () => document.body.innerText.includes(${JSON.stringify(text)});
    if (ready()) return resolve(true);
    const observer = new MutationObserver(() => { if (ready()) { observer.disconnect(); clearTimeout(timer); resolve(true); } });
    const timer = setTimeout(() => { observer.disconnect(); resolve(false); }, 7000);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true });
  })`), `Visible: ${text}`);
  const click = label => evaluate(`(() => { const button = [...document.querySelectorAll('.machine-demo button')].find(button => button.innerText.startsWith(${JSON.stringify(label)})); if (!button) throw Error('Missing choice'); button.click(); })()`);
  const profile = async name => {
    await evaluate(`(() => { const select = document.querySelector('.machine-demo-preview-controls select');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(name)});
      select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  };
  const toggle = () => evaluate("document.querySelector('input[type=checkbox]').click()");
  const screenshot = async name => {
    const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    writeFileSync(join(artifacts, name + ".png"), Buffer.from(data, "base64"));
  };
  await waitText("Readiness off"); await waitText("Supplied-fact reads: 0 · Owned subscriptions: 0");
  assert.equal(await evaluate("document.querySelector('.machine-demo') === null"), true);
  await evaluate("(() => { const select = document.querySelector('.machine-demo-host select'); select.value = 'Gallery'; select.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await waitText("Host choice: Gallery");
  await evaluate("document.querySelector('input[type=checkbox]').focus()");
  await page("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  await page("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  await waitText("Readiness on"); await waitText("Availability: available");
  await page("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await page("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  assert.equal(await evaluate("document.activeElement.tagName"), "SELECT");
  await click("Native Reminders"); await waitText("Automation permission — unavailable");
  await waitText("System Settings › Privacy & Security › Automation");
  await screenshot("desktop-denied");
  for (const [name, expected] of [["Mac · verified", "available"], ["Non-Mac", "unavailable"], ["Unknown evidence", "unknown"], ["Browser claims Mac", "unknown"], ["Hosted Mac", "unavailable"]]) {
    await profile(name); await waitText(`Availability: ${expected}`);
    assert.equal(await evaluate("document.querySelector('.machine-demo button[aria-pressed=true] strong').innerText"), "Native Reminders");
    assert.equal(await evaluate("document.querySelector('.machine-demo button strong').nextElementSibling.innerText"), "available");
  }
  await profile("Mac · verified"); await waitText("Availability: available");
  await toggle(); await waitText("Host choice: Gallery"); await waitText("Owned subscriptions: 0");
  const reads = await evaluate("document.querySelector('[aria-live=polite]').innerText");
  await profile("Non-Mac");
  assert.equal(await evaluate("document.querySelector('[aria-live=polite]').innerText"), reads);
  await toggle(); await waitText("Availability: unavailable");
  assert.equal(await evaluate("document.querySelector('.machine-demo button[aria-pressed=true] strong').innerText"), "Native Reminders");
  await profile("Mac · permission denied"); await waitText("Automation permission — unavailable");
  await page("Emulation.setDeviceMetricsOverride", { width: 320, height: 740, deviceScaleFactor: 1, mobile: false });
  assert(await evaluate("document.documentElement.scrollWidth <= innerWidth"), "No narrow viewport overflow");
  await screenshot("narrow-denied");
  await evaluate("document.documentElement.style.fontSize = '200%'");
  await screenshot("narrow-enlarged");
  assert(await evaluate("document.documentElement.scrollWidth <= innerWidth"), "No enlarged text overflow");
  assert(await evaluate("[...document.querySelectorAll('.machine-demo button')].every(button => button.getBoundingClientRect().height >= 44)"));
  await screenshot("narrow-enlarged");
  await page("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate("document.documentElement.style.fontSize = ''");
  await click("Portable example"); await waitText("Availability: available");
  await waitText("no native permission"); await screenshot("portable-example");
  console.log("PASS visible availability, denied setup, keyboard switch, profile refresh, retained host/part, 320px and enlarged text");
}

checkTypes();
const server = await createServer({ root: ui, configFile: false, appType: "mpa", logLevel: "error",
  cacheDir: join(artifacts, "vite-cache"), optimizeDeps: { entries: [join(ui, source, "preview.html")] },
  resolve: { alias: { "react": join(modules, "react"), "react-dom": join(modules, "react-dom") } },
  server: { host: "127.0.0.1", port: 0, strictPort: true, open: false, fs: { allow: [ui, modules] } } });
let browser;
try {
  await server.listen();
  await checkSuppliedFacts(server);
  browser = await openPreview(`http://127.0.0.1:${server.httpServer.address().port}/${source}preview.html`);
  await checkVisible(browser);
  console.log(`Artifacts: ${artifacts}`);
} finally { await browser?.close(); await server.close(); }
