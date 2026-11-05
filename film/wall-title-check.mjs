import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {openStage} from './chrome.mjs';
import {timeline} from './timeline.mjs';
import {pngPixels} from './png-pixels.mjs';
const file=resolve(process.argv[2]),root=dirname(file),out=join(root,'wall-3-review');await mkdir(out,{recursive:true});
const shot=timeline(JSON.parse(await readFile(file))).shots[0];
for(const tile of shot.tiles)tile.source=pathToFileURL(resolve(root,tile.image)).href;
shot.opening.source=pathToFileURL(resolve(root,shot.opening.image)).href;
const stage=await openStage(fileURLToPath(new URL('stage.html',import.meta.url)),1920,1080);
const hash=b=>createHash('sha256').update(pngPixels(b)).digest('hex');
try {
  for(const [i,time] of [0,2,4,6,8,10.8,12,419/30].entries()){
    await stage.frame(shot,time);await writeFile(join(out,`${i}.png`),await stage.screenshot());
  }
  const state=await stage.evaluate(`(()=>{
    const c=document.querySelector('canvas[role=img]'),ctx=c.getContext('2d'),p=ctx.getImageData(0,0,1920,1080).data;
    return {name:c.getAttribute('aria-label')};
  })()`);
  assert.match(state.name,/Everything Everywhere All at Once/);
  await stage.frame(shot,2);const early=await stage.screenshot();
  await stage.frame(shot,12);await stage.frame(shot,2);assert.equal(hash(await stage.screenshot()),hash(early),'Backward seek is exact');
  await stage.frame(shot,12);
  const plan=await stage.evaluate(`(async()=>{
    const {titleMask,arrangePixels}=await import('./wall-title.mjs');const mask=titleMask(),cells=arrangePixels(mask,${JSON.stringify(shot.tiles)});
    const pixels=document.querySelector('canvas[role=img]').getContext('2d').getImageData(0,0,1920,1080).data;
    const sums=[0,0],counts=[0,0];let rows=0,previous=false;
    for(let row=0;row<36;row++){
      const occupied=mask.slice(row*64,(row+1)*64).some(Boolean);if(occupied&&!previous)rows++;previous=occupied;
      for(let col=0;col<64;col++)for(let y=row*30+1;y<row*30+29;y++)for(let x=col*30+1;x<col*30+29;x++){
        const i=(y*1920+x)*4,k=+mask[row*64+col];sums[k]+=(pixels[i]+pixels[i+1]+pixels[i+2])/3;counts[k]++;
      }
    }
    return {cells:cells.length,firstNine:new Set(cells.slice(0,9).map(c=>c.source)).size,rows,contrast:sums[1]/counts[1]-sums[0]/counts[0]};
  })()`);
  assert.equal(plan.cells,2304);assert.equal(plan.firstNine,9);assert.equal(plan.rows,3);
  assert.ok(plan.contrast>100,'Light app frames visibly form letters against dark app frames');
  await stage.frame(shot,419/30);const ending=await stage.screenshot();
  const handoff=timeline(JSON.parse(await readFile(join(root,'wall-3-handoff.json')))).shots[0];handoff.index=20;
  await stage.frame(handoff,0);assert.equal(hash(await stage.screenshot()),hash(ending),'Wall ending exactly matches the type animation opening');
  await stage.frame(handoff,1.20);
  assert.equal(await stage.evaluate('document.querySelector(".tm-letters").textContent'),'EEAAO','Only the five initials remain after the other letters fall');
  await writeFile(join(out,'initials.png'),await stage.screenshot());
} finally {await stage.close();}
const fresh=await openStage(fileURLToPath(new URL('stage.html',import.meta.url)),1920,1080);
try {
  for(const [i,time] of [[6,12],[7,419/30]]) {
    await fresh.frame(shot,time);
    assert.equal(hash(await fresh.screenshot()),hash(await readFile(join(out,`${i}.png`))),'Fresh renderer reproduces title pixels');
  }
} finally {await fresh.close();}
console.log('PASS title wall: 2,304 real-frame pixels; distinct opening; title contrast; exact seek and type handoff; falling initials');
