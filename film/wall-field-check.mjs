import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve,dirname,join } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { mosaicCells,fieldFrame } from './wall-field.mjs';
import { timeline } from './timeline.mjs';
import { openStage } from './chrome.mjs';
import { createHash } from 'node:crypto';
import { pngPixels } from './png-pixels.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const samePixels = (actual, expected, message) => assert.equal(digest(pngPixels(actual)),digest(pngPixels(expected)),message);

const config=resolve(process.argv[2]);
const shot=timeline(JSON.parse(await readFile(config))).shots[0];
assert.equal(shot.layout,'field');assert.ok(shot.tiles.length>=200&&shot.tiles.length<=300);
const cells=mosaicCells(shot.tiles.length), coverage=Array(32*18).fill(0);
for(const [x,y,span] of cells) {
  assert.ok(span===1||span===.5);
  for(let yy=y*2;yy<(y+span)*2;yy++)for(let xx=x*2;xx<(x+span)*2;xx++)coverage[yy*32+xx]++;
}
assert.ok(coverage.every(n=>n===1),'The full 16:9 field is covered once, with no holes or overlaps');
assert.deepEqual(cells.slice(0,3),[[8,4,1],[7,4,1],[9,4,1]]);
let before=Infinity;
for(let i=0;i<=110;i++) {const f=fieldFrame(shot,i/10);assert.ok(f.scale<=before+1e-9);before=f.scale;}
assert.equal(fieldFrame(shot,11).scale,1);
assert.equal(fieldFrame(shot,11.99).white,0);
assert.equal(fieldFrame(shot,13).white,1);
assert.equal(new Set(shot.tiles.map(t=>t.clip??t.image)).size,shot.tiles.length,'Every tile uses a distinct recorded frame or clip');
for(const tile of shot.tiles)tile.source=pathToFileURL(resolve(dirname(config),tile.clip??tile.image)).href;
shot.opening.source=pathToFileURL(resolve(dirname(config),shot.opening.image)).href;
const output=join(dirname(config),'wall-2-review');await mkdir(output,{recursive:true});
const stage=await openStage(fileURLToPath(new URL('stage.html',import.meta.url)),1920,1080);
try {
  for(const [i,time] of [0,3,5,7,9,11,12,12.99].entries()) {
    const state=await stage.frame(shot,time);
    await writeFile(join(output,`${i}.png`),await stage.screenshot());
    if(i===0){await stage.frame(shot,3);await stage.frame(shot,0);samePixels(await stage.screenshot(),await readFile(join(output,'0.png')),'Reverse seek reproduces the opening');}
  }
  for(const [i,time] of [[3,7],[4,9],[5,11]]) {
    await stage.frame(shot,time);
    samePixels(await stage.screenshot(),await readFile(join(output,`${i}.png`)),'Repeated dense-field seeks reproduce the same pixels');
  }
  for(let frame=0;frame<=330;frame++) {
    await stage.frame(shot,frame/30);
    if(frame===150||frame===210||frame===270||frame===330){
      const i=new Map([[150,2],[210,3],[270,4],[330,5]]).get(frame);
      samePixels(await stage.screenshot(),await readFile(join(output,`${i}.png`)),'Sequential rendering and direct seeks use identical sampling');
    }
  }
  assert.equal(await stage.evaluate('document.querySelector("canvas[role=img]").getAttribute("aria-label")'),'Feature wall');
} finally {await stage.close();}
const fresh=await openStage(fileURLToPath(new URL('stage.html',import.meta.url)),1920,1080);
try {
  for(const [i,time] of [[0,0],[2,5],[4,9],[5,11]]){
    await fresh.frame(shot,time);
    const actual=await fresh.screenshot();await writeFile(join(output,`fresh-${i}.png`),actual);
    samePixels(actual,await readFile(join(output,`${i}.png`)),'Fresh renderer exports identical wall pixels');
  }
} finally {await fresh.close();}
console.log(`PASS field: ${shot.tiles.length} distinct tiles; exact square coverage; continuous pull-back; one-second hold; white finish; eight HD review frames`);
