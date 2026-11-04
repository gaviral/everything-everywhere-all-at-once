// Synthetic fixtures only; built real UI, existing core/Chrome helpers, no providers or new dependencies.
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

// openPage spawns Chrome with this environment. Never hand provider credentials to children.
for (const name of Object.keys(process.env)) if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(name)) delete process.env[name];
// This acceptance command always exercises Chrome, even in a shell that disables optional page checks.
process.env.PRECHECK_PAGES = "1";
assert.equal(ready(), "", "build the UI and install Chrome (CHROME override supported)");
const shots = mkdtempSync(join(tmpdir(), "f7-pictures-"));
const at = Date.now() - 60_000;
const topic = (id, picture = `/images/${id}-small.webp`) => ({ id, title: `Topic ${id}`, parent_id: null,
  status: "open", last_point: "A synthetic plan", touched_ms: at, tags: [], picture, dropped_by: "" });
const makeWorld = (threads = [topic("A"), topic("B"), topic("C"), topic("D"), topic("E")]) => ({
  active: threads[2]?.id ?? threads[0]?.id ?? null, active_by: {}, threads,
  thoughts: threads.map(t => ({ id: `point-${t.id}`, thread_id: t.id, speaker: "you", text: "A synthetic plan", point: "A synthetic plan",
    placed: true, unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: at, place_ms: 100, decided: false })),
  suggestions: [], actions: [], proposals: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {},
});
let world = makeWorld();
let online = true;
const core = await standInCore(() => online ? [{ type: "snapshot", world }] : null);
assert.ok(![4360, 4399].includes(core.port));
let webp, huge, medium;
let hold = false, failing = false, oversized = false, big = false;
const counters = new Map(), pending = new Map();
let live = 0, peak = 0;
const connections = new Set();
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://fixture").pathname;
  if (path.startsWith("/images/")) {
    counters.set(req.url, (counters.get(req.url) ?? 0) + 1);
    live++; peak = Math.max(peak, live);
    let ended = false;
    const done = () => { if (!ended) { ended = true; live--; pending.delete(req.url); } };
    res.on("close", done);
    const finish = () => {
      const fail = failing && !req.url.includes("?fetch=");
      res.writeHead(fail ? 503 : 200, { "content-type": "image/webp", "cache-control": fail ? "no-store" : "public, max-age=31536000, immutable" });
      res.end(fail ? "" : oversized && path.includes("huge") ? huge : big ? medium : webp);
    };
    if (hold && path.endsWith("-palace.webp")) pending.set(req.url, finish); else finish();
    return;
  }
  const upstream = request({ host: "127.0.0.1", port: core.port, path: req.url, method: req.method, headers: req.headers }, answer => {
    res.writeHead(answer.statusCode, answer.headers); answer.pipe(res);
  });
  upstream.on("error", () => { res.writeHead(502).end(); }); req.pipe(upstream);
});
server.on("connection", socket => { connections.add(socket); socket.on("close", () => connections.delete(socket)); });
server.on("upgrade", (req, socket, head) => {
  const upstream = connect(core.port, "127.0.0.1", () => {
    upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${req.rawHeaders.reduce((s, h, i) => s + h + (i % 2 ? "\r\n" : ": "), "")}\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream); upstream.pipe(socket);
  });
  upstream.on("error", () => socket.destroy()); socket.on("error", () => upstream.destroy());
  socket.on("close", () => upstream.destroy());
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
assert.ok(![4360, 4399].includes(port));
const url = `http://127.0.0.1:${port}/`;
let browser;
const probe = `
  localStorage.setItem('e2a2o.toured', '1');
  window.__errors = []; addEventListener('error', e => { if (!/^ResizeObserver loop/.test(e.message)) __errors.push(e.message); });
  addEventListener('unhandledrejection', e => __errors.push(String(e.reason)));
  window.__warm = []; window.__refs = []; window.__done = []; window.__busy = 0; window.__peak = 0;
  const NativeImage = window.Image;
  window.Image = new Proxy(NativeImage, { construct(Target, args) {
    const image = new Target(...args), decode = image.decode.bind(image);
    __refs.push(new WeakRef(image));
    image.decode = () => {
      const src = image.getAttribute('src'); __warm.push(src); __busy++; __peak = Math.max(__peak, __busy);
      return decode().then(value => { __done.push(src); return value; }).finally(() => __busy--);
    }; return image;
  }});
  window.__connection = new EventTarget(); __connection.saveData = false;
  Object.defineProperty(navigator, 'connection', { configurable: true, value: __connection });
  window.__hidden = false;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => __hidden ? 'hidden' : 'visible' });
  window.__first = [];
  new MutationObserver(() => {
    const tile = document.querySelector('.palace-tile[data-thread="C"]');
    if (tile && !window.__observedTile) {
      __observedTile = true;
      requestAnimationFrame(() => __first.push([...tile.querySelectorAll('img')].map(i => ({ src: i.getAttribute('src'),
        shown: i.classList.contains('is-shown'), instant: i.hasAttribute('data-instant'), complete: i.complete, width: i.naturalWidth }))));
    }
  }).observe(document, { childList: true, subtree: true });
`;
const key = async (key) => {
  const codes = { Enter: 13, Escape: 27, " ": 32, ArrowDown: 40, ArrowRight: 39 };
  const options = { key, windowsVirtualKeyCode: codes[key] ?? key.toUpperCase().charCodeAt(0), ...(key === " " ? { code: "Space", text: " " } : key === "Enter" ? { code: "Enter", text: "\r" } : {}) };
  await browser.page("Input.dispatchKeyEvent", { type: "keyDown", ...options });
  await browser.page("Input.dispatchKeyEvent", { type: "keyUp", ...options });
};
const ev = expression => browser.evaluate(expression);
const until = expression => browser.until(expression, 10_000);
const open = async ({ width = 1440, height = 900, extra = "" } = {}) => {
  browser = await openPage("about:blank", { width, height });
  await browser.page("Page.enable");
  await browser.page("Page.addScriptToEvaluateOnNewDocument", { source: probe + extra });
  // WebP fixtures are generated here from solid synthetic canvas pixels, never read from app stores.
  const fixture = async (w, h) => Buffer.from(await ev(`(() => { const c = document.createElement('canvas'); c.width=${w}; c.height=${h}; const x=c.getContext('2d'); x.fillStyle='#286d65'; x.fillRect(0,0,c.width,c.height); x.fillStyle='#efdca8'; x.fillRect(0,0,c.width/2,c.height/2); return c.toDataURL('image/webp').split(',')[1]; })()`), "base64");
  webp ??= await fixture(64, 64); huge ??= await fixture(3000, 2000); medium ??= await fixture(1200, 1000);
  await browser.page("Page.navigate", { url });
  assert.ok(await until(`!!document.querySelector('.spine-ready, .shell-welcome')`), "real UI ready");
};
const catalog = async () => { await ev(`document.querySelector('[data-guide="catalog"]').focus(); document.querySelector('[data-guide="catalog"]').click()`); assert.ok(await until(`!!document.querySelector('[data-row="warm-pictures"]')`)); };
const toggle = async (id = "warm-pictures") => {
  await ev(`document.querySelector('[data-row="${id}"] [role="switch"]').focus()`);
  await key(" ");
};
const warm = async () => { await catalog(); await toggle(); await key("Escape"); };
const showPictures = async () => {
  await catalog();
  if (await ev(`document.querySelector('[data-row="pictures"] [role="switch"]').getAttribute('aria-checked') === 'false'`)) await toggle("pictures");
  await ev(`document.querySelector('[data-row="pictures"] button:not([role="switch"])').click()`);
  await key("Escape");
  assert.ok(await until(`!!document.querySelector('.palace')`), "real Pictures view opens");
};
const gc = async () => {
  await browser.page("HeapProfiler.collectGarbage"); await sleep(50); await browser.page("HeapProfiler.collectGarbage");
  return ev(`__refs.flatMap(ref => { const i=ref.deref(); return i && i.complete && i.naturalWidth ? [{src:i.getAttribute('src'), bytes:i.naturalWidth*i.naturalHeight*4}] : []; })`);
};
const shot = async name => {
  const { data } = await browser.page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(join(shots, name + ".png"), Buffer.from(data, "base64"));
};
const clean = async () => {
  assert.deepEqual(await ev(`__errors`), [], "no page errors");
  assert.equal(await ev(`!!document.querySelector('.crash, .brick-broke')`), false);
  await browser.close(); browser = null;
  for (const finish of pending.values()) finish(); pending.clear();
  hold = false; failing = false; oversized = false; big = false;
  counters.clear(); peak = 0;
};
const snapshot = () => core.send({ type: "snapshot", world });
try {
  await open();
  await sleep(1200);
  assert.deepEqual(await ev(`__warm`), [], "fresh storage: no warm requests");
  assert.equal(await ev(`document.body.innerText.includes('Ready pictures')`), false, "no feature-specific first-screen UI");
  assert.equal(core.heard.some(m => /warm|picture/.test(m.type)), false, "no feature messages");
  await catalog();
  assert.equal(await ev(`document.querySelector('[data-row="warm-pictures"] [role="switch"]').getAttribute('aria-checked')`), "false");
  hold = true;
  await toggle();
  assert.equal(await ev(`document.activeElement.getAttribute('aria-checked')`), "true", "Space toggles native switch");
  assert.equal(await ev(`document.activeElement.matches(':focus-visible')`), true, "keyboard focus visible");
  await key("ArrowDown"); assert.equal(await ev(`document.activeElement.getAttribute('role')`), "switch", "arrow navigation");
  await key("Escape");
  assert.equal(await ev(`!!document.querySelector('.shell-rail')`), false, "Escape closes Features");
  assert.ok(await until(`document.activeElement?.tagName === 'BUTTON'`), "focus returns to opener");
  await sleep(600); assert.deepEqual(await ev(`__warm`), [], "full second of idle required");
  assert.ok(await until(`__warm.length >= 2`));
  assert.deepEqual(await ev(`__warm.slice(0,2)`), ["/images/C-small.webp", "/images/C-palace.webp"]);
  assert.ok(await until(`__warm.length === 4`)); // small copies can complete from baseline's memory cache
  assert.deepEqual(await ev(`__warm`), ["/images/C-small.webp", "/images/C-palace.webp", "/images/B-small.webp", "/images/B-palace.webp"]);
  assert.equal(pending.size, 2, "two controlled network requests in flight");
  pending.get("/images/B-palace.webp")();
  assert.ok(await until(`__warm.length === 6`));
  pending.get("/images/C-palace.webp")();
  for (let n=0; n<100 && !pending.has("/images/D-palace.webp"); n++) await sleep(20);
  pending.get("/images/D-palace.webp")(); hold = false;
  assert.ok(await until(`__done.length === 6 && __busy === 0`));
  assert.deepEqual(await ev(`__warm`), ["/images/C-small.webp", "/images/C-palace.webp", "/images/B-small.webp", "/images/B-palace.webp", "/images/D-small.webp", "/images/D-palace.webp"], "exact priority and unique URLs");
  assert.ok(await ev(`__peak <= 2`)); assert.ok(peak <= 2, "network concurrency <= 2");
  let retained = await gc();
  assert.equal(retained.length, 6, "six retained decoded Image objects");
  assert.ok(retained.reduce((sum, i) => sum+i.bytes, 0) <= 16*1024*1024);
  const before = counters.get("/images/C-small.webp");
  await showPictures();
  assert.ok(await until(`__first.length > 0`));
  const first = await ev(`__first[0]`);
  assert.equal(first.length, 2);
  assert.ok(first.every(i => i.shown && i.instant && i.complete && i.width > 0), "both warmed copies decoded at first painted tile");
  assert.equal(counters.get("/images/C-small.webp"), before, "first tile makes no new small request");
  assert.equal(counters.get("/images/C-palace.webp"), 1, "first tile makes no new Palace request");
  await shot("desktop-pictures");
  await key("ArrowRight"); assert.equal(await ev(`document.activeElement.dataset.thread`), "B", "Pictures keyboard navigation");
  await key("Enter"); assert.ok(await until(`!document.querySelector('.palace')`), "Enter opens a topic");
  await browser.page("Page.reload");
  assert.ok(await until(`__done.length === 6`), "enabled switch survives reload and warms again");
  await catalog(); assert.equal(await ev(`document.querySelector('[data-row="warm-pictures"] [role="switch"]').getAttribute('aria-checked')`), "true");
  await toggle(); await key("Escape");
  assert.equal((await gc()).length, 0, "off disposes retained references");
  const stopped = await ev(`__warm.length`);
  world = makeWorld(); world.threads[2].picture = "/images/replaced-small.webp"; snapshot();
  await sleep(1200); assert.equal(await ev(`__warm.length`), stopped, "off stops background work on new URLs");
  await key("c"); assert.ok(await until(`!!document.querySelector('[data-row="warm-pictures"]')`), "baseline Features shortcut still works");
  await key("Escape");
  await warm(); assert.ok(await until(`__done.includes('/images/replaced-palace.webp')`));
  await showPictures();
  assert.ok(await until(`!!document.querySelector('.palace-tile[data-thread="C"] img[src="/images/replaced-small.webp"].is-shown')`), "replacement source used");
  assert.equal(await ev(`!!document.querySelector('.palace-tile[data-thread="C"] img[src="/images/C-small.webp"]')`), false);
  await clean();

  console.log("f7-pictures-check: first-paint, replacement and off passed");
  // Gates in the real app, with synthetic visibility/saveData changes and no device input.
  for (const gate of ["hidden", "saveData", "partial", "disconnected"]) {
    console.log(`f7-pictures-check: gate ${gate}`);
    world = makeWorld();
    await open({ extra: gate === "hidden" ? "__hidden = true;" : gate === "saveData" ? "__connection.saveData = true;" : "" });
    if (gate === "partial") {
      // App correctly ignores partials without local capture. Supply a silent synthetic MediaStream, never a device.
      await ev(`navigator.mediaDevices.getUserMedia = async () => { window.__audio = new AudioContext(); return __audio.createMediaStreamDestination().stream; }`);
      const point = await ev(`(() => { const r=document.querySelector('button.mic').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      for (const type of ["mousePressed", "mouseReleased"]) await browser.page("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
      assert.ok(await until(`document.querySelector('button.mic').getAttribute('aria-pressed') === 'true'`), "synthetic capture starts");
      core.send({ type: "status", listening: true });
      core.send({ type: "partial", text: "Synthetic words" });
      assert.ok(await until(`document.querySelector('.voice-draft')?.textContent.includes('Synthetic words')`), "real partial accepted");
    }
    if (gate === "disconnected") { online = false; core.drop(); await sleep(150); }
    await warm(); await sleep(1300);
    assert.deepEqual(await ev(`__warm`), [], `${gate}: no warm attempts`);
    if (gate === "hidden") await ev(`__hidden=false; document.dispatchEvent(new Event('visibilitychange'))`);
    if (gate === "saveData") await ev(`__connection.saveData=false; __connection.dispatchEvent(new Event('change'))`);
    if (gate === "partial") core.send({ type: "partial", text: "" });
    if (gate === "disconnected") { online = true; }
    if (gate !== "disconnected") assert.ok(await until(`__done.length === 6`), `${gate}: resumes after fresh idle`);
    await clean(); online = true;
  }

  console.log("f7-pictures-check: gates passed");
  // Cancel obsolete in-flight work; delayed responses cannot restore the old URL.
  world = makeWorld(); hold = true; await open(); await warm();
  assert.ok(await until(`__warm.includes('/images/C-palace.webp')`));
  world = makeWorld(); world.threads[2].picture = "/images/new-small.webp"; snapshot();
  for (const finish of pending.values()) finish(); hold = false;
  assert.ok(await until(`__done.includes('/images/new-palace.webp')`));
  assert.ok(!(await gc()).some(i => i.src === "/images/C-palace.webp"), "late obsolete source not retained");
  await clean();

  // Off while network work is still pending: no later completion can restore a retained reference.
  world = makeWorld(); hold = true; await open(); await warm();
  assert.ok(await until(`__warm.length === 4`));
  await catalog(); await toggle(); await key("Escape");
  const offPending = await ev(`__warm.length`);
  for (const finish of pending.values()) finish(); hold = false;
  await sleep(1200);
  assert.equal(await ev(`__warm.length`), offPending, "off cancels pending scheduling");
  assert.equal((await gc()).length, 0, "late completions after off cannot re-enter cache");
  await clean();

  // Legacy single-copy pictures shared by topics are attempted exactly once.
  world = makeWorld([topic("B", "/images/shared.webp"), topic("C", `${url}images/shared.webp`), topic("D", `data:image/webp;base64,${webp.toString("base64")}`)]);
  await open(); await warm(); assert.ok(await until(`__done.length === 1`));
  assert.deepEqual(await ev(`__warm`), ["/images/shared.webp"], "deduplicate topics and unchanged Palace derivation");
  await clean();

  // Actual decoded dimensions exercise both the byte cap and an individually oversized image.
  for (const oversize of [false, true]) {
    world = makeWorld([topic("B"), topic(oversize ? "huge" : "C"), topic("D")]); world.active = world.threads[1].id;
    oversized = oversize; big = !oversize;
    await open(); await warm(); assert.ok(await until(`__done.length === 6 && __busy === 0`));
    retained = await gc();
    assert.ok(retained.length <= 6 && retained.reduce((s,i) => s+i.bytes, 0) <= 16*1024*1024, "real decoded RGBA ceiling");
    if (oversize) assert.ok(!retained.some(i => i.src.includes('huge')), "oversized copies discarded");
    else assert.equal(retained.length, 3, "LRU evicts oldest to keep 4.8 MB copies under 16 MiB");
    await clean();
  }

  // Failed warm never retries itself. Opening the real slot keeps its letter, then succeeds on its normal timed retry.
  world = makeWorld([topic("C")]); failing = true;
  await open(); await warm(); assert.ok(await until(`__warm.length === 2 && __busy === 0`));
  await sleep(2200); assert.equal(await ev(`__warm.length`), 2, "no automatic warm retries");
  await showPictures();
  assert.ok(await until(`document.querySelectorAll('.palace img').length === 0`), "failed visible slots keep letter fallback");
  assert.ok(await until(`document.querySelectorAll('.palace img.is-shown').length === 2`), "normal visible retry succeeds");
  assert.ok(counters.get('/images/C-small.webp?fetch=1') > 0 && counters.get('/images/C-palace.webp?fetch=1') > 0);
  await clean();

  // Phone/dark/reduced motion, 200% text, empty map and native keyboard controls in the shared Features host.
  world = makeWorld([]);
  await open({ width: 390, height: 844 });
  await browser.page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }, { name: "prefers-reduced-motion", value: "reduce" }] });
  await catalog(); await toggle();
  // Explicitly double essential text too: the shell uses px for some labels, which root font-size alone cannot test.
  await ev(`document.documentElement.style.fontSize='200%';
    for (const e of document.querySelectorAll('[data-row="warm-pictures"] .shell-catalog-name, [data-guide="composer"] textarea')) {
      e.style.fontSize = (parseFloat(getComputedStyle(e).fontSize) * 2) + 'px';
    }
    document.querySelector('[data-row="warm-pictures"]').scrollIntoView({block:'center'});`);
  assert.ok(await ev(`document.documentElement.scrollWidth <= innerWidth+1`), "phone 200% text has no horizontal page crop");
  assert.ok(await ev(`(() => { const r=document.querySelector('[data-row="warm-pictures"] [role="switch"]').getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight; })()`), "essential switch in view");
  await shot("phone-dark-200-text");
  await key("Escape"); await sleep(1100);
  assert.deepEqual(await ev(`__warm`), [], "empty map has no warm work");
  assert.ok(await ev(`(() => { const r=document.querySelector('[data-guide="composer"] textarea')?.getBoundingClientRect(); return r && r.width>0 && r.height>0 && r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight; })()`), "empty input remains in view at 200% text");
  assert.ok(await ev(`(() => { const e=document.querySelector('[data-guide="composer"] textarea'); const s=getComputedStyle(e); return e.clientHeight >= parseFloat(s.lineHeight)-1 && parseFloat(s.lineHeight) >= parseFloat(s.fontSize); })()`), "enlarged input text fits its line without vertical clipping");
  await shot("phone-empty");
  await clean();
  console.log(`f7-pictures-check: passed (real UI, order/concurrency, first paint, limits, cleanup/gates, retry, phone/empty). Screenshots: ${shots}`);
} catch (error) {
  if (browser) console.error("f7-pictures fixture state:", JSON.stringify({
    page: await ev(`({warm:__warm, done:__done, busy:__busy, errors:__errors})`).catch(() => null),
    pending: [...pending.keys()], requests: [...counters],
  }));
  throw error;
} finally {
  await browser?.close();
  for (const finish of pending.values()) finish();
  for (const socket of connections) socket.destroy();
  server.close(); core.close();
}
