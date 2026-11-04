// Keep the microphone level local; send only a small normalized reading to watchers: the RMS of every four
// 80 ms frames (320 ms). The quietest of the four, sent before, fell between syllables: about half the voice's
// level in 24 synthesized clips, so only a shout kept every reading above a watcher's level.
export function volumeReporter(report: (level: number) => void) {
  let frames = 0;
  let sum = 0;
  let count = 0;
  return {
    feed(frame: ArrayBuffer) {
      const samples = new Int16Array(frame);
      if (!samples.length) return;
      for (const sample of samples) sum += (sample / 32768) ** 2;
      count += samples.length;
      if (++frames >= 4) {
        report(Math.sqrt(sum / count));
        frames = sum = count = 0;
      }
    },
    reset() { frames = sum = count = 0; },
  };
}

const readings = new Set<(level: number) => void>();

/** Each reading the core received, for the `?level` meter (bricks/level); without it on, nothing listens. */
export function received(level: number) { readings.forEach((listener) => listener(level)); }

export function onReading(listener: (level: number) => void) {
  readings.add(listener);
  return () => { readings.delete(listener); };
}

let sound: AudioContext | undefined;
const tuneWatchers = new Set<() => void>();
export const tuneRunning = () => sound?.state === "running";
export const watchTune = (listener: () => void) => { tuneWatchers.add(listener); return () => { tuneWatchers.delete(listener); }; };
const tuneChanged = () => tuneWatchers.forEach((listener) => listener());

export function unlockTune() {
  try {
    if (!sound) {
      sound = new AudioContext();
      sound.onstatechange = tuneChanged;
    }
    tuneChanged();
    if (sound.state === "suspended") void sound.resume().catch(() => {});
  } catch { /* A card and a play button stay available when sound is blocked. */ }
}

/** False when the browser won't play sound yet (no click, tap or key press on the page so far). */
export function playTune(playful = false): boolean {
  try {
    if (!sound || sound.state !== "running") return false;
    (playful ? hops : chime)(sound);
    return true;
  } catch { return false; }
}

// The calm tune: three soft notes going up.
function chime(sound: AudioContext) {
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
}

// The playful tune, for loud voices: three quick hops up, then a wobbly slide-whistle "whee", silly enough to
// break the tension and short enough (under a second) not to add to the noise.
function hops(sound: AudioContext) {
  const now = sound.currentTime;
  const parts: [from: number, to: number, offset: number, length: number][] =
    [[392, 523.25, 0, 0.11], [523.25, 659.25, 0.13, 0.11], [659.25, 783.99, 0.26, 0.11], [587.33, 1567.98, 0.42, 0.45]];
  for (const [index, [from, to, offset, length]] of parts.entries()) {
    const start = now + offset;
    const note = sound.createOscillator();
    const gain = sound.createGain();
    const nodes: AudioNode[] = [note, gain];
    note.type = "triangle";
    note.frequency.setValueAtTime(from, start);
    note.frequency.exponentialRampToValueAtTime(to, start + length * 0.7);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.06, start + 0.015);
    gain.gain.setValueAtTime(0.06, start + length * 0.5);
    gain.gain.exponentialRampToValueAtTime(0.001, start + length);
    if (index === parts.length - 1) {
      const wobble = sound.createOscillator();
      const depth = sound.createGain();
      wobble.frequency.value = 11;
      depth.gain.value = 30;
      wobble.connect(depth).connect(note.frequency);
      wobble.start(start);
      wobble.stop(start + length);
      nodes.push(wobble, depth);
    }
    note.connect(gain).connect(sound.destination);
    note.start(start);
    note.stop(start + length + 0.02);
    note.onended = () => nodes.forEach((node) => node.disconnect());
  }
}
