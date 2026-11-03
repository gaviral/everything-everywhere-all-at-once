// No extra dependencies: run with `node scripts/mic-check.mjs`.
// The capture path in any browser (ui/src/mic.ts, ui/public/pcm-worklet.js): the service takes 24 kHz 16-bit frames
// of 80 ms. Chromium makes a 24 kHz context and resamples itself, so its frames pass through unchanged; Safari and
// Firefox run at the device's rate (44.1 or 48 kHz), so the worklet resamples, at the right pitch and length,
// without folding sound above 12 kHz into speech. The context starts inside the click (Safari's rule), a suspended
// one is resumed, a mic the browser ends stops listening, and a refused mic leaves nothing open.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { uiServer } from "./ui-server.mjs";

// ---- The worklet, run as the browser runs it: one processor, 128-sample blocks.
const workletSource = readFileSync(new URL("../ui/public/pcm-worklet.js", import.meta.url), "utf8");
function runWorklet(rate, input, beforeBlock = () => {}) {
  const frames = [];
  let Processor;
  const scope = {
    sampleRate: rate,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: ({ frame }) => frames.push(new Int16Array(frame)) }; } },
    registerProcessor: (_name, cls) => { Processor = cls; },
    Math, Float32Array, Int16Array,
  };
  vm.runInNewContext(workletSource, scope);
  const p = new Processor();
  for (let at = 0; at < input.length; at += 128) {
    beforeBlock(p, at);
    p.process([[input.subarray(at, at + 128)]]);
  }
  return frames;
}
const tone = (rate, hz, seconds, amp = 0.5) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));
const joined = (frames) => Float64Array.from(frames.flatMap((f) => [...f]), (s) => s / 32768);
const rms = (x) => Math.sqrt(x.reduce((a, s) => a + s * s, 0) / x.length);
const crossings = (x) => { let n = 0; for (let i = 1; i < x.length; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) n++; return n; };

// At 24 kHz: exactly the old pass-through (the demo's path), frames of 1920.
{
  const input = Float32Array.from({ length: 24000 }, () => Math.random() * 2.2 - 1.1);
  const frames = runWorklet(24000, input);
  assert.equal(frames.length, 12);
  assert.ok(frames.every((f) => f.length === 1920));
  const expected = Int16Array.from(input.subarray(0, 12 * 1920), (s) => { const c = Math.max(-1, Math.min(1, s)); return c < 0 ? c * 0x8000 : c * 0x7fff; });
  assert.deepEqual(Int16Array.from(frames.flatMap((f) => [...f])), expected, "24 kHz passes through unchanged");
}

// At 48 and 44.1 kHz: one second in is one second out at 24 kHz, at the same pitch and loudness.
for (const rate of [48000, 44100]) {
  const frames = runWorklet(rate, tone(rate, 440, 2));
  const out = joined(frames);
  assert.ok(frames.every((f) => f.length === 1920), `${rate}: 80 ms frames`);
  assert.ok(Math.abs(out.length - 48000) <= 1920, `${rate}: ${out.length} samples for 2 s`);
  const steady = out.subarray(2400, 45000);
  const hz = crossings(steady) / 2 / (steady.length / 24000);
  assert.ok(Math.abs(hz - 440) < 2, `${rate}: 440 Hz came out at ${hz.toFixed(1)} Hz`);
  assert.ok(Math.abs(rms(steady) - 0.5 / Math.SQRT2) < 0.01, `${rate}: level ${rms(steady)}`);
  // Speech's top (4 kHz) keeps its level; 15 kHz, which would fold back to 9 kHz, is cut.
  const high = joined(runWorklet(rate, tone(rate, 4000, 1))).subarray(1200, 22000);
  assert.ok(rms(high) > 0.33, `${rate}: 4 kHz kept (${rms(high).toFixed(3)})`);
  const alias = joined(runWorklet(rate, tone(rate, 15000, 1))).subarray(1200, 22000);
  assert.ok(rms(alias) < 0.02, `${rate}: 15 kHz folded back at ${rms(alias).toFixed(3)}`);
}

// Pause and resume partway through frames, including the resampling filter's tail.
for (const rate of [24000, 48000, 44100]) {
  const block = 128;
  const pause = block * 2, resume = block * 4;
  const frames = runWorklet(rate, Float32Array.from({ length: rate }, (_, i) => i < resume ? 0.5 : 0), (p, at) => {
    if (at === pause) p.port.onmessage({ data: { muted: true, generation: 1 } });
    if (at === resume) p.port.onmessage({ data: { muted: false, generation: 2 } });
  });
  assert.ok(frames.length > 0 && frames.every((f) => f.every((s) => s === 0)), `${rate}: no buffered speech or filter tail after resume`);
}

// ---- mic.ts with a fake browser.
function browser({ chromium = true, honorsRate = true, refusesMixedRates = false, startsSuspended = false, denies = false, active = true, permission, worklet } = {}) {
  const log = [];
  const contexts = [];
  const tracks = [];
  let clickDone = false;
  class FakeContext {
    constructor(options = {}) {
      this.sampleRate = options.sampleRate && honorsRate ? options.sampleRate : 48000;
      this.state = startsSuspended ? "suspended" : "running";
      this.inClick = !clickDone;
      this.audioWorklet = { addModule: async (url) => { log.push(`module ${url}`); await worklet; } };
      this.destination = {};
      contexts.push(this);
    }
    createMediaStreamSource() {
      if (refusesMixedRates && this.sampleRate !== 48000) throw new DOMException("different sample-rate", "NotSupportedError");
      return { connect() {}, disconnect() {} };
    }
    createGain() { return { gain: { value: 1 }, connect: (next) => next }; }
    resume() { this.state = "running"; log.push("resume"); return Promise.resolve(); }
    close() { this.state = "closed"; return Promise.resolve(); }
  }
  class FakeNode { constructor() { this.port = { postMessage() {} }; } connect(next) { return next; } disconnect() {} }
  const navigator = { userActivation: { isActive: active }, ...(chromium ? { userAgentData: {} } : {}), mediaDevices: { getUserMedia: async () => {
    clickDone = true;
    log.push("getUserMedia");
    await permission;
    if (denies) throw new DOMException("denied", "NotAllowedError");
    const track = { stopped: false, stop() { this.stopped = true; } };
    tracks.push(track);
    return { getTracks: () => [track] };
  } } };
  globalThis.window = { AudioWorkletNode: FakeNode, isSecureContext: true, AudioContext: FakeContext };
  globalThis.AudioContext = FakeContext;
  globalThis.AudioWorkletNode = FakeNode;
  Object.defineProperty(globalThis, "navigator", { value: navigator, configurable: true });
  return { log, contexts, tracks };
}

const server = await uiServer();
try {
  const { startMic } = await server.ssrLoadModule("/src/mic.ts");

  // A granted permission alone is not a gesture; no device or audio context is opened.
  {
    const b = browser({ active: false });
    await assert.rejects(startMic(() => {}), /Tap the mic/);
    assert.equal(b.contexts.length, 0);
    assert.deepEqual(b.log, []);
  }
  // Reconnect/unmount/pagehide while permission is pending: any late stream is immediately closed.
  {
    let allow;
    const b = browser({ permission: new Promise((resolve) => { allow = resolve; }) });
    const abort = new AbortController();
    const pending = startMic(() => {}, undefined, abort.signal);
    abort.abort();
    allow();
    await assert.rejects(pending, { name: "AbortError" });
    assert.ok(b.tracks.length && b.tracks.every((t) => t.stopped));
    assert.ok(b.contexts.every((c) => c.state === "closed"));
    assert.ok(!b.log.some((l) => l.startsWith("module")), "late capture never connected");
  }
  // Cancellation while the worklet loads stops capture immediately, before that await resolves.
  {
    let loaded;
    const b = browser({ worklet: new Promise((resolve) => { loaded = resolve; }) });
    const abort = new AbortController();
    const pending = startMic(() => {}, undefined, abort.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(b.log.some((l) => l.startsWith("module")));
    abort.abort();
    assert.ok(b.tracks.every((t) => t.stopped));
    loaded();
    await assert.rejects(pending, { name: "AbortError" });
  }

  // Chrome: one context, at 24 kHz, made inside the click (before the prompt).
  {
    const b = browser();
    const stop = await startMic(() => {});
    assert.equal(b.contexts.length, 1);
    assert.equal(b.contexts[0].sampleRate, 24000);
    assert.ok(b.contexts[0].inClick, "the context is made before the permission prompt");
    assert.equal(b.log.filter((l) => l === "resume").length, 0);
    stop();
    assert.equal(b.contexts[0].state, "closed");
    assert.ok(b.tracks.every((t) => t.stopped));
  }

  // Safari, starting suspended after the prompt: one context at the device's rate (the worklet resamples), made
  // inside the click so Safari lets it run, and resumed.
  {
    const b = browser({ chromium: false, startsSuspended: true });
    const stop = await startMic(() => {});
    assert.equal(b.contexts.length, 1);
    assert.equal(b.contexts[0].sampleRate, 48000, "the worklet resamples");
    assert.ok(b.contexts[0].inClick, "made inside the click, so Safari lets it run");
    assert.ok(b.log.includes("resume"));
    stop();
  }

  // A Chromium browser that keeps its own rate: no error, the device's rate.
  {
    const b = browser({ honorsRate: false });
    const stop = await startMic(() => {});
    const live = b.contexts.filter((c) => c.state !== "closed");
    assert.equal(live.length, 1);
    assert.equal(live[0].sampleRate, 48000);
    assert.ok(live[0].inClick);
    stop();
  }

  // One that refuses a mic in a 24 kHz context (as Firefox does): it falls back to the device's rate.
  {
    const b = browser({ refusesMixedRates: true });
    const stop = await startMic(() => {});
    const live = b.contexts.filter((c) => c.state !== "closed");
    assert.equal(live.length, 1);
    assert.equal(live[0].sampleRate, 48000);
    stop();
  }

  // The browser ends the mic (another app took it): stopped, and the app is told.
  {
    const b = browser();
    let told = 0;
    await startMic(() => {}, () => told++);
    b.tracks[0].onended();
    assert.equal(told, 1);
    assert.equal(b.contexts[0].state, "closed");
  }

  // Mic refused: the error reaches the app as it was (its notice tells "denied" by name), and nothing stays open.
  {
    const b = browser({ denies: true });
    await assert.rejects(startMic(() => {}), (e) => e.name === "NotAllowedError");
    assert.ok(b.contexts.every((c) => c.state === "closed"));
  }

  // Plain http on a network address: the browser hides the mic; say why.
  {
    browser();
    globalThis.window.isSecureContext = false;
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    await assert.rejects(startMic(() => {}), /secure page \(https\)/);
  }
  // Why the mic didn't start, in words that say where to fix it: never the browser's own words (they go to the
  // console). A block by the Mac (Chrome: "Permission denied by system") is fixed in System Settings, not the browser.
  {
    const { micFailure, MicUnavailable } = await server.ssrLoadModule("/src/mic.ts");
    const fail = (name, message, where = {}) => micFailure(new DOMException(message, name), { safari: false, os: "mac", ...where });
    const mac = fail("NotAllowedError", "Permission denied by system");
    assert.match(mac.words, /^Your Mac is blocking the microphone for this browser\..*System Settings › Privacy & Security › Microphone/);
    assert.equal(mac.blocked, "mac");
    assert.match(fail("NotAllowedError", "Permission denied by system", { os: "windows" }).words, /^Windows is blocking[^]*Settings › Privacy & security › Microphone/);
    const site = fail("NotAllowedError", "Permission denied");
    assert.match(site.words, /^The browser is blocking the microphone for this site\. Allow it from the icon beside the address/);
    assert.equal(site.blocked, "site");
    assert.equal(fail("PermissionDeniedError", "").blocked, "site", "an older Chrome's name");
    const safari = fail("NotAllowedError", "The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.", { safari: true });
    assert.match(safari.words, /^Safari is blocking the microphone for this site\. Allow it in Safari › Settings for This Website/);
    assert.equal(safari.blocked, "site");
    // An iPhone or iPad has no Safari › Settings menu: its line names the page menu's Website Settings.
    const { micPlace } = await server.ssrLoadModule("/src/mic.ts");
    const iphoneUa = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
    assert.deepEqual(micPlace(iphoneUa, "iPhone", 5), { safari: true, os: "ios" });
    const ipadUa = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";
    assert.deepEqual(micPlace(ipadUa, "MacIntel", 5), { safari: true, os: "ios" }, "an iPad says it's a Mac");
    assert.deepEqual(micPlace(ipadUa, "MacIntel", 0), { safari: true, os: "mac" });
    const phone = fail("NotAllowedError", "The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.", micPlace(iphoneUa, "iPhone", 5));
    assert.match(phone.words, /^Safari is blocking the microphone for this site\. Allow it in Website Settings, from the page menu in the address bar/);
    assert.doesNotMatch(phone.words, /Safari › Settings/);
    assert.equal(phone.blocked, "site");
    // A prompt closed without an answer isn't a block: asked again on the next tap.
    const dismissed = fail("NotAllowedError", "Permission dismissed");
    assert.match(dismissed.words, /^The microphone wasn't allowed\. Tap the mic and choose Allow/);
    assert.equal(dismissed.blocked, "");
    for (const [name, message] of [["NotFoundError", "Requested device not found"], ["OverconstrainedError", ""], ["DevicesNotFoundError", ""]]) {
      assert.equal(fail(name, message).words, "No microphone found. Connect one, then tap the mic, or type below.", name);
    }
    for (const [name, message] of [["NotReadableError", "Could not start audio source"], ["AbortError", "Starting audio failed"], ["TrackStartError", ""]]) {
      assert.equal(fail(name, message).words, "The microphone is busy in another app or didn't start. Close that app, then tap the mic, or type below.", name);
    }
    // Anything else: one plain line, the browser's words nowhere on screen.
    const odd = micFailure(new TypeError("Failed to execute 'getUserMedia' on 'MediaDevices': raw words"), { safari: false, os: "mac" });
    assert.equal(odd.words, "Couldn't start the mic. Tap it to try again, or type below.");
    assert.equal(micFailure("weird", { safari: false, os: "other" }).words, odd.words);
    for (const raw of ["Requested device not found", "Could not start audio source", "Permission denied", "raw words"]) {
      for (const r of [fail("NotFoundError", raw), fail("NotReadableError", raw), fail("NotAllowedError", raw), odd]) assert.ok(!r.words.includes(raw), r.words);
    }
    // The page's own reasons (mic.ts) are already plain words: said as they are.
    const https = micFailure(new MicUnavailable("Live audio needs a secure page (https). Open the link that starts with https."), { safari: false, os: "mac" });
    assert.equal(https.words, "Live audio needs a secure page (https). Open the link that starts with https.");
    // Every line ends a sentence (the old one ran "…not found You can type below.").
    for (const r of [mac, site, safari, dismissed, odd, https]) assert.match(r.words, /[.]$/, r.words);
    // The window shows these, never the error's message (App.tsx).
    const app = readFileSync(new URL("../ui/src/App.tsx", import.meta.url), "utf8");
    assert.match(app, /micFailure\(err, /);
    assert.doesNotMatch(app, /err instanceof Error \? err\.message/);
  }

  // The site's mic permission, where the browser tells it: "denied" marks the mic blocked; a change is followed.
  {
    const { watchMicPermission } = await server.ssrLoadModule("/src/mic.ts");
    const status = { state: "denied", onchange: null };
    const seen = [];
    const stop = watchMicPermission({ query: async ({ name }) => { assert.equal(name, "microphone"); return status; } }, (s) => seen.push(s));
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(seen, ["denied"]);
    status.state = "granted"; status.onchange();
    assert.deepEqual(seen, ["denied", "granted"]);
    stop();
    assert.equal(status.onchange, null, "stopped watching");
    // A browser that doesn't answer for the mic (Firefox throws; old Safari has no permissions): nothing, no error.
    const none = [];
    watchMicPermission({ query: async () => { throw new TypeError("microphone"); } }, (s) => none.push(s))();
    watchMicPermission(undefined, (s) => none.push(s))();
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(none, []);
  }

  // The window's one way in: a click the browser made (never a script's `.click()`) or, without an event, mic.ts's
  // gesture check above; and nothing but that path calls startMic.
  {
    const app = readFileSync(new URL("../ui/src/App.tsx", import.meta.url), "utf8");
    assert.match(app, /const toggleMic = async \(event\?: \{ isTrusted: boolean \}\) => \{\s*if \(\(event && !event\.isTrusted\)/, "a script's click on the mic never starts it");
    assert.equal(app.match(/\bstartMic\(/g)?.length, 1, "startMic is called from toggleMic alone");
  }

  console.log("mic-check: ok (worklet at 24, 44.1 and 48 kHz; Chrome, Safari and Firefox capture paths; only a gesture starts it)");
} finally {
  await server.close();
}
