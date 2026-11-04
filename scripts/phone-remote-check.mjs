// Built phone and desktop pages, real touch input and room sockets. No model calls.
// npm --prefix ui run build; PRECHECK_PAGES=1 node scripts/phone-remote-check.mjs
// PHONE_REMOTE_URL=http://127.0.0.1:PORT uses a running Rust room with the fixture below.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ready, standInCore, openPage, sleep } from "./headless.mjs";
const why = ready();
if (why) { console.log(`SKIP phone-remote-check: ${why}`); process.exit(3); }
const now = Date.now();
const world = {
  threads: ["Garden plans", "Train tickets", "Weekend picnic"].map((title, i) => ({ id: `T${i}`, title, parent_id: null, status: "open", last_point: "", touched_ms: now, tags: [], picture: null, dropped_by: "" })),
  thoughts: Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, thread_id: `T${Math.floor(i / 2)}`, speaker: "Sam", text: `Thought ${i + 1}, with the original words to read when opened.`, point: `Thought ${i + 1}`, placed: true, unclear: "", complete: true, at_ms: now + i, place_ms: 1000 })),
  active: "T0", active_by: { Sam: "T0" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], topics: {},
};
// Allows the same acceptance against a real keyless Rust process, with no personal journal.
if (process.env.PHONE_REMOTE_FIXTURE) {
  writeFileSync(process.env.PHONE_REMOTE_FIXTURE, [...world.threads.map((thread) => ({ type: "thread_added", thread })),
    ...world.thoughts.map((thought) => ({ type: "thought_added", thought })), { type: "active_changed", thread_id: "T0" }].map(JSON.stringify).join("\n") + "\n");
  console.log("phone-remote fixture written"); process.exit(0);
}
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
let core, desktop, phone;
const code = "abcd2345";
let base = process.env.PHONE_REMOTE_URL;
if (!base) {
  core = await standInCore(() => [{ type: "snapshot", world }], {
    door: { room: true, member: true, code, invite: `http://192.168.1.5:48173/?room=${code}` },
    onMessage: (message) => { if (message.type === "remote_selection") core.send(message); },
  });
  base = `http://127.0.0.1:${core.port}`;
}
const check = async (browser, expression, name) => assert.ok(await browser.until(expression, 15000), name);
const key = async (browser, value) => { for (const type of ["keyDown", "keyUp"]) await browser.page("Input.dispatchKeyEvent", { type, key: value }); };
const shot = async (browser, name) => {
  if (!shots) return;
  await sleep(250);
  const { data } = await browser.page("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(join(shots, `${name}.png`), Buffer.from(data, "base64"));
};
async function setup(width, height, name = "") {
  const browser = await openPage("about:blank", { width, height });
  await browser.page("Page.enable");
  await browser.page("Page.addScriptToEvaluateOnNewDocument", { source: `
    localStorage.setItem('e2a2o.toured','1');
    ${name ? `sessionStorage.setItem('e2a2o.joined',${JSON.stringify(name)});` : ""}
    window.errors=[]; window.haptics=[]; window.remoteSent=[]; window.pointerTrace=[];
    for(const kind of ['pointerdown','pointermove','pointerup','pointercancel']) addEventListener(kind,e=>pointerTrace.push([kind,e.pointerId,e.clientX,e.clientY]));
    const originalSend=WebSocket.prototype.send;
    WebSocket.prototype.send=function(data){ if(typeof data==='string') { const m=JSON.parse(data); if(m.type==='remote_selection') remoteSent.push(m.message); } return originalSend.call(this,data); };
    navigator.vibrate=(pattern)=>{ haptics.push(pattern); return true; };
    addEventListener('error',e=>{if(!/^ResizeObserver loop/.test(e.message)) errors.push(e.message)});
    addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
  ` });
  await browser.page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await browser.page("Emulation.setTouchEmulationEnabled", { enabled: width < 600, maxTouchPoints: 5 });
  return browser;
}
let count = 0;
try {
  desktop = await setup(1440, 900, "Sam");
  await desktop.page("Page.navigate", { url: `${base}/?room=${code}` });
  await check(desktop, `!!document.querySelector('.spine-ready')`, "desktop Canvas loaded");
  await key(desktop, "c");
  const toggle = `document.querySelector('[data-row="phone-remote"] [role="switch"]')`;
  await check(desktop, `!!${toggle}`, "Features has Phone remote");
  assert.equal(await desktop.evaluate(`${toggle}.getAttribute('aria-checked')`), "false");
  assert.equal(await desktop.evaluate(`!!document.querySelector('.phone-pair,.spine-phone-ring,.spine-phone-caption')`), false, "off adds no controls or overlays");
  await desktop.evaluate(`${toggle}.click()`);
  await check(desktop, `!!document.querySelector('.phone-pair img')`, "pairing QR rendered");
  const qrLink = await desktop.evaluate(`document.querySelector('.phone-pair a').href`);
  assert.ok(qrLink.includes(`room=${code}`) && qrLink.includes("remote=Sam") && qrLink.includes("touchpad=1"), "QR pairs by room and device name");
  assert.ok(!qrLink.includes("localhost") && !qrLink.includes("127.0.0.1"), "invite has a LAN address");
  await desktop.evaluate(`document.querySelector('.phone-pair').scrollIntoView({block:'center'})`);
  await shot(desktop, "pairing-desktop");
  await key(desktop, "Escape");
  phone = await setup(390, 844);
  await phone.page("Page.navigate", { url: `${base}/?room=${code}&remote=Sam%27s%20phone&touchpad=1` });
  await check(phone, `!!document.querySelector('.phone-touchpad') && document.querySelector('.phone-touchpad-label').textContent.includes('Garden plans')`, "one scan pairs without a name form; selection returns");
  assert.equal(await phone.evaluate(`document.querySelector('.phone-touchpad').children.length`), 1, "phone shows only its huge label");
  assert.ok(await phone.evaluate(`localStorage.getItem('e2a2o.phone-pair').includes('touchpad')`), "phone remembers pair");
  const touch = async (type, touchPoints) => {
    await phone.page("Input.dispatchTouchEvent", { type, touchPoints });
    await sleep(35); // Let touch events cross a rendered frame, as a hand's movement does.
  };
  const swipe = async (x, y, dx, dy) => {
    await touch("touchStart", [{ x, y, id: 1 }]);
    for (let i = 1; i <= 4; i++) await touch("touchMove", [{ x: x + dx * i / 4, y: y + dy * i / 4, id: 1 }]);
    await touch("touchEnd", []); count++;
  };
  const tap = async () => { await touch("touchStart", [{ x: 190, y: 420, id: 1 }]); await touch("touchEnd", []); };
  await swipe(100, 420, 150, 0);
  await check(desktop, `document.querySelector('.spine-phone-ring')?.dataset.remoteThread === 'T1'`, "right swipe selects next desktop topic");
  await check(phone, `document.querySelector('.phone-touchpad-label').textContent.includes('Train tickets')`, "phone label matches desktop");
  await swipe(190, 300, 0, 150);
  await check(desktop, `document.querySelector('.spine-phone-ring')?.dataset.remoteThought === 'p2'`, "down selects first thought");
  await swipe(190, 300, 0, 150);
  await check(desktop, `document.querySelector('.spine-phone-ring')?.dataset.remoteThought === 'p3'`, "down selects next thought");
  await swipe(190, 500, 0, -150);
  await check(desktop, `document.querySelector('.spine-phone-ring')?.dataset.remoteThought === 'p2'`, "up selects previous thought");
  await tap(); await sleep(330);
  await check(desktop, `document.querySelector('.spine-phone-ring')?.dataset.remoteOpen === 'true'`, "tap opens desktop selection");
  await check(desktop, `document.querySelector('.spine-phone-caption')?.textContent.includes('Open')`, "caption shows opened state");
  await check(desktop, `document.querySelector('[data-id="p:p2"] .spine-original')?.getAttribute('aria-expanded') === 'true'`, "tap reveals original words in the real Canvas");
  await shot(desktop, "selection-desktop"); await shot(phone, "label-phone");
  await tap(); await sleep(70); await tap();
  await check(desktop, `document.querySelector('.spine-phone-ring')?.dataset.remoteOpen === 'false'`, "double tap goes back");
  await swipe(280, 420, -150, 0);
  await check(desktop, `document.querySelector('.spine-phone-ring')?.dataset.remoteThread === 'T0'`, "left selects previous topic");
  const viewport = () => desktop.evaluate(`document.querySelector('.react-flow__viewport').style.transform`);
  const beforeZoom = await viewport();
  await touch("touchStart", [{ x: 120, y: 420, id: 1 }, { x: 260, y: 420, id: 2 }]);
  await touch("touchMove", [{ x: 80, y: 420, id: 1 }, { x: 300, y: 420, id: 2 }]);
  await touch("touchEnd", []); await sleep(150);
  await check(desktop, `document.querySelector('.react-flow__viewport').style.transform !== ${JSON.stringify(beforeZoom)}`, "pinch changes desktop zoom");
  const beforePan = await viewport();
  await touch("touchStart", [{ x: 120, y: 360, id: 1 }, { x: 260, y: 360, id: 2 }]);
  await touch("touchMove", [{ x: 150, y: 400, id: 1 }, { x: 290, y: 400, id: 2 }]);
  await touch("touchEnd", []); await sleep(150);
  const panned = await desktop.until(`document.querySelector('.react-flow__viewport').style.transform !== ${JSON.stringify(beforePan)}`, 5000);
  if (!panned) console.log("pan trace", await phone.evaluate(`JSON.stringify({sent:remoteSent.slice(-8),haptics,pointers:pointerTrace.slice(-14)})`));
  assert.ok(panned, "two-finger drag pans desktop");
  // Emulate audio capture: actual startMic, PCM worklet and listen envelope; no speech service call.
  if (core) {
    await phone.evaluate(`navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext(), oscillator = ctx.createOscillator(), out = ctx.createMediaStreamDestination();
      oscillator.connect(out); oscillator.start(); window.testAudio = ctx; window.testStream = out.stream; return out.stream;
    }`);
    await sleep(5200); // A held touch must work after transient activation has expired.
    await touch("touchStart", [{ x: 190, y: 420, id: 1 }]); await sleep(750);
    await check(phone, `document.querySelector('.phone-touchpad-label').textContent === 'Listening…'`, "hold opens normal microphone path");
    assert.ok(core.heard.some((m) => m.type === "listen" && m.on), "normal listen message used");
    await touch("touchEnd", []);
    await check(phone, `testStream.getTracks().every(t => t.readyState === 'ended')`, "release stops phone tracks");
    assert.ok(core.heard.some((m) => m.type === "listen" && !m.on), "normal listen stop used");
    await phone.evaluate(`testAudio.close()`);
  }
  const haptics = await phone.evaluate(`haptics.map(JSON.stringify)`);
  assert.ok(new Set(haptics).size >= 8, "each navigation gesture, pan and zoom has a distinct haptic");
  await key(phone, "Escape");
  await check(phone, `!!document.querySelector('.remote') && !!document.querySelector('.phone-touchpad-mode')`, "Escape returns to existing Remote");
  await phone.evaluate(`document.querySelector('.phone-touchpad-mode').click()`);
  await check(phone, `!!document.querySelector('.phone-touchpad')`, "Touchpad can be selected on Remote");
  await phone.page("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 1, mobile: true });
  await phone.page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await phone.evaluate(`document.querySelector('.phone-touchpad-label').style.fontSize='72px'`);
  assert.equal(await phone.evaluate(`(() => { const r=document.querySelector('.phone-touchpad').getBoundingClientRect(); return r.width <= 321 && r.height <= 569 && document.documentElement.scrollWidth <= 320; })()`), true, "narrow enlarged phone has no horizontal overflow");
  await shot(phone, "narrow-enlarged-phone");
  // A fresh tab retains local pairing, but has no joined session. The offer must precede Room's gate.
  const savedPair = await phone.evaluate(`Object.fromEntries(['e2a2o.phone-pair','e2a2o.room','e2a2o.name'].map(key => [key, localStorage.getItem(key)]))`);
  await phone.close();
  phone = await setup(390, 844);
  await phone.page("Page.addScriptToEvaluateOnNewDocument", { source: `
    for (const [key, value] of Object.entries(${JSON.stringify(savedPair)})) if (value !== null) localStorage.setItem(key, value);
  ` });
  await phone.page("Page.navigate", { url: `${base}/` });
  await check(phone, `!!document.querySelector('.join-card')`, "fresh mobile session reaches Room's join gate");
  assert.equal(await phone.evaluate(`sessionStorage.getItem('e2a2o.joined')`), null, "pairing survives without a joined session");
  await check(phone, `!!document.querySelector('.phone-return')`, "fresh same-LAN tab offers Remote before joining");
  assert.equal(await phone.evaluate(`document.querySelector('.phone-return').href`), savedPair["e2a2o.phone-pair"], "offer keeps the paired room and device identity");
  assert.equal(await desktop.evaluate(`document.body.textContent.includes('Call started')`), false, "a returning paired phone stays a device instead of starting a call");
  await phone.evaluate(`document.querySelector('.phone-return').click()`);
  await check(phone, `!!document.querySelector('.phone-touchpad')`, "remembered Remote opens");
  assert.equal(await phone.evaluate(`sessionStorage.getItem('e2a2o.joined')`), "Sam's phone", "one tap restores the paired device session");
  assert.equal(await phone.evaluate(`!!document.querySelector('.phone-return')`), false, "Remote page has no return offer over its gesture surface");
  await key(desktop, "c"); await desktop.evaluate(`${toggle}.click()`); await key(desktop, "Escape");
  await check(desktop, `!document.querySelector('.spine-phone-ring,.spine-phone-caption,.phone-pair')`, "switch off removes new UI");
  await check(phone, `document.querySelector('.phone-touchpad-label').textContent === 'Phone remote is off'`, "phone learns switch is off");
  await swipe(100, 420, 150, 0);
  assert.equal(await desktop.evaluate(`!!document.querySelector('.spine-phone-ring')`), false, "off ignores gestures");
  await shot(desktop, "off-desktop");
  assert.deepEqual(await desktop.evaluate(`errors`), [], "desktop has no page errors");
  assert.deepEqual(await phone.evaluate(`errors`), [], "phone has no page errors");
  console.log(`phone-remote-check: ok (${count} swipes, tap/back, pinch/pan, haptics, ${core ? "emulated mic, " : ""}QR/pair/return/off; ${base})`);
} finally { await phone?.close(); await desktop?.close(); await core?.close(); }
