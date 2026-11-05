// Overflow-only composer repair: synthetic words, isolated page and stand-in core.
import assert from "node:assert/strict";
import { openPage, ready, standInCore } from "./headless.mjs";
import { empty } from "./capture-fixture.mjs";

const why = ready();
if (why) { console.log(`SKIP wb-phone-check: ${why}`); process.exit(3); }
const now = Date.now();
const world = { ...empty(), active: "T1", active_by: { you: "T1" },
  threads: [{ id: "T1", title: "Garden plan", parent_id: null, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "" }],
  thoughts: [{ id: "p1", speaker: "you", text: "Plant basil", point: "Plant basil", thread_id: "T1", placed: true,
    unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: now, place_ms: 2000, decided: false }] };
const core = await standInCore(() => [{ type: "snapshot", world }]);
let browser;
try {
  browser = await openPage("about:blank", { width: 390, height: 844 });
  const { page, evaluate, until } = browser;
  await page("Page.enable");
  await page("Page.addScriptToEvaluateOnNewDocument", { source: `
    localStorage.setItem("e2a2o.toured", "1");
    window.__wbSubmits = 0;
    document.addEventListener("submit", e => { if (e.target.matches(".shell-composer")) __wbSubmits++; }, true);
  ` });
  await page("Page.navigate", { url: `http://127.0.0.1:${core.port}/` });
  assert.ok(await until('!!document.querySelector(".spine-ready .react-flow__viewport") && !!document.querySelector(".shell-composer textarea")'), "populated Canvas and composer mount");
  await evaluate('document.fonts.ready.then(() => true)');
  const settle = () => evaluate('(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); return true; })()');
  await settle();
  const state = () => evaluate(`(() => {
    const e = document.querySelector(".shell-composer textarea"), s = getComputedStyle(e);
    const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
    return { value: e.value, top: e.scrollTop, client: e.clientHeight, scroll: e.scrollHeight,
      overflow: s.overflowY, metrics: [s.fontSize, s.lineHeight, s.fontFamily, s.fontWeight, s.letterSpacing],
      boxes: [box(".shell-composer textarea"), box(".shell-composer"), box(".shell-dock")],
      camera: document.querySelector(".react-flow__viewport").getAttribute("style"),
      page: [scrollX, scrollY], mic: document.querySelectorAll(".mic-corner .mic").length,
      submits: __wbSubmits };
  })()`);
  const original = await state();
  assert.equal(original.mic, 1, "one microphone instance");
  const draft = Array.from({ length: 12 }, (_, i) => `Line ${i + 1}: garden note`).join("\n");
  await evaluate('document.querySelector(".shell-composer textarea").focus()');
  await page("Input.insertText", { text: draft });
  await settle();
  const pasted = await state();
  assert.equal(pasted.value, draft, "every pasted character retained");
  assert.equal(pasted.overflow, "auto", "native vertical overflow enabled");
  assert.ok(pasted.scroll > pasted.client, "multiline draft overflows the one-row viewport");
  assert.deepEqual(pasted.boxes, original.boxes, "paste does not grow textarea, form or dock");
  const [x, y, width, height] = pasted.boxes[0];
  const wheel = async deltaY => {
    await page("Input.dispatchMouseEvent", { type: "mouseWheel", x: x + width / 2, y: y + height / 2, deltaX: 0, deltaY });
    await settle();
  };
  await wheel(-2000);
  assert.ok(await until('document.querySelector(".shell-composer textarea").scrollTop === 0'), "native wheel exposes first line");
  await wheel(2000);
  assert.ok(await until('(() => { const e = document.querySelector(".shell-composer textarea"); return e.scrollTop + e.clientHeight >= e.scrollHeight - 1; })()'), "native wheel exposes last line");
  // Native insertion reveals the caret after choosing each endpoint; neither edit sends.
  await evaluate('document.querySelector(".shell-composer textarea").setSelectionRange(0, 0)');
  await page("Input.insertText", { text: "First: " });
  await settle();
  const firstEdit = await state();
  // Caret reveal may scroll into the line's leading rather than align its line box.
  const leading = (parseFloat(firstEdit.metrics[1]) - parseFloat(firstEdit.metrics[0])) / 2;
  assert.ok(firstEdit.top <= leading, "first-line edit reveals caret within the first line");
  await evaluate('(() => { const e = document.querySelector(".shell-composer textarea"); e.setSelectionRange(e.value.length, e.value.length); })()');
  await page("Input.insertText", { text: " last" });
  await settle();
  const edited = await state();
  assert.equal(edited.value, `First: ${draft} last`, "both endpoint edits preserve the whole draft");
  assert.ok(edited.top + edited.client >= edited.scroll - leading, "last-line edit reveals caret within the last line");
  assert.equal(edited.camera, original.camera, "scrolling and editing do not pan Canvas");
  assert.deepEqual(edited.page, original.page, "page stays still");
  assert.equal(edited.submits, 0, "inspection and editing do not submit");
  assert.equal(core.heard.filter(m => m.type === "text").length, 0, "no text sent during inspection");

  await page("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate('(() => { const e = document.querySelector(".shell-composer textarea"); e.select(); })()');
  await page("Input.insertText", { text: "Move" });
  await settle();
  // Recreate main's sole changed declaration in this isolated page for an exact paired baseline.
  await evaluate('document.querySelector(".shell-composer textarea").style.overflow = "hidden"');
  await settle();
  const baseline = await state();
  await evaluate('document.querySelector(".shell-composer textarea").style.removeProperty("overflow")');
  await settle();
  const repaired = await state();
  assert.equal(repaired.value, "Move", "exact short desktop text");
  assert.deepEqual(repaired.boxes, baseline.boxes, "desktop textarea/form/dock match hidden-overflow baseline");
  assert.deepEqual(repaired.metrics, baseline.metrics, "desktop computed text metrics unchanged");
  assert.deepEqual(repaired.metrics.slice(0, 2), ["15px", "22px"], "exact default font and line height");
  assert.equal(repaired.mic, 1, "one microphone remains");
  for (const type of ["keyDown", "keyUp"]) await page("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, ...(type === "keyDown" ? { text: "\r" } : {}) });
  assert.ok(await until('__wbSubmits === 1 && document.querySelector(".shell-composer textarea").value === ""'), "Enter uses the existing submit path once");
  assert.deepEqual(core.heard.filter(m => m.type === "text").map(m => m.text), ["Move"], "exactly one text message");
  console.log("wb-phone-check: ok (390x844 scroll and endpoint edits; desktop baseline geometry, 15px/22px, one mic, one Enter submit)");
} finally {
  if (browser) await browser.close();
  core.close();
}
