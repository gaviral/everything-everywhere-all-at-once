const finite = (n, label) => {
  if (!Number.isFinite(n)) throw new Error(`${label} must be a finite number`);
  return n;
};
const positive = (n, label) => {
  if (finite(n, label) <= 0) throw new Error(`${label} must be positive`);
  return n;
};
const words = (value, label) => {
  const result = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(result) || !result.length || result.some(x => typeof x !== 'string' || !x.trim()))
    throw new Error(`${label} must contain text`);
  return result;
};
function plane(clip) {
  if (!clip || typeof clip.clip !== 'string' || !clip.clip) throw new Error('plane needs a clip');
  if (clip.start !== undefined && finite(clip.start, 'start') < 0) throw new Error('start must be nonnegative');
  for (const key of ['tilt', 'position']) {
    if (clip[key] !== undefined && (!Array.isArray(clip[key]) || clip[key].length !== (key === 'tilt' ? 3 : 2)))
      throw new Error(`${key} has the wrong dimensions`);
    clip[key]?.forEach(n => finite(n, key));
  }
  if (clip.width !== undefined) positive(clip.width, 'width');
}
export function timeline(config) {
  if (!Array.isArray(config.shots) || !config.shots.length) throw new Error('shots must be a nonempty array');
  let cursor = 0;
  const shots = config.shots.map((shot, index) => {
    if (!['title', 'plane', 'planes', 'card', 'list', 'end'].includes(shot.kind)) throw new Error(`Unknown shot kind: ${shot.kind}`);
    let duration = positive(shot.seconds, `shot ${index + 1} seconds`);
    if (shot.kind === 'title') words(shot.words, 'title words');
    if (shot.kind === 'card') words(shot.word, 'card word');
    if (shot.kind === 'list') duration *= words(shot.names, 'list names').length;
    if (shot.kind === 'plane') plane(shot);
    if (shot.kind === 'planes') {
      if (!Array.isArray(shot.clips) || shot.clips.length < 2 || shot.clips.length > 3) throw new Error('planes needs two or three clips');
      shot.clips.forEach(plane);
    }
    if (shot.zoom !== undefined) {
      if (!Array.isArray(shot.zoom) || shot.zoom.length !== 2) throw new Error('zoom needs [from, to]');
      shot.zoom.forEach(n => positive(n, 'zoom'));
    }
    for (const point of Object.values(shot.drift ?? {})) {
      if (!Array.isArray(point) || point.length !== 2) throw new Error('drift needs from/to [x, y]');
      point.forEach(n => finite(n, 'drift'));
    }
    const result = { ...shot, index, at: cursor, duration };
    cursor += duration;
    return result;
  });
  return { shots, duration: cursor };
}
export function shotAt(plan, seconds) {
  const shot = plan.shots.find(s => seconds >= s.at && seconds < s.at + s.duration);
  if (!shot) throw new Error(`No shot at ${seconds}s`);
  return { shot, local: seconds - shot.at };
}
export function frameRange(duration, fps, from = 0, to = duration) {
  if (finite(from, 'from') < 0 || finite(to, 'to') > duration || to <= from) throw new Error('Expected 0 <= from < to <= film duration');
  const first = Math.ceil(from * fps - 1e-8);
  const end = Math.ceil(to * fps - 1e-8);
  if (first >= end) throw new Error('Range contains no frame');
  return { first, end, count: end - first };
}
