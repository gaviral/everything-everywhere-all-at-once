// A finite, full-bleed field. Every location is occupied once; activity states
// follow a centre-out path, so the first three and nine are neighbours.
export function fieldSlots(columns, rows) {
  const cx = Math.floor(columns / 2), cy = Math.floor(rows / 2);
  const first = [[cx,cy], [cx-1,cy], [cx+1,cy]];
  const cells = [];
  for (let y=0;y<rows;y++) for(let x=0;x<columns;x++) cells.push([x,y]);
  const distance = ([x,y]) => Math.max(Math.abs(x-cx),Math.abs(y-cy));
  cells.sort((a,b)=>distance(a)-distance(b)||Math.atan2(a[1]-cy,a[0]-cx)-Math.atan2(b[1]-cy,b[0]-cx));
  return [...first,...cells.filter(([x,y])=>!first.some(([a,b])=>a===x&&b===y))];
}
export function mosaicCells(count) {
  if(count<144||(count-144)%3)throw Error('Mosaic count must be 144 plus complete four-square clusters');
  const slots=fieldSlots(16,9), split=(count-144)/3;
  const divided=new Set((split?slots.slice(-split):[]).map(([x,y])=>`${x}:${y}`));
  return slots.flatMap(([x,y])=>divided.has(`${x}:${y}`)?[[x,y,.5],[x+.5,y,.5],[x,y+.5,.5],[x+.5,y+.5,.5]]:[[x,y,1]]);
}
const smooth=t=>t*t*(3-2*t);
export function fieldFrame(shot, local) {
  const pull = Math.max(0,Math.min(1,local/(shot.duration-2)));
  const t=smooth(pull), gap=shot.gap??2, unit=120;
  const w=unit-gap,h=w;
  const [x,y]=mosaicCells(shot.tiles.length)[0];
  const [cropX,cropY,side]=shot.opening.crop;
  const startScale=side/w;
  const startX=x*unit+gap/2+(960-cropX)/startScale;
  const startY=y*unit+gap/2+(540-cropY)/startScale;
  return {w,h,gap,scale:Math.exp(Math.log(startScale)*(1-t)),
    x:startX+(960-startX)*t,y:startY+(540-startY)*t,
    visible:Math.exp(Math.log(shot.tiles.length)*t),
    crop:smooth(Math.min(1,local/1.25)),
    white:smooth(Math.max(0,Math.min(1,(local-(shot.duration-1))/.9)))};
}
export async function createField(shot,camera,videos,bounded) {
  const {w,gap}=fieldFrame(shot,0), slots=mosaicCells(shot.tiles.length);
  const nodes=[];
  const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
  Object.assign(canvas.style,{position:'absolute',inset:'0',width:'1920px',height:'1080px'});
  camera.append(canvas);
  nodes.surface={canvas,context:canvas.getContext('2d',{alpha:false,willReadFrequently:true})};
  for(let i=0;i<shot.tiles.length;i++) {
    const spec=shot.tiles[i],node=document.createElement('div'),[x,y,span]=slots[i];
    node.className='wall-field-tile';
    node.style.display='none';
    Object.assign(node.style,{left:`${x*120+gap/2}px`,top:`${y*120+gap/2}px`,width:`${span*120-gap}px`,height:`${span*120-gap}px`});
    const media=document.createElement(spec.clip?'video':'img');
    node.append(media);camera.append(node);
    if(spec.clip) {
      media.muted=true;media.playsInline=true;media.preload='auto';
      const ready=new Promise((resolve,reject)=>{media.onloadeddata=resolve;media.onerror=()=>reject(Error('Field video failed'));});
      media.src=spec.source;await bounded(ready,'Field video load timed out');
      videos.push({video:media,spec:{...spec,loop:true}});
    } else {media.src=spec.source;await bounded(media.decode(),'Field still load timed out');}
    if(i===0) {
      const [cx,cy,side]=shot.opening.crop;
      media.src=shot.opening.source;
      await bounded(media.decode(),'Opening board load timed out');
      Object.assign(media.style,{position:'absolute',left:`${-cx/side*w}px`,top:`${-cy/side*w}px`,width:`${1920/side*w}px`,height:`${1080/side*w}px`,maxWidth:'none'});
    }
    nodes.push(node);
  }
  return nodes;
}
export function drawField(shot,local,camera,nodes) {
  const frame=fieldFrame(shot,local);
  camera.style.transformOrigin='0 0';
  camera.style.transform='none';camera.style.opacity='1';
  return frame;
}

// Paint only after all video seeks finish. A software-backed canvas avoids
// Chromium changing CSS image mip levels according to earlier camera frames.
export function paintField(shot,local,nodes) {
  const f=fieldFrame(shot,local),ctx=nodes.surface.context,cells=mosaicCells(nodes.length);
  ctx.resetTransform();ctx.globalAlpha=1;ctx.fillStyle='#fff';ctx.fillRect(0,0,1920,1080);
  // Fixed bilinear sampling avoids the history-dependent mip selection used
  // by the browser's adaptive high-quality downsampler.
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='low';
  ctx.translate(960,540);ctx.scale(f.scale,f.scale);ctx.translate(-f.x,-f.y);
  nodes.forEach((node,i)=>{
    const opacity=Math.max(0,Math.min(1,f.visible-i))*(1-f.white);
    if(!opacity)return;
    const [x,y,span]=cells[i],left=x*120+f.gap/2,top=y*120+f.gap/2,size=span*120-f.gap;
    ctx.save();ctx.globalAlpha=opacity;
    if(i===0) {
      const [cx,cy,side]=shot.opening.crop,k=1-f.crop,w=f.w;
      ctx.beginPath();ctx.rect(left-cx/side*w*k,top-cy/side*w*k,w+(1920-side)/side*w*k,w+(1080-side)/side*w*k);ctx.clip();
      ctx.drawImage(node.firstChild,left-cx/side*w,top-cy/side*w,1920/side*w,1080/side*w);
    } else ctx.drawImage(node.firstChild,left,top,size,size);
    ctx.restore();
  });
}
