// One feature, real playground host, synthetic notes. Never starts capture or a model.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uiServer } from "./ui-server.mjs";
import react from "../ui/node_modules/@vitejs/plugin-react/dist/index.js";
import { openPage } from "./headless.mjs";

const artifacts = mkdtempSync(join(tmpdir(), "canvas-workflow-check-"));
const server = await uiServer({
  configFile: false, appType: "spa", plugins: [react()],
  server: { fs: { allow: [new URL("..", import.meta.url).pathname] } },
}, { port: 0 });
let browser;
try {
  const manifest = JSON.parse(readFileSync(new URL("../ui/src/bricks/canvas-workflow/brick.json", import.meta.url)));
  assert.equal(manifest.defaultOn, false);
  await server.listen();
  const { workflow, newRun } = await server.ssrLoadModule("/src/bricks/canvas-workflow/runtime.ts");
  const { stepDuration } = await server.ssrLoadModule("/src/bricks/canvas-workflow/example.ts");
  let run = workflow(newRun(), { type: "start" });
  run = workflow(run, { type: "tick", milliseconds: stepDuration + 900 });
  assert.equal(run.outputs.length, 1);
  run = workflow(run, { type: "pause" });
  assert.deepEqual(workflow(run, { type: "tick", milliseconds: 60_000 }), run, "pause freezes within a step");
  run = workflow(workflow(run, { type: "resume" }), { type: "tick", milliseconds: stepDuration - 900 });
  assert.equal(run.outputs.length, 2, "resume keeps partial step progress");
  const cancelled = workflow(run, { type: "cancel" });
  assert.deepEqual(workflow(cancelled, { type: "tick", milliseconds: 60_000 }), cancelled, "cancel rejects late results");
  assert.deepEqual(workflow(cancelled, { type: "resume" }), cancelled, "cancel cannot resume");
  run = workflow(workflow(cancelled, { type: "start" }), { type: "tick", milliseconds: stepDuration * 3 });
  assert.equal(run.phase, "done");
  assert.equal(run.outputs[0].length, 3);
  assert.deepEqual(run.outputs[1], [run.outputs[0][0], run.outputs[0][2]], "second step selects input priorities");
  assert.equal(run.outputs[2][1], `2. ${run.outputs[1][1]}`, "brief consumes previous output");

  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const root = "document.querySelector('.canvas-workflow')";
  const click = async text => {
    assert.equal(await browser.evaluate(`(() => {
      const button = [...${root}.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(text)});
      if (!button || button.disabled) return false; button.click(); return true;
    })()`), true, `${text} is available`);
  };
  const advance = async milliseconds => {
    const elapsed = new Promise(resolve => browser.on("Emulation.virtualTimeBudgetExpired", resolve));
    await browser.page("Emulation.setVirtualTimePolicy", { policy: "advance", budget: milliseconds });
    await elapsed;
  };
  for (const width of [1440, 390]) {
    browser = await openPage(`${base}/bricks.html?brick=canvas-workflow&sample=empty`, { width, height: 1000, preserveProfile: true });
    assert.ok(await browser.until(`!!${root}?.querySelector('progress')`), "discovered brick mounts in real host");
    await browser.page("Emulation.setVirtualTimePolicy", { policy: "pause" });
    assert.match(await browser.evaluate(`${root}.textContent`), /Example input.*Open with the live Canvas demo/s);
    assert.match(await browser.evaluate(`${root}.textContent`), /Local example · no model calls/);
    assert.equal(await browser.evaluate(`${root}.querySelector('progress').value`), 0);
    await click("Run example");
    assert.ok(await browser.until(`${root}.textContent.includes('Step 1 of 3 · Collect notes')`));
    await advance(2500);
    assert.ok(await browser.until(`${root}.querySelector('progress').value > 0`), "visible progress advances");
    await click("Pause");
    assert.ok(await browser.until(`${root}.textContent.includes('Paused at step 1')`));
    const held = await browser.evaluate(`${root}.querySelector('progress').value`);
    await advance(stepDuration + 500);
    assert.equal(await browser.evaluate(`${root}.querySelector('progress').value`), held, "rendered progress stays frozen");
    assert.equal(await browser.evaluate(`${root}.querySelectorAll('[data-state="Done"]').length`), 0);
    // Resume using the native keyboard button, then reach a visible completed handoff.
    await browser.evaluate(`${root}.querySelector('button').focus()`);
    await browser.page("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    await browser.page("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    assert.ok(await browser.until(`${root}.textContent.includes('Step 1 of 3 · Collect notes')`));
    await advance(4500);
    assert.ok(await browser.until(`${root}.querySelectorAll('[data-state="Done"]').length === 1`));
    await click("Cancel");
    assert.ok(await browser.until(`${root}.textContent.includes('Cancelled · completed steps retained')`));
    await advance(stepDuration * 3);
    assert.equal(await browser.evaluate(`${root}.querySelectorAll('[data-state="Done"]').length`), 1, "no output after cancel");
    assert.equal(await browser.evaluate(`${root}.querySelectorAll('.canvas-workflow-output li').length`), 3, "completed output retained");
    await click("Run again");
    assert.ok(await browser.until(`${root}.textContent.includes('Step 1 of 3 · Collect notes')`));
    await advance(stepDuration * 3 + 500);
    assert.ok(await browser.until(`${root}.textContent.includes('Complete · brief ready for review')`));
    assert.equal(await browser.evaluate(`${root}.querySelector('progress').value`), 100);
    assert.equal(await browser.evaluate(`${root}.querySelectorAll('[data-state="Done"]').length`), 3);
    assert.match(await browser.evaluate(`${root}.querySelectorAll('.canvas-workflow-output')[2].textContent`), /1\. Open with the live Canvas demo.*2\. Show the pause and resume controls/s);
    assert.equal(await browser.evaluate(`${root}.scrollWidth <= ${root}.clientWidth + 1 && ${root}.getBoundingClientRect().right <= innerWidth`), true, "panel fits viewport");
    assert.equal(await browser.evaluate(`document.querySelector('[data-errors]')?.getAttribute('data-errors') ?? '0'`), "0");
    writeFileSync(join(artifacts, `workflow-${width}.png`), Buffer.from((await browser.page("Page.captureScreenshot", { format: "png" })).data, "base64"));
    await browser.close(); browser = undefined;
  }
  console.log("PASS Canvas workflow: local handoffs, pause/resume, cancel, restart, keyboard, desktop and phone.");
  console.log(`Screenshots retained: ${artifacts}`);
} finally {
  if (browser) await browser.close();
  await server.close();
}
