import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { openPage } from "./headless.mjs";

const ui = fileURLToPath(new URL("../ui/", import.meta.url));
const requireUI = createRequire(new URL("../ui/package.json", import.meta.url));
const { createServer } = await import(requireUI.resolve("vite"));
const source = "src/msg1351/demo-variants/";
const typecheck = spawnSync(join(ui, "node_modules/.bin/tsc"), ["--ignoreConfig", "--noEmit", "--strict", "--noUnusedLocals", "--noUnusedParameters",
  "--skipLibCheck", "--target", "ES2022", "--lib", "ES2022,DOM", "--module", "ESNext", "--moduleResolution", "bundler",
  "--jsx", "react-jsx", "--types", "vite/client", source + "index.tsx", source + "preview.tsx"], { cwd: ui, encoding: "utf8" });
assert.equal(typecheck.status, 0, typecheck.stdout + typecheck.stderr);
console.log("PASS scoped TypeScript");

const server = await createServer({ root: ui, configFile: false, appType: "mpa", logLevel: "error",
  server: { host: "127.0.0.1", port: 0, strictPort: true, open: false, fs: { allow: [ui] } } });
let browser;
const screenshots = mkdtempSync(join(tmpdir(), "demo-variants-check-"));
try {
  await server.listen();
  const { createVariantSession } = await server.ssrLoadModule("/" + source + "selection.ts");
  const { compareVariants } = await server.ssrLoadModule("/" + source + "compare.ts");
  const originals = [
    { id: "a", title: "Alpha", branchId: "sample/alpha", canvasId: "alpha", features: [
      { id: "shared", label: "Shared", description: "Same" }, { id: "change", label: "Change", description: "First" },
      { id: "a-only", label: "Only Alpha", description: "Alpha feature" }] },
    { id: "b", title: "Beta", branchId: "sample/beta", canvasId: "beta", features: [
      { id: "shared", label: "Shared", description: "Same" }, { id: "change", label: "Change", description: "Second" },
      { id: "b-only", label: "Only Beta", description: "Beta feature" }] },
  ];
  const before = JSON.stringify(originals);
  const missing = createVariantSession(originals);
  assert.equal(missing.getSnapshot().enabled, false);
  assert.equal(missing.mergeAvailable, false);
  await missing.requestMerge();
  assert.equal(missing.getSnapshot().merge.status, "idle");
  assert.deepEqual(compareVariants(...missing.references).map(row => row.difference), ["shared", "changed", "left-only", "right-only"]);
  assert.throws(() => createVariantSession([originals[0], originals[0]]), /unique/);
  assert.throws(() => missing.select("unknown"), /Unknown/);
  assert.throws(() => missing.compare("leftId", "b"), /different/);
  const three = createVariantSession([...originals, { ...originals[0], id: "c", title: "Gamma" }]);
  three.compare("rightId", "c");
  assert.equal(three.getSnapshot().comparison.rightId, "c");
  three.setEnabled(true); three.setEnabled(false);
  assert.equal(three.getSnapshot().comparison.rightId, "c");
  assert.throws(() => { missing.references[0].features[0].description = "Mutation"; }, TypeError);
  let resolve, reject, captured, count = 0;
  const session = createVariantSession(originals, { request: request => {
    count++; captured = request; return new Promise((yes, no) => { resolve = yes; reject = no; });
  } });
  let updates = 0;
  const unsubscribe = session.subscribe(() => updates++);
  session.select("a");
  assert.equal(session.getSnapshot().activeId, null);
  session.setEnabled(true);
  assert.equal(session.getSnapshot().activeId, "a");
  session.select("b");
  assert.equal(session.getSnapshot().activeId, "b");
  session.disableSelection();
  assert.equal(session.getSnapshot().activeId, null);
  session.select("a");
  const pending = session.requestMerge();
  assert.equal(session.getSnapshot().merge.status, "pending");
  await session.requestMerge();
  assert.equal(count, 1, "Pending request cannot be submitted twice");
  session.select("b"); session.setEnabled(false);
  assert.equal(session.getSnapshot().selectedId, "b");
  assert.equal(session.getSnapshot().activeId, null);
  resolve({ requestId: captured.requestId, outcome: "merged", receipt: "sample-owner-1", detail: "Sample owner result" });
  await pending;
  assert.equal(session.getSnapshot().merge.request.variant.id, "a");
  assert.equal(session.getSnapshot().merge.result.outcome, "merged");
  session.setEnabled(true);
  const declined = session.requestMerge();
  resolve({ requestId: captured.requestId, outcome: "declined", receipt: "sample-owner-2", detail: "Choice declined" });
  await declined;
  assert.equal(session.getSnapshot().merge.result.outcome, "declined");
  const failed = session.requestMerge(); reject(new Error("Private adapter diagnostics")); await failed;
  assert.equal(session.getSnapshot().merge.status, "error");
  assert(!JSON.stringify(session.getSnapshot()).includes("Private adapter diagnostics"));
  const countBefore = count; await session.requestMerge(); assert.equal(count, countBefore);
  const invalid = createVariantSession(originals, { request: async () => ({ requestId: "wrong", outcome: "merged", receipt: "x", detail: "x" }) });
  invalid.setEnabled(true); invalid.select("a"); await invalid.requestMerge();
  assert.equal(invalid.getSnapshot().merge.status, "error");
  unsubscribe(); const updatesBefore = updates; session.setEnabled(false); assert.equal(updates, updatesBefore);
  assert.equal(JSON.stringify(originals), before);
  console.log("PASS originals, differences, exclusive selection, off retention, owner pending/result, decline, error and invalid receipt");

  const address = server.httpServer.address();
  const url = `http://127.0.0.1:${address.port}/${source}preview.html`;
  browser = await openPage(url, { width: 1280, height: 1000 });
  const page = browser;
  const text = () => page.evaluate("document.body.innerText");
  const waitText = async expected => assert(await page.until(`document.body.innerText.includes(${JSON.stringify(expected)})`), expected);
  const click = async label => {
    assert(await page.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)}); if (!b || b.disabled) return false; b.click(); return true; })()`), `Clickable: ${label}`);
  };
  const requestDisabled = () => page.evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Request merge').disabled");
  const screenshot = async name => {
    const { data } = await page.page("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    writeFileSync(join(screenshots, name + ".png"), Buffer.from(data, "base64"));
  };
  await waitText("Demo choices off");
  assert(await requestDisabled());
  await waitText("Gallery compared with Timeline");
  assert((await text()).includes("Original reference"));
  assert((await text()).includes("Browse the story as picture cards."));
  assert((await text()).includes("Follow the story in sequence."));
  await click("Use Gallery");
  await waitText("Feature off. Choice retained; no active feature set.");
  await page.evaluate("document.querySelector('input[type=checkbox]').focus()");
  await page.page("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  await page.page("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  await waitText("Active choice: Gallery");
  assert.equal(await requestDisabled(), false);
  await page.page("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await page.page("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  assert.equal(await page.evaluate("document.activeElement.tagName"), "SELECT");
  await click("Use Timeline");
  await waitText("Active choice: Timeline");
  assert.equal(await page.evaluate("document.querySelectorAll('button[aria-pressed=true]').length"), 1);
  await click("Disable choice"); await waitText("No active feature set."); assert(await requestDisabled());
  await click("Use Gallery"); await waitText("Active choice: Gallery");
  await click("Request merge"); await waitText("Pending owner result."); assert(await requestDisabled());
  await click("Use Timeline"); await waitText("Active choice: Timeline");
  assert((await text()).includes("Requested choice: Gallery"));
  await click("Leave choices"); await waitText("Return to choices");
  await click("Return to choices"); await waitText("Pending owner result.");
  await page.evaluate("document.querySelector('input[type=checkbox]').click()");
  await waitText("Feature off. Choice retained; no active feature set.");
  await click("Reply merged"); await waitText("Owner reports merge completed.");
  assert((await text()).includes("Original retained: sample/gallery"));
  assert((await text()).includes("No repository merge was performed."));
  await screenshot("desktop-result");
  await page.evaluate("document.querySelector('input[type=checkbox]').click()");
  await waitText("Active choice: Timeline");
  await click("Request merge"); await waitText("Pending owner result.");
  await click("Reply declined"); await waitText("Owner declined the merge.");
  await click("Request merge"); await waitText("Pending owner result.");
  await click("Reply error"); await waitText("Merge completion is unconfirmed."); assert(await requestDisabled());
  console.log("PASS rendered selection, keyboard, pending interruption, return, owner result, decline and failure");

  await page.page("Page.navigate", { url: url + "?missing" });
  await waitText("Merge unavailable: no owner adapter connected.");
  await click("Use Gallery"); await page.evaluate("document.querySelector('input[type=checkbox]').click()");
  await waitText("Active choice: Gallery"); assert(await requestDisabled());
  await page.page("Emulation.setDeviceMetricsOverride", { width: 320, height: 740, deviceScaleFactor: 1, mobile: false });
  assert(await page.until("innerWidth === 320"));
  const fits = () => page.evaluate("document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.demo-variants button, .demo-variants select, .demo-variants-switch')].every(e => { const r=e.getBoundingClientRect(); return r.width > 0 && r.height >= 44 && r.left >= 0 && r.right <= innerWidth; })");
  assert(await fits(), "320px controls remain reachable and sized for touch");
  await screenshot("phone-missing");
  await page.evaluate("document.documentElement.style.fontSize='200%'");
  assert(await fits(), "Enlarged text fits without horizontal scrolling");
  await screenshot("phone-large-text");
  console.log("PASS missing merge, 320px layout and enlarged text");
  console.log(`Screenshots retained: ${screenshots}`);
} finally {
  if (browser) await browser.close();
  await server.close();
}
