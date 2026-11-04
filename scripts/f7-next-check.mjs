// Real built app, synthetic transport and isolated Chrome profiles; no provider or device input.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { empty } from "./capture-fixture.mjs";
import { openPage, ready, standInCore } from "./headless.mjs";
import { uiServer } from "./ui-server.mjs";

// Helpers spawn Chrome with this environment. Never pass any inherited provider credentials along.
for (const key of Object.keys(process.env)) {
  if (/KEY|TOKEN|SECRET|CREDENTIAL|PASSWORD|AUTH|PROVIDER/i.test(key) || /^(META|OPENAI|ANTHROPIC|CLAUDE|AWS|AZURE|GOOGLE)_/.test(key)) delete process.env[key];
}
// This explicitly requested acceptance check must exercise Chrome, even when general prechecks omit pages.
process.env.PRECHECK_PAGES = "1";
assert.equal(ready(), "", "build the UI and provide installed Chrome (CHROME override supported)");
const shots = mkdtempSync(join(tmpdir(), "f7-next-shots-"));
const at = Date.UTC(2026, 10, 3, 20); // Noon in Vancouver, after the DST change.
const action = (id, when, status = "new", kind = "reminder") => ({ id, title: `Prepare ${id}`, thread_id: "T1", kind, when, status, done_ms: status === "done" ? at : null });
const records = [
  action("t-b", "2026-11-03"), action("y-a", "2026-11-02"), action("t-a", "2026-11-03", "kept", "event"),
  action("l-a", "2026-11-04", "kept"), action("u-c", ""), action("u-b", "2026-02-29"), action("u-a", "2026-13-01"),
  action("h-b", "2026-11-04", "done"), action("h-a", "not a date", "done", "event"),
  action("d-b", "2026-11-03", "dismissed"), action("d-a", "", "dismissed"),
];
const seed = () => ({ ...empty(),
  threads: [{ id: "T1", title: "Workshop planning", parent_id: null, status: "open", last_point: "Prepare the workshop", touched_ms: at, tags: [], picture: null, dropped_by: "" }],
  thoughts: [{ id: "P1", speaker: "you", text: "Prepare the workshop", point: "Prepare the workshop", thread_id: "T1", placed: true, complete: true, at_ms: at, place_ms: 0 }],
  active: "T1", active_by: { you: "T1" }, actions: structuredClone(records),
  suggestions: [{ id: "idea", thread_id: "T1", text: "Maybe make a poster", status: "new" }],
});
let world = seed();
const core = await standInCore(() => [{ type: "snapshot", world }]);
assert.ok(core.port !== 4360 && core.port !== 4399 && core.port > 10000, "ephemeral fixture port");
const base = `http://127.0.0.1:${core.port}`;
const pages = [];
const assets = new URL("../ui/dist/assets/", import.meta.url);
const featureAssets = readdirSync(assets).filter(name => /\.(js|css)$/.test(name) && /No next steps to show\.|\.next-steps\{/.test(readFileSync(new URL(name, assets), "utf8")));
assert.ok(featureAssets.length >= 2, "find the feature's lazy code and styles for the off gate");

// A tiny deterministic browser clock. Native short timers still run; long calendar timers can be advanced explicitly.
const clock = `(() => {
  const RealDate = Date, set = window.setTimeout.bind(window), clear = window.clearTimeout.bind(window);
  window.__now = ${at}; window.__calendarTimers = new Map(); window.__focusListeners = new Set();
  window.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [window.__now])); } static now() { return window.__now; } };
  window.setTimeout = (fn, delay, ...args) => {
    let id; id = set(() => { __calendarTimers.delete(id); fn(...args); }, delay);
    if (delay > 3600000) __calendarTimers.set(id, { due: __now + delay, run: () => fn(...args) });
    return id;
  };
  window.clearTimeout = id => { __calendarTimers.delete(id); clear(id); };
  const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
  window.addEventListener = (name, fn, options) => { if (name === 'focus') __focusListeners.add(fn); add(name, fn, options); };
  window.removeEventListener = (name, fn, options) => { if (name === 'focus') __focusListeners.delete(fn); remove(name, fn, options); };
  window.__tickTo = value => { window.__now = value; for (const [id, timer] of [...__calendarTimers]) if (timer.due <= value) { window.clearTimeout(id); timer.run(); } };
  window.__errors = []; add('error', e => { if (!e.message.startsWith('ResizeObserver')) __errors.push(e.message); });
  add('unhandledrejection', e => __errors.push(String(e.reason)));
})();`;
const open = async ({ width = 1440, zone = "America/Vancouver", now = at, dark = false, reduced = false } = {}) => {
  const browser = await openPage("about:blank", { width, height: width === 390 ? 844 : 900 });
  pages.push(browser);
  browser.requests = [];
  await browser.page("Page.enable");
  await browser.page("Network.enable");
  browser.on("Network.requestWillBeSent", event => browser.requests.push(event.request.url));
  await browser.page("Emulation.setTimezoneOverride", { timezoneId: zone });
  await browser.page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }, { name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }] });
  await browser.page("Page.addScriptToEvaluateOnNewDocument", { source: `${clock}\nwindow.__now = ${now};` });
  await browser.page("Page.navigate", { url: base });
  assert.ok(await browser.until(`!!document.querySelector('#type-a-thought') && !!document.querySelector('.spine-ready')`, 12000), "baseline map and input mount");
  await browser.evaluate(`document.fonts.ready.then(() => true)`);
  return browser;
};
const key = async (browser, key, code, n) => {
  for (const type of ["keyDown", "keyUp"]) await browser.page("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: n, ...(type === "keyDown" && key === "Enter" ? { text: "\r" } : {}) });
};
const features = async browser => {
  await browser.evaluate(`document.querySelector('[data-guide="catalog"]').click()`);
  assert.ok(await browser.until(`!!document.querySelector('[data-row="next-steps"] [role="switch"]')`), "Features lists Next steps");
};
const enable = async browser => {
  await features(browser);
  assert.equal(await browser.evaluate(`document.querySelector('[data-row="next-steps"] [role="switch"]').getAttribute('aria-checked')`), "false");
  await browser.evaluate(`document.querySelector('[data-row="next-steps"] [role="switch"]').focus()`);
  await key(browser, " ", "Space", 32);
  assert.ok(await browser.until(`document.querySelector('[data-row="next-steps"] [role="switch"]').getAttribute('aria-checked') === 'true'`));
};
const show = async browser => {
  await browser.evaluate(`window.__beforeFocus = new Set(__focusListeners); window.__beforeTimers = new Set(__calendarTimers.keys()); document.querySelector('[data-row="next-steps"] .shell-link').focus()`);
  await key(browser, "Enter", "Enter", 13);
  assert.ok(await browser.until(`!!document.querySelector('.next-steps-group') && !document.querySelector('.shell-rail')`), `Show opens the real agenda and closes Features: ${await browser.evaluate(`JSON.stringify({ view: document.documentElement.dataset.view, agenda: !!document.querySelector('.next-steps'), rail: !!document.querySelector('.shell-rail'), focused: document.activeElement?.outerHTML.slice(0, 180), errors: __errors, stopped: document.querySelector('.brick-broke')?.textContent })`)}`);
  await browser.evaluate(`window.__ownedFocus = [...__focusListeners].filter(fn => !__beforeFocus.has(fn)); window.__ownedTimers = [...__calendarTimers.keys()].filter(id => !__beforeTimers.has(id));`);
  assert.equal(await browser.evaluate(`__ownedFocus.length`), 1, "one visible-view focus listener");
  assert.equal(await browser.evaluate(`__ownedTimers.length`), 1, "one local-midnight timer");
};
const groups = browser => browser.evaluate(`[...document.querySelectorAll('.next-steps-group')].map(e => [e.dataset.group, Number(e.querySelector('.next-steps-count').textContent), [...e.querySelectorAll('[data-action]')].map(row => row.dataset.action)])`);
const expected = [ ["Overdue", 1, ["y-a"]], ["Today", 2, ["t-a", "t-b"]], ["Later", 1, ["l-a"]], ["No date", 3, ["u-a", "u-b", "u-c"]], ["Handled", 2, ["h-a", "h-b"]] ];
const clean = async browser => {
  assert.deepEqual(await browser.evaluate("__errors"), [], "no browser errors");
  assert.ok(browser.requests.every(url => url.startsWith(base + "/") || url.startsWith(base.replace("http:", "ws:") + "/") || url.startsWith("data:")), "no external or provider requests");
  assert.ok(browser.requests.every(url => !/approve|connector|\/import|warm/i.test(new URL(url).pathname)), "no approval, connector or warm request");
  // Connection capability-off handshake changes only this socket's opt-in, never map data or a connector.
  const mutations = core.heard.filter(message => !(message.type === "connections_switch" && message.on === false && Object.keys(message).length === 2));
  assert.ok(!mutations.some(message => /approve|connect|import|sample|listen|position|next-steps/.test(message.type) || message.type === "text"), "view never sends an approval, model, capture, device or connector action");
};
const shot = async (browser, name) => {
  const { data } = await browser.page("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(shots, name + ".png"), Buffer.from(data, "base64"));
};
const fits = async browser => {
  assert.ok(await browser.evaluate(`document.documentElement.scrollWidth <= innerWidth`), "page stays within the narrow viewport");
  assert.ok(await browser.evaluate(`[...document.querySelectorAll('.next-steps-row, .next-steps-button, .next-steps-filter')].every(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && e.scrollWidth <= e.clientWidth + 1; })`), "rows, labels and controls wrap without cropping");
  await browser.evaluate(`document.querySelector('#type-a-thought').scrollIntoView({ block: 'center' })`);
  assert.ok(await browser.evaluate(`(() => { const e = document.querySelector('#type-a-thought'), r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()`), "input stays visible and uncropped");
};
try {
  // Additional exact calendar edges exercise the production rules; the main assertions below all use the real UI.
  const server = await uiServer();
  try {
    const { validDay, agenda } = await server.ssrLoadModule("/src/bricks/next-steps/rules.ts");
    for (const value of ["2024-02-29", "2000-02-29", "0099-01-01", "2026-11-03"]) assert.equal(validDay(value), true, value);
    for (const value of ["1900-02-29", "2026-02-29", "2026-04-31", "0000-01-01", "2026-00-01", "2026-01-00", "2026-1-03", "2026-11-03T00:00:00Z"]) assert.equal(validDay(value), false, value);
    const frozen = Object.freeze(records.map(row => Object.freeze({ ...row })));
    agenda(frozen, "2026-11-03", true);
    assert.deepEqual(frozen, records, "projection preserves original records");
  } finally { await server.close(); }

  const browser = await open();
  assert.equal(await browser.evaluate(`localStorage.getItem('e2a2o.bricks')`), null, "fresh profile has no feature preferences");
  assert.ok(await browser.evaluate(`!document.querySelector('[data-brick="next-steps"], .next-steps') && !document.body.textContent.includes('Handled by E2A2O')`), "fresh storage has no feature UI or messages");
  assert.ok(featureAssets.every(name => !browser.requests.some(url => url.endsWith('/' + name))), "off does not warm the feature's lazy assets");
  await clean(browser);
  await enable(browser);
  assert.ok(await browser.evaluate(`!document.querySelector('.next-steps')`), "enabling alone does not open the agenda");
  await browser.page("Page.reload");
  assert.ok(await browser.until(`!!document.querySelector('.spine-ready')`, 10000));
  await features(browser);
  assert.equal(await browser.evaluate(`document.querySelector('[data-row="next-steps"] [role="switch"]').getAttribute('aria-checked')`), "true", "switch persists after reload");
  await show(browser);
  assert.deepEqual(await groups(browser), expected, "exact local-day groups, counts and stable ordering");
  const text = await browser.evaluate(`document.querySelector('.next-steps').textContent`);
  for (const label of ["Proposed", "Kept on this map", "Handled by E2A2O", "Reminder", "Event", "2026-11-03", "Date unavailable · 2026-02-29", "Date unavailable · 2026-13-01", "No proposed date", "Source topic: Workshop planning", "does not mean the task is completed"]) assert.ok(text.includes(label), label);
  assert.ok(!text.includes("Maybe make a poster") && !text.includes("Prepare d-"), "suggestions and dismissed records stay out");
  await fits(browser);
  await browser.evaluate(`scrollTo(0, 0)`);
  await shot(browser, "desktop-light");
  await browser.evaluate(`document.querySelector('.next-steps-filter input').focus()`);
  await key(browser, " ", "Space", 32);
  assert.deepEqual((await groups(browser)).at(-1), ["Handled", 4, ["d-a", "d-b", "h-a", "h-b"]], "dismissed takes precedence over day and stays distinct");
  assert.equal(await browser.evaluate(`document.querySelector('[data-action="d-b"] .next-steps-details').textContent`), "ReminderDismissed2026-11-03");
  // Close and reopen by real keys, with focus visibly returned to an on-page launcher.
  await key(browser, "Escape", "Escape", 27);
  assert.ok(await browser.until(`document.activeElement?.textContent === 'Show Next steps' && !document.querySelector('.next-steps-group')`));
  assert.ok(await browser.evaluate(`__ownedFocus.every(fn => !__focusListeners.has(fn)) && __ownedTimers.every(id => !__calendarTimers.has(id))`), "Close releases the view listener and timer");
  await key(browser, "Enter", "Enter", 13);
  assert.ok(await browser.until(`document.activeElement === document.querySelector('.next-steps h1')`), "reopen restores agenda focus");
  await browser.evaluate(`document.querySelector('[data-action="t-a"] button').focus()`);
  await key(browser, "Enter", "Enter", 13);
  assert.ok(await browser.until(`!!document.querySelector('.spine-ready') && !document.querySelector('.next-steps')`), "Open topic reaches the original map");
  assert.ok(core.heard.some(message => message.type === "focus" && message.thread_id === "T1"), "source topic navigation reaches existing openThread contract");
  await clean(browser);
  await features(browser); await show(browser);
  // Timer-driven rollover, then a focus-driven clock/timezone refresh independent of that timer.
  await browser.evaluate(`__tickTo(${Date.UTC(2026, 10, 4, 8, 1)})`);
  assert.ok(await browser.until(`document.querySelector('[data-group="Overdue"] .next-steps-count').textContent === '3'`), "local midnight timer moves Today into Overdue");
  await browser.evaluate(`window.__now = ${Date.UTC(2026, 10, 5, 8, 1)}; dispatchEvent(new Event('focus'))`);
  assert.ok(await browser.until(`document.querySelector('[data-group="Overdue"] .next-steps-count').textContent === '4'`), "focus recomputes local day after midnight");
  world.actions.find(row => row.id === "t-b").status = "done";
  core.send({ type: "change", change: { type: "item_status", id: "t-b", status: "done", done_ms: at } });
  assert.ok(await browser.until(`!!document.querySelector('[data-group="Handled"] [data-action="t-b"]') && document.querySelector('[data-group="Overdue"] .next-steps-count').textContent === '3'`), "live action status immediately regroups without reload");
  await browser.evaluate(`window.__disableFocus = [...__focusListeners].filter(fn => !__beforeFocus.has(fn)); window.__disableTimers = [...__calendarTimers.keys()].filter(id => !__beforeTimers.has(id));`);
  await features(browser);
  await browser.evaluate(`document.querySelector('[data-row="next-steps"] [role="switch"]').focus()`);
  await key(browser, " ", "Space", 32);
  assert.ok(await browser.until(`!document.querySelector('.next-steps') && !!document.querySelector('.spine-ready')`), "disable restores baseline map");
  assert.ok(await browser.evaluate(`__disableFocus.every(fn => !__focusListeners.has(fn)) && __disableTimers.every(id => !__calendarTimers.has(id))`), "disable removes all feature listeners and timers");
  assert.equal(world.actions.length, records.length, "disable retains all stored records");
  await key(browser, "Escape", "Escape", 27);
  assert.ok(await browser.until(`!document.querySelector('.shell-rail')`), "baseline Escape still closes Features");
  await browser.evaluate(`document.querySelector('#type-a-thought').focus()`);
  await browser.page("Input.insertText", { text: "Synthetic draft stays editable" });
  assert.equal(await browser.evaluate(`document.querySelector('#type-a-thought').value`), "Synthetic draft stays editable", "baseline input stays editable without sending");
  await clean(browser);
  await browser.close(); pages.pop();

  // UTC is still Nov 2 here: interpreting YYYY-MM-DD as UTC would shift a row away from local Today.
  world = seed();
  const tokyo = await open({ zone: "Asia/Tokyo", now: Date.UTC(2026, 10, 2, 15, 30) });
  await enable(tokyo); await show(tokyo);
  assert.deepEqual(await groups(tokyo), expected, "second timezone uses local Nov 3, never the UTC day");
  await clean(tokyo); await tokyo.close(); pages.pop();

  for (const dark of [false, true]) {
    world = seed();
    const phone = await open({ width: 390, dark, reduced: true });
    await enable(phone); await show(phone);
    assert.deepEqual(await groups(phone), expected);
    await fits(phone); await phone.evaluate(`scrollTo(0, 0)`);
    await shot(phone, dark ? "phone-dark-reduced" : "phone-light-reduced");
    await phone.evaluate(`document.querySelector('.next-steps-filter input').focus()`);
    await key(phone, " ", "Space", 32);
    assert.ok(await phone.until(`document.querySelector('.next-steps-filter input').checked`), "phone checkbox works from the keyboard");
    await phone.evaluate(`document.querySelector('.next-steps-top button').focus()`);
    await key(phone, "Enter", "Enter", 13);
    assert.ok(await phone.until(`document.activeElement?.textContent === 'Show Next steps'`), "Close returns focus on phone");
    await key(phone, "Enter", "Enter", 13);
    // Enlarge all feature text to 200%; no fixed heights or truncated controls.
    await phone.evaluate(`document.querySelector('.next-steps').style.fontSize = '200%'; document.querySelectorAll('.next-steps h1, .next-steps h2, .next-steps h3').forEach(e => e.style.fontSize = '1em')`);
    await fits(phone); await phone.evaluate(`scrollTo(0, 0)`); await shot(phone, dark ? "phone-dark-200" : "phone-light-200");
    world.actions = [];
    core.send({ type: "snapshot", world });
    assert.ok(await phone.until(`document.querySelector('.next-steps-empty')?.textContent.startsWith('No next steps to show')`), "empty agenda is honest even with a suggestion present");
    assert.deepEqual(await groups(phone), expected.map(([name]) => [name, 0, []]));
    await fits(phone); await phone.evaluate(`scrollTo(0, 0)`); await shot(phone, dark ? "empty-dark-200" : "empty-light-200");
    await clean(phone); await phone.close(); pages.pop();
  }
  console.log("PASS f7-next: off gate, Features/reload/disable, exact groups and states, source navigation without approval, local midnight/focus, live status, two timezones, keyboard/focus, empty, 1440/390, light/dark, reduced motion, 200% text");
  console.log(`Synthetic screenshots: ${shots}`);
} finally {
  await Promise.all(pages.map(browser => browser.close()));
  core.close();
}
