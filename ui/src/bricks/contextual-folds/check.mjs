// Focused happy-path proof against the real playground host; no model or microphone.
// Run from the repository root: node ui/src/bricks/contextual-folds/check.mjs
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { createServer } from "../../../node_modules/vite/dist/node/index.js";
import { openPage } from "../../../../scripts/headless.mjs";

const at = Date.UTC(2026, 0, 12, 18);
const thread = (id, title, parent_id = null) => ({ id, title, parent_id, status: "open", last_point: "", touched_ms: at, tags: [], picture: null, dropped_by: "" });
const thought = (id, thread_id, text, point = text) => ({ id, thread_id, speaker: "Reader A", text, point, placed: true, complete: true, unclear: "", at_ms: at, place_ms: 0 });
const original = "Make the first visit welcoming. Start with twenty households and one Saturday together. Keep enough space for people to find their own pace.\n\nA small beginning gives us time to learn what makes people comfortable.";
const topics = [thread("T1", "A first visit"), thread("T2", "Learn before growing"), thread("C1", "Who handles repairs?", "T2"), thread("N1", "A question", "T1")];
const thoughts = [thought("s1", "T1", original, "Make the first visit welcoming."), thought("s2", "T2", "Ask which objects people borrow again before expanding to another neighbourhood."),
  thought("s3", "C1", "The first group can decide which repairs they want to take on."), thought("n1", "N1", "Could we offer a quieter hour?")];
const changes = [...topics.map(thread => ({ type: "thread_added", thread })), ...thoughts.map(thought => ({ type: "thought_added", thought })),
  { type: "anchored", thread_id: "N1", thought_id: "s1", quote: "Make the first visit welcoming." }, { type: "active_changed", speaker: "you", thread_id: "T1" }];
const journal = changes.map(change => JSON.stringify(change)).join("\n");
const server = await createServer({ root: new URL("../../../", import.meta.url).pathname,
  cacheDir: new URL("../../../node_modules/.vite-contextual-folds-check", import.meta.url).pathname,
  plugins: [{ name: "quiet-reader-synthetic-map", enforce: "pre", load(id) {
    if (id.includes("/samples/student-week.jsonl?") && id.includes("raw")) return `export default ${JSON.stringify(journal)}`;
  } }],
  server: { host: "127.0.0.1", port: 0, hmr: false, ws: false, watch: null },
});
let browser;
const click = async label => {
  assert.ok(await browser.evaluate(`(() => { const b = [...document.querySelectorAll('.contextual-folds button')].find(b => b.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`), `button: ${label}`);
};
const input = async (selector, text) => browser.evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)}); e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
const select = async (index, value) => browser.evaluate(`(() => {const e=document.querySelectorAll('.playground-bar select')[${index}]; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
const shot = async name => {
  if (!process.env.SHOTS) return;
  mkdirSync(process.env.SHOTS, { recursive: true });
  const { data } = await browser.page("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${process.env.SHOTS}/${name}.png`, Buffer.from(data, "base64"));
};

try {
  await server.listen();
  const port = server.httpServer.address().port;
  assert.ok(port > 10000, "server gets an ephemeral port");
  browser = await openPage(`http://127.0.0.1:${port}/bricks.html?brick=contextual-folds&sample=empty`, { width: 1440, height: 1000, preserveProfile: true });
  assert.ok(await browser.until(`document.querySelector('.playground')?.dataset.brickReady === 'contextual-folds'`, 20000), "feature discovered and mounted");
  assert.ok(await browser.until(`document.querySelector('.contextual-folds-context')?.textContent.includes('Example conversation')`), "empty map opens labeled, useful example");
  assert.ok(await browser.evaluate(`document.querySelectorAll('.contextual-folds-prose').length >= 4 && !document.querySelector('.contextual-folds header')`));
  await browser.evaluate(`document.querySelector('.contextual-folds-question').open = true`);
  await input(".contextual-folds-question textarea", "Could we offer a quiet first hour?");
  await click("Try an example question");
  assert.ok(await browser.until(`document.querySelector('.contextual-folds-local-question')?.textContent.includes('quiet first hour')`));
  assert.equal(await browser.evaluate(`document.querySelector('.playground-log').textContent.includes('annotate ')`), false, "example stays local");
  await click("This map");
  assert.ok(await browser.until(`document.querySelector('.contextual-folds-empty')?.textContent.includes('No placed words')`));

  await select(1, "student-week");
  assert.ok(await browser.until(`document.querySelector('[data-source="s1"] .contextual-folds-prose')?.textContent === ${JSON.stringify(original)}`, 10000), "live path preserves original paragraphs instead of the shorter point");
  assert.equal(await browser.evaluate(`document.querySelectorAll('.contextual-folds-position li').length`), 3, "anchored Notes stay beside their words, ordinary branch stays in hierarchy");
  assert.ok(await browser.evaluate(`document.querySelector('[data-source="s1"] .contextual-folds-notes').textContent.includes('Could we offer a quieter hour?')`));
  assert.equal(await browser.evaluate(`document.querySelector('[data-source="s1"] .contextual-folds-metadata').textContent.includes('Reader A')`), false);
  await click("Times");
  assert.ok(await browser.until(`!!document.querySelector('[data-source="s1"] .contextual-folds-metadata > time')`));
  assert.equal(await browser.evaluate(`document.querySelector('[data-source="s1"] .contextual-folds-metadata').textContent.includes('Reader A')`), false, "time does not reveal identity");
  await click("Names");
  await click("Times");
  assert.ok(await browser.until(`document.querySelector('[data-source="s1"] .contextual-folds-metadata').textContent.includes('Reader A') && !document.querySelector('[data-source="s1"] .contextual-folds-metadata > time')`), "identity is independent of time");
  await browser.evaluate(`document.querySelector('[data-source="s1"] .contextual-folds-peek summary').click()`);
  assert.ok(await browser.until(`document.querySelector('[data-source="s1"] .contextual-folds-peek').open`), "time peek opens without enabling all times");
  assert.ok(await browser.evaluate(`document.querySelector('[data-source="s1"] .contextual-folds-peek time').getClientRects().length > 0`));

  await browser.evaluate(`document.querySelector('[data-section="T2"] > summary').focus()`);
  for (const type of ["keyDown", "keyUp"]) await browser.page("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  assert.ok(await browser.until(`!document.querySelector('[data-section="T2"]').open`), "keyboard folds the contextual branch");
  for (const type of ["keyDown", "keyUp"]) await browser.page("Input.dispatchKeyEvent", { type, key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  assert.ok(await browser.until(`document.querySelector('[data-section="T2"]').open`), "Space opens the contextual branch");
  await browser.evaluate(`document.querySelector('[data-section="T2"] > summary').click()`);
  assert.ok(await browser.until(`!document.querySelector('[data-section="T2"]').open`), "pointer folds the contextual branch");
  await browser.evaluate(`document.querySelectorAll('.contextual-folds-position button')[2].click()`);
  assert.ok(await browser.until(`document.querySelector('[data-section="T2"]').open && document.querySelector('.contextual-folds-position [aria-current]')?.textContent.includes('Who handles repairs?')`), "rail opens ancestors and moves to the chosen place");
  assert.ok(await browser.evaluate(`document.activeElement?.dataset.readingHeading === 'C1'`), "rail jump puts keyboard focus at source context");
  assert.equal(await browser.evaluate(`!!document.querySelector('.contextual-folds [role="progressbar"]')`), false, "position does not present completion");

  await browser.evaluate(`document.querySelectorAll('.contextual-folds-position button')[0].click(); document.querySelector('[data-source="s1"] .contextual-folds-question').open=true`);
  await input('[data-source="s1"] textarea', "What would make a quiet visit possible?");
  await click("Add question to Notes");
  assert.ok(await browser.until(`document.querySelector('[data-source="s1"] .contextual-folds-notes').textContent.includes('What would make a quiet visit possible?')`), "question returns as anchored Notes through the host");
  await input('[data-source="s1"] textarea', "A draft to return to");
  await browser.evaluate(`document.querySelectorAll('.contextual-folds-position button')[1].click()`);
  await click("Open source ↗");
  assert.ok(await browser.until(`document.querySelector('[data-original-thought="s1"] blockquote')?.textContent === ${JSON.stringify(original)}`), "stable source jump opens the exact original");
  await select(0, "reading-format");
  assert.ok(await browser.until(`document.querySelector('.playground')?.dataset.brickReady === 'reading-format'`));
  await select(0, "contextual-folds");
  assert.ok(await browser.until(`document.querySelector('.playground')?.dataset.brickReady === 'contextual-folds'`));
  assert.ok(await browser.until(`document.querySelector('.contextual-folds-position [aria-current]')?.textContent.includes('Learn before growing')`), "jump and return retain visible position with Plugins off");
  assert.ok(await browser.evaluate(`document.querySelector('[data-source="s1"] .contextual-folds-metadata').textContent.includes('Reader A') && !document.querySelector('[data-source="s1"] .contextual-folds-metadata > time')`), "jump and return retain independent display choices");
  assert.equal(await browser.evaluate(`document.querySelector('[data-source="s1"] textarea').value`), "A draft to return to");

  await browser.evaluate(`document.querySelectorAll('.contextual-folds-position button')[0].click()`);
  assert.ok(await browser.until(`document.querySelector('.contextual-folds-pages').scrollTop < 30`));
  assert.ok(await browser.evaluate(`(() => {const w=document.querySelector('[data-source="s1"] .contextual-folds-words').getBoundingClientRect(),n=document.querySelector('[data-source="s1"] .contextual-folds-notes').getBoundingClientRect();return n.left>=w.right;})()`), "wide Notes sit beside the passage");
  await shot("quiet-reader-desktop");
  await browser.page("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  assert.ok(await browser.until(`(()=>{const w=document.querySelector('[data-source="s1"] .contextual-folds-words').getBoundingClientRect(),n=document.querySelector('[data-source="s1"] .contextual-folds-notes').getBoundingClientRect();return n.top>=w.bottom;})()`), "phone packs Notes below their source");
  assert.ok(await browser.evaluate(`document.documentElement.scrollWidth <= innerWidth && document.querySelector('.contextual-folds-pages').scrollWidth <= document.querySelector('.contextual-folds-pages').clientWidth`), "phone has no horizontal overflow");
  assert.ok(await browser.evaluate(`(()=>{const e=document.querySelectorAll('.contextual-folds-position button > span:first-child')[1],r=document.createRange();r.selectNodeContents(e);return r.getClientRects().length === 1;})()`), "rail position number stays on one line");
  await browser.evaluate(`document.querySelector('.contextual-folds').scrollIntoView({block:'start'})`);
  await shot("quiet-reader-phone");
  await browser.page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await shot("quiet-reader-phone-dark");
  await browser.evaluate(`document.querySelector('.playground-check input').click()`);
  assert.ok(await browser.until(`document.querySelector('.contextual-folds-context').textContent.includes('disconnected')`));
  assert.ok(await browser.evaluate(`document.querySelector('[data-source="s1"] button[type="submit"]').disabled && document.querySelector('[data-source="s1"] textarea').value === 'A draft to return to'`), "disconnect keeps the draft and disables send");
  await select(1, "empty");
  assert.ok(await browser.until(`!!document.querySelector('[data-section="example-purpose"]')`), "a different map gets its own reading state");
  assert.ok(await browser.evaluate(`document.querySelector('.contextual-folds-choices:nth-child(2) button').getAttribute('aria-pressed') === 'false'`), "identity preference is scoped to the map visit");
  assert.equal(await browser.evaluate(`document.querySelector('.playground').dataset.errors`), "0");
  assert.equal(await browser.evaluate(`!!document.querySelector('.brick-broke')`), false);
  console.log("PASS quiet-reader: examples, original words, hierarchy, source questions, independent metadata, time peek, keyboard/rail, jump-and-return, scoped drafts, desktop/phone Notes, offline state");
} finally {
  if (browser) await browser.close();
  await server.close();
}
