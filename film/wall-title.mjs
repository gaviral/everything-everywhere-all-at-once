import {freezeStill} from './wall-field.mjs';
import {paintTitle,titleCard} from './title-layout.mjs';
const clamp=x=>Math.max(0,Math.min(1,x));
const ease=x=>x*x*(3-2*x);
export function titleMask(columns=64,rows=36) {
  const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
  const context=canvas.getContext('2d',{willReadFrequently:true});paintTitle(context);
  const pixels=context.getImageData(0,0,1920,1080).data,mask=[];
  for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
    let alpha=0,n=0;
    for(let y=Math.floor(row*1080/rows);y<Math.floor((row+1)*1080/rows);y++)
      for(let x=Math.floor(col*1920/columns);x<Math.floor((col+1)*1920/columns);x++){alpha+=pixels[(y*1920+x)*4+3];n++;}
    mask.push(alpha/(n*255)>.17);
  }
  return mask;
}
export function arrangePixels(mask,tiles,columns=64,rows=36) {
  const middle=[Math.floor(columns/2),Math.floor(rows/2)];
  const cells=mask.map((light,i)=>({col:i%columns,row:Math.floor(i/columns),light}));
  cells.sort((a,b)=>Math.hypot(a.col-middle[0],a.row-middle[1])-Math.hypot(b.col-middle[0],b.row-middle[1]));
  const hero=cells.find(c=>c.light===!!tiles[0].light);
  cells.sort((a,b)=>Math.max(Math.abs(a.col-hero.col),Math.abs(a.row-hero.row))-Math.max(Math.abs(b.col-hero.col),Math.abs(b.row-hero.row))||a.row-b.row||a.col-b.col);
  cells.splice(cells.indexOf(hero),1);cells.unshift(hero);
  const pools=[tiles.map((t,i)=>!t.light&&i!==0?i:null).filter(i=>i!==null),tiles.map((t,i)=>t.light&&i!==0?i:null).filter(i=>i!==null)];
  if(pools[0].length+Number(!tiles[0].light)<9||pools[1].length+Number(!!tiles[0].light)<9)throw Error('Title wall requires at least nine distinct dark and light frames');
  const next=[0,0];
  return cells.map((cell,i)=>{
    const pool=+cell.light;
    const source=i===0?0:pools[pool][next[pool]++%pools[pool].length];
    return {...cell,source};
  });
}
export function titleWallFrame(shot,local,hero) {
  const pullEnd=shot.duration-2.8,t=ease(clamp(local/pullEnd));
  const side=30-(shot.gap??.7),[x,y,size]=shot.opening.crop,startScale=size/side;
  const fromX=hero.col*30+(shot.gap??.7)/2+(960-x)/startScale;
  const fromY=hero.row*30+(shot.gap??.7)/2+(540-y)/startScale;
  return {scale:Math.exp(Math.log(startScale)*(1-t)),x:fromX+(960-fromX)*t,y:fromY+(540-fromY)*t,
    crop:ease(clamp(local/.9)),type:ease(clamp((local-(shot.duration-1.55))/.6))};
}
export async function createTitleWall(shot,camera,bounded) {
  const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
  canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Everything Everywhere All at Once, made of recorded app frames');
  Object.assign(canvas.style,{position:'absolute',inset:'0',width:'1920px',height:'1080px'});
  camera.append(canvas);
  const sources=[];
  for(const spec of shot.tiles){const image=new Image();image.src=spec.source;await bounded(image.decode(),'Title wall image load');sources.push(await freezeStill(image));}
  const image=new Image();image.src=shot.opening.source;await bounded(image.decode(),'Title wall opening load');
  const opening=await freezeStill(image),mask=titleMask(),cells=arrangePixels(mask,shot.tiles);
  return {surface:{canvas,context:canvas.getContext('2d',{alpha:false,willReadFrequently:true})},sources,opening,mask,cells,typed:titleCard()};
}
export function drawTitleWall(shot,local,camera,wall) {
  camera.style.transform='none';camera.style.opacity='1';return titleWallFrame(shot,local,wall.cells[0]);
}
export function paintTitleWall(shot,local,wall) {
  const f=titleWallFrame(shot,local,wall.cells[0]),ctx=wall.surface.context,gap=shot.gap??.7,side=30-gap;
  ctx.resetTransform();ctx.globalAlpha=1;ctx.fillStyle='#000';ctx.fillRect(0,0,1920,1080);
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='low';
  ctx.translate(960,540);ctx.scale(f.scale,f.scale);ctx.translate(-f.x,-f.y);
  for(const [i,cell] of wall.cells.entries()){
    if(i===0)continue;
    const x=cell.col*30+gap/2,y=cell.row*30+gap/2;
    if((x+side-f.x)*f.scale < -960||(x-f.x)*f.scale > 960||(y+side-f.y)*f.scale < -540||(y-f.y)*f.scale > 540)continue;
    ctx.drawImage(wall.sources[cell.source],x,y,side,side);
  }
  const hero=wall.cells[0],[cx,cy,s]=shot.opening.crop,x=hero.col*30+gap/2,y=hero.row*30+gap/2,k=1-f.crop;
  ctx.save();ctx.beginPath();ctx.rect(x-cx/s*side*k,y-cy/s*side*k,side+(1920-s)/s*side*k,side+(1080-s)/s*side*k);ctx.clip();
  ctx.drawImage(wall.opening,x-cx/s*side,y-cy/s*side,1920/s*side,1080/s*side);ctx.restore();
  ctx.resetTransform();
  if(local<.15){ctx.globalAlpha=1-local/.15;ctx.drawImage(wall.opening,0,0);ctx.globalAlpha=1;}
  if(f.type){ctx.globalAlpha=f.type;ctx.drawImage(wall.typed,0,0);ctx.globalAlpha=1;}
}
