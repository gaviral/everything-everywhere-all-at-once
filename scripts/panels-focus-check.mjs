// Real built UI + synthetic protocol fixture. No real core, data directory, provider or device input.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";
import { uiServer } from "./ui-server.mjs";

// headless.mjs spawns Chrome with our environment. Never pass provider credentials to it.
for (const name of Object.keys(process.env)) if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PROVIDER|META|OPENAI|ANTHROPIC/i.test(name)) delete process.env[name];
// This acceptance command requires its browser cases even on hosts whose general precheck skips pages.
process.env.PRECHECK_PAGES = "1";
assert.equal(ready(), "", "built UI and installed Chrome required (CHROME override supported)");
const shots = mkdtempSync(join(tmpdir(), "f7-focus-"));
const STORE = "e2a2o.sessionFocus.v1";
const goal = "Compare the sample shapes";
const why = "Keep the comparison clear.\n  Preserve this second line.";
const next = "Look at the blue square";
const at = Date.now();
const thread = (id, title) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: at, tags: [], picture: null, dropped_by: "" });
let world = { threads: [thread("T1", "Sample shapes"), thread("T2", "Sample colors")], thoughts: [], active: "T2", active_by: { you: "T2" }, stay_here: null, anchors: {}, notes: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], proposals: [], ai: [] };
const door = { room: false, member: true };
const core = await standInCore(() => [{ type: "snapshot", world }], { door, onMessage: message => {
  if (message.type !== "text") return;
  const thought = { id: `th-${message.id}`, speaker: "you", text: message.text, point: message.text, thread_id: world.active, placed: true, complete: true, at_ms: Date.now(), place_ms: 0 };
  world.thoughts.push(thought);
  core.send({ type: "change", change: { type: "thought_added", thought } });
  core.send({ type: 'capture_saved', capture: { id: message.id, text: message.text, thought_ids: [thought.id] }, replay: false });
  core.send({ type: 'text_received', id: message.id });
} });
assert.ok(core.port !== 4360 && core.port !== 4399, "fixture gets an ephemeral port");
const pages = [];
const card = `.session-focus`;
const button = text => `[...document.querySelectorAll('.session-focus button')].find(b => b.textContent.trim() === ${JSON.stringify(text)})`;
const click = async (b, text) => { assert.ok(await b.evaluate(`!!(${button(text)})`), `button ${text}`); await b.evaluate(`${button(text)}.click()`); };
const key = async (b, value, code = value, number = value === "Enter" ? 13 : value === "Escape" ? 27 : 32) => {
  for (const type of ["keyDown", "keyUp"]) await b.page("Input.dispatchKeyEvent", { type, key: value, code, windowsVirtualKeyCode: number,
    ...(type === "keyDown" && value === "Enter" ? { text: "\r" } : {}) });
};
const field = async (b, i, value) => {
  await b.evaluate(`document.querySelectorAll('.session-focus-form input, .session-focus-form textarea')[${i}].focus()`);
  await b.page("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: process.platform === "darwin" ? 4 : 2, windowsVirtualKeyCode: 65 });
  await b.page("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: process.platform === "darwin" ? 4 : 2, windowsVirtualKeyCode: 65 });
  await b.page("Input.insertText", { text: value });
};
const toggle = async (b, enabled) => {
  await b.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Features')).click()`);
  assert.ok(await b.until(`!!document.querySelector('[data-row="session-focus"] [role="switch"]')`));
  assert.equal(await b.evaluate(`document.querySelector('[data-row="session-focus"] [role="switch"]').getAttribute('aria-checked')`), String(!enabled));
  await b.evaluate(`document.querySelector('[data-row="session-focus"] [role="switch"]').focus()`);
  await key(b, " ", "Space");
  assert.ok(await b.until(`document.querySelector('[data-row="session-focus"] [role="switch"]').getAttribute('aria-checked') === '${enabled}'`));
  await b.evaluate(`document.querySelector('.shell-rail-close').click()`);
  assert.ok(await b.until(`${enabled ? '!!' : '!'}document.querySelector('${card}')`));
};
const open = async (width = 1440, denied = false) => {
  const b = await openPage("about:blank", { width, height: width === 390 ? 844 : 900 }); pages.push(b);
  b.requests = [];
  b.on("Network.requestWillBeSent", e => b.requests.push(e.request.url));
  await b.page("Network.enable");
  await b.page("Page.enable");
  await b.page("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.focusDocument = Math.random();
    localStorage.setItem('e2a2o.toured', '1'); window.errors = [];
    addEventListener('error', e => { if (!e.message.startsWith('ResizeObserver')) errors.push(e.message); });
    ${denied ? `Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('Synthetic denial', 'SecurityError'); } });` : ""}
  ` });
  await b.page("Page.navigate", { url: `http://127.0.0.1:${core.port}/` });
  assert.ok(await b.until(`!!document.querySelector('[aria-label="Type a thought"]')`, 10000), "real app opens");
  await sleep(200);
  assert.equal(await b.evaluate(`!!document.querySelector('${card}')`), false, "fresh storage has no focus UI");
  assert.ok(!b.requests.some(url => /session-focus/.test(url)), "off loads no feature code or warm request");
  assert.equal(await b.evaluate(`document.body.textContent.includes('This tab’s focus')`), false, "no focus-specific message while off");
  return b;
};
const shot = async (b, name) => {
  const { data } = await b.page("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(shots, `${name}.png`), Buffer.from(data, "base64"));
};
const reload = async b => {
  const previous = await b.evaluate('window.focusDocument');
  await b.page('Page.reload');
  assert.ok(await b.until(`window.focusDocument !== ${previous} && !!document.querySelector('[aria-label="Type a thought"]')`, 10000), 'new document after reload');
};
const layout = async b => {
  assert.ok(await b.evaluate(`document.documentElement.scrollWidth <= innerWidth`), "no horizontal page overflow");
  assert.ok(await b.evaluate(`(() => { const r = document.querySelector('${card}').getBoundingClientRect(); const c = document.querySelector('[aria-label="Type a thought"]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= c.top && c.bottom <= innerHeight; })()`), "focus card leaves the input visible");
};
const socketMark = () => core.heard.length;
const noFocusSend = mark => {
  // A Features change may repeat the connection's explicit-agreement-off preference; no map write occurs.
  const sends = core.heard.slice(mark).filter(m => m.type !== "heartbeat" && !(m.type === "agreement_switch" && m.on === false && Object.keys(m).length === 2));
  assert.deepEqual(sends, [], "focus editing/toggling sends no socket mutation");
};
const typeThought = async (b, text) => {
  await b.evaluate(`document.querySelector('[aria-label="Type a thought"]').focus()`);
  await b.page("Input.insertText", { text }); await key(b, "Enter");
  assert.ok(await b.until(`document.querySelector('[aria-label="Type a thought"]').value === ''`));
  for (let n = 0; n < 50 && !core.heard.some(m => m.type === "text" && m.text === text); n++) await sleep(50);
  assert.ok(core.heard.some(m => m.type === "text" && m.text === text), "normal thought reaches synthetic core");
  assert.ok(await b.until(`!document.body.textContent.includes('to send when connected')`), 'synthetic capture receipt clears the outbox');
};
try {
  // The same pure rules enforce bounds in the real form; additional boundary checks need no browser state.
  const server = await uiServer();
  try {
    const rules = await server.ssrLoadModule('/src/bricks/session-focus/rules.ts');
    assert.equal(rules.problem(rules.clean({ goal: " \n ", why: "", next: "" })), "Enter a goal.");
    for (const [key, cap] of [["goal", 160], ["why", 280], ["next", 160]]) {
      assert.ok(rules.problem({ goal: "g", why: "", next: "", [key]: "x".repeat(cap + 1) }));
    }
    assert.equal(rules.clean({ goal: " g ", why: ` ${why} `, next: " n " }).why, why);
    // Whole serialized store includes speaker IDs and all entries. Refusal never overwrites the saved focus.
    globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };
    assert.equal(rules.keep("synthetic", { goal: "g", why: "", next: "" }), "");
    assert.match(rules.keep("s".repeat(4096), { goal: "g", why: "", next: "" }), /4 KiB/);
    assert.equal(rules.visit("synthetic").saved.goal, "g");
    delete globalThis.sessionStorage;
  } finally { await server.close(); }

  const b = await open();
  await typeThought(b, "Baseline sample thought");
  const before = world.thoughts.at(-1).thread_id;
  const mark = socketMark();
  await toggle(b, true);
  assert.ok(await b.evaluate(`document.querySelector('${card}').textContent.includes('No focus yet')`));
  await b.evaluate(`${button('Edit focus')}.focus()`); await key(b, " ", "Space");
  assert.ok(await b.until(`document.activeElement === document.querySelector('.session-focus-form input')`), `keyboard opens editor with Goal focused: ${await b.evaluate('document.activeElement?.outerHTML')}`);
  assert.deepEqual(await b.evaluate(`[...document.querySelectorAll('.session-focus-form input, .session-focus-form textarea')].map(e => e.maxLength)`), [160, 280, 160]);
  await field(b, 0, `  ${goal}  `); await field(b, 1, `  ${why}  `); await field(b, 2, `  ${next}  `);
  await click(b, "Use this topic");
  await b.evaluate(`${button('Save focus')}.focus()`); await key(b, 'Enter');
  assert.ok(await b.until(`document.activeElement?.textContent === 'Edit focus'`), "save returns focus");
  assert.equal(await b.evaluate(`document.querySelector('.session-focus-goal').textContent`), goal);
  assert.deepEqual(await b.evaluate(`JSON.parse(sessionStorage.getItem(${JSON.stringify(STORE)}))`), [["you", { goal, why, next, topicId: "T2" }]], "only trimmed plain text and deliberate topic ID are kept under the named tab key");
  assert.ok(await b.evaluate(`new TextEncoder().encode(sessionStorage.getItem(${JSON.stringify(STORE)})).byteLength <= 4096`));
  assert.equal(await b.evaluate(`document.querySelector('.session-focus-more').open`), false, "More starts folded");
  await b.evaluate(`document.querySelector('.session-focus-more summary').focus()`); await key(b, " ", "Space");
  assert.ok(await b.until(`document.querySelector('.session-focus-more').open`), "More opens by keyboard");
  assert.deepEqual(await b.evaluate(`[...document.querySelectorAll('.session-focus-more span')].map(e => e.textContent)`), [why, next]);
  await key(b, " ", "Space"); assert.ok(await b.until(`!document.querySelector('.session-focus-more').open`));
  noFocusSend(mark);
  await reload(b);
  assert.ok(await b.until(`document.querySelector('.session-focus-goal')?.textContent === ${JSON.stringify(goal)}`, 10000), "feature switch and focus survive reload");
  assert.ok(await b.evaluate(`!!${button('Open topic: Sample colors')}`), "attachment survives reload");
  await click(b, "Edit focus");
  assert.deepEqual(await b.evaluate(`[...document.querySelectorAll('.session-focus-form input, .session-focus-form textarea')].map(e => e.value)`), [goal, why, next]);
  await key(b, "Escape"); assert.ok(await b.until(`document.activeElement?.textContent === 'Edit focus' && !document.querySelector('.session-focus-form')`), "Escape closes and returns focus");

  // A later normal destination is independent of the optional attached topic.
  world.active = "T1"; world.active_by.you = "T1";
  core.send({ type: "snapshot", world }); await sleep(200);
  await typeThought(b, "Another sample thought");
  assert.equal(before, "T2"); assert.equal(world.thoughts.at(-1).thread_id, "T1", "new thought uses normal current destination, not focus topic");
  assert.deepEqual(Object.keys(core.heard.find(m => m.type === "text" && m.text === "Another sample thought")).sort(), ["id", "text", "type"], "focus adds nothing to thought packet");
  const local = socketMark();
  await click(b, "Clear"); assert.ok(await b.until(`document.querySelector('${card}').textContent.includes('No focus yet')`));
  await click(b, "Undo"); assert.ok(await b.until(`document.querySelector('.session-focus-goal')?.textContent === ${JSON.stringify(goal)}`));
  await toggle(b, false); await toggle(b, true);
  assert.equal(await b.evaluate(`document.querySelector('.session-focus-goal').textContent`), goal, "off/on preserves focus");
  noFocusSend(local);
  await shot(b, "desktop-light"); await layout(b);
  const navigation = socketMark();
  await click(b, "Open topic: Sample colors");
  for (let n = 0; n < 50 && !core.heard.slice(navigation).some(m => m.type === 'focus' && m.thread_id === 'T2'); n++) await sleep(50);
  assert.ok(core.heard.slice(navigation).some(m => m.type === 'focus' && m.thread_id === 'T2'), 'only explicit Open topic requests normal topic navigation');
  // Removing the attached topic affects only its link.
  world.threads = world.threads.filter(t => t.id !== "T2");
  core.send({ type: "snapshot", world });
  assert.ok(await b.until(`document.querySelector('${card}').textContent.includes('Attached topic unavailable')`));
  assert.equal(await b.evaluate(`document.querySelector('.session-focus-goal').textContent`), goal);
  await click(b, "Edit focus"); assert.equal(await b.evaluate(`document.querySelector('.session-focus-form input').value`), goal);
  await click(b, "Close");
  // Rejoining as another speaker in the same tab must show that speaker's separate local entry.
  door.room = true;
  for (const name of ['Synthetic A', 'Synthetic B']) {
    await b.evaluate(`sessionStorage.setItem('e2a2o.joined', ${JSON.stringify(name)})`);
    await reload(b);
    assert.ok(await b.until(`document.querySelector('${card}')?.textContent.includes('No focus yet')`), 'new speaker has no inherited focus');
    await click(b, 'Edit focus'); await field(b, 0, `${name} focus`); await click(b, 'Save focus');
  }
  await b.evaluate(`sessionStorage.setItem('e2a2o.joined', 'Synthetic A')`); await reload(b);
  assert.ok(await b.until(`document.querySelector('.session-focus-goal')?.textContent === 'Synthetic A focus'`), 'switching back restores the correct speaker');
  door.room = false; await reload(b);
  assert.ok(await b.until(`document.querySelector('.session-focus-goal')?.textContent === ${JSON.stringify(goal)}`), 'original speaker entry remains separate');
  await toggle(b, false); const off = socketMark();
  await typeThought(b, "After hiding the card");
  assert.equal(world.thoughts.at(-1).thread_id, "T1", "baseline input still works after disabling");
  assert.ok(!core.heard.slice(off).some(m => /focus/.test(JSON.stringify(m))), "no feature traffic after disabling");
  assert.deepEqual(await b.evaluate("errors"), []);

  for (const width of [1440, 390]) {
    world = { ...world, threads: [], thoughts: [], active: null, active_by: {} };
    const v = await open(width, width === 1440);
    const gate = socketMark(); await toggle(v, true);
    await click(v, "Edit focus");
    assert.equal(await v.evaluate(`${button('Use this topic')}.disabled`), true, "empty map cannot attach");
    await field(v, 0, "Synthetic local focus"); await field(v, 1, why); await field(v, 2, next);
    await layout(v); await shot(v, `empty-editor-${width}`);
    await click(v, "Save focus");
    if (width === 1440) {
      assert.ok(await v.evaluate(`document.querySelector('${card}').textContent.includes('Not kept after reload')`));
      await toggle(v, false); await toggle(v, true);
      assert.equal(await v.evaluate(`document.querySelector('.session-focus-goal').textContent`), "Synthetic local focus", "denied storage preserves memory through off/on");
      await click(v, "Clear"); await click(v, "Undo");
      assert.equal(await v.evaluate(`document.querySelector('.session-focus-goal').textContent`), "Synthetic local focus");
    }
    await v.page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }, { name: "prefers-color-scheme", value: "dark" }] });
    await click(v, "Edit focus");
    await v.evaluate(`document.querySelector('${card}').style.fontSize = '28px'`);
    await layout(v);
    for (const text of ['Use this topic', 'Save focus', 'Close']) {
      assert.ok(await v.evaluate(`(() => { const e = ${button(text)}; e.scrollIntoView({block:'nearest'}); const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && e.scrollWidth <= e.clientWidth + 1; })()`), `200% text: ${text} remains reachable`);
    }
    await shot(v, `dark-200-${width}`);
    await key(v, "Escape");
    await layout(v); await shot(v, `saved-${width}`);
    noFocusSend(gate);
    assert.deepEqual(await v.evaluate("errors"), []);
  }
  console.log(`PASS f7-focus: real Features gate, persistence, fields/attachment, keyboard/More/Escape, clear/Undo, off/on, unchanged destination, unavailable topic, denied storage, empty desktop/phone, dark/reduced motion/200% text. Screenshots: ${shots}`);
} finally {
  await Promise.all(pages.map(b => b.close()));
  core.close();
}
