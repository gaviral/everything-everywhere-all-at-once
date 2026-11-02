// How many lines a text wraps into, and how wide each is, before anything is drawn: the layout needs every height up
// front, so nothing moves once it's on screen (a height measured after the first paint would shift the points below it a
// moment later). A canvas measures the page's own font; with none (a check in Node) an average character stands in.

/** The faces the Spine sets text in, as spine.css sets them. */
export const FONTS = {
  title: { weight: 650, size: 17 },
  point: { weight: 400, size: 15 },
  cardTitle: { weight: 600, size: 15 },
  small: { weight: 400, size: 13 },
} as const;
export type FontKey = keyof typeof FONTS;

let context: CanvasRenderingContext2D | null | undefined;
let family = "";
const widths = new Map<string, number>();

function canvas() {
  if (context !== undefined) return context;
  try {
    context = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    family = context ? getComputedStyle(document.body).fontFamily : "";
  } catch {
    context = null;
  }
  return context;
}

function width(text: string, font: FontKey): number {
  const key = `${font}\u0000${text}`;
  let w = widths.get(key);
  if (w === undefined) {
    const { weight, size } = FONTS[font];
    const c = canvas();
    if (c) {
      c.font = `${weight} ${size}px ${family || "system-ui, sans-serif"}`;
      w = c.measureText(text).width;
    } else w = text.length * size * (weight > 500 ? 0.56 : 0.5);
    widths.set(key, w);
  }
  return w;
}

/** The widths of the lines `text` takes at `max` px wide, wrapped as the page wraps it (a word longer than a line breaks
 *  inside it), and at most `limit` of them: past that the last line runs to the edge, where the page ends it with "…". */
export function wrap(text: string, font: FontKey, max: number, limit: number): number[] {
  // The page and the canvas can disagree by a pixel on where a line ends: erring narrow costs a line of space at worst,
  // never a clipped word.
  const room = max - 3;
  const space = width(" ", font);
  const lines: number[] = [];
  let line = 0;
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    let w = width(word, font);
    if (line > 0 && line + space + w <= room) {
      line += space + w;
      continue;
    }
    if (line > 0) lines.push(line);
    while (w > room) {
      lines.push(room);
      w -= room;
    }
    line = w;
  }
  if (line > 0 || !lines.length) lines.push(line);
  if (lines.length > limit) {
    lines.length = limit;
    lines[limit - 1] = max;
  }
  return lines;
}
