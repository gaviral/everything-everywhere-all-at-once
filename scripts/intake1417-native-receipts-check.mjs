import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";

const ui = fileURLToPath(new URL("../ui/", import.meta.url));
const requireUI = createRequire(new URL("../ui/package.json", import.meta.url));
const source = "src/intake1417/native-receipts/";
const artifacts = mkdtempSync(join(tmpdir(), "native-receipts-check-"));

function checkTypes() {
  const result = spawnSync(join(ui, "node_modules/.bin/tsc"), ["--ignoreConfig", "--noEmit", "--strict", "--noUnusedLocals",
    "--noUnusedParameters", "--skipLibCheck", "--target", "ES2022", "--lib", "ES2022,DOM", "--module", "ESNext",
    "--moduleResolution", "bundler", "--jsx", "react-jsx", "--types", "vite/client", source + "index.tsx", source + "preview.tsx"],
  { cwd: ui, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  console.log("PASS scoped TypeScript");
}

async function checkReceiptRules(server) {
  const { ReceiptInput } = await server.ssrLoadModule("/" + source + "ReceiptInput.ts");
  const { ReceiptState } = await server.ssrLoadModule("/" + source + "ReceiptState.ts");
  const { createReceiptVisit } = await server.ssrLoadModule("/" + source + "ReceiptReturn.ts");
  const { sampleOperation, sampleOperations } = await server.ssrLoadModule("/" + source + "samples.ts");
  const sample = sampleOperation("confirmed");
  const resolve = value => ReceiptState(ReceiptInput(value));
  const native = { ...sample, origin: "native", receipt: { ...sample.receipt, source: "native" } };
  assert.equal(resolve(native).outcome, "confirmed");
  assert.equal(resolve(sample).outcome, "synthetic-preview");
  for (const status of ["pending", "failed", "unknown"]) {
    assert.equal(resolve({ ...native, status }).outcome, status);
    assert(!resolve({ ...native, status }).message.includes("was added"));
  }
  for (const receipt of [undefined, {}, { ...native.receipt, operationId: "another-operation" },
    { ...native.receipt, provider: "another-provider" }, { ...native.receipt, source: "synthetic" },
    { ...native.receipt, outcome: "failed" }, { ...native.receipt, observedAt: "2026-02-31T20:00:00.000Z" },
    { ...native.receipt, receiptId: "invalid/reference" }]) {
    assert.equal(resolve({ ...native, receipt }).outcome, "unknown", "Matching native evidence required");
  }
  for (const value of [null, [], { ...sample, operationId: "bad/identity" }, { ...sample, provider: "other" },
    { ...sample, status: "done" }, { ...sample, origin: "unknown" },
    { ...sample, reminder: { ...sample.reminder, notes: "person@example.com" } }]) assert.equal(ReceiptInput(value), null);
  const clean = ReceiptInput({ ...native, privateDiagnostic: "DO-NOT-EXPOSE" });
  assert(!JSON.stringify(clean).includes("DO-NOT-EXPOSE"));
  assert(Object.isFrozen(clean.reminder));
  assert.throws(() => createReceiptVisit([sample, sample]), /unique/);

  let subscriptions = 0, releases = 0, receive;
  const visit = createReceiptVisit(sampleOperations, { subscribe(listener) {
    subscriptions++; receive = listener; return () => releases++;
  } });
  assert.equal(visit.getSnapshot().enabled, false);
  assert.equal(subscriptions, 0, "Fresh profile starts no subscriptions");
  visit.select("sample-failed"); visit.showDetail();
  visit.setEnabled(false); assert.equal(subscriptions, 0);
  visit.setEnabled(true); assert.equal(subscriptions, 1);
  visit.setEnabled(true); assert.equal(subscriptions, 1);
  receive(sample); assert.equal(visit.getSnapshot().selectedId, "sample-failed");
  assert.equal(visit.getSnapshot().detail, true, "Late receipt does not navigate");
  const beforeConflict = visit.getSnapshot().operations;
  receive({ ...sampleOperation("failed"), reminder: { ...sample.reminder, title: "Different request" } });
  assert.equal(visit.getSnapshot().operations, beforeConflict);
  assert(visit.getSnapshot().notice.includes("conflicting"));
  receive({ privateDiagnostic: "DO-NOT-EXPOSE" });
  assert(!JSON.stringify(visit.getSnapshot()).includes("DO-NOT-EXPOSE"));
  visit.setEnabled(false); assert.equal(releases, 1);
  const offSnapshot = visit.getSnapshot();
  receive(sampleOperation("pending")); assert.equal(visit.getSnapshot(), offSnapshot, "Off ignores late delivery");
  assert.equal(offSnapshot.selectedId, "sample-failed"); assert.equal(offSnapshot.detail, true);
  const oldReceive = receive;
  visit.setEnabled(true);
  const resumedSnapshot = visit.getSnapshot(); oldReceive(sample);
  assert.equal(visit.getSnapshot(), resumedSnapshot, "Old subscription cannot deliver after re-enable");
  const matched = { ...sample, operationId: "sample-pending", receipt: { ...sample.receipt, operationId: "sample-pending" } };
  receive(matched);
  assert.equal(visit.getSnapshot().selectedId, "sample-failed");
  assert.equal(ReceiptState(visit.getSnapshot().operations.find(row => row.operationId === "sample-pending")).outcome, "synthetic-preview");
  visit.returnToPreview(); assert.equal(visit.getSnapshot().selectedId, "sample-failed");
  assert.equal(visit.getSnapshot().detail, false);
  visit.dispose(); assert.equal(releases, 2);
  const unavailable = createReceiptVisit([], { subscribe(listener) { receive = listener; throw new Error("DO-NOT-EXPOSE"); } });
  unavailable.setEnabled(true);
  const failedSnapshot = unavailable.getSnapshot(); receive(sample);
  assert.equal(unavailable.getSnapshot(), failedSnapshot, "Throwing observer cannot deliver later");
  assert(!JSON.stringify(failedSnapshot).includes("DO-NOT-EXPOSE"));
  unavailable.dispose();
  console.log("PASS matching receipts, truthful outcomes, validation, identity, default off, cleanup and late-delivery isolation");
}

// Isolated Chrome retains its disposable profile for review; only this child's PID is stopped.
async function openBrowser(url) {
  const executable = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]
    .find(value => value && existsSync(value));
  assert(executable, "Chrome is required for the visible check");
  const profile = mkdtempSync(join(tmpdir(), "native-receipts-chrome-"));
  const child = spawn(executable, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run",
    "--no-default-browser-check", "--use-mock-keychain", "--password-store=basic", "--mute-audio", "about:blank"],
  { stdio: ["ignore", "ignore", "pipe"] });
  console.log(`Owned Chrome PID ${child.pid}`);
  const cleanup = () => { if (child.exitCode === null) child.kill("SIGTERM"); };
  process.once("exit", cleanup);
  let socket;
  const close = async () => {
    socket?.close();
    if (child.exitCode === null) { const exited = once(child, "exit"); cleanup(); await exited; }
    child.stderr.destroy();
    process.removeListener("exit", cleanup);
    console.log(`Owned Chrome PID ${child.pid} exited; profile retained`);
  };
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error("Chrome endpoint did not arrive")), 15000);
      child.stderr.on("data", chunk => {
        output += chunk;
        const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("Chrome exited before ready")); });
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let nextId = 0;
    const pending = new Map();
    socket.onmessage = event => {
      const result = JSON.parse(event.data);
      if (pending.has(result.id)) { pending.get(result.id)(result); pending.delete(result.id); }
    };
    const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, value => value.error ? reject(new Error(value.error.message)) : resolve(value.result));
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    const page = (method, params) => call(method, params, sessionId);
    const evaluate = async expression => {
      const result = await page("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      assert(!result.exceptionDetails, result.exceptionDetails?.exception?.description);
      return result.result.value;
    };
    await page("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await page("Page.navigate", { url });
    return { page, evaluate, close };
  } catch (error) { await close(); throw error; }
}

async function checkVisible(browser) {
  const { evaluate, page } = browser;
  const wait = async expression => {
    const start = Date.now();
    while (Date.now() - start < 8000) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail(`TIMING: condition did not arrive: ${expression}`);
  };
  const waitText = text => wait(`document.body.innerText.includes(${JSON.stringify(text)})`);
  const click = label => evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(e => e.textContent === ${JSON.stringify(label)}); if (!button) throw Error('Missing button'); button.click(); })()`);
  const select = async status => {
    await evaluate(`(() => { const select = document.querySelector('.native-receipts select'); select.value = ${JSON.stringify("sample-" + status)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitText("sample-" + status);
  };
  const resultText = () => evaluate("document.querySelector('[aria-label=\"Selected reminder result\"]').innerText");
  const capture = async name => {
    const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    writeFileSync(join(artifacts, name + ".png"), Buffer.from(data, "base64"));
  };
  await waitText("Receipt view off.");
  assert.equal(await evaluate("document.querySelector('.native-receipts input').checked"), false);
  await waitText("Sample · Pending");
  assert(!(await resultText()).includes("was added"));
  await select("confirmed"); await waitText("Sample · Confirmed preview");
  await waitText("No reminder was created.");
  await select("failed"); await waitText("Sample · Failed");
  assert(!(await resultText()).includes("was added"));
  await select("unknown"); await waitText("Sample · Unknown");
  assert(!(await resultText()).includes("was added"));
  await waitText("Bring a sketchbook"); await waitText("Tomorrow at 10:00");
  await select("pending");
  await evaluate("document.querySelector('.native-receipts input').focus()");
  for (const type of ["keyDown", "keyUp"]) await page("Input.dispatchKeyEvent", { type, key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  await waitText("Receipt view on.");
  for (const type of ["keyDown", "keyUp"]) await page("Input.dispatchKeyEvent", { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  assert.equal(await evaluate("document.activeElement.tagName"), "SELECT");
  for (const type of ["keyDown", "keyUp"]) await page("Input.dispatchKeyEvent", { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  assert.equal(await evaluate("document.activeElement.textContent"), "View receipt evidence");
  for (const type of ["keyDown", "keyUp"]) await page("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter",
    windowsVirtualKeyCode: 13, ...(type === "keyDown" ? { text: "\r", unmodifiedText: "\r" } : {}) });
  await waitText("Receipt evidence");
  assert.equal(await evaluate("document.activeElement.textContent"), "Return to result");
  await click("Inject late sample confirmation");
  assert((await evaluate("document.querySelector('[aria-label=\"Receipt evidence\"]').innerText")).includes("sample-pending"));
  await click("Return to result"); await waitText("Sample · Pending");
  assert.equal(await evaluate("document.activeElement.textContent"), "View receipt evidence");
  await click("Leave preview"); await waitText("Return to preview");
  await click("Return to preview"); await waitText("Sample · Pending");
  assert.equal(await evaluate("document.querySelector('.native-receipts select').value"), "sample-pending");
  await evaluate("document.querySelector('.native-receipts input').click()");
  await waitText("Receipt view off.");
  await click("Inject late sample confirmation"); await waitText("Sample · Pending");
  await capture("desktop-pending");
  await select("confirmed"); await click("View receipt evidence");
  await waitText("Injected synthetic sample"); await waitText("Supplied for this operation and provider");
  assert(!(await evaluate("document.body.innerText")).includes("sample-evidence"), "Raw reference stays private");
  await capture("desktop-evidence");
  await click("Return to result");
  await page("Emulation.setDeviceMetricsOverride", { width: 320, height: 740, deviceScaleFactor: 1, mobile: false });
  await wait("innerWidth === 320");
  const fits = "document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.native-receipts button, .native-receipts select, .native-receipts-switch, .native-receipts-preview-tools button')].every(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height >= 44 && r.left >= 0 && r.right <= innerWidth; })";
  assert(await evaluate(fits), "320px controls fit and remain touch sized");
  await capture("phone-confirmed");
  await evaluate("document.documentElement.style.fontSize = '200%'");
  assert(await evaluate(fits), "Enlarged text fits without horizontal overflow");
  await capture("phone-large-text");
  console.log("PASS visible sample states, keyboard switch, detail focus/return, remount retention, late receipt, off state, 320px and enlarged text");
}

checkTypes();
const { createServer } = await import(requireUI.resolve("vite"));
const server = await createServer({ root: ui, configFile: false, appType: "mpa", logLevel: "error",
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0, strictPort: true, open: false, fs: { allow: [ui] } } });
let browser;
try {
  await server.listen();
  await checkReceiptRules(server);
  browser = await openBrowser(`http://127.0.0.1:${server.httpServer.address().port}/${source}preview.html`);
  await checkVisible(browser);
  console.log(`Screenshots retained: ${artifacts}`);
} finally {
  if (browser) await browser.close();
  await server.close();
}
