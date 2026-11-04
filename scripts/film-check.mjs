// The real built page, synthetic map, no model calls. Every film API call gets a screenshot.
// Run after the UI build: node scripts/film-check.mjs (SHOTS overrides ui/dist/film-shots).
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP film-check: ${why}`); process.exit(3); }
const shots = process.env.SHOTS ?? new URL("../ui/dist/film-shots/", import.meta.url).pathname;
mkdirSync(shots, { recursive: true });
const now = Date.now();
const world = {
  threads: ["Garden plans", "Weekend picnic", "Train tickets"].map((title, i) => ({ id: `T${i}`, title, parent_id: null,
    status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "" })),
  thoughts: ["Plant tomatoes by the fence", "Bring the folding chairs", "Book the morning train"].map((text, i) => ({ id: `p${i}`,
    speaker: "you", text, point: text, thread_id: `T${i}`, placed: true, unclear: "", guess: "", heard: "", fixed: "",
    complete: true, at_ms: now, place_ms: 2000, decided: false })),
  active: "T0", active_by: { you: "T0" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true,
  recaps: [], notes: {}, proposals: [], topics: {},
};
const core = await standInCore(() => [{ type: "snapshot", world }]);
let browser;
try {
  browser = await openPage(`http://127.0.0.1:${core.port}/?film`);
  const { page, evaluate, until } = browser;
  const shot = async (name) => {
    const { data } = await page("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(shots, `${name}.png`), Buffer.from(data, "base64"));
  };
  const transcriptHint = async (filming, name) => {
    assert.equal(await evaluate("localStorage.getItem('e2a2o.brick.tiny-transcript.hinted')"), null, "first-use hint has not been dismissed");
    await evaluate(`navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext(), tone = ctx.createOscillator(), out = ctx.createMediaStreamDestination();
      tone.connect(out); tone.start(); return out.stream;
    }`);
    const tapMic = async () => {
      const at = await evaluate(`(() => { const r = document.querySelector('button.mic').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      for (const type of ["mousePressed", "mouseReleased"]) await page("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
    };
    await tapMic();
    assert.ok(await until("document.querySelector('button.mic')?.getAttribute('aria-pressed') === 'true'"), "mic starts capture");
    core.send({ type: "partial", text: "Plant tomatoes by the fence" });
    assert.ok(await until("document.querySelector('.tiny-transcript-text')?.textContent === 'Plant tomatoes by the fence' && !!document.querySelector('.tiny-transcript-hint input[type=range]')"), "live words mount the real first-use hint and slider");
    assert.ok(await until(`(() => {
      const hint = document.querySelector('.tiny-transcript-hint'), slider = hint.querySelector('input[type=range]');
      return ${filming ? "getComputedStyle(hint).display === 'none' && slider.getClientRects().length === 0" : "getComputedStyle(hint).display !== 'none' && getComputedStyle(hint).visibility === 'visible' && slider.getBoundingClientRect().width > 0"};
    })()`), filming ? "film hides the transcript hint and slider" : "outside film the transcript hint and slider remain visible");
    await shot(name);
    core.send({ type: "partial", text: "" });
    await tapMic();
    assert.ok(await until("document.querySelector('button.mic')?.getAttribute('aria-pressed') === 'false'"), "mic stops capture");
    // Restore first use for the next URL, after the stop click dismisses this hint.
    await evaluate("localStorage.removeItem('e2a2o.brick.tiny-transcript.hinted')");
  };
  const viewport = () => evaluate(`(() => {
    const m = document.querySelector('.react-flow__viewport').style.transform.match(/translate\\(([-\\d.]+)px,\\s*([-\\d.]+)px\\) scale\\(([-\\d.]+)\\)/);
    return { x: +m[1], y: +m[2], zoom: +m[3] };
  })()`);
  const near = (actual, expected) => {
    for (const k of ["x", "y", "zoom"]) assert.ok(Math.abs(actual[k] - expected[k]) < 0.02, `${k}: ${actual[k]} ≈ ${expected[k]}`);
  };
  assert.ok(await until("!!window.e2a2oFilm && !!document.querySelector('.react-flow__node[data-id=\"t:T2\"]')"));
  await evaluate("document.fonts.ready.then(() => true)");
  await sleep(600);
  assert.equal(await evaluate("!!document.querySelector('.tour')"), false, "film skips the first-run tour");
  assert.equal(await evaluate("document.documentElement.classList.contains('recording')"), true);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('button')).cursor"), "none");
  assert.equal(await evaluate("getComputedStyle(document.body).scrollbarWidth"), "none");
  await evaluate(`(() => {
    const tip = document.createElement('div'); tip.role = 'tooltip'; tip.textContent = 'Hidden tip'; tip.title = 'Native tip';
    document.body.append(tip);
    const dev = document.createElement('vite-error-overlay'); document.body.append(dev);
  })()`);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('[role=tooltip]')).display"), "none");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('vite-error-overlay')).display"), "none");
  assert.equal(await evaluate("document.querySelectorAll('[title]').length"), 0);
  await transcriptHint(true, "film-transcript-hint-hidden");

  // Freeze only Date and rAF after the page lays out. A batch advances one frame with no wall-clock wait.
  await evaluate(`(() => {
    window.filmTime = Date.now(); window.filmFrames = new Map(); window.filmFrameId = 0;
    Date.now = () => window.filmTime;
    window.requestAnimationFrame = cb => { const id = ++window.filmFrameId; window.filmFrames.set(id, cb); return id; };
    window.cancelAnimationFrame = id => window.filmFrames.delete(id);
    window.filmStep = ms => { window.filmTime += ms; const batch = [...window.filmFrames.values()]; window.filmFrames.clear(); batch.forEach(cb => cb(window.filmTime)); };
  })()`);
  const step = (ms) => evaluate(`filmStep(${ms})`);
  const from = await viewport();
  await evaluate("window.filmDone = null; e2a2oFilm.camera({x:300,y:250,zoom:1.2},{duration:1000,ease:'linear'}).then(v => filmDone = v); true");
  await step(500);
  near(await viewport(), { x: (from.x + 300) / 2, y: (from.y + 250) / 2, zoom: (from.zoom + 1.2) / 2 });
  await shot("camera-midpoint");
  await step(500);
  near(await viewport(), { x: 300, y: 250, zoom: 1.2 });
  assert.equal(await evaluate("filmDone"), true);
  await shot("camera-coordinates");
  core.send({ type: "change", change: { type: "active_changed", thread_id: "T2", speaker: "you" } });
  await sleep(100);
  await step(5000);
  near(await viewport(), { x: 300, y: 250, zoom: 1.2 });
  await evaluate("e2a2oFilm.camera({node:'t:T2',zoom:1.4},{duration:800,ease:t=>t*t}); true");
  await step(800);
  assert.equal((await viewport()).zoom, 1.4);
  assert.ok(await evaluate(`(() => { const r = document.querySelector('.react-flow__node[data-id="t:T2"]').getBoundingClientRect(); return r.left >= 0 && r.right < innerWidth && r.top > 0 && r.bottom < innerHeight; })()`));
  await shot("camera-node");
  await evaluate("e2a2oFilm.cursor({x:720,y:410}); true");
  assert.equal(await evaluate("document.querySelector('.film-pointer').hidden"), false);
  await shot("cursor");
  await evaluate("e2a2oFilm.cursor({x:720,y:410,press:true}); true");
  await step(150);
  assert.equal(await evaluate("document.querySelector('.film-ripple').hidden"), false);
  await shot("cursor-press");
  await step(350);
  assert.equal(await evaluate("document.querySelector('.film-ripple').hidden"), true);
  await evaluate("e2a2oFilm.caption('Keep your place.'); true");
  assert.equal(await evaluate("document.querySelector('.film-caption').textContent"), "Keep your place.");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.film-caption')).fontFamily === getComputedStyle(document.body).fontFamily"), true);
  await shot("caption");
  await evaluate("e2a2oFilm.camera({x:300,y:250,zoom:1.2},{duration:0}); true");
  await evaluate("e2a2oFilm.camera(null); true");
  await sleep(650);
  assert.notDeepEqual(await viewport(), { x: 300, y: 250, zoom: 1.2 }, "camera(null) resumes following");
  await shot("camera-release");
  // clear() cancels motion as well as overlays, then permits automatic following again.
  await evaluate("e2a2oFilm.camera({x:-5000,y:-5000,zoom:1},{duration:0}); window.filmCancelled = null; e2a2oFilm.camera({x:0,y:0,zoom:2},{duration:1000}).then(v => filmCancelled = v); window.filmTime += 5000; e2a2oFilm.clear(); true");
  assert.equal(await evaluate("[...document.querySelector('.film-layer').children].every(e=>e.hidden)"), true);
  assert.equal(await evaluate("filmCancelled"), false, "clear cancels the pending camera animation");
  await step(5000);
  await sleep(700);
  assert.notDeepEqual(await viewport(), { x: -5000, y: -5000, zoom: 1 }, "clear releases automatic camera");
  await shot("clear");

  for (const query of ["", "?recording"]) {
    await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/${query}` });
    assert.ok(await until("document.readyState === 'complete' && !!document.querySelector('.react-flow__viewport')"));
    assert.equal(await evaluate("typeof window.e2a2oFilm"), "undefined");
    assert.equal(await evaluate("document.querySelector('.film-layer')"), null);
    assert.equal(await evaluate("document.documentElement.classList.contains('film')"), false);
    assert.notEqual(await evaluate("getComputedStyle(document.body).cursor"), "none");
    assert.equal(await evaluate("document.documentElement.classList.contains('recording')"), query === "?recording");
    await shot(query ? "recording-unchanged" : "normal-unchanged");
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Skip tour')?.click()");
    await transcriptHint(false, query ? "recording-transcript-hint" : "normal-transcript-hint");
  }
  console.log("PASS film: virtual-clock camera/hold/release, pointer/ripple, caption, clear, opt-in, live transcript hint isolation; 13 screenshots saved");
} finally {
  await browser?.close();
  core.close();
}
