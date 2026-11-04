// Original synthetic data, built UI, isolated Chrome profiles and a loopback fixture server on port 0.
// No real service, journal, mic or account. Keep screenshots and geometry in SHOTS or a temporary directory.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP c10-recovery-check: ${why}`); process.exit(3); }
const output = process.env.SHOTS ?? mkdtempSync(join(tmpdir(), "c10-recovery-"));
mkdirSync(output, { recursive: true });
const at = 1700000000000;
const quote = "The workshop shelves need a wide space for the blue boxes before choosing the final arrangement.";
const thread = (id, title) => ({ id, title, parent_id: null, status: "dropped", dropped_by: "you", last_point: "", touched_ms: at, tags: [], picture: null });
const thought = (id, thread_id, text, time) => ({ id, thread_id, text, point: text, speaker: "you", placed: true, complete: false,
  at_ms: time, place_ms: 1000, unclear: "", guess: "", heard: "", fixed: "", decided: false });
const pause = (id, thought_id, thread_id, excerpt) => ({ id, thought_id, thread_id, excerpt, speaker: "you", revision: 1, at_ms: at,
  resolved: false, later_count: 0, offer_after_ms: 0, hidden: false });
const fixture = Object.freeze({
  threads: [thread("shelves", "Workshop shelves and blue storage boxes"), thread("path", "Garden path")],
  thoughts: [thought("shelf-words", "shelves", quote, at), thought("path-words", "path", "Choose stones after measuring the garden path.", at + 1000)],
  // A is the named offer; generic return independently resolves the newer unfinished B.
  pauses: [{ ...pause("path-pause", "path-words", "path", "Choose stones after measuring the garden path."), offer_after_ms: 4102444800000 }, pause("shelf-pause", "shelf-words", "shelves", quote)],
  active: "path", active_by: { you: "path" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true,
  recaps: [], notes: {}, proposals: [], positions: {},
});
let shown = structuredClone(fixture);
let pendingReturn;
const sendChange = change => core.send({ type: "change", change });
const returnTo = (p, request_id = null) => {
  shown.active = p.thread_id; shown.active_by.you = p.thread_id;
  sendChange({ type: "active_changed", speaker: "you", thread_id: p.thread_id });
  core.send({ type: "returned", request_id, message: "Back to the exact interrupted words", anchor: {
    pause: p, thought_id: p.thought_id, thread_id: p.thread_id, excerpt: p.excerpt,
    current_text: shown.thoughts.find(t => t.id === p.thought_id).text,
  } });
};
const core = await standInCore(() => [{ type: "snapshot", world: shown }], { onMessage: m => {
  if (m.type === "resume") { pendingReturn = m; return; } // Explicitly acknowledge after checking the pending UI.
  if (m.type === "pause_choice") {
    const p = shown.pauses.find(p => p.id === m.pause_id);
    p.later_count += Number(m.later);
    p.offer_after_ms = m.later ? Date.now() + 300000 : p.offer_after_ms;
    p.hidden = !m.later || p.later_count >= 2;
    sendChange({ type: "pause_choice", id: p.id, later_count: p.later_count, offer_after_ms: p.offer_after_ms, hidden: p.hidden });
  }
  if (m.type === "text" && m.text === "Where was I?") {
    returnTo(shown.pauses.find(p => p.id === "path-pause"));
    core.send({ type: "text_received", id: m.id });
  }
} });
assert.ok(![4360, 4399].includes(core.port));
const draft = "A tangent draft: move the small lamp later.\nKeep this second line.";
const editor = `(() => { const e=document.querySelector('#type-a-thought'); return [e.value,e.selectionStart,e.selectionEnd,e.selectionDirection,document.activeElement===e]; })()`;
const measurements = [];
let browser;
try {
  for (const [width, height] of [[1440, 900], [390, 560]]) for (const theme of ["light", "dark"]) {
    shown = structuredClone(fixture); pendingReturn = null;
    browser = await openPage("about:blank", { width, height });
    const { page, evaluate, until } = browser;
    const check = async (expr, label, ms = 8000) => assert.ok(await until(expr, ms), `${width}/${theme}: ${label}`);
    await page("Page.enable");
    await page("Page.addScriptToEvaluateOnNewDocument", { source: `
      localStorage.setItem('e2a2o.toured','1');
      window.loadId=crypto.randomUUID();
      window.errors=[]; addEventListener('error',e=>{if(!String(e.message).startsWith('ResizeObserver loop')) errors.push(String(e.message))});
      addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
    ` });
    await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/?shell=2` });
    await check('!!document.querySelector("#type-a-thought")', "composer ready before reminder");
    assert.equal(await evaluate('!!document.querySelector(".recovery-comparison")'), false, "fresh profile defaults off");
    // Insert real input and keep a nontrivial selection before changing presentation or receiving a return.
    await evaluate('document.querySelector("#type-a-thought").focus()');
    await page("Input.insertText", { text: draft });
    await evaluate('document.querySelector("#type-a-thought").setSelectionRange(4,13,"backward")');
    const before = await evaluate(editor);
    const reload = async () => {
      const previous = await evaluate('window.loadId');
      await page("Page.reload");
      await check(`window.loadId!==${JSON.stringify(previous)} && !!document.querySelector('#type-a-thought')`, "new document loaded");
    };
    await check('!!document.querySelector(".pullback")', "natural pause offers baseline card");
    assert.deepEqual(await evaluate(editor), before, "reminder preserves draft, selection and focus");
    const baseline = await evaluate('document.querySelector(".pullback").textContent');
    const switchFeature = async value => {
      await evaluate('document.querySelector("[data-guide=catalog]").click()');
      await check('!!document.querySelector("[data-row=compare-return-controls] [role=switch]")', "feature in Features");
      assert.equal(await evaluate('document.querySelector("[data-row=compare-return-controls] [role=switch]").getAttribute("aria-checked")'), String(!value));
      await evaluate('document.querySelector("[data-row=compare-return-controls] [role=switch]").click()');
      await evaluate('document.querySelector(".shell-rail-close").click()');
    };
    await switchFeature(true);
    await check('document.querySelector(".recovery-comparison")?.dataset.variant === "Card"', "default Card after enabling");
    const pick = async variant => {
      await evaluate(`Array.from(document.querySelectorAll('.recovery-comparison-choices button')).find(b=>b.textContent===${JSON.stringify(variant)}).click()`);
      await check(`document.querySelector('.recovery-comparison')?.dataset.variant===${JSON.stringify(variant)}`, "variant selected");
    };
    const details = async () => { await evaluate('document.querySelector(".recovery-compact details").open=true'); };
    const shot = async (variant, extra = "") => {
      await evaluate('document.fonts.ready.then(()=>true)'); await sleep(120);
      const geometry = await evaluate(`(() => {
        const area=document.querySelector('.recovery-comparison'), composer=document.querySelector('.shell-composer').getBoundingClientRect();
        const controls=[...area.querySelectorAll('button, summary')].filter(e=>e.checkVisibility());
        const reachable=controls.every(e=>{e.scrollIntoView({block:'nearest',behavior:'instant'});const r=e.getBoundingClientRect(); return r.top>=0&&r.bottom<=composer.top+1&&r.left>=0&&r.right<=innerWidth&&e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));});
        const dock=document.querySelector('.shell-dock').getBoundingClientRect();
        const frame=document.querySelector('.spine-frame').getBoundingClientRect();
        const corners=[...document.querySelectorAll('.shell-tl,.shell-tr')].filter(e=>e.checkVisibility()).map(e=>e.getBoundingClientRect());
        const tools=[...document.querySelectorAll('.spine-corner-row')].filter(e=>e.checkVisibility()).map(e=>e.getBoundingClientRect()).filter(r=>r.height>0);
        const top=Math.max(frame.top,...corners.map(r=>r.bottom))+8;
        const bottom=Math.min(dock.top,frame.bottom,...tools.map(r=>r.top))-8;
        const legible=[...area.querySelectorAll('.pullback-title,.pullback-quote,blockquote')].every(e=>{const s=getComputedStyle(e);return s.lineHeight==='normal'||parseFloat(s.lineHeight)>=parseFloat(s.fontSize)*1.2;});
        return {usableReadingHeight:Math.max(0,bottom-top),readingTop:top,readingBottom:bottom,reachable,legible,composerBottom:composer.bottom,viewport:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,
          controls:controls.map(e=>{const r=e.getBoundingClientRect();return {text:e.textContent,top:r.top,bottom:r.bottom,hit:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.className}})};
      })()`);
      const name = `${width}-${theme}-${variant}${extra}`;
      const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeFileSync(join(output, `${name}.png`), Buffer.from(data, "base64"));
      assert.ok(geometry.reachable, `${width}/${theme}/${variant}${extra}: controls reachable above composer ${JSON.stringify(geometry)}`);
      assert.ok(geometry.legible, "source lines scale with enlarged text without overlap");
      assert.ok(geometry.usableReadingHeight > 0, `${variant}${extra}: positive reading band`);
      assert.ok(geometry.composerBottom <= height + 1);
      assert.equal(geometry.overflow, false);
      assert.deepEqual((await evaluate(editor)).slice(0, 4), before.slice(0, 4), "byte-identical tangent draft and selection");
      measurements.push({ name, ...geometry });
    };
    const targets = [];
    for (const variant of ["Card", "Compact"]) {
      await pick(variant);
      targets.push(await evaluate('({...document.querySelector(".recovery-comparison").dataset})'));
      if (variant === "Card") assert.equal(await evaluate('document.querySelector(".pullback-quote").textContent'), `“${quote}”`);
      else {
        assert.equal(await evaluate('document.querySelector(".recovery-compact details").open'), false, "Compact details start collapsed");
        await details();
        assert.equal(await evaluate('document.querySelector(".recovery-compact blockquote").textContent'), quote);
        await evaluate('document.querySelector(".recovery-compact details").open=false');
      }
      await shot(variant);
    }
    assert.deepEqual(targets[0].returnPause, targets[1].returnPause);
    assert.equal(targets[0].returnThought, "shelf-words");
    assert.equal(targets[1].returnThread, "shelves");
    await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" }] });
    // A browser text-only enlargement of the changed interaction, independent of device pixel scale.
    await evaluate(`const style=document.createElement('style');style.id='large-text';style.textContent='.recovery-comparison :is(button,summary,span,blockquote,.pullback-title,.pullback-quote){font-size:200% !important}';document.head.append(style)`);
    await shot("Compact", "-200pct-reduced");
    await details();
    await shot("Compact", "-details-200pct-reduced");
    await pick("Card");
    await shot("Card", "-200pct-reduced");
    await pick("Compact");
    await evaluate('document.querySelector("#large-text").remove()');
    // Presentation changes cause no protocol work. Generic return remains an independently resolved B.
    assert.equal(core.heard.filter(m => ["resume", "pause_choice", "text"].includes(m.type)).length, 0);
    await evaluate('document.querySelector("#type-a-thought").focus()');
    core.send({ type: "returned", request_id: null, anchor: { pause: shown.pauses[0], thought_id: "path-words", thread_id: "path", excerpt: shown.pauses[0].excerpt, current_text: shown.pauses[0].excerpt }, message: "Back to the exact interrupted words" });
    await check('document.querySelector(".return-receipt")?.dataset.returnedSource==="path-words"', "generic target B");
    assert.deepEqual(await evaluate(editor), before, "voice return preserves focus, draft and selection");
    await evaluate('document.querySelector(".return-receipt button").click()');
    const finishSelector = '.recovery-compact-return';
    await evaluate(`document.querySelector('${finishSelector}').click()`);
    for (let i = 0; i < 80 && !pendingReturn; i++) await sleep(25);
    assert.equal(pendingReturn?.pause_id, "shelf-pause", "named return A uses same captured identity");
    assert.equal(await evaluate('!!document.querySelector(".return-receipt")'), false, "no success before acknowledgement");
    returnTo(shown.pauses[1], pendingReturn.request_id);
    await check('document.querySelector(".return-receipt")?.dataset.returnedSource==="shelf-words"', "named acknowledged A");
    assert.deepEqual((await evaluate(editor)).slice(0, 4), before.slice(0, 4));
    assert.ok(shown.pauses.every(p => !p.resolved), "return never resolves interrupted words");
    // Reload keeps the feature but resets the visit's presentation choice. Disable returns exactly to baseline.
    await reload();
    await check('!!document.querySelector(".pullback")', "offer after reload");
    assert.equal(await evaluate('document.querySelector(".recovery-comparison").dataset.variant'), "Card");
    await switchFeature(false);
    assert.equal(await evaluate('!!document.querySelector(".recovery-comparison")'), false);
    assert.equal(await evaluate('document.querySelector(".pullback").textContent'), baseline, "off restores baseline markup and words");
    const work = core.heard.filter(m => ["resume", "pause_choice", "text"].includes(m.type)).length;
    await sleep(450);
    assert.equal(core.heard.filter(m => ["resume", "pause_choice", "text"].includes(m.type)).length, work, "off starts no new effects");
    await switchFeature(true);
    const restore = async variant => {
      shown = structuredClone(fixture); pendingReturn = null;
      await reload();
      await check('!!document.querySelector(".pullback")', "fresh frozen source offered");
      await pick(variant);
    };
    const choice = async label => {
      if (await evaluate('document.querySelector(".recovery-comparison").dataset.variant==="Compact"')) await details();
      await evaluate(`Array.from(document.querySelectorAll('.recovery-comparison .pullback-actions button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
    };
    for (const variant of ["Card", "Compact"]) {
      await restore(variant);
      await evaluate(`document.querySelector(${JSON.stringify(variant === "Card" ? '.recovery-comparison .pullback-actions button' : '.recovery-compact-return')}).click()`);
      for (let i = 0; i < 80 && !pendingReturn; i++) await sleep(25);
      assert.equal(pendingReturn?.pause_id, "shelf-pause", `${variant}: authoritative named A operation`);
      returnTo(shown.pauses[1], pendingReturn.request_id);
      await check('document.querySelector(".return-receipt")?.dataset.returnedSource==="shelf-words"', `${variant}: matching return receipt`);
      await restore(variant);
      await choice("Later");
      await check('!document.querySelector(".recovery-comparison").dataset.returnPause', "first Later hides A");
      assert.equal(shown.pauses[1].later_count, 1); assert.equal(shown.pauses[1].hidden, false);
      await evaluate('window.originalNow=Date.now.bind(Date); Date.now=()=>originalNow()+300010');
      await check('document.querySelector(".recovery-comparison").dataset.returnPause==="shelf-pause"', "A returns after five minutes");
      await choice("Later");
      await check('!document.querySelector(".recovery-comparison").dataset.returnPause', "second Later suppresses A");
      assert.equal(shown.pauses[1].later_count, 2); assert.equal(shown.pauses[1].hidden, true);
      assert.deepEqual(shown.thoughts, fixture.thoughts, "Later never changes captured words");
      await restore(variant);
      await choice("Forget it");
      await check('!document.querySelector(".recovery-comparison").dataset.returnPause', "Forget suppresses A");
      assert.equal(shown.pauses[1].hidden, true);
      assert.deepEqual(shown.thoughts, fixture.thoughts, "Forget never deletes words");
      assert.ok(await evaluate('!!document.querySelector("[data-paused-source=shelf-pause]")'), "source marker survives dismissal");
      if (width === 1440 && theme === "light") {
        await restore(variant);
        await check('!document.querySelector(".recovery-comparison").dataset.returnPause', "timed offer expires", 30000);
        assert.deepEqual(shown.thoughts, fixture.thoughts, "timer never deletes captured words");
        await evaluate('document.querySelector(".paused-sources").open=true;document.querySelector("[data-paused-source=shelf-pause] button").focus()');
        await page("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
        await page("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
        for (let i = 0; i < 80 && !pendingReturn; i++) await sleep(25);
        assert.equal(pendingReturn?.pause_id, "shelf-pause", "persistent marker returns to A by keyboard");
        returnTo(shown.pauses[1], pendingReturn.request_id);
        await check('document.activeElement===document.querySelector("#type-a-thought")', "empty composer focus after matching acknowledgement");
      }
    }
    // Exercise the baseline generic action itself, using the fixture's independently resolved B.
    await evaluate('sessionStorage.setItem("e2a2o.sampleMap","1")');
    await reload();
    await check('!!document.querySelector(".sample-recovery-actions button")', "baseline generic action available");
    await evaluate('document.querySelector("#type-a-thought").focus()');
    await page("Input.insertText", { text: draft });
    await evaluate('document.querySelector("#type-a-thought").setSelectionRange(4,13,"backward")');
    const genericDraft = await evaluate(editor);
    await evaluate('document.querySelector(".sample-recovery-actions button").click()');
    await check('document.querySelector(".return-receipt")?.dataset.returnedSource==="path-words"', "generic Where was I independently targets B");
    assert.deepEqual(await evaluate(editor), genericDraft, "generic action preserves tangent draft and selection");
    assert.equal(core.heard.filter(m=>m.type==="text"&&m.text==="Where was I?").length,1);
    assert.deepEqual(await evaluate('errors'), []);
    await browser.close(); browser = null;
    core.heard.length = 0;
  }
  writeFileSync(join(output, "measurements.json"), JSON.stringify(measurements, null, 2));
  console.log(`c10-recovery-check: ok; paired screenshots and reading heights: ${output}; human preference unmeasured`);
} finally {
  if (browser) await browser.close();
  core.close();
}
