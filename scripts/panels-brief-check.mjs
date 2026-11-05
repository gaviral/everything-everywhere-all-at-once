// Synthetic, isolated real-app checks. No core, providers, user stores or device input.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";
import { uiServer } from "./ui-server.mjs";

// Chrome inherits only the test environment with provider credentials removed (names only are examined).
for (const name of Object.keys(process.env)) if (/KEY|TOKEN|SECRET|CREDENTIAL|PASSWORD/i.test(name)) delete process.env[name];
assert.equal(ready(), "", "build the UI and install Chrome (or set CHROME)");
const shots = mkdtempSync(join(tmpdir(), "f7-brief-shots-"));
const at = Date.UTC(2026, 0, 2, 12);
const topic = (id, title, parent_id = null) => ({ id, title, parent_id, status: "open", last_point: "", touched_ms: at, tags: [], picture: null, dropped_by: "" });
const thought = (id, point, offset, extra = {}) => ({ id, text: point, point, speaker: "Colleague", thread_id: "T1", placed: true, complete: true, unclear: "", at_ms: at + offset, place_ms: 0, ...extra });
const base = {
  threads: [topic("T1", "Garden *plan*"), topic("T2", "Tangent", "T1"), topic("T3", "Other topic")],
  // Deliberately out of time order: latest selection is sorted by source timestamps.
  thoughts: [thought("p2", "Check light", 2000, { speaker: "Helper" }), thought("p1", "Use blue pots", 1000, { text: "Decided: use **blue** pots", decided: true }), thought("tan1", "Tangent words", 3000, { thread_id: "T2" }), thought("other", "Excluded words", 4000, { thread_id: "T3" }), thought("waiting", "Unplaced words", 5000, { placed: false })],
  active: "T1", active_by: { you: "T1" }, ai: ["Helper"], stay_here: null, anchors: {}, notes: {},
  suggestions: [{ id: "s1", thread_id: "T1", text: "Try a shelf", status: "new" }, { id: "s2", thread_id: "T1", text: "Already handled", status: "done" }],
  actions: [{ id: "a1", thread_id: "T1", kind: "reminder", title: "Measure the ledge", when: "Tomorrow", status: "new", done_ms: null }],
  merged: {}, apps: [], apps_seeded: true, recaps: [], proposals: [],
};
let world = structuredClone(base);
const core = await standInCore(() => [{ type: "snapshot", world }]);
assert.ok(core.port !== 4360 && core.port !== 4399);
const pages = [];
const server = await uiServer();
try {
  const { buildBrief, BRIEF_LIMIT } = await server.ssrLoadModule("/src/bricks/topic-brief/rules.ts");
  const snapshot = (value) => ({ ...value, reminders: value.actions, speakers: new Map([["Helper", { ai: true }], ["Colleague", { ai: false }]]) });
  const pure = buildBrief(snapshot(world), false, at);
  assert.match(pure, /# Topic brief: Garden \\\*plan\\\*/);
  assert.match(pure, /Generated at: 2026-01-02T12:00:00.000Z/);
  // A descendant cycle terminates and includes each topic's thoughts just once.
  const cycle = structuredClone(world); cycle.threads[0].parent_id = "T2";
  assert.equal((buildBrief(snapshot(cycle), true, at).match(/Source: tan1;/g) ?? []).length, 1);
  const unsafe = structuredClone(world); unsafe.thoughts[0].point = '[link](https://example.invalid/?invite=synthetic) <tag> ?room=synthetic';
  const escaped = buildBrief(snapshot(unsafe), false, at);
  assert.ok(!escaped.includes("https://") && !escaped.includes("room=") && !escaped.includes("invite="));
  assert.ok(escaped.includes('\\[link\\]') && escaped.includes('\\<tag\\>'));
  const many = structuredClone(world); many.thoughts = Array.from({ length: 12 }, (_, n) => thought(`n${n}`, `Whole record ${n}`, n));
  const latest = buildBrief(snapshot(many), false, at);
  assert.ok(!latest.includes("Source: n0;") && !latest.includes("Source: n1;"));
  assert.match(latest, /2 outside latest ten/);
  assert.ok(latest.indexOf("Source: n2;") < latest.indexOf("Source: n11;"));
  const huge = structuredClone(world); huge.thoughts = [thought("big", "🌱".repeat(8000), 1), thought("small", "Whole small record", 2)];
  const bounded = buildBrief(snapshot(huge), false, at);
  assert.ok(Buffer.byteLength(bounded) <= BRIEF_LIMIT);
  assert.match(bounded, /Latest placed thoughts: 1\/2 included, 1 omitted \(1 by size cap/);
  assert.ok(!bounded.includes("Source: big;") && bounded.includes("Source: small;") && !bounded.includes("�"));

  const open = async (width = 1440) => {
    const browser = await openPage("about:blank", { width, height: width === 390 ? 844 : 900 }); pages.push(browser);
    await browser.page("Page.enable");
    await browser.page("Page.addScriptToEvaluateOnNewDocument", { source: `
      localStorage.setItem('e2a2o.toured','1');
      window.errors=[]; window.saves=[]; window.savedBlobs=[];
      addEventListener('error',e=>{if(!e.message.startsWith('ResizeObserver')) errors.push(e.message)});
      addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
      // Stub the existing saveFile helper's browser boundary; never save a real file.
      URL.createObjectURL = blob => { savedBlobs.push(blob); return 'blob:synthetic-'+savedBlobs.length; };
      URL.revokeObjectURL = () => {};
      HTMLAnchorElement.prototype.click = function() { if(this.download) saves.push({name:this.download, href:this.href}); };
    ` });
    await browser.page("Page.navigate", { url: `http://127.0.0.1:${core.port}/` });
    assert.ok(await browser.until(`!!document.querySelector('.spine-ready')`, 10000));
    return browser;
  };
  const click = (browser, text) => browser.evaluate(`[...document.querySelectorAll('button')].find(b=>(${JSON.stringify(text)}==='Features' ? b.textContent.trim().startsWith('Features') : b.textContent.trim()===${JSON.stringify(text)})).click()`);
  const key = async (browser, key, code, n) => {
    for (const type of ["keyDown", "keyUp"]) await browser.page("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: n });
  };
  const toggle = async (browser) => {
    await click(browser, "Features");
    assert.ok(await browser.until(`!!document.querySelector('[data-row="topic-brief"] [role="switch"]')`));
    await browser.evaluate(`document.querySelector('[data-row="topic-brief"] [role="switch"]').focus()`);
    await key(browser, " ", "Space", 32);
    await click(browser, "Features");
  };
  const previewText = (browser) => browser.evaluate(`document.querySelector('#topic-brief-preview')?.value`);
  const screenshot = async (browser, name) => {
    const { data } = await browser.page("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(shots, name), Buffer.from(data, "base64"));
  };
  const desktop = await open();
  assert.equal(await desktop.evaluate(`!!document.querySelector('[data-brick="topic-brief"]')`), false, "fresh storage has no brief UI");
  assert.ok(!await desktop.evaluate(`performance.getEntriesByType('resource').some(r=>/topic-brief/.test(r.name))`), "no feature warm request while off");
  assert.ok(!core.heard.some(m => /brief/.test(JSON.stringify(m))), "no feature-specific messages while off");
  await toggle(desktop);
  assert.ok(await desktop.until(`!!document.querySelector('.topic-brief-trigger')`));
  assert.equal(await desktop.evaluate("saves.length"), 0, "enabling never downloads");
  await desktop.page("Page.reload");
  assert.ok(await desktop.until(`!!document.querySelector('.topic-brief-trigger')`, 10000), "switch persists");
  await desktop.evaluate(`document.querySelector('.topic-brief-trigger').focus()`);
  await key(desktop, " ", "Space", 32);
  assert.ok(await desktop.until(`document.activeElement?.id==='topic-brief-preview'`), `keyboard opens and focuses preview: ${await desktop.evaluate("JSON.stringify({focus:document.activeElement?.outerHTML,card:document.querySelector('.topic-brief')?.outerHTML})")}`);
  let text = await previewText(desktop);
  assert.equal(text.replace(/Generated at: [^\n]+/, "Generated at: 2026-01-02T12:00:00.000Z"), pure, "real UI exact initial scope/order/labels");
  assert.match(text, /speaker: Helper \(AI speaker\)/);
  assert.match(text, /speaker: Colleague \(person\)/);
  assert.match(text, /Original words:\n  > Decided: use \\\*\\\*blue\\\*\\\* pots/);
  assert.ok(!/Tangent words|Excluded words|Unplaced words|Already handled/.test(text));
  await desktop.evaluate(`document.querySelector('.topic-brief-scope input').focus()`);
  await key(desktop, " ", "Space", 32);
  assert.ok(await desktop.until(`document.querySelector('#topic-brief-preview').value.includes('Source: tan1;')`));
  text = await previewText(desktop);
  assert.ok(text.includes("Scope: Active topic and descendant tangents; 2 topic(s)."));
  const latestSection = text.split("## Latest placed thoughts")[1];
  assert.ok(latestSection.indexOf("Source: p1;") < latestSection.indexOf("Source: p2;") && latestSection.indexOf("Source: p2;") < latestSection.indexOf("Source: tan1;"));
  await key(desktop, "Escape", "Escape", 27);
  assert.ok(await desktop.until(`!document.querySelector('.topic-brief-form') && document.activeElement?.classList.contains('topic-brief-trigger')`));
  await click(desktop, "Preview brief");
  assert.ok(await desktop.evaluate(`document.querySelector('.topic-brief-scope input').checked`), "dismiss preserves scope");
  // Freeze after lazy loading; a Download click must make zero network requests or map messages.
  const requests = [];
  await desktop.page("Network.enable"); desktop.on("Network.requestWillBeSent", e => requests.push(e.request.url));
  const messages = core.heard.length;
  await click(desktop, "Download");
  assert.equal(await desktop.evaluate("saves.length"), 1);
  const saved = await desktop.evaluate(`(async()=>({name:saves[0].name,mime:savedBlobs[0].type,bytes:savedBlobs[0].size,text:await savedBlobs[0].text()}))()`);
  assert.equal(saved.name, "topic-brief.md"); assert.equal(saved.mime, "text/markdown");
  assert.equal(saved.text, text); assert.equal(saved.bytes, Buffer.byteLength(text));
  assert.ok(saved.bytes <= BRIEF_LIMIT); assert.deepEqual(requests, []);
  assert.ok(core.heard.slice(messages).every(m=>m.type==='heartbeat'), "no external or map action");
  assert.match(await desktop.evaluate(`document.querySelector('.topic-brief-status').textContent`), /Handed to browser/);
  world.thoughts[0].point = "Changed source point";
  core.send({ type: "snapshot", world });
  assert.ok(await desktop.until(`document.querySelector('#topic-brief-preview')?.value.includes('Changed source point')`));
  assert.equal(await desktop.evaluate(`document.querySelector('.topic-brief-status').textContent`), "Updated from your map");
  assert.ok(!(await previewText(desktop)).includes("Point: Check light"));
  await screenshot(desktop, "desktop.png");
  await desktop.evaluate(`const e=document.querySelector('textarea:not(#topic-brief-preview)'); e.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Synthetic draft'); e.dispatchEvent(new Event('input',{bubbles:true}));`);
  await toggle(desktop);
  assert.ok(await desktop.until(`!document.querySelector('[data-brick="topic-brief"]')`), "disable unmounts form and work");
  assert.equal(await desktop.evaluate(`document.querySelector('textarea').value`), "Synthetic draft", "input draft remains");
  await desktop.evaluate(`document.querySelector('textarea').focus()`);
  await desktop.page("Input.insertText", {text:"x"});
  assert.equal(await desktop.evaluate(`document.querySelector('textarea').value`), "Synthetic draftx", "baseline typing still edits the draft");
  assert.ok(await desktop.evaluate(`document.activeElement.tagName==='TEXTAREA' && !document.querySelector('.topic-brief-form')`), "baseline keyboard input stays available");
  assert.deepEqual(await desktop.evaluate("errors"), []);

  const phone = await open(390);
  await phone.page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }, { name: "prefers-reduced-motion", value: "reduce" }] });
  await toggle(phone);
  assert.ok(await phone.until(`!!document.querySelector('.topic-brief-trigger')`));
  await click(phone, "Preview brief");
  assert.ok(await phone.until(`!!document.querySelector('#topic-brief-preview')`));
  // 200% text throughout the feature and input, with essential controls still reachable in normal scrolling.
  await phone.evaluate(`document.querySelector('.topic-brief').style.fontSize='32px'; document.querySelector('textarea:not(#topic-brief-preview)').style.fontSize='32px'`);
  assert.ok(await phone.evaluate(`document.documentElement.scrollWidth<=innerWidth`), "phone has no horizontal overflow");
  for (const selector of ['.topic-brief-trigger', '.topic-brief-scope', '#topic-brief-preview', '.topic-brief-form button:last-child', 'textarea:not(#topic-brief-preview)']) {
    assert.ok(await phone.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({block:'nearest'}); const r=e.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && r.height>0 && r.top>=0 && r.bottom<=innerHeight})()`), `${selector} reachable at 200% text`);
  }
  await phone.evaluate(`document.querySelector('#topic-brief-preview').focus()`);
  await screenshot(phone, "phone-dark-200.png");
  world = huge; core.send({ type: "snapshot", world });
  assert.ok(await phone.until(`document.querySelector('#topic-brief-preview')?.value.includes('Source: small;')`));
  const capped = await previewText(phone);
  assert.ok(Buffer.byteLength(capped) <= BRIEF_LIMIT); assert.match(capped, /1 omitted \(1 by size cap/); assert.ok(!capped.includes("Source: big;"));
  world = { ...structuredClone(base), threads: [], thoughts: [], active: null, active_by: {}, actions: [], suggestions: [] }; core.send({ type: "snapshot", world });
  assert.ok(await phone.until(`document.querySelector('.topic-brief-form')?.textContent.includes('Choose an active topic') && !document.querySelector('#topic-brief-preview')`));
  assert.ok(await phone.evaluate(`document.documentElement.scrollWidth<=innerWidth && ![...document.querySelectorAll('.topic-brief button')].some(b=>b.textContent==='Download')`));
  await screenshot(phone, "phone-empty.png");
  await phone.evaluate(`document.querySelector('.topic-brief-form button').focus()`); await key(phone, "Escape", "Escape", 27);
  assert.ok(await phone.until(`document.activeElement?.classList.contains('topic-brief-trigger')`));
  assert.deepEqual(await phone.evaluate("errors"), []);

  // The public host action is also reachable in the real playground, including boundary refusals.
  const playground = await openPage(`http://127.0.0.1:${core.port}/bricks.html?brick=topic-brief&sample=empty`); pages.push(playground);
  assert.ok(await playground.until(`!!window.brickActions?.saveTextFile`, 10000));
  assert.equal(await playground.evaluate(`['../x.md','x/y.md','x?room=synthetic.md','a'.repeat(81)].every(n=>brickActions.saveTextFile(n,'safe','text/markdown')===false)`), true);
  assert.equal(await playground.evaluate(`brickActions.saveTextFile('safe.md','x','text/html')`), false);
  assert.equal(await playground.evaluate(`brickActions.saveTextFile('safe.md','🌱'.repeat(16385),'text/plain')`), false);
  await playground.evaluate(`window.handoffs=[]; URL.createObjectURL=blob=>{handoffs.push(blob);return 'blob:synthetic'}; URL.revokeObjectURL=()=>{}; HTMLAnchorElement.prototype.click=function(){}`);
  assert.equal(await playground.evaluate(`brickActions.saveTextFile('safe.txt','🌱'.repeat(16384),'text/plain')`), true, "host accepts the 64 KiB UTF-8 boundary");
  assert.equal(await playground.evaluate(`handoffs[0].size`), 65536);
  assert.match(readFileSync(new URL('../ui/src/App.tsx',import.meta.url),'utf8'), /saveTextFile:.*saveFile\(text, mime, name\)/);
  console.log(`PASS f7-brief: real gate/reload/cleanup, exact preview, tangents, labels/order, keyboard, live update, capped whole records, download boundary/no network, phone/dark/reduced-motion/200%, empty. Screenshots: ${shots}`);
} finally {
  await Promise.all(pages.map(browser => browser.close()));
  core.close(); await server.close();
}
