import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {timeline} from './timeline.mjs';
import {openStage} from './chrome.mjs';
import {pngPixels} from './png-pixels.mjs';
import {cut,joinShots} from './cut.mjs';
import {run} from './render.mjs';
const file=resolve(process.argv[2]),root=dirname(file),config=JSON.parse(await readFile(file,'utf8')),plan=timeline(config);
assert.equal(config.name,'Everything Everywhere All at Once');assert.ok(Math.abs(plan.duration-165.717)<1e-6);
assert.equal(new Set(plan.shots.map(s=>s.id)).size,55);assert.equal(plan.shots.reduce((n,s)=>n+s.frames.final,0),4972);
assert.ok(plan.shots.every(s=>!s.disclosure&&!s.label&&!s.caption&&!s.heading));
const out=await mkdtemp(join(root,'review/final-check-'));
for(const s of plan.shots){for(const p of s.kind==='planes'?s.clips:[s])if(p.clip){const v=JSON.parse(run('ffprobe',['-v','error','-show_entries','format=duration','-of','json',resolve(root,p.clip)]));assert.ok((p.start??0)+Math.min(s.duration*(p.rate??1),p.playSeconds??s.duration*(p.rate??1))<=Number(v.format.duration)+1e-5,`${s.id} fits its source`);}}
const stage=await openStage(join(dirname(fileURLToPath(import.meta.url)),'stage.html'),1920,1080);
const ready=s=>({...s,source:s.clip?pathToFileURL(resolve(root,s.clip)).href:undefined});
try{
 const s=ready({...plan.shots.find(s=>s.id==='05-mira-question'),index:900,width:600});await stage.frame(s,1);const png=await stage.screenshot();await writeFile(join(out,'mist.png'),png);
 const rgb=pngPixels(png);const pixel=(x,y)=>[...rgb.subarray(8+(y*1920+x)*3,11+(y*1920+x)*3)];
 for(const [x,y]of [[5,5],[1910,1070]]){const p=pixel(x,y);assert.ok(Math.min(...p)>180&&Math.max(...p)-Math.min(...p)<45,'The stage is quiet mist, not saturated blue');}
 const f=ready(plan.shots.find(s=>s.id==='12b-fault'));await stage.frame(f,.5);await writeFile(join(out,'failed.png'),await stage.screenshot());
 const e=ready(plan.shots.at(-1));const state=await stage.frame(e,7);assert.equal(state.credit,'Muse Spark · Muse Image · Muse Voice Transcribe');assert.ok(!state.text.includes('Example project'));await writeFile(join(out,'ending.png'),await stage.screenshot());
 const brand=await stage.frame({kind:'brand',phase:'hold',duration:1,index:999,disclosure:'Disclosure sentinel'},0);assert.ok(!brand.text.includes('Disclosure sentinel'));
}finally{await stage.close();}
const tiny=join(out,'test.json');await writeFile(tiny,JSON.stringify({shots:[{id:'format',kind:'title',words:'Format',seconds:.177}]}));
await cut([tiny,'--final','--cuts-dir',join(out,'cuts'),'--out',join(out,'format.mp4')]);
const info=JSON.parse(run('ffprobe',['-v','error','-show_streams','-of','json',join(out,'format.mp4')])).streams[0];assert.equal(info.width,1920);assert.equal(info.height,1080);assert.equal(info.r_frame_rate,'30/1');assert.equal(Number(info.duration),.177);
await writeFile(tiny,JSON.stringify({shots:[{id:'single-frame',kind:'title',words:'Frame',seconds:1/30,frames:{final:1}}]}));
const unit=await cut([tiny,'--final','--cuts-dir',join(out,'cuts'),'--out',join(out,'unit.mp4')]);
const joined=join(out,'fractional-concat.mp4');
await joinShots(Array.from({length:55},()=>unit.results[0]),{out:joined,cuts:join(out,'cuts'),fps:30,duration:1.817});
const timing=JSON.parse(run('ffprobe',['-v','error','-show_entries','format=duration','-of','json',joined]));assert.equal(Number(timing.format.duration),1.817);
console.log('PASS final: mist pixels, credit-only ending, source windows, stable ids and 1080p/30 encoder.');
console.log(out);
