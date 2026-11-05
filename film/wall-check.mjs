import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openStage } from './chrome.mjs';
import { timeline, frameRange } from './timeline.mjs';
import { wallPosition, wallFrame } from './wall.mjs';
import { run, render } from './render.mjs';
import { pngPixels } from './png-pixels.mjs';

const pixelsHash = png => createHash('sha256').update(pngPixels(png)).digest('hex');

const directory = await mkdtemp(join(tmpdir(), 'wall-check-'));
const clip = join(directory, 'motion.mp4'), still = join(directory, 'still.png');
run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=1', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip]);
run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=320x180', '-frames:v', '1', still]);
const tiles = Array.from({ length: 122 }, (_, i) => i < 2 ? { clip, source: pathToFileURL(clip).href, loopSeconds: 1 } : { image: still, source: pathToFileURL(still).href });
const shot = timeline({ shots: [{ kind: 'wall', seconds: 8, tiles }] }).shots[0];
assert.equal(new Set(tiles.map((_, i) => JSON.stringify(wallPosition(i)))).size, 122);
assert.deepEqual(wallPosition(64), { x: 8, y: 0 });
assert.deepEqual(wallPosition(100), { x: 12, y: 4 });
for (const [time, count] of [[0, 1], [1.6, 4], [3.2, 16], [4.96, 64], [6.56, 122]]) {
  assert.ok(Math.abs(wallFrame(122, time).visible - count) < 1e-6);
}
assert.equal(wallFrame(122, 7.99).opacity, 0, 'Wall ends on black before the next logo shot');
assert.throws(() => timeline({ shots: [{ kind: 'wall', seconds: 8, tiles: [{ image: still }] }] }));
const stage = await openStage(fileURLToPath(new URL('stage.html', import.meta.url)), 960, 540);
try {
  await stage.frame(shot, .3); const first = await stage.screenshot();
  await stage.frame(shot, .6); assert.notEqual(pixelsHash(await stage.screenshot()), pixelsHash(first), 'Opening clip moves');
  assert.ok((await stage.frame(shot, 1.3)).times.every(t => Math.abs(t - .3) < 1e-6), 'Clips loop using frame time');
  await stage.frame(shot, .3); assert.equal(pixelsHash(await stage.screenshot()), pixelsHash(first), 'Reverse seeking reproduces pixels');
  await stage.frame(shot, 6.8); await writeFile(join(directory, 'all-tiles.png'), await stage.screenshot());
  await stage.frame(shot, 7.99);
  const black = await stage.screenshot();
  const blackFile = join(directory, 'black.png');
  await writeFile(blackFile, black);
  const pixels = run('ffmpeg', ['-v', 'error', '-i', blackFile, '-vf', 'scale=16:9', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
  assert.ok([...pixels].every(p => p === '\0'), 'Final wall frame is black, with no logo yet');
} finally { await stage.close(); }
// A short exported range proves frame completeness without rerendering all eight seconds.
const config = join(directory, 'shots.json');
await writeFile(config, JSON.stringify({ shots: [{ kind: 'wall', seconds: 8, tiles: tiles.map(({ source, ...t }) => t) }] }));
const rendered = await render([config, '--from', '7.9', '--to', '8', '--out', join(directory, 'wall.mp4')]);
const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', rendered.file])).streams[0];
assert.equal(Number(probe.nb_read_frames), frameRange(8, 30, 7.9, 8).count);
assert.equal(probe.width, 1920); assert.equal(probe.height, 1080);
console.log(`PASS wall: 122 unique tiles; 1/4/16/64/all reveal; repeatable loop seeks; 3/3 HD frames. ${directory}`);
