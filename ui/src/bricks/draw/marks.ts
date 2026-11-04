// Marks: lines that look drawn by hand. Same inputs give the same wobble, so nothing shimmers between frames.
const wobbleOf = (seed: string) => {
  let hash = 7;
  for (const letter of seed) hash = (hash * 31 + letter.charCodeAt(0)) | 0;
  return (index: number) => (((hash >> (index % 24)) & 15) - 7.5) / 7.5;
};

/** A thin curve from one place to another, bowed to one side. */
export function curve(from: [number, number], to: [number, number], bend = 0.16) {
  const [x0, y0] = from, [x1, y1] = to;
  const cx = (x0 + x1) / 2 - (y1 - y0) * bend, cy = (y0 + y1) / 2 + (x1 - x0) * bend;
  return { path: `M${x0.toFixed(1)} ${y0.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`, control: [cx, cy] as [number, number] };
}

/** The two short strokes of an arrow's head at `to`, coming from `control`. */
export function arrowHead(control: [number, number], to: [number, number], size = 14) {
  const angle = Math.atan2(to[1] - control[1], to[0] - control[0]);
  const tip = (turn: number) => `${(to[0] - Math.cos(angle + turn) * size).toFixed(1)} ${(to[1] - Math.sin(angle + turn) * size).toFixed(1)}`;
  return `M${tip(0.45)}L${to[0].toFixed(1)} ${to[1].toFixed(1)}L${tip(-0.45)}`;
}

/** A box someone drew around something: corners a little off, sides a little bowed. */
export function wobblyBox(seed: string, [left, top, right, bottom]: readonly [number, number, number, number]) {
  const wobble = wobbleOf(seed), give = 5;
  const corner = (x: number, y: number, index: number) => `${(x + wobble(index) * give).toFixed(1)} ${(y + wobble(index + 1) * give).toFixed(1)}`;
  const side = (x: number, y: number, index: number) => `Q${(x + wobble(index) * give).toFixed(1)} ${(y + wobble(index + 2) * give).toFixed(1)}`;
  const middleX = (left + right) / 2, middleY = (top + bottom) / 2;
  return `M${corner(left, top, 0)}${side(middleX, top, 3)} ${corner(right, top, 5)}${side(right, middleY, 7)} ${corner(right, bottom, 9)}${side(middleX, bottom, 11)} ${corner(left, bottom, 13)}${side(left, middleY, 15)} ${corner(left, top, 0)}`;
}
