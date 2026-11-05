export const clamp = x => Math.max(0, Math.min(1, x));
export const smooth = x => { const t=clamp(x); return t*t*(3-2*t); };
export const mix = (a,b,t) => a+(b-a)*t;
export function wordMotion(node, local, {delay=0, entrance=.15, duration=1, shrink=false}={}) {
  const t=clamp((local-delay)/entrance);
  node.style.opacity=local<delay?'0':'1';
  node.style.filter=`blur(${18*(1-smooth(t))}px)`;
  let scale=1;
  if(shrink) scale=mix(1,.10,smooth((local-duration+.48)/.48));
  node.style.transform=`scale(${mix(.42,1,smooth(t))*scale},${mix(.76,1,smooth(t))*scale})`;
  return {visible:local>=delay,sharp:t===1,scale};
}
