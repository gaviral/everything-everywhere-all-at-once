// Focused check: isolated component, synthetic clock and local provider, no app or microphone.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer as httpServer } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as viteServer } from "../../../../node_modules/vite/dist/node/index.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const feature = resolve(here, "..");
const ui = resolve(here, "../../../../");
const roots = readdirSync(feature).filter(name => /\.tsx?$/.test(name)).map(name => join(feature, name));
roots.push(join(ui, "src/vite-env.d.ts"));
const types = spawnSync(join(ui, "node_modules/.bin/tsc"), ["--ignoreConfig", "--noEmit", "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "bundler", "--jsx", "react-jsx", "--strict", "--noUnusedLocals", "--noUnusedParameters", "--skipLibCheck", ...roots], { encoding: "utf8" });
assert.equal(types.status, 0, types.stdout + types.stderr);
assert.equal(JSON.parse(readFileSync(join(feature, "brick.json"))).defaultOn, false);

const artifacts = mkdtempSync(join(tmpdir(), "care-prompts-check-"));
const vite = await viteServer({ configFile: false, root: ui, cacheDir: join(artifacts, "vite"), server: { middlewareMode: true, hmr: false, watch: null } });
const server = httpServer((request, response) => vite.middlewares(request, response));
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
assert.ok(port !== 4360 && port !== 4399);
// DevTools uses pipes, so it needs no listening port. The throwaway profile is retained, never deleted.
const chrome = spawn(process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--remote-debugging-pipe", `--user-data-dir=${join(artifacts, "profile")}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--mute-audio", "about:blank"],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"], env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key))) });
let serial = 0, buffered = "";
const pending = new Map();
const requests = [];
chrome.stdio[4].on("data", data => {
  buffered += data.toString();
  let end;
  while ((end = buffered.indexOf("\0")) >= 0) {
    const message = JSON.parse(buffered.slice(0, end)); buffered = buffered.slice(end + 1);
    if (message.id && pending.has(message.id)) { const handler = pending.get(message.id); pending.delete(message.id); handler(message); }
    if (message.method === "Network.requestWillBeSent") requests.push(message.params.request.url);
  }
});
const cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++serial;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 45000);
  pending.set(id, message => { clearTimeout(timer); message.error ? reject(new Error(message.error.message)) : resolve(message.result); });
  chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
});
try {
  await cdp("Browser.getVersion");
  console.log("Browser ready; opening the focused page.");
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true });
  const page = (method, params) => cdp(method, params, sessionId);
  const evaluate = async expression => {
    const response = await page("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    assert.ok(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  const until = async (expression, label) => {
    const end = Date.now() + 7000;
    while (Date.now() < end) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    assert.fail(label || expression);
  };
  const click = async selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const shown = `.care-prompts-settings[open]`;
  await page("Network.enable");
  await page("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page("Page.navigate", { url: `http://127.0.0.1:${port}/src/bricks/care-prompts/checks/index.html` });
  await until(`!!document.querySelector('.care-prompts-opener')`, "component loads");
  await evaluate(`careCheck.advance(180)`);
  assert.equal(await evaluate(`!!document.querySelector('.care-prompts-prompt')`), false, "off even after time passes");
  await click(".care-prompts-opener"); await until(`!!document.querySelector('${shown}')`);
  assert.match(await evaluate(`document.querySelector('${shown}').textContent`), /EXAMPLE PROMPT/);
  assert.match(await evaluate(`document.querySelector('.care-prompts-source').textContent`), /Unavailable/);
  await click(".care-prompts-water-button");
  await until(`document.querySelector('.care-prompts-water-top').textContent.includes('1 glass tapped today')`);
  await evaluate(`window.detachSource = careCheck.source({ getWater: () => ({ total: 3, time: Date.now() - 3600000 }) })`);
  await until(`document.querySelector('.care-prompts-source').textContent.includes('Stale reading')`);
  await evaluate(`detachSource()`);
  await until(`document.querySelector('.care-prompts-source').textContent.includes('Unavailable')`);
  await click(".care-prompts-example button");
  await until(`!!document.querySelector('.care-prompts-prompt')`);
  assert.match(await evaluate(`document.querySelector('.care-prompts-prompt').textContent`), /EXAMPLE/);
  await click(".care-prompts-prompt"); await until(`!document.querySelector('.care-prompts-prompt')`);
  await click(".care-prompts-opener"); await until(`!!document.querySelector('${shown}')`);
  await evaluate(`const select = document.querySelector('.care-prompts-frequency select'); select.value = '30'; select.dispatchEvent(new Event('change', { bubbles: true }))`);
  await click(".care-prompts-start"); await until(`!document.querySelector('${shown}')`);
  await evaluate(`careCheck.advance(29)`);
  assert.equal(await evaluate(`!!document.querySelector('.care-prompts-prompt')`), false, "waits chosen frequency");
  await evaluate(`careCheck.advance(1)`); await until(`!!document.querySelector('.care-prompts-prompt')`);
  assert.match(await evaluate(`document.querySelector('.care-prompts-prompt').textContent`), /Take a break/);
  const snapshot = await page("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(artifacts, "corner.png"), Buffer.from(snapshot.data, "base64"));
  await click(".care-prompts-prompt"); await until(`!document.querySelector('.care-prompts-prompt')`);
  assert.equal(await evaluate(`document.activeElement.className`), "care-prompts-opener", "dismiss restores focus");
  await evaluate(`careCheck.advance(30)`); await until(`document.querySelector('.care-prompts-prompt')?.textContent.includes('Had some water?')`);
  await evaluate(`careCheck.hour(22)`); await until(`!document.querySelector('.care-prompts-prompt')`, "quiet hours hide an already visible prompt");
  await evaluate(`careCheck.hour(7)`); assert.equal(await evaluate(`!!document.querySelector('.care-prompts-prompt')`), false);
  await evaluate(`careCheck.hour(8)`); await until(`!!document.querySelector('.care-prompts-prompt')`);
  await click(".care-prompts-stop-mark"); await until(`!document.querySelector('.care-prompts-prompt') && !document.querySelector('.care-prompts-stop-mark')`);
  await evaluate(`careCheck.advance(120)`); assert.equal(await evaluate(`!!document.querySelector('.care-prompts-prompt')`), false, "stop stays stopped");
  assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem(careCheck.storageKey('example-person'))).enabled`), false);
  assert.equal(await evaluate(`careCheck.quiet('22:00', '08:00', 23) && !careCheck.quiet('22:00', '08:00', 12) && careCheck.quiet('09:00', '17:00', 12) && careCheck.quiet('08:00', '08:00', 12)`), true);
  await click(".care-prompts-opener"); await until(`!!document.querySelector('${shown}')`);
  await click(".care-prompts-water-button");
  await until(`document.querySelector('.care-prompts-water-top').textContent.includes('1 glass tapped today')`);
  await evaluate(`careCheck.advance(1440)`);
  await until(`document.querySelector('.care-prompts-water-top').textContent.includes('0 glasses tapped today')`, "water day rolls over while prompts are stopped");
  await page("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate(`(() => { const box = document.querySelector('${shown}').getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight; })()`), true, "phone settings fit");
  const mobile = await page("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(artifacts, "phone.png"), Buffer.from(mobile.data, "base64"));
  await page("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await until(`!document.querySelector('${shown}')`);
  assert.equal(await evaluate(`document.activeElement.className`), "care-prompts-opener");
  await evaluate(`careCheck.mount('another-person')`); await until(`document.querySelector('.care-prompts-opener').textContent.includes('Off')`);
  assert.ok(requests.every(url => url.startsWith(`http://127.0.0.1:${port}/`) || url.startsWith('data:')), "no external page requests");
  console.log(`PASS care-prompts: focused types, opt-in, example, frequency, dismiss/focus, quiet hours, stop, local water, provider, person separation, phone layout. Screenshots: ${artifacts}`);
} finally {
  const exited = new Promise(resolve => chrome.once("exit", resolve));
  if (chrome.exitCode === null) { chrome.kill("SIGTERM"); await exited; }
  chrome.stderr.destroy();
  chrome.stdio[3].destroy();
  chrome.stdio[4].destroy();
  await vite.close();
  await new Promise(resolve => server.close(resolve));
}
