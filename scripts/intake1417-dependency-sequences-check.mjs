// Build this isolated preview and exercise visible behavior through a private Chrome pipe.
// No listening ports, app service, model calls, microphone or operational scheduler.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { once } from "node:events";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const feature = join(root, "ui/src/intake1417/dependency-sequences");
const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, encoding: "utf8" }).trim();
const dependencyUI = existsSync(join(root, "ui/node_modules")) ? join(root, "ui") : resolve(common, "../ui");
const requireDependency = createRequire(join(dependencyUI, "package.json"));
const output = mkdtempSync(join(tmpdir(), "dependency-sequences-check-"));
const reactTypes = dirname(requireDependency.resolve("@types/react/package.json"));
const domTypes = dirname(requireDependency.resolve("@types/react-dom/package.json"));
const config = join(output, "tsconfig.json");
writeFileSync(config, JSON.stringify({ extends: join(root, "ui/tsconfig.json"), compilerOptions: { types: [join(dirname(requireDependency.resolve("vite/package.json")), "client.d.ts")], paths: { react: [join(reactTypes, "index.d.ts")], "react/*": [join(reactTypes, "*")], "react-dom/*": [join(domTypes, "*")] } }, include: [join(feature, "**/*.ts"), join(feature, "**/*.tsx")] }));
try {
  execFileSync(process.execPath, [join(dirname(requireDependency.resolve("typescript/package.json")), "bin/tsc"), "--project", config], { cwd: root, stdio: "pipe" });
} catch (error) { throw new Error("REAL: scoped TypeScript failure\n" + (error.stdout?.toString() ?? error.message)); }
console.log("PASS scoped TypeScript check");

const { build } = await import(pathToFileURL(requireDependency.resolve("vite")));
const aliases = ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client"].map(name => ({ find: new RegExp(`^${name}$`), replacement: requireDependency.resolve(name) }));
const dist = join(output, "preview");
const baseBuild = { configFile: false, root: feature, logLevel: "error", resolve: { alias: aliases } };
await build({ ...baseBuild, build: { outDir: dist, emptyOutDir: false, rolldownOptions: { input: join(feature, "preview.html") } } });
await build({ ...baseBuild, build: { outDir: join(output, "analysis"), emptyOutDir: false, lib: { entry: join(feature, "analysis.ts"), formats: ["es"], fileName: () => "analysis.mjs" } } });

const analysis = await import(pathToFileURL(join(output, "analysis/analysis.mjs")));
function part(id, prerequisites = [], evidence = "pending", fileScopes = [`sample/${id}/**`]) { return { id, name: `Part ${id}`, owner: "Sample team", prerequisites, evidence, fileScopes }; }
function rows(parts) { const input = analysis.DependencyInput({ revision: "test", parts }); assert.equal(input.ok, true); return analysis.DependencyOrder(input.snapshot).rows; }
function checkAnalysis() {
  assert.deepEqual(rows([part("A"), part("B", ["A"]), part("C")]).map(row => row.status), ["ready", "blocked", "ready"]);
  assert.equal(rows([part("A", [], "complete"), part("B", ["A"])])[1].status, "ready");
  assert.deepEqual(rows([part("A", ["missing"]), part("B", ["A"])]).map(row => row.status), ["unknown", "unknown"]);
  assert.deepEqual(rows([part("A", ["B"]), part("B", ["A"]), part("C", ["A"])]).map(row => row.status), ["cyclic", "cyclic", "blocked"]);
  assert.equal(rows([part("A", ["A"])])[0].status, "cyclic");
  assert.equal(rows([part("A", [], "unknown")])[0].status, "unknown");
  const dense = Array.from({ length: 30 }, (_, index) => part(`N${index}`, index ? Array.from({ length: index }, (_, previous) => `N${previous}`) : ["missing"]));
  const explanations = rows(dense);
  assert.ok(explanations.every(row => row.status === "unknown" && row.reasons.every(reason => reason.length < 300)), "dense unknown graph stays blocked with readable immediate causes");
  for (const parts of [[part("A"), part("A")], [{ ...part("A"), owner: "" }], [{ ...part("A"), evidence: "maybe" }], [{ ...part("A"), evidence: { toString: () => "complete" } }], [part("A", [], "pending", ["../private"])], [part("A", [], "pending", ["/absolute/file"])], [part("A", [], "pending", ["sample/*.ts"])], [part("bad id")]]) assert.equal(analysis.DependencyInput({ revision: "bad", parts }).ok, false);
  const ownership = [part("A", [], "pending", ["sample/view/**"]), part("B", [], "pending", ["sample/view/button.ts"]), part("C", [], "pending", ["sample/viewer/file.ts"]), part("D", [], "pending", ["sample/view/deep/**"])];
  assert.deepEqual(analysis.CollisionGroups(ownership).map(pair => `${pair.left}+${pair.right}`), ["A+B", "A+D"]);
  const ready = rows(ownership);
  assert.deepEqual(analysis.ParallelComparison(ready[0], ready, analysis.CollisionGroups(ownership)).map(pair => pair.compatible), [false, true, false]);
  const undeclared = rows([part("A", [], "pending", []), part("B")]);
  assert.equal(analysis.ParallelComparison(undeclared[0], undeclared, [])[0].compatible, false);
  console.log("PASS graph, unknown propagation, cycles, input rejection and ownership boundaries");
}
checkAnalysis();

const chrome = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(path => path && existsSync(path));
if (!chrome) throw new Error("MISSING: Chrome required for visible check");
const origin = "https://dependency-sequences.test";

async function Browser() {
  const process = spawn(chrome, ["--headless=new", "--remote-debugging-pipe", `--user-data-dir=${join(output, "chrome-profile")}`, "--no-first-run", "--no-default-browser-check", "--use-mock-keychain", "--password-store=basic", "--disable-background-networking", "--mute-audio", "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  console.log(`Owned Chrome PID: ${process.pid}`);
  let sequence = 0, incoming = "";
  const pending = new Map(), listeners = new Map(), exceptions = [], unexpectedRequests = [];
  process.stdio[4].on("data", chunk => {
    incoming += chunk.toString();
    for (let end; (end = incoming.indexOf("\0")) >= 0;) {
      const message = JSON.parse(incoming.slice(0, end)); incoming = incoming.slice(end + 1);
      if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
      else listeners.get(message.method)?.(message.params);
    }
  });
  function command(method, params = {}, sessionId) {
    return new Promise((resolveCommand, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`TIMING: CDP ${method}`)); }, 12000);
      pending.set(id, message => { clearTimeout(timer); message.error ? reject(new Error(JSON.stringify(message.error))) : resolveCommand(message.result); });
      process.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
    });
  }
  const { targetId } = await command("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await command("Target.attachToTarget", { targetId, flatten: true });
  const page = (method, params) => command(method, params, sessionId);
  listeners.set("Runtime.exceptionThrown", event => exceptions.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text));
  listeners.set("Fetch.requestPaused", async event => {
    try {
      const url = new URL(event.request.url);
      const file = resolve(dist, "." + (url.pathname === "/" ? "/preview.html" : url.pathname));
      const known = url.origin === origin && file.startsWith(dist + "/") && existsSync(file);
      if (!known && url.pathname !== "/favicon.ico") unexpectedRequests.push(event.request.url);
      await page("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: known ? 200 : 404, responseHeaders: [{ name: "content-type", value: ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[extname(file)] ?? "text/plain" }], body: known ? readFileSync(file).toString("base64") : "" });
    } catch (error) { exceptions.push(error.message); }
  });
  await page("Runtime.enable"); await page("Page.enable");
  await page("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  async function evaluate(expression) {
    const result = await page("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  async function until(expression, label) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await new Promise(resolvePoll => setTimeout(resolvePoll, 30));
    }
    throw new Error(`TIMING: ${label}`);
  }
  async function click(label, touch = false) {
    const point = await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(button => button.textContent === ${JSON.stringify(label)}); if (!button) throw Error('Missing button'); button.scrollIntoView({block:'center'}); const rect = button.getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}; })()`);
    if (touch) {
      await page("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, radiusX: 1, radiusY: 1 }] });
      await page("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else for (const type of ["mousePressed", "mouseReleased"]) await page("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
  }
  async function key(key, code = key) {
    const windowsVirtualKeyCode = key === "Enter" ? 13 : key === "Tab" ? 9 : 0;
    await page("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode, ...(key === "Enter" ? { text: "\r" } : {}) });
    await page("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
  }
  return { page, evaluate, until, click, key, exceptions, unexpectedRequests,
    async shot(name) { const { data } = await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); writeFileSync(join(output, `${name}.png`), Buffer.from(data, "base64")); },
    async close() { const exited = once(process, "exit"); if (process.exitCode === null) { process.kill("SIGTERM"); await exited; } assert.notEqual(process.exitCode, undefined); },
  };
}

let browser;
try {
  browser = await Browser();
  const { page, evaluate, until, click, key } = browser;
  await page("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await page("Page.navigate", { url: origin });
  await until("document.body.innerText.includes('Feature is off')", "default off host");
  assert.match(await evaluate("document.body.innerText"), /Snapshot reads: 0 · Active subscriptions: 0/);
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Dependency sequences\"]') === null"), true);
  await until("document.activeElement?.textContent === 'Enable dependency sequences'", "host keyboard entry focus");
  await key("Enter");
  await until("document.querySelector('[aria-label=\"Part B\"]')", "ready snapshot");
  let text = await evaluate("document.body.innerText");
  assert.match(text, /A → B/); assert.match(text, /Waiting for prerequisite A/); assert.match(text, /No prerequisites; independently eligible/);
  assert.match(text, /Unknown prerequisite MISSING/); assert.match(text, /Cycle among X, Y/);
  assert.match(await evaluate("document.querySelector('[aria-label=\"Parallel eligibility\"] li[data-compatible=true]').innerText"), /A \+ C/);
  assert.match(await evaluate("document.querySelector('[aria-label=\"File collisions\"]').innerText"), /A \+ D.*No parallel recommendation/);
  await browser.shot("desktop-sequences");
  await evaluate("document.querySelector('[aria-label=\"File collisions\"]').scrollIntoView({block:'start'})");
  await browser.shot("desktop-collisions");
  await click("Inspect B");
  await until("document.activeElement?.textContent === 'B — Build detail view'", "detail heading focus");
  await key("Tab");
  assert.equal(await evaluate("document.activeElement?.textContent"), "A — Prepare interface", "keyboard reaches prerequisite inspection");
  assert.match(await evaluate("document.querySelector('[aria-label=\"Prerequisites\"]').innerText"), /A — Prepare interface/);
  await click("Return to sequences");
  await until("document.activeElement?.textContent === 'Inspect B'", "return focus to selected B");
  assert.equal(await evaluate("document.activeElement.getAttribute('aria-pressed')"), "true");
  await key("Enter");
  await click("Refresh snapshot");
  await until("document.activeElement?.textContent === 'B — Build detail view'", "refresh retains B detail");
  await browser.shot("desktop-detail");
  await page("Page.reload");
  await until("document.body.innerText.includes('Feature is off')", "fresh profile switch remains off on reload");
  assert.match(await evaluate("document.body.innerText"), /Snapshot reads: 0 · Active subscriptions: 0/);
  await click("Enable dependency sequences");
  await until("document.querySelector('button[data-part-id=\"B\"]')?.getAttribute('aria-pressed') === 'true'", "reload retains B selection");
  await click("Inspect B");
  await click("Mark A complete");
  await until("document.querySelector('.ds-detail [data-status=ready]')", "A completion makes B eligible");
  await click("Simulate unavailable snapshot");
  await until("document.querySelector('[role=alert]')", "read failure explained");
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Parallel eligibility\"]') === null"), true);
  await click("Restore sample snapshot");
  await until("document.querySelector('.ds-detail h2')?.textContent === 'B — Build detail view'", "recovery retains B");
  await click("Simulate invalid snapshot");
  await until("document.querySelector('[role=alert]')?.textContent.includes('owner is required')", "invalid input explained");
  await click("Restore sample snapshot");
  await until("document.querySelector('.ds-detail')", "valid recovery");
  await click("Hide B in snapshot");
  await until("document.body.innerText.includes('Selected part B is absent')", "missing selection retained explicitly");
  await click("Restore sample snapshot");
  await until("document.querySelector('.ds-detail h2')?.textContent === 'B — Build detail view'", "restored selected part");
  await click("Supply empty snapshot");
  await until("document.body.innerText.includes('No parts supplied')", "empty snapshot explained");
  await click("Restore sample snapshot");
  await until("document.querySelector('.ds-detail')", "empty recovery");
  await click("Hold next read");
  await until("document.body.innerText.includes('Reading snapshot')", "read is pending");
  await click("Turn off and return");
  await until("document.body.innerText.includes('Feature is off') && document.body.innerText.includes('Active subscriptions: 0')", "off cleans owned subscription");
  const offActivity = await evaluate("document.querySelector('[aria-label=\"Adapter activity\"]').textContent");
  await click("Deliver queued update");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => resolve(true)))");
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Adapter activity\"]').textContent"), offActivity, "off rejects already queued subscription callbacks without reads");
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Dependency sequences\"]') === null"), true);
  await browser.shot("host-return");
  await click("Enable dependency sequences");
  await until("document.body.innerText.includes('Reading snapshot')", "reentry uses adapter");
  await click("Release held read");
  await until("document.querySelector('.ds-detail h2')?.textContent === 'B — Build detail view'", "exit and reentry retain selection");
  await page("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 1, mobile: true });
  await page("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await evaluate("document.querySelector('.ds-detail h2').scrollIntoView({block:'start'})");
  await browser.shot("phone-detail");
  await click("Return to sequences");
  await until("document.activeElement?.textContent === 'Inspect B'", "phone return focus");
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, "no horizontal overflow at 320px");
  await browser.shot("phone-sequences");
  await evaluate("document.querySelector('[aria-label=\"Dependency sequences\"]').style.fontSize='200%'");
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, "enlarged text wraps at 320px");
  await click("Inspect U", true);
  await until("document.querySelector('.ds-detail')", "phone unknown inspection");
  assert.match(await evaluate("document.querySelector('.ds-detail').innerText"), /Unknown prerequisite MISSING/);
  await browser.shot("phone-enlarged-unknown");
  await evaluate("document.querySelector('[aria-label=\"Eligibility explanation\"]').scrollIntoView({block:'start'})");
  await browser.shot("phone-enlarged-explanation");
  await click("Turn off and return", true);
  await until("document.activeElement?.textContent === 'Enable dependency sequences'", "host focus after phone exit");
  assert.deepEqual(browser.exceptions, [], "no runtime or interception errors");
  assert.deepEqual(browser.unexpectedRequests, [], "no external actions or service requests");
  console.log("PASS visible A→B/C, collisions, unknown/cycle, keyboard/touch, detail/return/refresh/reload, failure recovery, off cleanup, 320px and enlarged text");
  console.log(`Artifacts: ${output}`);
} catch (error) {
  console.error("REAL: focused check failed", error);
  if (browser) console.error(await browser.evaluate("document.body.innerText.slice(0,1800)").catch(() => "Browser unavailable"));
  throw error;
} finally { if (browser) await browser.close(); }
