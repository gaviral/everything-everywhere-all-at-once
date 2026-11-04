#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, readdir, realpath } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { openStage } from './chrome.mjs';
import { timeline, shotAt, frameRange } from './timeline.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${(result.stderr ?? '').slice(-1200)}`);
  return result.stdout;
}
function options(args) {
  const out = { file: join(here, 'shots.example.json'), preview: false };
  if (args[0] && !args[0].startsWith('--')) out.file = resolve(args.shift());
  while (args.length) {
    const arg = args.shift();
    if (arg === '--preview') { out.preview = true; continue; }
    if (!['--from', '--to', '--out', '--clips-dir'].includes(arg) || !args.length || args[0].startsWith('--'))
      throw new Error('Usage: node film/render.mjs [shots.json] [--preview] [--from seconds] [--to seconds] [--clips-dir directory] [--out file.mp4]');
    out[arg.slice(2)] = args.shift();
  }
  return out;
}
async function workspace(output) {
  if (output) {
    const file = resolve(output);
    if (!file.endsWith('.mp4')) throw new Error('--out must end in .mp4');
    await mkdir(dirname(file), { recursive: true });
    // Reserve a new frame directory; never overwrite or remove a previous render.
    const directory = `${file}.frames`;
    await mkdir(directory);
    return { file, directory };
  }
  await mkdir(join(here, 'renders'), { recursive: true });
  const directory = await mkdtemp(join(here, 'renders', 'take-'));
  return { file: join(directory, 'film.mp4'), directory };
}
async function testClips(directory, duration) {
  const colours = ['0x0866FF', '0xffffff', '0x101217'];
  const clips = [];
  for (let i = 0; i < colours.length; i++) {
    const file = join(directory, `test-${i + 1}.mp4`);
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-n', '-f', 'lavfi', '-i',
      `color=c=${colours[i]}:s=1280x720:r=30:d=${duration}`, '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', file]);
    clips.push(file);
  }
  console.log('No MP4 clips supplied; using generated solid-colour test footage.');
  return clips;
}
async function resolveClips(plan, configFile, clipsDir, directory) {
  const clipsOf = s => s.kind === 'plane' ? [s] : s.kind === 'planes' ? s.clips : s.kind === 'wall' ? s.tiles.filter(t => t.clip) : [];
  const specs = plan.shots.flatMap(clipsOf);
  const numbered = specs.filter(s => /^@clip:\d+$/.test(s.clip));
  let sources = [];
  if (clipsDir) {
    const root = await realpath(resolve(clipsDir));
    sources = (await readdir(root, { withFileTypes: true }))
      .filter(e => e.isFile() && /\.mp4$/i.test(e.name)).map(e => join(root, e.name)).sort();
  }
  if (numbered.length && !sources.length) {
    if (plan.shots.some(s => s.kind === 'wall' && s.tiles.some(t => /^@clip:/.test(t.clip ?? ''))))
      throw new Error('Wall requires supplied real footage');
    const maxDuration = Math.max(...plan.shots.flatMap(s => clipsOf(s).map(p => (p.start ?? 0) + s.duration))) + 1;
    sources = await testClips(directory, maxDuration);
  }
  for (const spec of specs) {
    const match = /^@clip:(\d+)$/.exec(spec.clip);
    const file = match ? sources[Number(match[1]) % sources.length] : resolve(dirname(configFile), spec.clip);
    spec.source = pathToFileURL(await realpath(file)).href;
  }
  // Fail before screenshots when supplied footage cannot cover the chosen shot.
  const durations = new Map();
  for (const shot of plan.shots) {
    for (const spec of clipsOf(shot)) {
      if (!durations.has(spec.source)) {
        const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'json', fileURLToPath(spec.source)]));
        const duration = Number(probe.streams?.[0]?.duration);
        if (!Number.isFinite(duration)) throw new Error('Clip has no finite video duration');
        durations.set(spec.source, duration);
      }
      spec.mediaDuration = durations.get(spec.source);
      const needed = shot.kind === 'wall' ? spec.loopSeconds ?? spec.mediaDuration - (spec.start ?? 0) : shot.duration;
      if (needed <= 0 || (spec.start ?? 0) + needed > spec.mediaDuration + 1e-6)
        throw new Error(`Clip is too short for shot ${shot.index + 1}`);
    }
    if (shot.kind === 'wall') for (const spec of shot.tiles.filter(t => t.image))
      spec.source = pathToFileURL(await realpath(resolve(dirname(configFile), spec.image))).href;
  }
}
export async function render(args = process.argv.slice(2)) {
  const opts = options([...args]);
  const configBytes = await readFile(opts.file);
  const plan = timeline(JSON.parse(configBytes));
  const width = opts.preview ? 960 : 1920, height = opts.preview ? 540 : 1080, fps = opts.preview ? 15 : 30;
  const range = frameRange(plan.duration, fps, opts.from === undefined ? 0 : Number(opts.from), opts.to === undefined ? plan.duration : Number(opts.to));
  const output = await workspace(opts.out);
  await resolveClips(plan, opts.file, opts['clips-dir'], output.directory);
  const stage = await openStage(join(here, 'stage.html'), width, height);
  const close = () => { void stage.close(); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
  try {
    for (let frame = range.first; frame < range.end; frame++) {
      const { shot, local } = shotAt(plan, frame / fps);
      await stage.frame(shot, local);
      await writeFile(join(output.directory, `${String(frame - range.first).padStart(6, '0')}.png`), await stage.screenshot());
    }
  } finally {
    process.removeListener('SIGINT', close); process.removeListener('SIGTERM', close);
    await stage.close();
  }
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-n', '-framerate', String(fps), '-start_number', '0', '-i',
    join(output.directory, '%06d.png'), '-frames:v', String(range.count), '-an', '-c:v', 'libx264',
    '-preset', opts.preview ? 'ultrafast' : 'medium', '-crf', opts.preview ? '23' : '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output.file]);
  const manifest = { width, height, fps, frames: range.count, firstFrame: range.first, endFrameExclusive: range.end,
    duration: range.count / fps, shotsSHA256: createHash('sha256').update(configBytes).digest('hex') };
  await writeFile(join(output.directory, 'render.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Rendered ${range.count} frames, ${width}x${height} at ${fps} fps: ${output.file}`);
  return { ...output, ...manifest };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  render().catch(error => { console.error(error.message); process.exitCode = 1; });
}
