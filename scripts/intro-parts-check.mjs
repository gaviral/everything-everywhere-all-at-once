// Opening parts on the built page. Chrome reads disk through CDP: no app server or model calls.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, resolve } from "node:path";
import { once } from "node:events";

const rootPart = new URL("..", import.meta.url).pathname;
const distPart = join(rootPart, "ui/dist");
const chromePart = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(part => part && existsSync(part));
if (!chromePart || !existsSync(join(distPart, "index.html"))) {
  console.log("SKIP intro-parts-check: built UI and Chrome required"); process.exit(3);
}
const artifactsPart = process.env.INTRO_PART_SHOTS ?? mkdtempSync(join(tmpdir(), "intro-parts-check-"));
mkdirSync(artifactsPart, { recursive: true });
const originPart = "https://intro-parts.test";

async function browserPart() {
  const processPart = spawn(chromePart, ["--headless=new", "--remote-debugging-pipe", `--user-data-dir=${join(artifactsPart, "chrome-profile")}`, "--no-first-run", "--no-default-browser-check", "--use-mock-keychain", "--password-store=basic", "--mute-audio", "--hide-scrollbars", "--disable-background-networking", "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  let sequencePart = 0, pendingPart = "";
  const waitersPart = new Map(), listenersPart = new Map();
  processPart.stdio[4].on("data", part => {
    pendingPart += part.toString();
    for (let endPart; (endPart = pendingPart.indexOf("\0")) !== -1;) {
      const messagePart = JSON.parse(pendingPart.slice(0, endPart)); pendingPart = pendingPart.slice(endPart + 1);
      if (messagePart.id) { waitersPart.get(messagePart.id)?.(messagePart); waitersPart.delete(messagePart.id); }
      else listenersPart.get(messagePart.method)?.(messagePart.params);
    }
  });
  function commandPart(methodPart, paramsPart = {}, sessionPart) {
    return new Promise((resolvePart, rejectPart) => {
      const idPart = ++sequencePart;
      waitersPart.set(idPart, part => part.error ? rejectPart(new Error(JSON.stringify(part.error))) : resolvePart(part.result));
      processPart.stdio[3].write(JSON.stringify({ id: idPart, method: methodPart, params: paramsPart, sessionId: sessionPart }) + "\0");
    });
  }
  const { targetId: targetPart } = await commandPart("Target.createTarget", { url: "about:blank" });
  const { sessionId: sessionPart } = await commandPart("Target.attachToTarget", { targetId: targetPart, flatten: true });
  const pagePart = (methodPart, paramsPart) => commandPart(methodPart, paramsPart, sessionPart);
  const errorsPart = [], fulfillmentErrorsPart = [];
  const abortedRequestsPart = new Set();
  listenersPart.set("Network.loadingFailed", part => { if (part.canceled && part.errorText === "net::ERR_ABORTED") abortedRequestsPart.add(part.requestId); });
  listenersPart.set("Runtime.exceptionThrown", part => errorsPart.push(part.exceptionDetails.exception?.description ?? part.exceptionDetails.text));
  listenersPart.set("Fetch.requestPaused", async part => {
    try {
      const pathPart = new URL(part.request.url).pathname;
      const filePart = resolve(distPart, pathPart === "/" ? "index.html" : "." + pathPart);
      const mimePart = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json" };
      const roomPart = pathPart === "/room";
      const existsPart = filePart.startsWith(distPart + "/") && existsSync(filePart);
      await pagePart("Fetch.fulfillRequest", { requestId: part.requestId, responseCode: roomPart || existsPart ? 200 : 404,
        responseHeaders: [{ name: "content-type", value: roomPart ? "application/json" : mimePart[extname(filePart)] ?? "text/plain" }],
        body: (roomPart ? Buffer.from(JSON.stringify({ room: false, member: true })) : existsPart ? readFileSync(filePart) : Buffer.from("")).toString("base64") });
    } catch (errorPart) {
      fulfillmentErrorsPart.push({ networkPart: part.networkId, urlPart: part.request.url, messagePart: errorPart.message });
    }
  });
  await pagePart("Page.enable");
  await pagePart("Runtime.enable");
  await pagePart("Network.enable");
  await pagePart("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  async function evaluatePart(expressionPart) {
    const resultPart = await pagePart("Runtime.evaluate", { expression: expressionPart, returnByValue: true, awaitPromise: true });
    if (resultPart.exceptionDetails) throw new Error(resultPart.exceptionDetails.exception?.description ?? resultPart.exceptionDetails.text);
    return resultPart.result.value;
  }
  async function untilPart(expressionPart, labelPart, limitPart = 6000) {
    const endPart = Date.now() + limitPart;
    while (Date.now() < endPart) {
      if (await evaluatePart(expressionPart)) return;
      await new Promise(part => setTimeout(part, 25));
    }
    throw new Error(`TIMING: ${labelPart}: ${expressionPart}`);
  }
  return { pagePart, evaluatePart, untilPart, errorsPart, verifyProtocolPart: () => {
    // The protocol part accepts only a cancellation Chrome independently reported for this exact request.
    const unexpectedPart = fulfillmentErrorsPart.filter(part => part.messagePart !== '{"code":-32602,"message":"Invalid InterceptionId."}' || !abortedRequestsPart.has(part.networkPart));
    assert.deepEqual(unexpectedPart, [], "every invalid interception has a matching browser-reported navigation abort");
  }, closePart: async () => {
    if (processPart.exitCode === null) { const exitPart = once(processPart, "exit"); processPart.kill("SIGTERM"); await exitPart; }
  } };
}

// The fixture part replaces only external services. The built app, input, mic and intro run normally.
function fixturePart({ freshPart, blockedPart }) {
  if (freshPart) sessionStorage.clear();
  localStorage.setItem("e2a2o.toured", "1");
  localStorage.setItem("e2a2o.bricks", JSON.stringify({ "intro-parts": true }));
  if (blockedPart) Object.defineProperty(window, "sessionStorage", { get() { throw new Error("Storage unavailable"); } });
  // The dev build supervisor is an external service part, absent from this disk-only fixture.
  const fetchPart = window.fetch.bind(window);
  window.fetch = (inputPart, optionsPart) => new URL(typeof inputPart === "string" ? inputPart : inputPart.url, location.href).pathname === "/build-id"
    ? Promise.resolve(new Response("", { status: 404 })) : fetchPart(inputPart, optionsPart);
  const worldPart = { threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], questions: [] };
  window.introFixturePart = { socketsPart: [], sentPart: [], mediaPart: 0, framesPart: 0 };
  class SocketPart extends EventTarget {
    static OPEN = 1; static CLOSED = 3; static CONNECTING = 0;
    readyState = 0;
    constructor() {
      super(); window.introFixturePart.socketsPart.push(this);
      setTimeout(() => { this.readyState = 1; this.onopen?.(new Event("open")); this.dispatchEvent(new Event("open")); this.receivePart({ type: "map_identity", id: "intro-synthetic-map" }); this.receivePart({ type: "snapshot", world: worldPart }); }, 0);
    }
    receivePart(part) { const eventPart = new MessageEvent("message", { data: JSON.stringify(part) }); this.onmessage?.(eventPart); this.dispatchEvent(eventPart); }
    send(part) { if (typeof part !== "string") window.introFixturePart.framesPart++; if (typeof part === "string") { const parsedPart = JSON.parse(part); window.introFixturePart.sentPart.push(parsedPart); if (parsedPart.type === "heartbeat") this.receivePart(parsedPart); } }
    close() { this.readyState = 3; this.onclose?.(new Event("close")); this.dispatchEvent(new Event("close")); }
  }
  window.WebSocket = SocketPart;
  navigator.mediaDevices.getUserMedia = async () => {
    window.introFixturePart.mediaPart++;
    const contextPart = new AudioContext(), outputPart = contextPart.createMediaStreamDestination();
    const tonePart = contextPart.createOscillator(); tonePart.connect(outputPart); tonePart.start();
    return outputPart.stream;
  };
}

let browser;
try {
  browser = await browserPart();
  const { pagePart, evaluatePart, untilPart, errorsPart } = browser;
  let scriptPart, visitPart = 0;
  async function enterPart({ widthPart = 3840, heightPart = 2160, reducedPart = false, freshPart = true, blockedPart = false, queryPart = "" } = {}) {
    if (scriptPart) await pagePart("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptPart });
    ({ identifier: scriptPart } = await pagePart("Page.addScriptToEvaluateOnNewDocument", { source: `window.introVisitPart=${++visitPart}; (${fixturePart.toString()})(${JSON.stringify({ freshPart, blockedPart })})` }));
    await pagePart("Emulation.setDeviceMetricsOverride", { width: widthPart, height: heightPart, deviceScaleFactor: 1, mobile: false });
    await pagePart("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reducedPart ? "reduce" : "no-preference" }, { name: "prefers-color-scheme", value: "light" }] });
    await pagePart("Page.navigate", { url: originPart + "/" + queryPart });
    await untilPart(`window.introVisitPart === ${visitPart} && !!document.querySelector('button.mic')`, "app controls ready");
  }
  async function introReadyPart() {
    await untilPart("!!document.querySelector('.intro-parts') && document.querySelector('.intro-parts-word').getAnimations().length > 0", "opening parts ready");
  }
  async function scrubPart(timePart) {
    await evaluatePart(`[...document.querySelectorAll('.intro-parts, .intro-parts *')].flatMap(part => part.getAnimations()).forEach(part => { part.pause(); part.currentTime = ${timePart}; })`);
  }
  async function shotPart(namePart) {
    const { data: dataPart } = await pagePart("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(artifactsPart, namePart + ".png"), Buffer.from(dataPart, "base64"));
  }
  async function initialNamePart() {
    assert.deepEqual(await evaluatePart("[...document.querySelectorAll('.intro-parts-word')].map(part => part.textContent.replace('2',''))"), ["Everything", "Everywhere", "All", "at", "Once"]);
    const boundsPart = await evaluatePart(`(() => { const parts = [...document.querySelectorAll('.intro-parts-word')].map(part => { const r = part.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; }); return { parts, width: innerWidth, height: innerHeight, font: parseFloat(getComputedStyle(document.querySelector('.intro-parts-lead')).fontSize), pointer: getComputedStyle(document.querySelector('.intro-parts')).pointerEvents }; })()`);
    for (const part of boundsPart.parts) assert.ok(part.x >= 0 && part.y >= 0 && part.right <= boundsPart.width && part.bottom < boundsPart.height - 100, "all name parts fit above the composer");
    assert.equal(boundsPart.pointer, "none", "visual parts cannot intercept controls");
    return boundsPart;
  }
  // 4K comes first: inspect full name, compact name, and actual landing geometry.
  await enterPart(); await introReadyPart(); await scrubPart(150);
  assert.ok((await initialNamePart()).font >= 300, "4K name readable across a room");
  await shotPart("01-4k-full-name");
  await scrubPart(1200); await shotPart("02-4k-compact");
  const centeredPart = await evaluatePart("[...document.querySelectorAll('.intro-parts-lead')].map(part => { const r = part.getBoundingClientRect(); return { x:r.x, y:r.y }; })");
  assert.ok(centeredPart.every(part => Math.abs(part.y - centeredPart[0].y) < 1), "five parts compress onto one baseline");
  assert.ok(centeredPart.every((part, index) => index === 0 || part.x > centeredPart[index-1].x), "mark reads E2A2O left to right");
  await scrubPart(1950);
  const landingPart = await evaluatePart("({ lead:document.querySelector('.intro-parts-lead').getBoundingClientRect().toJSON(), home:document.querySelector('.shell-wordmark').getBoundingClientRect().toJSON() })");
  assert.ok(Math.abs(landingPart.lead.x - landingPart.home.x) < 2 && Math.abs(landingPart.lead.y - landingPart.home.y) < 3, `mark lands at the real interface identity: ${JSON.stringify(landingPart)}`);
  await evaluatePart("document.querySelector('.intro-parts-word').getAnimations()[0].finish()");
  await untilPart("!document.querySelector('.intro-parts')", "opening finishes within its deadline", 2600);
  await shotPart("03-4k-app-ready");

  // Phone follows 4K, then the narrowest supported screen and classic identity.
  for (const [widthPart, heightPart, namePart, queryPart] of [[390,844,"04-phone-full-name",""],[320,568,"05-small-phone",""],[1440,900,"06-classic-name","?shell=1"]]) {
    console.log(`Screen part: ${namePart}`);
    await enterPart({ widthPart, heightPart, queryPart }); await introReadyPart(); await scrubPart(150); await initialNamePart(); await shotPart(namePart);
  }
  await enterPart({ widthPart: 1920, heightPart: 1080 }); await introReadyPart(); await scrubPart(150);
  await pagePart("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 2, mobile: false });
  await initialNamePart(); await shotPart("07-4k-at-200-percent");
  await enterPart(); await introReadyPart();
  const startedPart = Date.now();
  await untilPart("!document.querySelector('.intro-parts')", "natural opening completion", 2400);
  assert.ok(Date.now() - startedPart > 1000, "the natural opening has a readable hold before it lands");
  // A real key dismisses the opening and types into the already live field.
  await enterPart(); await introReadyPart();
  await evaluatePart("document.querySelector('textarea[aria-label=\"Type a thought\"]').focus()");
  await pagePart("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", text: "a" });
  await pagePart("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA" });
  await untilPart("!document.querySelector('.intro-parts')", "key skips opening");
  assert.equal(await evaluatePart("document.querySelector('textarea[aria-label=\"Type a thought\"]').value"), "a", "first typed character reaches the app");
  await enterPart({ freshPart: false });
  await untilPart("!!document.querySelector('[data-brick=\"intro-parts\"]')", "session part mounted");
  assert.equal(await evaluatePart("!!document.querySelector('.intro-parts')"), false, "reload does not replay this session");

  // A tap during the opening still starts the real capture path with synthetic microphone audio.
  await enterPart(); await introReadyPart();
  const micPart = await evaluatePart("(() => { const r = document.querySelector('button.mic').getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; })()");
  for (const typePart of ["mousePressed", "mouseReleased"]) await pagePart("Input.dispatchMouseEvent", { type: typePart, ...micPart, button: "left", clickCount: 1 });
  await untilPart("window.introFixturePart.mediaPart > 0 && document.querySelector('button.mic').getAttribute('aria-pressed') === 'true'", "tap starts capture through opening");
  assert.equal(await evaluatePart("!!document.querySelector('.intro-parts')"), false, "tap skips opening");
  await evaluatePart("window.introFixturePart.socketsPart.at(-1).receivePart({type:'partial',text:'A thought during the opening'})");
  await untilPart("document.body.textContent.includes('A thought during the opening')", "captured words remain visible");
  assert.ok(await evaluatePart("window.introFixturePart.sentPart.some(part => part.type === 'listen' && part.on === true)"), "capture start reaches the core socket");
  await untilPart("window.introFixturePart.framesPart > 0", "microphone frames reach the core during entry");

  await enterPart({ reducedPart: true });
  await untilPart("!!document.querySelector('[data-brick=\"intro-parts\"]')", "reduced-motion part mounted");
  assert.equal(await evaluatePart("!!document.querySelector('.intro-parts')"), false, "reduced motion has no reveal or wait");
  await enterPart(); await introReadyPart();
  await pagePart("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await untilPart("!document.querySelector('.intro-parts')", "motion preference change skips immediately");
  await enterPart(); await introReadyPart();
  await pagePart("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await untilPart("!document.querySelector('.intro-parts')", "rotation or resizing skips stale geometry");
  await enterPart({ blockedPart: true }); await introReadyPart();
  await pagePart("Input.dispatchKeyEvent", { type: "keyDown", key: "Shift", code: "ShiftLeft" });
  await untilPart("!document.querySelector('.intro-parts')", "storage failure still allows any key to skip");
  browser.verifyProtocolPart();
  assert.deepEqual(errorsPart, [], "no browser exceptions");
  console.log(`PASS opening parts: 4K, phone, 320px, classic, identity landing, typing, session, capture, reduced motion, unavailable storage. Screens: ${artifactsPart}`);
} catch (errorPart) {
  if (browser) console.error(JSON.stringify({ errorsPart: browser.errorsPart, statePart: await browser.evaluatePart("({visit:window.introVisitPart,body:document.body.innerText.slice(0,900)})").catch(() => null) }));
  throw errorPart;
} finally { if (browser) await browser.closePart(); }
