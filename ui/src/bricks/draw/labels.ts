// Labels: "this is this, and this right here is that". Words said while drawing name the strokes drawn around them.
import type { Stroke } from "./ink";

export type Label = { id: string; text: string; strokes: string[] };
export type Clause = { text: string; at: number };

/** Strokes this close in time are one thing being drawn. */
const SAME_THING_MS = 1600;
/** How long after drawing something you can still name it, and how long a name said first waits for its drawing. */
const NAME_WINDOW_MS = 9000;

const POINTING = /\b(?:and |then |so |now )?(?:this|that|these|those|here)(?: right here| over here| one| part| bit| box| thing| line| arrow)?(?: is| are|'s| will be| would be| becomes)\s+/gi;
const OPENING = /^(?:(?:the|a|an|our|my)\s+)/i;

/** Each spoken "this is ..." is one clause, ordered: its words keep growing as the person talks. */
export function clausesIn(words: string): string[] {
  const starts = [...words.matchAll(POINTING)];
  return starts.map((match, index) => {
    const from = (match.index ?? 0) + match[0].length;
    const to = index + 1 < starts.length ? starts[index + 1].index ?? words.length : words.length;
    return words.slice(from, to).replace(/[,.;:!?]+\s*$/, "").replace(OPENING, "").trim();
  });
}

/** The strokes `at` most likely means: the newest unnamed run of drawing around that moment. */
export function strokesMeant(strokes: readonly Stroke[], named: ReadonlySet<string>, at: number) {
  const open = strokes.filter(stroke => !named.has(stroke.id) && stroke.at <= at + 400 && stroke.end >= at - NAME_WINDOW_MS);
  const run: Stroke[] = [];
  for (const stroke of [...open].reverse()) {
    if (run.length && run[run.length - 1].at - stroke.end > SAME_THING_MS) break;
    run.push(stroke);
  }
  return run.map(stroke => stroke.id);
}

export const namedIn = (labels: readonly Label[]) => new Set(labels.flatMap(label => label.strokes));
export const waitsForDrawing = (clause: Clause, now: number) => now - clause.at < NAME_WINDOW_MS;
