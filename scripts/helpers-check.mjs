// Real Rust core + local stub model + built UI. OS-assigned ports only; no model key or network service.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ready, openPage } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP helpers-check: ${why}`); process.exit(3); }
const root = new URL("../", import.meta.url).pathname;
const shots = process.env.SHOTS ?? "/tmp/i-swarm-shots";
mkdirSync(shots, { recursive: true });
const build = await promisify(execFile)("cargo", ["test", "--no-run", "--message-format=json"], { cwd: join(root, "core"), maxBuffer: 8 * 1024 * 1024 });
const artifact = build.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line)).find((m) => m.reason === "compiler-artifact" && m.profile.test && m.executable);
assert.ok(artifact?.executable, "Rust test executable built");
const app = spawn(artifact.executable, ["--ignored", "--exact", "helpers::tests::stub_app", "--nocapture"], { cwd: join(root, "core"), stdio: ["ignore", "pipe", "pipe"] });
let output = "";
app.stdout.on("data", (s) => { output += s; });
app.stderr.on("data", (s) => { output += s; });
let browser;
try {
  const { url, trace } = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`stub app did not start: ${output.slice(-1000)}`)), 15000);
    const started = () => {
      const url = output.match(/SWARM_APP (http:\/\/[^\s]+)/)?.[1];
      const trace = output.match(/SWARM_TRACE ([^\r\n]+)/)?.[1];
      if (url && trace) { clearTimeout(timer); app.stdout.off("data", started); resolve({ url, trace }); }
    };
    app.stdout.on("data", started);
    started();
  });
  for (const width of [1440, 390]) {
    browser = await openPage("about:blank", { width, height: width === 390 ? 844 : 900 });
    const { page, evaluate, until } = browser;
    await page("Page.enable");
    if (width === 390) await page("Emulation.setTouchEmulationEnabled", { enabled: true });
    await page("Page.addScriptToEvaluateOnNewDocument", { source: `
      localStorage.setItem("e2a2o.toured", "1");
      localStorage.setItem("e2a2o.features", "{}");
      localStorage.setItem("e2a2o.bricks", "{}");
      window.swarmErrors = [];
      addEventListener("error", (e) => window.swarmErrors.push(e.message));
      addEventListener("unhandledrejection", (e) => window.swarmErrors.push(String(e.reason)));
    ` });
    await page("Page.navigate", { url });
    const check = async (expression, label, ms = 8000) => {
      const passed = await until(expression, ms);
      if (!passed) {
        const { data } = await page("Page.captureScreenshot", { format: "png" });
        writeFileSync(join(shots, `failed-${width}.png`), Buffer.from(data, "base64"));
      }
      assert.ok(passed, `${width}: ${label}`);
    };
    await check('!!document.querySelector("[data-guide=composer] textarea")', "composer ready");
    await evaluate('[...document.querySelectorAll("button")].find((b) => b.textContent === "Skip tour")?.click()');
    const key = async (key, code = key, n = key === "Enter" ? 13 : key === "Escape" ? 27 : 0) => {
      await page("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: n, ...(key === "Enter" ? { text: "\r" } : {}) });
      await page("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: n });
    };
    const type = async (text) => {
      await evaluate('document.querySelector("[data-guide=composer] textarea").focus()');
      await page("Input.insertText", { text });
      await key("Enter");
    };
    // The composer can paint before the socket's Full-preset capabilities arrive.
    await evaluate('document.activeElement?.blur()');
    await key("c", "KeyC", 67);
    await check('!!document.querySelector("[role=switch][aria-label=\\"Thinking helpers\\"]")', "Full preset connected", 15000);
    await key("Escape");
    await type("put three helpers on the pitch");
    await check('document.querySelector(".send-card")?.innerText.includes("3 helpers")', "immediate helpers card");
    await check('!!document.querySelector(".work-spine-lane, .work-spine-card")', "Work spine switches on");
    const showPhone = async () => {
      if (width === 390) {
        const { x, y } = await evaluate('(() => { const r = document.querySelector(".work-spine-bar").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()');
        await page("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
        await page("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      }
    };
    await showPhone();
    await check('document.querySelectorAll("[data-job-id][data-parent][data-status=queued]").length === 3', "three children queued before execution");
    assert.equal(await evaluate('document.querySelectorAll("[data-job-id][data-parent][data-status=running]").length'), 0, "countdown and delayed split have zero running children");
    await check('document.querySelector(".work-spine-counts")?.textContent.includes("3 queued")', "parent excluded from queued count");
    const swarm = await evaluate('[...document.querySelectorAll(".work-spine-list > [data-job-id]")].at(-1).dataset.jobId');
    const current = `[data-job-id=${JSON.stringify(swarm)}]`;
    await type("The phone needs a clear primary action");
    await type("where was I?");
    assert.equal(await evaluate('(() => { const e = document.querySelector("[data-guide=composer] textarea"); const r = e.getBoundingClientRect(); return !!document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest("[data-guide=composer]"); })()'), true, "composer remains reachable");
    // Typing closes the phone sheet; open it again to inspect running and finished work.
    if (width === 390) await evaluate('if (!document.querySelector(".work-spine-sheet")) document.querySelector(".work-spine-bar")?.click()');
    const screenshot = async (name) => { const { data } = await page("Page.captureScreenshot", { format: "png" }); writeFileSync(join(shots, `${name}-${width}.png`), Buffer.from(data, "base64")); };
    await screenshot("preparing");
    await check(`document.querySelector(${JSON.stringify(current)})?.dataset.status === "done" && document.querySelector(${JSON.stringify(current)}).querySelectorAll("[data-job-id][data-status=done]").length === 3`, "all current rows finish", 12000);
    await check('document.body.innerText.includes("Helpers:")', "one thought lands on the topic");
    await evaluate(`document.querySelector(${JSON.stringify(current)}).querySelector("details summary")?.focus()`);
    await key("Enter");
    await check('!!document.querySelector("[data-job-id] details[open]")', "row opens its answer");
    await check('[...document.querySelectorAll(".work-spine-word")].some(e => e.textContent.includes("Done in"))', "completion seconds shown");
    await check(`document.querySelector(${JSON.stringify(current)}).querySelector("details[open]")?.innerText.includes("Useful finding")`, "the answer opens from a finished row");
    await screenshot("done");
    await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
    await screenshot("done-dark");
    if (width === 1440) {
      await page("Emulation.setDeviceMetricsOverride", { width: 720, height: 450, deviceScaleFactor: 2, mobile: false });
      await check('!!document.querySelector(".work-spine-card")', "compact view at 200% equivalent");
      await evaluate('document.querySelector(".work-spine-bar").click()');
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, "compact view fits");
      await screenshot("compact-200pct");
      await key("Escape");
      await page("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    }
    if (width === 390) await key("Escape");
    await type("get five helpers on the pitch");
    await check('document.querySelector(".send-card")?.innerText.includes("5 helpers")', "another countdown");
    await evaluate('document.querySelector(".send-card-stop")?.focus()');
    await key("Escape");
    await check('document.querySelector(".send-card")?.innerText.includes("Stopped")', "Escape stops the countdown");
    await screenshot("stopped");
    // Features switch actually disables command recognition at the core.
    await type("put four helpers on the pitch");
    await check('document.querySelector(".send-card")?.innerText.includes("4 helpers")', "countdown before switching off");
    await evaluate('document.activeElement?.blur()');
    await key("c", "KeyC", 67);
    await check('!!document.querySelector("[role=switch][aria-label=\\"Thinking helpers\\"]")', "Features includes helpers");
    await evaluate('document.querySelector("[role=switch][aria-label=\\"Thinking helpers\\"]").click()');
    await key("Escape");
    await check('document.querySelector(".send-card")?.innerText.includes("Stopped")', "Features off stops the pending countdown");
    await type("get ten helpers on the pitch");
    assert.equal(await until('document.querySelector(".send-card")?.innerText.includes("10 helpers")', 500), false, "feature off does not start helpers");
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, "no horizontal overflow");
    assert.deepEqual(await evaluate("window.swarmErrors"), [], "no page errors");
    await browser.close(); browser = null;
  }
  const rows = readFileSync(trace, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(rows.filter((l) => l.kind === "helpers_landed").length, 2);
  assert.equal(rows.filter((l) => l.kind === "helpers_stopped").length, 4);
  assert.ok(rows.filter((l) => l.kind === "call").every((l) => l.model === "muse-spark-1.3"));
  const executions = rows.filter((l) => l.kind === "helpers_execution");
  assert.equal(executions.filter((l) => l.phase === "start").length, 6);
  for (const start of executions.filter((l) => l.phase === "start")) {
    const end = executions.find((l) => l.phase === "end" && l.call_id === start.call_id);
    assert.ok(end && end.at >= start.at && end.outcome === "done");
    assert.equal(start.provider, "meta");
    assert.equal(start.model, "muse-spark-1.3");
    assert.ok(start.child_id.startsWith(start.swarm_id + ":"));
  }
  assert.equal(rows.filter((l) => l.kind === "helpers_speech_end").length, 6);
  console.log(`helpers-check: passed; real core at ${url}, desktop/phone, parallel rows, answers, landing, Stop, Features; screenshots ${shots}`);
} finally {
  await browser?.close();
  if (app.exitCode === null) app.kill("SIGTERM"); // Only the recorded PID this check started.
}
