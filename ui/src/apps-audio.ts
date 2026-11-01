// Keep the microphone level local; send only a small normalized reading to watchers.
export function volumeReporter(report: (level: number) => void) {
  let frames = 0;
  let lowest = 1;
  return {
    feed(frame: ArrayBuffer) {
      const samples = new Int16Array(frame);
      if (!samples.length) return;
      let sum = 0;
      for (const sample of samples) sum += (sample / 32768) ** 2;
      lowest = Math.min(lowest, Math.sqrt(sum / samples.length));
      if (++frames >= 4) {
        report(lowest);
        frames = 0;
        lowest = 1;
      }
    },
    reset() { frames = 0; lowest = 1; },
  };
}

let sound: AudioContext | undefined;

export function unlockTune() {
  try {
    sound ??= new AudioContext();
    if (sound.state === "suspended") void sound.resume().catch(() => {});
  } catch { /* A card and a play button stay available when sound is blocked. */ }
}

export function playTune(): boolean {
  try {
    if (!sound || sound.state !== "running") return false;
    const now = sound.currentTime;
    for (const [index, frequency] of [523.25, 659.25, 783.99].entries()) {
      const note = sound.createOscillator();
      const gain = sound.createGain();
      const start = now + index * 0.16;
      note.type = "sine";
      note.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.055, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
      note.connect(gain).connect(sound.destination);
      note.start(start);
      note.stop(start + 0.32);
      note.onended = () => { note.disconnect(); gain.disconnect(); };
    }
    return true;
  } catch { return false; }
}
