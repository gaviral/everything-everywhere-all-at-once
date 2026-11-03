// Five first-walk regressions, through the built page and real Chrome input. No AI calls or saved user data.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { openPage, ready, sleep, standInCore } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP phone-walk-check: ${why}`); process.exit(3); }
const shots = process.env.SHOTS ?? "/private/tmp/e2a2o-r-phone-check";
mkdirSync(shots, { recursive: true });
const now = Date.now() - 60_000;
const thread = (id, title, topic) => ({ id, title, topic, parent_id: null, status: "open", last_point: "", touched_ms: now,
  tags: [], picture: null, dropped_by: "" });
const thought = (id, text, thread_id, extra = {}) => ({ id, text, point: text, thread_id, speaker: "you", placed: true,
  complete: true, at_ms: now, place_ms: 1500, unclear: "", ...extra });
const quote = "For the neighborhood supper I want to make pasta with the tomatoes from our garden, but I still need to decide "
  + "who can bring the folding chairs, whether we should eat outside if it rains, and how to make enough sauce for everyone who said they might come, including the neighbors who are arriving after work—";
const base = {
  threads: [thread("T1", "Neighborhood supper", "Evening plans"),
    { ...thread("T2", "Pasta for everyone", "Evening plans"), status: "dropped", dropped_by: "you" },
    thread("T3", "Garden jobs", "At home")],
  thoughts: [thought("a1", "Invite the neighbors for supper on Friday", "T1"),
    thought("a2", "Bring the long table out into the garden", "T1"),
    thought("a3", "Ask everyone which food they can bring", "T1"),
    thought("a4", "We can move inside if it starts raining", "T1"),
    thought("b1", quote, "T2", { complete: false }), thought("c1", "Water the new herbs before supper", "T3")],
  active: "T1", active_by: { you: "T1" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true,
  recaps: [], notes: {}, proposals: [], positions: {}, topics: { T1: "Evening plans", T2: "Evening plans", T3: "At home" },
};
const person = (name, ai = false) => ({ name, ai, remote: false, here: true, mic: false, speaking: false,
  joined_ms: now - 1000, left_ms: null, read: null });
let world = base;
let call = { type: "call", started_ms: now - 1000, people: [person("you"), person("Helper", true)], level: "speak", level_by: "" };
const core = await standInCore(() => [{ type: "snapshot", world }, call], { onMessage: (message) => {
  if (message.type === "level") { call = { ...call, level: message.level }; core.send(call); }
} });
assert.ok(core.port >= 4620, `spare port: ${core.port}`);
const url = `http://127.0.0.1:${core.port}/?recording`;
let browser;
try {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    world = base;
    browser = await openPage("about:blank", { width, height });
    const { page, evaluate, until } = browser;
    const check = async (expression, label) => {
      const ok = await until(expression, 10000);
      if (!ok) {
        const { data } = await page("Page.captureScreenshot", { format: "png" });
        writeFileSync(`${shots}/failure.png`, Buffer.from(data, "base64"));
        console.log(await evaluate(`({ viewport: document.querySelector('.react-flow__viewport')?.style.transform,
          nodes: [...document.querySelectorAll('.react-flow__node')].map(e => ({id:e.dataset.id, rect:e.getBoundingClientRect().toJSON()})),
          frame: document.querySelector('.spine-frame')?.getBoundingClientRect().toJSON() })`));
      }
      assert.ok(ok, `${width}: ${label}`);
    };
    const tap = async (selector) => {
      const at = await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)}), r = el.getBoundingClientRect();
        if (!el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))) throw Error('Covered: ' + ${JSON.stringify(selector)});
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`);
      for (const type of ["mousePressed", "mouseReleased"]) await page("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
    };
    const shot = async (name) => {
      const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeFileSync(`${shots}/${name}-${width}x${height}.png`, Buffer.from(data, "base64"));
    };
    const loaded = async () => {
      await check('!!document.querySelector(".spine-ready")', "map ready");
      await evaluate('document.fonts.ready.then(() => true)');
      await page("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await page("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await sleep(700);
    };
    const reload = async () => { await page("Page.reload"); await loaded(); };
    await page("Page.enable");
    await page("Page.addScriptToEvaluateOnNewDocument", { source: `
      localStorage.setItem('e2a2o.toured', '1');
      window.walkErrors = [];
      addEventListener('error', e => { if (!/^ResizeObserver loop/.test(e.message)) walkErrors.push(e.message); });
      addEventListener('unhandledrejection', e => walkErrors.push(String(e.reason)));
    ` });
    await page("Page.navigate", { url });
    await loaded();

    // 1: Every level receives the actual pointer tap, above the input bar, with the long card still present.
    await check('!!document.querySelector(".pullback")', "unfinished offer appears");
    await tap(".talk-pill");
    await check('document.querySelectorAll(".talk-level-step").length === 5', "five Talk controls");
    await check(`document.querySelector('.talk-rail').getBoundingClientRect().bottom <= document.querySelector('.shell-status').getBoundingClientRect().top`, "Talk clears the bottom input bar");
    for (let i = 1; i <= 5; i++) {
      const before = core.heard.filter((m) => m.type === "level").length;
      await tap(`.talk-level-step:nth-child(${i})`);
      assert.equal(core.heard.filter((m) => m.type === "level").length, before + 1, "tap reached Talk's socket action");
    }
    await shot("talk-controls");
    await tap(".talk-close");

    // 3: Three lines recognize the unfinished thought; expansion reveals all its original words.
    await check('!!document.querySelector(".pullback-more")', "long quote has Show more");
    const collapsed = await evaluate(`(() => {
      const q = document.querySelector('.pullback-quote'), r = q.getBoundingClientRect();
      const a = document.querySelector('.pullback-actions').getBoundingClientRect();
      return { height: r.height, line: parseFloat(getComputedStyle(q).lineHeight), clipped: q.scrollHeight > q.clientHeight,
        actionsBelow: a.top >= r.bottom, text: q.textContent };
    })()`);
    assert.ok(collapsed.clipped && collapsed.height <= 3 * collapsed.line + 1, "quote bounded by its reading lines");
    if (width === 390) assert.ok(collapsed.actionsBelow, "actions have their own row below the quote");
    assert.equal(collapsed.text, `“${quote}”`);
    await shot("finish-bounded");
    await tap(".pullback-more");
    await check('document.querySelector(".pullback-more").getAttribute("aria-expanded") === "true" && document.querySelector(".pullback-quote").clientHeight >= document.querySelector(".pullback-quote").scrollHeight', "full quote opens");
    await shot("finish-expanded");
    await tap(".pullback-more");

    // 5: Later keeps the same deadline across reloads. Different threads/maps and changed words get their own offer.
    await tap(".pullback-actions button:nth-child(2)");
    await check('!document.querySelector(".pullback")', "Later hides the card");
    const kept = await evaluate(`Object.entries(localStorage).find(([k]) => k.startsWith('e2a2o.unfinished:'))`);
    assert.ok(JSON.parse(kept[1]).laterAt[`T2:${now}`]);
    await evaluate(`(() => { const key = ${JSON.stringify(kept[0])}, saved = JSON.parse(localStorage.getItem(key));
      delete saved.words; localStorage.setItem(key, JSON.stringify(saved)); })()`); // Upgrade a choice saved by the previous UI.
    await reload();
    await sleep(3000); // The real pause that would offer a card after reload.
    assert.equal(await evaluate('!!document.querySelector(".pullback")'), false, "Later survives reload");
    assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(kept[0])})`), kept[1], "reload does not restart the postponement");
    await shot("later-reloaded");
    // Removing the map's earliest words must keep the same choice and its original deadline, live and after reload.
    world = { ...base, thoughts: base.thoughts.filter(t => t.id !== "a1") };
    core.send({ type: "change", change: { type: "thought_skipped", thought_id: "a1" } });
    await check('!document.querySelector(\'[data-thought="a1"]\')', "earliest thought deleted from the live map");
    await sleep(3000);
    assert.equal(await evaluate('!!document.querySelector(".pullback")'), false, "deleting earliest words keeps Later in the live page");
    await reload();
    await sleep(3000);
    assert.equal(await evaluate('!!document.querySelector(".pullback")'), false, "Later survives deletion and reload");
    assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(kept[0])})`), kept[1], "deletion does not restart the deadline or create another saved map");
    assert.equal(await evaluate(`Object.keys(localStorage).filter(k => k.startsWith('e2a2o.unfinished:')).length`), 1);
    await shot("later-after-deletion");
    const ownThread = base.threads[1];
    for (const [label, next] of [
      ["another thread", { ...base, threads: base.threads.map(t => t.id === "T2" ? { ...t, status: "open" } : t.id === "T3" ? { ...t, status: "dropped", dropped_by: "you" } : t) }],
      ["another map", { ...base, thoughts: base.thoughts.map(t => ({ ...t, id: `other-${t.id}`, at_ms: now + 1 })) }],
      ["new words on the same thread", { ...base, threads: base.threads.map(t => t.id === "T2" ? { ...ownThread, touched_ms: now + 1 } : t) }],
    ]) {
      world = next;
      await reload();
      await check('!!document.querySelector(".pullback")', `${label} has its own offer`);
    }

    // 2: Resize an overview without an active topic, then a held view. Each can recover without a core message.
    world = { ...base, threads: base.threads.map(t => ({ ...t, status: "open" })), active: null, active_by: {} };
    await reload();
    const visible = `(() => [...document.querySelectorAll('.spine-text, .spine-title')].some(el => {
      const r = el.getBoundingClientRect(); return r.right > 0 && r.left < innerWidth && r.top >= 112 && r.bottom < document.querySelector('.shell-status').getBoundingClientRect().top;
    }))()`;
    for (const [w, h] of [[1440, 900], [390, 844], [1440, 844], [390, 844]]) {
      await page("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await check(`innerWidth === ${w} && !!document.querySelector('.spine-corner-row') === ${w === 390}`, "responsive map controls rendered");
      await check(visible, `${w}×${h}: topics recentered`);
      await check(`[...document.querySelectorAll('.spine-corner button')].some(b => b.textContent.startsWith('See all'))`, "See all remains available");
      await tap('.spine-corner button[title="See everything (0)"]'); // See all holds the overview.
    }
    await page("Input.dispatchMouseEvent", { type: "mouseWheel", x: 180, y: 400, deltaX: 10000, deltaY: 0 });
    await check(`!(${visible})`, "hand can pan away from all topics");
    await tap('.spine-corner button[title="See everything (0)"]');
    await check(visible, "See all brings the lost map back");
    await shot("resized-recovered");

    // 4: A fifth thought lands while a named group and its heading are on a phone.
    await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    world = { ...base, threads: base.threads.map(t => ({ ...t, status: "open" })) };
    await reload();
    const landed = thought("a5", "Ask Pat to bring the extra chairs for the garden table", "T1", { at_ms: Date.now() });
    core.send({ type: "change", change: { type: "thought_added", thought: { ...landed, placed: false, thread_id: null } } });
    core.send({ type: "change", change: { type: "thought_placed", thought_id: "a5", thread_id: "T1", point: landed.point, complete: true, unclear: "", place_ms: 1500 } });
    await check('!!document.querySelector(\'[data-thought="a5"]\')', "new thought lands");
    await sleep(3300); // Follow spacing and the flight finish.
    const landing = await evaluate(`(() => {
      const head = document.querySelector('.react-flow__node[data-id="g:Evening plans"]').getBoundingClientRect();
      const point = document.querySelector('[data-thought="a5"]').getBoundingClientRect();
      const covers = [...document.querySelectorAll('[data-slot="top-left"], [data-slot="top-right"], .talk-pill')].map(e => e.getBoundingClientRect().bottom);
      return { headTop: head.top, pointTop: point.top, pointBottom: point.bottom, clearTop: Math.max(...covers), bar: document.querySelector('.shell-status').getBoundingClientRect().top };
    })()`);
    assert.ok(landing.headTop >= landing.clearTop && landing.pointTop >= landing.clearTop && landing.pointBottom <= landing.bar, `heading and landing clear the controls: ${JSON.stringify(landing)}`);
    await shot("landed-clear");
    assert.deepEqual(await evaluate("walkErrors"), [], "no browser errors");
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false, "no page overflow");
    console.log(`${width}×${height}: all five page checks passed (port ${core.port})`);
    await browser.close();
    browser = null;
  }
} finally {
  if (browser) await browser.close();
  core.close();
}
