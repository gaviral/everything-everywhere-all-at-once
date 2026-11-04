// Offline only. With no arguments, synthetic fixtures test the tool, never acoustic calibration.
// Real receipt: node scripts/volume-calibration-check.mjs /private/receipt.json [--candidate=0.087,3,30]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  READING_MS, REFERENCE_THRESHOLDS, calibrationSession, validateCalibration,
  exportCalibration, analyzeCalibration, replayVolume,
} from '../ui/src/bricks/level/stretches.ts';

const args = process.argv.slice(2);
const core = readFileSync(new URL('../core/src/apps.rs', import.meta.url), 'utf8');
const value = name => Number(core.match(new RegExp(`const ${name}: f64 = ([0-9.]+);`))[1]);
assert.deepEqual(REFERENCE_THRESHOLDS, [[value('NORMAL_VOICE'), value('RAISED_VOICE')], [value('RAISED_VOICE'), value('SHOUT')]]
  .map(([a, b]) => Math.round(Math.sqrt(a * b) * 1000) / 1000), 'receipt reference scale agrees with core');
const defaultCandidates = REFERENCE_THRESHOLDS.map(level => ({ level, seconds: 3, cooldownSecs: 30 }));
if (args.length) {
  const candidates = args.filter(arg => arg.startsWith('--candidate=')).map(arg => {
    const [level, seconds, cooldownSecs, ...extra] = arg.slice(12).split(',').map(Number);
    assert.equal(extra.length, 0, 'candidate: level,seconds,cooldownSecs');
    return { level, seconds, cooldownSecs };
  });
  const files = args.filter(arg => !arg.startsWith('--candidate='));
  assert.ok(files.length, 'supply a private receipt path');
  for (const [index, file] of files.entries()) {
    const receipt = JSON.parse(readFileSync(file, 'utf8'));
    const comparisons = analyzeCalibration(receipt, candidates.length ? candidates : defaultCandidates);
    // No paths, device names, raw readings or other user metadata in command output.
    console.log(JSON.stringify({ receipt: index + 1, origin: receipt.origin, date: receipt.createdAtUtc,
      samples: receipt.runs.length, comparisons, status: 'candidate evidence only; owner review and final recording-mic verification still required' }));
  }
} else {
  const metadata = { build: 'synthetic-fixture-v1', microphone: 'synthetic-input', browser: 'offline-test', distanceCm: 30,
    processing: { echoCancellation: 'off', noiseSuppression: 'off', autoGainControl: 'off' } };
  const base = Date.parse('2026-11-04T00:00:00.000Z');
  let now = base;
  const session = calibrationSession(metadata, now, 'synthetic');
  // Discard an active partial run. It must not appear in the receipt.
  session.startRun('loud', now); session.feed(.8, now + 320); session.cancelRun();
  now += 1000;
  for (const [label, level] of [['normal', value('NORMAL_VOICE')], ['raised', value('RAISED_VOICE')], ['loud', value('SHOUT')]]) {
    session.startRun(label, now);
    for (let i = 1; i <= 40; i++) session.feed(level, now + i * READING_MS);
    now += 40 * READING_MS;
    session.finishRun(now);
    now += 2000;
  }
  const receipt = session.finish(now);
  assert.equal(receipt.runs.length, 3);
  assert.equal(receipt.runs[0].typical, value('NORMAL_VOICE'));
  assert.equal(receipt.runs[0].durationMs, 12800);
  assert.deepEqual(receipt.runs[0].aboveThresholdStretches, []);
  let exported;
  assert.equal(exported, undefined, 'nothing exported while collecting');
  exportCalibration(receipt, json => { exported = json; });
  assert.deepEqual(JSON.parse(exported), receipt);
  assert.throws(() => validateCalibration(receipt), /Synthetic/);
  validateCalibration(receipt, true);
  assert.throws(() => validateCalibration({ ...receipt, origin: 'recording-mic' }), /Synthetic/, 'relabelling a known fixture is not real proof');
  const comparisons = analyzeCalibration(receipt, defaultCandidates, true);
  assert.deepEqual(comparisons[0].runs.map(run => run.triggers), [0, 1, 1]);
  assert.deepEqual(comparisons[1].runs.map(run => run.triggers), [0, 0, 1]);
  const reset = calibrationSession(metadata, base, 'synthetic');
  reset.startRun('normal', base); reset.feed(.04, base + 320); reset.reset();
  assert.throws(() => reset.finish(now), /Finish/);
  assert.throws(() => reset.startRun('normal', now), /Finish/);
  const bad = (edit, pattern) => { const r = structuredClone(receipt); edit(r); assert.throws(() => validateCalibration(r, true), pattern); };
  bad(r => { delete r.metadata.build; }, /fields/);
  bad(r => { r.metadata.browser = ''; }, /required/);
  bad(r => { r.metadata.distanceCm = 0; }, /Distance/);
  bad(r => { r.metadata.processing.autoGainControl = ''; }, /setting/);
  bad(r => { r.version = 2; }, /schema/);
  bad(r => { r.cadenceMs = 80; }, /cadence/);
  bad(r => { r.createdAtUtc = 'yesterday'; }, /UTC/);
  bad(r => { r.audio = 'not allowed'; }, /fields/);
  bad(r => { r.runs.pop(); }, /required/);
  bad(r => { r.runs[0].durationMs = 300; }, /too short/);
  for (const level of [NaN, Infinity, -.01, 1.01, '0.2', null]) bad(r => { r.runs[0].readings[0].level = level; }, /numeric/);
  bad(r => { r.runs[0].readings[1].atMs = 320; }, /timestamp/);
  bad(r => { r.runs[0].readings[0].atMs = 2000; }, /Missing readings/);
  bad(r => { r.runs[0].typical = .1; }, /Typical/);
  bad(r => { r.runs[1].aboveThresholdStretches = []; }, /Stretches/);
  bad(r => {
    for (const run of r.runs) {
      run.readings.forEach(x => { x.level = .04; }); run.typical = .04; run.aboveThresholdStretches = [];
    }
  }, /Inseparable/);
  const inseparable = structuredClone(receipt);
  for (const run of inseparable.runs) {
    run.readings.forEach(x => { x.level = .04; }); run.typical = .04; run.aboveThresholdStretches = [];
  }
  exportCalibration(inseparable, json => assert.equal(JSON.parse(json).runs.length, 3));
  assert.throws(() => analyzeCalibration(inseparable, defaultCandidates, true), /Inseparable/, 'diagnostic exports are not calibration proof');
  const readings = (count, level = .2) => Array.from({ length: count }, (_, i) => ({ atMs: (i + 1) * 320, level }));
  const candidate = { level: .087, seconds: 3, cooldownSecs: 10 };
  assert.deepEqual(replayVolume(readings(11, value('NORMAL_VOICE')), candidate), [], 'normal synthetic sample');
  assert.deepEqual(replayVolume(readings(11), candidate), [3520], 'sustained loud');
  const oneGap = readings(11); oneGap[4].level = 0;
  assert.deepEqual(replayVolume(oneGap, candidate), [3520], 'one syllable gap is tolerated');
  const twoGaps = readings(11); twoGaps[4].level = twoGaps[5].level = 0;
  assert.deepEqual(replayVolume(twoGaps, candidate), [], 'two low readings reset');
  assert.deepEqual(replayVolume([...readings(6), ...readings(6).map(r => ({ ...r, atMs: r.atMs + 5000 }))], candidate), [], 'missing readings reset');
  assert.deepEqual(replayVolume(readings(11).map((r, i) => ({ ...r, source: i < 6 ? 'a' : 'b' })), candidate), [], 'mic sources cannot combine');
  assert.deepEqual(replayVolume(readings(51), candidate), [3520, 16320], 'due streaks reset even during cooldown');
  const alternatingSources = readings(22).map((r, i) => ({ ...r, source: i % 2 ? 'b' : 'a' }));
  assert.deepEqual(replayVolume(alternatingSources, candidate), [3520], 'cooldown is shared across sources');
  console.log('volume-calibration-check: ok (synthetic collection/export/cancel/reset; invalid receipts; separation, gaps, sources and cooldown). Real-mic calibration pending.');
}
