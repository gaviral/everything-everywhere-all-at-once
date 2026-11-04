// Stretches of talk in the `?level` meter's readings (index.tsx), so a minute of normal talk, a raised voice and a
// shout gives each voice's typical reading. Where a voice starts and ends is found relative to the voice and to the
// room between voices, not at a fixed level: after the browser's processing, a room can read above 0.01.

/** A reading arrives every 320 ms while the mic is on (apps-audio.ts). */
export const READING_MS = 320;
/** About a second: quiet this long ends a stretch (longer than a breath between sentences, shorter than the pause
 * between voices the test asks for), and a stretch shorter than this (a cough) isn't a voice to measure. */
export const SECOND = Math.round(1000 / READING_MS);
// Under the lowest level an app can use (0.01, composition_schema in apps.rs) is quiet in any room.
const QUIET = 0.01;
// A voice keeps within a factor of two of itself: in the 24 synthesized clips (6 voices, 4 texts, 2026-11-01), no
// second fell under 0.54 of the two seconds before it, and past the first words none rose over 1.45 of all before it.
// So a second under half is a pause, a second at twice is a new, louder sound, and twice the room is a voice.
const APART = 2;
// A pause is judged against the voice's last two seconds, not all of it: in headless Chrome, after a quiet stretch
// with other talk in it, the browser's auto gain let a voice in loud and halved it within about 3 s (2026-11-01).
const RECENT = 2 * SECOND;

export type Stretch = { typical: number; seconds: number };

function median(readings: number[]) {
  const sorted = [...readings].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// The median, as apps.rs's voices were measured: a reading at the voice's usual level, short dips included.
function stretchOf(readings: number[]): Stretch {
  return { typical: median(readings), seconds: (readings.length * READING_MS) / 1000 };
}

/** Splits readings into stretches of talk: `feed` each one, `end` when they stop (the mic went off), and each
 * stretch long enough to measure goes to `onStretch` as it ends. */
export function splitTalk(onStretch: (stretch: Stretch) => void) {
  // The stretch so far; its last `quiet` readings (a pause beginning) or `louder` ones (a new voice) are in doubt.
  let voice: number[] = [];
  let quiet = 0;
  let louder = 0;
  // The last pause's readings: null until the mic has heard one, while the room isn't known yet.
  let room: number[] | null = null;
  const spoken = () => voice.slice(0, voice.length - quiet - louder);
  const close = () => {
    if (spoken().length >= SECOND) onStretch(stretchOf(spoken()));
    voice = [];
    quiet = louder = 0;
  };
  return {
    feed(level: number) {
      const roomLevel = room ? median(room) : 0;
      if (!voice.length) {
        if (level >= Math.max(QUIET, roomLevel * APART)) voice = [level];
        else room = [...(room ?? []), level].slice(-SECOND);
        return;
      }
      const typical = median(spoken());
      const lately = median(spoken().slice(-RECENT));
      voice.push(level);
      // Back near the room counts as quiet too, so a click that started a stretch can't keep it going on the room.
      quiet = level < Math.max(QUIET, lately / APART, roomLevel * APART) ? quiet + 1 : 0;
      // A second at twice the stretch's typical is a voice over what came before: the room's own sound, which can
      // start a stretch before the first pause or in a noisy one. The stretch starts again there.
      louder = level >= typical * APART ? louder + 1 : 0;
      if (quiet >= SECOND) {
        const pause = voice.slice(-quiet);
        close();
        room = pause;
      } else if (louder >= SECOND) {
        voice = voice.slice(-louder);
        louder = 0;
      }
    },
    current: (): Stretch | null => (spoken().length ? stretchOf(spoken()) : null),
    end() {
      close();
      // A mic that starts again starts its auto gain again too, so the room is learned again.
      room = null;
    },
  };
}

// Receipt summaries use this provisional scale only. The offline check pins it to apps.rs.
export const REFERENCE_THRESHOLDS = [0.087, 0.122];
export const MIN_RUN_MS = 10_000;
export type VoiceLabel = "normal" | "raised" | "loud";
export type Reading = { atMs: number; level: number };
export type MicMetadata = {
  build: string; microphone: string; browser: string; distanceCm: number;
  processing: { echoCancellation: string; noiseSuppression: string; autoGainControl: string };
};
export type AboveStretch = { threshold: number; startMs: number; durationMs: number };
export type CalibrationRun = {
  label: VoiceLabel; startedAtUtc: string; durationMs: number; readings: Reading[];
  typical: number; aboveThresholdStretches: AboveStretch[];
};
export type CalibrationReceipt = {
  schema: "e2a2o.volume-calibration"; version: 1; origin: "recording-mic" | "synthetic";
  createdAtUtc: string; completedAtUtc: string; cadenceMs: 320;
  metadata: MicMetadata; thresholds: number[]; runs: CalibrationRun[];
};
export type Candidate = { level: number; seconds: number; cooldownSecs: number };
const labels: VoiceLabel[] = ["normal", "raised", "loud"];
const requireThat = (ok: unknown, message: string): void => { if (!ok) throw new Error(message); };
const finite = (n: unknown, low: number, high: number) => typeof n === "number" && Number.isFinite(n) && n >= low && n <= high;
const utc = (s: unknown) => typeof s === "string" && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;
function keys(value: object, expected: string[]) {
  requireThat(value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join() === [...expected].sort().join(), "Missing or unexpected receipt fields");
}
function metadataCheck(m: MicMetadata) {
  keys(m, ["build", "microphone", "browser", "distanceCm", "processing"]);
  for (const text of [m.build, m.microphone, m.browser]) requireThat(typeof text === "string" && text.trim().length > 0, "Build, microphone and browser are required");
  requireThat(finite(m.distanceCm, 1, 1000), "Distance must be 1–1000 cm");
  keys(m.processing, ["echoCancellation", "noiseSuppression", "autoGainControl"]);
  for (const setting of Object.values(m.processing)) requireThat(["on", "off", "unknown"].includes(setting), "Declare each processing setting");
}
export function aboveStretches(readings: Reading[], thresholds: number[]): AboveStretch[] {
  return thresholds.flatMap((threshold) => {
    const out: AboveStretch[] = [];
    let start: number | undefined;
    let last = 0;
    const close = () => { if (start !== undefined) out.push({ threshold, startMs: start, durationMs: last - start }); start = undefined; };
    for (const r of readings) {
      if (r.atMs - last > 1200 || r.level < threshold) close();
      if (r.level >= threshold) { start ??= r.atMs; last = r.atMs; }
    }
    close();
    return out;
  });
}

/** Same state transitions as apps.rs feed_volume + volume + launch (a prompt-free idle app).
 * Separate source streaks, shared app cooldown; a due streak resets even when cooldown suppresses it. */
export function replayVolume(readings: (Reading & { source?: string })[], candidate: Candidate) {
  requireThat(finite(candidate.level, 0.01, 1) && Number.isInteger(candidate.seconds) && finite(candidate.seconds, 1, 30) &&
    Number.isInteger(candidate.cooldownSecs) && finite(candidate.cooldownSecs, 10, 3600), "Invalid candidate");
  const sources = new Map<string, { start: number; last: number; low: boolean }>();
  const triggers: number[] = [];
  let lastRun = -Infinity;
  for (const r of readings) {
    const now = r.atMs + 1; // Keep zero available as feed_volume's unset sentinel.
    const source = r.source ?? "local";
    const s = sources.get(source) ?? { start: 0, last: now, low: false };
    sources.set(source, s);
    if (r.level < candidate.level) {
      if (s.start !== 0 && !s.low) s.low = true;
      else Object.assign(s, { start: 0, last: now, low: false });
      continue;
    }
    if (s.start === 0 || now - s.last > 1200) s.start = now;
    s.last = now;
    s.low = false;
    if (now - s.start >= candidate.seconds * 1000) {
      Object.assign(s, { start: now, last: now, low: false });
      if (now - lastRun >= candidate.cooldownSecs * 1000) { triggers.push(r.atMs); lastRun = now; }
    }
  }
  return triggers;
}

/** An explicit session; reads only numeric events already emitted by the existing mic path. */
export function calibrationSession(metadata: MicMetadata, now: number, origin: CalibrationReceipt["origin"] = "recording-mic") {
  metadataCheck(metadata);
  const receipt: CalibrationReceipt = { schema: "e2a2o.volume-calibration", version: 1, origin,
    createdAtUtc: new Date(now).toISOString(), completedAtUtc: "", cadenceMs: 320,
    metadata: structuredClone(metadata), thresholds: [...REFERENCE_THRESHOLDS], runs: [] };
  let active: { label: VoiceLabel; start: number; readings: Reading[] } | null = null;
  let done = false;
  return {
    startRun(label: VoiceLabel, at: number) {
      requireThat(!done && !active && labels.includes(label), "Finish or cancel the active sample first");
      active = { label, start: at, readings: [] };
    },
    feed(level: number, at: number) {
      if (!active || done) return;
      requireThat(finite(level, 0, 1), "Invalid mic reading; cancel this sample");
      const atMs = at - active.start;
      requireThat(atMs >= 0 && (!active.readings.length || atMs > active.readings.at(-1)!.atMs), "Reading clock did not advance");
      active.readings.push({ atMs, level });
    },
    finishRun(at: number) {
      requireThat(active && !done, "No active sample");
      const a = active!;
      requireThat(a.readings.length > 0 && at - a.start >= a.readings.at(-1)!.atMs, "No complete readings");
      receipt.runs.push({ label: a.label, startedAtUtc: new Date(a.start).toISOString(), durationMs: at - a.start,
        readings: a.readings, typical: median(a.readings.map(r => r.level)), aboveThresholdStretches: aboveStretches(a.readings, receipt.thresholds) });
      active = null;
      return receipt.runs.at(-1)!;
    },
    cancelRun() { active = null; },
    reset() { active = null; receipt.runs = []; done = true; },
    finish(at: number) {
      requireThat(!active && !done, "Finish the active sample first");
      receipt.completedAtUtc = new Date(at).toISOString();
      validateCalibration(receipt, true, false);
      done = true;
      return structuredClone(receipt);
    },
  };
}

/** Structural and acoustic-separation checks; synthetic fixtures can only exercise the tool. */
export function validateCalibration(r: CalibrationReceipt, allowSynthetic = false, requireSeparation = true) {
  keys(r, ["schema", "version", "origin", "createdAtUtc", "completedAtUtc", "cadenceMs", "metadata", "thresholds", "runs"]);
  requireThat(r.schema === "e2a2o.volume-calibration" && r.version === 1 && r.cadenceMs === READING_MS, "Unsupported receipt schema or cadence");
  requireThat(r.origin === "recording-mic" || (allowSynthetic && r.origin === "synthetic"), "Synthetic input is not real calibration proof");
  requireThat(utc(r.createdAtUtc) && utc(r.completedAtUtc) && Date.parse(r.completedAtUtc) >= Date.parse(r.createdAtUtc), "Invalid UTC session dates");
  metadataCheck(r.metadata);
  requireThat(allowSynthetic || !/synthetic|fake[ -]?mic|fixture/i.test([r.metadata.build, r.metadata.microphone, r.metadata.browser].join(" ")),
    "Synthetic input is not real calibration proof");
  requireThat(Array.isArray(r.thresholds) && r.thresholds.length > 0 && r.thresholds.every(t => finite(t, 0.01, 1)), "Missing or invalid thresholds");
  requireThat(Array.isArray(r.runs) && labels.every(label => r.runs.some(run => run.label === label)), "Normal, raised and loud samples are required");
  let previousEnd = Date.parse(r.createdAtUtc);
  for (const run of r.runs) {
    keys(run, ["label", "startedAtUtc", "durationMs", "readings", "typical", "aboveThresholdStretches"]);
    requireThat(labels.includes(run.label) && utc(run.startedAtUtc), "Invalid sample label/date");
    const start = Date.parse(run.startedAtUtc);
    requireThat(start >= previousEnd && start + run.durationMs <= Date.parse(r.completedAtUtc), "Overlapping or out-of-session samples");
    previousEnd = start + run.durationMs;
    requireThat(finite(run.durationMs, MIN_RUN_MS, 3600_000) && Array.isArray(run.readings) && run.readings.length >= Math.ceil(MIN_RUN_MS / READING_MS), "Sample too short: collect at least 10 seconds per label");
    let previous = -1;
    for (const reading of run.readings) {
      keys(reading, ["atMs", "level"]);
      requireThat(finite(reading.level, 0, 1) && finite(reading.atMs, 0, run.durationMs) && reading.atMs > previous, "Invalid numeric reading or timestamp");
      requireThat(reading.atMs - Math.max(0, previous) <= 1200, "Missing readings: repeat the sample");
      previous = reading.atMs;
    }
    requireThat(run.durationMs - previous <= 1200 && previous - run.readings[0].atMs >= MIN_RUN_MS - READING_MS, "Incomplete sample coverage");
    requireThat(run.typical === median(run.readings.map(x => x.level)), "Typical value does not match readings");
    requireThat(JSON.stringify(run.aboveThresholdStretches) === JSON.stringify(aboveStretches(run.readings, r.thresholds)), "Stretches do not match readings");
  }
  const quartile = (label: VoiceLabel, fraction: number) => {
    const values = r.runs.filter(run => run.label === label).flatMap(run => run.readings.map(x => x.level)).sort((a, b) => a - b);
    return values[Math.floor((values.length - 1) * fraction)];
  };
  if (requireSeparation) requireThat(quartile("normal", .75) < quartile("raised", .25) && quartile("raised", .75) < quartile("loud", .25), "Inseparable samples: middle halves overlap; repeat with deliberate labels");
}

export function analyzeCalibration(receipt: CalibrationReceipt, candidates: Candidate[], allowSynthetic = false) {
  validateCalibration(receipt, allowSynthetic);
  return candidates.map(candidate => ({ candidate, runs: receipt.runs.map(run => ({ label: run.label,
    typical: run.typical, durationMs: run.durationMs, triggers: replayVolume(run.readings, candidate).length,
    aboveThresholdStretches: aboveStretches(run.readings, [candidate.level]) })) }));
}

/** Called only by the Export button. The caller supplies a local download, never a network transport. */
export function exportCalibration(receipt: CalibrationReceipt, download: (json: string) => void) {
  validateCalibration(receipt, true, false);
  download(JSON.stringify(receipt, null, 2));
}
