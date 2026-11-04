// Generic offline schema fixtures only. No capture, provider, microphone or send is invoked.
// node --check scripts/film-evidence-check.mjs
// node scripts/film-evidence-check.mjs
// This checks a fixture contract, NOT a recording or public eligibility. A tools-side
// scorer can reuse runFixtureTests with an adapter; that integration remains separate.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const SHA = 'a'.repeat(40);
const HASH = 'b'.repeat(64);
const BEATS = ['source', 'code', 'think', 'continue', 'inspect', 'return', 'email'];
const finite = Number.isFinite;
const rect = (x, y, width, height) => ({ x, y, width, height });
const inside = (a, b) => a && b && [a.x, a.y, a.width, a.height, b.x, b.y, b.width, b.height].every(finite)
  && a.width > 0 && a.height > 0 && a.x >= b.x && a.y >= b.y
  && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;

export function genericFixture() {
  const duration_ms = 30000;
  const offsets = { screen: 900, audio: 1700, trace: 2500 };
  const clocks = Object.fromEntries(Object.entries(offsets).map(([stream, offset]) => [stream,
    [{ marker: 'start', raw_ms: offset, capture_ms: 0 },
      { marker: 'end', raw_ms: offset + duration_ms, capture_ms: duration_ms }]]));
  const events = [];
  const event = (type, ms, extra = {}) => events.push({ type, raw_ms: ms + offsets.trace, ...extra });
  event('thought', 0, { id: 's1', topic_id: 't1', text: 'Example source.' });
  event('request', 100, { id: 'a1', beat_id: 'source', source_id: 's1', topic_id: 't1' });
  event('source_opened', 500, { beat_id: 'source', source_id: 's1', topic_id: 't1', attempt_id: 'a1' });
  event('admission', 5000, { beat_id: 'code', id: 'p1', helper_kind: 'coding' });
  for (let i = 0; i < 3; i++) {
    const id = `c${i}`, pid = 100 + i, start = 5500 + i * 100, end = 16000 + i * 100;
    event('job', 5100, { id, parent: 'p1', helper_kind: 'coding', status: 'queued' });
    event('process_start', start, { job_id: id, parent: 'p1', pid });
    event('call_start', start + 20, { job_id: id, call_id: `m${i}`, pid, provider: 'offline', model: 'fixture-model' });
    event('job', start + 50, { id, parent: 'p1', helper_kind: 'coding', status: 'running' });
    event('call_end', end - 20, { job_id: id, call_id: `m${i}`, provider_request_id: `r${i}` });
    event('provider_response', end - 10, { call_id: `m${i}`, request_id: `r${i}`, model: 'fixture-model', transport: 'fixture' });
    event('process_end', end, { job_id: id, pid, exit_code: 0 });
    event('job', end + 50, { id, parent: 'p1', helper_kind: 'coding', status: 'done' });
  }
  event('admission', 8000, { beat_id: 'think', id: 'p2', helper_kind: 'thinking' });
  event('job', 8050, { id: 'h1', parent: 'p2', helper_kind: 'thinking', status: 'queued' });
  event('process_start', 8500, { job_id: 'h1', parent: 'p2', pid: 200 });
  event('call_start', 8520, { job_id: 'h1', pid: 200, call_id: 'mh', provider: 'offline', model: 'fixture-model' });
  event('job', 8550, { id: 'h1', parent: 'p2', helper_kind: 'thinking', status: 'running' });
  event('thought', 10000, { id: 's2', topic_id: 't1', text: 'Example continuation.' });
  event('request', 10010, { id: 'a2', beat_id: 'continue', source_id: 's1', topic_id: 't1' });
  event('placement', 10500, { beat_id: 'continue', thought_id: 's2', source_id: 's1', topic_id: 't1', attempt_id: 'a2' });
  event('call_end', 14980, { job_id: 'h1', call_id: 'mh', provider_request_id: 'rh' });
  event('provider_response', 14990, { call_id: 'mh', request_id: 'rh', model: 'fixture-model', transport: 'fixture' });
  event('process_end', 15000, { job_id: 'h1', pid: 200, exit_code: 0 });
  event('job', 15050, { id: 'h1', parent: 'p2', helper_kind: 'thinking', status: 'done' });
  event('validation_start', 16400, { job_id: 'c0', command_id: 'v1', argv: ['offline-check'] });
  event('validation_end', 16600, { job_id: 'c0', command_id: 'v1', exit_code: 0 });
  event('commit', 16700, { job_id: 'c0', sha: 'c'.repeat(40), base_sha: SHA });
  event('result', 17000, { job_id: 'c0', result_id: 'd1', kind: 'diff', text: '+example', base_sha: SHA, commit_sha: 'c'.repeat(40) });
  event('result', 17100, { job_id: 'h1', result_id: 'd2', kind: 'answer', text: 'Example answer.', base_sha: SHA });
  event('inspect', 17500, { beat_id: 'inspect', job_id: 'c0', result_id: 'd1' });
  event('inspect', 17600, { beat_id: 'inspect', job_id: 'h1', result_id: 'd2' });
  event('source_opened', 22000, { beat_id: 'return', source_id: 's1', topic_id: 't1' });
  event('email_invoke', 26000, { beat_id: 'email', id: 'e1', source_id: 's1', result_id: 'd1' });
  event('send_card', 26100, { id: 'e1', channel: 'email', state: 'counting', live: false });
  event('email_outcome', 27000, { id: 'e1', state: 'dry_run', live: false });
  const card = (id, text) => ({ id, text, bounds: rect(30, 30, 500, 100), text_bounds: rect(40, 40, 450, 70), occluders: [] });
  const frames = [];
  for (let ms = 0; ms <= duration_ms; ms += 100) {
    const cards = [], running = [];
    if ((ms >= 500 && ms <= 4000) || (ms >= 22000 && ms <= 25500)) cards.push(card('s1', 'Example source.'));
    if (ms >= 10500 && ms <= 14000) cards.push(card('s2', 'Example continuation.'));
    if (ms >= 17500 && ms <= 21500) cards.push(card('d1', '+example'), card('d2', 'Example answer.'));
    for (let i = 0; i < 3; i++) if (ms >= 5600 + i * 100 && ms < 16000 + i * 100) running.push(`c${i}`);
    if (ms >= 8600 && ms < 15000) running.push('h1');
    frames.push({ raw_ms: ms + offsets.screen, viewport: rect(0, 0, 1280, 720), cards, running,
      email: ms >= 27000 ? { id: 'e1', state: 'dry_run' } : null });
  }
  return {
    fixture_only: true, mode: 'synthetic', app_sha: SHA, current_sha: SHA,
    route: { route_id: 'generic-route', beat_ids: Object.fromEntries(BEATS.map(id => [id, id])), planned_ms: duration_ms },
    capture: { duration_ms, clocks, cuts: [],
      media: Object.fromEntries(['screen', 'audio', 'trace'].map(kind => [kind,
        { name: `raw-${kind}`, bytes: 1000, sha256: HASH, start_ms: 0, end_ms: duration_ms }])) },
    voice: { kind: 'synthetic', track: 'separate-offline', microphone: false },
    audio: [{ attempt_id: 'a1', start_raw_ms: offsets.audio + 200, end_raw_ms: offsets.audio + 400, voiced: true },
      { attempt_id: 'a2', start_raw_ms: offsets.audio + 10100, end_raw_ms: offsets.audio + 10400, voiced: true }],
    events, frames, provenance: null, prerequisites: {},
  };
}

// Deliberately limited to generated fixtures. Media receipts here are schema data;
// only the tools recorder/scorer can inspect real media and establish provenance.
export function checkFixture(e) {
  const failures = new Set();
  const gate = (id, ok) => { if (!ok) failures.add(id); };
  const events = e.events ?? [], frames = e.frames ?? [], audio = e.audio ?? [];
  const one = (type, predicate = () => true) => events.find(v => v.type === type && predicate(v));
  const all = type => events.filter(v => v.type === type);
  const beat = name => e.route?.beat_ids?.[name];
  gate('route', typeof e.route?.route_id === 'string' && e.route.route_id.length > 0
    && BEATS.every(id => typeof beat(id) === 'string' && beat(id).length > 0)
    && new Set(BEATS.map(beat)).size === BEATS.length);
  gate('synthetic-mode', e.mode === 'synthetic');
  gate('synthetic-audio', e.voice?.kind === 'synthetic' && e.voice?.track === 'separate-offline' && e.voice?.microphone === false);
  gate('sha', /^[a-f0-9]{40}$/.test(e.app_sha ?? '') && e.app_sha === e.current_sha);
  gate('fixture-only', e.fixture_only === true);
  const duration = e.capture?.duration_ms;
  gate('duration', finite(duration) && duration > 0 && duration <= 180000
    && finite(e.route?.planned_ms) && e.route.planned_ms <= 175000 && duration <= e.route.planned_ms);
  gate('continuous', Array.isArray(e.capture?.cuts) && e.capture.cuts.length === 0);
  const offsets = {};
  for (const stream of ['screen', 'audio', 'trace']) {
    const [start, end] = e.capture?.clocks?.[stream] ?? [];
    gate(`clock-${stream}`, start?.marker === 'start' && end?.marker === 'end'
      && start.capture_ms === 0 && end.capture_ms === duration && finite(start.raw_ms) && finite(end.raw_ms)
      && end.raw_ms - start.raw_ms === duration);
    offsets[stream] = start?.raw_ms - start?.capture_ms;
    const media = e.capture?.media?.[stream];
    gate(`raw-${stream}`, media?.bytes > 0 && /^[a-f0-9]{64}$/.test(media.sha256 ?? '')
      && !!media.name && media.start_ms === 0 && media.end_ms === duration);
  }
  const at = v => v?.raw_ms - offsets.trace;
  const frameAt = f => f.raw_ms - offsets.screen;
  const ordered = [...frames].sort((a, b) => frameAt(a) - frameAt(b));
  gate('frames', ordered.length > 1 && frameAt(ordered[0]) === 0 && frameAt(ordered.at(-1)) === duration
    && ordered.every((f, i) => !i || (frameAt(f) > frameAt(ordered[i - 1]) && frameAt(f) - frameAt(ordered[i - 1]) <= 100)));
  gate('trace', events.length > 0 && events.every(v => finite(at(v)) && at(v) >= 0 && at(v) <= duration));
  gate('audio', audio.length > 0 && audio.every(v => finite(v.start_raw_ms) && finite(v.end_raw_ms)
    && v.start_raw_ms < v.end_raw_ms && v.start_raw_ms >= offsets.audio && v.end_raw_ms <= offsets.audio + duration));
  const visible = (f, id, text) => (f.cards ?? []).some(c => c.id === id && c.text === text
    && inside(c.bounds, f.viewport) && inside(c.text_bounds, c.bounds) && Array.isArray(c.occluders)
    && !c.occluders.some(r => intersects(c.bounds, r)));
  const hold = (id, text, start, end) => {
    let from, previous;
    for (const f of ordered.filter(f => frameAt(f) >= start && frameAt(f) <= end)) {
      const ms = frameAt(f);
      if (!visible(f, id, text) || (previous !== undefined && ms - previous > 100)) from = undefined;
      else if (from === undefined) from = ms;
      if (from !== undefined && ms - from >= 3000) return true;
      previous = ms;
    }
    return false;
  };
  const request = one('request', v => v.beat_id === beat('source'));
  const source = one('thought', v => v.id === request?.source_id);
  const opened = one('source_opened', v => v.beat_id === beat('source'));
  const continuation = one('placement', v => v.beat_id === beat('continue'));
  const thought = one('thought', v => v.id === continuation?.thought_id);
  gate('source', !!source?.text && opened?.source_id === source.id && opened?.topic_id === source.topic_id
    && request?.topic_id === source.topic_id && hold(source.id, source.text, at(opened), 5000));
  gate('continuation', !!thought?.text && continuation?.source_id === source?.id
    && thought.topic_id === source?.topic_id && continuation.topic_id === source?.topic_id
    && hold(thought.id, thought.text, at(continuation), at(continuation) + 4000));

  const intervals = all('process_start').map(start => {
    const end = one('process_end', v => v.job_id === start.job_id && v.pid === start.pid);
    const running = one('job', v => v.id === start.job_id && v.status === 'running' && v.parent === start.parent);
    const done = one('job', v => v.id === start.job_id && v.status === 'done' && v.parent === start.parent);
    const call = one('call_start', v => v.job_id === start.job_id && v.pid === start.pid);
    const callEnd = one('call_end', v => v.job_id === start.job_id && v.call_id === call?.call_id);
    const response = one('provider_response', v => v.call_id === call?.call_id && v.request_id === callEnd?.provider_request_id);
    const firstRunning = ordered.find(f => (f.running ?? []).includes(start.job_id));
    const parent = one('admission', v => v.id === start.parent);
    gate('child-intervals', !!start.parent && !!parent && start.pid > 0 && end?.exit_code === 0
      && at(start) < at(end) && at(start) >= at(parent) && at(running) >= at(start) && at(running) < at(end)
      && at(done) >= at(end) && frameAt(firstRunning ?? {}) >= at(running) && frameAt(firstRunning ?? {}) < at(end));
    gate('model', !!call?.call_id && !!call?.model && !!call?.provider && at(call) >= at(start) && at(callEnd) <= at(end)
      && at(callEnd) > at(call) && at(response) >= at(callEnd) && at(response) <= at(end)
      && response?.model === call.model && response?.transport === 'fixture');
    return { id: start.job_id, kind: parent?.helper_kind, start: at(start), end: at(end), callStart: at(call), callEnd: at(callEnd),
      firstRunning: frameAt(firstRunning ?? {}), done: at(done) };
  });
  const code = intervals.filter(v => v.kind === 'coding'), think = intervals.filter(v => v.kind === 'thinking');
  const second = one('admission', v => v.beat_id === beat('think'));
  gate('three-at-admission', code.filter(v => v.start < at(second) && v.end > at(second)).length >= 3);
  gate('overlap', think.some(t => code.some(c => Math.max(t.callStart, c.callStart) < Math.min(t.callEnd, c.callEnd))));
  const speech = audio.filter(v => v.attempt_id === continuation?.attempt_id && v.voiced);
  gate('speech-during-work', speech.length > 0 && speech.every(s => code.some(c => s.start_raw_ms - offsets.audio >= c.start
    && s.end_raw_ms - offsets.audio <= c.end)));
  gate('placement-during-work', code.some(c => at(continuation) > c.start && at(continuation) < c.end));
  gate('children', code.length >= 3 && think.length >= 1 && new Set(intervals.map(v => v.id)).size === intervals.length);

  const inspected = all('inspect');
  gate('inspection', ['answer', 'diff'].every(kind => inspected.some(i => {
    const r = one('result', r => r.result_id === i.result_id && r.job_id === i.job_id && r.kind === kind);
    const job = intervals.find(j => j.id === i.job_id);
    return r?.text && r.base_sha === e.app_sha && job?.done <= at(r) && at(i) >= at(r)
      && hold(r.result_id, r.text, at(i), 22000);
  })));
  const diff = one('result', r => r.kind === 'diff');
  const validation = one('validation_start', v => v.job_id === diff?.job_id);
  const validated = one('validation_end', v => v.job_id === diff?.job_id && v.command_id === validation?.command_id);
  const commit = one('commit', v => v.job_id === diff?.job_id && v.sha === diff?.commit_sha);
  gate('validation-commit', !!validation?.argv?.length && validated?.exit_code === 0 && at(validated) > at(validation)
    && at(validation) >= (intervals.find(j => j.id === diff?.job_id)?.end ?? Infinity)
    && commit?.base_sha === e.app_sha && /^[a-f0-9]{40}$/.test(commit?.sha ?? '')
    && at(commit) >= at(validated) && at(diff) >= at(commit));
  const returned = one('source_opened', v => v.beat_id === beat('return'));
  gate('source-return', !!source && returned?.source_id === source.id && returned?.topic_id === source.topic_id
    && inspected.length > 0 && inspected.every(i => at(i) < at(returned))
    && hold(source.id, source.text, at(returned), at(returned) + 4000));
  const invoke = one('email_invoke'), outcome = one('email_outcome', v => v.id === invoke?.id);
  const counting = one('send_card', v => v.id === invoke?.id && v.channel === 'email' && v.state === 'counting');
  gate('email', invoke?.beat_id === beat('email') && invoke?.source_id === source?.id && invoke?.result_id === diff?.result_id
    && at(invoke) >= at(returned) + 3000 && at(counting) > at(invoke) && at(outcome) > at(counting)
    && outcome?.state === 'dry_run' && outcome?.live === false && counting?.live === false
    && ordered.some(f => frameAt(f) >= at(outcome) && f.email?.id === invoke?.id && f.email?.state === outcome.state));

  const samples = [], misses = [];
  for (const a of all('request')) {
    const segments = audio.filter(v => v.attempt_id === a.id && v.voiced);
    const end = segments.length ? Math.max(...segments.map(s => s.end_raw_ms - offsets.audio)) : NaN;
    const placement = one('placement', p => p.attempt_id === a.id);
    const item = a.beat_id === beat('source') ? source : one('thought', t => t.id === placement?.thought_id);
    const frame = item && ordered.find(f => frameAt(f) >= at(a) && visible(f, item.id, item.text));
    if (finite(end) && frame && frameAt(frame) > end) samples.push({ attempt_id: a.id, speech_end_ms: end,
      first_card_visible_ms: frameAt(frame), ms: frameAt(frame) - end });
    else misses.push(a.id);
  }
  gate('acoustic-endpoints', misses.length === 0 && samples.length > 0);
  const metrics = { metric: 'speech_end_to_first_card_visible', n: samples.length, attempts: all('request').length, misses, samples };
  // Incomplete endpoints stay in the denominator; no seconds caption is emitted.
  const caption = !misses.length && samples.length ? `${metrics.metric}: ${samples.map(s => `${s.ms / 1000}s`).join(', ')}; n=${metrics.n}; misses=0` : null;
  const results = all('result').map(r => {
    const frame = ordered.find(f => frameAt(f) >= at(r) && visible(f, r.result_id, r.text));
    return { result_id: r.result_id, job_id: r.job_id, published_ms: at(r), first_useful_result_ms: frame ? frameAt(frame) : null };
  });
  gate('useful-result', results.length >= 2 && results.every(r => finite(r.first_useful_result_ms)
    && r.first_useful_result_ms >= r.published_ms && r.first_useful_result_ms > (intervals.find(j => j.id === r.job_id)?.end ?? Infinity)));
  const endpoints = { results, email_invocation_ms: at(invoke), email_outcome_ms: at(outcome) };
  const publicBlockers = ['fixture-only'];
  if (e.mode === 'synthetic') publicBlockers.push('synthetic');
  if (e.voice?.kind !== 'recorded-human' || e.voice?.track !== 'raw-audio') publicBlockers.push('recorded-voice');
  if (!e.provenance?.capture_id) publicBlockers.push('provenance');
  for (const id of ['B1', 'B2', 'B3', 'B4']) if (e.prerequisites?.[id]?.status !== 'proved' || !e.prerequisites[id].evidence_id) publicBlockers.push(id);
  if (outcome?.state !== 'sent' || outcome?.live !== true) publicBlockers.push('genuine-sent');
  if (all('provider_response').some(v => v.transport !== 'live')) publicBlockers.push('live-model');
  return { technical: failures.size === 0, failures: [...failures], publicEligible: false, humanEligible: false,
    publicBlockers, offsets, endpoints, source_id: source?.id, continuation_id: thought?.id, intervals, metrics, caption };
}

export function runFixtureTests(evaluate = checkFixture) {
  const base = genericFixture();
  const good = evaluate(base);
  assert.equal(good.technical, true, JSON.stringify(good.failures));
  assert.equal(good.publicEligible, false);
  assert.equal(good.humanEligible, false);
  assert.deepEqual(good.offsets, { screen: 900, audio: 1700, trace: 2500 });
  assert.equal(good.source_id, 's1'); assert.equal(good.continuation_id, 's2');
  assert.equal(good.intervals.length, 4, 'parents are excluded');
  assert.deepEqual([good.intervals[0].start, good.intervals[0].firstRunning, good.intervals[0].end,
    good.endpoints.results[0].first_useful_result_ms, good.endpoints.email_invocation_ms, good.endpoints.email_outcome_ms],
    [5500, 5600, 16000, 17500, 26000, 27000], 'process, displayed work, useful result and email endpoints stay distinct');
  const renamed = structuredClone(base);
  for (const key of BEATS) renamed.route.beat_ids[key] = `beat-${key}`;
  renamed.events.forEach(v => { if (v.beat_id) v.beat_id = `beat-${v.beat_id}`; });
  assert.equal(evaluate(renamed).technical, true, 'explicit beat IDs need not equal their logical names');
  assert.deepEqual(good.metrics.samples.map(s => [s.speech_end_ms, s.first_card_visible_ms, s.ms]), [[400, 500, 100], [10400, 10500, 100]]);
  assert.match(good.caption, /n=2; misses=0/);
  const cases = [
    ['route', e => { delete e.route.route_id; }],
    ...BEATS.map(b => ['route', e => { delete e.route.beat_ids[b]; }]),
    ['synthetic-mode', e => { e.mode = 'public'; }],
    ['synthetic-audio', e => { e.voice.microphone = true; }],
    ['synthetic-audio', e => { e.voice.kind = 'recorded-human'; }],
    ['sha', e => { e.current_sha = 'd'.repeat(40); }],
    ['duration', e => { e.route.planned_ms = 175001; }],
    ['duration', e => { e.capture.duration_ms = 180001; }],
    ['continuous', e => { e.capture.cuts.push({ start_ms: 6000, end_ms: 7000, hidden: true, state: 'pending' }); }],
    ...['screen', 'audio', 'trace'].flatMap(s => [
      [`raw-${s}`, e => { delete e.capture.media[s]; }],
      [`clock-${s}`, e => { delete e.capture.clocks[s]; }],
      [`clock-${s}`, e => { e.capture.clocks[s][1].raw_ms += 200; }],
    ]),
    ['frames', e => { e.frames = e.frames.filter(f => f.raw_ms < 7000 || f.raw_ms > 8000); }],
    ['trace', e => { e.events = []; }],
    ['audio', e => { e.audio = []; }],
    ['source', e => { e.events.find(v => v.type === 'source_opened').source_id = 'wrong'; }],
    ['source', e => { e.events.find(v => v.type === 'source_opened').topic_id = 'wrong'; }],
    ['source', e => { e.frames.forEach(f => f.cards.forEach(c => { if (c.id === 's1') c.text = 'Incomplete'; })); }],
    ['source', e => { e.frames.forEach(f => f.cards.forEach(c => { c.text_bounds.width = 2000; })); }],
    ['source', e => { e.frames.forEach(f => f.cards.forEach(c => { c.bounds.x = -1; })); }],
    ['source', e => { e.frames.forEach(f => f.cards.forEach(c => { c.occluders.push(rect(30, 30, 5, 5)); })); }],
    ['source', e => { e.frames.forEach(f => { if (f.raw_ms < 4900 && f.raw_ms > 4300) f.cards = []; }); }],
    ['source', e => { e.frames.forEach(f => { if (f.raw_ms === 3000) f.cards = []; }); }],
    ['continuation', e => { e.events.find(v => v.type === 'placement').source_id = 'wrong'; }],
    ['continuation', e => { e.events.find(v => v.type === 'placement').topic_id = 'wrong'; }],
    ['child-intervals', e => { e.events = e.events.filter(v => v.type !== 'process_end'); }],
    ['child-intervals', e => { e.events.filter(v => v.type === 'job' && v.status === 'running').forEach(v => { v.status = 'queued'; }); }],
    ['child-intervals', e => { e.frames.forEach(f => { f.running = []; }); }],
    ['model', e => { e.events = e.events.filter(v => v.type !== 'call_start'); }],
    ['model', e => { e.events = e.events.filter(v => v.type !== 'provider_response'); }],
    ['model', e => { e.events.filter(v => v.type === 'provider_response').forEach(v => { v.model = 'invented'; }); }],
    ['three-at-admission', e => { e.events.find(v => v.type === 'admission' && v.beat_id === 'think').raw_ms = 7800; }],
    ['overlap', e => { e.events.filter(v => v.job_id === 'h1' || v.id === 'h1').forEach(v => { v.raw_ms += 10000; }); }],
    ['speech-during-work', e => { e.audio[1].start_raw_ms += 10000; e.audio[1].end_raw_ms += 10000; }],
    ['placement-during-work', e => { e.events.find(v => v.type === 'placement').raw_ms += 10000; }],
    ['children', e => { e.events = e.events.filter(v => v.job_id !== 'c2'); }],
    ['useful-result', e => { e.frames.forEach(f => { f.cards = f.cards.filter(c => c.id !== 'd1'); }); }],
    ['inspection', e => { e.events = e.events.filter(v => v.type !== 'result'); }],
    ['inspection', e => { e.events = e.events.filter(v => v.type !== 'inspect'); }],
    ['inspection', e => { e.events.find(v => v.type === 'inspect').job_id = 'unrelated'; }],
    ['inspection', e => { e.events.find(v => v.type === 'result').base_sha = 'd'.repeat(40); }],
    ['validation-commit', e => { e.events = e.events.filter(v => v.type !== 'validation_end'); }],
    ['validation-commit', e => { e.events.find(v => v.type === 'validation_end').exit_code = 1; }],
    ['validation-commit', e => { e.events = e.events.filter(v => v.type !== 'commit'); }],
    ['source-return', e => { e.events = e.events.filter(v => v.beat_id !== 'return'); }],
    ['email', e => { e.events = e.events.filter(v => v.type !== 'email_invoke'); }],
    ['email', e => { e.events = e.events.filter(v => v.type !== 'email_outcome'); }],
    ['email', e => { e.events.find(v => v.type === 'email_outcome').state = 'sent'; }],
    ['acoustic-endpoints', e => { e.audio = e.audio.filter(v => v.attempt_id !== 'a1'); }],
    ['acoustic-endpoints', e => { e.audio.forEach(v => { v.start_raw_ms += 1000; v.end_raw_ms += 1000; }); }],
  ];
  for (const [gate, mutate] of cases) {
    const e = structuredClone(base); mutate(e);
    const result = evaluate(e);
    assert.equal(result.technical, false, `negative accepted: ${gate}`);
    assert.ok(result.failures.includes(gate), `missing ${gate}: ${JSON.stringify(result.failures)}`);
    assert.equal(result.publicEligible, false);
  }
  const missed = structuredClone(base);
  missed.events.push({ type: 'request', id: 'missed', beat_id: 'source', raw_ms: 3100 });
  const counted = evaluate(missed);
  assert.equal(counted.metrics.attempts, 3);
  assert.equal(counted.metrics.n, 2);
  assert.deepEqual(counted.metrics.misses, ['missed']);
  assert.equal(counted.caption, null);
  const forged = structuredClone(base);
  forged.voice = { kind: 'recorded-human', track: 'raw-audio' };
  forged.provenance = { capture_id: 'fixture' };
  forged.prerequisites = Object.fromEntries(['B1', 'B2', 'B3', 'B4'].map(id => [id, { status: 'proved', evidence_id: 'fixture' }]));
  assert.ok(evaluate(forged).publicBlockers.includes('synthetic'));
  assert.equal(evaluate(forged).humanEligible, false, 'a voice label never promotes synthetic evidence');
  for (const missing of ['recorded-voice', 'provenance', 'B1', 'B2', 'B3', 'B4', 'genuine-sent', 'live-model']) {
    assert.ok(good.publicBlockers.includes(missing), `public gate missing: ${missing}`);
  }
  return { positive: 2, negative: cases.length + 2, recording: 'unproved', toolsIntegration: 'unproved' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runFixtureTests();
  console.log(`PASS film-evidence fixture contract: ${result.positive} positive, ${result.negative} negative; raw rehearsal and tools integration unproved; public/human ineligible`);
}
