// Observable Workshop journeys with synthetic core responses; no microphone or paid calls.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { openPage, ready } from "./headless.mjs";
const why = ready(); if (why) { console.log(why); process.exit(3); }
const streams = new Set(), calls = [];
let fail = false;
const models = [{ model: "muse-spark-1.3", step: "tidies" }, { model: "muse-spark-1.3", step: "recaps" }, { model: "muse-spark-1.3", step: "flow" }, { model: "muse-spark-1.2", step: "places" }, { model: "muse-image-1.0", step: "draws" }, { model: "muse-voice-transcribe-1.0", step: "hears" }];
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://local.test").pathname;
  if (path === "/workshop/turns") { res.writeHead(200, { "content-type": "text/event-stream" }); res.write(": ready\n\n"); streams.add(res); req.on("close", () => streams.delete(res)); return; }
  if (path === "/workshop/catalog") { res.writeHead(fail ? 503 : 200, { "content-type": "application/json" }).end(JSON.stringify({ models, ready: true })); return; }
  if (path === "/flow/library") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ flows: [{ id: "writing", name: "Writing", steps: [{ id: "shorten", name: "Shorten", prompt: "Shorten the input. Keep its facts." }] }] })); return; }
  if (path === "/workshop/hackathon") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ sections: ["Rules", "Dates", "Rubric", "What’s left"].map(title => ({ title, items: ["Local event data"] })) })); return; }
  if (path === "/workshop/run" || path === "/flow/run") {
    let raw = ""; for await (const bytes of req) raw += bytes;
    const body = JSON.parse(raw); calls.push({ path, body });
    if (body.input === "fail") { res.writeHead(503).end(); return; }
    if (path === "/flow/run") { res.writeHead(200, { "content-type": "application/x-ndjson" }).end('{"delta":"Short result","ms":25}\n{"done":true,"ms":42}\n'); return; }
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ text: "A real result belongs here", ms: 123, model: body.model })); return;
  }
  const root = new URL("../ui/dist/", import.meta.url).pathname;
  const file = join(root, path === "/" ? "index.html" : path);
  if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404).end(); return; }
  res.setHeader("content-type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" })[extname(file)] ?? "application/octet-stream"); res.end(readFileSync(file));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await openPage("about:blank", { width: 1440, height: 1000 });
  const { page, evaluate: ev, until } = browser;
  await page("Page.enable");
  await page("Page.addScriptToEvaluateOnNewDocument", { source: `window.workshopMicCalls=0; if(navigator.mediaDevices) navigator.mediaDevices.getUserMedia=()=>{window.workshopMicCalls++;throw Error('Microphone forbidden in checks')}` });
  await page("Page.navigate", { url: origin + "/bricks.html?brick=workshop&sample=empty" });
  const wait = async expression => assert.ok(await until(expression), expression);
  const click = async text => ev(`[...document.querySelectorAll('.workshop button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})?.click()`);
  const fill = async (selector, text) => ev(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});const setter=Object.getOwnPropertyDescriptor(n.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(n,${JSON.stringify(text)});n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const command = async text => { await fill(".workshop-command input", text); await ev("document.querySelector('.workshop-command').requestSubmit()"); };
  await wait("window.workshopMicCalls===0");
  await wait("document.querySelectorAll('.workshop-shelf-part').length===5");
  await wait("document.querySelectorAll('.workshop-event-card').length===4");
  await command("Bring Spark here");
  await wait("document.querySelectorAll('.workshop-part').length===1");
  assert.match(await ev("document.querySelector('.workshop-part').textContent"), /Muse Spark 1.3/);
  await fill(".workshop-part textarea", "Try these words"); await click("Run");
  await wait("document.querySelector('.workshop-result').textContent.includes('0.12 s')");
  assert.equal(calls[0].body.model, "muse-spark-1.3"); assert.equal(calls[0].body.mode, "tidies");
  await command("take this away");
  await wait("document.querySelectorAll('.workshop-part').length===0 && document.activeElement.dataset.workshopPart==='muse-spark-1.3'");
  await page("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await page("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await wait("document.querySelectorAll('.workshop-part').length===1");
  await command("take this away");
  for (const stream of streams) stream.write(`data: ${JSON.stringify({ text: "Bring Shorten here" })}\n\n`);
  await wait("document.querySelector('.workshop-part')?.textContent.includes('Shorten')");
  await fill(".workshop-part textarea", "A sentence to shorten"); await click("Run");
  await wait("document.querySelector('.workshop-result').textContent.includes('Short result')");
  assert.equal(calls.at(-1).body.prompt, "Shorten the input. Keep its facts.");
  assert.match(await ev("document.querySelector('.workshop-result').textContent"), /0.04 s/);
  await command("take this away"); await command("Bring Spark here");
  await fill(".workshop-part textarea", "fail"); await click("Run");
  await wait("!!document.querySelector('.workshop-error')");
  assert.equal(await ev("document.querySelector('.workshop-part textarea').value"), "fail", "failed trials keep input");
  await fill(".workshop-part textarea", "Try again"); await click("Run");
  await wait("!document.querySelector('.workshop-error') && document.querySelector('.workshop-result').textContent.includes('0.12 s')");
  fail = true; await click("Refresh"); await wait("document.querySelector('.workshop-notice').textContent.includes('Try Refresh')");
  fail = false; await click("Refresh"); await wait("!document.querySelector('.workshop-notice').textContent.includes('Try Refresh')");
  for (const [width, height, label, scale] of [[3840,2160,"tv",1],[390,844,"phone",1],[320,720,"narrow",1],[1440,1000,"enlarged",2]]) {
    await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await ev(`document.querySelector('.workshop').style.fontSize=${JSON.stringify(`${Math.max(18, width * .0125) * scale}px`)}`);
    await ev("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    await click("Desk");
    await wait("document.querySelector('.workshop-desk').getBoundingClientRect().top >= document.querySelector('.workshop-body').getBoundingClientRect().top - 2 && document.querySelector('.workshop-desk').getBoundingClientRect().top <= document.querySelector('.workshop-body').getBoundingClientRect().top + 60");
    await wait("document.querySelector('.workshop-body').clientHeight>0");
    assert.ok(await ev("document.querySelector('.workshop-body').scrollWidth <= document.querySelector('.workshop-body').clientWidth+1"), `${label} fits horizontally`);
    assert.ok(await ev("document.querySelector('.workshop-command button').getBoundingClientRect().bottom <= innerHeight"), `${label} command is reachable`);
    if (process.env.WORKSHOP_SCREENSHOTS) { mkdirSync(process.env.WORKSHOP_SCREENSHOTS, { recursive: true }); const shot = await page("Page.captureScreenshot", { format: "png" }); writeFileSync(join(process.env.WORKSHOP_SCREENSHOTS, label + ".png"), Buffer.from(shot.data,"base64")); }
  }
  assert.equal(await ev("window.workshopMicCalls"), 0);
  await click("Close"); await wait("!!document.querySelector('.workshop-launch')");
  console.log("PASS Workshop: shelf, typed/voice commands, model/Flow trials, timing, failure recovery, keyboard return, 4 layouts; synthetic core, no microphone");
} finally { await browser?.close(); for (const stream of streams) stream.end(); await new Promise(resolve => server.close(resolve)); }
