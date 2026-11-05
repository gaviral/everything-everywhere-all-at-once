import {clamp,smooth,mix} from './motion.mjs';
export function createBrand(shot,camera) {
  const box=document.createElement('div');box.className='signature';camera.append(box);
  const icon=document.createElement('div');icon.className='signature-icon';box.append(icon);
  const doc=new DOMParser().parseFromString(window.filmBrandSvg,'image/svg+xml');
  const svg=document.importNode(doc.documentElement,true);svg.removeAttribute('width');svg.removeAttribute('height');
  svg.querySelector('title')?.remove();svg.classList.add('signature-svg');icon.append(svg);
  const ribbon=svg.querySelector('path[stroke]'), bead=svg.querySelector('circle');
  const length=ribbon.getTotalLength();ribbon.style.strokeDasharray=String(length);
  const photo=document.createElement('img');photo.src='../ui/public/icons/icon-512.png';photo.className='signature-photo';photo.alt='';icon.append(photo);
  const glint=document.createElement('div');glint.className='signature-glint';icon.append(glint);
  const name=document.createElement('div');name.className='signature-name';name.textContent=shot.word??'E2A2O';box.append(name);
  const tagline=document.createElement('div');tagline.className='signature-tagline';tagline.textContent=shot.tagline??'Think out loud. Build what you mean.';box.append(tagline);
  const credits=document.createElement('div');credits.className='signature-credits';credits.textContent=shot.credits??'Muse Spark · Muse Image · Muse Voice Transcribe';camera.append(credits);
  return {box,icon,svg,ribbon,bead,length,photo,glint,name,tagline,credits};
}
export function drawBrand(nodes,shot,local) {
  const opening=shot.phase==='opening';
  const hold=shot.phase==='hold'||shot.kind==='end';
  const t=hold?2.4:local;
  const shell=smooth(t/.58), ribbon=opening?1:smooth((t-.80)/.43), bead=opening?1:smooth((t-1.22)/.38);
  const nameAt=opening ? .52 : 1.68, nameProgress=smooth((t-nameAt)/(opening ? .42 : .48));
  const slide=smooth((t-nameAt)/.34);
  const width=nodes.name.offsetWidth;
  const finalX=-(width+42)/2;
  const overshoot=-4*Math.sin(Math.PI*clamp((t-nameAt-.34)/.18));
  const wobble=opening?Math.sin(t*15)*7*Math.exp(-t*7):Math.sin(clamp((t-.48)/.3)*Math.PI)*3;
  const shellY=opening?mix(-42,0,smooth(t/.38)):mix(-290,0,shell);
  const rotation=opening?wobble:mix(-25,0,shell)+wobble;
  nodes.icon.style.transform=`translate(-50%,-50%) translate(${finalX*slide+overshoot}px,${shellY}px) rotate(${rotation}deg) scale(${mix(.72,1,shell)})`;
  nodes.icon.style.opacity=String(opening?1:clamp(t/.1));
  nodes.ribbon.style.strokeDashoffset=String(nodes.length*(1-ribbon));
  nodes.ribbon.style.opacity=String(ribbon>0?1:0);
  const bounce=bead<1?mix(-17,0,bead): -1.25*Math.sin(Math.PI*clamp((t-1.60)/.24));
  nodes.bead.style.opacity=String(bead>0?1:0);nodes.bead.style.transform=`translateY(${bounce}px)`;
  const photo=opening?1:smooth((t-2.10)/.28);
  nodes.photo.style.opacity=String(photo);nodes.svg.style.opacity=String(1-photo);
  nodes.glint.style.opacity=String(opening?0:Math.max(0,Math.sin(Math.PI*clamp((t-1.57)/.24)))*.85);
  nodes.name.style.left=`calc(50% + ${(220+42-width)/2}px)`;
  nodes.name.style.opacity=String(nameProgress);nodes.name.style.clipPath=`inset(0 ${100*(1-nameProgress)}% 0 0)`;
  nodes.name.style.filter=`blur(${20*(1-nameProgress)}px)`;
  nodes.name.style.transform=`translateY(-50%) scaleX(${mix(.58,1,nameProgress)})`;
  nodes.tagline.style.opacity=String(opening?0:smooth((t-2.02)/.30));
  nodes.credits.style.display=opening?'none':'block';
  return {ribbon,bead,photo,nameVisible:nameProgress,settled:opening?t>=1.1:t>=2.4,shellY};
}
