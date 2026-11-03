// Real Chrome: saved switches, URL and typed/spoken requests, layout and restoration.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { standInCore, openPage, sleep } from "./headless.mjs";
const now = Date.now();
const thread = { id: "T1", title: "Garden", parent_id: null, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "" };
const point = { id: "p1", speaker: "you", text: "Plant flowers by the gate", point: "Plant flowers by the gate", thread_id: "T1", placed: true, unclear: "", complete: true, at_ms: now, place_ms: 3000 };
const world = { threads: [thread, { ...thread, id: "C1", title: "A comment", parent_id: "T1", anchor: { thought_id: "p1", quote: "flowers" } }], thoughts: [point, { ...point, id: "c1", thread_id: "C1", text: "Choose blue flowers", point: "Choose blue flowers" }], active: "T1", active_by: { you: "T1" }, stay_here: "T1", anchors: { C1: { thought_id: "p1", quote: "flowers" } }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [] };
const server = await standInCore(() => [{ type: "snapshot", world }, { type: "usage", data: { updated: new Date(now).toISOString(), rows: [{ label: "Allowance", used_pct: 20 }], calls: { used: 3, limit: 20, at_ms: now } } }]);
assert.ok(server.port >= 4620);
let browser;
try {
  browser = await openPage(`http://127.0.0.1:${server.port}/`, { width: 1440, height: 900 });
  const { evaluate: run, until, page } = browser;
  await page("Page.enable");
  await page("Page.addScriptToEvaluateOnNewDocument", { source: `if (!sessionStorage.getItem('prepared')) { localStorage.clear(); localStorage.setItem('e2a2o.bricks', JSON.stringify({level:true, usage:false, keys:true, bubbles:true})); localStorage.setItem('e2a2o.features', JSON.stringify({recap:true,export:true,import:true})); sessionStorage.setItem('prepared','yes'); }` });
  await page("Page.reload"); await sleep(150);
  assert.ok(await until(`!!document.querySelector('.spine-point') && !!document.querySelector('[data-brick="level"]')`), await run(`document.body.innerText`));
  await sleep(800);
  // A person holding their place must not be moved by the preset or its notices.
  await run(`document.querySelector('.spine-follow').click()`);
  await sleep(300);
  const stores = () => run(`[localStorage.getItem('e2a2o.bricks'),localStorage.getItem('e2a2o.features')]`);
  const before = await stores();
  const geometry = () => run(`['.shell-composer','[data-slot="status"]','.spine-frame'].map(s=>{ const r=document.querySelector(s).getBoundingClientRect();return [r.x,r.y,r.width,r.height]})`);
  const original = await geometry();
  const key = async (key, code, windowsVirtualKeyCode) => {
    await page("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode, ...(key === "Enter" ? { text: "\r" } : {}) });
    await page("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
  };
  const type = async (text) => {
    await run(`document.querySelector('textarea').focus()`);
    await page("Input.insertText", { text });
    await page("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await page("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  };
  const talk = async () => {
    assert.ok(await until(`document.documentElement.hasAttribute('data-talk') && !!document.querySelector('.usage') && !!document.querySelector('.spine-point')`));
    assert.deepEqual(await run(`[...document.querySelectorAll('[data-brick]')].map(e=>e.dataset.brick).sort()`), ["spine", "tiny-transcript", "usage"]);
    assert.equal(await run(`['[data-slot="top-left"]','[data-slot="top-right"]','.spine-corner','.shell-status-right'].some(s=>[...document.querySelectorAll(s)].some(e=>e.getBoundingClientRect().height>0))`), false);
    assert.ok(await run(`!!document.querySelector('[data-guide="mic"]')`));
    assert.ok(await run(`document.querySelector('.talk-exit')?.checkVisibility()`), "Talk always has a visible exit");
    assert.deepEqual(await stores(), before);
  };
  await run(`document.activeElement?.blur()`);
  await key("y", "KeyY", 89);
  assert.ok(await until(`!!document.querySelector('.shell-rail')`));
  await type("talk mode");
  await talk();
  assert.ok(await run(`!!document.querySelector('.staying-here') && !!document.querySelector('.spine-margin')`));
  assert.ok(await until(`!!document.querySelector('[data-guide="notice"]')`), "hidden History must not swallow the Talk notice");
  assert.deepEqual(await geometry(), original, "Canvas and input stay in place");
  await page("Page.reload"); await sleep(150); await talk();
  server.send({ type: "guide", by: "Maya", kind: "caption", target: null, at_ms: Date.now(), text: "Keep talking. Your thoughts stay here." });
  assert.ok(await until(`!!document.querySelector('#shell-caption .guide-caption')`), "captions stay visible");
  server.send({ type: "notice", message: "Talk is on. Say or type “all features” to go back." });
  assert.ok(await until(`!!document.querySelector('[data-guide="notice"]')`));
  await sleep(800);
  writeFileSync("/private/tmp/e2a2o-talk-1440.png", Buffer.from((await page("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await type("all features");
  assert.ok(await until(`!document.documentElement.hasAttribute('data-talk') && !!document.querySelector('[data-brick="level"]')`));
  assert.deepEqual(await stores(), before);
  assert.deepEqual(await geometry(), original);
  assert.equal(server.heard.some(m => m.type === "text"), false, "typed preset requests never land as thoughts");
  server.send({ type: "view", view: "talk" }); await talk();
  server.send({ type: "view", view: "features" });
  assert.ok(await until(`!document.documentElement.hasAttribute('data-talk')`));
  await page("Page.navigate", { url: `http://127.0.0.1:${server.port}/?preset=talk` }); await talk();
  await type("all features");
  assert.ok(await until(`!document.documentElement.hasAttribute('data-talk')`));
  assert.equal(await run(`new URL(location.href).searchParams.has('preset')`), false);
  await page("Page.reload"); await sleep(150);
  assert.ok(await until(`!!document.querySelector('[data-brick="level"]')`));
  assert.equal(await run(`document.documentElement.hasAttribute('data-talk')`), false);
  assert.deepEqual(await stores(), before);
  // A real second window must clear this window's URL as well as its saved preset.
  await page("Page.navigate", { url: `http://127.0.0.1:${server.port}/?preset=talk` }); await talk();
  await page("Runtime.evaluate", { expression: `window.talkWindow = window.open(location.origin + '/?preset=talk')`, userGesture: true });
  assert.ok(await until(`!!window.talkWindow?.document.querySelector('.talk-exit')`));
  await run(`window.talkWindow.document.querySelector('.talk-exit').click()`);
  assert.ok(await until(`!document.documentElement.hasAttribute('data-talk') && !new URL(location.href).searchParams.has('preset')`));
  await run(`window.talkWindow.close()`);
  await page("Page.bringToFront");
  await page("Page.reload"); await sleep(150);
  assert.ok(await until(`!!document.querySelector('[data-brick="level"]') && !document.documentElement.hasAttribute('data-talk')`));
  // The named switch uses the same preset, and no controls spill out on a phone.
  await run(`document.querySelector('[data-guide="catalog"]').click()`);
  assert.ok(await until(`!!document.querySelector('[role="switch"][aria-label="Talk"]')`));
  await run(`document.querySelector('[role="switch"][aria-label="Talk"]').click()`); await talk();
  await page("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await page("Page.reload"); await sleep(150); await talk();
  await sleep(300);
  assert.ok(await run(`document.documentElement.scrollWidth <= innerWidth && document.querySelector('textarea').getBoundingClientRect().right <= innerWidth`));
  writeFileSync("/private/tmp/e2a2o-talk-phone.png", Buffer.from((await page("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await run(`document.querySelector('textarea').blur(); document.querySelector('.skip-link').focus()`);
  await key("Tab", "Tab", 9);
  assert.equal(await run(`document.activeElement.className`), "talk-exit");
  await key("Enter", "Enter", 13);
  assert.ok(await until(`!document.documentElement.hasAttribute('data-talk') && !!document.querySelector('[data-guide="catalog"]')`));
  assert.equal(await run(`document.activeElement.tagName`), "TEXTAREA");
  await run(`document.querySelector('[data-guide="catalog"]').click()`);
  assert.ok(await until(`!!document.querySelector('[role="switch"][aria-label="Talk"][aria-checked="false"]')`));
  // Both classic entry points show Canvas during Talk, then restore the chosen view.
  for (const query of ["?shell=1", "?cards"]) {
    await page("Page.navigate", { url: `http://127.0.0.1:${server.port}/${query}` });
    assert.ok(await until(`!!document.querySelector('[data-guide="view:palace"]')`));
    for (const view of ["map", "palace"]) {
      await run(`document.querySelector('[data-guide="view:${view}"]').click()`);
      await type("talk mode");
      assert.ok(await until(`!!document.querySelector('.spine-point') && !!document.querySelector('.talk-exit')`));
      assert.equal(await run(`!!document.querySelector('.palace, main.map, .map-tools, .apps-toggle, .catalog')`), false);
      assert.ok(await run(`document.documentElement.scrollWidth <= innerWidth`));
      await run(`document.querySelector('.talk-exit').focus()`);
      await key("Enter", "Enter", 13);
      assert.ok(await until(`!document.documentElement.hasAttribute('data-talk') && !!document.querySelector('[data-guide="view:${view}"][aria-pressed="true"]')`));
      if (view === "palace") assert.ok(await until(`!!document.querySelector('.palace')`));
    }
  }
  console.log(`talk-preset-check: passed in Chrome on ${server.port}; desktop, phone, keyboard exit, typed/spoken requests, History, cross-window URL, reload, classic Cards/Pictures, restoration`);
} finally { await browser?.close(); server.close(); }
