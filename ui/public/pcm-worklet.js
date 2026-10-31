// Turns microphone samples into 80 ms frames of 16-bit PCM for Voice Transcribe.
// The AudioContext runs at 24 kHz, so the browser does the resampling.
class PcmWriter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Int16Array(1920);
    this.filled = 0;
  }

  process(inputs) {
    const samples = inputs[0] && inputs[0][0];
    if (samples) {
      for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        this.frame[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.filled === this.frame.length) {
          this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
          this.frame = new Int16Array(1920);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("pcm-writer", PcmWriter);
