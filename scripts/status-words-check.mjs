// Built shell, synthetic core messages and a real microphone tap, as in bricks-check. No shared checker changes.
// SHOTS=dir saves live words and their first-use hint at both viewport sizes in both color schemes (eight PNGs).
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

assert.equal(ready(), "", "status-words-check needs built UI and Chrome");
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const now = Date.now();
const thread = (id, title) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "" });
const thought = (id, text, thread_id) => ({ id, speaker: "you", text, point: text, thread_id, placed: true, unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: now, place_ms: 3000, decided: false });
const world = {
  threads: [thread("T1", "Garden layout"), thread("T2", "Picnic supplies")],
  thoughts: [thought("a", "Plant herbs beside the path", "T1"), thought("b", "Pack cups and a blanket", "T2")],
  active: "T1", active_by: { you: "T1" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [],
};
const short = "Keep the newest spoken words visible";
const long = Array.from({ length: 12 }, () => "The garden path winds between the herbs and the small trees").join(" ") + " beside the gate";
const draft = "A synthetic typed draft";

// Intersect real rectangles with the viewport and every clipping ancestor, including the status line itself.
function inspect({ hint = false, newest = false, typed = null }) {
  const failures = [];
  const check = (ok, message) => { if (!ok) failures.push(message); };
  const rect = (e) => e.getBoundingClientRect();
  const clipped = (e) => {
    const r = rect(e);
    let left = Math.max(0, r.left), top = Math.max(0, r.top), right = Math.min(innerWidth, r.right), bottom = Math.min(innerHeight, r.bottom);
    for (let p = e; p; p = p.parentElement) {
      const s = getComputedStyle(p), b = rect(p);
      if (s.display === "none" || s.visibility !== "visible" || Number(s.opacity) === 0) return { width: 0, height: 0 };
      if (p !== e) {
        if (/(hidden|clip|auto|scroll)/.test(s.overflowX)) { left = Math.max(left, b.left); right = Math.min(right, b.right); }
        if (/(hidden|clip|auto|scroll)/.test(s.overflowY)) { top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom); }
      }
    }
    return { width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  };
  const whole = (e) => { const r = rect(e), v = clipped(e); return r.width > 0 && r.height > 0 && v.width >= r.width - 0.5 && v.height >= r.height - 0.5; };
  const apart = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
  const transcript = document.querySelector(".tiny-transcript"), text = transcript?.querySelector(".tiny-transcript-text");
  const status = document.querySelector('[data-slot="status"]');
  check(document.querySelectorAll(".tiny-transcript").length === 1 && document.querySelectorAll(".tiny-transcript-text").length === 1, "exactly one transcript");
  check(!document.querySelector(".dock .live"), "no duplicate dock words (showsLiveWords)");
  check(transcript?.parentElement === status && status?.lastElementChild === transcript, "transcript is status slot's last child");
  if (transcript && text && status) {
    for (const e of [transcript, text]) {
      const r = rect(e), v = clipped(e);
      check(v.width > 0 && v.height > 0, `positive clipped visible area for ${e.className}: rect=${JSON.stringify(r.toJSON())}, visible=${JSON.stringify(v)}`);
    }
    check(getComputedStyle(transcript).gridRowStart === "1", "transcript explicitly occupies row 1");
    const state = status.querySelector(".shell-status-state"), history = status.querySelector(".shell-status-right");
    for (const e of [state, history]) {
      const v = clipped(e);
      check(v.width > 0 && v.height > 0, `${e.className} visible`);
      check(apart(rect(transcript), rect(e)) && apart(rect(text), rect(e)), `words clear of ${e.className}`);
    }
    check(rect(transcript).left >= rect(state).right && rect(transcript).right <= rect(history).left, "words occupy middle column");
    const h = rect(history);
    check(history.contains(document.elementFromPoint(h.left + h.width / 2, h.top + h.height / 2)), "History hit target uncovered");
    if (newest) {
      const b = rect(text), span = text.querySelector(".tiny-transcript-now"), range = document.createRange();
      range.selectNodeContents(span);
      const end = range.getBoundingClientRect(), visible = clipped(text);
      check(text.scrollWidth > text.clientWidth, "long turn really overflows");
      check(end.left >= b.left - 0.5 && end.right <= b.right + 0.5 && visible.height > 0, "newest three words entirely inside visible line");
      check(span.textContent === "beside the gate", "newest words receive emphasis");
    }
  }
  if (hint) {
    const tip = document.querySelector(".tiny-transcript-hint"), slider = tip?.querySelector('input[type="range"]');
    check(!!tip && !!slider, "first-use hint and slider present");
    if (tip && slider && text) {
      check(!status.contains(tip), "hint outside clipped status ancestor");
      check(whole(tip) && whole(slider) && whole(slider.labels[0]), "hint, Text size label and slider entirely visible");
      check(slider.labels[0].textContent.includes("Text size"), "slider visibly labelled Text size");
      check(Math.abs(rect(tip).bottom + 10 - rect(transcript).top) < 1, "hint anchored GAP above transcript's measured rectangle");
      for (const e of [tip, slider]) {
        const r = rect(e);
        for (const x of [r.left + 2, r.left + r.width / 2, r.right - 2]) {
          const hit = document.elementFromPoint(x, r.top + r.height / 2);
          check(e.contains(hit), `${e.className} hit-test at ${Math.round(x)}`);
        }
      }
    }
  } else check(!document.querySelector(".tiny-transcript-hint"), "dismissed hint stays absent");
  if (typed !== null) check(document.querySelector('[data-guide="composer"] textarea')?.value === typed, "typed draft never replaced");
  for (const e of [document.documentElement, document.body]) check(e.scrollWidth <= innerWidth, `${e.tagName} has no horizontal overflow`);
  check(!document.querySelector(".brick-broke"), "brick did not crash");
  check(window.__statusWordsErrors.length === 0, `browser errors: ${window.__statusWordsErrors.join("; ")}`);
  return failures;
}

for (const [width, height] of [[1440, 900], [390, 844]]) for (const scheme of ["light", "dark"]) {
  const where = `${width}x${height} ${scheme}`;
  const core = await standInCore(() => [{ type: "snapshot", world }]);
  let browser;
  try {
    browser = await openPage("about:blank", { width, height });
    const { page, evaluate, until } = browser;
    await page("Page.addScriptToEvaluateOnNewDocument", { source: `
      window.__statusWordsErrors = [];
      addEventListener("error", e => window.__statusWordsErrors.push(e.message || "resource failed: " + (e.target.src || e.target.href)), true);
      addEventListener("unhandledrejection", e => window.__statusWordsErrors.push(String(e.reason)));
      const originalError = console.error;
      console.error = (...args) => { window.__statusWordsErrors.push(args.map(String).join(" ")); originalError.apply(console, args); };
    ` });
    // mobile:true plus the app's viewport meta makes 390 a real CSS viewport, not Chrome's desktop minimum width.
    await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width === 390 });
    await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    const url = `http://127.0.0.1:${core.port}/?shell=2`;
    const settle = () => evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
    const load = async (target = url) => {
      await page("Page.navigate", { url: target });
      assert.ok(await until(`!!document.querySelector('[data-guide="composer"] textarea') && !!document.querySelector(".spine-frame") && document.querySelector("button.mic")?.disabled === false`, 10000), `${where}: populated map loads`);
      await evaluate("document.fonts.ready.then(() => true)");
      assert.deepEqual(await evaluate("[innerWidth, innerHeight]"), [width, height], `${where}: actual viewport`);
      await settle();
    };
    const click = async (selector, fraction = 0.5) => {
      const at = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}), r = e.getBoundingClientRect(); return { x: r.left + r.width * ${fraction}, y: r.top + r.height / 2 }; })()`);
      for (const type of ["mousePressed", "mouseReleased"]) await page("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
      await settle();
    };
    const key = async (key, code = key) => {
      await page("Input.dispatchKeyEvent", { type: "keyDown", key, code });
      await page("Input.dispatchKeyEvent", { type: "keyUp", key, code });
      await settle();
    };
    const startMic = async () => {
      // Same live-message pattern as bricks-check: a real tap and MediaStream, then partial messages over /ws.
      await evaluate(`navigator.mediaDevices.getUserMedia = async () => { const ctx = new AudioContext(), tone = ctx.createOscillator(), out = ctx.createMediaStreamDestination(); tone.connect(out); tone.start(); return out.stream; }`);
      await click("button.mic");
      assert.ok(await until(`document.querySelector("button.mic")?.getAttribute("aria-pressed") === "true"`, 5000), `${where}: microphone starts`);
      core.send({ type: "status", listening: true });
      assert.ok(await until('document.querySelector("button.mic")?.dataset.state === "listening"', 2000), `${where}: service listening`);
    };
    const say = async (text) => {
      core.send({ type: "partial", text });
      assert.ok(await until(`document.querySelector(".tiny-transcript-text")?.textContent === ${JSON.stringify(text)}`, 3000), `${where}: live message arrives`);
      await settle();
    };
    const check = async (options) => assert.deepEqual(await evaluate(`(${inspect.toString()})(${JSON.stringify(options)})`), [], where);
    const shot = async (name) => {
      if (!shots) return;
      const { data } = await page("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(shots, `status-words-${width}-${scheme}-${name}.png`), Buffer.from(data, "base64"));
    };
    await load();
    // Start each independent profile with the first-use hint, even if a browser has defaults saved elsewhere.
    await evaluate(`localStorage.removeItem("e2a2o.brick.tiny-transcript.hinted"); localStorage.removeItem("e2a2o.brick.tiny-transcript.size")`);
    await load();
    await startMic();
    await say(short);
    await check({ hint: true, typed: "" });
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".tiny-transcript-text")).fontSize'), "11px");
    await shot("hint");
    await click(".tiny-transcript-size", 0.8);
    const selected = Number(await evaluate('document.querySelector(".tiny-transcript-size").value'));
    assert.ok(selected > 11, `${where}: slider responds to pointer`);
    await key("ArrowLeft");
    const saved = selected - 1;
    assert.equal(await evaluate('localStorage.getItem("e2a2o.brick.tiny-transcript.size")'), String(saved), `${where}: keyboard slider saves size`);
    await check({ hint: true });
    // First-use text stays available after the handoff ends so the slider can still be tried.
    core.send({ type: "partial", text: "" });
    await sleep(1700);
    await check({ hint: true });
    if (scheme === "dark") await key("Escape");
    else await click('[data-guide="composer"] textarea');
    assert.ok(await until('!document.querySelector(".tiny-transcript")', 500), `${where}: dismiss releases held text`);
    assert.equal(await evaluate('localStorage.getItem("e2a2o.brick.tiny-transcript.hinted")'), "true");
    await load();
    await startMic();
    await say(long);
    await check({ newest: true, typed: "" });
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".tiny-transcript-text")).fontSize'), `${saved}px`, `${where}: saved size after reload`);
    await shot("live");
    // The status' clock and waiting count rerender it while the portal must remain its last child.
    await evaluate('window.__statusWordsNode = document.querySelector(".tiny-transcript"); window.__statusWordsState = document.querySelector(".shell-status-state").textContent');
    assert.ok(await until('document.querySelector(".shell-status-state").textContent !== window.__statusWordsState', 2500), `${where}: status clock rerender`);
    core.send({ type: "change", change: { type: "thought_added", thought: { ...thought("pending", "A synthetic waiting point", null), placed: false } } });
    assert.ok(await until('document.querySelector(".shell-status-right").textContent.includes("waiting")', 2000), `${where}: status waiting rerender`);
    assert.ok(await evaluate('window.__statusWordsNode === document.querySelector(".tiny-transcript")'), `${where}: existing portal retained`);
    await check({ newest: true });
    await click('[data-guide="composer"] textarea');
    await page("Input.insertText", { text: draft });
    await say(long);
    await check({ newest: true, typed: draft });
    // The waiting thought already arrived during that turn, so it needs no handoff. Start a fresh turn for timeout.
    core.send({ type: "partial", text: "" });
    assert.ok(await until('!document.querySelector(".tiny-transcript")', 500), `${where}: thought already received during turn`);
    await say(long);
    // A turn without a thought holds for the existing 1500 ms, then leaves by itself.
    core.send({ type: "partial", text: "" });
    await sleep(300);
    await check({ newest: true, typed: draft });
    assert.ok(await until('!document.querySelector(".tiny-transcript")', 1800), `${where}: no-thought handoff expires`);
    assert.equal(await evaluate(`document.querySelector('[data-guide="composer"] textarea').value`), draft);
    await say(short);
    core.send({ type: "partial", text: "" });
    await sleep(300);
    await check({ typed: draft });
    core.send({ type: "change", change: { type: "thought_added", thought: { ...thought("spoken", short, null), placed: false } } });
    assert.ok(await until('!document.querySelector(".tiny-transcript")', 500), `${where}: thought takes handoff immediately`);
    assert.equal(await evaluate(`document.querySelector('[data-guide="composer"] textarea').value`), draft);
    assert.deepEqual(await evaluate("window.__statusWordsErrors"), [], `${where}: browser errors`);

    // Without the bottom slot, the existing composer placement and its typing behavior remain in use.
    await evaluate(`localStorage.setItem("e2a2o.bricks", JSON.stringify({ "tiny-transcript": true }))`);
    await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/` });
    assert.ok(await until('!!document.querySelector(".composer textarea") && !!document.querySelector(".map .thread") && document.querySelector("button.mic")?.disabled === false', 10000), `${where}: classic composer loads`);
    await startMic();
    await say(long);
    assert.ok(await until('!!document.querySelector(".tiny-transcript-in-box")', 2000), `${where}: words use composer without bottom status`);
    assert.ok(await evaluate(`(() => {
      const r = document.querySelector(".tiny-transcript-text").getBoundingClientRect(), f = document.querySelector(".composer textarea").getBoundingClientRect();
      return r.width > 0 && r.height > 0 && Math.abs(r.left - f.left) < 1 && Math.abs(r.right - f.right) < 1 && Math.abs(r.top - f.top) < 1;
    })()`), `${where}: words cover composer's empty field`);
    await click(".composer textarea");
    await page("Input.insertText", { text: draft });
    await say(short);
    assert.ok(await until(`(() => {
      const r = document.querySelector(".tiny-transcript-text").getBoundingClientRect(), c = document.querySelector(".composer").getBoundingClientRect();
      return !!document.querySelector(".tiny-transcript-floating") && r.bottom <= c.top && document.querySelector(".composer textarea").value === ${JSON.stringify(draft)};
    })()`, 2000), `${where}: typing retains field and moves words above composer`);
    await evaluate(`(() => {
      const field = document.querySelector(".composer textarea");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, "");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    assert.ok(await until('!!document.querySelector(".tiny-transcript-in-box")', 2000), `${where}: clearing draft restores composer placement`);
    assert.deepEqual(await evaluate("window.__statusWordsErrors"), [], `${where}: classic browser errors`);
    assert.ok(await evaluate('[document.documentElement, document.body].every(e => e.scrollWidth <= innerWidth)'), `${where}: classic no horizontal overflow`);
  } finally {
    if (browser) await browser.close();
    core.close();
  }
}
console.log("status-words-check: ok");
