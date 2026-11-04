// Turns microphone samples into 80 ms frames of 16-bit PCM at 24 kHz for Voice Transcribe.
// Where the AudioContext runs at 24 kHz (Chrome; ui/src/mic.ts asks for it), the browser has resampled and the
// samples pass straight through. Where it runs at the device's rate (Firefox; any browser that won't make a 24 kHz
// context), this resamples: a low-pass below 24 kHz's Nyquist (10.8 kHz, so nothing above 12 kHz folds back into the
// speech band), then linear interpolation at 24 kHz's sample times.
const RATE = 24000;
const FRAME = 1920; // 80 ms at 24 kHz
const PROBE = 480; // Detect on 20 ms windows after resampling, at every device rate.
const WARMUP = 12; // Learn the playback residual for 240 ms after the voice actually starts.
const CONFIRM = 8; // Require 160 ms of sustained input above that residual.
const PAUSE = 5; // Keep the onset across pauses up to 100 ms; confirmation still requires consecutive input.
const BUFFER_LIMIT = 24; // At most 480 ms in memory, including the onset and main-thread acknowledgement.
const RESIDUAL_GAIN = 10; // Reject moderate gain changes of the learned residual; allow strong corrections.
const SHAPE_LAGS = [8, 16, 24, 32, 48, 64, 96]; // All at 24 kHz, independent of the device rate.

// Normalized autocorrelation compares residual shape independently of gain and window phase. Web Speech does
// not expose a playback PCM reference; this is a conservative residual guard after browser AEC, not an AEC.
function shape(chunk) {
  return SHAPE_LAGS.map(lag => {
    let cross = 0, left = 0, right = 0;
    for (let i = lag; i < chunk.length; i++) {
      cross += chunk[i] * chunk[i - lag];
      left += chunk[i] * chunk[i];
      right += chunk[i - lag] * chunk[i - lag];
    }
    return cross / (Math.sqrt(left * right) || 1);
  });
}

// Windowed-sinc low-pass (Blackman, 33 taps) for input at `rate`, cut at 0.45 of 24 kHz; unity gain at 0 Hz.
function lowPass(rate) {
  const taps = 33;
  const cut = (0.45 * RATE) / rate; // cycles per input sample
  const mid = (taps - 1) / 2;
  const h = new Float32Array(taps);
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const x = i - mid;
    const sinc = x === 0 ? 2 * cut : Math.sin(2 * Math.PI * cut * x) / (Math.PI * x);
    const window = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
    h[i] = sinc * window;
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  return h;
}

class PcmWriter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Int16Array(FRAME);
    this.filled = 0;
    this.muted = false;
    this.bargeIn = false;
    this.generation = 0;
    this.resetProbe();
    this.port.onmessage = ({ data }) => {
      const resume = !data.muted && this.pending && data.resumeBarge === this.generation;
      const buffered = resume ? [...this.buffer, this.probe.slice(0, this.probeFilled)] : [];
      this.muted = data.muted;
      this.bargeIn = !!data.bargeIn;
      this.generation = data.generation;
      this.resetProbe();
      // Normal end/cancel/replacement discards everything. Only an acknowledged interruption keeps its onset.
      this.frame.fill(0);
      if (resume) {
        this.filled = 0;
        for (const chunk of buffered) for (const sample of chunk) this.emit(sample);
      } else {
        // Clear the resampling tail at both edges of playback, keeping the frame cadence.
        this.history?.fill(0);
        this.last = 0;
      }
    };
    // `sampleRate` is the context's rate, a global in the worklet's scope.
    this.step = sampleRate / RATE;
    if (this.step !== 1) {
      this.taps = lowPass(sampleRate);
      this.history = new Float32Array(this.taps.length);
      this.at = 0; // input samples seen
      this.next = 0; // where the next output sample falls, in input samples
      this.last = 0; // the previous filtered sample
    }
  }

  resetProbe() {
    this.probe = new Int16Array(PROBE);
    this.probeFilled = 0;
    this.energy = 0;
    this.calibration = [];
    this.floor = 0.003;
    this.residual = null;
    this.previous = null;
    this.buffer = [];
    this.candidate = 0;
    this.gap = 0;
    this.pending = false;
    this.expired = false;
  }

  detect() {
    const chunk = this.probe;
    const level = Math.sqrt(this.energy / PROBE) / 32768;
    this.probe = new Int16Array(PROBE);
    this.probeFilled = 0;
    this.energy = 0;
    if (this.expired) return; // A stalled main thread cannot retain audio indefinitely.
    if (this.calibration) {
      this.calibration.push({ chunk, level });
      if (this.calibration.length < WARMUP) return;
      // Two adjacent quiet windows suffice even when a correction starts only 40 ms into playback. Take the
      // quieter pair's maximum, so a single startup/filter dip cannot set the floor. Never learn the later loud
      // correction as playback. With loud input throughout calibration, the baseline still stays loud.
      let quiet = Infinity, reference;
      for (let i = 1; i < this.calibration.length; i++) {
        const level = Math.max(this.calibration[i - 1].level, this.calibration[i].level);
        if (level < quiet) { quiet = level; reference = this.calibration[i]; }
      }
      this.floor = Math.max(this.floor, quiet);
      if (reference.level > 0.001) this.residual = { level: this.floor, shape: shape(reference.chunk) };
      // Re-examine the guard's input so a correction starting during calibration keeps its first words.
      for (const window of this.calibration) this.observe(window.chunk, window.level);
      this.calibration = null;
    } else this.observe(chunk, level);
  }

  observe(chunk, level) {
    if (this.expired) return;
    if (this.pending) {
      if (this.buffer.length >= BUFFER_LIMIT - 1) {
        this.buffer = [];
        this.pending = false;
        this.expired = true;
      } else this.buffer.push(chunk);
      return;
    }
    const aboveFloor = level > Math.max(0.012, this.floor * 3);
    const playbackLike = aboveFloor && this.residual && level <= this.residual.level * RESIDUAL_GAIN
      && shape(chunk).every((value, i) => Math.abs(value - this.residual.shape[i]) < 0.12);
    if (aboveFloor && !playbackLike) {
      // Require new signal content for moderate level changes. Much stronger input can override the shape guard
      // so a sustained correction with similar voicing does not remain suppressed indefinitely.
      if (!this.buffer.length && this.previous) this.buffer.push(this.previous);
      this.buffer.push(chunk);
      if (this.buffer.length >= BUFFER_LIMIT) this.buffer.shift();
      this.gap = 0;
      if (++this.candidate === CONFIRM) {
        this.pending = true;
        this.port.postMessage({ type: "barge", generation: this.generation });
      }
      return;
    } else {
      // Follow room noise and playback residual, but freeze the baseline during a possible interruption.
      this.floor += (level - this.floor) * (level > this.floor ? 0.1 : 0.01);
    }
    this.candidate = 0;
    if (this.buffer.length) {
      if (++this.gap > PAUSE) this.buffer = [];
      else {
        this.buffer.push(chunk);
        if (this.buffer.length >= BUFFER_LIMIT) this.buffer.shift();
      }
    }
    this.previous = chunk; // One window of preroll keeps the first consonant.
  }

  emit(sample) {
    this.frame[this.filled++] = sample;
    if (this.filled === FRAME) {
      this.port.postMessage({ frame: this.frame.buffer, generation: this.generation }, [this.frame.buffer]);
      this.frame = new Int16Array(FRAME);
      this.filled = 0;
    }
  }

  write(s) {
    const c = Math.max(-1, Math.min(1, s));
    const sample = c < 0 ? c * 0x8000 : c * 0x7fff;
    if (this.muted && this.bargeIn) {
      this.probe[this.probeFilled++] = sample;
      this.energy += sample * sample;
      if (this.probeFilled === PROBE) this.detect();
    }
    // Detection and its short buffer are local only. ASR still receives silence until cancellation is accepted.
    this.emit(this.muted ? 0 : sample);
  }

  process(inputs) {
    const samples = inputs[0] && inputs[0][0];
    if (!samples) return true;
    if (this.step === 1) {
      for (let i = 0; i < samples.length; i++) this.write(samples[i]);
      return true;
    }
    const { taps, history } = this;
    const n = taps.length;
    for (let i = 0; i < samples.length; i++) {
      history.copyWithin(0, 1);
      history[n - 1] = samples[i];
      let y = 0;
      for (let k = 0; k < n; k++) y += taps[k] * history[k];
      // Output samples between the previous input sample (at - 1) and this one (at).
      while (this.next <= this.at) {
        const frac = this.next - (this.at - 1);
        this.write(this.last + (y - this.last) * frac);
        this.next += this.step;
      }
      this.last = y;
      this.at++;
    }
    return true;
  }
}

registerProcessor("pcm-writer", PcmWriter);
