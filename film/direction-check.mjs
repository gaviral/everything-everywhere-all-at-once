import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {timeline} from './timeline.mjs';
import {openStage} from './chrome.mjs';

const config=resolve(process.argv[2]);
const plan=timeline(JSON.parse(await readFile(config,'utf8')));
assert.equal(plan.duration,150);
assert.equal(new Set(plan.shots.map(s=>s.id)).size,plan.shots.length,'Every shot has a unique stable id');
assert.equal(plan.shots.reduce((n,s)=>n+s.frames.preview,0),2250);
assert.equal(plan.shots.reduce((n,s)=>n+s.frames.final,0),4500);
for(const [id,at] of Object.entries({'chapter-say':10,'chapter-draw':28,'chapter-build':50,'chapter-fix':76,'chapter-reuse':88,'chapter-use':104,'end-logo':138}))
 assert.ok(Math.abs(plan.shots.find(s=>s.id===id).at-at)<1e-6,`${id} starts at ${at}s`);
assert.throws(()=>timeline({shots:[{kind:'plane',seconds:1,clip:'x',tiltTo:[0,1]}]}));
const folder=join(dirname(config),'review','direction-check');await mkdir(folder,{recursive:true});
const stage=await openStage(join(dirname(fileURLToPath(import.meta.url)),'stage.html'),1920,1080);
try {
 const shot=structuredClone(plan.shots.find(s=>s.kind==='plane'));
 shot.source=pathToFileURL(resolve(dirname(config),shot.clip)).href;
 const entry=await stage.frame(shot,0);
 assert.ok(Math.max(...entry.tilts[0].map(Math.abs))>=16);
 const reading=await stage.frame(shot,.8);
 assert.ok(reading.tilts[0].every(n=>Math.abs(n)<3),'The plane settles before reading');
 const image=await stage.screenshot();await writeFile(join(folder,'reading.png'),image);
 await stage.frame(shot,0);await stage.frame(shot,.8);
 assert.deepEqual(await stage.screenshot(),image,'Backward seeking reproduces pose, video and camera');
 const end=plan.shots.at(-1);const frame=await stage.frame(end,1);
 assert.equal(frame.text,'E2A2OThink out loud. Build what you mean.Muse Spark · Muse Image · Muse Voice Transcribe · AI-generated narration using Deepgram Aura');
 await writeFile(join(folder,'end.png'),await stage.screenshot());
}finally {await stage.close();}
console.log('PASS directed film: tilt entrance/settling, repeatable camera, end typography, stable ids, exact 150s/2250/4500 frames and chapter clocks.');
