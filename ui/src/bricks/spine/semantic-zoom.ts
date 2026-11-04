/** Real words fade out from 13 to 11 screen pixels. Smoothstep has zero slope at both ends:
 *  reversing a pinch retraces the same blend, with no timer, threshold swap or layout change. */
export function semanticBlend(zoom: number, fontSize = 15): number {
  const t = Math.max(0, Math.min(1, (zoom * fontSize - 11) / 2));
  return t * t * (3 - 2 * t);
}
