// Turns microphone samples into 80 ms frames of 16-bit PCM at 24 kHz for Voice Transcribe.
// Where the AudioContext runs at 24 kHz (Chrome; ui/src/mic.ts asks for it), the browser has resampled and the
// samples pass straight through. Where it runs at the device's rate (Firefox; any browser that won't make a 24 kHz
// context), this resamples: a low-pass below 24 kHz's Nyquist (10.8 kHz, so nothing above 12 kHz folds back into the
// speech band), then linear interpolation at 24 kHz's sample times.
const RATE = 24000;
const FRAME = 1920; // 80 ms at 24 kHz

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
    this.generation = 0;
    this.port.onmessage = ({ data }) => {
      this.muted = data.muted;
      this.generation = data.generation;
      // Clear the partial frame and resampling tail at both edges of playback, keeping the frame cadence.
      this.frame.fill(0);
      this.history?.fill(0);
      this.last = 0;
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

  write(s) {
    if (this.muted) s = 0;
    const c = Math.max(-1, Math.min(1, s));
    this.frame[this.filled++] = c < 0 ? c * 0x8000 : c * 0x7fff;
    if (this.filled === FRAME) {
      this.port.postMessage({ frame: this.frame.buffer, generation: this.generation }, [this.frame.buffer]);
      this.frame = new Int16Array(FRAME);
      this.filled = 0;
    }
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
