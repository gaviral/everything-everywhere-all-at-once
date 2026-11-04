// Focused acceptance: own temporary build and browser, no server, capture or live model call.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../../../../node_modules/vite/dist/node/index.js";

const folder = dirname(fileURLToPath(import.meta.url));
const ui = resolve(folder, "../../../..");
const artifacts = mkdtempSync(join(tmpdir(), "trigger-parts-check-"));
const dist = join(artifacts, "dist");
writeFileSync(join(artifacts, "tsconfig.json"), JSON.stringify({ extends: join(ui, "tsconfig.json"), include: [], files: [join(folder, "preview.tsx"), join(ui, "src/vite-env.d.ts")] }));
const types = spawnSync(join(ui, "node_modules/.bin/tsc"), ["--project", join(artifacts, "tsconfig.json"), "--pretty", "false"], { encoding: "utf8" });
assert.equal(types.status, 0, `REAL: focused typecheck\n${types.stdout}${types.stderr}`);
console.log("PASS focused entry typecheck");
const output = await build({ configFile: false, root: ui, logLevel: "error", build: { write: false, minify: false, lib: { entry: join(folder, "engine.ts"), formats: ["es"] } } });
const bundle = Array.isArray(output) ? output[0] : output;
const engine = await import(`data:text/javascript;base64,${Buffer.from(bundle.output.find(row => row.type === "chunk").code).toString("base64")}`);
const enabled = { exact: true, regex: true, fuzzy: true, ai: true };
const examples = engine.exampleJudgements(engine.EXAMPLE, engine.candidates(engine.EXAMPLE));
const result = engine.breakdown(engine.EXAMPLE, enabled, examples, true, []);
assert.equal(result.parts.length, 6, "six example beginnings");
assert.deepEqual(result.triggers.map(row => row.matcher), ["exact", "exact", "regex", "fuzzy", "ai"]);
assert.equal(result.parts.map(part => part.item.source.text).join(""), engine.EXAMPLE, "all original words survive");
assert.equal(engine.breakdown(engine.EXAMPLE, { exact: false, regex: false, fuzzy: false, ai: false }, examples, true, []).parts.length, 1);
const unicode = '🌱 A start. Another thing, one idea. She said “By the way, stay.”';
const unicodeParts = engine.breakdown(unicode, enabled, [], false, []);
assert.equal(unicodeParts.parts.length, 2, "quoted cues stay in their idea");
assert.equal(unicodeParts.parts[1].item.source.start, Array.from('🌱 A start. ').length, "scalar offsets");
assert.equal(unicodeParts.parts.map(part => part.item.source.text).join(""), unicode);
assert.equal(engine.breakdown('One. Another thingamajig is here.', enabled, [], false, []).parts.length, 1);
assert.equal(engine.breakdown(engine.EXAMPLE, enabled, examples, true, [result.triggers[0].id]).parts.length, 5, "join keeps the surrounding parts");
assert.throws(() => engine.readJudgements('{"judgements":[{"id":"invented","reason":"new"}]}', []));
assert.deepEqual(engine.readJudgements('{"judgements":[]}', []), []);
console.log("PASS focused types, matcher behavior, quoted cues, Unicode, original-word coverage and judgement validation");

await build({ configFile: false, root: ui, logLevel: "error", build: { outDir: dist, emptyOutDir: false, rolldownOptions: { input: join(folder, "preview.html") } } });
const chromePath = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium"].find(value => value && existsSync(value));
assert.ok(chromePath, "Chrome required for the focused visible behavior check");
const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-pipe", `--user-data-dir=${join(artifacts, "browser")}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--use-mock-keychain", "--password-store=basic", "--mute-audio", "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
let sequence = 0, buffer = "";
const pending = new Map(), listeners = new Map(), errors = [];
chrome.stdio[4].on("data", chunk => {
  buffer += chunk.toString();
  for (let end; (end = buffer.indexOf("\0")) !== -1;) {
    const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
    if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
    else listeners.get(message.method)?.(message.params);
  }
});
const command = (method, params = {}, sessionId) => new Promise((accept, reject) => {
  const id = ++sequence;
  pending.set(id, message => message.error ? reject(new Error(JSON.stringify(message.error))) : accept(message.result));
  chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
});
try {
  const { targetId } = await command("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await command("Target.attachToTarget", { targetId, flatten: true });
  const page = (method, params) => command(method, params, sessionId);
  const evaluate = async expression => {
    const response = await page("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result.value;
  };
  async function until(expression) {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await new Promise(accept => setTimeout(accept, 30));
    }
    throw new Error(`TIMING: condition did not arrive: ${expression}`);
  }
  listeners.set("Runtime.exceptionThrown", event => errors.push(event.exceptionDetails.text));
  listeners.set("Fetch.requestPaused", event => {
    void (async () => {
      const path = new URL(event.request.url).pathname;
      const file = resolve(dist, `.${path}`);
      const ok = file.startsWith(dist + "/") && existsSync(file);
      await page("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: ok ? 200 : 404, responseHeaders: [{ name: "content-type", value: { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[extname(file)] ?? "text/plain" }], body: (ok ? readFileSync(file) : Buffer.from("")).toString("base64") });
    })().catch(error => errors.push(error.message));
  });
  await page("Page.enable"); await page("Runtime.enable");
  await page("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  await page("Page.addScriptToEvaluateOnNewDocument", { source: `window.modelRequests=[];window.captureRequests=0;window.aiReply='success';
    navigator.mediaDevices.getUserMedia=()=>{window.captureRequests++;throw Error('Capture forbidden');};
    window.fetch=async(url,options)=>{window.modelRequests.push(JSON.parse(options.body));if(window.aiReply==='delayed')await new Promise(done=>window.releaseReply=done);if(window.aiReply==='error')return new Response('',{status:503});
      const input=JSON.parse(JSON.parse(options.body).input),id=input.candidates.at(-1).id;
      const text=JSON.stringify({judgements:[{id,reason:'Synthetic model review for this check.'}]});
      return new Response(JSON.stringify({delta:text})+'\\n'+JSON.stringify({done:true})+'\\n',{headers:{'content-type':'application/x-ndjson'}});};` });
  await page("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page("Page.navigate", { url: "https://trigger-parts.test/src/bricks/trigger-parts/check/preview.html" });
  await until("document.querySelectorAll('.trigger-parts-started').length===6");
  const click = async text => { await evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!button)throw Error('Missing button');button.click()})()`); };
  const fill = async (selector, text) => {
    await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(element,${JSON.stringify(text)});element.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  };
  assert.equal(await evaluate("window.modelRequests.length"), 0, "opening never calls a model");
  assert.ok(await evaluate("document.querySelector('.trigger-parts-ai.trigger-parts-started').textContent.includes('example')"));
  assert.ok(await evaluate("document.querySelector('.trigger-parts-words').getBoundingClientRect().bottom <= innerHeight"), "the first started part is readable in the desktop viewport");
  const screenshot = async name => writeFileSync(join(artifacts, name), Buffer.from((await page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })).data, "base64"));
  await screenshot("desktop.png");
  await evaluate("document.querySelector('[role=switch][aria-label=\"Exact phrase\"]').click()");
  await until("document.querySelectorAll('.trigger-parts-started').length===4");
  await evaluate("document.querySelector('[role=switch][aria-label=\"Exact phrase\"]').click()");
  await until("document.querySelectorAll('.trigger-parts-started').length===6");
  await click("Dispute this split ↗"); await until("!!document.querySelector('#trigger-parts-dispute')");
  await fill("#trigger-parts-dispute", "This continues the same design idea."); await click("Record dispute");
  await until("document.querySelector('.trigger-parts-disputes')?.textContent.includes('This continues the same design idea.')");
  await click("Join with previous part"); await until("document.querySelectorAll('.trigger-parts-started').length===5");
  assert.equal(await evaluate("[...document.querySelectorAll('.trigger-parts-words')].map(p=>p.textContent).join(' ')") , engine.EXAMPLE, "visible words survive joining");
  await click("Restore this split"); await until("document.querySelectorAll('.trigger-parts-started').length===6");
  await click("Ask Muse Spark to challenge"); await until("document.querySelector('.trigger-parts-disputes')?.textContent.includes('Muse Spark')");
  await click("Ask Muse Spark"); await until("document.querySelector('.trigger-parts-status').textContent.includes('proposed 1')");
  assert.ok(await evaluate("document.querySelector('.trigger-parts-started.trigger-parts-ai').textContent.includes('live result')"));
  await evaluate("window.aiReply='error'"); await click("Ask Muse Spark"); await until("document.querySelector('.trigger-parts-status').textContent.includes('503')");
  assert.equal(await evaluate("document.querySelectorAll('.trigger-parts-started').length"), 6, "failed model leaves parts intact");
  await evaluate("window.aiReply='delayed'"); await click("Ask Muse Spark"); await until("typeof window.releaseReply==='function'");
  await fill("#trigger-parts-source", "A new source. Another thing, keep these words.");
  await evaluate("window.releaseReply()");
  await until("document.querySelectorAll('.trigger-parts-started').length===2 && !document.querySelector('.trigger-parts-primary').disabled");
  assert.ok(await evaluate("document.querySelector('.trigger-parts-status').textContent.includes('Local preview updated')"), "stale AI reply cannot replace new source");
  await click("Reset example"); await until("document.querySelectorAll('.trigger-parts-started').length===6");
  await page("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await until("document.documentElement.clientWidth===390");
  assert.ok(await evaluate("document.documentElement.scrollWidth<=390"), "phone has no horizontal overflow");
  await evaluate("window.scrollTo(0,0)");
  await screenshot("phone.png");
  assert.equal(await evaluate("window.captureRequests"), 0, "no microphone used");
  assert.deepEqual(errors, [], "browser has no unhandled errors");
  console.log("PASS visible switches, human/AI disputes, join/restore, model failure and stale reply, phone layout, zero capture");
  console.log(`Evidence: ${artifacts}`);
} finally {
  if (chrome.exitCode === null) { const closed = once(chrome, "exit"); chrome.kill("SIGTERM"); await closed; }
}
