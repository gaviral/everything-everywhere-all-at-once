// Isolated browser acceptance. Retains temporary artifacts; never touches a running app or its ports.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ui = join(repo, "ui");
const namespace = join(ui, "src/intake1411/pen-devices");
const artifacts = mkdtempSync(join(tmpdir(), "pen-devices-check-"));
const chromePath = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find(path => path && existsSync(path));
const results = [];

async function typecheck() {
  const files = readdirSync(namespace).filter(file => /\.tsx?$/.test(file)).map(file => join(namespace, file));
  const child = spawn(process.execPath, [join(ui, "node_modules/typescript/bin/tsc"), "--ignoreConfig", "--noEmit", "--strict", "--noUnusedLocals",
    "--noUnusedParameters", "--skipLibCheck", "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "bundler",
    "--jsx", "react-jsx", "--types", "vite/client", "--lib", "ES2022,DOM,DOM.Iterable", ...files], { cwd: ui, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", data => { output += data; });
  child.stderr.on("data", data => { output += data; });
  const [code] = await once(child, "exit");
  assert.equal(code, 0, output);
  results.push("focused TypeScript passed");
}

async function buildPreview() {
  const { build } = await import(pathToFileURL(join(ui, "node_modules/vite/dist/node/index.js")));
  const site = join(artifacts, "site");
  await build({ configFile: false, root: ui, logLevel: "error", build: { outDir: site, emptyOutDir: false,
    rollupOptions: { input: join(namespace, "preview.html") } } });
  return site;
}

async function servePreview(site) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
  const server = createServer((request, response) => {
    const path = resolve(site, `.${new URL(request.url, "http://preview").pathname}`);
    if (!path.startsWith(`${site}/`) || !existsSync(path)) { response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" }).end(readFileSync(path));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  assert(![4360, 4399].includes(port));
  return { server, url: `http://127.0.0.1:${port}/src/intake1411/pen-devices/preview.html` };
}

async function startBrowser() {
  const child = spawn(chromePath, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${join(artifacts, "profile")}`,
    "--no-first-run", "--no-default-browser-check", "--use-mock-keychain", "--password-store=basic", "--mute-audio", "about:blank"],
  { stdio: ["ignore", "ignore", "pipe"] });
  writeFileSync(join(artifacts, "browser-pid.txt"), `${child.pid}\n`);
  let socket;
  try {
    const endpoint = await new Promise((resolveEndpoint, reject) => {
      let output = "";
      const deadline = setTimeout(() => reject(new Error("Chrome startup deadline")), 15000);
      child.stderr.on("data", data => {
        output += data;
        const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(deadline); resolveEndpoint(match[1]); }
      });
      child.once("exit", code => { clearTimeout(deadline); reject(new Error(`Chrome exited ${code}`)); });
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolveSocket, reject) => { socket.onopen = resolveSocket; socket.onerror = reject; });
    let sequence = 0;
    const pending = new Map();
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (!pending.has(message.id)) return;
      const { resolveReply, reject, deadline } = pending.get(message.id);
      clearTimeout(deadline); pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message)); else resolveReply(message.result);
    };
    const command = (method, params = {}, sessionId) => new Promise((resolveReply, reject) => {
      const id = ++sequence;
      const deadline = setTimeout(() => { pending.delete(id); reject(new Error(`CDP deadline: ${method}`)); }, 10000);
      pending.set(id, { resolveReply, reject, deadline });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const { targetId } = await command("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await command("Target.attachToTarget", { targetId, flatten: true });
    const page = (method, params) => command(method, params, sessionId);
    const evaluate = async expression => {
      const result = await page("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };
    const until = async expression => {
      const result = await evaluate(`new Promise((resolve) => { const end = performance.now() + 5000;
        function check() { if (${expression}) return resolve(true); if (performance.now() >= end) return resolve(false); requestAnimationFrame(check); } check(); })`);
      assert.equal(result, true, `Condition: ${expression}`);
    };
    const close = async () => {
      const exited = child.exitCode === null ? once(child, "exit") : Promise.resolve();
      await command("Browser.close").catch(() => {});
      await exited;
      socket.close(); child.stderr.destroy(); child.unref();
    };
    return { page, evaluate, until, close };
  } catch (error) {
    socket?.close();
    if (child.exitCode === null) { const exited = once(child, "exit"); child.kill("SIGTERM"); await exited; }
    child.stderr.destroy();
    throw error;
  }
}

async function acceptance(browser, url) {
  const { page, evaluate, until } = browser;
  const click = async label => {
    await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(button => button.textContent === ${JSON.stringify(label)});
      if (!button) throw Error('Missing button'); button.click(); })()`);
  };
  const select = async (label, value) => {
    await evaluate(`(() => { const label = [...document.querySelectorAll('.pen-controls label')].find(label => label.firstChild.textContent === ${JSON.stringify(label)});
      const select = label.querySelector('select'); select.value = ${JSON.stringify(value)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  };
  const checkbox = async label => {
    await evaluate(`(() => { const label = [...document.querySelectorAll('label')].find(label => label.textContent === ${JSON.stringify(label)});
      label.querySelector('input').click(); })()`);
  };
  const receiptCount = () => evaluate("document.querySelectorAll('[data-delivery=acknowledged]').length");
  const draw = async (pointerType = "mouse", cancel = false) => {
    return evaluate(`(() => {
      const surface = document.querySelector('[data-capture]');
      if (!surface) throw Error('No drawing surface');
      const rect = surface.getBoundingClientRect();
      const points = [[.15,.2],[.45,.55],[.8,.3]];
      const samples = [];
      const capture = surface.setPointerCapture, hasCapture = surface.hasPointerCapture;
      surface.setPointerCapture = () => {}; surface.hasPointerCapture = () => false;
      try {
      for (let i = 0; i < points.length; i++) {
        const type = i === 0 ? 'pointerdown' : i === 2 ? ${JSON.stringify(cancel ? "pointercancel" : "pointerup")} : 'pointermove';
        const event = new PointerEvent(type, { pointerId: 91, pointerType: ${JSON.stringify(pointerType)}, isPrimary: true,
          button: 0, buttons: i === 2 ? 0 : 1, clientX: rect.left + rect.width * points[i][0],
          clientY: rect.top + rect.height * points[i][1], pressure: .37, bubbles: true, cancelable: true });
        // Synthetic PointerEvents have no OS active pointer; actual capture is exercised separately via CDP mouse.
        samples.push({ clientX: event.clientX, clientY: event.clientY, timeStamp: event.timeStamp, pressure: event.pressure });
        surface.dispatchEvent(event);
      }
      } finally { surface.setPointerCapture = capture; surface.hasPointerCapture = hasCapture; }
      return samples;
    })()`);
  };
  const screenshot = async name => {
    const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(join(artifacts, `${name}.png`), Buffer.from(data, "base64"));
  };
  async function verifyPointerRouting() {
    await page("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await page("Page.navigate", { url });
    await until("document.querySelector('.pen-devices')");
    await until("window.penDevicesSubscriberCount === 2");
    assert.equal(await evaluate("document.querySelector('[data-capture]') === null"), true);
    await click("Enable pen-devices feature");
    await click("Start drawing");
    await until("document.body.textContent.includes('Choose a destination session to draw.')");
    assert.equal(await evaluate("document.querySelector('[data-capture]') === null"), true);
    await select("Destination session", "studio-b");
    await until("document.querySelector('[data-capture=pointer]')");

    // Real browser pointer path, entirely synthetic input; no physical device claim.
    const rect = await evaluate("(() => { const r = document.querySelector('[data-capture]').getBoundingClientRect(); return {x:r.left,y:r.top,w:r.width,h:r.height}; })()");
    await page("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x + 30, y: rect.y + 40, button: "left", clickCount: 1 });
    await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x + 200, y: rect.y + 100, button: "left", buttons: 1 });
    await page("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x + 240, y: rect.y + 120, button: "left", clickCount: 1 });
    await until("document.querySelectorAll('[data-delivery=acknowledged]').length === 1");
    const first = await evaluate("window.penDevicesObservation.received[0]");
    assert.equal(first.sessionId, "studio-b");
    assert.equal(first.pointerType, "mouse");
    assert(first.points.length >= 3);
    assert.equal(await evaluate("document.querySelector('[data-destination=studio-a]').querySelectorAll('polyline').length"), 0);
    assert.equal(await evaluate("document.querySelector('[data-destination=studio-b] polyline').dataset.strokeId"), first.id);
    assert.equal(await evaluate("document.querySelector('[data-delivery=acknowledged]').dataset.strokeId"), first.id);
    results.push("browser pointer capture routes identical stroke ID only to explicitly selected Studio B");
    await screenshot("desktop");
    await evaluate("document.querySelector('.pen-preview-destinations').scrollIntoView({block:'center'})");
    await screenshot("destinations");
    await evaluate("scrollTo(0,0)");
  }

  async function verifyOriginalPen() {
    await select("Destination session", "studio-a");
    await checkbox("Hold acknowledgments");
    const original = await draw("pen");
    await until("document.querySelectorAll('[data-delivery=pending]').length === 1");
    assert.equal(await receiptCount(), 1);
    await click("Release held acknowledgments");
    await until("document.querySelectorAll('[data-delivery=acknowledged]').length === 2");
    const pen = await evaluate("window.penDevicesObservation.received[1]");
    assert.equal(pen.sessionId, "studio-a");
    assert.equal(pen.pointerType, "pen");
    assert.deepEqual(pen.points.map(({ clientX, clientY, timeStamp, pressure }) => ({ clientX, clientY, timeStamp, pressure })), original);
    assert.equal(pen.points[1].x, (original[1].clientX - pen.surface.left) / pen.surface.width);
    assert.equal(await evaluate("document.querySelector('[data-destination=studio-a] polyline').dataset.strokeId"), pen.id);
    results.push("pen event simulation retains original coordinates/times/pressure; acknowledgment stays pending until released");
    await checkbox("Hold acknowledgments");
  }

  async function verifyTouchIsolation() {
    await select("Input device", "touch");
    await until("document.querySelector('[data-capture=touch]')");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-capture]')).touchAction"), "none");
    const beforeMouse = await evaluate("window.penDevicesObservation.received.length");
    await draw("mouse");
    assert.equal(await evaluate("window.penDevicesObservation.received.length"), beforeMouse);
    await draw("touch", true);
    await until("document.body.textContent.includes('Unfinished stroke canceled.')");
    assert.equal(await evaluate("window.penDevicesObservation.received.length"), beforeMouse);
    await draw("touch");
    await until("document.querySelectorAll('[data-delivery=acknowledged]').length === 3");
    results.push("touch device isolation and pointercancel passed");
  }

  async function verifyMobileGesture() {
    await page("Emulation.setDeviceMetricsOverride", { width: 360, height: 800, deviceScaleFactor: 1, mobile: true });
    await page("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await evaluate("document.querySelector('[data-capture]').scrollIntoView({block:'center'})");
    const touchRect = await evaluate("(() => { const r = document.querySelector('[data-capture]').getBoundingClientRect(); return {x:r.left+40,y:r.top+130}; })()");
    const scrollBefore = await evaluate("scrollY");
    await page("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: touchRect.x, y: touchRect.y, id: 2 }] });
    await page("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: touchRect.x + 70, y: touchRect.y - 80, id: 2 }] });
    await page("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await until("document.querySelectorAll('[data-delivery=acknowledged]').length === 4");
    assert.equal(await evaluate("scrollY"), scrollBefore);
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
    await evaluate("scrollTo(0,0)");
    await screenshot("mobile");
    results.push("360px touch browser gesture draws without page scroll or horizontal overflow");
  }

  async function verifyInterruptedDestination() {
    await click("Disconnect Studio A");
    await until("document.body.textContent.includes('Studio A disconnected. Drawing paused.')");
    assert.equal(await evaluate("document.querySelector('[data-capture]') === null"), true);
    await screenshot("disconnected");
    await click("Reconnect Studio A");
    await until("document.querySelector('[data-capture=touch]')");
    await checkbox("Simulate mismatched receipt");
    await draw("touch");
    await until("document.querySelectorAll('[data-delivery=unconfirmed]').length === 1");
    assert.equal(await receiptCount(), 4);
    await checkbox("Simulate mismatched receipt");
    results.push("disconnect removes capture; mismatched receipt never appears acknowledged");
  }

  async function verifySwitchOff() {
    await checkbox("Hold acknowledgments");
    await draw("touch");
    await until("document.querySelector('[data-delivery=pending]')");
    const receivedBeforeOff = await evaluate("window.penDevicesObservation.received.length");
    await click("Disable pen-devices feature");
    await until("document.querySelector('[data-capture]') === null && !document.querySelector('[data-delivery=pending]')");
    await until("window.penDevicesSubscriberCount === 2");
    await click("Release held acknowledgments");
    assert.equal(await evaluate("window.penDevicesObservation.received.length"), receivedBeforeOff);
    assert.equal(await receiptCount(), 4);
    assert.equal(await evaluate("document.querySelectorAll('[data-delivery]').length"), 6);
    results.push("switch-off aborts pending work, removes capture and preserves receipt records and destination marks");
    return receivedBeforeOff;
  }

  async function verifyRetargetAndReconnect(receivedBeforeOff) {
    await page("Emulation.setTouchEmulationEnabled", { enabled: false });
    await click("Enable pen-devices feature");
    await until("document.querySelector('.pen-controls button')?.textContent === 'Start drawing'");
    assert.equal(await evaluate("document.querySelector('[data-capture]') === null"), true);
    await click("Start drawing");
    await until("document.querySelector('[data-capture=touch]')");
    await evaluate(`(() => {
      const surface = document.querySelector('[data-capture]'); window.detachedPenSurface = surface;
      const capture = surface.setPointerCapture; surface.setPointerCapture = () => {};
      try { surface.dispatchEvent(new PointerEvent('pointerdown', {pointerId:92,pointerType:'touch',isPrimary:true,button:0,clientX:100,clientY:200,bubbles:true,cancelable:true})); }
      finally { surface.setPointerCapture = capture; }
    })()`);
    await until("document.querySelector('[data-capture] polyline')");
    await select("Destination session", "studio-b");
    await until("document.body.textContent.includes('Drawing to Studio B.')");
    await evaluate("window.detachedPenSurface.dispatchEvent(new PointerEvent('pointerup', {pointerId:92,pointerType:'touch',isPrimary:true,button:0,bubbles:true})); window.detachedPenSurface = null");
    assert.equal(await evaluate("window.penDevicesObservation.received.length"), receivedBeforeOff);
    assert.equal(await evaluate("document.querySelectorAll('[data-delivery]').length"), 6);
    results.push("session change cancels an unfinished stroke and detached capture cannot deliver to either destination");
    await draw("touch");
    await until("document.querySelector('[data-delivery=pending]')");
    await click("Disconnect Studio B");
    await until("!document.querySelector('[data-delivery=pending]') && document.querySelector('[data-capture]') === null");
    await click("Release held acknowledgments");
    assert.equal(await evaluate("window.penDevicesObservation.received.length"), receivedBeforeOff);
    await click("Reconnect Studio B");
    await until("document.querySelector('[data-capture=touch]')");
    assert.equal(await evaluate("window.penDevicesObservation.received.length"), receivedBeforeOff);
    results.push("disconnect aborts a held delivery and reconnect never replays it");
    await click("Stop drawing");
    await until("document.querySelector('[data-capture]') === null");
  }

  async function verifyEnlargedKeyboard() {
    await page("Emulation.setDeviceMetricsOverride", { width: 360, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate("document.documentElement.style.fontSize = '200%'; scrollTo(0,0)");
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
    await page("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await page("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    assert.equal(await evaluate("['BUTTON','SELECT','INPUT'].includes(document.activeElement.tagName)"), true);
    await screenshot("enlarged-keyboard");
    results.push("200% text at 360px has no horizontal overflow; keyboard reaches controls");
  }

  await verifyPointerRouting();
  await verifyOriginalPen();
  await verifyTouchIsolation();
  await verifyMobileGesture();
  await verifyInterruptedDestination();
  const receivedBeforeOff = await verifySwitchOff();
  await verifyRetargetAndReconnect(receivedBeforeOff);
  await verifyEnlargedKeyboard();
}

let server, browser;
try {
  assert(chromePath, "MISSING Chrome for isolated visible acceptance");
  await typecheck();
  const site = await buildPreview();
  const served = await servePreview(site); server = served.server;
  browser = await startBrowser();
  await acceptance(browser, served.url);
  writeFileSync(join(artifacts, "results.json"), JSON.stringify({ results, physicalPen: "MISSING", phone: "MISSING", iPad: "MISSING", ownerTransport: "MISSING" }, null, 2));
  console.log(`PASS pen-devices: ${results.length} focused checks; artifacts ${artifacts}`);
} catch (error) {
  if (browser) {
    const screenshot = await browser.page("Page.captureScreenshot", { format: "png" }).catch(() => null);
    if (screenshot) writeFileSync(join(artifacts, "failure.png"), Buffer.from(screenshot.data, "base64"));
    const overflow = await browser.evaluate("[...document.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > innerWidth).map(e => ({tag:e.tagName,class:e.className,text:e.textContent.slice(0,80),width:e.getBoundingClientRect().width}))").catch(() => []);
    writeFileSync(join(artifacts, "overflow.json"), JSON.stringify(overflow, null, 2));
  }
  writeFileSync(join(artifacts, "failure.txt"), `${error.stack}\n${results.join("\n")}\n`);
  console.error(`REAL pen-devices check failure: ${error.message}; artifacts ${artifacts}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await new Promise(resolveClose => server.close(resolveClose));
}
