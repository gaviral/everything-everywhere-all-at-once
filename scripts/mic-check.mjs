// No extra dependencies: run with `node scripts/mic-check.mjs`.
// The capture path in any browser (ui/src/mic.ts, ui/public/pcm-worklet.js): the service takes 24 kHz 16-bit frames
// of 80 ms. Chromium makes a 24 kHz context and resamples itself, so its frames pass through unchanged; Safari and
// Firefox run at the device's rate (44.1 or 48 kHz), so the worklet resamples, at the right pitch and length,
// without folding sound above 12 kHz into speech. The context starts inside the click (Safari's rule), a suspended
// one is resumed, a mic the browser ends stops listening, and a refused mic leaves nothing open.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createServer } from "../ui/node_modules/vite/dist/node/index.js";

// ---- The worklet, run as the browser runs it: one processor, 128-sample blocks.
const workletSource = readFileSync(new URL("../ui/public/pcm-worklet.js", import.meta.url), "utf8");
function runWorklet(rate, input) {
  const frames = [];
  let Processor;
  const scope = {
    sampleRate: rate,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (buffer) => frames.push(new Int16Array(buffer)) }; } },
    registerProcessor: (_name, cls) => { Processor = cls; },
    Math, Float32Array, Int16Array,
  };
  vm.runInNewContext(workletSource, scope);
  const p = new Processor();
  for (let at = 0; at < input.length; at += 128) p.process([[input.subarray(at, at + 128)]]);
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

// ---- mic.ts with a fake browser.
function browser({ chromium = true, honorsRate = true, refusesMixedRates = false, startsSuspended = false, denies = false } = {}) {
  const log = [];
  const contexts = [];
  const tracks = [];
  let clickDone = false;
  class FakeContext {
    constructor(options = {}) {
      this.sampleRate = options.sampleRate && honorsRate ? options.sampleRate : 48000;
      this.state = startsSuspended ? "suspended" : "running";
      this.inClick = !clickDone;
      this.audioWorklet = { addModule: async (url) => log.push(`module ${url}`) };
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
  class FakeNode { constructor() { this.port = {}; } connect(next) { return next; } disconnect() {} }
  const navigator = { ...(chromium ? { userAgentData: {} } : {}), mediaDevices: { getUserMedia: async () => {
    clickDone = true;
    log.push("getUserMedia");
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

const server = await createServer({ root: new URL("../ui", import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
try {
  const { startMic } = await server.ssrLoadModule("/src/mic.ts");

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
  console.log("mic-check: ok (worklet at 24, 44.1 and 48 kHz; Chrome, Safari and Firefox capture paths)");
} finally {
  await server.close();
}
