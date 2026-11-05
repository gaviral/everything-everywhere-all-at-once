// One clock, in seconds. Recompute every pose, including on a backward seek.
import { TITLE_FONT, titleLayout, titleCard, paintRecorded } from './title-layout.mjs';
const clamp = n => Math.max(0, Math.min(1, n));
const mix = (a, b, t) => a + (b - a) * t;
const phase = (t, a, b) => clamp((t - a) / (b - a));
const smooth = t => t * t * (3 - 2 * t);
const settle = t => t === 1 ? 1 : 1 - (1 - t) ** 3 * Math.cos(t * Math.PI * 1.6);
const NS = 'http://www.w3.org/2000/svg';
const FONT = TITLE_FONT;
const SIZE = 248;
const PIXEL = SIZE / 32;
const TITLE_WIDTH = 1280;
const TAGLINE = 'Think out loud. Build what you mean.';
const clocks = {
  short: { seconds: 5.2, words: [.08, .34, .60], fall: 1.30, gather: [1.57, 2.08], fold: [2.12, 2.42],
    morph: [2.94, 3.23], drop: [3.23, 3.55], bounce: [3.55, 3.88], shell: [3.77, 4.16],
    ribbon: [4.02, 4.36], glass: [4.34, 4.58], name: [4.33, 4.70] },
  long: { seconds: 8, words: [.18, .65, 1.12], fall: 2.18, gather: [2.47, 3.10], fold: [3.22, 3.56],
    morph: [4.08, 4.42], drop: [4.42, 4.81], bounce: [4.81, 5.22], shell: [5.11, 5.59],
    ribbon: [5.41, 5.87], glass: [5.82, 6.14], name: [5.85, 6.36], tagline: [6.51, 6.89] },
};

function element(tag, className, parent, text = '') {
  const node = document.createElement(tag);
  node.className = className; node.textContent = text; parent.append(node);
  return node;
}
function svgElement(tag, attributes = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}
function bitmap(parent, className) {
  const node = element('canvas', `tm-bitmap ${className}`, parent);
  node.width = 1920; node.height = 1080;
  // Fixed-resolution software paint avoids history-dependent compositor resampling.
  return { node, context: node.getContext('2d', { willReadFrequently: true }) };
}
function installStyle() {
  if (document.getElementById('titlemorph-style')) return;
  const style = element('style', '', document.head); style.id = 'titlemorph-style';
  style.textContent = `
    .titlemorph { position:absolute;inset:0;overflow:hidden;perspective:1800px; }
    .tm-icon { position:absolute;left:0;top:0;width:${SIZE}px;height:${SIZE}px;transform-origin:50% 50%; }
    .tm-icon svg { position:absolute;inset:0;width:100%;height:100%;overflow:visible; }
    .tm-bitmap { position:absolute;left:0;top:0;width:1920px;height:1080px; }
    .tm-tagline { position:absolute;top:690px;left:0;width:1920px;text-align:center;font-size:52px;font-weight:500;letter-spacing:-.035em;line-height:1.2; }
    .tm-shadow { position:absolute;width:112px;height:18px;border-radius:50%;background:#000;filter:blur(9px);transform-origin:center; }
  `;
}
function fitInitials(context, fontSize, poses, glyphs) {
  const ratio = fontSize / 120;
  const bounds = poses.map(([x, , scale], i) => {
    const ink = context.measureText(glyphs[i]);
    return [x * ratio - ink.actualBoundingBoxLeft * scale, x * ratio + ink.actualBoundingBoxRight * scale];
  });
  const left = Math.min(...bounds.map(b => b[0])), right = Math.max(...bounds.map(b => b[1]));
  const factor = TITLE_WIDTH / (right - left), centre = (left + right) / 2;
  return poses.map(([x, y, scale]) => ({ x: 960 + (x * ratio - centre) * factor, y: 540 + y * ratio * factor, scale: scale * factor }));
}
function makeLetters(parent) {
  const layer = bitmap(parent, 'tm-letters'), context = layer.context;
  const selected = [[0], [0], [0, 4, 7]];
  const {fontSize,letters:positions}=titleLayout(context);
  const gathered = fitInitials(context, fontSize, [[-272, 0, 1], [-136, 0, 1], [0, 0, 1], [136, 0, 1], [272, 0, 1]], 'EEAAO');
  const folded = fitInitials(context, fontSize, [[-213, 0, 1], [-146, -47, .43], [3, 0, 1], [70, -47, .43], [220, 0, 1]], 'E2A2O');
  let initial = 0;
  const letters=positions.map(letter=>({...letter,initial:selected[letter.row].includes(letter.index)?initial++:-1}));
  return { ...layer, letters, gathered, folded };
}
function makeGradient(defs, id, stops, attributes) {
  const gradient = svgElement('radialGradient', { id, ...attributes });
  for (const [offset, colour] of stops) gradient.append(svgElement('stop', { offset, 'stop-color': colour }));
  defs.append(gradient);
}
async function makeIcon(parent) {
  // Read the identity itself: no hand-traced approximation of ribbon or shell.
  const response = await fetch(new URL('../ui/public/icon.svg', import.meta.url));
  if (!response.ok) throw new Error('Title morph needs the identity SVG');
  const original = new DOMParser().parseFromString(await response.text(), 'image/svg+xml').documentElement;
  const root = element('div', 'tm-icon', parent);
  const svg = svgElement('svg', { viewBox: '0 0 32 32', 'aria-hidden': 'true' });
  const defs = original.querySelector('defs').cloneNode(true); svg.append(defs);
  const shell = original.querySelector('svg > g').cloneNode(true);
  const mark = shell.querySelector('g');
  const ribbon = mark.querySelector('path');
  const sphere = mark.querySelector('circle');
  sphere.classList.add('tm-bead');
  mark.remove();
  makeGradient(defs, 'tm-blue', [['0%', '#39b6ff'], ['55%', '#078dff'], ['100%', '#0064e9']], { cx: '.3', cy: '.05', r: '1.12' });
  makeGradient(defs, 'tm-gold', [['0%', '#fff2b6'], ['38%', '#ffd16e'], ['78%', '#eda52c'], ['100%', '#cc7a0c']], { cx: '.32', cy: '.65', r: '.8' });
  shell.firstElementChild.setAttribute('fill', 'url(#tm-blue)');
  shell.style.filter = 'drop-shadow(0 .25px .4px #0045a844)';
  const shellPose = svgElement('g'); shellPose.append(shell); svg.append(shellPose);
  const ribbonPose = svgElement('g');
  const ribbonMirror = svgElement('g', { transform: mark.getAttribute('transform') });
  ribbonMirror.append(ribbon); ribbonPose.append(ribbonMirror); svg.append(ribbonPose);
  const length = ribbon.getTotalLength(); ribbon.style.strokeDasharray = `${length} ${length}`;
  const beadPose = svgElement('g');
  const beadMirror = svgElement('g', { transform: mark.getAttribute('transform') });
  sphere.setAttribute('fill', 'url(#tm-gold)'); beadMirror.append(sphere); beadPose.append(beadMirror);
  const glint = svgElement('ellipse', { cx: '21.95', cy: '14.35', rx: '.70', ry: '.34', fill: '#fff', transform: 'rotate(38 21.95 14.35)' });
  beadPose.append(glint); svg.append(beadPose); root.append(svg);
  const photograph = new Image(); photograph.src = new URL('../ui/public/icons/icon-512.png', import.meta.url).href;
  await photograph.decode();
  const glass = bitmap(parent, 'tm-glass');
  return { root, svg, shellPose, ribbonPose, ribbon, length, beadPose, glint, glass, photograph };
}
function drawLetters(layer, t, clock, colour) {
  const paint = layer.context, visible = [];
  paint.clearRect(0, 0, 1920, 1080); paint.fillStyle = colour;
  const gather = settle(phase(t, ...clock.gather));
  const fold = smooth(phase(t, ...clock.fold));
  const morph = smooth(phase(t, ...clock.morph));
  for (const letter of layer.letters) {
    const entry = settle(phase(t, clock.words[letter.row], clock.words[letter.row] + .29));
    let x = letter.x, y = letter.y + (1 - entry) * 26, scale = 1, angle = 0;
    let opacity = phase(t, clock.words[letter.row], clock.words[letter.row] + .13);
    let digit = 0;
    if (letter.initial < 0) {
      const delay = ((letter.index * 7 + letter.row * 3) % 9) * .015;
      const falling = Math.max(0, t - clock.fall - delay);
      y += -65 * falling + 2300 * falling * falling;
      x += (letter.index % 2 ? 1 : -1) * 40 * falling * falling;
      angle = (letter.index % 2 ? 1 : -1) * falling * 23;
      opacity *= 1 - phase(falling, .38, .65);
    } else {
      const i = letter.initial, from = layer.gathered[i], target = layer.folded[i];
      x = mix(x, mix(from.x, target.x, fold), gather);
      y = mix(y, mix(from.y, target.y, fold), gather);
      scale = mix(1, mix(from.scale, target.scale, fold), gather);
      if (i === 1 || i === 3) digit = phase(t, clock.fold[0] + .06, clock.fold[1] - .02);
      if (i === 4) { x = mix(x, 960 + 5 * PIXEL, morph); y = mix(y, 312, morph); scale = mix(scale, 8 * PIXEL * .85 / letter.height, morph); }
      opacity *= 1 - (i === 4 ? phase(morph, .20, .88) : phase(morph, 0, .62));
    }
    paint.save(); paint.translate(x, y); paint.rotate(angle * Math.PI / 180); paint.scale(scale, scale);
    paint.globalAlpha = opacity * (1 - digit); paint.fillText(letter.char, 0, letter.baseline);
    paint.globalAlpha = opacity * digit; paint.fillText('2', 0, letter.baseline); paint.restore();
    if (opacity > .95) {
      if (digit > .95) visible.push('2');
      else if (1 - digit > .95) visible.push(letter.char);
    }
  }
  // Canvas fallback text describes exactly the fully visible glyphs just painted.
  layer.node.textContent = visible.join('');
}
function beadY(t, clock) {
  const drop = phase(t, ...clock.drop), bounce = phase(t, ...clock.bounce);
  // Constant acceleration, then one parabolic rebound. No iterative physics state.
  if (t < clock.drop[1]) return mix(312, 540, drop * drop);
  return 540 - 66 * 4 * bounce * (1 - bounce);
}
function drawIcon(icon, shadow, t, clock, destination, originX) {
  const shift = settle(phase(t, ...clock.name));
  const cx = mix(960, destination, shift);
  icon.root.style.transform = `translate(${cx - SIZE / 2}px,${540 - SIZE / 2}px)`;
  const arrival = phase(t, ...clock.shell), shell = settle(arrival);
  const shellTransform = `translate(${(1 - shell) * -3} ${(1 - shell) * 16}) translate(16 16) rotate(${(1 - shell) * -14}) scale(${mix(.84, 1, shell)}) translate(-16 -16)`;
  icon.shellPose.setAttribute('transform', shellTransform);
  icon.shellPose.style.opacity = String(phase(arrival, 0, .16));
  const draw = smooth(phase(t, ...clock.ribbon));
  icon.ribbonPose.setAttribute('transform', shellTransform);
  icon.ribbonPose.style.opacity = String(phase(draw, 0, .03));
  icon.ribbon.style.strokeDashoffset = String(icon.length * (1 - draw));
  const morph = smooth(phase(t, ...clock.morph));
  const y = t < clock.morph[1] ? mix(540, 312, morph) : beadY(t, clock);
  const x = mix(originX, 960 + 5 * PIXEL, morph) - (960 + 5 * PIXEL);
  const beadScale = mix(.85, .77, smooth(phase(t, clock.bounce[0], clock.glass[1])));
  icon.beadPose.setAttribute('transform', `translate(${x / PIXEL} ${(y - 540) / PIXEL}) translate(21 16) scale(${beadScale}) translate(-21 -16)`);
  icon.beadPose.style.opacity = String(smooth(phase(morph, .35, .95)));
  // One travelling highlight, over before the static photographed highlight takes over.
  const flash = phase(t, clock.drop[0] + .02, clock.bounce[0] + .12);
  icon.glint.style.opacity = String(Math.sin(Math.PI * flash) ** 2 * .92);
  icon.glint.setAttribute('cx', String(mix(19.5, 22.3, flash)));
  const glass = smooth(phase(t, ...clock.glass));
  icon.svg.style.opacity = String(1 - glass); icon.glass.node.style.opacity = String(glass);
  const paint = icon.glass.context, photoSize = SIZE * 1.24272;
  paint.clearRect(0, 0, 1920, 1080);
  paint.drawImage(icon.photograph, cx - photoSize / 2, 540 - photoSize / 2, photoSize, photoSize);
  const height = clamp((y - 312) / 228);
  shadow.style.left = `${cx + 5 * PIXEL - 56}px`; shadow.style.top = '572px';
  shadow.style.opacity = String((1 - phase(t, clock.shell[0], clock.shell[1])) * phase(t, ...clock.morph) * height * .16);
  shadow.style.transform = `scale(${mix(.45, 1, height)})`;
}
function makeName(parent, colour) {
  const name = bitmap(parent, 'tm-name'), paint = name.context;
  paint.font = `700 174px ${FONT}`; paint.letterSpacing = '-11.31px'; paint.fillStyle = colour;
  const metrics = paint.measureText('E2A2O');
  name.width = metrics.width; name.baseline = (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
  name.node.textContent = 'E2A2O';
  return name;
}
function drawName(name, tagline, t, clock, x) {
  const p = phase(t, ...clock.name), arrival = settle(p);
  name.node.style.opacity = String(phase(p, .12, .66));
  const paint = name.context;
  paint.clearRect(0, 0, 1920, 1080); paint.save();
  paint.translate(x + (1 - arrival) * 72, 540); paint.scale(mix(.82, 1, arrival), 1);
  paint.filter = `blur(${(1 - smooth(p)) * 9}px)`;
  paint.fillText('E2A2O', 0, name.baseline); paint.restore();
  const line = clock.tagline ? smooth(phase(t, ...clock.tagline)) : 0;
  tagline.style.opacity = String(line); tagline.style.transform = `translateY(${(1 - line) * 12}px)`;
}

export async function createTitleMorph(shot, parent) {
  installStyle(); await document.fonts.ready;
  const variant = shot.variant ?? (shot.duration >= 7 ? 'long' : 'short');
  const clock = clocks[variant];
  if (!clock) throw new Error('titlemorph variant must be short or long');
  const root = element('div', 'titlemorph', parent);
  root.style.color = variant === 'long' ? '#101114' : '#fff';
  root.setAttribute('aria-label', 'Everything Everywhere All at Once');
  const letters = makeLetters(root);
  const shadow = element('div', 'tm-shadow', root);
  const icon = await makeIcon(root);
  const name = makeName(root, variant === 'long' ? '#101114' : '#fff');
  const tagline = element('div', 'tm-tagline', root, variant === 'long' ? TAGLINE : '');
  const caption=shot.fromTitle&&shot.caption?bitmap(root,'tm-caption'):null;
  if(caption)paintRecorded(caption.context,shot.caption);
  const left = (1920 - SIZE - 48 - name.width) / 2;
  const destination = left + SIZE / 2, nameX = left + SIZE + 48;
  return {
    background: variant === 'long' ? '#fff' : '#000',
    firstFrame:shot.fromTitle?titleCard(shot.caption,variant==='long'?'#fff':'#000',variant==='long'?'#101114':'#fff'):null,
    draw(local) {
      const start=shot.fromTitle?clock.words[2]+.29:0;
      const t = start+clamp(local / shot.duration)*(clock.seconds-start);
      if(caption)caption.node.style.opacity=String(1-phase(local,0,.4));
      drawLetters(letters, t, clock, root.style.color);
      drawIcon(icon, shadow, t, clock, destination, letters.folded[4].x);
      drawName(name, tagline, t, clock, nameX);
    },
  };
}
