// Synthetic mounted UI only; built app + existing playground, throwaway profiles and ephemeral ports.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openPage, ready, sleep, standInCore } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP i-rounded-check: ${why}`); process.exit(3); }
const empty = { threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [], merged: {},
  apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], positions: {} };
const full = { ...empty, threads: [{ id: "synthetic-topic", title: "Example plan", parent_id: null, status: "open",
  last_point: "Bring the paper", touched_ms: 1000, tags: [], picture: null, dropped_by: "" }],
  thoughts: [{ id: "synthetic-thought", speaker: "you", text: "Bring the paper", point: "Bring the paper",
    thread_id: "synthetic-topic", placed: true, unclear: "", complete: true, at_ms: 1000, place_ms: null }],
  positions: { "synthetic-thought": { x: 180, y: 200, by: "you", at_ms: 1000 } } };
let shown = empty;
const original = JSON.stringify(full);
const core = await standInCore(() => [{ type: "snapshot", world: shown }]);
assert.ok(![4360, 4399].includes(core.port), "ephemeral helper port");
const base = `http://127.0.0.1:${core.port}`;
const shots = process.env.ROUNDED_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
let browser;
const instanceCount = 'document.querySelectorAll("[data-shape-id]").length';
const palette = '!!document.querySelector(".shapes-palette")';
const shape = 'document.querySelector("[data-shape-id]")';
const switchSelector = '.shell-catalog-row[data-row="shapes"] [role="switch"]';
const key = async (key, code, n) => {
  for (const type of ["keyDown", "keyUp"]) await browser.page("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: n });
};
const click = (text) => browser.evaluate(`[...document.querySelectorAll('.shapes-palette button')].find(b => b.textContent === ${JSON.stringify(text)}).click()`);
const features = async (on) => {
  await browser.evaluate('document.activeElement?.blur()');
  await key("c", "KeyC", 67);
  assert.ok(await browser.until(`!!document.querySelector(${JSON.stringify(switchSelector)})`), "Features has Shapes");
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(switchSelector)}).getAttribute("aria-checked")`), String(!on));
  await browser.evaluate(`document.querySelector(${JSON.stringify(switchSelector)}).click()`);
  await key("Escape", "Escape", 27);
  assert.ok(await browser.until('!document.querySelector(".shell-rail")'), "Features closes");
};
const screenshot = async (name) => {
  if (shots) writeFileSync(join(shots, name), Buffer.from((await browser.page("Page.captureScreenshot", { format: "png" })).data, "base64"));
};
const navigate = async (path = "/") => {
  await browser.page("Page.navigate", { url: base + path });
  assert.ok(await browser.until(path.startsWith("/bricks.html") ? '!!document.querySelector(".playground")' : '!!document.querySelector("[data-guide=composer] textarea")'), "page mounts");
};
try {
  browser = await openPage("about:blank", { width: 1440, height: 900 });
  await browser.page("Page.enable");
  // Skip only the existing tour; feature preferences are untouched in this fresh profile.
  await browser.page("Page.addScriptToEvaluateOnNewDocument", { source: 'localStorage.setItem("e2a2o.toured", "1");' });
  await navigate();
  assert.equal(await browser.evaluate('localStorage.getItem("e2a2o.bricks")'), null, "fresh feature settings");
  assert.equal(await browser.evaluate(palette), false, "default off");
  assert.equal(await browser.evaluate(instanceCount), 0, "fresh page places nothing");
  await features(true);
  assert.ok(await browser.until(palette), "enabled palette");
  assert.ok(await browser.until('!!document.querySelector(".spine-frame.spine-ready") && !document.querySelector(".shapes-button").disabled'), "empty map uses existing spine host");
  assert.equal(await browser.evaluate(instanceCount), 0, "enabling places nothing");
  assert.equal(await browser.evaluate('document.querySelectorAll("[data-definition=rounded-rectangle]").length'), 1);
  assert.equal(await browser.evaluate('document.querySelector(".shapes-preview figcaption").textContent'), "Definition preview");
  await click("Place rectangle");
  assert.ok(await browser.until(`${instanceCount} === 1`), "one explicit click, one instance");
  await navigate();
  assert.ok(await browser.until(palette), "feature preference survives reload");
  assert.equal(await browser.evaluate(instanceCount), 0, "visit state clears on reload");
  await features(false);
  assert.ok(await browser.until('!!document.querySelector("[data-map-capture=active] textarea") && !!document.querySelector(".spine-ready")'), "empty ordinary page restored");

  shown = full;
  await navigate();
  assert.ok(await browser.until('!!document.querySelector(".spine-frame.spine-ready") && !!document.querySelector(".spine-text")'));
  await sleep(1000); // Existing camera glide, before comparing thought positions.
  const thoughts = 'JSON.stringify([...document.querySelectorAll(".react-flow__node")].map(n => [n.dataset.id,n.style.transform,n.textContent]))';
  const before = await browser.evaluate(thoughts);
  const messagesAt = core.heard.length;
  await features(true);
  assert.ok(await browser.until(palette));
  assert.equal(await browser.evaluate(instanceCount), 0);
  await click("Place rectangle");
  assert.ok(await browser.until(`${instanceCount} === 1`));
  const id = await browser.evaluate(`${shape}.dataset.shapeId`);
  for (const [index, presses, expected] of [[0, 3, "203px"], [1, 2, "122px"], [2, 4, "28px"]]) {
    await browser.evaluate(`document.querySelectorAll('.shapes-range')[${index}].focus()`);
    for (let i = 0; i < presses; i++) await key("ArrowRight", "ArrowRight", 39);
    assert.equal(await browser.evaluate(`${shape}.style[${JSON.stringify(["width", "height", "borderRadius"][index])}]`), expected, "labelled keyboard size control");
  }
  const start = await browser.evaluate(`(() => { const b = ${shape}.querySelector('button').getBoundingClientRect(); return {x:b.left+b.width/2,y:b.top+b.height/2}; })()`);
  const oldX = await browser.evaluate(`Number(${shape}.dataset.x)`);
  await browser.page("Input.dispatchMouseEvent", { type: "mouseMoved", ...start });
  await browser.page("Input.dispatchMouseEvent", { type: "mousePressed", ...start, button: "left", clickCount: 1 });
  for (let step = 1; step <= 5; step++) await browser.page("Input.dispatchMouseEvent", { type: "mouseMoved", x: start.x + step * 12, y: start.y + step * 5, buttons: 1 });
  await browser.page("Input.dispatchMouseEvent", { type: "mouseReleased", x: start.x + 60, y: start.y + 25, button: "left", clickCount: 1 });
  assert.ok(await browser.until(`Number(${shape}.dataset.x) > ${oldX + 20}`), "handle drag moves shape");
  assert.equal(await browser.evaluate(`${shape}.dataset.shapeId`), id, "drag retains instance ID");
  await browser.evaluate(`${shape}.querySelector('button').focus()`);
  const movedX = await browser.evaluate(`Number(${shape}.dataset.x)`);
  await key("ArrowRight", "ArrowRight", 39);
  assert.equal(await browser.evaluate(`Number(${shape}.dataset.x)`), movedX + 10, "keyboard moves same instance");
  assert.equal(await browser.evaluate(thoughts), before, "thought nodes and positions unchanged");
  await screenshot("rounded-desktop.png");
  await browser.page("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await browser.page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }, { name: "prefers-color-scheme", value: "dark" }] });
  await sleep(200);
  assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true, "390px page fits");
  assert.equal(await browser.evaluate('(() => { const b=document.querySelector(".shapes-palette").getBoundingClientRect(); return b.left>=0 && b.right<=innerWidth && b.bottom<innerHeight; })()'), true, "phone palette in viewport");
  await browser.evaluate("document.querySelector('.shapes-palette').scrollTop = 999");
  await click("Remove rectangle");
  assert.ok(await browser.until(`${instanceCount} === 0`));
  assert.equal(await browser.evaluate('document.activeElement.textContent'), "Place rectangle", "removal returns focus");
  assert.equal(await browser.evaluate('document.querySelectorAll("[data-definition=rounded-rectangle]").length'), 1, "definition remains reusable");
  await click("Place rectangle");
  assert.ok(await browser.until(`${instanceCount} === 1`), "definition places again");
  assert.equal(await browser.evaluate(`(() => { const b=${shape}.querySelector('button').getBoundingClientRect(); return b.left>=0 && b.right<=innerWidth && b.top>=0 && b.bottom<innerHeight; })()`), true, "phone placement handle is in view");
  await browser.evaluate("document.querySelector('.shapes-palette').scrollTop = 0");
  await screenshot("rounded-390.png");
  await features(false);
  assert.ok(await browser.until(`!(${palette}) && ${instanceCount} === 0`), "off hides palette and instances");
  assert.ok(await browser.until('!!document.querySelector(".spine-frame.spine-ready")'), "ordinary canvas stays");
  assert.equal(await browser.evaluate('JSON.parse(localStorage.getItem("e2a2o.bricks")).shapes'), false);
  assert.deepEqual(Object.keys(JSON.parse(await browser.evaluate('localStorage.getItem("e2a2o.bricks")'))), ["shapes"], "no other feature enabled");
  assert.equal(JSON.stringify(full), original, "synthetic World unchanged");
  assert.deepEqual(core.heard.slice(messagesAt).filter(m => !["heartbeat", "read"].includes(m.type)), [], "shape operations send no World or external actions");
  await screenshot("rounded-off-390.png");
  await navigate("/bricks.html?brick=shapes&sample=empty");
  assert.ok(await browser.until(palette), "synthetic playground provider");
  assert.equal(await browser.evaluate(instanceCount), 0, "playground starts empty");
  assert.ok(await browser.until('!!document.querySelector(".spine-frame.spine-ready") && !!document.querySelector(".shapes-button") && !document.querySelector(".shapes-button").disabled'), "playground canvas host is ready for placement");
  await click("Place rectangle");
  assert.ok(await browser.until(`${instanceCount} === 1`), "playground uses same spine host");
  console.log("i-rounded-check: ok (fresh off, Features, zero until Place, edit, stable ID drag, keyboard, remove/reuse, reload clears, World unchanged, off, 390px/reduced motion, playground)");
} finally { await browser?.close(); core.close(); }
