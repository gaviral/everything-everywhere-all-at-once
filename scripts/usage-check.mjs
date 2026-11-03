// A real core reads a temporary USAGE_FILE; the built page stays empty while Usage is off, then shows allowances
// when its Features switch is on. No key or new dependencies. Also checks hidden without a file, persistence, narrow/dark layouts,
// enlarged text and a dropped connection. The core's paused-clock tests cover the 60-second refresh and call count.
// Run after building the UI: node scripts/usage-check.mjs. SHOTS=dir saves the rendered states for inspection.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPage, ready, sleep } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP usage-check: ${why}`); process.exit(3); }
const root = new URL("..", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "e2a2o-usage-check-"));
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const sample = {
  updated: "2026-11-03T14:40:00Z",
  rows: [
    { label: "Claude weekly", used_pct: 67 },
    { label: "ChatGPT", left: "25 messages left" },
    { label: "Meta API", spent_usd: 12.3, cap_usd: 100 },
    { label: "Muse", left: "10 credits left" },
  ],
};
const sampleFile = join(dir, "usage.json");
writeFileSync(sampleFile, JSON.stringify(sample));
let child = null, browser = null;

async function stopCore() {
  if (!child) return;
  const core = child;
  child = null;
  const exited = new Promise((resolve) => core.exitCode !== null || core.signalCode !== null ? resolve() : core.once("exit", resolve));
  try { process.kill(-core.pid, "SIGTERM"); } catch { /* already ended */ }
  await Promise.race([exited, sleep(3000)]);
  try { process.kill(-core.pid, "SIGKILL"); } catch { /* already ended */ }
  core.stderr.destroy();
  core.unref();
}

async function startCore(file, name) {
  const portProbe = createServer();
  await new Promise((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
  const port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  let output = "", error = null;
  child = spawn("cargo", ["run", "--offline", "--quiet", "--manifest-path", join(root, "core/Cargo.toml")], {
    cwd: dir, detached: true, stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, PORT: String(port), E2A2O_UI: join(root, "ui/dist"), E2A2O_DATA: join(dir, name),
      MODEL_API_KEY: "", MODEL_CALLS_PER_HOUR: "400", USAGE_FILE: file ?? "", ROOM_CODE: "", PUBLIC_URL: "",
      E2A2O_HOSTED: "0", E2A2O_TRACE: "", PRESET: "demo", PICTURES: "off", RUST_LOG: "error" },
  });
  child.stderr.on("data", (data) => { output = (output + data).slice(-4000); });
  child.on("error", (failure) => { error = failure; });
  const url = `http://127.0.0.1:${port}`;
  for (let waited = 0; waited < 120_000; waited += 100) {
    if (error || child.exitCode !== null) throw new Error(`core did not start: ${error?.message ?? output}`);
    if (await fetch(`${url}/room`, { signal: AbortSignal.timeout(500) }).then((r) => r.ok).catch(() => false)) return url;
    await sleep(100);
  }
  throw new Error(`core did not become ready: ${output}`);
}

const usageSwitch = '[role="switch"][aria-label="Usage"]';
async function features() {
  await browser.evaluate(`[...document.querySelectorAll('[data-slot="top-right"] button')].find(b => b.textContent.includes("Features")).click()`);
  assert.ok(await browser.until(`!!document.querySelector('${usageSwitch}')`), "Usage is listed on the Features page");
}
async function toggle() {
  await browser.evaluate(`document.querySelector('${usageSwitch}').focus()`);
  await browser.page("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  await browser.page("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
}
async function shot(name) {
  if (!shots) return;
  const { data } = await browser.page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(join(shots, `usage-${name}.png`), Buffer.from(data, "base64"));
}

try {
  for (const withFile of [false, true]) {
    const url = await startCore(withFile ? sampleFile : null, withFile ? "sample-map" : "empty-map");
    browser = await openPage("about:blank");
    await browser.page("Page.enable");
    await browser.page("Page.addScriptToEvaluateOnNewDocument", { source: `
      if (!sessionStorage.getItem("usage-check")) { localStorage.clear(); sessionStorage.setItem("usage-check", "1"); }
      localStorage.setItem("e2a2o.toured", "1");
      window.__errors = [];
      addEventListener("error", e => { if (!/^ResizeObserver loop/.test(e.message)) __errors.push(e.message); });
      addEventListener("unhandledrejection", e => __errors.push(String(e.reason)));
    ` });
    await browser.page("Page.navigate", { url });
    assert.ok(await browser.until('!!document.querySelector(".shell-welcome")'), "the page received the empty map");
    assert.equal(await browser.evaluate('!!document.querySelector(".usage")'), false, "off by default, even with a usage file");
    await features();
    assert.equal(await browser.evaluate(`document.querySelector('${usageSwitch}').getAttribute("aria-checked")`), "false");
    await toggle();
    assert.ok(await browser.until(`document.querySelector('${usageSwitch}').getAttribute("aria-checked") === "true"`), "the keyboard switch enables Usage");
    await browser.evaluate('document.querySelector(".shell-rail-close").click()');

    if (!withFile) {
      assert.equal(await browser.evaluate('!!document.querySelector(".usage")'), false, "no meter without a file, even when enabled");
      await shot("no-data");
    } else {
      assert.ok(await browser.until('document.querySelectorAll(".usage-row").length === 5'), "four file allowances and the core's own row");
      const rows = await browser.evaluate('[...document.querySelectorAll(".usage-row")].map(row => ({ label: row.querySelector(".usage-label").textContent, left: row.querySelector(".usage-left").textContent, at: row.querySelector("time")?.dateTime }))');
      assert.deepEqual(rows.map((row) => row.label), ["Claude weekly", "ChatGPT", "Meta API", "Muse", "Meta API · core (1h)"]);
      assert.deepEqual(rows.map((row) => row.left), ["33% left", "25 messages left", "$87.70 left", "10 credits left", "400 of 400 calls left · 0 used"]);
      assert.ok(rows.slice(0, 4).every((row) => row.at === new Date(sample.updated).toISOString()), "file rows use the file's as-of time");
      assert.ok(Math.abs(Date.now() - Date.parse(rows[4].at)) < 60_000, "the core row has its own current as-of time");

      await browser.page("Page.reload");
      assert.ok(await browser.until('document.querySelectorAll(".usage-row").length === 5'), "switch and data survive a reload");
      for (const [width, height, scheme, large] of [[1440, 900, "light", false], [390, 844, "light", false], [390, 844, "dark", false], [320, 740, "dark", true]]) {
        await browser.page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 720 });
        await browser.page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
        await browser.evaluate(`document.documentElement.style.fontSize = ${large ? '"32px"' : '""'}`);
        await sleep(100);
        const layout = await browser.evaluate(`(() => {
          const panel = document.querySelector(".usage"), r = panel.getBoundingClientRect();
          const controls = document.querySelector('[data-slot="top-right"]').getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, controlsBottom: controls.bottom,
            width: innerWidth, height: innerHeight, clipped: panel.scrollWidth > panel.clientWidth + 1 };
        })()`);
        assert.ok(layout.left >= 0 && layout.right <= layout.width && layout.bottom <= layout.height, `${width} ${scheme}: panel stays on screen`);
        assert.ok(layout.top >= layout.controlsBottom, `${width} ${scheme}: panel clears the top-right controls`);
        assert.equal(layout.clipped, false, `${width} ${scheme}: text wraps without horizontal clipping`);
        await browser.evaluate('document.querySelector(".usage").focus()');
        assert.equal(await browser.evaluate('document.activeElement.className'), "usage", "the panel can be scrolled from the keyboard");
        await shot(`${width}-${scheme}${large ? "-large-text" : ""}`);
      }
      await stopCore();
      assert.ok(await browser.until('!document.querySelector(".usage")'), "a dropped connection hides old allowances");
    }
    assert.deepEqual(await browser.evaluate('window.__errors'), [], "no page errors");
    await browser.page("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.evaluate('document.documentElement.style.fontSize = ""');
    await features();
    await toggle();
    assert.ok(await browser.until('!document.querySelector(".usage")'), "switching Usage off removes the panel");
    await browser.close();
    browser = null;
    await stopCore();
  }
  console.log("usage-check: ok (real USAGE_FILE, off/on, no data, hourly row, reload, phone, dark, large text, disconnect)");
} finally {
  if (browser) await browser.close();
  await stopCore();
  rmSync(dir, { recursive: true, force: true });
}
