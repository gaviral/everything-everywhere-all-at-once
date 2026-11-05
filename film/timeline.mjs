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
  if (!clip || Boolean(clip.clip) === Boolean(clip.image)) throw new Error('plane needs one clip or image');
  if (typeof (clip.clip ?? clip.image) !== 'string') throw new Error('media needs a filename');
  if (clip.start !== undefined && finite(clip.start, 'start') < 0) throw new Error('start must be nonnegative');
  for (const key of ['tilt', 'tiltTo', 'position']) {
    if (clip[key] !== undefined && (!Array.isArray(clip[key]) || clip[key].length !== (key === 'position' ? 2 : 3)))
      throw new Error(`${key} has the wrong dimensions`);
    clip[key]?.forEach(n => finite(n, key));
  }
  if (clip.rate !== undefined) positive(clip.rate, 'rate');
  if (clip.settleSeconds !== undefined) positive(clip.settleSeconds, 'settleSeconds');
  if (clip.width !== undefined) positive(clip.width, 'width');
  if (clip.playSeconds !== undefined && finite(clip.playSeconds, 'playSeconds') < 0) throw new Error('playSeconds must be nonnegative');
  if (clip.crop !== undefined) {
    if (!Array.isArray(clip.crop) || clip.crop.length !== 4) throw new Error('crop needs normalized [x,y,width,height]');
    const [x,y,w,h] = clip.crop;
    clip.crop.forEach(n => finite(n, 'crop'));
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x+w > 1 || y+h > 1) throw new Error('crop must fit inside the clip');
  }
}
export function timeline(config) {
  if (!Array.isArray(config.shots) || !config.shots.length) throw new Error('shots must be a nonempty array');
  let cursor = 0;
  const shots = config.shots.map((shot, index) => {
    if (!['title', 'titlemorph', 'pulse', 'feature', 'brand', 'laptop', 'plane', 'planes', 'wall', 'card', 'list', 'end'].includes(shot.kind)) throw new Error(`Unknown shot kind: ${shot.kind}`);
    if (shot.kind === 'titlemorph' && shot.variant !== undefined && !['short', 'long'].includes(shot.variant)) throw new Error('titlemorph variant must be short or long');
    let duration = positive(shot.seconds, `shot ${index + 1} seconds`);
    if (shot.kind === 'title' || shot.kind === 'pulse') words(shot.words, 'title words');
    if (shot.kind === 'card' || shot.kind === 'feature') words(shot.word, 'card word');
    if (shot.kind === 'list') duration *= words(shot.names, 'list names').length;
    if (shot.kind === 'plane' || shot.kind === 'laptop') plane(shot);
    if (shot.kind === 'planes') {
      if (!Array.isArray(shot.clips) || shot.clips.length < 2 || shot.clips.length > 3) throw new Error('planes needs two or three clips');
      shot.clips.forEach(plane);
    }
    if (shot.kind === 'wall') {
      if (!Array.isArray(shot.tiles) || !shot.tiles.length) throw new Error('wall needs real image or clip tiles');
      if (shot.layout==='field') {
        if(shot.tiles.length<144||(shot.tiles.length-144)%3||shot.tiles.length>576) throw Error('Field needs complete four-square clusters in its rectangle');
        if(!shot.opening?.image||!Array.isArray(shot.opening.crop)||shot.opening.crop.length!==3) throw Error('Field needs its original opening frame and square crop');
      } else if (!shot.tiles[0].clip) throw new Error('wall starts on a clip');
      for (const tile of shot.tiles) {
        if (Boolean(tile.clip) === Boolean(tile.image)) throw new Error('Each wall tile needs exactly one image or clip');
        if (tile.clip) plane(tile);
        else if (typeof tile.image !== 'string' || !tile.image) throw new Error('wall image needs a filename');
        if (tile.loopSeconds !== undefined) positive(tile.loopSeconds, 'loopSeconds');
      }
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
