import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {timeline} from './timeline.mjs';
import {openStage} from './chrome.mjs';
import {cut} from './cut.mjs';
import {run} from './render.mjs';
const file=resolve(process.argv[2]),root=dirname(file),plan=timeline(JSON.parse(await readFile(file,'utf8')));
assert.ok(Math.abs(plan.duration-165.717)<1e-6);assert.equal(new Set(plan.shots.map(s=>s.id)).size,plan.shots.length);
assert.ok(plan.shots.every(s=>!s.label&&!s.caption));assert.equal(plan.shots.reduce((n,s)=>n+s.frames.preview,0),2486);
const out=join(root,'review','film3-check');await mkdir(out,{recursive:true});
function shot(id){const s=structuredClone(plan.shots.find(s=>s.id===id));for(const p of s.kind==='planes'?s.clips:[s])if(p.clip||p.image)p.source=pathToFileURL(resolve(root,p.clip??p.image)).href;return s;}
const stage=await openStage(join(dirname(fileURLToPath(import.meta.url)),'stage.html'),1920,1080);
try{
 let s=shot('01-opening');assert.equal((await stage.frame(s,1)).word.visible,false);assert.equal((await stage.frame(s,1.4)).word.sharp,true);await writeFile(join(out,'opening.png'),await stage.screenshot());
 s=shot('02-first-signature');assert.equal((await stage.frame(s,1.5)).brand.settled,true);await writeFile(join(out,'first-signature.png'),await stage.screenshot());
 s=shot('03-laptop-rise');const early=(await stage.frame(s,0)).laptop;const late=(await stage.frame(s,3.4)).laptop;assert.ok(early.y-late.y>350&&late.scale>early.scale);await writeFile(join(out,'laptop.png'),await stage.screenshot());
 s=shot('04-composer-push');await stage.frame(s,3);await writeFile(join(out,'composer.png'),await stage.screenshot());
 s=shot('29-icon-assembly');assert.equal((await stage.frame(s,.65)).brand.ribbon,0);await writeFile(join(out,'empty-shell.png'),await stage.screenshot());
 assert.ok((await stage.frame(s,1.05)).brand.ribbon>0);await writeFile(join(out,'ribbon.png'),await stage.screenshot());
 assert.ok((await stage.frame(s,1.45)).brand.bead>0);await writeFile(join(out,'bead.png'),await stage.screenshot());
 const end=await stage.frame(s,2.4);assert.equal(end.brand.photo,1);const picture=await stage.screenshot();await writeFile(join(out,'complete.png'),picture);
 const held=await stage.frame(shot('30-final-hold'),2);assert.equal(held.brand.settled,true);assert.ok(held.text.includes('Example project. Sequences shortened. One fault added for the demonstration. Narration AI-generated.'));
 assert.equal(createHash('sha256').update(await stage.screenshot()).digest('hex'),createHash('sha256').update(picture).digest('hex'),'The assembled identity and final hold are identical');
}finally{await stage.close();}
const temp=await mkdtemp(join(out,'clock-'));const clock=join(temp,'shots.json');await writeFile(clock,JSON.stringify({shots:[{id:'clock',kind:'title',words:'Clock',seconds:.177,frames:{preview:3,final:6}}]}));
await cut([clock,'--preview','--out',join(temp,'clock.mp4'),'--cuts-dir',join(temp,'cuts')]);
const info=JSON.parse(run('ffprobe',['-v','error','-show_entries','format=duration','-of','json',join(temp,'clock.mp4')]));assert.equal(Number(info.format.duration),.177);
console.log('PASS film3: word timing, identity assembly and hold, laptop rise/push, no chips, stable ids, exact fractional endpoint.');
