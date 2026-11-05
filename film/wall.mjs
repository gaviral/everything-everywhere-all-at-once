// Nested quadrants put the first 1, 4, 16 and 64 frames in contiguous squares.
export function wallPosition(index) {
  // After the 8×8 reveal, add complete columns so the final rectangle has at
  // most seven empty cells, rather than leaving an empty quadrant.
  if (index >= 64) return { x: 8 + Math.floor((index - 64) / 8), y: (index - 64) % 8 };
  let x = 0, y = 0, bit = 1;
  while (index > 0) {
    x += (index & 1) * bit; index >>>= 1;
    y += (index & 1) * bit; index >>>= 1;
    bit *= 2;
  }
  return { x, y };
}

const ease = t => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;
function bounds(count) {
  const positions = Array.from({ length: count }, (_, i) => wallPosition(i));
  return { columns: 1 + Math.max(...positions.map(p => p.x)), rows: 1 + Math.max(...positions.map(p => p.y)) };
}
function framing(count) {
  const { columns, rows } = bounds(count);
  const stride = 1932;
  return { x: (columns - 1) * stride / 2, y: (rows - 1) * stride / 2,
    scale: count === 1 ? 1 : Math.min(1920 / (columns * stride - 12), 1080 / (rows * stride - 12)) * .96 };
}
export function wallFrame(count, local, duration = 8) {
  const progress = Math.max(0, Math.min(1, local / duration));
  const stops = [[0, 1], [.20, Math.min(4, count)], [.40, Math.min(16, count)], [.62, Math.min(64, count)], [.82, count]];
  let a = stops[0], b = stops.at(-1);
  for (let i = 1; i < stops.length; i++) {
    if (progress <= stops[i][0]) { a = stops[i - 1]; b = stops[i]; break; }
    a = b = stops[i];
  }
  const t = a === b ? 1 : ease(Math.max(0, Math.min(1, (progress - a[0]) / (b[0] - a[0]))));
  const from = framing(a[1]), to = framing(b[1]);
  return { x: mix(from.x, to.x, t), y: mix(from.y, to.y, t),
    scale: Math.exp(mix(Math.log(from.scale), Math.log(to.scale), t)),
    visible: mix(a[1], b[1], t), opacity: 1 - ease(Math.max(0, Math.min(1, (progress - .91) / .075))) };
}

import { createField, drawField, paintField } from './wall-field.mjs';
import {createTitleWall,drawTitleWall,paintTitleWall} from './wall-title.mjs';
export function paintWall(shot,local,tiles) {
  if(shot.layout==='title')paintTitleWall(shot,local,tiles);
  if(shot.layout==='field')paintField(shot,local,tiles);
}
export async function createWall(shot, camera, videos, bounded) {
  if(shot.layout==='title')return createTitleWall(shot,camera,bounded);
  if (shot.layout === 'field') return createField(shot,camera,videos,bounded);
  const tiles = [];
  for (let i = 0; i < shot.tiles.length; i++) {
    const spec = shot.tiles[i];
    const node = document.createElement('div');
    const { x, y } = wallPosition(i);
    node.className = 'wall-tile';
    node.style.left = `${x * 1932 - 960}px`;
    node.style.top = `${y * 1932 - 960}px`;
    const media = document.createElement(spec.clip ? 'video' : 'img');
    node.append(media); camera.append(node);
    if (spec.clip) {
      media.muted = true; media.playsInline = true; media.preload = 'auto';
      const ready = new Promise((resolve, reject) => {
        media.addEventListener('loadeddata', resolve, { once: true });
        media.addEventListener('error', () => reject(Error(`Cannot decode wall clip ${i + 1}`)), { once: true });
      });
      media.src = spec.source;
      await bounded(ready, 'Wall clip load timed out');
      videos.push({ video: media, spec: { ...spec, loop: true } });
    } else {
      media.src = spec.source;
      await bounded(media.decode(), 'Wall image load timed out');
    }
    tiles.push(node);
  }
  return tiles;
}

export function drawWall(shot, local, camera, tiles) {
  if(shot.layout==='title')return drawTitleWall(shot,local,camera,tiles);
  if (shot.layout === 'field') return drawField(shot,local,camera,tiles);
  const frame = wallFrame(tiles.length, local, shot.duration);
  camera.style.transform = `translate(${960 - frame.x * frame.scale}px, ${540 - frame.y * frame.scale}px) scale(${frame.scale})`;
  camera.style.transformOrigin = '0 0';
  camera.style.opacity = String(frame.opacity);
  tiles.forEach((tile, i) => {
    tile.style.opacity = String(Math.max(0, Math.min(1, frame.visible - i)));
    // Subtle, frame-time-only light: no CSS animation or random wall-clock state.
    const shimmer = .94 + .06 * Math.sin(local * 2.4 + i * 2.399963);
    tile.style.filter = `brightness(${shimmer})`;
    tile.style.outlineWidth = `${Math.min(8, 1 / frame.scale)}px`;
  });
  return frame;
}
