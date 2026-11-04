// Built default canvas in Chrome: reading a reply counts in Talk too. No key or model calls.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

const unavailable = ready();
if (unavailable) { console.log(`SKIP read-progress-check: ${unavailable}`); process.exit(3); }
const at = Date.now();
const thread = (id, parent_id = null) => ({ id, title: "The room", parent_id, status: "open", last_point: "", touched_ms: at, tags: [], picture: null, dropped_by: "" });
const thought = (id, speaker, text, offset, thread_id = "T1") => ({ id, speaker, text, point: text, thread_id, placed: true, complete: true, at_ms: at + offset, place_ms: 0 });
const own = thought("mine", "you", "Keep the blue sample.", 0);
let world;
const reset = (margin = false) => {
  world = { threads: [thread("T1")], thoughts: [own, thought("reply", "Sam", "Try it by the window.", 1)], active: "T1", active_by: { you: "T1" }, stay_here: null, anchors: {}, notes: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], proposals: [], ai: [] };
  if (margin) {
    world.threads.push(thread("N1", "T1"));
    world.anchors.N1 = { thought_id: "reply", quote: "by the window" };
    world.thoughts.push(thought("note", "Sam", "Daylight will help.", 2, "N1"));
  }
};
reset();
let calling = false;
const people = ["you", "Sam"].map((name) => ({ name, ai: false, joined_ms: at - 1000, here: true, left_ms: null, mic: false, speaking: false, read: null }));
const call = () => ({ type: "call", started_ms: at - 1000, level: "speak", level_by: "", people });
const core = await standInCore(() => [...(calling ? [call()] : []), { type: "snapshot", world }], {
  onMessage: (message) => {
    if (message.type !== "read" || !calling) return;
    people[0].read = message.thought_id;
    core.send(call());
  },
});
assert.ok(core.port > 10000, "fixture uses an ephemeral port");
const pages = [];
const open = async (width = 1440) => {
  const browser = await openPage("about:blank", { width, height: width === 390 ? 844 : 900 });
  pages.push(browser);
  await browser.page("Page.enable");
  await browser.page("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("e2a2o.toured", "1"); window.errors = []; addEventListener("error", e => { if (!e.message.startsWith("ResizeObserver")) errors.push(e.message); });` });
  await browser.page("Page.navigate", { url: `http://127.0.0.1:${core.port}/?bricks=read-progress` });
  assert.ok(await browser.until(`!!document.querySelector('.spine-ready .spine-text, .spine-ready .spine-aside-text')`, 10000), "default canvas opens");
  return browser;
};
const key = async (browser, value) => {
  // The input box can autofocus during startup; canvas shortcuts intentionally ignore typing in it.
  await browser.evaluate(`document.querySelector('.spine-stop').focus()`);
  for (const type of ["keyDown", "keyUp"]) await browser.page("Input.dispatchKeyEvent", { type, key: value, code: `Digit${value}`, windowsVirtualKeyCode: value.charCodeAt(0) });
};
const stored = (id) => `localStorage.getItem("e2a2o.talk.read.you") === ${JSON.stringify(id)}`;
const shot = async (browser, name) => {
  if (!process.env.SHOTS) return;
  mkdirSync(process.env.SHOTS, { recursive: true });
  const { data } = await browser.page("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${process.env.SHOTS}/${name}.png`, Buffer.from(data, "base64"));
};
try {
  const browser = await open();
  const { evaluate, until, page } = browser;
  await key(browser, "2");
  assert.ok(await until(`!!document.querySelector('.spine-bars') && !document.querySelector('.spine-point[data-readable]')`), await evaluate(`JSON.stringify({focus:document.activeElement?.outerHTML.slice(0,200),transform:document.querySelector('.react-flow__viewport')?.style.transform,stops:[...document.querySelectorAll('.spine-stop')].map(e=>[e.textContent,e.getAttribute('aria-pressed')]),readable:document.querySelectorAll('.spine-point[data-readable]').length,bars:document.querySelectorAll('.spine-bars').length,errors})`));
  await sleep(1800);
  assert.ok(await evaluate(stored(null)), "zoomed-out bars do not count as reading");
  await key(browser, "1");
  assert.ok(await until(`!!document.querySelector('.spine-point[data-readable="true"].read-progress-point')`));
  await sleep(400);
  assert.ok(await evaluate(stored(null)), "a brief glance does not count");
  assert.ok(await until(stored("reply"), 4000), "canvas dwell advances the shared position");
  assert.ok(await until(`!!document.querySelector('.spine-point[data-thought="reply"].read-progress-mark')`));
  assert.equal(await evaluate(`!!document.querySelector('[data-thought="mine"].read-progress-point')`), false, "your own thoughts are excluded");
  assert.ok(core.heard.some((message) => message.type === "read" && message.thought_id === "reply"), "canvas reading reaches the core");
  await shot(browser, "read-desktop");
  await page("Page.reload");
  assert.ok(await until(`!!document.querySelector('.spine-point[data-thought="reply"].read-progress-mark')`, 10000), "line survives reload");

  const add = (id) => {
    const next = thought(id, "Sam", "Look in daylight.", world.thoughts.length + 1);
    world.thoughts.push(next);
    core.send({ type: "change", change: { type: "thought_added", thought: next } });
  };
  add("later");
  assert.ok(await until(`!!document.querySelector('.spine-point[data-thought="later"].read-progress-point')`));
  await key(browser, "2");
  await sleep(1800);
  assert.ok(await evaluate(stored("reply")), "leaving the readable zoom cancels the pending dwell");
  // Keep the canvas unreadable while Talk reads the next reply.
  calling = true;
  core.send(call());
  assert.ok(await until(`!!document.querySelector('.talk-scroll')`, 4000), "Talk opens for the call");
  assert.ok(await until(stored("later"), 7000), "Talk advances the same persisted position");
  await key(browser, "1");
  assert.ok(await until(`!!document.querySelector('.spine-point[data-thought="later"].read-progress-mark')`), "Talk reading moves the canvas line");
  assert.ok(await evaluate(`!document.querySelector('.talk-read-line')`), "Talk has no unread line after reading the latest reply");
  await evaluate(`document.querySelector('.spine-point[data-thought="reply"] .spine-text').click()`);
  assert.ok(await until(`!!document.querySelector('.spine-point[data-thought="reply"].read-progress-mark')`), "a tap can move the thread's bookmark back");
  assert.ok(await evaluate(stored("later")), "moving a bookmark back does not make Talk unread again");
  assert.deepEqual(await evaluate("errors"), []);
  await browser.close(); pages.pop();

  // Margin replies carry their own identities beside the words and beneath them on a phone.
  calling = false;
  reset(true);
  for (const width of [1440, 390]) {
    const view = await open(width);
    assert.ok(await view.until(`!!document.querySelector('.spine-entry[data-thought="note"].read-progress-point')`, 5000), `${width}: margin reply is watched`);
    assert.ok(await view.until(stored("note"), 5000), `${width}: reading a margin reply counts`);
    assert.ok(await view.evaluate(`document.documentElement.scrollWidth <= innerWidth`), `${width}: no page overflow`);
    await shot(view, `read-margin-${width}`);
    if (width === 390) {
      await view.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Features')).click()`);
      assert.ok(await view.until(`!!document.querySelector('[data-row="read-progress"] [role="switch"]')`), "feature switch opens on a phone");
      const label = await view.evaluate(`document.querySelector('[data-row="read-progress"] .shell-catalog-name').textContent`);
      assert.equal(label, "Mark replies as read", "the visible label explains the action");
      await view.evaluate(`const row = document.querySelector('[data-row="read-progress"]'); row.scrollIntoView({block:'center'}); row.querySelector('[role="switch"]').focus(); row.querySelector('.shell-catalog-name').style.fontSize = '26px';`);
      await shot(view, "read-label-390");
      assert.ok(await view.evaluate(`(() => { const e = document.querySelector('[data-row="read-progress"] .shell-catalog-name'), r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && e.scrollWidth <= e.clientWidth + 1; })()`), "label fits at enlarged text size");
      for (const type of ["keyDown", "keyUp"]) await view.page("Input.dispatchKeyEvent", { type, key: " ", code: "Space", windowsVirtualKeyCode: 32 });
      assert.ok(await view.until(`!document.querySelector('.read-progress-point')`), "keyboard switch removes the read decorations");
    }
    assert.deepEqual(await view.evaluate("errors"), []);
    await view.close(); pages.pop();
  }
  reset();
  world.thoughts = [thought("aside", "Sam", "A separate reply.", 1)];
  world.active = null;
  world.active_by = {};
  const aside = await open();
  assert.ok(await aside.until(`!!document.querySelector('.spine-aside.read-progress-point')`, 5000), "a lone reply is watched too");
  assert.ok(await aside.until(stored("aside"), 5000), "reading a lone reply counts");
  await aside.close(); pages.pop();
  console.log("PASS read-progress: canvas dwell, zoom cancellation, own thoughts excluded, reload, core delivery, shared Talk position, tap recovery, margin replies at 1440/390, phone label/keyboard, lone reply");
} finally {
  await Promise.all(pages.map((browser) => browser.close()));
  core.close();
}
