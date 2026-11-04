// Synthetic supplied rows and the built app in an isolated Chrome profile; no real services or microphone.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "../ui/node_modules/react/index.js";
import ReactDOMServer from "../ui/node_modules/react-dom/server.node.js";
import { uiServer } from "./ui-server.mjs";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

globalThis.location = new URL("http://localhost/");
const cameraOnly = process.argv.includes("--camera-only");
const remainingPages = process.argv.includes("--remaining-pages");
const layoutOnly = process.argv.includes("--layout-only");
const trafficOnly = process.argv.includes("--traffic-only");
const offFocusOnly = process.argv.includes("--off-focus-only");
if (!process.argv.includes("--repair-pages") && !cameraOnly && !remainingPages && !layoutOnly && !trafficOnly && !offFocusOnly) {
const modules = await uiServer();
try {
  const { readOrganization, ordinaryCatalogRoute, newCatalogSession } = await modules.ssrLoadModule("/src/shell/catalog/preference.ts");
  for (const value of [null, "", "null", "{}", "[]", '"true"', "1", "broken", "false"]) assert.equal(readOrganization(value), false);
  assert.equal(readOrganization("true"), true);
  for (const query of ["?film", "?recording", "?demo", "?shell=1", "?cards", "?remote"]) assert.equal(ordinaryCatalogRoute(query, "/"), false);
  assert.equal(ordinaryCatalogRoute("", "/"), true);
  const { canonicalRows, matchingRows, taskOf, OTHER } = await modules.ssrLoadModule("/src/shell/catalog/organization.ts");
  const { FEATURE_NAMES } = await modules.ssrLoadModule("/src/shell/names.ts");
  const rows = Object.entries(FEATURE_NAMES).map(([id, named]) => ({ id, kind: "panel", ...named, does: named.does ?? "", on: false, savedOn: false, core: false, toggle() {} }));
  for (const [alias, id] of [["List view", "cards"], ["Gallery", "pictures"], ["Voice input", "listening"], ["Summary", "recap"], ["Countdown", "countdown"], ["One big board", "spine"]]) {
    assert.equal(matchingRows(rows, alias).filter((row) => row.id === id).length, 1, alias);
  }
  const unknown = { id: "future-feature", kind: "panel", name: "A later supplied feature with a very long readable name", does: "Actual supplied purpose", on: false, savedOn: true, core: false, disabled: true, disabledReason: "Fixture policy", toggle() {} };
  assert.equal(taskOf(unknown), OTHER);
  assert.deepEqual(canonicalRows([unknown, unknown]).map((row) => row.id), [unknown.id]);
  assert.equal(matchingRows([unknown], "later supplied")[0], unknown);
  const app = { ...unknown, id: "app-fixture", name: "Synthetic app name", kind: "app" };
  assert.equal(matchingRows([app], app.name)[0], app);
  const { default: Organized } = await modules.ssrLoadModule("/src/shell/catalog/OrganizedCatalog.tsx");
  const html = ReactDOMServer.renderToStaticMarkup(React.createElement(Organized, { rows: [unknown], at: null, currentView: "map", active: true, session: { ...newCatalogSession(), task: OTHER } }));
  assert.ok(html.includes(unknown.name) && html.includes(unknown.disabledReason));
  assert.equal((html.match(/role="switch"/g) ?? []).length, 1);
  assert.ok(html.includes("disabled="), "policy is preserved for later rows");
  console.log("supplied rows: aliases, canonical IDs, unknown fallback, app names and policy ok");
} finally { await modules.close(); }
}

if (ready()) { console.log(`SKIP chief-catalog-usable-check pages: ${ready()}`); process.exit(3); }
const shots = process.env.SHOTS ?? mkdtempSync(join(tmpdir(), "catalog-usable-shots-"));
const at = Date.now();
const world = {
  threads: [{ id: "T1", title: "Synthetic project", parent_id: null, status: "open", last_point: "A synthetic thought", touched_ms: at, tags: [], picture: null, dropped_by: "" }],
  thoughts: [{ id: "p1", speaker: "you", text: "A synthetic thought", point: "A synthetic thought", thread_id: "T1", placed: true, complete: true, at_ms: at, place_ms: 0 }],
  active: "T1", active_by: { you: "T1" }, stay_here: "T1", anchors: {}, notes: {}, suggestions: [], actions: [], merged: {}, recaps: [], proposals: [], ai: [], apps_seeded: true,
  apps: [{ id: "fixture", name: "Synthetic app with a long name for wrapping on a narrow screen", purpose: "A supplied local fixture app.", watcher: { kind: "app_request" }, prompt: null, publishers: [], enabled: false, request: "Synthetic fixture", cooldown_secs: 60, created_ms: at, last_run_ms: 0 }],
};
const core = await standInCore(() => [{ type: "snapshot", world }]);
assert.ok(![4360, 4399].includes(core.port));
const base = `http://127.0.0.1:${core.port}/`;
let browser;
const init = `localStorage.setItem('e2a2o.toured','1'); window.errors=[]; window.mediaAttempts=0;
  addEventListener('error',e=>{if(!e.message.startsWith('ResizeObserver')) errors.push(e.message)});
  if(navigator.mediaDevices) navigator.mediaDevices.getUserMedia=()=>{window.mediaAttempts++; return Promise.reject(new Error('Synthetic check: microphone unavailable'))};`;
try {
  for (const width of remainingPages || layoutOnly || trafficOnly || offFocusOnly ? [390] : [1440, 390]) {
    browser = await openPage("about:blank", { width, height: 900 });
    const { page, evaluate, until } = browser;
    await page("Page.enable");
    await page("Page.addScriptToEvaluateOnNewDocument", { source: init });
    await page("Page.navigate", { url: base });
    assert.ok(await until(`!!document.querySelector('.spine-ready') && !!document.querySelector('textarea')`, 12000), "Canvas ready");
    await sleep(500);
    if (trafficOnly) {
      assert.equal(await evaluate('window.mediaAttempts'), 0);
      console.log('synthetic startup control types: ' + [...new Set(core.heard.map(message => message.type))].join(', '));
      await browser.close(); browser = null; continue;
    }
    // A real pan makes camera restoration distinguishable from a default reset.
    for (const event of [{ type: 'mousePressed', x: width - 70, y: 230, button: 'left', buttons: 1, clickCount: 1 },
      { type: 'mouseMoved', x: width - 100, y: 330, button: 'left', buttons: 1 },
      { type: 'mouseReleased', x: width - 100, y: 330, button: 'left', buttons: 0, clickCount: 1 }]) await page('Input.dispatchMouseEvent', event);
    await sleep(300);
    const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const text = (selector, value) => evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    const loaded = () => evaluate(`performance.getEntriesByType('resource').filter(e=>/OrganizedCatalog[^/]*\.(js|css)/.test(e.name)).map(e=>e.name)`);
    const snap = async (name) => { const { data } = await page("Page.captureScreenshot", { format: "png" }); writeFileSync(join(shots, `${width}-${name}.png`), Buffer.from(data, "base64")); };
    const draft = "Keep this exact draft while I inspect features.";
    await text("textarea", draft);
    await evaluate(`document.querySelector('textarea').focus(); document.querySelector('textarea').setSelectionRange(5,20,'backward')`);
    const draftState = () => evaluate(`(() => { const e=document.querySelector('textarea'); return [e.value,e.selectionStart,e.selectionEnd,e.selectionDirection]; })()`);
    const expectedDraft = await draftState();
    const camera = () => evaluate(`document.querySelector('.react-flow__viewport')?.style.transform`);
    const before = await camera();
    await click('[data-guide="catalog"]');
    assert.ok(await until(`!!document.querySelector('.shell-catalog [data-row="cards"]')`));
    assert.equal(await evaluate(`document.querySelector('[data-catalog-preference] button').getAttribute('aria-checked')`), "false", "fresh profile opens original list");
    assert.deepEqual(await loaded(), [], "baseline requests no organized JS/CSS handlers");
    assert.equal(await evaluate(`document.querySelector('[data-row="cards"] [role=switch]').getAttribute('aria-checked')`), "false");
    await click("[data-catalog-preference] button");
    assert.ok(await until(`!!document.querySelector('[data-organized-catalog] input')`, 10000));
    assert.ok((await loaded()).length >= 2, "renderer and scoped CSS load after opt-in");
    await text("[data-organized-catalog] input", "List view");
    assert.ok(await until(`document.querySelectorAll('[data-organized-catalog] [data-row]').length===1`));
    assert.equal(await evaluate(`document.querySelector('[data-organized-catalog] [data-row]').dataset.row`), "cards", "alias finds same canonical Cards row");
    await click('[data-catalog-focus="inspect-cards"]');
    assert.ok(await until(`!!document.querySelector('[data-detail="cards"]')`));
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.organized-detail dd')].map(e=>e.textContent)`), ["Off", "Off"]);
    await click('.organized-detail [role="switch"]');
    assert.ok(await until(`document.querySelector('.organized-detail [role=switch]')?.getAttribute('aria-checked')==='true'`));
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('e2a2o.features')).cards`), true, "real capability saved once");
    assert.equal(await evaluate(`!!document.querySelector('main[aria-label="Cards"]')`), false, "On does not navigate");
    assert.equal(await camera(), before, "inspection and switching preserve camera");
    assert.deepEqual(await draftState(), expectedDraft);
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.organized-detail dd')].map(e=>e.textContent)`), ["On", "On"]);
    if (offFocusOnly) {
      await click('[data-catalog-preference] button');
      assert.ok(await until(`document.activeElement?.closest('[data-row]')?.dataset.row==='cards'`), 'deep Off returns focus to the original Cards row');
      assert.ok(await evaluate(`(()=>{const r=document.activeElement.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()`), 'Off focus is visible');
      assert.deepEqual(await draftState(), expectedDraft);
      console.log('deep Off focus repair 390px: same original Cards row visible; draft and selection intact');
      await snap('off-focus');
      await browser.close(); browser = null; continue;
    }
    await snap("inspect");
    await evaluate(`[...document.querySelectorAll('.organized-detail button')].find(e=>e.textContent==='Show').click()`);
    assert.ok(await until(`!!document.querySelector('main[aria-label="Cards"]') && !document.querySelector('[data-slot="rail"]')`));
    assert.deepEqual(await draftState(), expectedDraft, "Show restores exact draft selection");
    assert.equal(await evaluate(`document.activeElement===document.querySelector('textarea')`), true, "Show returns typing focus");
    if (layoutOnly) {
      await click('[data-guide="catalog"]');
      assert.ok(await until(`!!document.querySelector('[data-detail="cards"]')`));
      await click('[data-catalog-focus="back"]');
      await text('[data-organized-catalog] input', 'Synthetic app');
      await sleep(300);
      const bounds = await evaluate(`(()=>{const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right}};return {off:box('[data-catalog-preference] button'),close:box('.shell-rail-close'),rail:box('.shell-rail'),scrollY, panelScroll:document.querySelector('.shell-tabpanel').scrollTop}})()`);
      console.log('mobile search geometry: ' + JSON.stringify(bounds));
      await snap('search-controls');
      for (const rect of [bounds.off, bounds.close]) assert.ok(rect.top>=0&&rect.bottom<=900&&rect.left>=0&&rect.right<=390, 'mobile search Off/Close reachable');
      await browser.close(); browser = null; continue;
    }
    if (cameraOnly) {
      await click('.shell-bl button');
      assert.ok(await until(`!document.querySelector('main[aria-label="Cards"]') && !!document.querySelector('.spine-ready')`, 10000));
      await sleep(700);
      assert.equal(await camera(), before, "return from Show preserves panned Canvas camera");
      assert.deepEqual(await draftState(), expectedDraft);
      console.log(`camera repair ${width}px: panned Canvas → Show Cards → return; exact camera and draft ok`);
      await browser.close(); browser = null; continue;
    }
    await click('[data-guide="catalog"]');
    assert.ok(await until(`!!document.querySelector('[data-detail="cards"]')`), "detail restored on reopen");
    assert.deepEqual(await draftState(), expectedDraft);
    for (const selector of ['[data-catalog-preference] button', '.shell-rail-close']) assert.ok(await evaluate(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return r.top>=0&&r.left>=0&&r.bottom<=innerHeight&&r.right<=innerWidth; })()`), `${width}: Off/Close reachable`);
    await click('[data-catalog-focus="back"]');
    assert.ok(await until(`document.querySelector('[data-organized-catalog] input')?.value==='List view'`), "Back restores query");
    assert.equal(await evaluate(`document.activeElement?.dataset.catalogFocus`), "inspect-cards", "Back returns inspection focus");
    await click('[data-catalog-focus="inspect-cards"]');
    await click('[data-catalog-preference] button');
    assert.ok(await until(`!!document.querySelector('.shell-catalog [data-row="cards"]') && !document.querySelector('[data-organized-catalog]')`), "deep Off restores original list");
    assert.equal(await evaluate(`document.querySelector('[data-row="cards"] [role=switch]').getAttribute('aria-checked')`), "true", "Off keeps real capability choices");
    assert.deepEqual(await draftState(), expectedDraft);
    await snap("original-restored");
    await click('[data-catalog-preference] button');
    assert.ok(await until(`!!document.querySelector('[data-detail="cards"]')`), "Off/On preserves detail session");
    await click('.shell-rail-close');
    assert.ok(await until(`!document.querySelector('[data-slot="rail"]')`));
    assert.deepEqual(await draftState(), expectedDraft, "Close preserves draft and selection");
    await click('.shell-bl button');
    assert.ok(await until(`!document.querySelector('main[aria-label="Cards"]') && !!document.querySelector('.spine-ready')`, 10000));
    await sleep(700);
    assert.equal(await camera(), before, "return from Show preserves Canvas camera");
    await click('[data-guide="catalog"]');
    await click('[data-catalog-focus="back"]');
    await text('[data-organized-catalog] input', 'Synthetic app');
    assert.ok(await until(`document.querySelector('[data-row="app-fixture"]')?.textContent.includes('Synthetic app with a long name')`), "live app names searchable");
    await snap("app-search");
    assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), true, "no page overflow");
    assert.equal(await evaluate("window.mediaAttempts"), 0);
    assert.deepEqual(await evaluate("window.errors"), []);
    console.log(`happy path ${width}px: original → opt-in → alias → Inspect → On → Show → resume → Back → deep Off; camera/draft/focus ok`);
    await browser.close(); browser = null;
  }
  if (!cameraOnly && !layoutOnly && !trafficOnly && !offFocusOnly) {
  // Saved preference never changes film/recording/demo/classic/remote visits.
  browser = await openPage("about:blank");
  const { page, evaluate, until } = browser;
  await page("Page.enable");
  await page("Page.addScriptToEvaluateOnNewDocument", { source: init + `localStorage.setItem('e2a2o.catalog-organization','true');` });
  for (const route of ["?film", "?recording", "?demo", "?shell=1", "?cards", "?remote"]) {
    await page("Page.navigate", { url: base + route });
    assert.ok(await until(`!!document.querySelector('#root')?.textContent.trim()`, 10000), route);
    if (!["?shell=1", "?cards", "?remote"].includes(route)) {
      assert.ok(await until(`!!document.querySelector('[data-guide="catalog"]')`));
      await evaluate(`document.querySelector('[data-guide="catalog"]').click()`);
      assert.ok(await until(`!!document.querySelector('.shell-catalog [data-row]')`));
    }
    assert.equal(await evaluate(`!!document.querySelector('[data-catalog-preference], [data-organized-catalog]')`), false, route);
    assert.deepEqual(await evaluate(`performance.getEntriesByType('resource').filter(e=>/OrganizedCatalog[^/]*\.(js|css)/.test(e.name)).map(e=>e.name)`), [], route + " loads no organized handlers/CSS");
  }
  // A failed lazy import leaves Off reachable and the actual original list usable.
  await page("Fetch.enable", { patterns: [{ urlPattern: "*OrganizedCatalog*", requestStage: "Request" }] });
  browser.on("Fetch.requestPaused", ({ requestId }) => { page("Fetch.fulfillRequest", { requestId, responseCode: 503, body: "" }).catch(() => {}); });
  await page("Page.navigate", { url: base });
  assert.ok(await until(`!!document.querySelector('[data-guide="catalog"]')`));
  await evaluate(`document.querySelector('[data-guide="catalog"]').click()`);
  assert.ok(await until(`document.querySelector('.catalog-presentation')?.textContent.includes('could not load')`, 10000), "load failure handled");
  assert.equal(await evaluate(`document.querySelectorAll('[data-catalog-preference] button').length`), 1, "one reachable Off on failure");
  await evaluate(`document.querySelector('[data-catalog-preference] button').click()`);
  assert.ok(await until(`!!document.querySelector('.shell-catalog [data-row="cards"]') && !document.querySelector('.catalog-presentation')`));
  console.log("excluded routes and failed lazy load: ok; synthetic fixtures only");
  }
  const execution = core.heard.filter((message) => ["text", "compose_app", "app_output", "run_app", "email_send", "publish", "post"].includes(message.type) || message.type === "listen" && message.on === true);
  assert.deepEqual(execution, [], "no execution, microphone start or text send; email/partner policy sync is not execution");
  console.log(`chief-catalog-usable-check: ok; screenshots ${shots}`);
} finally { await browser?.close(); core.close(); }
