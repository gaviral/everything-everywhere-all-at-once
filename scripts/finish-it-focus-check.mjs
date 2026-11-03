// Real browser input against the built UI and a synthetic, already-dropped sample map. Product pause timing stays
// intact. SHOTS=dir saves the visible unfinished card and the focused composer, at both sizes in both themes.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP finish-it-focus-check: ${why}`); process.exit(3); }
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const now = Date.now() - 10_000;
const quote = "I should choose the picnic spot before—";
const thread = (id, title, extra = {}) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: now,
  tags: [], picture: null, dropped_by: "", ...extra });
const thought = (id, text, thread_id, extra = {}) => ({ id, speaker: "you", text, point: text, thread_id, placed: true,
  unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: now, place_ms: 2000, decided: false, ...extra });
// Original sample words, with the active topic elsewhere and the snapshot already reflecting the dropped state.
const world = {
  threads: [thread("T1", "Balcony herbs"), thread("T2", "Riverside picnic", { status: "dropped", dropped_by: "you" })],
  thoughts: [thought("p1", "Plant mint in its own pot", "T1"), thought("p2", quote, "T2", { complete: false })],
  active: "T1", active_by: { you: "T1" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true,
  recaps: [], notes: {}, proposals: [],
  // Finish it must actually move the Canvas camera to reach the unfinished words.
  positions: { p2: { x: 2200, y: 1800, by: "you", at_ms: now } },
};
let shown = world;
const core = await standInCore(() => [{ type: "snapshot", world: shown }], {
  onMessage: (message) => {
    if (message.type !== "focus") return;
    shown = { ...shown, active: message.thread_id, active_by: { you: message.thread_id } };
    core.send({ type: "change", change: { type: "active_changed", thread_id: message.thread_id, speaker: "you" } });
  },
});
const composer = '#type-a-thought';
const finish = '.pullback-actions button:first-child';
function visiblePoint(id) {
  const canvas = document.querySelector('.spine-frame');
  const el = document.querySelector(canvas ? `.react-flow__node[data-id="p:${id}"] .spine-text` : `#point-${id}`);
  if (!el?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  const r = el.getBoundingClientRect();
  const frame = canvas?.getBoundingClientRect() ?? { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
  const dock = document.querySelector('.dock')?.getBoundingClientRect();
  const tools = document.querySelector('.map-tools')?.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return r.width > 0 && r.height > 0 && r.left >= Math.max(0, frame.left) - 1 && r.right <= Math.min(innerWidth, frame.right) + 1
    && r.top >= Math.max(0, frame.top, tools?.bottom ?? 0) - 1 && r.bottom <= Math.min(innerHeight, frame.bottom, dock?.top ?? innerHeight) + 1
    && !!hit && el.contains(hit);
}
let browser;
const timeout = setTimeout(() => { console.error("finish-it-focus-check: timed out"); process.exit(1); }, 180_000);
try {
  for (const [width, height] of [[1440, 900], [390, 844]]) for (const scheme of ["light", "dark"]) {
    const label = `${width}x${height}/${scheme}`;
    browser = await openPage("about:blank", { width, height });
    const { page, evaluate, until } = browser;
    // Copy the guide-held browser setup: Chrome accepts but ignores new-document seeding before Page.enable.
    await page("Page.enable");
    await page("Page.addScriptToEvaluateOnNewDocument", { source: `
      localStorage.setItem("e2a2o.toured", "1");
      localStorage.setItem("e2a2o.features", JSON.stringify({ cards: true, pictures: true }));
    ` });
    await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    const check = async (expression, reason, ms = 8000) => assert.ok(await until(expression, ms), `${label}: ${reason}`);
    const key = async (key, code = key, vk = 13) => {
      await page("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, ...(key === "Enter" ? { text: "\r" } : {}) });
      await page("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
    };
    const click = async (selector) => {
      const locate = `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        el.scrollIntoView({ block: "nearest", behavior: "instant" });
        const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || r.width <= 0 || r.height <= 0
          || r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight || !el.contains(document.elementFromPoint(x, y))) return null;
        return { x, y };
      })()`;
      await check(`!!${locate}`, `${selector} takes pointer input`);
      const at = await evaluate(locate);
      for (const type of ["mousePressed", "mouseReleased"]) await page("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
    };
    const texts = () => core.heard.filter((m) => m.type === "text");
    const focus = async () => {
      await check(`document.activeElement === document.querySelector('${composer}')`, "composer has DOM focus");
      // Wait beyond the navigation/camera animation: focus must survive the view settling.
      await sleep(700);
      assert.equal(await evaluate(`document.activeElement === document.querySelector('${composer}')`), true, `${label}: settled composer focus`);
    };
    const geometry = async () => {
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `${label}: no horizontal overflow`);
      assert.equal(await evaluate(`(() => {
        const el = document.querySelector('${composer}'), r = el.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight &&
          el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      })()`), true, `${label}: composer clear of shell controls`);
    };
    const shot = async (scene) => {
      await geometry();
      if (!shots) return;
      const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const png = Buffer.from(data, "base64");
      assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [width, height]);
      writeFileSync(join(shots, `finish-it-${scene}-${width}x${height}-${scheme}.png`), png);
    };
    const load = async (query = "?shell=2") => {
      shown = world;
      // Each scene starts a fresh sample map; phone-walk-check covers persistence across reloads.
      await evaluate(`if (location.protocol === "http:") Object.keys(localStorage).filter(key => key.startsWith("e2a2o.unfinished:")).forEach(key => localStorage.removeItem(key))`);
      await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/${query}` });
      await check(`!!document.querySelector('${composer}') && !document.querySelector('.tour-tip')`, "loaded with first-use hints dismissed");
      await evaluate('document.fonts.ready.then(() => true)');
      // Wait for the real 2.5 s pause/card condition; do not alter clocks or product constants.
      await check('!!document.querySelector(".pullback")', "real unfinished card appears");
      assert.equal(await evaluate('document.querySelector(".pullback-title b").textContent'), "Riverside picnic");
      assert.equal(await evaluate('document.querySelector(".pullback-quote").textContent'), `“${quote}”`);
      assert.equal(await evaluate(`document.querySelector('${composer}').value`), "");
    };
    const openView = async (id) => {
      await click('[data-guide="catalog"]');
      await check(`!!document.querySelector('[data-row="${id}"] .shell-link')`, `${id} in Catalog`);
      await click(`[data-row="${id}"] .shell-link`);
      await check(`document.documentElement.dataset.view === '${id === "pictures" ? "palace" : id}' && !document.querySelector('.shell-rail')`, `${id} opened`);
    };
    const draft = async (text) => { await click(composer); await page("Input.insertText", { text }); };
    const returned = async (before, existing = "", scene = "canvas") => {
      await check('!document.querySelector(".pullback")', "offered card dismissed");
      await focus();
      await check(`(${visiblePoint.toString()})("p2")`, "unfinished words visibly reached and clear of controls");
      assert.equal(await evaluate(`document.activeElement === document.querySelector('${composer}')`), true, `${label}: focus survives navigation`);
      assert.equal(await evaluate(`document.querySelector('${composer}').value`), existing, `${label}: draft preserved without quoted words`);
      assert.equal(texts().length, before, `${label}: Finish it sends nothing`);
      assert.equal(shown.active_by.you, "T2", `${label}: correct thread focused in core`);
      const addition = "Continue with a shady spot.";
      await page("Input.insertText", { text: addition });
      const expected = existing + addition;
      assert.equal(await evaluate(`document.querySelector('${composer}').value`), expected, `${label}: immediate typing reaches composer`);
      await shot(`${scene}-after`);
      await key("Enter");
      for (let n = 0; n < 40 && texts().length === before; n++) await sleep(25);
      await sleep(150);
      assert.deepEqual(texts().slice(before), [{ type: "text", text: expected }], `${label}: exactly one outgoing text on explicit submission`);
      assert.equal(await evaluate(`document.querySelector('${composer}').value`), "", `${label}: submitted draft cleared`);
    };

    // The populated Canvas, empty composer, and real pointer Finish it in all four viewport/theme combinations.
    await load();
    await check(`!!document.querySelector(".spine-frame.spine-ready") && (${visiblePoint.toString()})("p1")`, "populated Canvas ready");
    assert.equal(await evaluate(`(${visiblePoint.toString()})("p2")`), false, `${label}: destination begins off camera`);
    await shot("canvas-before");
    let before = texts().length;
    await click(finish);
    await returned(before);

    // Cards retains its view, reveals the dropped thread, and preserves an existing draft.
    await load();
    await openView("cards");
    await draft("My draft: ");
    await shot("cards-before");
    before = texts().length;
    await click(finish);
    await returned(before, "My draft: ", "cards");
    await check('document.documentElement.dataset.view === "cards" && !!document.querySelector("#thread-T2 .points")', "Cards reveals requested thread");

    // Another view returns to the Canvas, including its lazy mount and camera transition.
    await load();
    await openView("pictures");
    await shot("palace-before");
    before = texts().length;
    await click(finish);
    await returned(before, "", "palace");
    await check('document.documentElement.dataset.view === "map" && !!document.querySelector(".spine-frame.spine-ready")', "Palace returns to Canvas");

    // Bare Enter carries text like a real keystroke; it must not submit the preserved draft as focus moves.
    await load();
    await openView("cards");
    await draft("Keyboard draft: ");
    await evaluate('document.activeElement.blur()');
    await shot("keyboard-before");
    before = texts().length;
    await key("Enter");
    await returned(before, "Keyboard draft: ", "keyboard");

    // A focused control keeps native Enter: Later dismisses without navigating or stealing composer focus.
    await load();
    before = texts().length;
    await evaluate('document.querySelector(".pullback-actions .quiet").focus()');
    await key("Enter");
    await check('!document.querySelector(".pullback")', "focused Later keeps native Enter");
    assert.equal(shown.active_by.you, "T1", `${label}: Later leaves current thread`);
    assert.equal(texts().length, before, `${label}: Later sends nothing`);

    // The other Finish it button (the original cards page) and ordinary goBack's thread-toggle focus.
    await load("?cards");
    await shot("original-before");
    before = texts().length;
    await click(finish);
    await returned(before, "", "original");
    await click('[data-guide="view:palace"]');
    await check('!!document.querySelector(".palace-tile[data-thread=T1]")', "Palace tile ready");
    await click('.palace-tile[data-thread="T1"]');
    await check('document.activeElement === document.querySelector("#thread-T1 .thread-toggle")', "ordinary goBack retains thread-toggle focus");
    await sleep(700);
    assert.equal(await evaluate('document.activeElement === document.querySelector("#thread-T1 .thread-toggle")'), true, `${label}: settled ordinary goBack focus`);

    // Enter in a field submits normally while the unfinished offer is still visible.
    await load();
    await draft("An ordinary submitted thought");
    before = texts().length;
    await key("Enter");
    for (let n = 0; n < 40 && texts().length === before; n++) await sleep(25);
    assert.deepEqual(texts().slice(before), [{ type: "text", text: "An ordinary submitted thought" }]);
    assert.equal(shown.active_by.you, "T1", `${label}: field Enter does not invoke Finish it`);
    await browser.close();
    browser = null;
  }
  console.log("finish-it-focus-check: ok");
} finally {
  clearTimeout(timeout);
  if (browser) await browser.close();
  core.close();
}
