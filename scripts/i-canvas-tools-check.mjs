// Synthetic mounted UI check: fresh profiles, ephemeral loopback ports, no real mic or model.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { captureCore } from "./capture-fixture.mjs";
import { openPage, ready, sleep } from "./headless.mjs";

if (ready()) { console.log(`SKIP i-canvas-tools-check: ${ready()}`); process.exit(3); }
const world = { threads: [{ id: "topic-synthetic", title: "Synthetic topic", parent_id: null, created_ms: 1, last_point: "A synthetic point", last_touched_ms: 1 }],
  thoughts: [{ id: "thought-synthetic", text: "A synthetic point", point: "A synthetic point", speaker: "you", at_ms: 1, placed: true, thread_id: "topic-synthetic" }],
  active: "topic-synthetic", active_by: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [] };
const core = await captureCore({ seed: world, delay: 80 });
assert.ok(![4360, 4399].includes(core.port));
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
let browser;
const errors = [];
try {
  for (const width of [1440, 390]) {
    browser = await openPage("about:blank", { width, height: 900 });
    const { page, evaluate, until } = browser;
    await page("Page.enable");
    await page("Runtime.enable");
    browser.on("Runtime.exceptionThrown", e => errors.push(e.exceptionDetails.exception?.description ?? e.exceptionDetails.text));
    await page("Page.addScriptToEvaluateOnNewDocument", { source: `
      localStorage.setItem("e2a2o.toured", "1");
      window.micStarts = 0;
      navigator.mediaDevices.getUserMedia = async () => { window.micStarts++; throw new Error("Synthetic check denies microphone"); };
    ` });
    await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    const key = async (key, code, n, text) => {
      await page("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: n, ...(text ? { text } : {}) });
      await page("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: n });
    };
    const click = async selector => {
      const point = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({block:"nearest"}); const r = e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      await page("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
      await page("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
    };
    const tool = () => `.canvas-tools-controls button[aria-pressed]`;
    const focus = async id => {
      // Let entry and portal focus settle before issuing the next user action.
      await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      await evaluate(`document.querySelectorAll(${JSON.stringify(tool())})[${["composer", "features", "history"].indexOf(id)}].click()`);
      assert.ok(await until(`(() => { const e = document.querySelector('[data-canvas-tool="${id}"]'); if (!e) return false; const r=e.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth+1 && r.top>=130 && r.bottom<innerHeight-40; })()`), `${width}: ${id} readable`);
    };
    const shot = async name => { if (shots) writeFileSync(`${shots}/${name}-${width}.png`, Buffer.from((await page("Page.captureScreenshot", { format: "png" })).data, "base64")); };
    await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/` });
    assert.ok(await until('!!document.querySelector(".spine-ready") && !!document.querySelector(".shell-composer textarea")'), "ordinary shell loaded");
    assert.equal(await evaluate('!!document.querySelector(".canvas-tool")'), false, "fresh profile default off");
    await evaluate('window.originalComposer = document.querySelector(".shell-composer textarea"); originalComposer.focus()');
    await page("Input.insertText", { text: "Synthetic draft before entry" });
    await evaluate('document.activeElement.blur()');
    await key("c", "KeyC", 67);
    assert.ok(await until('!!document.querySelector(".shell-rail [data-row=canvas-tools] [role=switch]")'));
    assert.equal(await evaluate('document.querySelector("[data-row=canvas-tools] [role=switch]").getAttribute("aria-checked")'), "false");
    await click('[data-row=canvas-tools] [role=switch]');
    assert.ok(await until('!!document.querySelector("[data-canvas-tool=composer] textarea")'));
    await focus("composer");
    assert.equal(await evaluate('document.querySelectorAll("[data-guide=composer]").length'), 1, "one composer");
    assert.equal(await evaluate('document.querySelector(".shell-composer textarea") === originalComposer'), true, "same mounted textarea");
    assert.equal(await evaluate('originalComposer.value'), "Synthetic draft before entry");
    assert.equal(await evaluate('!!document.querySelector("[data-canvas-tool=features] .shell-catalog")'), width !== 390, "phone mounts only focused tool");
    const sentBefore = core.heard.filter(m => m.type === "text").length;
    await key("Enter", "Enter", 13, "\r");
    assert.ok(await until('originalComposer.value === ""'), "normal Enter action cleared draft");
    await sleep(100);
    assert.equal(core.heard.filter(m => m.type === "text").length, sentBefore + 1, "exactly one send");
    // Dedicated handle moves the tool only; focus restores its reading view afterwards.
    const handle = await evaluate('(() => { const r=document.querySelector("[data-canvas-tool=composer] .canvas-tool-handle").getBoundingClientRect(); return {x:r.x+20,y:r.y+15}; })()');
    const beforeDrag = await evaluate('document.querySelector("[data-canvas-tool=composer]").getBoundingClientRect().x');
    await page("Input.dispatchMouseEvent", { type: "mousePressed", ...handle, button: "left", clickCount: 1 });
    // The first move crosses React Flow's drag threshold; subsequent moves carry the node.
    for (const delta of [10, 30, 60]) await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: handle.x+delta, y:handle.y+delta/2, button: "left", buttons: 1 });
    await page("Input.dispatchMouseEvent", { type: "mouseReleased", x:handle.x+60, y:handle.y+30, button:"left",clickCount:1 });
    await sleep(50);
    assert.ok(await until(`Math.abs(document.querySelector("[data-canvas-tool=composer]").getBoundingClientRect().x - ${beforeDrag}) > 25`), "dedicated handle moves tool");
    // Pan the actual existing canvas, then restore readable History through the fixed controls.
    await page("Input.dispatchMouseEvent", { type: "mousePressed", x: width - 15, y: 400, button: "left", clickCount: 1 });
    await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: width - 115, y: 500, button: "left", buttons: 1 });
    await page("Input.dispatchMouseEvent", { type: "mouseReleased", x: width - 115, y: 500, button: "left", clickCount: 1 });
    await sleep(50);
    await evaluate('document.activeElement?.blur()');
    await key("y", "KeyY", 89);
    assert.ok(await until('document.querySelectorAll(".canvas-tools-controls button[aria-pressed]")[2].getAttribute("aria-pressed") === "true"'), "Y focuses canvas History");
    await focus("history");
    assert.ok(await evaluate('!!document.querySelector("[data-canvas-tool=history] .shell-history")'));
    await evaluate('document.activeElement?.blur()');
    await key("c", "KeyC", 67);
    assert.ok(await until('document.querySelectorAll(".canvas-tools-controls button[aria-pressed]")[1].getAttribute("aria-pressed") === "true"'), "C focuses canvas Features");
    await focus("features");
    assert.ok(await evaluate('!!document.querySelector("[data-canvas-tool=features] [data-row=canvas-tools]")'));
    await focus("composer");
    await page("Input.insertText", { text: "Synthetic draft survives exit" });
    await evaluate('document.querySelector(".canvas-tools-controls > div:nth-child(2) button").click()');
    assert.ok(await until('document.activeElement === document.querySelector(".react-flow__pane")'), "return focuses canvas");
    if (width === 390) assert.ok(await until('document.querySelectorAll(".canvas-tool").length === 0'), "explicit phone return");
    await evaluate('document.querySelector(".skip-link").click()');
    assert.ok(await until('document.activeElement === originalComposer'), "skip-to-input focuses same composer");
    assert.ok(await evaluate('!!document.querySelector(".shell-status-state")'), "status reachable");
    await shot("canvas-tools-composer");
    await focus("features");
    await shot("canvas-tools-features");
    await evaluate('document.querySelector(".canvas-tools-controls > div:nth-child(2) button:last-child").click()');
    assert.ok(await until('!document.querySelector(".canvas-tool") && !!document.querySelector("[data-map-capture=active] textarea")'), "ordinary shell restored");
    assert.ok(await until('document.activeElement === originalComposer && originalComposer.value === "Synthetic draft survives exit"'), "draft and focus survive exit");
    assert.equal(await evaluate('micStarts'), 0, "no microphone starts from treatment");
    // Enable again, reload the same profile: setting persists; no second composer or auto-mic.
    await evaluate('originalComposer.blur()'); await key("c", "KeyC", 67);
    await click('[data-row=canvas-tools] [role=switch]');
    assert.ok(await until('!!document.querySelector(".canvas-tool")'));
    await page("Page.reload");
    assert.ok(await until('!!document.querySelector("[data-canvas-tool=composer] textarea")'), "on survives reload");
    assert.equal(await evaluate('document.querySelectorAll("[data-guide=composer]").length'), 1);
    await focus("features");
    await click('[data-canvas-tool=features] [data-row=canvas-tools] [role=switch]');
    assert.ok(await until('!document.querySelector(".canvas-tool") && !!document.querySelector("[data-map-capture=active] textarea")'), "Features switch restores shell");
    // Existing optional views remain usable: Show exits the Canvas-only treatment.
    if (width === 1440) {
      await evaluate('document.activeElement?.blur()'); await key("c", "KeyC", 67);
      await click('[data-row=canvas-tools] [role=switch]');
      await focus("features");
      await click('[data-row=cards] [role=switch]');
      assert.ok(await until('!!document.querySelector("[data-row=cards] .shell-link")'));
      await click('[data-row=cards] .shell-link');
      assert.ok(await until('!!document.querySelector("main[aria-label=Cards]") && !document.querySelector(".canvas-tool") && !!document.querySelector(".shell-status textarea")'), "existing Cards Show remains usable");
    }
    await page("Page.reload");
    assert.ok(await until('!!document.querySelector("[data-map-capture=active] textarea") && !!document.querySelector(".spine-ready")'));
    assert.equal(await evaluate('!!document.querySelector(".canvas-tool")'), false, "off survives reload");
    assert.equal(await evaluate('micStarts'), 0);
    await browser.close(); browser = null;
  }
  // The same treatment also mounts before the very first topic exists.
  core.state.accepted.clear(); core.state.commits.clear(); core.state.world.active_by = {};
  core.state.world.threads = []; core.state.world.thoughts = []; core.state.world.active = null;
  browser = await openPage(`http://127.0.0.1:${core.port}/`, { width: 390, height: 844 });
  assert.ok(await browser.until('!!document.querySelector("[data-map-capture=active]")'));
  await browser.evaluate('document.querySelector("[data-guide=catalog]").click()');
  assert.ok(await browser.until('!!document.querySelector("[data-row=canvas-tools] [role=switch]")'));
  await browser.evaluate('document.querySelector("[data-row=canvas-tools] [role=switch]").click()');
  assert.ok(await browser.until('!!document.querySelector(".spine-ready [data-canvas-tool=composer] textarea")'), "tools on empty map");
  await browser.evaluate('document.querySelector(".canvas-tools-controls > div:nth-child(2) button:last-child").click()');
  assert.ok(await browser.until('!!document.querySelector("[data-map-capture=active]") && !!document.querySelector("[data-map-capture=active] textarea")'), "empty shell restored");
  await browser.close(); browser = null;
  assert.deepEqual(errors, [], "no uncaught UI errors");
  assert.equal(core.heard.filter(m => m.type === "listen" && m.on).length, 0, "no mic starts sent");
  console.log("i-canvas-tools-check: ok (desktop + 390px; default off, same mounted draft, single send, drag, keyboard, empty map, pan/focus/return, skip link, exit, reload on/off, zero mic starts, reduced motion)");
} catch (error) {
  if (browser) {
    console.error("UI diagnostic:", await browser.evaluate('JSON.stringify({active:document.activeElement?.outerHTML.slice(0,220),rail:document.querySelector(".shell-rail")?.outerHTML.slice(0,1200),catalog:document.querySelectorAll(".shell-catalog").length,tools:[...document.querySelectorAll(".canvas-tools-controls button")].map(e=>[e.textContent,e.getAttribute("aria-pressed")]),nodes:[...document.querySelectorAll("[data-canvas-tool]")].map(e=>[e.dataset.canvasTool,JSON.stringify(e.getBoundingClientRect())]),transform:document.querySelector(".react-flow__viewport")?.getAttribute("style"),errors:document.body.innerText.slice(-500)})').catch(() => "unavailable"));
    if (shots) writeFileSync(`${shots}/failure.png`, Buffer.from((await browser.page("Page.captureScreenshot", { format: "png" })).data, "base64"));
  }
  throw error;
} finally { await browser?.close(); core.close(); }
