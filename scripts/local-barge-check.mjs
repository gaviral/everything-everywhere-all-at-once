// Synthetic PCM only: no microphone, speakers, transcription service or model.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../ui/public/pcm-worklet.js", import.meta.url), "utf8");
function capture(rate) {
  const messages = [];
  let Processor, at = 0;
  vm.runInNewContext(source, {
    sampleRate: rate, Math, Float32Array, Int16Array,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => messages.push(message) }; } },
    registerProcessor: (_name, processor) => { Processor = processor; },
  });
  const processor = new Processor();
  const state = data => processor.port.onmessage({ data });
  const feed = (seconds, amplitude = 0, hz = 600) => {
    const samples = Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amplitude * Math.sin(2 * Math.PI * hz * (at + i) / rate));
    at += samples.length;
    for (let i = 0; i < samples.length; i += 128) processor.process([[samples.subarray(i, i + 128)]]);
  };
  const barges = () => messages.filter(m => m.type === "barge");
  const frames = () => messages.filter(m => m.frame);
  const silent = () => frames().every(m => new Int16Array(m.frame).every(s => s === 0));
  return { processor, messages, state, feed, barges, frames, silent };
}

for (const rate of [24000, 44100, 48000]) {
  // Old behavior with the setting off: even loud input never leaves capture during playback.
  {
    const c = capture(rate);
    c.state({ muted: true, generation: 1, bargeIn: false });
    c.feed(1, 0.5);
    assert.equal(c.barges().length, 0);
    assert.ok(c.silent(), `${rate}: disabled playback stays hard-muted`);
  }
  // No acoustic claim: these are controlled residual levels, not a real echo canceller.
  for (const residual of [0, 0.004, 0.08]) {
    const c = capture(rate);
    c.state({ muted: true, generation: 1, bargeIn: true });
    c.feed(0.48, residual);
    c.feed(0.48, residual * 1.5);
    assert.equal(c.barges().length, 0, `${rate}: stable synthetic residual ${residual} does not interrupt`);
    assert.ok(c.silent(), `${rate}: residual never reaches ASR`);
  }
  // A gain change in the learned playback residual is not a second speaker.
  for (const hz of [300, 600, 635, 1100]) {
    const c = capture(rate);
    c.state({ muted: true, generation: 1, bargeIn: true });
    c.feed(0.30, 0.004, hz); c.feed(0.20, 0.025, hz);
    assert.equal(c.barges().length, 0, `${rate}: variable-volume ${hz} Hz residual does not interrupt`);
    assert.ok(c.silent(), `${rate}: variable-volume residual never reaches ASR`);
    c.feed(0.16, 0.006, hz); c.feed(0.20, 0.025, hz);
    assert.equal(c.barges().length, 0, `${rate}: repeated residual gain changes do not interrupt`);
    assert.ok(c.silent());
    c.feed(0.30, 0.12, hz);
    assert.equal(c.barges().length, 1, `${rate}: strong correction can exceed the residual-shape guard`);
  }
  {
    const c = capture(rate);
    c.state({ muted: true, generation: 1, bargeIn: true });
    c.feed(0.30, 0.004, 600); c.feed(0.20, 0.025, 900);
    assert.equal(c.barges().length, 1, `${rate}: quieter novel input still interrupts`);
    assert.ok(c.silent());
  }
  // Review regressions: startup speech must not poison calibration; a brief pause must retain the first words.
  for (const early of [false, 0.04, 0.10]) {
    const c = capture(rate), reference = capture(rate);
    const feed = (...args) => { c.feed(...args); reference.feed(...args); };
    c.state({ muted: true, generation: 4, bargeIn: true });
    if (early) {
      feed(early, 0.004, 300);
      feed(0.30, 0.12, 900);
    } else {
      feed(0.48, 0.004, 300);
      feed(0.12, 0.12, 900);
      feed(0.08, 0.004, 300);
      assert.equal(c.barges().length, 0, `${rate}: pause resets consecutive confirmation`);
      feed(0.20, 0.12, 600);
    }
    const label = early ? "speech-contaminated calibration" : "correction with an 80 ms pause";
    assert.equal(c.barges().length, 1, `${rate}: ${label} interrupts`);
    assert.ok(c.silent(), `${rate}: ${label} stays private before acknowledgement`);
    const before = c.messages.length;
    c.state({ muted: false, generation: 5, resumeBarge: 4 });
    feed(0.16, 0.12, 1000);
    const pcm = c.messages.slice(before).filter(m => m.frame).flatMap(m => [...new Int16Array(m.frame)]);
    const start = Math.round((early ? early - 0.02 : 0.46) * 24000);
    const expected = [
      ...reference.frames().flatMap(m => [...new Int16Array(m.frame)]),
      ...reference.processor.frame.slice(0, reference.processor.filled),
    ].slice(start, start + pcm.length);
    assert.ok(pcm.length >= (early ? 9600 : 11520), `${rate}: ${label} releases the complete onset`);
    assert.deepEqual(pcm, expected, `${rate}: ${label} retains every sample once, including the first segment and pause`);
  }
  for (const quiet of [0.04, 0.10]) {
    const c = capture(rate);
    c.state({ muted: true, generation: 1, bargeIn: true });
    c.feed(quiet, 0.004); c.feed(3, 0.12);
    assert.equal(c.barges().length, 1, `${rate}: three seconds of early sustained speech cannot suppress interruption`);
    assert.ok(c.silent());
  }
  // A long series of sub-confirmation syllables retains only bounded recent audio and never triggers on pauses.
  {
    const c = capture(rate);
    c.state({ muted: true, generation: 1, bargeIn: true });
    c.feed(0.48, 0.004);
    for (let i = 0; i < 20; i++) {
      c.feed(0.12, 0.12); c.feed(0.08, 0.004);
      assert.ok(c.processor.buffer.length < 24, `${rate}: recent input stays below 480 ms including partial window`);
    }
    assert.equal(c.barges().length, 0, `${rate}: separate syllables cannot accumulate confirmation`);
    assert.ok(c.silent());
    c.feed(0.16, 0.004);
    assert.equal(c.processor.buffer.length, 0, `${rate}: longer pause discards the old candidate`);
  }
  {
    const c = capture(rate);
    const reference = capture(rate);
    const feed = (...args) => { c.feed(...args); reference.feed(...args); };
    c.state({ muted: true, generation: 7, bargeIn: true });
    feed(0.48, 0.004, 300);
    feed(0.06, 0.12, 900); feed(0.16, 0.004, 500);
    assert.equal(c.barges().length, 0, `${rate}: short transient is rejected`);
    feed(0.16, 0.12, 600);
    // At device rates the low-pass onset may straddle an analysis window.
    feed(0.04, 0.12, 700);
    assert.equal(c.barges().length, 1, `${rate}: sustained nearby input signals once`);
    assert.equal(c.barges()[0].generation, 7);
    assert.ok(c.silent(), `${rate}: evidence alone cannot unmute capture`);
    feed(0.04, 0.12, 800);
    const before = c.messages.length;
    c.state({ muted: false, generation: 8, resumeBarge: 7 });
    feed(0.16, 0.12, 1000);
    const accepted = c.messages.slice(before).filter(m => m.frame);
    assert.ok(accepted.length >= 4, `${rate}: buffered onset plus continuing speech reaches ASR`);
    assert.ok(accepted.every(m => m.generation === 8 && new Int16Array(m.frame).length === 1920));
    const pcm = accepted.flatMap(m => [...new Int16Array(m.frame)]);
    const onset = pcm.findIndex(s => Math.abs(s) > 1500);
    assert.ok(onset >= 0 && onset <= 960, `${rate}: only a short preroll precedes the retained onset (${onset})`);
    assert.ok(pcm.filter(s => Math.abs(s) > 1500).length > 5000, `${rate}: correction is retained`);
    const expected = [
      ...reference.frames().flatMap(m => [...new Int16Array(m.frame)]),
      ...reference.processor.frame.slice(0, reference.processor.filled),
    ].slice(16320, 16320 + pcm.length); // 680 ms: one analysis window before the correction starts at 700 ms.
    assert.deepEqual(pcm, expected, `${rate}: buffered and continuing samples arrive once, in exact order`);
    assert.equal(c.barges().length, 1, `${rate}: cancellation does not retrigger`);
  }
  // End, manual cancellation, replacement and setting changes cannot release candidate audio.
  for (const next of [
    { muted: false, generation: 3 },
    { muted: false, generation: 3, resumeBarge: 1 },
    { muted: true, generation: 3, bargeIn: true },
    { muted: true, generation: 3, bargeIn: false },
  ]) {
    const c = capture(rate);
    c.state({ muted: true, generation: 2, bargeIn: true });
    c.feed(0.48, 0.004); c.feed(0.20, 0.12);
    assert.equal(c.barges().length, 1);
    c.state(next); c.feed(0.32);
    assert.ok(c.silent(), `${rate}: unrelated state change discards private buffer`);
  }
  // Pending acknowledgement is bounded, and overflow fails closed rather than releasing old speech.
  {
    const c = capture(rate);
    c.state({ muted: true, generation: 1, bargeIn: true });
    c.feed(0.48, 0.004); c.feed(2, 0.12);
    assert.equal(c.barges().length, 1);
    assert.ok(c.processor.buffer.length === 0 && c.processor.expired);
    c.state({ muted: false, generation: 2, resumeBarge: 1 }); c.feed(0.32);
    assert.ok(c.silent(), `${rate}: an expired onset is never released`);
  }
  // A new reply recalibrates: a loud onset during the startup guard is treated as playback leakage.
  {
    const c = capture(rate);
    c.state({ muted: true, generation: 1, bargeIn: true });
    c.feed(0.24, 0.12); c.feed(0.48, 0.12);
    assert.equal(c.barges().length, 0, `${rate}: startup guard learns loud playback`);
    assert.ok(c.silent());
  }
}
console.log("local barge checks passed (24/44.1/48 kHz: variable-volume residual rejection, 40/100 ms calibration recovery, exact once-only onset, opt-out, pauses, transients, stale generations and bounded buffer)");
