#!/usr/bin/env node
// Each content-addressed shot is independent; only complete cuts join the film.
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir, realpath, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { openStage } from './chrome.mjs';
import { timeline } from './timeline.mjs';
import { run } from './render.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const media = join(homedir(), 'code', 'e2a2o-media', 'film-1104');
function options(args) {
  const opts = { file: join(media, 'shots.json'), cuts: join(media, 'cuts'), preview: true };
  if (args[0] && !args[0].startsWith('--')) opts.file = resolve(args.shift());
  while (args.length) {
    const arg = args.shift();
    if (arg === '--preview' || arg === '--final') { opts.preview = arg === '--preview'; continue; }
    if (!['--out', '--cuts-dir'].includes(arg) || !args.length) throw new Error('Usage: node film/cut.mjs [shots.json] [--preview|--final] [--out film.mp4] [--cuts-dir directory]');
    opts[arg === '--out' ? 'out' : 'cuts'] = resolve(args.shift());
  }
  opts.out ??= join(media, 'renders', opts.preview ? 'preview-1.mp4' : 'final.mp4');
  return opts;
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function fileDigest(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}
function probe(path) {
  return JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=codec_name,width,height,r_frame_rate,nb_frames,duration', '-of', 'json', path])).streams[0];
}
function mediaSpecs(shot) { return ['plane','laptop'].includes(shot.kind) ? [shot] : shot.kind === 'planes' ? shot.clips : shot.kind === 'wall' ? [...shot.tiles,...(shot.opening?[shot.opening]:[])] : []; }
async function prepareShot(original, config, shared, hashFile) {
  const shot = structuredClone(original);
  // Film position and editorial notes never affect a shot's pixels or cache key.
  delete shot.at; delete shot.index; delete shot.note; delete shot.id;
  const inputs = [];
  for (const spec of mediaSpecs(shot)) {
    const path = await realpath(resolve(dirname(config), spec.clip ?? spec.image));
    if (spec.clip) {
      const video = probe(path);
      const duration = Number(video.duration);
      if (!Number.isFinite(duration)) throw new Error(`Clip has no finite duration: ${spec.clip}`);
      const needed = shot.kind === 'wall' ? spec.loopSeconds ?? duration - (spec.start ?? 0) : Math.min(shot.duration*(spec.rate??1), spec.playSeconds ?? shot.duration*(spec.rate??1));
      if (needed < 0 || (spec.start ?? 0) + needed > duration + 1e-6)
        throw new Error(`Clip too short: ${spec.clip}`);
    }
    inputs.push([spec.clip ?? spec.image, await hashFile(path)]);
    spec.source = pathToFileURL(path).href;
  }
  const keyShot = structuredClone(shot);
  for (const spec of mediaSpecs(keyShot)) delete spec.source;
  return { shot: { ...shot, index: 0 }, key: digest(JSON.stringify({ shot: keyShot, inputs, shared })) };
}
function matches(video, format, frames) {
  return video?.codec_name === 'h264' && video.width === format.width && video.height === format.height &&
    video.r_frame_rate === `${format.fps}/1` && Number(video.nb_frames) === frames;
}
async function cached(file, format, frames) {
  try { return matches(probe(file), format, frames); } catch { return false; }
}
function encoder(file, format, frames) {
  const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-n', '-f', 'image2pipe', '-vcodec', 'png',
    '-framerate', String(format.fps), '-i', 'pipe:0', '-frames:v', String(frames), '-an', '-c:v', 'libx264',
    '-threads', '2', '-preset', format.preview ? 'ultrafast' : 'medium', '-crf', format.preview ? '23' : '18',
    '-pix_fmt', 'yuv420p', '-video_track_timescale', '90000', '-movflags', '+faststart', file], { stdio: ['pipe', 'ignore', 'pipe'] });
  let errorText = '';
  child.stderr.on('data', b => { errorText = (errorText + b).slice(-2000); });
  child.stdin.on('error', () => {});
  const done = new Promise((yes, no) => {
    child.once('error', no);
    child.once('close', code => code === 0 ? yes() : no(new Error(`Encoder exited ${code}: ${errorText}`)));
  });
  done.catch(() => {});
  return { child, done };
}
async function renderShot(shot, file, format, frames) {
  const partial = file.replace(/\.mp4$/, `.${randomUUID()}.partial.mp4`);
  const stage = await openStage(join(here, 'stage.html'), format.width, format.height);
  const enc = encoder(partial, format, frames);
  try {
    for (let i = 0; i < frames; i++) {
      await stage.frame(shot, i / format.fps);
      if (!enc.child.stdin.write(await stage.screenshot())) await Promise.race([once(enc.child.stdin, 'drain'), enc.done.then(() => { throw new Error('Encoder ended before all frames'); })]);
    }
    enc.child.stdin.end();
    await enc.done;
    if (!matches(probe(partial), format, frames)) throw new Error('Encoded shot does not match requested format');
    await rename(partial, file);
  } finally {
    await stage.close();
    if (enc.child.exitCode === null && enc.child.signalCode === null) { enc.child.kill('SIGTERM'); await enc.done.catch(() => {}); }
  }
}
async function pool(items, work) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
    while (cursor < items.length) { const index = cursor++; await work(items[index], index); }
  }));
}
export async function joinShots(results, opts) {
  const list = join(opts.cuts, `join-${randomUUID()}.ffconcat`);
  await writeFile(list, 'ffconcat version 1.0\n' + results.map(r => `file '${r.file.replaceAll("'", "'\\''")}'\nduration ${(r.frames / opts.fps).toFixed(12)}`).join('\n') + '\n');
  const partial = opts.out.replace(/\.mp4$/, `.${randomUUID()}.partial.mp4`);
  const frameCount=results.reduce((n,r)=>n+r.frames,0);
  const lastPTS=Math.round((frameCount-1)*90000/opts.fps);
  const tail=Math.round(opts.duration*90000)-lastPTS;
  if(tail<=0 || tail>Math.ceil(90000/opts.fps)) throw new Error('Last-frame duration is outside one frame');
  const targetTicks=Math.round(opts.duration*90000);
  const timing=`setts=pts=PTS:dts=DTS:duration=if(gte(PTS\\,${targetTicks-Math.ceil(90000/opts.fps)})\\,${targetTicks}-PTS\\,DURATION)`;
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-n', '-f', 'concat', '-safe', '0', '-i', list, '-map', '0:v:0', '-c', 'copy', '-bsf:v', timing, '-movie_timescale', '1000', '-movflags', '+faststart', partial]);
  // Preserve previous review versions rather than overwriting them.
  try { await rename(opts.out, opts.out.replace(/\.mp4$/, `.previous-${randomUUID()}.mp4`)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await rename(partial, opts.out);
}
export async function cut(args = process.argv.slice(2)) {
  const opts = options([...args]);
  const plan = timeline(JSON.parse(await readFile(opts.file, 'utf8')));
  if (!opts.out.endsWith('.mp4')) throw new Error('--out must end in .mp4');
  const format = { preview: opts.preview, width: opts.preview ? 960 : 1920, height: opts.preview ? 540 : 1080, fps: opts.preview ? 15 : 30 };
  await mkdir(opts.cuts, { recursive: true }); await mkdir(dirname(opts.out), { recursive: true });
  const hashes = new Map();
  const hashFile = path => { if (!hashes.has(path)) hashes.set(path, fileDigest(path)); return hashes.get(path); };
  const code = await Promise.all(['stage.html', 'title-morph.mjs', 'wall.mjs', 'wall-field.mjs', 'brand.mjs', 'motion.mjs', 'laptop.mjs', 'chrome.mjs', 'timeline.mjs', 'cut.mjs'].map(name => hashFile(join(here, name))));
  const shared = { format, code, logo: await hashFile(join(here, '../ui/public/icons/icon-512.png')), shapes: await hashFile(join(here, '../ui/public/icon.svg')) };
  const results = new Array(plan.shots.length), inFlight = new Map();
  await pool(plan.shots, async (original, index) => {
    try {
      const frames = original.frames?.[format.preview ? 'preview' : 'final'] ?? Math.ceil(original.duration * format.fps - 1e-8);
      if (!Number.isInteger(frames) || frames < 1) throw new Error('Shot frame allocation must be a positive integer');
      const { shot, key } = await prepareShot({...original, duration: frames / format.fps}, opts.file, shared, hashFile);
      const file = join(opts.cuts, `${key}.mp4`);
      let reused = await cached(file, format, frames);
      if (!reused) {
        if (!inFlight.has(key)) inFlight.set(key, renderShot(shot, file, format, frames));
        await inFlight.get(key);
      }
      results[index] = { id: original.id ?? index + 1, file, key, frames, reused };
      console.log(`${reused ? 'CACHED' : 'RENDERED'} shot ${index + 1}/${plan.shots.length} ${original.id ?? original.kind}`);
    } catch (error) {
      results[index] = { id: original.id ?? index + 1, error: error.message };
      console.error(`FAILED shot ${index + 1}: ${error.message}`);
    }
  });
  const report = { ...format, results, failed: results.filter(r => r.error).length };
  await writeFile(`${opts.out}.json`, JSON.stringify(report, null, 2) + '\n');
  if (report.failed) throw new Error(`${report.failed} shot(s) failed; successful cuts retained. Film was not joined.`);
  opts.duration=Math.round(plan.duration*1000)/1000;opts.fps=format.fps;
  await joinShots(results, opts);
  let cursor = 0;
  const times = results.map(r => {
    const remaining=opts.duration-cursor/format.fps;
    const line = `${(cursor / format.fps).toFixed(3)}\t${r.id}\t${Math.min(r.frames/format.fps,remaining).toFixed(3)}`;
    cursor += r.frames; return line;
  });
  await writeFile(opts.out.replace(/\.mp4$/, '.times.txt'), 'start_seconds\tshot_id\tduration_seconds\n' + times.join('\n') + `\n${opts.duration.toFixed(3)}\tEND\t0.000\n`);
  console.log(`JOINED ${results.length} shots: ${opts.out}`);
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cut().catch(error => { console.error(error.message); process.exitCode = 1; });
}
