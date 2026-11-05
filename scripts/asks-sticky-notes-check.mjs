// Synthetic mounted-app fixture. No provider, source files, mic, journals or live service.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ready, standInCore, openPage } from "./headless.mjs";
import { uiServer } from "./ui-server.mjs";

for (const name of Object.keys(process.env)) if (/KEY|TOKEN|SECRET|CREDENTIAL|PASSWORD/i.test(name)) delete process.env[name];
if (ready()) { console.log(`SKIP sticky-notes mounted checks: ${ready()}`); process.exit(3); }
const shots = mkdtempSync(join(tmpdir(), "sticky-notes-shots-"));
const at = Date.UTC(2026, 0, 2);
const topic = { id: "topic-a", title: "Synthetic garden", parent_id: null, status: "open", last_point: "", touched_ms: at, tags: [], picture: null, dropped_by: "" };
const thought = id => ({ id, speaker: "Colleague", text: "  Keep the blue pots.\nColleaguee words.  ", point: "A summarized point", thread_id: topic.id, placed: true, complete: true, unclear: "", at_ms: at + (id === "source-b" ? 1000 : 0), place_ms: 0 });
let world = { threads: [topic], thoughts: [thought("source-a"), thought("source-b")], active: topic.id, active_by: { Colleague: topic.id, Reviewer: topic.id },
  ai: [], anchors: {}, notes: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], proposals: [] };
let identity = "synthetic-map-a";
const core = await standInCore(() => [{ type: "map_identity", id: identity }, { type: "snapshot", world }], { door: { room: true, member: true } });
assert.ok(core.port > 1024 && ![4360, 4399].includes(core.port));
const server = await uiServer();
const pages = [];
try {
  const rules = await server.ssrLoadModule("/src/bricks/sticky-notes/rules.ts");
  const { layoutKey, decodeLayout, emptyLayout, pin, refresh } = rules;
  let layout = pin(pin(emptyLayout(), world.thoughts[0], [topic]), world.thoughts[1], [topic]);
  assert.equal(layout.references.length, 2, "same words have distinct reference IDs");
  assert.strictEqual(pin(layout, world.thoughts[0], [topic]), layout, "pin is idempotent by ID");
  for (let i = 0; i < 20; i++) layout = pin(layout, thought(`limit-${i}`), [topic]);
  assert.equal(layout.references.length, 12, "twelve-reference bound");
  assert.deepEqual(decodeLayout(JSON.stringify(layout)), layout);
  for (const raw of ['{', '{"version":2}', JSON.stringify({ ...layout, draft: "x".repeat(6001) }), JSON.stringify({ ...layout, references: [layout.references[0], layout.references[0]] })]) assert.equal(decodeLayout(raw), null);
  assert.notEqual(layoutKey("a", "b,c"), layoutKey("a,b", "c"));
  const revised = refresh(layout, [{ ...world.thoughts[0], text: "Edited accepted source" }], [topic]);
  assert.equal(revised.references[0].quote, "Edited accepted source");
  assert.equal(revised.references[1].quote, world.thoughts[1].text);
  assert.strictEqual(refresh(revised, [], []), revised, "deletion retains historical quote");

  const click = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const key = async (page, key, code, n) => {
    for (const type of ["keyDown", "keyUp"]) await page.page("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: n,
      ...(type === "keyDown" && key === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}) });
  };
  const openNotes = async page => {
    await page.evaluate(`document.querySelector('.sticky-notes-trigger').focus()`);
    await key(page, "Enter", "Enter", 13);
    const opened = await page.until(`!!document.querySelector('.sticky-notes-form') && document.activeElement.tagName==='SELECT'`);
    if (!opened) {
      const { data } = await page.page("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(shots, "open-failure.png"), Buffer.from(data, "base64"));
      console.log("Open diagnostic", await page.evaluate(`({feature:document.querySelector('.sticky-notes')?.outerHTML,focus:document.activeElement?.outerHTML,errors})`), shots);
    }
    assert.ok(opened, "keyboard opens and focuses source chooser");
  };
  const toggle = async page => {
    await page.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('Features')).click()`);
    assert.ok(await page.until(`!!document.querySelector('[data-row="sticky-notes"] [role="switch"]')`));
    await click(page, '[data-row="sticky-notes"] [role="switch"]');
    await page.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('Features')).click()`);
  };
  const open = async (width = 1440) => {
    const page = await openPage("about:blank", { width, height: width === 390 ? 844 : 1000 }); pages.push(page);
    await page.page("Page.enable");
    await page.page("Page.addScriptToEvaluateOnNewDocument", { source: `
      localStorage.setItem('e2a2o.toured','1');
      if(!sessionStorage.getItem('e2a2o.joined')) sessionStorage.setItem('e2a2o.joined','Colleague');
      window.errors=[]; addEventListener('error',e=>{if(!e.message.startsWith('ResizeObserver')) errors.push(e.message)});
      addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
      // Count the form's unique capture handler; the baseline app has its own keyboard listeners.
      window.stickyListeners=new Set();
      const add=document.addEventListener.bind(document), remove=document.removeEventListener.bind(document);
      document.addEventListener=(name,fn,opts)=>{if(name==='keydown' && opts===true) stickyListeners.add(fn);return add(name,fn,opts)};
      document.removeEventListener=(name,fn,opts)=>{if(name==='keydown' && opts===true) stickyListeners.delete(fn);return remove(name,fn,opts)};
    ` });
    await page.page("Page.navigate", { url: `http://127.0.0.1:${core.port}/` });
    assert.ok(await page.until(`!!document.querySelector('.spine-ready')`, 10000));
    return page;
  };
  const screenshot = async (page, name) => {
    const { data } = await page.page("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(shots, name), Buffer.from(data, "base64"));
  };
  const desktop = await open();
  assert.equal(await desktop.evaluate(`!!document.querySelector('[data-brick="sticky-notes"]')`), false, "fresh default off");
  const sent = core.heard.length;
  const originalWorld = structuredClone(world);
  await toggle(desktop);
  assert.ok(await desktop.until(`!!document.querySelector('.sticky-notes-trigger')`, 10000));
  assert.equal(await desktop.evaluate(`!!document.querySelector('.sticky-notes-form')`), false, "enable does not auto-open");
  const baselineListeners = await desktop.evaluate("stickyListeners.size");
  await openNotes(desktop);
  assert.equal(await desktop.evaluate("stickyListeners.size"), baselineListeners + 1);
  for (const id of ["source-a", "source-b"]) {
    await desktop.evaluate(`{ const select=document.querySelector('.sticky-notes-pin select'); select.value=${JSON.stringify(id)};select.dispatchEvent(new Event('change',{bubbles:true})); }`);
    await desktop.evaluate(`document.querySelector('.sticky-notes-pin button').focus()`);
    await key(desktop, "Enter", "Enter", 13);
    assert.ok(await desktop.until(`!!document.querySelector('[data-sticky-id="${id}"]')`));
  }
  assert.deepEqual(await desktop.evaluate(`[...document.querySelectorAll('.sticky-notes-note blockquote')].map(e=>e.textContent)`), [world.thoughts[0].text, world.thoughts[1].text], "verbatim original, not summarized point");
  await desktop.evaluate(`document.querySelector('[data-sticky-id="source-b"] button[aria-label$="earlier"]').focus()`);
  await key(desktop, "Enter", "Enter", 13);
  assert.deepEqual(await desktop.evaluate(`[...document.querySelectorAll('[data-sticky-id]')].map(e=>e.dataset.stickyId)`), ["source-b", "source-a"], "local spatial order");
  await desktop.evaluate(`{ const e=document.querySelector('.sticky-notes-draft');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Unsent synthetic draft');e.dispatchEvent(new Event('input',{bubbles:true})); }`);
  assert.equal(await desktop.evaluate(`document.querySelector('.sticky-notes-draft').value`), "Unsent synthetic draft");
  assert.ok(await desktop.evaluate(`!document.querySelector('.sticky-notes-form button[type="submit"]:not(.sticky-notes-pin button)')`));
  await desktop.evaluate(`document.querySelector('[data-sticky-id="source-a"] button').focus()`);
  await key(desktop, "Enter", "Enter", 13);
  assert.ok(await desktop.until(`!!document.querySelector('.spine-point[data-thought="source-a"] .spine-original[aria-expanded="true"]')`), "Open source reveals the exact source's original words");
  await desktop.evaluate(`document.querySelector('.sticky-notes-top button').focus()`);
  await key(desktop, "Escape", "Escape", 27);
  assert.ok(await desktop.until(`!document.querySelector('.sticky-notes-form') && document.activeElement.classList.contains('sticky-notes-trigger')`));
  assert.equal(await desktop.evaluate("stickyListeners.size"), baselineListeners);
  assert.deepEqual(world, originalWorld, "local edits leave accepted fixture unchanged");

  world = { ...world, thoughts: [{ ...world.thoughts[0], text: "Edited accepted source\nwith line break" }, world.thoughts[1]] };
  core.send({ type: "snapshot", world });
  await openNotes(desktop);
  assert.ok(await desktop.until(`document.querySelector('[data-sticky-id="source-a"] blockquote').textContent==='Edited accepted source\\nwith line break'`));
  world = { ...world, thoughts: [world.thoughts[1]] };
  core.send({ type: "snapshot", world });
  assert.ok(await desktop.until(`!!document.querySelector('[data-sticky-id="source-a"] .sticky-notes-missing')`));
  assert.equal(await desktop.evaluate(`document.querySelector('[data-sticky-id="source-a"] blockquote').textContent`), "Edited accepted source\nwith line break");
  assert.equal(await desktop.evaluate(`document.querySelector('[data-sticky-id="source-a"] button').disabled`), true);
  assert.equal(await desktop.evaluate(`document.querySelector('[data-sticky-id="source-b"] blockquote').textContent`), originalWorld.thoughts[1].text);
  await screenshot(desktop, "desktop.png");

  await desktop.page("Page.reload");
  assert.ok(await desktop.until(`!!document.querySelector('.sticky-notes-trigger')`, 10000));
  await openNotes(desktop);
  assert.deepEqual(await desktop.evaluate(`[...document.querySelectorAll('[data-sticky-id]')].map(e=>e.dataset.stickyId)`), ["source-b", "source-a"]);
  assert.equal(await desktop.evaluate(`document.querySelector('.sticky-notes-draft').value`), "Unsent synthetic draft", "same identity reload recovery");
  const saved = await desktop.evaluate(`sessionStorage.getItem(${JSON.stringify(layoutKey(identity, "Colleague"))})`);
  await toggle(desktop);
  assert.ok(await desktop.until(`!document.querySelector('[data-brick="sticky-notes"]')`));
  assert.equal(await desktop.evaluate("stickyListeners.size"), baselineListeners, "off cleans form listeners");
  assert.equal(await desktop.evaluate(`sessionStorage.getItem(${JSON.stringify(layoutKey(identity, "Colleague"))})`), saved, "off retains layout/draft");
  core.send({ type: "notice", message: "Synthetic late result" });
  assert.equal(await desktop.evaluate(`!!document.querySelector('.sticky-notes-form')`), false, "late traffic cannot open an off brick");
  const messageTypes = [...new Set(core.heard.slice(sent).map(message => message.type))];
  const offSwitches = ["voice_shortcuts", "reply_format", "agreement_switch", "connections_switch"];
  for (const message of core.heard.slice(sent).filter(message => offSwitches.includes(message.type))) {
    assert.equal(message.on, false, `${message.type} remains off during sticky-only use`);
  }
  assert.ok(messageTypes.every(type => ["heartbeat", "read", "partner", "email", "focus", "attention", ...offSwitches].includes(type)), `only existing navigation/connection messages, no thought send: ${messageTypes.join(', ')}`);
  await toggle(desktop);
  assert.ok(await desktop.until(`!!document.querySelector('.sticky-notes-trigger')`));
  await openNotes(desktop);
  assert.equal(await desktop.evaluate(`document.querySelector('.sticky-notes-draft').value`), "Unsent synthetic draft");

  // A different same-origin tab can change the cache; only this connection's handshake scopes notes.
  await desktop.evaluate(`localStorage.setItem('e2a2o.last-map.Colleague', 'unrelated-tab-map')`);
  core.send({ type: "snapshot", world });
  assert.ok(await desktop.until(`document.querySelectorAll('.sticky-notes-note').length === 2`), "another tab's cached map cannot switch this layout");
  assert.equal(await desktop.evaluate(`document.querySelector('.sticky-notes-draft').value`), "Unsent synthetic draft");

  identity = "synthetic-map-b";
  await desktop.page("Page.reload");
  assert.ok(await desktop.until(`!!document.querySelector('.sticky-notes-trigger')`, 10000));
  await openNotes(desktop);
  assert.equal(await desktop.evaluate(`document.querySelectorAll('[data-sticky-id]').length`), 0, "another map with identical source IDs is isolated");
  assert.equal(await desktop.evaluate(`document.querySelector('.sticky-notes-draft').value`), "");
  identity = "synthetic-map-a";
  await desktop.evaluate(`sessionStorage.setItem('e2a2o.joined','Reviewer')`);
  await desktop.page("Page.reload");
  assert.ok(await desktop.until(`!!document.querySelector('.sticky-notes-trigger')`, 10000));
  await openNotes(desktop);
  assert.equal(await desktop.evaluate(`document.querySelectorAll('[data-sticky-id]').length`), 0, "another speaker is isolated");
  assert.equal(await desktop.evaluate(`document.querySelector('.sticky-notes-draft').value`), "");
  assert.deepEqual(await desktop.evaluate("errors"), []);

  const phone = await open(390);
  await toggle(phone);
  assert.ok(await phone.until(`!!document.querySelector('.sticky-notes-trigger')`, 10000));
  await openNotes(phone);
  await phone.evaluate(`{ const select=document.querySelector('.sticky-notes-pin select');select.value='source-b';select.dispatchEvent(new Event('change',{bubbles:true})); }`);
  await click(phone, ".sticky-notes-pin button");
  assert.ok(await phone.until(`!!document.querySelector('[data-sticky-id="source-b"]')`));
  await phone.evaluate(`document.querySelector('.sticky-notes-draft').focus()`);
  await phone.page("Input.insertText", { text: "Phone draft remains local" });
  assert.ok(await phone.evaluate(`document.documentElement.scrollWidth<=innerWidth`), "390px has no horizontal overflow");
  for (const selector of [".sticky-notes-pin select", ".sticky-notes-note button", ".sticky-notes-draft", ".sticky-notes-top button"]) {
    assert.ok(await phone.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight})()`), `${selector} reachable on phone`);
  }
  await phone.evaluate(`document.querySelector('.sticky-notes-form').scrollTop=0`);
  await screenshot(phone, "phone-390.png");
  await phone.page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }, { name: "prefers-reduced-motion", value: "reduce" }] });
  await screenshot(phone, "phone-390-dark.png");
  await phone.evaluate(`document.querySelector('.sticky-notes-draft').scrollIntoView({block:'nearest'})`);
  await screenshot(phone, "phone-390-draft.png");
  assert.deepEqual(await phone.evaluate("errors"), []);
  console.log(`PASS sticky-notes: default-off Features, exact-ID pins, live source edit/deletion, retained quote, keyboard, reload, map/speaker isolation, off cleanup/no mutation, 390px. Synthetic screenshots: ${shots}`);
} finally {
  await Promise.all(pages.map(page => page.close()));
  core.close(); await server.close();
}
