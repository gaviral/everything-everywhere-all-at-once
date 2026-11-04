// How many lines a text wraps into, and how wide each is, before anything is drawn: the layout needs every height up
// front, so nothing moves once it's on screen (a height measured after the first paint would shift the points below it a
// moment later). A canvas measures the page's own font; with none (a check in Node) an average character stands in.

/** The faces the Spine sets text in, as spine.css sets them: the app's six sizes (11, 13, 15, 18) in one sans. */
export const FONTS = {
  title: { weight: 600, size: 18 },
  phone: { weight: 400, size: 16 },
  point: { weight: 400, size: 15 },
  cardTitle: { weight: 600, size: 13 },
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
  const scale = font === "phone" && typeof document !== "undefined" ? (parseFloat(getComputedStyle(document.body).fontSize) || 15) / 15 : 1;
  const key = `${scale}:${font}\u0000${text}`;
  let w = widths.get(key);
  if (w === undefined) {
    const { weight, size } = FONTS[font];
    const c = canvas();
    if (c) {
      c.font = `${weight} ${size * scale}px ${family || "system-ui, sans-serif"}`;
      w = c.measureText(text).width;
    } else w = text.length * size * scale * (weight > 500 ? 0.56 : 0.5);
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

/** Where the last of `prefix` sits once wrapped as `wrap` wraps the whole text it begins: its line, and how far along it
 *  (lines break greedily, so the text after it never moves it). Past `limit` lines, the end of the last one. */
export function wrapEnd(prefix: string, font: FontKey, max: number, limit: number): { line: number; x: number } {
  const lines = wrap(prefix, font, max, Number.MAX_SAFE_INTEGER);
  if (lines.length > limit) return { line: limit - 1, x: max - 3 };
  return { line: lines.length - 1, x: lines[lines.length - 1] };
}

/** Actual occupied bands, shared by both phone reading modes. Coordinates are relative to the frame. */
export function phoneUsableArea(frame: HTMLElement | null, dock: number) {
  const f = frame?.getBoundingClientRect();
  const left = f?.left ?? 0, top = f?.top ?? 0, w = f?.width ?? innerWidth, h = f?.height ?? innerHeight;
  const vv = window.visualViewport;
  let y0 = Math.max(0, (vv?.offsetTop ?? 0) - top), y1 = Math.min(h, (vv?.offsetTop ?? 0) + (vv?.height ?? innerHeight) - top);
  let x1 = w;
  const boxes = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)].filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden").map(e => e.getBoundingClientRect()).filter(r => r.width && r.height);
  for (const r of boxes('[data-slot="top-left"], [data-slot="top-right"], .talk-pill, header, .phone-controls')) y0 = Math.max(y0, r.bottom - top + 8);
  const bottoms = boxes('[data-slot="stage"], [data-slot="status"], [data-slot="held"], [data-slot="bottom-left"], [data-slot="bottom-right"], .spine-corner, .recovery-panel, .delivery-recovery');
  for (const r of bottoms) y1 = Math.min(y1, r.top - top - 8);
  if (!bottoms.length) y1 = Math.min(y1, h - dock);
  for (const r of boxes('[data-slot="rail"]')) if (r.left > left + w / 2) x1 = Math.min(x1, r.left - left - 8);
  const safe = frame?.querySelector('.phone-safe')?.getBoundingClientRect().height ?? 0;
  return { x0: 0, x1: Math.max(0,x1), y0, y1: Math.max(y0, y1 - safe) };
}
