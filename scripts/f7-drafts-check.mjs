// Synthetic state only. Built app + repository fixture/CDP helpers; no provider, app data or live device input.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPage, ready, sleep, standInCore } from "./headless.mjs";
import { uiServer } from "./ui-server.mjs";

// headless.mjs spawns only our Chrome, inheriting this credential-free environment.
for (const key of Object.keys(process.env)) if (/KEY|TOKEN|SECRET|CREDENTIAL|PASSWORD/i.test(key)) delete process.env[key];
// This named acceptance command always exercises a browser, even when a wider source-only precheck disabled pages.
process.env.PRECHECK_PAGES = "1";
assert.equal(ready(), "", "installed Chrome and built UI required (CHROME override supported)");
const shots = mkdtempSync(join(tmpdir(), "e2a2o-f7-drafts-"));
console.log(`f7-drafts-check: synthetic screenshots in ${shots}`);
const world = { threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [], merged: {},
  apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], topics: {} };
const fixture = await standInCore(() => [{ type: "map_identity", id: "synthetic-pocket-map" }, { type: "snapshot", world }], {
  onMessage(message) { if (message.type === "text") fixture.send({ type: "text_received", id: message.id }); },
});
assert.ok(![4360, 4399].includes(fixture.port), "fixture uses an ephemeral port");
let browser;
const STORE = "e2a2o.draftPocket.v1";
const input = 'textarea[aria-label="Type a thought"]';
const pocketInput = "#draft-pocket-input";
const switchSelector = '[role="switch"][aria-label="Draft pocket"]';
const count = () => browser.evaluate('document.querySelectorAll(".draft-pocket-entry").length');
const messages = () => fixture.heard.filter(m => !["heartbeat", "conversation", "read"].includes(m.type));
const textMessages = () => fixture.heard.filter(m => m.type === "text");
async function key(key, code, windowsVirtualKeyCode) {
  await browser.page("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode,
    ...(key === "Enter" ? { text: "\r" } : key === " " ? { text: " " } : {}) });
  await browser.page("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
}
async function fill(selector, value) {
  await browser.evaluate(`(() => {
    const field = document.querySelector(${JSON.stringify(selector)}); field.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(value)});
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}
async function clickText(text, selector = ".draft-pocket button") {
  assert.ok(await browser.evaluate(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find(b => b.textContent === ${JSON.stringify(text)}); if (!b || b.disabled) return false; b.click(); return true; })()`), `clickable ${text}`);
}
async function features() {
  await browser.evaluate(`[...document.querySelectorAll('[data-slot="top-right"] button')].find(b => b.textContent.includes('Features')).click()`);
  assert.ok(await browser.until(`!!document.querySelector(${JSON.stringify(switchSelector)})`), "Features lists Draft pocket");
}
async function toggle(expected) {
  await features();
  await browser.evaluate(`document.querySelector(${JSON.stringify(switchSelector)}).focus()`);
  await key(" ", "Space", 32);
  assert.ok(await browser.until(`document.querySelector(${JSON.stringify(switchSelector)}).getAttribute('aria-checked') === '${expected}'`), "switch responds to keyboard");
  await browser.evaluate('document.querySelector(".shell-rail-close").click()');
}
async function openPocket() {
  assert.ok(await browser.until('!!document.querySelector(".draft-pocket-trigger")'), "pocket mounted");
  await sleep(100);
  await browser.evaluate('document.querySelector(".draft-pocket-trigger").focus()');
  await key("Enter", "Enter", 13);
  const opened = await browser.until('!!document.querySelector("#draft-pocket-input")');
  if (!opened) await shot("keyboard-open-failure");
  assert.ok(opened, "keyboard opens pocket: " + JSON.stringify(await browser.evaluate(`({ focus: document.activeElement?.outerHTML, expanded: document.querySelector('.draft-pocket-trigger').getAttribute('aria-expanded'), errors: __errors })`)));
}
async function save(text) { await fill(pocketInput, text); await clickText("Save draft"); }
async function shot(name) {
  const { data } = await browser.page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(join(shots, `${name}.png`), Buffer.from(data, "base64"));
}
async function layout(width, height, scheme = "light", enlarged = false) {
  await browser.page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 720 });
  await browser.page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "reduce" }] });
  await browser.evaluate(`document.documentElement.style.fontSize = ${JSON.stringify(enlarged ? "32px" : "")}`);
  await sleep(100);
  const result = await browser.evaluate(`(() => {
    const p = document.querySelector('.draft-pocket'), r = p.getBoundingClientRect();
    const composer = document.querySelector(${JSON.stringify(input)}).getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, composerTop: composer.top, composerBottom: composer.bottom,
      overflow: p.scrollWidth > p.clientWidth + 1, documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      controls: [...p.querySelectorAll('button, textarea')].every(e => e.getBoundingClientRect().width > 0 && e.scrollWidth <= e.clientWidth + 2) };
  })()`);
  assert.ok(result.left >= 0 && result.right <= width && result.top >= 0 && result.bottom <= height, `${width}: pocket on screen: ${JSON.stringify(result)}`);
  assert.ok(result.composerTop >= result.bottom - 1 && result.composerBottom <= height, `${width}: independent main input clear of pocket`);
  assert.equal(result.overflow || result.documentOverflow, false, `${width}: no horizontal overflow`);
  assert.equal(result.controls, true, `${width}: controls wrap without cropping`);
}

try {
  browser = await openPage("about:blank");
  await browser.page("Page.enable");
  await browser.page("Page.addScriptToEvaluateOnNewDocument", { source: `
    localStorage.setItem('e2a2o.toured', '1');
    window.__errors = [];
    addEventListener('error', e => { if (!/^ResizeObserver loop/.test(e.message)) __errors.push(e.message); });
    addEventListener('unhandledrejection', e => __errors.push(String(e.reason)));
  ` });
  await browser.page("Page.navigate", { url: `http://127.0.0.1:${fixture.port}/` });
  assert.ok(await browser.until(`!!document.querySelector(${JSON.stringify(input)}) && !!document.querySelector('.shell-welcome')`));
  await sleep(150);
  assert.equal(await browser.evaluate(`!!document.querySelector('[data-brick="draft-pocket"]') || sessionStorage.getItem('${STORE}') !== null`), false, "fresh storage means no pocket UI or store");
  assert.equal(await browser.evaluate("performance.getEntriesByType('resource').some(r => /draft-pocket/.test(r.name))"), false, "off does not warm feature code");
  assert.equal(messages().some(m => JSON.stringify(m).includes("draft-pocket")), false, "off emits no feature messages");

  // Compare disabled behavior later; enabling must add reload protection for the separate main input.
  const mainDraft = "Synthetic main input stays independent";
  await fill(input, mainDraft);
  await browser.page("Page.reload");
  assert.ok(await browser.until(`!!document.querySelector(${JSON.stringify(input)})`));
  const baselineReload = await browser.evaluate(`document.querySelector(${JSON.stringify(input)}).value`);
  await fill(input, mainDraft);
  await toggle("true");
  await openPocket();
  await key("Escape", "Escape", 27);
  assert.equal(await browser.evaluate('!!document.querySelector(".draft-pocket-body")'), false, "Escape works from the opener too");
  await openPocket();
  assert.match(await browser.evaluate('document.querySelector(".draft-pocket").textContent'), /No drafts here yet/);
  await layout(1440, 900); await shot("desktop-empty");
  await layout(390, 844); await shot("phone-empty");
  await layout(1440, 900);
  await key("Tab", "Tab", 9);
  assert.equal(await browser.evaluate('document.activeElement.textContent'), "Close", "Tab reaches the labeled Close control");
  await key("Tab", "Tab", 9);
  assert.equal(await browser.evaluate('document.activeElement.id'), "draft-pocket-input", "Tab reaches the independent editor");
  assert.notEqual(await browser.evaluate('getComputedStyle(document.activeElement).outlineStyle'), "none", "keyboard focus is visible");
  const beforeSave = messages().length;
  const first = "Synthetic first draft\nFull second line, including spacing.  ";
  const second = "Synthetic second draft";
  await save(first); await save(second);
  assert.equal(await count(), 2);
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(input)}).value`), mainDraft, "saving never takes main input");
  await clickText("Edit");
  assert.equal(await browser.evaluate(`document.querySelector('${pocketInput}').value`), first, "edit exposes complete original text");
  const edited = first + "\nAn edit kept locally.";
  await fill(pocketInput, edited); await clickText("Save changes");
  assert.equal(messages().length, beforeSave, "save/edit emit zero socket mutations");
  await fill(pocketInput, "Keyboard adds a line");
  await key("Enter", "Enter", 13);
  assert.ok(await browser.evaluate(`document.querySelector('${pocketInput}').value.includes(String.fromCharCode(10))`), "Enter adds a line rather than sending");
  assert.equal(messages().length, beforeSave);
  await fill(pocketInput, "");
  await key("Escape", "Escape", 27);
  assert.equal(await browser.evaluate('document.activeElement.className'), "draft-pocket-trigger", "Escape closes and returns focus");
  await browser.page("Page.reload");
  assert.ok(await browser.until('!!document.querySelector(".draft-pocket-trigger")'), "enabled switch survives reload");
  await features();
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(switchSelector)}).getAttribute('aria-checked')`), "true");
  await browser.evaluate('document.querySelector(".shell-rail-close").click()');
  await openPocket();
  assert.equal(await count(), 2, "two pocket drafts survive reload");
  assert.deepEqual(await browser.evaluate(`JSON.parse(sessionStorage.getItem('${STORE}')).people.you.map(d => d.text)`), [edited, second]);
  const reloadedMain = await browser.evaluate(`document.querySelector(${JSON.stringify(input)}).value`);
  assert.equal(reloadedMain, mainDraft, "both saved drafts and the independent main input survive reload");
  const changedMain = "Synthetic updated main input\nKeep all spacing.  ";
  await fill(input, changedMain);
  await browser.page("Page.reload");
  await openPocket();
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(input)}).value`), changedMain, "latest main input survives another reload exactly");
  await fill(input, mainDraft);

  // Substitute only the mounted brick's action, so real rendered controls exercise false/true boolean handling.
  // On true, delegate through the real host action into the real socket path; nothing is patched on disk.
  await browser.evaluate(`(() => {
    const element = document.querySelector('.draft-pocket');
    let fiber = element[Object.keys(element).find(k => k.startsWith('__reactFiber'))];
    while (fiber && !fiber.memoizedProps?.actions) fiber = fiber.return;
    if (!fiber) throw new Error('mounted brick action missing');
    const actions = fiber.memoizedProps.actions, original = actions.addThought;
    window.__send = { allow: false, attempts: [], accepted: 0, disabled: [] };
    actions.addThought = text => {
      __send.attempts.push(text);
      __send.disabled.push(document.querySelector('.draft-pocket-entry button:nth-child(2)').disabled);
      if (!__send.allow) return false;
      const ok = original(text); if (ok) __send.accepted++; return ok;
    };
  })()`);
  await clickText("Send as thought");
  assert.match(await browser.evaluate('document.querySelector(".draft-pocket").textContent'), /Not submitted/);
  assert.equal(await browser.evaluate('document.querySelector(".draft-pocket-entry button:nth-child(2)").textContent.trim()'), "Retry");
  assert.equal(await browser.evaluate(`JSON.parse(sessionStorage.getItem('${STORE}')).people.you[0].text`), edited, "false retains full text");
  assert.equal(textMessages().length, 0);
  await browser.evaluate(`__send.allow = true; const b = document.querySelector('.draft-pocket-entry button:nth-child(2)'); b.click(); b.click();`);
  assert.ok(await browser.until('__send.accepted === 1'), "exactly one successful submission");
  assert.deepEqual(await browser.evaluate('__send.attempts'), [edited, edited], "retry submits complete stored words once");
  assert.deepEqual(await browser.evaluate('__send.disabled'), [true, true], "send disabled synchronously before each action");
  assert.ok(await browser.until('document.querySelector(".draft-pocket-entry").textContent.includes("Submitted to E2A2O")'));
  assert.equal(await count(), 2, "accepted entry retained");
  await sleep(100);
  assert.equal(textMessages().length, 1);
  assert.equal(textMessages()[0].text, edited);
  await browser.page("Page.reload");
  await openPocket();
  await sleep(150);
  assert.equal(textMessages().length, 1, "reload does not resubmit");
  assert.equal(await browser.evaluate('document.querySelector(".draft-pocket-entry button:nth-child(2)").disabled'), true);
  const beforeDelete = messages().length;
  await clickText("Delete"); assert.equal(await count(), 1);
  await clickText("Undo"); assert.equal(await count(), 2);
  assert.equal(await browser.evaluate('document.querySelector(".draft-pocket-entry button:nth-child(2)").disabled'), true, "Undo preserves submitted status");
  assert.equal(messages().length, beforeDelete, "delete/undo emit zero mutations");

  for (let n = 3; n <= 8; n++) await save(`Synthetic parked draft ${n}`);
  const full = await browser.evaluate(`sessionStorage.getItem('${STORE}')`);
  await save("Synthetic ninth draft");
  assert.equal(await count(), 8);
  assert.match(await browser.evaluate('document.querySelector(".draft-pocket-status").textContent'), /Eight drafts is the limit/);
  assert.equal(await browser.evaluate(`sessionStorage.getItem('${STORE}')`), full, "ninth overwrites nothing");
  assert.equal(await browser.evaluate(`document.querySelector('${pocketInput}').value`), "Synthetic ninth draft");
  await fill(pocketInput, "x".repeat(2001)); await clickText("Save draft");
  assert.match(await browser.evaluate('document.querySelector(".draft-pocket-status").textContent'), /Nothing was cut/);
  assert.equal(await browser.evaluate(`document.querySelector('${pocketInput}').value.length`), 2001);
  await fill(pocketInput, "");
  await clickText("Edit");
  await key("Escape", "Escape", 27);
  assert.equal(await browser.evaluate('document.activeElement.textContent'), "Edit", "Escape cancels editing and returns focus");
  assert.ok(await browser.evaluate('!!document.querySelector(".draft-pocket-body")'), "cancel edit keeps the pocket open");
  await layout(1440, 900); await shot("desktop");
  await layout(390, 844); await shot("phone");
  await layout(390, 844, "dark"); await shot("phone-dark");
  await layout(390, 844, "dark", true);
  // At 200%, a scrolling form must reveal each whole field/control when Tab focuses it.
  // Chrome centers newly focused controls; it need not show the entire form simultaneously.
  await browser.evaluate('document.querySelector(".draft-pocket-trigger").focus()');
  await key("Tab", "Tab", 9); await key("Tab", "Tab", 9);
  assert.equal(await browser.evaluate('document.activeElement.id'), "draft-pocket-input");
  for (const control of ["input", "save"]) {
    if (control === "save") {
      await key("Tab", "Tab", 9);
      assert.equal(await browser.evaluate('document.activeElement.textContent'), "Save draft");
    }
    const bounds = await browser.evaluate(`(() => {
      const body = document.querySelector('.draft-pocket-body').getBoundingClientRect();
      const r = document.activeElement.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, bodyTop: body.top, bodyBottom: body.bottom, width: innerWidth };
    })()`);
    await shot(`phone-200-percent-${control}`);
    assert.ok(bounds.top >= bounds.bodyTop && bounds.bottom <= bounds.bodyBottom && bounds.left >= 0 && bounds.right <= bounds.width,
      `200% keyboard reveals the whole ${control}: ${JSON.stringify(bounds)}`);
  }
  await browser.evaluate('document.querySelector(".draft-pocket-entry").scrollIntoView({block:"start"})');
  await shot("phone-200-percent-entries");
  await clickText("Close");
  assert.equal(await browser.evaluate('document.activeElement.className'), "draft-pocket-trigger", "Close returns focus");
  await layout(1440, 900);
  const beforeMainSend = textMessages().length;
  await browser.evaluate(`document.querySelector(${JSON.stringify(input)}).focus()`);
  await key("Enter", "Enter", 13);
  assert.ok(await browser.until(`document.querySelector(${JSON.stringify(input)}).value === ''`), "restored main input still submits normally");
  await sleep(100);
  assert.equal(textMessages().length, beforeMainSend + 1);
  assert.equal(textMessages().at(-1).text, mainDraft, "restoration updates the host's controlled input state");
  await browser.page("Page.reload");
  await openPocket();
  assert.equal(await count(), 8);
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(input)}).value`), "", "submitted main input cannot return from an older backup");
  assert.equal(textMessages().length, beforeMainSend + 1, "main-input reload never auto-submits");
  await fill(input, mainDraft);
  const beforeOff = messages().length;
  await toggle("false");
  assert.ok(await browser.until('!document.querySelector(".draft-pocket")'), "disable unmounts all feature UI");
  await sleep(150);
  assert.equal(messages().length, beforeOff, "disable leaves no feature background work");
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(input)}).value`), mainDraft, "off preserves current main input");
  assert.deepEqual(await browser.evaluate(`JSON.parse(sessionStorage.getItem('${STORE}')).people`), JSON.parse(full).people, "off preserves pocket");
  const offStore = await browser.evaluate(`sessionStorage.getItem('${STORE}')`);
  await browser.evaluate("window.dispatchEvent(new Event('pagehide'))");
  assert.equal(await browser.evaluate(`sessionStorage.getItem('${STORE}')`), offStore, "disable removes the reload listener");
  // The baseline input still uses Enter; no feature keyboard listener remains.
  await browser.evaluate(`document.querySelector(${JSON.stringify(input)}).focus()`);
  await key("Enter", "Enter", 13);
  assert.ok(await browser.until(`document.querySelector(${JSON.stringify(input)}).value === ''`), "baseline Enter submits after disabling");
  await sleep(100);
  assert.equal(textMessages().at(-1).text, mainDraft);
  await fill(input, "Synthetic input while disabled");
  await browser.page("Page.reload");
  assert.ok(await browser.until(`!!document.querySelector(${JSON.stringify(input)})`));
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(input)}).value`), baselineReload, "disabled reload behavior matches the fresh baseline");
  await toggle("true"); await openPocket(); assert.equal(await count(), 8, "re-enable restores same-tab entries");
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(input)}).value`), baselineReload, "re-enable cannot resurrect an older main input");
  assert.deepEqual(await browser.evaluate('__errors'), [], "no browser errors");

  // Denied storage in the real enabled UI: keep in memory through hide/show, with a visible warning.
  await clickText("Delete");
  await browser.evaluate(`window.__setItem = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v) {
    if (k === '${STORE}') throw new DOMException('synthetic denial', 'QuotaExceededError');
    return __setItem.call(this, k, v);
  };`);
  await save("Synthetic memory-only draft");
  assert.equal(await count(), 8);
  assert.match(await browser.evaluate('document.querySelector(".draft-pocket-warning").textContent'), /stay in memory/);
  await toggle("false"); await toggle("true"); await openPocket();
  assert.ok(await browser.evaluate('document.querySelector(".draft-pocket").textContent.includes("Synthetic memory-only draft")'));
  await browser.evaluate('Storage.prototype.setItem = __setItem');

  // The actual pure store: identities, exact character/serialized-byte bounds and no silent replacement.
  const server = await uiServer();
  try {
    const memory = new Map();
    globalThis.sessionStorage = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
    const rules = await server.ssrLoadModule("/src/bricks/draft-pocket/rules.ts");
    const draft = text => ({ id: String(Math.random()), text, saved: 1, submitted: false });
    assert.equal(rules.keep("synthetic-A", [draft("a".repeat(2000))]), "");
    assert.equal(rules.pocketFor("synthetic-B").entries.length, 0, "map.me identities never share drafts");
    assert.match(rules.textError("a".repeat(2001)), /2,000/);
    assert.equal(rules.textError("a".repeat(2000)), "");
    const eight = Array.from({ length: 8 }, () => draft("界".repeat(2000)));
    const before = memory.get(STORE);
    assert.match(rules.keep("synthetic-B", eight), /40 KiB/);
    assert.equal(memory.get(STORE), before, "serialized-byte refusal changes nothing");
    assert.equal(rules.pocketFor("synthetic-B").entries.length, 0);
    rules.keepInput("synthetic-A", "Synthetic input backup");
    assert.equal(rules.takeInput("synthetic-B"), undefined, "input backups are person-scoped too");
    assert.equal(rules.takeInput("synthetic-A"), "Synthetic input backup");
    assert.equal(rules.takeInput("synthetic-A"), undefined, "input backups restore only once");
    rules.keepInput("synthetic-A", "x".repeat(41 * 1024));
    assert.match(rules.warning(), /Keep a copy before reloading/);
    assert.ok(Buffer.byteLength(memory.get(STORE)) <= rules.MAX_BYTES, "input backup respects total serialized cap without trimming");
    assert.equal(rules.takeInput("synthetic-A"), undefined, "oversized input cannot leave a stale backup");
  } finally { delete globalThis.sessionStorage; await server.close(); }
  writeFileSync(join(shots, "results.json"), JSON.stringify({ feature: "draft-pocket", screenshots: shots, gaps: [] }, null, 2));
  console.log(`f7-drafts-check: feature assertions passed; synthetic screenshots: ${shots}`);
  console.log("f7-drafts-check: ok");
} finally {
  await browser?.close();
  fixture.close();
}
