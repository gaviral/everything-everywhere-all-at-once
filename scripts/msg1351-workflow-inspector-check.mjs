// Focused contract and rendered acceptance. No core, model calls or microphone.
// node scripts/msg1351-workflow-inspector-check.mjs
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { uiServer } from "./ui-server.mjs";
import { openPage } from "./headless.mjs";

const server = await uiServer({ configFile: false }, { port: 0 });
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
let browser;
try {
  await server.listen();
  const { createInspector, unavailableRuntime } = await server.ssrLoadModule("/src/msg1351/workflow-inspector/runtime.ts");
  const { createExampleAdapter, exampleDefinition } = await server.ssrLoadModule("/src/msg1351/workflow-inspector/example.ts");
  const { workflowInspectorFeature } = await server.ssrLoadModule("/src/msg1351/workflow-inspector/index.ts");
  assert.equal(workflowInspectorFeature.defaultEnabled, false);
  assert.equal(workflowInspectorFeature.id, "workflow-inspector");
  const adapter = createExampleAdapter();
  const inspector = createInspector(adapter);
  await inspector.request({ type: "run" });
  assert.equal(adapter.read().phase, "pending", "off cannot deliver a run");
  inspector.setEnabled(true);
  await inspector.request({ type: "run" });
  assert.equal(inspector.read().snapshot.phase, "review");
  assert.equal(adapter.read().steps[1].status, "pending", "second step waits for manual review");
  await inspector.request({ type: "review", value: "  " });
  assert.equal(adapter.read().phase, "review", "empty gap cannot be approved");
  await inspector.request({ type: "stop" });
  assert.equal(adapter.read().phase, "stopped");
  await inspector.request({ type: "run" });
  await inspector.request({ type: "review", value: "Garden volunteers" });
  assert.equal(adapter.read().steps[1].input.audience, "Garden volunteers");
  assert.equal(adapter.read().handoff.status, "approved");
  assert.match(adapter.read().steps[1].output.card, /Community garden opening/);
  await assert.rejects(adapter.request({ type: "review", value: "Stale approval" }), /current review/);
  inspector.dispose();
  const disconnected = createInspector(unavailableRuntime(exampleDefinition));
  disconnected.setEnabled(true);
  await disconnected.request({ type: "run" });
  assert.match(disconnected.read().requestError, /No permitted workflow adapter/);
  assert.equal(disconnected.read().snapshot.phase, "pending", "request failure is not execution");
  disconnected.dispose();

  // A host adapter owns running/result/error transitions, independently of delivery.
  let current = adapter.read();
  const subscribers = new Set();
  let release;
  const requests = [];
  const host = { source: "permitted-runtime", read: () => current,
    subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); },
    request(command) { requests.push(command); return new Promise(resolve => { release = resolve; }); },
  };
  const live = createInspector(host);
  live.setEnabled(true);
  const pending = live.request({ type: "run" });
  await live.request({ type: "run" });
  assert.equal(requests.length, 1, "pending request cannot be duplicated");
  assert.equal(live.read().snapshot.phase, "result", "delivery does not invent running state");
  current = { ...current, phase: "running", steps: [{ ...current.steps[0], status: "running" }, current.steps[1]] };
  subscribers.forEach(listener => listener());
  assert.equal(live.read().snapshot.phase, "running");
  release(); await pending;
  live.setEnabled(false);
  assert.equal(subscribers.size, 0, "off releases observation");
  await live.request({ type: "stop" });
  assert.equal(requests.length, 1, "off cannot send stop");
  current = { ...current, phase: "error", steps: [{ ...current.steps[0], status: "error", error: "Permission expired" }, current.steps[1]] };
  live.setEnabled(true);
  assert.equal(live.read().snapshot.phase, "error", "re-enable reads actual latest state");
  live.dispose();
  console.log("PASS workflow-inspector contract: off, review, stop, handoff, adapter failure, observed state");

  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const url = `${base}/src/msg1351/workflow-inspector/preview.html`;
  const click = async text => {
    assert.equal(await browser.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(text)}); if (!b || b.disabled) return false; b.click(); return true; })()`), true, `reachable ${text}`);
  };
  const key = async (key, code, n) => {
    await browser.page("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: n, ...(key === "Enter" ? { text: "\r" } : {}) });
    await browser.page("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: n });
  };
  for (const width of [1440, 320]) {
    browser = await openPage(url, { width, height: 960 });
    assert.ok(await browser.until('!!document.querySelector(".wi-switch input")'), "preview mounts");
    assert.equal(await browser.evaluate('document.querySelectorAll(".wi-trace, .wi-controls").length'), 0, "off hides trace and controls");
    await browser.evaluate('document.querySelector(".wi-switch input").focus()');
    await key(" ", "Space", 32);
    assert.ok(await browser.until('!!document.querySelector(".wi-trace")'), "keyboard enables inspector");
    assert.match(await browser.evaluate('document.querySelector(".wi-provenance").textContent'), /synthetic data.*no model execution/);
    await click("Run example");
    assert.ok(await browser.until('!!document.querySelector(".wi-handoff form")'), "manual review shown");
    assert.match(await browser.evaluate('document.querySelector(".wi-trigger").textContent'), /Manual request.*sample note available/s);
    assert.equal(await browser.evaluate('document.querySelectorAll(".wi-step .wi-status")[1].textContent'), "pending");
    assert.equal(await browser.evaluate('document.querySelector(".wi-handoff button").disabled'), true, "approval needs gap fill");
    await browser.evaluate('document.querySelector(".wi-handoff input").focus()');
    await browser.page("Input.insertText", { text: "Garden volunteers" });
    await click("Approve handoff");
    assert.ok(await browser.until('document.querySelector(".wi-controls").textContent.includes("Workflow: result")'));
    await browser.evaluate('document.querySelectorAll(".wi-step details").forEach(d => d.open = true)');
    assert.match(await browser.evaluate('document.querySelectorAll(".wi-step")[1].textContent'), /For Garden volunteers: Community garden opening/);
    assert.match(await browser.evaluate('document.querySelector(".wi-handoff").textContent'), /Approved handoff.*Garden volunteers/s);
    // Native disclosure remains keyboard usable.
    await browser.evaluate('document.querySelector(".wi-step summary").focus()');
    await key("Enter", "Enter", 13);
    assert.ok(await browser.until('!document.querySelector(".wi-step details").open'), "keyboard closes disclosure");
    await key("Enter", "Enter", 13);
    assert.ok(await browser.until('document.querySelector(".wi-step details").open'), "keyboard reopens disclosure");
    for (const zoom of [1, 2]) {
      await browser.evaluate(`document.querySelector('.workflow-inspector').style.fontSize = '${16 * zoom}px'`);
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true, "page fits narrow/enlarged text");
      assert.equal(await browser.evaluate('[...document.querySelectorAll(".wi-step, .wi-handoff, .wi-controls")].every(e => e.scrollWidth <= e.clientWidth + 1)'), true, "parts do not clip");
    }
    await browser.evaluate('document.querySelector(".workflow-inspector").style.fontSize = "16px"');
    if (shots) writeFileSync(join(shots, `workflow-${width}.png`), Buffer.from((await browser.page("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })).data, "base64"));
    await click("Run example");
    assert.ok(await browser.until('!!document.querySelector(".wi-handoff form")'));
    await click("Request stop");
    assert.ok(await browser.until('document.querySelector(".wi-controls").textContent.includes("Workflow: stopped")'));
    await browser.evaluate('document.querySelector(".wi-switch input").click()');
    assert.ok(await browser.until('!document.querySelector(".wi-trace")'));
    await browser.evaluate('document.querySelector("select").value = "runtime"; document.querySelector("select").dispatchEvent(new Event("change", {bubbles:true}))');
    assert.ok(await browser.until('!document.querySelector(".wi-switch input").checked'), "source change starts off");
    await browser.evaluate('document.querySelector(".wi-switch input").click()');
    await click("Request run");
    assert.ok(await browser.until('document.querySelector("[role=alert]")?.textContent.includes("No permitted workflow adapter")'), "actual unconnected adapter request fails visibly");
    assert.match(await browser.evaluate('document.querySelector(".wi-controls").textContent'), /Workflow: pending/);
    if (shots) writeFileSync(join(shots, `workflow-failure-${width}.png`), Buffer.from((await browser.page("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })).data, "base64"));
    await browser.close(); browser = undefined;
  }
  console.log("PASS workflow-inspector pages: desktop, 320px, enlarged text, keyboard, manual review, stop, off, adapter failure");
} finally {
  if (browser) await browser.close();
  await server.close();
}
