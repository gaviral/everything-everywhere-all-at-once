// Synthetic receipts + placed thoughts, isolated HTTP/WebSocket server and Chrome profile, ephemeral ports only.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as rules from "../ui/src/bricks/repeat-thoughts/rules.ts";
import { readFileSync } from "node:fs";
import { openPage, ready, sleep, standInCore } from "./headless.mjs";

const at = 1_790_000_000_000;
const exact = "We should keep the blue sample beside the window until Friday";
const near = `${exact} morning`;
const thought = (id, text = exact, n = 0, speaker = "you") => ({ id, text, point: text, speaker, thread_id: "T1", placed: true, unclear: "", complete: true, at_ms: at + n, place_ms: 0 });
const info = JSON.parse(readFileSync(new URL("../ui/src/bricks/repeat-thoughts/brick.json", import.meta.url), "utf8"));
assert.equal(info.defaultOn, false);
assert.equal(info.demoSafe, false);
assert.equal(info.name, "Recognize repeated thoughts");
assert.equal(info.flag, undefined);
{
  const old = thought("old"), current = thought("new", exact.toUpperCase() + "!!!\n", 10);
  assert.equal(rules.repeatCandidate([old, current], "new", "you").earlier.id, "old");
  assert.equal(rules.repeatCandidate([old, thought("near", near, 11)], "near", "you").earlier.id, "old");
  for (const [text, speaker] of [["We should discard the blue sample and choose red paint instead", "you"], [exact, "Colleague"], ["Keep the sample", "you"]]) {
    assert.equal(rules.repeatCandidate([old, thought("no", text, 12, speaker)], "no", "you"), null);
  }
  assert.deepEqual(rules.words("ÉCOLE   naïve 東京 １２..."), ["école", "naïve", "東京", "１２"]);
  assert.equal(rules.repeatCandidate([old, thought("tie", exact, 1), current], "new", "you").earlier.id, "tie");
  const hundred = Array.from({ length: 100 }, (_, i) => thought(`other-${i}`, `a different statement number ${i}`, i + 1));
  assert.equal(rules.repeatCandidate([old, ...hundred, thought("late", exact, 200)], "late", "you"), null, "latest 100 only");
  const pair = rules.repeatCandidate([old, current], "new", "you"), visit = rules.newVisit();
  assert.equal(rules.markRepeat(visit, pair, [old, current]), true);
  assert.equal(rules.markRepeat(visit, pair, [{ ...old, text: "changed" }, current]), false);
  assert.equal(rules.pairValid(pair, [current]), false);
  for (let i = 0; i < 30; i++) {
    const next = thought(`mark-${i}`, exact, i + 30);
    rules.markRepeat(visit, { ...pair, current: rules.sourceOf(next) }, [old, current, ...Array.from({ length: i + 1 }, (_, j) => thought(`mark-${j}`, exact, j + 30))]);
  }
  assert.equal(visit.marks.length, 20);
}
console.log("PASS c10-repeats pure selector: exact, near, Unicode, topic/speaker/short exclusions, tie, latest 100, revisions, 20-mark cap");

// A synthetic server fixture owns these records. Only incoming fixture changes update it.
const apply = (world, change) => {
  if (change.type === "thought_added") return { ...world, thoughts: [...world.thoughts, change.thought] };
  if (change.type === "thought_placed") return { ...world, thoughts: world.thoughts.map(t => t.id === change.thought_id ? { ...t, placed: true, thread_id: change.thread_id, point: change.point } : t) };
  if (change.type === "thought_skipped") return { ...world, thoughts: world.thoughts.filter(t => t.id !== change.thought_id) };
  if (change.type === "thought_split") return { ...world, thoughts: [...world.thoughts.map(t => t.id === change.thought_id ? { ...t, text: change.text } : t), change.rest] };
  throw new Error(`Unknown fixture change: ${change.type}`);
};

const unavailable = ready();
if (unavailable) { console.log(`SKIP c10-repeats page: ${unavailable}; pure rules passed`); process.exit(3); }
const evidence = mkdtempSync(join(tmpdir(), "c10-repeats-"));
let world = { threads: [{ id: "T1", title: "Paint samples", parent_id: null, status: "open", last_point: "", touched_ms: at, tags: [], picture: null, dropped_by: "" }],
  thoughts: [thought("old"), thought("topic", "We should discard the blue sample and choose red paint instead", 1), thought("colleague", exact, 2, "Colleague"), thought("short", "Keep the sample", 3)],
  active: "T1", active_by: { you: "T1" }, stay_here: null, notes: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], proposals: [], ai: [] };
const core = await standInCore(() => [{ type: "snapshot", world }]);
assert.ok(![4360, 4399].includes(core.port));
let browser;
try {
  browser = await openPage("about:blank", { width: 1440, height: 1000 });
  const { page, evaluate, until } = browser;
  await page("Page.enable");
  await page("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('e2a2o.toured','1'); window.errors=[]; addEventListener('error',e=>{if(!e.message.startsWith('ResizeObserver')) errors.push(e.message)});` });
  let url = `http://127.0.0.1:${core.port}/?cards`;
  const go = async () => { await page("Page.navigate", { url }); assert.ok(await until(`!!document.querySelector('textarea[aria-label="Type a thought"]')`, 10000)); await sleep(300); };
  const click = async (text, selector = ".repeat-thoughts-card button") => {
    assert.ok(await evaluate(`(() => { const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(b=>b.textContent===${JSON.stringify(text)}); b?.click(); return !!b; })()`), `button: ${text}`);
  };
  const toggle = async (value) => {
    const classic = await evaluate(`!!document.querySelector('.apps-title')`);
    if (classic) {
      if (!await evaluate(`!!document.querySelector('.apps-catalog button')`)) await evaluate(`document.querySelector('.apps-title').click()`);
      assert.ok(await until(`!!document.querySelector('.apps-catalog button')`), "Apps feature entry");
      await evaluate(`document.querySelector('.apps-catalog button').click()`);
      assert.ok(await until(`!!document.querySelector('dialog.catalog[open]')`), "Features opens");
      await evaluate(`document.querySelector('.catalog-more').open=true`);
    } else {
      await evaluate(`document.querySelector('[data-guide="catalog"]').click()`);
      assert.ok(await until(`!!document.querySelector('.shell-catalog [data-row="repeat-thoughts"]')`), "Features rail opens");
    }
    const button = `document.querySelector('[data-row="repeat-thoughts"] [role=switch]')`;
    assert.equal(await evaluate(`${button}.getAttribute('aria-checked')`), String(!value));
    await evaluate(`${button}.click()`);
    assert.ok(await until(`${button}.getAttribute('aria-checked') === '${value}'`));
    if (classic) {
      await evaluate(`document.querySelector('.catalog-close').click()`);
      await evaluate(`document.querySelector('.apps-title').click()`);
    } else await evaluate(`document.querySelector('[data-guide="catalog"]').click()`);
    assert.ok(await until(value ? `!!document.querySelector('.repeat-thoughts-card')` : `!document.querySelector('.repeat-thoughts-card')`));
  };
  const change = (change) => { world = apply(world, change); core.send({ type: "change", change }); };
  let serial = 10;
  const add = async (id, text = exact, { receipt = true, receiptAfter = false, speaker = "you", holdLabel = false } = {}) => {
    const t = thought(id, text, ++serial, speaker);
    change({ type: "thought_added", thought: { ...t, placed: false, thread_id: null, point: "" } });
    const ack = () => core.send({ type: "capture_saved", capture: { id: `capture-${id}`, text, thought_ids: [id] }, replay: false });
    if (receipt && !receiptAfter) ack();
    if (holdLabel) core.send({ type: "route", route: { stage: "weighing", thought_id: id, candidates: [], lanes: 1 } });
    change({ type: "thought_placed", thought_id: id, thread_id: "T1", point: text, unclear: "", complete: true, place_ms: 0 });
    if (receiptAfter) { await sleep(100); ack(); }
    await sleep(300);
  };
  const candidate = `document.querySelectorAll('[data-repeat-source]').length===2`;
  const sources = () => evaluate(`[...document.querySelectorAll('[data-repeat-source]')].map(e=>({id:e.dataset.repeatSource,text:e.querySelector('p').textContent}))`);
  await go();
  assert.equal(await evaluate(`!!document.querySelector('.repeat-thoughts-card')`), false, "fresh default off");
  assert.equal(core.heard.some(m => m.type === "listen" && m.on), false, "no mic start");
  await add("off-capture", exact, { holdLabel: true });
  await toggle(true);
  core.send({ type: "route", route: { stage: "decided", thought_id: "off-capture", path: [], new: false, skipped: false,
    pick: { action: "continue", thread_id: "T1" }, rule: null, why: "", lane: 0, lanes: 1, ms: 10, model: "Fixture" } });
  await sleep(200);
  assert.equal(await evaluate(candidate), false, "late mount does not replay");
  await click("Check latest");
  assert.deepEqual(await sources(), [{ id: "old", text: exact }, { id: "off-capture", text: exact }]);
  // Keyboard dismissal returns focus to the card's persistent control.
  await evaluate(`[...document.querySelectorAll('.repeat-thoughts-card button')].find(b=>b.textContent==='Keep both').focus()`);
  for (const type of ["keyDown", "keyUp"]) await page("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, ...(type === "keyDown" ? { text: "\r" } : {}) });
  assert.ok(await until(`document.activeElement?.textContent==='Check latest' && !document.querySelector('[data-repeat-source]')`));
  await click("Check latest"); assert.equal(await evaluate(candidate), false, "dismissed for this visit");
  await add("import", exact, { receipt: false });
  assert.equal(await evaluate(candidate), false, "unproven/imported landing ignored");
  await add("fresh", near, { receiptAfter: true });
  assert.ok(await until(candidate), "receipt after placement still offers");
  assert.deepEqual(await sources(), [{ id: "import", text: exact }, { id: "fresh", text: near }]);
  assert.match(await evaluate(`document.querySelector('.repeat-thoughts-card').textContent`), /Possible repeat/);
  await evaluate(`(() => { const e=document.querySelector('textarea[aria-label="Type a thought"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Editable synthetic draft'); e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  const before = JSON.stringify(world.thoughts), sentBefore = core.heard.length;
  await click("That is a repeat");
  assert.ok(await until(`document.querySelector('.repeat-thoughts-card').textContent.includes('Repeat marked in this tab.')`));
  await click("Open earlier");
  assert.ok(await until(`document.activeElement?.id==='point-import' || document.activeElement?.dataset.heads?.split(' ').includes('import')`), "exact earlier navigation and keyboard focus");
  assert.equal(await evaluate(`document.querySelector('textarea[aria-label="Type a thought"]').value`), "Editable synthetic draft");
  assert.equal(JSON.stringify(world.thoughts), before, "raw captures unchanged");
  assert.deepEqual(core.heard.slice(sentBefore).filter(m => !["heartbeat", "attention"].includes(m.type)), [], "mark/open send no socket mutation");
  // The default shell reuses the same host and keeps the switch, with explicit late checking.
  url = `http://127.0.0.1:${core.port}/`;
  await go();
  assert.ok(await until(`!!document.querySelector('.repeat-thoughts-card')`));
  assert.equal(await evaluate(candidate), false, "default shell mounts late without old cards");
  await click("Check latest");
  assert.ok(await until(candidate));
  await click("That is a repeat");
  // Theme, phone, text scale and motion evidence on this exact interaction.
  for (const theme of ["light", "dark"]) for (const width of [1440, 390]) {
    await page("Emulation.setDeviceMetricsOverride", { width, height: width === 390 ? 844 : 1000, deviceScaleFactor: 1, mobile: false });
    await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" }] });
    for (const scale of [1, 2]) {
      await evaluate(`document.querySelector('.repeat-thoughts-card').style.fontSize='${scale * 100}%'`);
      await sleep(100);
      assert.ok(await evaluate(`(() => { const card=document.querySelector('.repeat-thoughts-card'); const composer=document.querySelector('textarea[aria-label="Type a thought"]').getBoundingClientRect(); return document.documentElement.scrollWidth<=innerWidth && [...card.querySelectorAll('button')].every(b=>{b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=composer.top;}); })()`), `${theme}/${width}/${scale}: controls reachable above composer`);
      const shot = await page("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(evidence, `${theme}-${width}-${scale * 100}.png`), Buffer.from(shot.data, "base64"));
    }
  }
  change({ type: "thought_split", thought_id: "import", text: "The source has changed", rest: { ...thought("rest", "another part", 50), placed: false, thread_id: null } });
  assert.ok(await until(`!document.querySelector('[data-repeat-source]') && !document.querySelector('.repeat-thoughts-card').textContent.includes('Repeat marked in this tab.')`), "changed source invalidates candidate and mark");
  await add("again"); await click("That is a repeat");
  const ids = await sources(); change({ type: "thought_skipped", thought_id: ids[0].id });
  assert.ok(await until(`!document.querySelector('[data-repeat-source]')`), "deleted source invalidates");
  // Undo returns an old ID, and cannot count as a new landing.
  change({ type: "thought_added", thought: thought(ids[0].id, ids[0].text, 10) });
  await sleep(200); assert.equal(await evaluate(candidate), false);
  await go(); assert.ok(await until(`!!document.querySelector('.repeat-thoughts-card')`), "setting retained after reload");
  assert.equal(await evaluate(candidate), false, "reload needs Check latest and loses marks");
  await toggle(false); const kept = world.thoughts.length;
  await add("after-off");
  assert.equal(await evaluate(`!!document.querySelector('.repeat-thoughts-card')`), false);
  assert.equal(world.thoughts.length, kept + 1, "off keeps every capture");
  await go(); assert.equal(await evaluate(`!!document.querySelector('.repeat-thoughts-card')`), false, "off persisted");
  assert.deepEqual(await evaluate("window.errors"), []);
  console.log(`PASS c10-repeats: rules, default-off, Features, receipts, exact IDs, mark/open, draft, invalidation, undo, reload, off; screenshots ${evidence}`);
} finally { await browser?.close(); core.close(); }
