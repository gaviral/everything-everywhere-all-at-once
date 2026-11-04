// One focused browser check. Fixture modules are outside bricks/ and never ship in the app.
import assert from "node:assert/strict";
import { uiServer } from "./ui-server.mjs";
import { openPage } from "./headless.mjs";

let lateRequests = 0;
const server = await uiServer({
  appType: "spa",
  plugins: [{ name: "self-heal-fixture", configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (req.url?.includes("/checks/self-heal/missing-feature.tsx") || (req.url?.includes("/checks/self-heal/late-feature.tsx") && ++lateRequests === 1)) {
        res.statusCode = 404; res.end("Synthetic missing deployment chunk"); return;
      }
      next();
    });
  } }],
}, { port: 0 });
let browser;
const deadline = setTimeout(() => { console.error("REAL: self-heal check exceeded its deadline"); process.exitCode = 1; void browser?.close(); void server.close(); }, 90_000);
try {
  await server.listen();
  const address = `http://127.0.0.1:${server.httpServer.address().port}/checks/self-heal/preview.html`;
  // Preserve the throwaway profile: no permanent deletion and no existing user browser is touched.
  browser = await openPage("about:blank", { preserveProfile: true });
  const { page, evaluate, until } = browser;
  await page("Page.enable");
  await page("Page.addScriptToEvaluateOnNewDocument", { source: `
    sessionStorage.setItem('self-heal-check-visits', String(Number(sessionStorage.getItem('self-heal-check-visits') || 0) + 1));
    window.mediaRequests = 0;
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: () => { window.mediaRequests++; throw Error('Microphone forbidden'); } } });
  ` });
  const wait = async (expression, message) => assert.ok(await until(expression, 10000), `REAL: ${message}`);
  const click = async text => {
    const expression = `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)})`;
    await wait(`!!(${expression})`, `${text} button is visible`);
    await evaluate(`(${expression}).click()`);
  };
  const visit = async (suffix = "") => {
    await page("Page.navigate", { url: address + suffix });
    await wait(`document.querySelector('h1')?.textContent === 'Your page stays here'`, "page survives");
  };
  const reset = () => evaluate(`localStorage.clear(); sessionStorage.clear()`);
  await visit();
  await click("Healthy feature: 0");
  await click("Break one feature");
  await wait(`document.querySelector('.self-heal-notice')?.textContent.includes('Throwing example stopped.') && document.querySelector('output')?.textContent === '1 resource released'`, "render failure disables only the broken feature and releases its resources");
  await click("Healthy feature: 1");
  assert.ok(await evaluate(`!document.body.textContent.includes('Something broke.') && ![...document.querySelectorAll('button')].some(b => b.textContent === 'Break one feature')`));
  await click("Features");
  await evaluate(`document.querySelector('.self-heal-log summary').click()`);
  await wait(`document.querySelector('.self-heal-log pre')?.checkVisibility() && document.querySelector('.self-heal-log pre').textContent.includes('Synthetic render failure')`, "Features shows local error details");
  await visit();
  await wait(`!!document.querySelector('.self-heal-notice') && ![...document.querySelectorAll('button')].some(b => b.textContent === 'Break one feature')`, "quarantine overrides core defaults after reload");
  await click("Repair example source");
  await click("Turn it back on: Throwing example");
  await wait(`[...document.querySelectorAll('button')].some(b => b.textContent === 'Break one feature') && !document.querySelector('.self-heal-notice')`, "turning back on remounts a repaired feature");
  await click("Load lazy feature");
  await wait(`document.querySelector('.self-heal-notice')?.textContent.includes('Lazy example stopped.')`, "lazy rejection is isolated");
  await click("Healthy feature: 0");
  await click("Features");
  await evaluate(`document.querySelector('.self-heal-log summary').click()`);
  await wait(`document.querySelector('.self-heal-log pre')?.checkVisibility() && document.querySelector('.self-heal-log pre').textContent.includes('Synthetic lazy import rejection')`, "lazy error retained in Features");
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('e2a2o.self-heal')).log.length`), 2);
  await reset();
  await visit("?failure=chunk");
  await wait(`document.body.textContent.includes('Late feature loaded')`, "stale deployment chunk succeeds after reload");
  assert.equal(await evaluate(`sessionStorage.getItem('self-heal-check-visits')`), "2", "exactly one automatic reload");
  assert.equal(await evaluate(`localStorage.getItem('e2a2o.self-heal')`), null, "successful refresh never disables the feature");
  await reset();
  await visit("?failure=repeat");
  await wait(`document.querySelector('.self-heal-notice')?.textContent.includes('Lazy example stopped.')`, "repeated missing chunk stops instead of looping");
  assert.equal(await evaluate(`sessionStorage.getItem('self-heal-check-visits')`), "2");
  await click("Healthy feature: 0");
  await reset();
  await visit("?failure=draft");
  await click("Load lazy feature");
  await wait(`!!document.querySelector('.self-heal-notice')`, "missing chunk with unsaved draft is isolated without navigation");
  assert.equal(await evaluate(`document.querySelector('textarea').value`), "Keep this draft");
  assert.equal(await evaluate(`sessionStorage.getItem('self-heal-check-visits')`), "1");
  assert.equal(await evaluate(`window.mediaRequests`), 0);
  // Storage denial must not prevent the boundary, notice or retry from working.
  await reset();
  await visit();
  await evaluate(`Storage.prototype.setItem = () => { throw Error('Storage unavailable'); }`);
  await click("Break one feature");
  await wait(`!!document.querySelector('.self-heal-notice')`, "storage denial still isolates the crash");
  await click("Healthy feature: 0");
  await click("Repair example source");
  await click("Turn it back on: Throwing example");
  await wait(`[...document.querySelectorAll('button')].some(b => b.textContent === 'Break one feature')`, "storage denial still allows recovery");
  console.log("PASS self-heal: render/lazy isolation, cleanup, local log in Features, persistent core quarantine, retry, one chunk reload, loop guard, draft safety, storage denial; no microphone requests.");
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await server.close();
}
