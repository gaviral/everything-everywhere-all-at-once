// Built app in real headless Chrome, with the core's correction messages simulated.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { openPage, ready, standInCore } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP speech-fixes-check: ${why}`); process.exit(3); }
const now = Date.now();
const thought = (id, text, unclear, guess) => ({ id, text, point: id === "p1" ? text : "A shorter summary", unclear, guess, speaker: "you", thread_id: "T1", placed: true,
  heard: "", fixed: "", complete: true, at_ms: now, decided: false });
const world = {
  threads: [{ id: "T1", title: "Speech checks", parent_id: null, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "" }],
  thoughts: [thought("p1", "Let us try Muse Bark for this thought", "Muse Bark", "Muse Spark"), thought("p2", "Meet Jena tomorrow", "Jena", "Jenna")],
  active: "T1", active_by: { you: "T1" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [],
};
const core = await standInCore(() => [{ type: "snapshot", world }], { onMessage: (m) => {
  if (m.type === "correct") core.send({ type: "change", change: { type: "thought_corrected", thought_id: m.thought_id, accept: m.accept } });
} });
assert.ok(core.port >= 4620, `spare port ${core.port}`);
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
let page;
async function key(key, code, windowsVirtualKeyCode) {
  await page.page("Input.dispatchKeyEvent", { type: "keyDown", key, code, ...(key === "Enter" ? { text: "\r" } : {}), windowsVirtualKeyCode });
  await page.page("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
}
try {
  for (const width of [1440, 390, 320]) {
    page = await openPage("about:blank", { width, height: 900 });
    await page.page("Page.enable");
    if (width === 320) await page.page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
    await page.page("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("e2a2o.toured", "1"); window.__errors=[]; addEventListener("error",e=>__errors.push(e.message));` });
    await page.page("Page.navigate", { url: `http://127.0.0.1:${core.port}/` });
    assert.ok(await page.until('document.querySelectorAll(".spine-uncertain").length === 2'), "both pending corrections appear on their thoughts despite abbreviated points");
    if (width === 320) await page.evaluate('document.documentElement.style.fontSize = "32px"');
    assert.equal(await page.evaluate('document.querySelector(".spine-uncertain").textContent'), "Muse Bark");
    assert.equal(await page.evaluate('getComputedStyle(document.querySelector(".spine-uncertain")).textDecorationStyle'), "wavy");
    await page.evaluate('document.querySelector(".spine-uncertain").focus()');
    await key("Enter", "Enter", 13);
    assert.ok(await page.until('!!document.querySelector(".spine-fixes:popover-open .did-you-mean")'), "Enter on uncertain words opens the existing controls");
    assert.ok(await page.until(`(() => { const r=document.querySelector('.spine-fixes:popover-open').getBoundingClientRect(); return r.width>0 && r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight; })()`), "controls fit the viewport");
    if (shots) {
      const { data } = await page.page("Page.captureScreenshot", { format: "png" });
      writeFileSync(`${shots}/speech-${width}.png`, Buffer.from(data, "base64"));
    }
    await key("Escape", "Escape", 27);
    assert.ok(await page.until('!document.querySelector(".spine-fixes:popover-open")'), "Escape closes without answering");
    assert.equal(core.heard.filter((m) => m.type === "correct").length, width === 1440 ? 0 : width === 390 ? 2 : 4);
    for (const [id, accept, word] of [["p1", true, "Muse Spark"], ["p2", false, "A shorter summary"]]) {
      const selector = `[data-thought="${id}"] .spine-uncertain`;
      await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
      assert.ok(await page.until('!!document.querySelector(".spine-fixes:popover-open")'));
      // Space on a real focused button, rather than calling the handler.
      await page.evaluate(`document.querySelectorAll('.spine-fixes:popover-open button')[${accept ? 0 : 1}].focus()`);
      await key(" ", "Space", 32);
      assert.ok(await page.until(`!document.querySelector(${JSON.stringify(selector)})`), "the core's answer removes the uncertainty");
      assert.ok(await page.evaluate(`document.querySelector('[data-thought="${id}"] .spine-text').textContent.includes(${JSON.stringify(word)})`), "accept changes the words; reject keeps what was heard");
      assert.deepEqual(core.heard.filter((m) => m.type === "correct").at(-1), { type: "correct", thought_id: id, accept });
    }
    // Parts joined across a pause still mark and answer their own occurrence of the same misheard words.
    const joined = { ...world, thoughts: [world.thoughts[0], { ...world.thoughts[1], text: "Muse Bark tomorrow", unclear: "Muse Bark", guess: "Muse Lark" }], notes: { p2: { continues: "p1" } } };
    core.send({ type: "snapshot", world: joined });
    assert.ok(await page.until(`document.querySelectorAll('[data-thought="p1"] .spine-uncertain').length === 2`), "joined parts mark their own repeated words");
    await page.evaluate('document.querySelectorAll(".spine-uncertain")[1].click()');
    assert.ok(await page.until('document.querySelector(".spine-fixes:popover-open")?.textContent.includes("Muse Lark")'), "the second occurrence gets its own controls");
    await key("Escape", "Escape", 27);
    assert.deepEqual(await page.evaluate('window.__errors'), []);
    await page.close(); page = null;
  }
  console.log(`Speech corrections passed in headless Chrome on spare port ${core.port}: desktop/phone, marked words, keyboard, Escape, Yes/No and core updates.`);
} finally { await page?.close(); core.close(); }
