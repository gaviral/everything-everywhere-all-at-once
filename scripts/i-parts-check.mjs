// Read-only app composition: real saved shapes, capability reasons, reuse and browser interaction.
// node scripts/i-parts-check.mjs [http://127.0.0.1:PORT]
// Optional URL checks a running sample Rust core too; it never enables or runs an app.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { uiServer } from "./ui-server.mjs";
import { openPage, ready, standInCore } from "./headless.mjs";

const state = { connected: true, noKey: false, keyRefused: false, resting: false, callsCapped: false, microphone: true, sound: true };
const base = { purpose: "Example", enabled: false, request: "", cooldown_secs: 30, created_ms: 0, last_run_ms: 0 };
const apps = [
  { ...base, id: "argument", name: "Argument resolver", watcher: { kind: "new_thought", min_points: 2 },
    prompt: { system: "Notice repetition", template: "{points} {thought}" }, publishers: [{ kind: "card", text: "{text}" }] },
  { ...base, id: "volume", name: "Volume watcher", watcher: { kind: "volume", level: .075, seconds: 3 }, prompt: null,
    publishers: [{ kind: "sound" }, { kind: "card", text: "Pause" }] },
  { ...base, id: "search", name: "Search-first", watcher: { kind: "app_request" }, enabled: true,
    prompt: { system: "Search saved apps", template: "{request} {catalog}" }, publishers: [{ kind: "card", text: "{text}" }] },
];
const server = await uiServer();
try {
  const { appParts, partUses } = await server.ssrLoadModule("/src/app-parts.ts");
  const parts = (app, changes = {}) => appParts(app, { ...state, ...changes });
  assert.deepEqual(parts(apps[1]).map(p => p.id), ["watcher:volume", "publisher:sound", "publisher:card"]);
  assert.ok(parts(apps[1]).every(p => !p.unavailable), "off app still has live implementations");
  assert.match(parts(apps[1], { microphone: false })[0].unavailable, /Microphone is off/);
  assert.match(parts(apps[1], { sound: false })[1].unavailable, /audio is not running/);
  for (const [change, reason] of [[{ noKey: true }, /No AI key/], [{ keyRefused: true }, /refused/],
    [{ resting: true }, /allowance/], [{ callsCapped: true }, /Hourly/]]) {
    assert.match(parts(apps[0], change)[1].unavailable, reason);
    assert.equal(parts(apps[0], change).at(-1).unavailable, "", "card implementation doesn't need AI");
  }
  assert.ok(parts(apps[1], { connected: false }).every(p => p.unavailable === "Core disconnected"));
  assert.match(parts(apps[2]).at(-1).unavailable, /not executed/, "search bypasses its stored publisher");
  assert.match(parts(apps[0])[1].configuration, /Notice repetition/);
  assert.equal(partUses(apps).get("publisher:card").places, 3);
  assert.equal(partUses(apps).get("publisher:card").apps.length, 3);
  const duplicate = { ...apps[1], publishers: [{ kind: "card", text: "First" }, { kind: "card", text: "Second" }] };
  assert.equal(partUses([duplicate]).get("publisher:card").places, 2, "placements counted separately");
  assert.equal(partUses([duplicate]).get("publisher:card").apps.length, 1, "one app isn't two apps");
  assert.equal(partUses(apps.slice(0, 2)).get("publisher:card").places, 2, "removed app leaves reuse count");
  for (const watcher of [{ kind: "phrase", phrase: "demo" }, { kind: "topic", topic: "Demo" },
    { kind: "time", at_ms: 1, every_secs: 60 }]) {
    assert.equal(parts({ ...apps[1], watcher })[0].id, `watcher:${watcher.kind}`);
  }
} finally { await server.close(); }

if (ready()) { console.log(`SKIP i-parts-check pages: ${ready()} (model checks passed)`); process.exit(3); }
const world = { threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [], merged: {},
  apps, apps_seeded: true, recaps: [], notes: {}, proposals: [] };
const core = await standInCore(() => [{ type: "snapshot", world }, { type: "notice", message: "MODEL_API_KEY is not set: listening and placement are off." }]);
let browser;
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const mutations = new Set(["toggle_app", "remove_app", "app_output", "compose_app", "decide_app"]);
const open = async (url, width) => {
  browser = await openPage("about:blank", { width, height: 900 });
  await browser.page("Page.enable");
  await browser.page("Page.addScriptToEvaluateOnNewDocument", { source: 'localStorage.setItem("e2a2o.toured", "1");' });
  await browser.page("Page.navigate", { url });
  assert.ok(await browser.until('!!document.querySelector("[data-guide=composer] textarea")'));
  await browser.page("Input.dispatchKeyEvent", { type: "keyDown", key: "c", code: "KeyC", windowsVirtualKeyCode: 67 });
  await browser.page("Input.dispatchKeyEvent", { type: "keyUp", key: "c", code: "KeyC", windowsVirtualKeyCode: 67 });
  assert.ok(await browser.until('document.querySelectorAll(".shell-catalog .app-parts").length === 3'), "sample apps in Catalog");
};
const key = async (key, code, n, text) => {
  await browser.page("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: n, ...(text ? { text } : {}) });
  await browser.page("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: n });
};
try {
  for (const width of [1440, 320]) {
    await open(`http://127.0.0.1:${core.port}/?sample`, width);
    await browser.evaluate('document.querySelector(".app-parts > summary").focus()');
    await key("Enter", "Enter", 13, "\r");
    assert.ok(await browser.until('document.querySelector(".app-parts").open'), "keyboard opens parts");
    await browser.evaluate('document.querySelectorAll(".app-parts").forEach(el => el.open = true)');
    assert.match(await browser.evaluate('document.querySelector(".shell-catalog").textContent'), /Used in 3 apps/);
    assert.match(await browser.evaluate('document.querySelector(".app-parts-body").textContent'), /No AI key/);
    assert.equal(await browser.evaluate('document.querySelectorAll(".app-parts button, .app-parts input, .app-parts select").length'), 0, "inspector is read-only");
    await browser.evaluate('document.querySelector(".app-parts .part-details").open = true');
    for (const zoom of [1, 2]) {
      await browser.evaluate(`document.querySelector(".shell-catalog").style.zoom = ${zoom}`);
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true, "page fits");
      assert.equal(await browser.evaluate('[...document.querySelectorAll(".app-parts-body")].every(el => el.scrollWidth <= el.clientWidth + 1)'), true, "tree fits at enlarged text");
    }
    await browser.evaluate('document.querySelector(".shell-catalog").style.zoom = 1');
    await browser.evaluate('document.querySelector(".app-parts").scrollIntoView({block:"start"})');
    assert.equal(await browser.evaluate(`(() => {
      const rail = document.querySelector(".shell-rail").getBoundingClientRect();
      const close = document.querySelector(".shell-rail-close").getBoundingClientRect();
      return close.top >= rail.top && close.bottom <= rail.bottom;
    })()`), true, "close control remains reachable while inspecting long trees");
    if (shots) writeFileSync(`${shots}/parts-${width}.png`, Buffer.from((await browser.page("Page.captureScreenshot", { format: "png" })).data, "base64"));
    core.drop();
    assert.ok(await browser.until('document.querySelector(".app-parts-body").textContent.includes("Core disconnected")'), "connection loss updates open tree");
    assert.ok(await browser.until('!document.querySelector(".app-parts-body").textContent.includes("Core disconnected")'), "reconnect updates tree");
    await key("Escape", "Escape", 27);
    assert.ok(await browser.until('!document.querySelector(".shell-catalog")'), "Escape exits Catalog");
    await browser.close(); browser = null;
  }
  browser = await openPage(`http://127.0.0.1:${core.port}/?shell=1&sample`, { width: 390, height: 844 });
  assert.ok(await browser.until('!!document.querySelector(".apps-title")'), "classic Apps entry");
  await browser.evaluate('document.querySelector(".apps-title").click()');
  assert.ok(await browser.until('!!document.querySelector(".apps-catalog button")'));
  await browser.evaluate('document.querySelector(".apps-catalog button").focus(); document.querySelector(".apps-catalog button").click()');
  assert.ok(await browser.until('document.querySelectorAll("dialog.catalog[open] .app-parts").length === 3'), "classic Catalog has saved apps");
  await browser.evaluate('document.querySelector(".catalog .app-parts > summary").click()');
  assert.ok(await browser.until('document.querySelector(".catalog .app-parts").open'));
  await key("Escape", "Escape", 27);
  assert.ok(await browser.until('!document.querySelector("dialog.catalog")'), "classic modal exits");
  assert.equal(await browser.evaluate('document.activeElement === document.querySelector(".apps-catalog button")'), true, "classic focus restored");
  await browser.close(); browser = null;
  assert.equal(core.heard.filter(m => mutations.has(m.type)).length, 0, "inspection sends no app mutations");
  if (process.argv[2]) {
    await open(`${process.argv[2]}/?sample`, 1440);
    await browser.evaluate('document.querySelectorAll(".app-parts").forEach(el => el.open = true)');
    const text = await browser.evaluate('document.querySelector(".shell-catalog").textContent');
    for (const name of ["Argument resolver", "Volume watcher", "Search-first", "Used in 3 apps", "not executed", "No AI key"]) assert.ok(text.includes(name), `real sample: ${name}`);
    await browser.evaluate('document.querySelectorAll(".app-parts")[2].scrollIntoView({block:"start"})');
    if (shots) writeFileSync(`${shots}/parts-real-sample.png`, Buffer.from((await browser.page("Page.captureScreenshot", { format: "png" })).data, "base64"));
    await browser.close(); browser = null;
  }
  console.log("i-parts-check: ok (availability, reuse, read-only, keyboard, 320px, enlarged text, disconnect" + (process.argv[2] ? ", real Rust sample" : "") + ")");
} finally { await browser?.close(); core.close(); }
