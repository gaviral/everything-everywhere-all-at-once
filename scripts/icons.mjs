// Draws the app icon: a thread with a tangent branching off it, as the map shows them. No dependencies:
// `node scripts/icons.mjs` rewrites ui/public/icon.svg and ui/public/icons/*.png from the one shape below.
// The PNGs are drawn here (4×4 samples a pixel) rather than from the SVG, so no image tool is needed.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

// The page's own colors (ui/src/styles.css, light theme): paper, ink, and the accent for the tangent.
export const PAPER = "#f6f6f3";
const INK = "#1d1d1f";
const ACCENT = "#245fbd";

// The mark on a 100-unit tile: a thread (top dot, line, bottom dot) and a tangent leaving it halfway down.
const STROKE = 6;
const DOT = 7.5;
const trunk = { from: [36, 26], to: [36, 74] };
const branch = { from: [36, 44], control: [36, 61], to: [65, 61] };

const svgMark = `<g fill="none" stroke-linecap="round" stroke-width="${STROKE}">`
  + `<path d="M${branch.from} Q${branch.control} ${branch.to}" stroke="${ACCENT}"/>`
  + `<path d="M${trunk.from} L${trunk.to}" stroke="${INK}"/></g>`
  + `<circle cx="${trunk.from[0]}" cy="${trunk.from[1]}" r="${DOT}" fill="${INK}"/>`
  + `<circle cx="${trunk.to[0]}" cy="${trunk.to[1]}" r="${DOT}" fill="${INK}"/>`
  + `<circle cx="${branch.to[0]}" cy="${branch.to[1]}" r="${DOT}" fill="${ACCENT}"/>`;

/** The browser tab's icon: the tile with a small margin, so it reads at 16 px. */
export const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">`
  + `<rect x="4" y="4" width="92" height="92" rx="21" fill="${PAPER}"/>${svgMark}</svg>\n`;

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const segment = (p, a, b) => {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
const curve = Array.from({ length: 33 }, (_, i) => {
  const t = i / 32, u = 1 - t;
  return [0, 1].map((k) => u * u * branch.from[k] + 2 * u * t * branch.control[k] + t * t * branch.to[k]);
});
/** What color the mark is at a point on the 100-unit tile, or null where it's paper. */
function mark(p) {
  const near = (c) => Math.hypot(p[0] - c[0], p[1] - c[1]) <= DOT;
  if (near(trunk.from) || near(trunk.to) || segment(p, trunk.from, trunk.to) <= STROKE / 2) return INK;
  if (near(branch.to) || curve.some((c, i) => i > 0 && segment(p, curve[i - 1], c) <= STROKE / 2)) return ACCENT;
  return null;
}
/** Inside a rounded square (x, y, size, radius), in pixels. */
function inTile(x, y, at, size, radius) {
  const cx = Math.max(at + radius, Math.min(at + size - radius, x));
  const cy = Math.max(at + radius, Math.min(at + size - radius, y));
  return Math.hypot(x - cx, y - cy) <= radius;
}

/**
 * One PNG. `tile` is the rounded square's share of the canvas (1 = full bleed, for icons the system masks itself);
 * `markScale` is how much of the canvas the 100-unit mark spans, so a maskable icon keeps it inside the safe circle.
 */
function png(size, { tile, markScale }) {
  const at = size * (1 - tile) / 2, side = size * tile, radius = tile === 1 ? 0 : side * 0.2237;
  const offset = size * (1 - markScale) / 2;
  const rows = Buffer.alloc(size * (size * 4 + 1));
  const n = 4;
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < n; sy++) for (let sx = 0; sx < n; sx++) {
        const px = x + (sx + 0.5) / n, py = y + (sy + 0.5) / n;
        if (!inTile(px, py, at, side, radius)) continue;
        const color = rgb(mark([(px - offset) / size / markScale * 100, (py - offset) / size / markScale * 100]) ?? PAPER);
        sum[0] += color[0]; sum[1] += color[1]; sum[2] += color[2]; sum[3] += 1;
      }
      const i = y * (size * 4 + 1) + 1 + x * 4;
      if (sum[3]) for (let k = 0; k < 3; k++) rows[i + k] = Math.round(sum[k] / sum[3]);
      rows[i + 3] = Math.round(255 * sum[3] / (n * n));
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6; // 8 bits a channel, RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
const CRC = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// "any": the tile on a transparent canvas at Apple's icon grid (≈ 80 % of the canvas), as the Dock shows icons.
// "maskable" and Apple's touch icon: full bleed, as Android and iOS cut their own shape; the mark spans 80 %, so its
// farthest dot stays inside the 40 % safe circle every mask keeps.
export const ICONS = {
  "icons/icon-192.png": [192, { tile: 0.8, markScale: 0.8 }],
  "icons/icon-512.png": [512, { tile: 0.8, markScale: 0.8 }],
  "icons/maskable-512.png": [512, { tile: 1, markScale: 0.8 }],
  "icons/apple-touch-icon.png": [180, { tile: 1, markScale: 0.8 }],
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = new URL("../ui/public/", import.meta.url);
  mkdirSync(new URL("icons/", out), { recursive: true });
  writeFileSync(new URL("icon.svg", out), SVG);
  for (const [path, [size, shape]] of Object.entries(ICONS)) writeFileSync(new URL(path, out), png(size, shape));
  console.log("wrote ui/public/icon.svg and", Object.keys(ICONS).join(", "));
}
