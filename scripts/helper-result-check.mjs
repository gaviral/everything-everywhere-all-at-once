// Built UI + actual Rust read endpoint + temporary Git repositories. Offline
// acceptance only; this fixture makes no claim about a live provider or film.
// Build the core tests using the workspace's approved wrapper, then set CORE_TEST_BIN.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ready, openPage } from "./headless.mjs";

const why = ready();
if (why) { console.log(`SKIP helper-result-check: ${why}`); process.exit(3); }
const root = new URL("../", import.meta.url).pathname;
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
// Cargo's authoritative test artifact avoids accidentally launching a normal app binary.
// Keep the candidate target directory and lease metadata for nested admission.
let testBinary = process.env.CORE_TEST_BIN;
if (!testBinary) {
  const output = execFileSync("cargo", ["test", "--manifest-path", join(root, "core/Cargo.toml"), "--no-run", "--message-format=json"],
    { cwd: root, env: process.env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const binaries = new Set(output.split("\n").flatMap(line => {
    let artifact; try { artifact = JSON.parse(line); } catch { return []; }
    return artifact.reason === "compiler-artifact" && artifact.profile?.test === true
      && artifact.target?.name === "e2a2o-core" && artifact.target.kind.includes("bin")
      && resolve(artifact.target.src_path) === resolve(root, "core/src/main.rs") && artifact.executable
      ? [artifact.executable] : [];
  }));
  assert.equal(binaries.size, 1, "Cargo must identify exactly this core's test executable");
  testBinary = [...binaries][0];
}
const app = spawn(testBinary, ["--ignored", "--exact", "helper_result::tests::app", "--nocapture"], { cwd: join(root, "core"), stdio: ["ignore", "pipe", "pipe"] });
let output = "", browser;
app.stdout.on("data", s => { output += s; }); app.stderr.on("data", s => { output += s; });
try {
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`fixture unavailable: ${output.slice(-1000)}`)), 15000);
    const started = () => { const url = output.match(/HELPER_RESULT_APP (http:\/\/\S+)/)?.[1]; if (url) { clearTimeout(timer); app.stdout.off("data", started); resolve(url); } };
    app.stdout.on("data", started); started();
    app.once("exit", code => { clearTimeout(timer); reject(new Error(`fixture exited ${code}: ${output.slice(-1000)}`)); });
  });
  const post = (body, headers = {}) => fetch(`${url}/helper-result`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  assert.equal((await post({ result_id: "../../example.txt" })).status, 404);
  assert.equal((await post({ result_id: "unknown" })).status, 404);
  assert.equal((await post({ result_id: "unknown", path: "example.txt" })).status, 422);
  assert.equal((await post({ result_id: "unknown" }, { origin: "https://example.invalid" })).status, 403);

  for (const [label, width, height, scale] of [["desktop", 1440, 900, 1], ["phone", 390, 844, 1], ["200pct", 720, 450, 2]]) {
    browser = await openPage("about:blank", { width, height });
    const { page, evaluate, until } = browser;
    await page("Page.enable");
    await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
    await page("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("e2a2o.toured", "1"); window.resultErrors=[]; addEventListener("error", e=>resultErrors.push(e.message)); addEventListener("unhandledrejection", e=>resultErrors.push(String(e.reason)));` });
    await page("Page.navigate", { url: `${url}/?shell=2&bricks=work-spine` });
    const check = async (expression, description) => {
      const ok = await until(expression, 10000);
      if (!ok) {
        console.error(await evaluate('({ proposals: [...document.querySelectorAll(".work-spine-proposal")].map(e => ({open:e.open, text:e.innerText.slice(0,500)})), errors:window.resultErrors })'));
        if (shots) { const { data } = await page("Page.captureScreenshot", { format: "png" }); writeFileSync(join(shots, `failed-${label}.png`), Buffer.from(data, "base64")); }
      }
      assert.ok(ok, `${label}: ${description}`);
    };
    await check('!!document.querySelector("[data-guide=composer] textarea") && !!document.querySelector(".work-spine-lane, .work-spine-card")', "source/composer and Work ready");
    await evaluate('document.querySelector(".work-spine-bar")?.click()');
    await check('!!document.querySelector("[data-job-id=results] .work-spine-fold")', "parent replayed");
    await evaluate('document.querySelector("[data-job-id=results] .work-spine-fold").click()');
    const selector = '[data-job-id="proposal-0"] .work-spine-proposal';
    await evaluate(`document.querySelector(${JSON.stringify(selector + " summary")}).focus()`);
    await page("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    await page("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await check(`!!document.querySelector(${JSON.stringify(selector + "[open] pre")})`, "keyboard opens actual diff");
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).innerText.includes("Validation not run")`), true);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).innerText.includes("Base ")`), true);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector + " pre")}).innerHTML.includes("&lt;img")`), true, "HTML escaped");
    assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(selector + " img")}).length`), 0);
    assert.equal(await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector + " pre")}); e.focus(); e.scrollTop=e.scrollHeight; return e.scrollTop>0 && e.scrollHeight>e.clientHeight; })()`), true, "long output scrolls");
    for (const [id, words] of [[1, "Failed · Exit 7"], [2, "Stopped"], [3, "No changes."]]) {
      await evaluate(`document.querySelector('[data-job-id="proposal-${id}"] summary').click()`);
      await check(`document.querySelector('[data-job-id="proposal-${id}"] .work-spine-proposal-body')?.innerText.includes(${JSON.stringify(words)})`, words);
      if (id < 3) assert.equal(await evaluate(`document.querySelector('[data-job-id="proposal-${id}"] .work-spine-proposal-body').innerText.includes("Execution completed")`), false);
    }
    await evaluate('document.querySelector(\'[data-job-id="helpers:thinking:0"] summary\').click()');
    await check('document.querySelector(\'[data-job-id="helpers:thinking:0"] details[open]\')?.innerText.includes("Independent answer")', "thinking expands independently");
    assert.equal(await evaluate(`!!document.querySelector(${JSON.stringify(selector + "[open]")})`), true, "coding result stays open");
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, "no page overflow");
    const reachable = selector => `(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e)return false; const r=e.getBoundingClientRect(); return r.width>0 && r.height>0 && !!document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest(${JSON.stringify(selector)}); })()`;
    assert.equal(await evaluate(reachable('[data-guide="composer"]')), true, "composer reachable with result open");
    if (width === 1440) assert.equal(await evaluate(reachable('[data-guide="thread:source"]')), true, "source reachable beside result");
    if (shots) { const { data } = await page("Page.captureScreenshot", { format: "png" }); writeFileSync(join(shots, `result-${label}.png`), Buffer.from(data, "base64")); }
    if (width !== 1440) {
      assert.equal(await evaluate('document.querySelector(".work-spine-sheet").getBoundingClientRect().top >= 0'), true, "expanded sheet stays inside short viewport");
      await page("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await page("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await check('!document.querySelector(".work-spine-sheet")', "result sheet closes");
      assert.equal(await evaluate(reachable('[data-guide="thread:source"]')), true, "source reachable after closing sheet");
    }
    assert.deepEqual(await evaluate("window.resultErrors"), [], "no browser errors");
    await browser.close(); browser = null;
  }
  console.log("helper-result-check: passed; real endpoint/repos, denied paths/unknown IDs/origin, escaped diff, independent answer, scrolling, source/composer at desktop/phone/200% equivalent");
} finally {
  await browser?.close();
  if (app.exitCode === null) { app.kill("SIGTERM"); await new Promise(resolve => app.once("exit", resolve)); }
}
