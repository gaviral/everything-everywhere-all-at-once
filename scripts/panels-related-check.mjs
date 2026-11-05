// Synthetic state only: the real built page, repository server/CDP helpers and installed Chrome.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uiServer } from "./ui-server.mjs";
import { openPage, ready, sleep, standInCore } from "./headless.mjs";

// Chrome is the only child. It inherits no provider credentials; no core or provider is started.
for (const name of Object.keys(process.env)) if (/KEY|TOKEN|SECRET|CREDENTIAL|PASSWORD|^(META|OPENAI|ANTHROPIC|MUSE|AWS|AZURE)_/i.test(name)) delete process.env[name];
assert.equal(ready(), "", "build UI and install Chrome (or set CHROME) before running this check");
const shots = mkdtempSync(join(tmpdir(), "f7-related-"));
const at = 1800000000000;
const topic = (id, title, touched_ms = at, parent_id = null, tags = []) => ({ id, title, touched_ms, parent_id, tags, status: "open", last_point: "", picture: null, dropped_by: "" });
const thought = (id, thread_id, point, n = 0, text = point) => ({ id, thread_id, point, text, speaker: "Colleague", placed: true, complete: true, unclear: "", at_ms: at + n, place_ms: 0 });
const kept = [{ name: "Climate", kept: true }];
const threads = [topic("seed", "Solar garden", at + 10, null, kept), topic("match-a", "Solar planner", at + 5, null, kept),
  topic("match-b", "Garden notes", at + 4), topic("match-c", "Garden logs", at + 4), topic("unrelated", "Sports scores"), topic("child", "Solar garden child", at + 9, "seed", kept)];
const thoughts = [thought("seed-point", "seed", "Soil water", 1), thought("a-old", "match-a", "Soil water from last season.", 2),
  thought("a", "match-a", "Soil water for the seedlings.", 3, "Keep the soil water for the seedlings. These are the original words."),
  thought("b", "match-b", "Soil water in pots.", 4), thought("c", "match-c", "Soil water near the path.", 5),
  thought("u", "unrelated", "Final sports results.", 6), thought("ch", "child", "Soil water", 7)];
const makeWorld = (ts = threads, ps = thoughts, active = null) => ({ threads: ts, thoughts: ps, active, active_by: active ? { you: active } : {},
  stay_here: null, anchors: {}, notes: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], proposals: [], ai: [] });
let world = makeWorld();
const server = await uiServer();
try {
  const { relatedThoughts } = await server.ssrLoadModule("/src/bricks/related-thoughts/rules.ts");
  const select = (ts = threads, ps = thoughts, active = "seed") => relatedThoughts(ts, ps, active);
  const ranked = select();
  assert.deepEqual(ranked.candidates.map(c => [c.id, c.score]), [["match-a", 8], ["match-b", 4], ["match-c", 4]]);
  assert.equal(ranked.candidates[0].excerpt, thoughts[2].point, "newest matching point");
  assert.equal(ranked.candidates[0].original, thoughts[2].text);
  assert.equal(select(threads, thoughts, null).selected, false);
  const pair = [topic("seed", "ÉCOLE １２３ the and have with"), topic("other", "école 123 the and have with")];
  assert.equal(select(pair, []).candidates[0].score, 4, "Unicode, case, width and exact stop words");
  assert.equal(select([topic("seed", "still only"), topic("other", "still only")], []).candidates[0].score, 4, "no extra stop words");
  assert.equal(select([topic("seed", "solar"), topic("other", "none")], [thought("weak", "other", "solar")]).candidates.length, 0, "score below two excluded");
  const family = [...threads.map(t => t.id === "seed" ? { ...t, parent_id: "parent" } : t), topic("parent", "Solar garden"), topic("grandchild", "Solar garden", at, "child")];
  assert.deepEqual(select(family).candidates.map(c => c.id), ["match-a", "match-b", "match-c"], "all ancestors and descendants excluded");
  assert.equal(select([topic("seed", "none"), topic("other", "zero")], [thought("old", "other", "soil water"), ...Array.from({length: 6}, (_, i) => thought(`new${i}`, "other", "zero", i + 1)), thought("s", "seed", "soil water")]).candidates.length, 0, "latest six placed points only");
  const unkept = threads.map(t => ({ ...t, tags: [{ name: "Climate", kept: false }] }));
  assert.equal(select(unkept).candidates[0].score, 4, "suggested tags do not score");
  assert.equal(select([topic("seed", "solar"), topic("other", "solar")], []).candidates[0].excerpt, "solar", "title fallback");
  const capped = select([topic("seed", "soil water"), topic("other", "x".repeat(4000) + " soil water")], []);
  assert.equal(capped.characterCap, true); assert.equal(capped.candidates.length, 0, "no match beyond character budget");
} finally { await server.close(); }

const core = await standInCore(() => [{ type: "snapshot", world }], { onMessage(message) {
  if (message.type === "focus") {
    world = { ...world, active: message.thread_id, active_by: { you: message.thread_id } };
    core.send({ type: "change", change: { type: "active_changed", thread_id: message.thread_id, speaker: "you" } });
  }
} });
assert.ok(![4360, 4399].includes(core.port), "ephemeral test port");
let browser;
try {
  browser = await openPage("about:blank");
  const { page, evaluate, until } = browser;
  const errors = [], requests = [];
  await page("Page.enable"); await page("Runtime.enable"); await page("Network.enable");
  browser.on("Runtime.exceptionThrown", e => errors.push(e.exceptionDetails.text));
  browser.on("Network.requestWillBeSent", e => requests.push(e.request.url));
  await page("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('e2a2o.toured','1'); window.mediaCalls=0; navigator.mediaDevices.getUserMedia=async()=>{window.mediaCalls++;throw new Error('Real input forbidden in synthetic check')};` });
  const url = `http://127.0.0.1:${core.port}/`;
  const wait = async (expression, label) => assert.ok(await until(expression, 12000), label);
  const click = async selector => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`);
    const p = await evaluate(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    for (const type of ["mousePressed", "mouseReleased"]) await page("Input.dispatchMouseEvent", { type, ...p, button: "left", clickCount: 1 });
  };
  const key = async (key, code, n) => { for (const type of ["keyDown", "keyUp"]) await page("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: n, ...(type === "keyDown" && key === "Enter" ? { text: "\r" } : {}) }); };
  const enter = () => key("Enter", "Enter", 13), escape = () => key("Escape", "Escape", 27);
  const focus = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  const type = async (selector, text) => { await focus(selector); await page("Input.insertText", { text }); };
  const ids = () => evaluate(`[...document.querySelectorAll('[data-related-id]')].map(e=>e.dataset.relatedId)`);
  const trayOpen = () => wait(`!!document.querySelector('.related-thoughts-tray')`, "tray open");
  const shot = async name => { const { data } = await page("Page.captureScreenshot", { format: "png" }); writeFileSync(join(shots, `${name}.png`), Buffer.from(data, "base64")); };
  const layout = async label => {
    const geometry = await evaluate(`(() => {const r=e=>{const b=e.getBoundingClientRect();return {left:b.left,top:b.top,right:b.right,bottom:b.bottom}};return {width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,tray:r(document.querySelector('.related-thoughts-tray')),input:r(document.querySelector('textarea[aria-label="Type a thought"]')),trigger:r(document.querySelector('.related-thoughts-trigger'))}})()`);
    assert.ok(geometry.scroll <= geometry.width, `${label}: no sideways overflow`);
    for (const name of ["tray", "input", "trigger"]) { const r = geometry[name]; assert.ok(r.left >= 0 && r.right <= geometry.width + 1 && r.top >= 0 && r.bottom <= geometry.height, `${label}: ${name} within viewport: ${JSON.stringify(geometry)}`); }
    assert.ok(geometry.tray.bottom <= geometry.input.top, `${label}: input clear of tray`);
    for (const selector of ['.related-thoughts-top button', '[data-related-id="match-c"] .related-thoughts-tools button:last-child']) {
      await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'nearest'})`);
      assert.ok(await evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e)return true;const b=e.getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight&&b.left>=0&&b.right<=innerWidth})()`), `${label}: controls reachable`);
    }
    await evaluate(`document.querySelector('.related-thoughts-tray').scrollTop=0`);
  };
  await page("Page.navigate", { url });
  await wait(`!!document.querySelector('.spine-ready') && !!document.querySelector('textarea')`, "baseline app mounted");
  await sleep(700);
  assert.equal(await evaluate(`!!document.querySelector('[data-brick="related-thoughts"]')`), false, "fresh storage: no feature UI");
  assert.equal(await evaluate(`localStorage.getItem('e2a2o.bricks')`), null, "fresh feature storage");
  assert.equal(core.heard.some(m => JSON.stringify(m).includes("related-thoughts")), false, "off: no feature messages");
  assert.equal(requests.some(r => /related-thoughts|warm/i.test(r)), false, "off: no feature chunk or warm requests");
  await click('[data-guide="catalog"]');
  await wait(`!!document.querySelector('[role="switch"][aria-label="Related thoughts"]')`, "Features has switch");
  const toggle = '[role="switch"][aria-label="Related thoughts"]';
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-checked')`), "false");
  const beforeEnable = core.heard.length;
  await click(toggle); await wait(`!!document.querySelector('.related-thoughts-trigger')`, "enabled UI");
  assert.deepEqual(core.heard.slice(beforeEnable).filter(m => m.type !== "heartbeat"), [], "enable sends nothing");
  await page("Page.reload");
  await wait(`!!document.querySelector('.related-thoughts-trigger')`, "switch persists after reload");
  await focus('.related-thoughts-trigger'); await enter(); await trayOpen();
  assert.ok(await evaluate(`document.querySelector('.related-thoughts-tray').textContent.includes('Choose a topic first.')`), "unselected state");
  await escape();
  assert.ok(await evaluate(`document.activeElement.matches('.related-thoughts-trigger')`), "Escape returns focus");
  // Select the seed through the app's real Find navigation.
  await type('.shell-find input', 'Solar garden'); await wait(`!!document.querySelector('.shell-find-row')`, "Find seed"); await enter();
  for (let i = 0; world.active !== 'seed' && i < 100; i++) await sleep(50);
  assert.equal(world.active, 'seed', 'Find sends seed navigation');
  if (!await until(`!!document.querySelector('.react-flow__viewport')`, 5000)) {
    await shot('navigation-diagnostic');
    throw new Error(`No Canvas after Find: ${JSON.stringify({errors, body:await evaluate('document.body.innerText.slice(0,1200)'),shots})}`);
  }
  await sleep(800);
  assert.equal(world.active, "seed", "real Find focus contract");
  await type('textarea[aria-label="Type a thought"]', 'Synthetic draft stays here');
  const camera = () => evaluate(`document.querySelector('.react-flow__viewport').style.transform`);
  const savedMic = await evaluate(`document.querySelector('.mic')?.outerHTML ?? null`);
  const savedCamera = await camera(), before = core.heard.length, requestCount = requests.length;
  await focus('.related-thoughts-trigger'); await enter(); await trayOpen();
  assert.deepEqual(await ids(), ["match-a", "match-b", "match-c"], "ranked three, child and unrelated excluded");
  const evidence = await evaluate(`[...document.querySelectorAll('[data-related-id]')].map(e=>({id:e.dataset.relatedId,excerpt:e.querySelector('blockquote').textContent,reason:e.querySelector('.related-thoughts-reason').textContent,speaker:e.querySelector('.related-thoughts-meta').textContent,time:e.querySelector('time').dateTime}))`);
  assert.deepEqual(evidence.map(e => e.excerpt), [thoughts[2].point, thoughts[3].point, thoughts[4].point]);
  assert.deepEqual(evidence.map(e => e.reason), ['Shared kept tags: climate · Shared title words: solar · Shared words: soil, water', 'Shared title words: garden · Shared words: soil, water', 'Shared title words: garden · Shared words: soil, water']);
  assert.ok(evidence.every(e => e.speaker.startsWith('Colleague · ') && e.time));
  await focus('[data-related-id="match-a"] .related-thoughts-tools button'); await enter();
  assert.equal(await evaluate(`document.querySelector('.related-thoughts-original').textContent`), thoughts[2].text, "verbatim original by keyboard");
  assert.equal(world.active, "seed"); assert.equal(await camera(), savedCamera, "opening and expanding leave camera alone");
  assert.equal(await evaluate(`document.querySelector('textarea').value`), 'Synthetic draft stays here');
  assert.equal(await evaluate(`document.querySelector('.mic')?.outerHTML ?? null`), savedMic, 'mic state unchanged');
  assert.equal(await evaluate('window.mediaCalls'), 0, 'no real device input');
  assert.deepEqual(core.heard.slice(before).filter(m => m.type !== "heartbeat"), [], "opening and expanding send nothing");
  assert.deepEqual(requests.slice(requestCount), [], "opening and expanding request nothing");
  await layout('desktop'); await shot('desktop-light');
  await page("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await page("Emulation.setEmulatedMedia", { features: [{name:'prefers-color-scheme',value:'dark'}, {name:'prefers-reduced-motion',value:'reduce'}] });
  await sleep(400); await layout('phone dark reduced motion'); await shot('phone-dark');
  // Text enlargement, not a screenshot scale: real font metrics grow to 200%.
  await evaluate(`window.textCheck=document.createElement('style');textCheck.textContent='html{font-size:200% !important} .related-thoughts{font-size:1rem !important}';document.head.append(textCheck)`);
  await layout('phone 200% text'); await shot('phone-200');
  await evaluate(`textCheck.remove()`);
  await focus('[data-related-id="match-a"] .related-thoughts-tools button:last-child'); await enter();
  await wait(`!document.querySelector('.related-thoughts-tray')`, "Open topic closes tray");
  assert.equal(world.active, "match-a", "Open topic uses existing focus navigation");
  assert.equal(await evaluate(`document.querySelector('textarea').value`), 'Synthetic draft stays here', "navigation preserves draft");
  // Push real protocol changes; no selector mirror is substituted for the rendered UI.
  core.send({type:'change',change:{type:'active_changed',thread_id:'seed',speaker:'you'}}); world = makeWorld(threads, thoughts, 'seed');
  await click('.related-thoughts-trigger'); await trayOpen();
  core.send({type:'change',change:{type:'thought_repointed',thought_id:'a',point:'Soil water updated verbatim.'}});
  await wait(`document.querySelector('[data-related-id="match-a"] blockquote').textContent==='Soil water updated verbatim.'`, "source point update immediately shown");
  core.send({type:'change',change:{type:'thought_skipped',thought_id:'b'}});
  core.send({type:'change',change:{type:'thread_removed',thread_id:'match-b'}});
  await wait(`!document.querySelector('[data-related-id="match-b"]')`, "removed topic drops immediately");
  const many = [...threads, ...Array.from({length:295},(_,i)=>topic(`extra${i}`,`Unmatched archive ${i}`,at-i))];
  world = makeWorld(many, thoughts, 'seed'); core.send({type:'snapshot',world});
  await wait(`document.querySelector('.related-thoughts-coverage')?.textContent.includes('300 most recently touched topics')`, "301 topics: explicit coverage");
  world = makeWorld([topic('seed','Garden')], [thought('s','seed','x'.repeat(4001))], 'seed'); core.send({type:'snapshot',world});
  await wait(`document.querySelector('.related-thoughts-coverage')?.textContent.includes('4,000 characters')`, "character coverage");
  assert.ok(await evaluate(`document.querySelector('.related-thoughts-tray').textContent.includes('No possible connections')`), "honest no-match state");
  world = makeWorld([], [], null); core.send({type:'snapshot',world});
  await wait(`document.querySelector('.related-thoughts-tray')?.textContent.includes('Choose a topic first.')`, "empty map");
  await layout('empty phone'); await shot('phone-empty');
  // Close button returns focus too, and Tab reaches the first labeled control after the trigger.
  await click('.related-thoughts-top button');
  assert.ok(await evaluate(`document.activeElement.matches('.related-thoughts-trigger')`));
  await enter(); await trayOpen(); await key('Tab','Tab',9);
  assert.ok(await evaluate(`document.activeElement.matches('.related-thoughts-top button')`), "native Tab order");
  assert.equal(await evaluate(`getComputedStyle(document.activeElement).outlineStyle`), 'solid', "visible keyboard focus");
  await escape();
  world = makeWorld(threads, thoughts, 'seed'); core.send({type:'snapshot',world});
  await click('.related-thoughts-trigger'); await trayOpen();
  await click('[data-guide="catalog"]'); await wait(`!!document.querySelector(${JSON.stringify(toggle)})`, 'Features reopened with tray open');
  await click(toggle); await wait(`!document.querySelector('[data-brick="related-thoughts"]')`, 'disable removes UI');
  await click('.shell-rail-close');
  await type('textarea[aria-label="Type a thought"]',' works');
  assert.equal(await evaluate(`document.querySelector('textarea').value`), 'Synthetic draft stays here works', 'baseline typing after disable');
  // Listener cleanup: an orphan Escape capture would prevent the baseline Find Escape from clearing its query.
  await type('.shell-find input','Solar'); await escape();
  assert.equal(await evaluate(`document.querySelector('.shell-find input').value`), '', 'off: baseline Escape works');
  const off = core.heard.length;
  core.send({type:'change',change:{type:'thought_repointed',thought_id:'a',point:'Changed while hidden'}});
  await sleep(250);
  assert.deepEqual(core.heard.slice(off).filter(m=>m.type!=='heartbeat'), [], 'off: source updates cause no outbound work');
  await page('Page.reload'); await wait(`!!document.querySelector('.spine-ready')`, 'disabled reload baseline');
  assert.equal(await evaluate(`!!document.querySelector('[data-brick="related-thoughts"]')`), false, 'off persists');
  assert.ok(requests.every(r=>r.startsWith(url)||r.startsWith('data:')||r.startsWith('ws://127.0.0.1:')), 'no external requests');
  assert.deepEqual(errors, [], 'no browser exceptions');
  console.log(`PASS f7-related: selector, real Features gate/persistence/cleanup, ranked evidence, unchanged place/draft/messages, navigation, live edits/removal, both coverage caps, keyboard, empty/narrow/200% layouts. Synthetic screenshots: ${shots}`);
} finally { await browser?.close(); core.close(); }
