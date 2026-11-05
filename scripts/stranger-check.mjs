// Start/restart ./run.sh sample student before each run: node scripts/stranger-check.mjs.
// This path saves thoughts and resumes unfinished work, so it needs the freshly restored fixture.
// Real core, real browser, no model key; microphone access is blocked before loading the app.
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openPage } from "./headless.mjs";
import { bundledCore, toolchainProblem } from "./start.mjs";

function checkPlatforms() {
  // Each native bundle is selected only on its own OS and architecture. Keep fixtures reversible.
  const bundles = mkdtempSync(join(tmpdir(), "stranger-platforms-"));
  for (const platform of ["darwin", "linux"]) {
    for (const arch of ["x64", "arm64"]) {
      const root = join(bundles, `${platform}-${arch}`);
      mkdirSync(root);
      const binary = join(root, `e2a2o-core-${platform}-${arch}`);
      writeFileSync(binary, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      assert.equal(bundledCore(root, platform, arch), binary);
      assert.equal(bundledCore(root, platform, arch === "x64" ? "arm64" : "x64"), null);
    }
  }
  const machine = (platform, has) => toolchainProblem({
    platform, floor: "1.89", env: {}, osRelease: "ID=ubuntu\n",
    run: command => ({ ok: has.includes(command), out: command === "rustc" ? "rustc 1.97.1" : "" }),
  });
  assert.equal(machine("darwin", ["rustc", "xcode-select -p"]), null);
  assert.match(machine("darwin", ["rustc"]), /xcode-select --install/);
  assert.equal(machine("linux", ["rustc", "cc", "pkg-config", "pkg-config openssl"]), null);
  assert.match(machine("linux", ["rustc"]), /apt install build-essential pkg-config libssl-dev/);
  const native = spawnSync(process.execPath, [fileURLToPath(new URL("./start.mjs", import.meta.url)), "--check-toolchain"], { encoding: "utf8" });
  assert.equal(native.status, 0, native.stderr);
  console.log("PASS native prerequisites and macOS/Linux bundle selection (simulated architectures)");
}

function checkMissingPrerequisite() {
  const root = mkdtempSync(join(tmpdir(), "stranger-prerequisite-"));
  for (const dir of ["bin", "scripts", "core"]) mkdirSync(join(root, dir));
  for (const file of ["run.sh", "scripts/start.mjs", "core/Cargo.toml"]) {
    copyFileSync(new URL(`../${file}`, import.meta.url), join(root, file));
  }
  symlinkSync(process.execPath, join(root, "bin/node"));
  symlinkSync("/usr/bin/dirname", join(root, "bin/dirname"));
  writeFileSync(join(root, "bin/cargo"), '#!/bin/sh\n: > "$MARKER"\nexit 91\n', { mode: 0o755 });
  // Neither Xcode nor Linux's native compiler/headers are in this synthetic PATH.
  const marker = join(root, "compiled");
  const result = spawnSync("/bin/sh", [join(root, "run.sh"), "sample"], {
    env: { PATH: join(root, "bin"), MARKER: marker }, encoding: "utf8",
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, process.platform === "darwin" ? /xcode-select --install/ : /C compiler, pkg-config and OpenSSL/);
  assert.equal(existsSync(marker), false, "Missing prerequisites must stop before invoking Cargo");
  console.log("PASS missing native prerequisites stop before compiling");
}

checkPlatforms();
checkMissingPrerequisite();

const url = new URL(process.argv[2] ?? "http://localhost:4321/?sample");
assert.ok(!["4360", "4399"].includes(url.port), "reserved port");
const browser = await openPage("about:blank", { width: 1440, height: 960, preserveProfile: true });
const page = { ...browser, call: browser.page };
const visible = `element => !!element && element.getClientRects().length > 0`;
// Cold headless Chrome on the Intel host can hold the first document for ~40 seconds.
const UI_TIMEOUT = 60000;

async function waitFor(expression, label) {
  const until = Date.now() + UI_TIMEOUT;
  while (Date.now() < until) {
    if (await page.evaluate(`!!(${expression})`).catch(() => false)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(label);
}

async function click(selector) {
  await waitFor(`[...document.querySelectorAll(${JSON.stringify(selector)})].some(${visible})`, `Visible control: ${selector}`);
  const tag = await page.evaluate(`(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find(${visible});
    element.scrollIntoView({ block: "center", behavior: "instant" });
    element.focus({ preventScroll: true });
    return element.tagName;
  })()`);
  await waitFor(`document.activeElement.matches(${JSON.stringify(selector)})`, `Focused control: ${selector}`);
  if (tag === "BUTTON") {
    await page.call("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    await page.call("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  }
}

async function type(selector, text) {
  await click(selector);
  await waitFor(`document.activeElement.matches(${JSON.stringify(selector)})`, "Text field receives focus");
  await page.call("Input.insertText", { text });
  await waitFor(`document.activeElement.value.includes(${JSON.stringify(text)})`, "Typed text appears in field");
}

async function enter() {
  // The character event is needed for implicit submission of Draw's native input form.
  await page.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", windowsVirtualKeyCode: 13 });
  await page.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
}

async function openSample() {
  await page.call("Browser.setPermission", {
    permission: { name: "microphone" }, setting: "denied", origin: url.origin,
  });
  await page.call("Page.navigate", { url: url.href });
  await page.call("Page.bringToFront");
  await waitFor(`document.body.innerText.includes("SAMPLE") && document.querySelector('[aria-label="Type a thought"]')`, "Populated sample opens");
  await waitFor(`document.body.innerText.includes("No AI key")`, "Keyless core connects");
  await waitFor(`document.body.innerText.includes("Hackathon plan")`, "Sample topic is visible");
  console.log("PASS populated, keyless sample");
}

async function checkSampleShortcuts() {
  await click('.sample-recovery-actions button:first-child');
  await waitFor(`(${visible})(document.querySelector('.return-receipt'))`, "Where was I returns to unfinished work");
  await click('button[aria-label="Sample map actions"]');
  await click('.sample-recovery-actions button:nth-child(2)');
  await waitFor(`[...document.querySelectorAll('img[src*="/images/"]')].filter(${visible}).some(img => img.complete && img.naturalWidth > 0)`, "Saved sample pictures load");
  await click('[data-slot="bottom-left"] button');
  console.log("PASS Where was I and saved Pictures");
}

async function checkTypedThought() {
  const thought = `Example: bring a blue notebook to study group ${crypto.randomUUID().slice(0, 8)}.`;
  await type('[aria-label="Type a thought"]', thought);
  await enter();
  await waitFor(`[...document.querySelectorAll('[data-capture]')].some(element => element.innerText.includes(${JSON.stringify(thought)}) && element.innerText.includes("Saved"))`, "Typed thought is visibly saved");
  console.log("PASS type and save a thought");
}

async function checkDraw() {
  await click('[data-guide="catalog"] button, button[data-guide="catalog"]');
  await waitFor(`document.querySelector('[role="switch"][aria-label="Draw"]')`, "Features lists Draw");
  await click('[role="switch"][aria-label="Draw"]');
  await waitFor(`document.querySelector('[role="switch"][aria-label="Draw"]').getAttribute("aria-checked") === "true"`, "Draw enabled");
  await click('[aria-label="Features"]');
  await click('[aria-label="Open the drawing sheet"]');
  await waitFor(`(${visible})(document.querySelector(".draw-ink"))`, "Drawing sheet opens");
  const origin = await page.evaluate(`(() => { const r=document.querySelector('.draw-ink').getBoundingClientRect(); return {x:r.x+r.width*.3,y:r.y+r.height*.4}; })()`);
  await page.call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...origin });
  await page.call("Input.dispatchMouseEvent", { type: "mouseMoved", buttons: 1, x: origin.x + 140, y: origin.y + 90 });
  await page.call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: origin.x + 140, y: origin.y + 90 });
  await type('[aria-label="Name what you drew"]', "Example notebook");
  await enter();
  await waitFor(`document.querySelector('.draw-sheet').innerText.includes('Example notebook')`, "Drawing label appears");
  await waitFor(`[...document.querySelectorAll('.draw-tools button')].some(e => e.textContent === 'Undo' && !e.disabled)`, "Drawing stroke can be undone");
  console.log("PASS Features, Draw stroke and label");
}

async function checkCrew() {
  await click('.draw-tools button:last-child');
  if (!await page.evaluate(`(${visible})(document.querySelector('[role="switch"][aria-label="Crew"]'))`)) {
    await click('[data-guide="catalog"] button, button[data-guide="catalog"]');
  }
  await click('[role="switch"][aria-label="Crew"]');
  await click('[aria-label="Features"]');
  await click('[aria-label="Open the crew"]');
  await waitFor(`(${visible})(document.querySelector('[aria-label="What should be built"]'))`, "Crew opens");
  await type('[aria-label="What should be built"]', "A notebook checklist and a study counter.");
  await click('.crew-ask button');
  await waitFor(`document.body.innerText.includes("Crew needs local development mode.")`, "Crew explains its required local launch");
  assert.equal(await page.evaluate("navigator.permissions.query({name: 'microphone'}).then(permission => permission.state)"), "denied");
  console.log("PASS Crew opens and explains its required local launch; microphone permission denied");
}

try {
  await openSample();
  await checkSampleShortcuts();
  await checkTypedThought();
  await checkDraw();
  await checkCrew();
} catch (error) {
  console.error(await page.evaluate("({ url: location.href, state: document.readyState, text: document.body.innerText.slice(-1600) })").catch(() => "Page diagnostics unavailable"));
  throw error;
} finally {
  await page.close();
}
