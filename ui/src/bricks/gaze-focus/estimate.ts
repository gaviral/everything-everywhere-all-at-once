export type Point = { x: number; y: number };
export type Box = Point & { width: number; height: number };
export type Face = { boundingBox: Box; landmarks?: { type: string; locations: Point[] }[] };
export const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const smooth = (before: Point, next: Point): Point => ({
  x: before.x + (next.x - before.x) * .22,
  y: before.y + (next.y - before.y) * .22,
});

// A face/eye POSITION proxy, not a pupil tracker. Mirrored to feel like a front camera.
export function facePosition(face: Face, width: number, height: number): Point {
  const eyes = face.landmarks?.filter(l => l.type === "eye").flatMap(l => l.locations) ?? [];
  const box = face.boundingBox;
  const center = eyes.length ? {
    x: eyes.reduce((n, p) => n + p.x, 0) / eyes.length,
    y: eyes.reduce((n, p) => n + p.y, 0) / eyes.length,
  } : { x: box.x + box.width / 2, y: box.y + box.height * .4 };
  return { x: 1 - center.x / width, y: center.y / height };
}

// Center of light above the frame average. Deliberately coarse; no identity or eye inference.
export function brightnessPosition(pixels: Uint8ClampedArray, width: number, height: number): Point | null {
  const luminance = (i: number) => pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722;
  let mean = 0;
  for (let i = 0; i < pixels.length; i += 4) mean += luminance(i);
  mean /= width * height;
  let weight = 0, x = 0, y = 0;
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const light = Math.max(0, luminance((row * width + col) * 4) - mean - 8);
    weight += light; x += col * light; y += row * light;
  }
  return weight < width * height * 2 ? null : { x: 1 - x / weight / width, y: y / weight / height };
}

export function calibrated(point: Point, center: Point): Point {
  return { x: clamp(.5 + (point.x - center.x) * 3), y: clamp(.5 + (point.y - center.y) * 3) };
}

export type Target = { id: string; title: string; box: Box; example: boolean };
export function nearest(point: Point, targets: Target[]): Target | null {
  let best: Target | null = null, distance = Infinity;
  for (const target of targets) {
    const box = target.box;
    const d = Math.hypot(Math.max(box.x - point.x, 0, point.x - box.x - box.width),
      Math.max(box.y - point.y, 0, point.y - box.y - box.height));
    if (d < distance) { best = target; distance = d; }
  }
  return distance <= 140 ? best : null;
}
