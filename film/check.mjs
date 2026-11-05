import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openStage } from './chrome.mjs';
import { timeline, shotAt, frameRange } from './timeline.mjs';
import { render, run } from './render.mjs';

const here = dirname(fileURLToPath(import.meta.url));
await mkdir(join(here, 'renders'), { recursive: true });
const directory = await mkdtemp(join(here, 'renders', 'check-'));
const sample = timeline(JSON.parse(await readFile(join(here, 'shots.example.json'), 'utf8')));
assert.deepEqual(shotAt(sample, 1.4).shot.kind, 'plane');
assert.deepEqual(frameRange(4, 15, 0.11, 1.01), { first: 2, end: 16, count: 14 });
assert.throws(() => frameRange(4, 15, 2, 1));
assert.throws(() => timeline({ shots: [{ kind: 'planes', seconds: 1, clips: [] }] }));

const clip = join(directory, 'seek.mp4');
run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-n', '-f', 'lavfi', '-i',
  'testsrc2=s=320x180:r=30:d=4', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip]);
const stage = await openStage(join(here, 'stage.html'), 960, 540);
try {
  const title = { ...sample.shots[0], index: 100 };
  assert.equal((await stage.frame(title, 0)).text, 'Think.');
  assert.equal((await stage.frame(title, 0.7)).text, 'Make.');
  const plane = { ...sample.shots[1], source: pathToFileURL(clip).href, index: 101, drift: undefined, zoom: [1, 1], tilt: [0, 0, 0] };
  assert.equal((await stage.frame(plane, 0.3)).times[0], 0.3);
  const early = await stage.screenshot();
  await stage.frame(plane, 1.3);
  const later = await stage.screenshot();
  assert.notDeepEqual(early, later, 'Decoded video must visibly advance');
  await stage.frame(plane, 0.3);
  assert.deepEqual(await stage.screenshot(), early, 'Seeking backwards must reproduce the same pixels');
  const group = { ...sample.shots[4], index: 102, clips: sample.shots[4].clips.map(p => ({ ...p, source: pathToFileURL(clip).href })) };
  assert.deepEqual((await stage.frame(group, 0.5)).times, [0.5, 0.5, 0.5]);
  await writeFile(join(directory, 'planes.png'), await stage.screenshot());
  const card = { ...sample.shots[2], index: 103 };
  assert.equal((await stage.frame(card, 0)).text, 'Canvas');
  const cardImage = await stage.screenshot();
  const pixel = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-i', 'pipe:0', '-vf', 'crop=2:2:10:10', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { input: cardImage });
  assert.equal(pixel.status, 0);
  assert.deepEqual([...pixel.stdout.subarray(0, 3)], [8, 102, 255], 'Card must render Meta blue');
  const list = { ...sample.shots[6], index: 104 };
  assert.equal((await stage.frame(list, 0.9)).text, 'and much more');
  assert.equal((await stage.frame({ ...sample.shots[7], index: 105 }, 1)).text, 'E2A2OThink out loud. Build what you mean.Muse Spark · Muse Image · Muse Voice Transcribe');
  await writeFile(join(directory, 'end.png'), await stage.screenshot());
} finally { await stage.close(); }

const preview = await render([join(here, 'shots.example.json'), '--preview', '--out', join(directory, 'preview.mp4')]);
const probe = file => JSON.parse(run('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file]));
const video = probe(preview.file).streams[0];
assert.equal(video.codec_name, 'h264');
assert.equal(video.width, 960); assert.equal(video.height, 540);
assert.equal(video.r_frame_rate, '15/1'); assert.equal(Number(video.nb_read_frames), preview.frames);
const hd = await render([join(here, 'shots.example.json'), '--from', '0.1', '--to', '0.2', '--out', join(directory, 'hd.mp4')]);
const hdVideo = probe(hd.file).streams[0];
assert.equal(hdVideo.width, 1920); assert.equal(hdVideo.height, 1080);
assert.equal(hdVideo.r_frame_rate, '30/1'); assert.equal(Number(hdVideo.nb_read_frames), 3);

const voice = join(directory, 'voice.wav'), music = join(directory, 'music.wav');
for (const [file, frequency] of [[voice, 440], [music, 220]])
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-n', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=0.5:sample_rate=48000`, file]);
const muxed = join(directory, 'muxed.mp4');
run(process.execPath, [join(here, 'mux.mjs'), preview.file, voice, music, muxed]);
const muxProbe = probe(muxed);
assert.equal(muxProbe.streams.find(s => s.codec_type === 'audio').codec_name, 'aac');
assert.equal(muxProbe.streams.find(s => s.codec_type === 'video').nb_read_frames, video.nb_read_frames);
assert.ok(Math.abs(Number(muxProbe.format.duration) - preview.duration) < 0.08, 'Short audio must preserve picture duration');
console.log(`PASS film: six shot kinds, repeatable seeks, Meta blue pixels, ${preview.frames}-frame preview, HD range, padded AAC mux. Artifacts: ${directory}`);
