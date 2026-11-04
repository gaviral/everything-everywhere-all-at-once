// Synthetic, real-app acceptance: no core process, provider, account or saved app data.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uiServer } from "./ui-server.mjs";
import { openPage, ready, sleep, standInCore } from "./headless.mjs";

// Chrome is the only spawned process (owned and reaped by headless.mjs).
for (const name of Object.keys(process.env)) {
  if (/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)|^(?:META|OPENAI|ANTHROPIC|AWS|AZURE|GOOGLE|MUSE|GROQ|PROVIDER)_/i.test(name)) delete process.env[name];
}
assert.equal(ready(), "", "built UI and installed Chrome are required");
const shots = mkdtempSync(join(tmpdir(), "f7-reviewed-"));
const at = 1_800_000_000_000;
const job = (id, status = "done", extra = {}) => ({ type: "job", by: "Synthetic helper", id, at_ms: at, status, title: `Synthetic ${id}`, result: "Synthetic result", demo: false, ...extra });

// Rules supplement the real page: every identity field, bounds, prune and immutable input.
const server = await uiServer({ envDir: false });
try {
  const r = await server.ssrLoadModule("/src/bricks/result-review/rules.ts");
  const original = Object.freeze(job("version"));
  const jobs = Object.freeze([original]);
  const mark = r.toggleReview([], original);
  assert.ok(r.isReviewed({ ...original }, mark), "identical new props preserve a mark");
  for (const field of ["by", "id", "at_ms", "status", "title", "result", "demo"]) {
    const changed = { ...original, [field]: field === "at_ms" ? at + 1 : field === "demo" ? true : field === "status" ? "running" : "different" };
    assert.equal(r.isReviewed(changed, mark), false, `${field} defines an exact version`);
  }
  assert.equal(r.pruneMarks(mark, jobs), mark);
  assert.deepEqual(r.pruneMarks(mark, []), []);
  assert.deepEqual(r.toggleReview(mark, original), []);
  let marks = [];
  for (let i = 0; i < 65; i++) marks = r.toggleReview(marks, job(String(i)));
  assert.equal(marks.length, 60);
  assert.equal(r.isReviewed(job("0"), marks), false);
  assert.deepEqual(jobs, [original], "selectors never mutate source jobs");
} finally { await server.close(); }

const world = { threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], ai: [] };
const initial = () => [job("running", "running"), job("waiting", "waiting"), job("failed", "failed"), job("older", "done", { result: undefined, at_ms: at - 1000 }), job("newer", "done", { demo: true })];
let replay = initial();
let online = true;
const core = await standInCore(() => online ? [{ type: "snapshot", world }, ...replay] : null);
let browser;
const timer = setTimeout(() => { console.error("f7-reviewed-check: timeout"); process.exit(1); }, 150_000);
const selector = '[data-row="result-review"] [role="switch"]';
try {
  for (const width of [1440, 390]) {
    replay = initial();
    browser = await openPage("about:blank", { width, height: width === 390 ? 844 : 900 });
    const { page, evaluate, until } = browser;
    await page("Page.enable");
    await page("Network.enable");
    const requests = [];
    browser.on("Network.requestWillBeSent", ({ request }) => requests.push(request.url));
    await page("Page.addScriptToEvaluateOnNewDocument", { source: `
      localStorage.setItem('e2a2o.toured', '1');
      window.reviewErrors = []; window.reviewSends = []; window.reviewLastHeartbeat = performance.now();
      addEventListener('error', e => reviewErrors.push(e.message));
      addEventListener('unhandledrejection', e => reviewErrors.push(String(e.reason)));
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = function(data) {
        reviewSends.push(data);
        if (typeof data === 'string' && JSON.parse(data).type === 'heartbeat') reviewLastHeartbeat = performance.now();
        return send.call(this, data);
      };
    ` });
    const check = async (expression, label) => assert.ok(await until(expression, 8000), `${width}: ${label}`);
    const click = async (css) => evaluate(`document.querySelector(${JSON.stringify(css)}).click()`);
    const key = async (key, code, windowsVirtualKeyCode) => {
      for (const type of ["keyDown", "keyUp"]) await page("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode, ...(key === "Enter" && type === "keyDown" ? { text: "\r" } : {}) });
    };
    const features = async () => {
      if (!await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Features')).click()`);
      await check(`!!document.querySelector(${JSON.stringify(selector)})`, "Features switch exists");
    };
    const closeFeatures = async () => {
      await evaluate(`document.querySelector('.shell-rail-close').click()`);
      await check(`!document.querySelector('.shell-rail')`, "Features closes");
    };
    const counts = (needs, reviewed) => check(`document.querySelector('.result-review-tabs').textContent === ${JSON.stringify(`Needs review (${needs})Reviewed (${reviewed})`)}`, `counts ${needs}/${reviewed}`);
    const shot = async (name) => {
      await evaluate("document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))");
      await sleep(150);
      const { data } = await page("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(shots, `${name}-${width}.png`), Buffer.from(data, "base64"));
    };
    // Read the committed brick props, without adding a test API to production. The DOM's fiber pointer can
    // name the previous alternate after a render; start at the root's current tree before locating this element.
    const sourceJobs = `(() => {
      const el = document.querySelector('.result-review');
      let root = el[Object.keys(el).find(k => k.startsWith('__reactFiber$'))];
      while (root.return) root = root.return;
      const pending = [root.stateNode.current];
      let current;
      while (pending.length) {
        const fiber = pending.pop();
        if (fiber.stateNode === el) { current = fiber; break; }
        if (fiber.sibling) pending.push(fiber.sibling);
        if (fiber.child) pending.push(fiber.child);
      }
      while (current && !current.memoizedProps?.map) current = current.return;
      if (!current) throw new Error('Result review has no committed map props');
      return current.memoizedProps.map.jobs;
    })()`;
    const quietAction = async (action) => {
      // Measure between the core's existing 5s heartbeats; suppress no sends.
      if (await evaluate('performance.now() - reviewLastHeartbeat > 4000')) await check('performance.now() - reviewLastHeartbeat < 1000', 'heartbeat measurement window');
      const expectedJobs = replay.map(j => [j.id, j.status, j.result ?? null, j.at_ms]).sort((a, b) => a[0].localeCompare(b[0]));
      await check(`JSON.stringify((${sourceJobs}).map(j => [j.id, j.status, j.result ?? null, j.at_ms]).sort((a, b) => a[0].localeCompare(b[0]))) === ${JSON.stringify(JSON.stringify(expectedJobs))}`, "all synthetic job frames arrived before measuring the action");
      const beforeJobs = await evaluate(sourceJobs);
      await evaluate("reviewSends.length = 0");
      await action();
      await sleep(100);
      assert.deepEqual(await evaluate("reviewSends"), [], `${width}: review action sends zero socket messages`);
      assert.deepEqual(await evaluate(sourceJobs), beforeJobs, `${width}: review action leaves map.jobs unchanged`);
    };
    await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/` });
    await check(`!!document.querySelector('[data-guide="composer"] textarea')`, "baseline input exists");
    await sleep(350);
    assert.equal(await evaluate(`!!document.querySelector('.result-review')`), false, "fresh storage has no feature UI");
    assert.equal(requests.some(url => /result-review/i.test(url)), false, "off loads no feature code or warm request");
    assert.ok(requests.every(url => url.startsWith(`http://127.0.0.1:${core.port}/`) || url.startsWith(`ws://127.0.0.1:${core.port}/`) || url.startsWith("data:")), "only synthetic local server requests");
    assert.equal(core.heard.some(m => /review/.test(JSON.stringify(m))), false, "off sends no feature message");
    await features();
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-checked')`), "false");
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await key(" ", "Space", 32);
    await check(`!!document.querySelector('.result-review')`, "keyboard enables card");
    await closeFeatures();
    assert.equal(await evaluate(`!!document.querySelector('[data-brick="work-spine"]')`), false, "independent of Work spine");
    await page("Page.reload");
    await check(`!!document.querySelector('.result-review-opener')`, "enabled switch persists on reload");
    await features();
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-checked')`), "true");
    await closeFeatures();
    await quietAction(() => click('.result-review-opener'));
    await counts(2, 0);
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.result-review-row')].map(e => e.dataset.resultId)`), ["newer", "older"], "only done, newest first");
    assert.equal(await evaluate(`document.querySelectorAll('.result-review-meta strong').length`), 1);
    assert.equal(await evaluate(`document.querySelector('.result-review-meta strong').textContent`), "Simulated");
    assert.ok(await evaluate(`document.querySelector('[data-result-id="older"]').textContent.includes('No result supplied')`));
    await quietAction(() => click('[data-result-id="newer"] summary'));
    await counts(2, 0);
    await quietAction(() => evaluate(`document.querySelector('.result-review-body').scrollTop = 150`));
    await sleep(1200);
    await counts(2, 0);
    await quietAction(async () => {
      await evaluate(`document.querySelector('[data-result-id="newer"] > button').focus()`);
      await key("Enter", "Enter", 13);
    });
    await counts(1, 1);
    core.send({ ...replay[4] });
    await sleep(150);
    await counts(1, 1);
    await quietAction(() => click('.result-review-tabs [role="tab"]:nth-child(2)'));
    assert.equal(await evaluate(`document.querySelector('.result-review-row').dataset.resultId`), "newer");
    await quietAction(() => click('.result-review-row > button'));
    await counts(2, 0);
    await quietAction(async () => {
      await evaluate(`document.querySelector('.result-review-tabs [role="tab"]:nth-child(2)').focus()`);
      await key("ArrowLeft", "ArrowLeft", 37);
    });
    await quietAction(() => click('[data-result-id="newer"] > button'));
    await counts(1, 1);
    replay[4] = job("newer", "done", { demo: true, result: "Synthetic revised result", at_ms: at + 2000 });
    core.send(replay[4]);
    await counts(2, 0);
    assert.ok(await evaluate(`document.querySelector('[data-result-id="newer"]').textContent.includes('Synthetic revised result')`));
    await quietAction(() => click('[data-result-id="newer"] > button'));
    await counts(1, 1);
    // Every reviewed mark clears on a real socket drop, before replay arrives.
    online = false; core.drop();
    await counts(2, 0);
    assert.ok(await evaluate(`document.querySelector('.result-review-row > button').disabled`), "disconnected results cannot be marked");
    online = true;
    await check(`!!document.querySelector('.result-review-row > button') && !document.querySelector('.result-review-row > button').disabled`, "core reconnects before another mark");
    await quietAction(() => click('[data-result-id="newer"] > button'));
    await counts(1, 1);
    await page("Page.reload");
    await check(`!!document.querySelector('.result-review-opener')`, "card returns after reload");
    await quietAction(() => click('.result-review-opener'));
    await counts(2, 0);
    await quietAction(() => click('[data-result-id="newer"] summary'));
    await shot("desktop-phone-light");
    await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }, { name: "prefers-reduced-motion", value: "reduce" }] });
    await evaluate(`document.querySelector('.result-review').style.fontSize = '28px'; document.querySelector('.result-review-body').scrollTop = 0`);
    const fits = `(() => { const elements = [...document.querySelectorAll('.result-review button, .result-review summary, [data-guide="composer"] textarea')]; return document.documentElement.scrollWidth <= innerWidth && elements.every(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && e.scrollWidth <= e.clientWidth + 2; }); })()`;
    assert.ok(await evaluate(fits), "200% card text keeps essential controls within width");
    assert.ok(await evaluate(`(() => { const r = document.querySelector('[data-guide="composer"] textarea').getBoundingClientRect(); const card = document.querySelector('.result-review').getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= card.bottom && card.top >= 0; })()`), "card leaves input visible");
    await shot("dark-reduced-200text");
    await evaluate(`document.querySelector('[data-result-id="newer"] > button').focus()`);
    assert.ok(await evaluate(`(() => { const r = document.querySelector('[data-result-id="newer"] > button').getBoundingClientRect(), body = document.querySelector('.result-review-body').getBoundingClientRect(); return r.top >= body.top && r.bottom <= body.bottom; })()`), "review action scrolls fully into view at 200% text");
    await shot("dark-200text-action");
    await quietAction(async () => {
      await evaluate(`document.querySelector('.result-review summary').focus()`);
      await key("Escape", "Escape", 27);
    });
    assert.ok(await until(`document.activeElement === document.querySelector('.result-review-opener')`), "Escape returns focus");
    assert.equal(await evaluate(`!!document.querySelector('.result-review-body')`), false);
    await quietAction(() => click('.result-review-opener'));
    await quietAction(() => click('.result-review-top button'));
    assert.ok(await until(`document.activeElement === document.querySelector('.result-review-opener')`), "Close returns focus");
    // Replay an empty jobs list through a real disconnect; no invented rows.
    replay = []; online = false; core.drop();
    await sleep(200); online = true;
    await check(`(${sourceJobs}).length === 0`, "reconnected empty snapshot arrived before measuring an action");
    await evaluate(`document.querySelector('.result-review').style.fontSize = '14px'`);
    await quietAction(() => click('.result-review-opener'));
    await check(`document.querySelector('.result-review-rows').textContent === 'No finished helper results here yet.'`, "honest empty state");
    assert.equal(await evaluate(`document.querySelectorAll('.result-review-row').length`), 0);
    await shot("empty");
    await features();
    await click(selector);
    await check(`!document.querySelector('.result-review')`, "disable unmounts feature");
    await closeFeatures();
    core.send(job("disabled"));
    await sleep(150);
    assert.equal(await evaluate(`!!document.querySelector('.result-review')`), false, "job arrivals do not reactivate feature");
    await evaluate(`document.querySelector('[data-guide="composer"] textarea').focus()`);
    await page("Input.insertText", { text: "Synthetic baseline thought" });
    assert.equal(await evaluate(`document.querySelector('[data-guide="composer"] textarea').value`), "Synthetic baseline thought", "baseline typing unchanged");
    const heard = core.heard.length;
    await key("Enter", "Enter", 13);
    assert.ok(core.heard.slice(heard).some(m => m.type === "text" && m.text === "Synthetic baseline thought"), "baseline explicit send still works");
    assert.deepEqual(await evaluate("reviewErrors"), []);
    await page("Page.reload");
    await check(`!!document.querySelector('[data-guide="composer"] textarea')`, "baseline reloads");
    assert.equal(await evaluate(`!!document.querySelector('.result-review')`), false, "disabled switch persists");
    await browser.close(); browser = null;
  }
  console.log(`PASS f7-reviewed: exact versions, 60-mark bound, real UI gate/persistence, done-only order, simulated/empty, explicit marks, no review sends or job mutation, identical/update/reset, keyboard/focus, 1440/390 light/dark/reduced motion/200% text. Synthetic screenshots: ${shots}`);
} finally {
  clearTimeout(timer);
  await browser?.close();
  core.close();
}
