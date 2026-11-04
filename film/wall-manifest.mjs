// Build a portable shot list beside external captures; never copies media into the repo.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join, relative, dirname } from 'node:path';
const [wallArg, clipsArg, outputArg] = process.argv.slice(2);
if (!wallArg || !clipsArg || !outputArg) throw Error('Usage: node film/wall-manifest.mjs WALL_DIR CLIPS_DIR OUTPUT.json');
const wall = resolve(wallArg), clips = resolve(clipsArg), output = resolve(outputArg);
const report = JSON.parse(await readFile(join(wall, 'capture.json')));
const path = file => relative(dirname(output), file);
const names = (await readdir(clips)).filter(n => n.endsWith('.mp4')).sort();
if (!names.includes('think.mp4')) throw Error('The opening think.mp4 capture is required');
// Keep the actual result arriving inside each loop, rather than looping setup or service waits.
const excerpts = { think: [2, 6], ask: [2.4, 6.4], draw: [22.5, 7], 'draw-back': [10.5, 3.5],
  crew: [12.5, 5.5], 'crew-more': [29, 5.5], flow: [28.5, 7.5], parts: [1, 8] };
const order = ['think.mp4', 'draw.mp4', 'crew.mp4', 'parts.mp4', 'ask.mp4', 'flow.mp4', 'draw-back.mp4', 'crew-more.mp4'];
const ordered = [...order.filter(n => names.includes(n)), ...names.filter(n => !order.includes(n))];
const clip = name => {
  const [start, loopSeconds] = excerpts[name.replace(/\.mp4$/, '')] ?? [0, 4];
  return { clip: path(join(clips, name)), start, loopSeconds };
};
const tiles = [...ordered.map(clip),
  ...report.features.filter(f => f.status === 'captured').map(f => ({ image: path(join(wall, f.file)), id: f.id }))];
await writeFile(output, JSON.stringify({ shots: [{ kind: 'wall', seconds: 8, tiles }] }, null, 2) + '\n');
console.log(`Wall shot: ${tiles.length} real tiles, ${names.length} looping clips, 8 seconds`);
