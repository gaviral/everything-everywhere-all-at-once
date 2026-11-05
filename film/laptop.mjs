import {smooth,mix} from './motion.mjs';
export async function createLaptop(shot,camera,videos,bounded) {
  const computer=document.createElement('div');computer.className='computer';camera.append(computer);
  const lid=document.createElement('div');lid.className='computer-lid';computer.append(lid);
  const screen=document.createElement('div');screen.className='computer-screen';lid.append(screen);
  const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';screen.append(video);
  const deck=document.createElement('div');deck.className='computer-deck';computer.append(deck);
  const notch=document.createElement('div');notch.className='computer-trackpad';deck.append(notch);
  const ready=new Promise((resolve,reject)=>{video.addEventListener('loadeddata',resolve,{once:true});video.addEventListener('error',()=>reject(Error('Laptop clip failed')),{once:true});});
  video.src=shot.source;await bounded(ready,'Laptop clip timed out');videos.push({video,spec:shot});
  const promise=document.createElement('div');promise.className='product-promise';promise.textContent=shot.promise??'Words and sketches into working software.';camera.append(promise);
  return {computer,screen};
}
export function drawLaptop(nodes,shot,local) {
  const push=shot.phase==='push';const t=smooth(local/(push?1.75:shot.duration));
  const scale=push?mix(1.02,8,t):mix(.62,1.02,t);
  const x=push?mix(0,3640,t):0,y=push?mix(20,1902,t):mix(440,20,t);
  nodes.computer.style.transform=`translate(-50%,-50%) translate(${x}px,${y}px) scale(${scale}) rotateX(${push?mix(1,0,t):mix(18,1,t)}deg) rotateY(${push?mix(-2,0,t):mix(-17,-2,t)}deg) rotateZ(${push?0:mix(-6,0,t)}deg)`;
  return {scale,x,y};
}
