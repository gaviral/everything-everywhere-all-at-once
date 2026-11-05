import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cut } from './cut.mjs';
import { run } from './render.mjs';
import { openStage } from './chrome.mjs';

const renderRoot = join(homedir(), 'code', 'e2a2o-media', 'film-1104', 'renders');
await mkdir(renderRoot, { recursive: true });
const root = await mkdtemp(join(renderRoot, 'check-'));
const file = join(root, 'shots.json'), out = join(root, 'preview.mp4'), cuts = join(root, 'cuts');
const shots = [
  { kind: 'title', words: 'First', seconds: .2 },
  { kind: 'title', words: 'Second', seconds: .2 },
  { kind: 'plane', clip: 'clip.mp4', seconds: .2, caption: 'wait shortened', label: 'Example project', crop: [0,0,.5,.5] },
];
const args = [file, '--preview', '--out', out, '--cuts-dir', cuts];
const save = () => writeFile(file, JSON.stringify({ shots }));
await save();
await assert.rejects(cut(args), /1 shot\(s\) failed/);
const failed = JSON.parse(await readFile(`${out}.json`));
assert.equal(failed.results.filter(x => !x.error).length, 2, 'Other shots survive a missing clip');
function footage(colour) {
  run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${colour}:s=320x180:r=30:d=1`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(root, 'clip.mp4')]);
}
footage('red');
const recovered = await cut(args);
assert.deepEqual(recovered.results.map(x => x.reused), [true,true,false]);
const metadata = await Promise.all(recovered.results.map(x => stat(x.file)));
shots[1].words = 'Changed'; await save();
const edited = await cut(args);
assert.deepEqual(edited.results.map(x => x.reused), [true,false,true], 'Only the changed shot renders');
assert.equal((await stat(edited.results[0].file)).mtimeMs, metadata[0].mtimeMs);
await rename(join(root,'clip.mp4'), join(root,'red-original.mp4'));
footage('blue');
const changedClip = await cut(args);
assert.deepEqual(changedClip.results.map(x => x.reused), [true,true,false], 'Same-name changed clip invalidates dependent shot');
const reused = await cut(args);
assert.ok(reused.results.every(x => x.reused), 'An unchanged rerun renders nothing');
const video = JSON.parse(run('ffprobe', ['-v','error','-show_streams','-of','json',out])).streams[0];
assert.equal(video.width,960); assert.equal(video.height,540); assert.equal(video.r_frame_rate,'15/1'); assert.equal(Number(video.nb_frames),9);
shots.splice(0, shots.length, { kind:'title',words:'Final',seconds:.1 }); await save();
await cut([file,'--final','--out',join(root,'final.mp4'),'--cuts-dir',cuts]);
const hd = JSON.parse(run('ffprobe',['-v','error','-show_streams','-of','json',join(root,'final.mp4')])).streams[0];
assert.equal(hd.width,1920); assert.equal(hd.height,1080); assert.equal(hd.r_frame_rate,'30/1'); assert.equal(Number(hd.nb_frames),3);
const stage = await openStage(join(dirname(fileURLToPath(import.meta.url)), 'stage.html'), 960,540);
try {
  const shot = {kind:'plane',seconds:1,duration:1,index:100,source:pathToFileURL(join(root,'clip.mp4')).href,crop:[0,0,.5,.5],label:'Example project',caption:'wait shortened'};
  await stage.frame(shot,0);
  const screenshot = await stage.screenshot();
  await stage.frame({...shot,index:101,caption:undefined,label:undefined},0);
  assert.deepEqual(await stage.screenshot(),screenshot,'Per-shot chips are no longer displayed');
  await stage.frame({...shot,index:102,crop:undefined},0);
  assert.notDeepEqual(await stage.screenshot(),screenshot,'Cropping changes the visible composition');
} finally { await stage.close(); }
console.log('PASS isolated failure recovery, cache reuse, shot/clip invalidation, stream-copy join, captions/crop, preview/final profiles.');
