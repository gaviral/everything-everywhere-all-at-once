// Isolated synthetic acceptance. No core, host registry, microphone, or fixed port.
// --preview serves the same fixture until interrupted. Temporary builds/profiles are retained.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ui = join(root, "ui"), feature = join(ui, "src/features/clarification");
const requireUI = createRequire(join(ui, "package.json"));
const { build } = await import(pathToFileURL(requireUI.resolve("vite")));
const { default: react } = await import(pathToFileURL(requireUI.resolve("@vitejs/plugin-react")));
const artifacts = mkdtempSync(join(tmpdir(), "clarification-check-"));
const preview = process.argv.includes("--preview");

async function checkModel() {
  const outDir = join(artifacts, "model");
  await build({ configFile: false, root: ui, logLevel: "error", build: {
    outDir, emptyOutDir: false, minify: false,
    lib: { entry: { controller: join(feature, "controller.ts"), anchor: join(feature, "SourceAnchor.ts"), policy: join(feature, "UnknownTermPolicy.ts") }, formats: ["es"], fileName: (_format, name) => `${name}.mjs` },
  } });
  const { createClarification } = await import(pathToFileURL(join(outDir, "controller.mjs")));
  const { anchorSelection, anchorIsCurrent } = await import(pathToFileURL(join(outDir, "anchor.mjs")));
  const { unknownTermPolicy } = await import(pathToFileURL(join(outDir, "policy.mjs")));
  const text = "A threshold protects the release. A threshold can change.";
  const original = { source: { id: "test-thought", revision: "1", text }, selection: { start: 2, end: 11, quote: "threshold" } };
  let selected = structuredClone(original), restores = 0, captures = 0, canRestore = true, throws = false;
  const controller = createClarification({
    getSnapshot: () => selected, subscribe: () => () => {},
    capturePlace: () => { captures++; return { scroll: 87 }; },
    restorePlace: (place, anchor) => { assert.equal(place.scroll, 87); assert.equal(anchor.quote, "threshold"); restores++; if (throws) throw Error("place unavailable"); return canRestore; },
  });
  assert.deepEqual([unknownTermPolicy(true), unknownTermPolicy(), unknownTermPolicy(true, true)], ["preserve", "ask", "critical-lookup"]);
  assert.equal(controller.getSnapshot().enabled, false);
  controller.ask();
  assert.equal(captures, 0, "off means no capture or question");
  const anchor = anchorSelection(selected);
  assert.equal(anchor.quote, "threshold");
  const second = text.lastIndexOf("threshold");
  assert.equal(anchorSelection({ ...selected, selection: { start: second, end: second + 9, quote: "threshold" } }).start, second, "explicit offsets disambiguate repeats");
  for (const selection of [null, { start: -1, end: 11, quote: "threshold" }, { start: 2.5, end: 11, quote: "threshold" }, { start: 2, end: 11, quote: "different" }, { start: 0, end: 999, quote: text }]) {
    assert.equal(anchorSelection({ ...selected, selection }), null, "ambiguous/invalid selection refused");
  }
  assert.equal(anchorSelection({ ...selected, source: { ...selected.source, revision: "" } }), null);
  assert.equal(anchorIsCurrent(anchor, { ...selected.source, text: text + "!" }), false, "same revision cannot conceal changed text");
  controller.setEnabled(true);
  selected = { ...original, known: true };
  controller.ask();
  assert.equal(controller.getSnapshot().question, null, "known jargon stays untouched");
  selected = { ...original, critical: true };
  controller.ask();
  assert.equal(controller.getSnapshot().question.lookupRequired, true, "critical meaning requires lookup; no service is invoked");
  controller.setUnderstanding("   "); controller.confirm();
  assert.equal(restores, 0, "blank understanding cannot confirm");
  controller.setUnderstanding("a release limit");
  for (const source of [{ ...original.source, revision: "2" }, { ...original.source, text: text + "!" }, { ...original.source, id: "another-thought" }]) {
    selected = { ...original, source }; controller.confirm(); controller.revisit(); controller.followUp();
    assert.equal(restores, 0, "stale confirmation/navigation refused");
    assert.equal(controller.getSnapshot().question.status, "asking");
  }
  selected = original;
  canRestore = false; controller.confirm();
  assert.equal(controller.getSnapshot().question.status, "asking", "failed restore cannot claim return");
  throws = true; controller.confirm();
  assert.match(controller.getSnapshot().notice, /unavailable/);
  throws = false; canRestore = true; controller.confirm();
  assert.equal(controller.getSnapshot().question.status, "resolved");
  controller.setEnabled(false);
  const before = restores; controller.dismiss(); controller.revisit(); controller.followUp();
  assert.equal(restores, before, "off blocks actions on an existing question");
  controller.setEnabled(true); controller.followUp(); controller.dismiss();
  assert.equal(controller.getSnapshot().question.status, "dismissed");
  assert.equal(controller.getSnapshot().question.anchor.text, text, "source text survives every action");
  console.log("PASS clarification model: switch, policy, exact ranges, stale refusal, acknowledgment and restore failure");
}

async function buildPreview() {
  const outDir = join(artifacts, "preview");
  await build({ configFile: false, root: ui, plugins: [react()], logLevel: "error", build: {
    outDir, emptyOutDir: false, rolldownOptions: { input: join(feature, "preview.html") },
  } });
  const server = createServer((req, res) => {
    const path = new URL(req.url, "http://local").pathname;
    const file = resolve(outDir, `.${path === "/" ? "/src/features/clarification/preview.html" : path}`);
    if (!file.startsWith(outDir + sep) || !existsSync(file)) { res.writeHead(404).end(); return; }
    res.setHeader("content-type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[extname(file)] ?? "application/octet-stream");
    res.end(readFileSync(file));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

async function openBrowser() {
  const chrome = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((path) => path && existsSync(path));
  assert.ok(chrome, "Chrome required for visible acceptance");
  const profile = join(artifacts, "browser-profile"); mkdirSync(profile);
  const proc = spawn(chrome, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--use-mock-keychain", "--password-store=basic", "--mute-audio", "--disable-breakpad", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let socket;
  const close = async () => {
    socket?.close();
    if (proc.exitCode === null && proc.signalCode === null) {
      proc.kill("SIGTERM");
      const ended = once(proc, "exit");
      let timer;
      await Promise.race([ended, new Promise((resolve) => { timer = setTimeout(resolve, 5000); })]); clearTimeout(timer);
      if (proc.exitCode === null && proc.signalCode === null) { proc.kill("SIGKILL"); await ended; }
    }
    assert.ok(proc.exitCode !== null || proc.signalCode !== null, "owned Chrome exited");
    proc.stderr.destroy();
  };
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let buffer = "";
      const timer = setTimeout(() => reject(Error("Chrome startup timed out")), 15000);
      proc.stderr.on("data", (data) => { buffer += data; const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
      proc.once("error", (error) => { clearTimeout(timer); reject(error); });
      proc.once("exit", () => { clearTimeout(timer); reject(Error("Chrome exited before ready")); });
    });
    socket = new WebSocket(endpoint); await once(socket, "open");
    let id = 0;
    const waiting = new Map();
    socket.onmessage = ({ data }) => { const response = JSON.parse(data); if (waiting.has(response.id)) { waiting.get(response.id)(response); waiting.delete(response.id); } };
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const key = ++id;
      const timer = setTimeout(() => { waiting.delete(key); reject(Error(`CDP timed out: ${method}`)); }, 10000);
      waiting.set(key, (response) => { clearTimeout(timer); response.error ? reject(Error(response.error.message)) : resolve(response.result); });
      socket.send(JSON.stringify({ id: key, method, params, sessionId }));
    });
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    return { close, page: (method, params) => send(method, params, sessionId) };
  } catch (error) { await close(); throw error; }
}

async function checkVisible(url) {
  const browser = await openBrowser();
  const { page } = browser;
  const evaluate = async (expression) => {
    const response = await page("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result.value;
  };
  const until = async (expression, label) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 40)); // Poll the rendered condition.
    }
    throw Error(`Condition failed: ${label} never became visible`);
  };
  const tap = async (label, touch = false) => {
    const point = await evaluate(`(() => { const el = [...document.querySelectorAll('button')].find(el => el.textContent === ${JSON.stringify(label)}); if (!el || el.disabled) throw Error('Action unavailable: ' + ${JSON.stringify(label)}); el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    if (touch) {
      await page("Emulation.setTouchEmulationEnabled", { enabled: true });
      await page("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
      await page("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await page("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
      await page("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
    }
  };
  const key = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
    await page("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode, modifiers, ...(key === "Enter" ? { text: "\r" } : {}) });
    await page("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode, modifiers });
  };
  const type = (text) => page("Input.insertText", { text });
  const selectRange = async (start, end) => {
    await evaluate(`document.querySelector('#thought').focus()`);
    await page("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", commands: ["selectAll"] });
    await page("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA" });
    await key("ArrowLeft", "ArrowLeft", 37);
    for (let i = 0; i < start; i++) await key("ArrowRight", "ArrowRight", 39);
    for (let i = start; i < end; i++) await key("ArrowRight", "ArrowRight", 39, 8);
    await until(`document.querySelector('#thought').selectionStart === ${start} && document.querySelector('#thought').selectionEnd === ${end}`, "native term selection");
  };
  const selectionReady = () => until(`[...document.querySelectorAll('.clarification button')].some(el=>el.textContent.includes('selection') && !el.disabled)`, "selection reaches Ask");
  const shot = async (name) => {
    await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`);
    const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(join(artifacts, name + ".png"), Buffer.from(data, "base64"));
  };
  const text = "A threshold protects the release. Keep this sentence exactly as typed.";
  try {
    await page("Page.enable");
    await page("Emulation.setDeviceMetricsOverride", { width: 1280, height: 960, deviceScaleFactor: 1, mobile: false });
    await page("Page.navigate", { url });
    await until(`!!document.querySelector('#thought')`, "preview editor");
    // Permission calls are replaced with an error before any interaction. No microphone is started.
    await evaluate(`navigator.mediaDevices.getUserMedia = () => { throw Error('Microphone forbidden in this check'); }`);
    assert.equal(await evaluate(`document.documentElement.dataset.defaultEnabled`), "false");
    assert.equal(await evaluate(`!!document.querySelector('.clarification-source')`), false, "off hides the feature");
    await evaluate(`document.querySelector('#thought').focus()`); await type(text); await selectRange(2, 11);
    await tap("Clarification off"); await selectionReady(); await tap("Ask about selection");
    await until(`document.querySelector('.clarification mark')?.textContent === 'threshold'`, "visible source mark");
    assert.equal(await evaluate(`document.querySelector('.clarification-source').textContent`), text);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.clarification mark')).textDecorationStyle`), "dotted");
    await evaluate(`document.querySelector('.clarification input').focus()`); await type("a release limit");
    await key("Tab", "Tab", 9);
    assert.equal(await evaluate(`document.activeElement.textContent`), "Confirm understanding", "keyboard reaches confirm");
    await shot("desktop-question");
    await key("Enter", "Enter", 13);
    await until(`document.querySelector('.clarification-question')?.textContent.includes('Confirmed:')`, "confirmed understanding");
    assert.deepEqual(await evaluate(`({id:document.activeElement.id,start:document.querySelector('#thought').selectionStart,end:document.querySelector('#thought').selectionEnd})`), { id: "thought", start: 2, end: 11 }, "confirmation restores the original selection and focus");
    assert.equal(await evaluate(`document.querySelector('#thought').value`), text);
    await tap("Leave thought"); await tap("Return to thought");
    await tap("Revisit source");
    assert.equal(await evaluate(`document.activeElement.id`), "thought", "revisit survives view remount");
    assert.equal(await evaluate(`document.querySelector('.clarification-source').textContent`), text);
    await tap("Ask a follow-up"); await tap("Dismiss question");
    assert.equal(await evaluate(`!!document.querySelector('.clarification mark')`), false, "dismiss removes the mark");
    assert.equal(await evaluate(`document.activeElement.id`), "thought");
    await tap("Clarification on");
    assert.equal(await evaluate(`!!document.querySelector('.clarification-question')`), false);
    await tap("Clarification off");
    await selectRange(2, 11); await selectionReady(); await tap("Ask about selection");
    await evaluate(`document.querySelector('.clarification input').focus()`); await type("a release limit");
    await evaluate(`document.querySelector('#thought').focus(); document.querySelector('#thought').setSelectionRange(0,0)`); await type("Revised. ");
    await until(`document.querySelector('[role=alert]')?.textContent.includes('Source changed')`, "stale refusal");
    assert.equal(await evaluate(`!!document.querySelector('.clarification mark')`), false, "no mark on a stale range");
    assert.equal(await evaluate(`[...document.querySelectorAll('button')].find(el=>el.textContent==='Confirm understanding').disabled`), true);
    await shot("stale-refusal");
    // Return to a fresh selection and inspect narrow/enlarged rendered states.
    await selectRange(11, 20); await selectionReady(); await tap("Ask about new selection");
    for (const [name, size] of [["phone-question", 16], ["phone-enlarged", 32]]) {
      await page("Emulation.setDeviceMetricsOverride", { width: 360, height: 1100, deviceScaleFactor: 1, mobile: false });
      await evaluate(`document.documentElement.style.fontSize='${size}px'; document.querySelector('.clarification').scrollIntoView({block:'start'})`);
      assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, `${name}: no horizontal clipping`);
      assert.equal(await evaluate(`!!document.querySelector('.clarification mark')`), true);
      assert.equal(await evaluate(`Math.round(parseFloat(getComputedStyle(document.querySelector('.clarification-source')).fontSize))`), size);
      assert.equal(await evaluate(`[...document.querySelectorAll('.clarification button')].every(el=>el.getBoundingClientRect().height>=44)`), true, "reachable action sizes");
      await shot(name);
    }
    assert.equal(await evaluate(`document.querySelector('#thought').value`), "Revised. " + text);
    await evaluate(`document.querySelector('.clarification input').focus()`); await type("a release limit");
    await evaluate(`[...document.querySelectorAll('button')].find(el=>el.textContent==='Confirm understanding').scrollIntoView({block:'center'})`);
    await shot("phone-enlarged-actions");
    await tap("Confirm understanding", true);
    await until(`document.querySelector('.clarification-question')?.textContent.includes('Confirmed:')`, "touch acknowledgment");
    assert.deepEqual(await evaluate(`({id:document.activeElement.id,start:document.querySelector('#thought').selectionStart,end:document.querySelector('#thought').selectionEnd})`), { id: "thought", start: 11, end: 20 }, "touch confirmation restores revised selection");
    console.log("PASS clarification visible: typed source, mark, keyboard/touch confirm, restored focus/range, remount/revisit, follow-up, dismiss, off, stale refusal, phone and enlarged text");
  } catch (error) {
    await shot("failure");
    console.error("Visible failure state:", await evaluate(`({text:document.body.innerText,selection:[document.querySelector('#thought')?.selectionStart,document.querySelector('#thought')?.selectionEnd],disabled:[...document.querySelectorAll('button')].filter(el=>el.disabled).map(el=>el.textContent)})`));
    throw error;
  } finally { await browser.close(); }
}

if (!preview) await checkModel();
const { server, url } = await buildPreview();
console.log(`Clarification preview: ${url}`);
console.log(`Artifacts: ${artifacts}`);
if (preview) {
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close());
} else {
  try { await checkVisible(url); } finally { await new Promise((resolve) => server.close(resolve)); }
}
