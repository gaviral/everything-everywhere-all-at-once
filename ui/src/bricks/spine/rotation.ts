// Local camera geometry. World records never carry the viewing angle (degrees clockwise).
export type Point = { x: number; y: number };
export type Camera = Point & { zoom: number; angle?: number };

export function rotatePoint(p: Point, angle = 0): Point {
  const r = angle * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export function worldToScreen(p: Point, camera: Camera): Point {
  const q = rotatePoint(p, camera.angle);
  return { x: camera.x + q.x * camera.zoom, y: camera.y + q.y * camera.zoom };
}

export function screenToWorld(p: Point, camera: Camera): Point {
  return rotatePoint({ x: (p.x - camera.x) / camera.zoom, y: (p.y - camera.y) / camera.zoom }, -(camera.angle ?? 0));
}

/** Put a world point at a screen point, also used for aiming and gesture centroids. */
export function anchorAt(world: Point, screen: Point, zoom: number, angle = 0): Camera {
  const q = rotatePoint(world, angle);
  return { x: screen.x - q.x * zoom, y: screen.y - q.y * zoom, zoom, angle };
}

export function turnAt(camera: Camera, angle: number, screen: Point): Camera {
  return anchorAt(screenToWorld(screen, camera), screen, camera.zoom, angle);
}

export const normalAngle = (angle: number) => ((angle + 180) % 360 + 360) % 360 - 180;

/** Axis-aligned screen bounds of all four rotated corners, for camera fit and comfort. */
export function screenBounds(box: Point & { w: number; h: number }, camera: Camera) {
  const corners = [[0, 0], [box.w, 0], [0, box.h], [box.w, box.h]]
    .map(([x, y]) => worldToScreen({ x: box.x + x, y: box.y + y }, camera));
  const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
