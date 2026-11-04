/** Calibrated from the empty interval between measured within-sitting pauses and between-sitting gaps.
 * Geometric midpoint: 4m09.237s and 4h39m22.426s. Only aggregate timing enters the app. */
export const SESSION_GAP_MS = Math.round(Math.sqrt(249237 * 16762426));
export interface Session<T> { key: string; start: number; end: number; turns: T[] }

/** Chronological, stable, non-mutating partition. A new local date always starts a fresh session. */
export function sessions<T extends { key: string; at: number }>(turns: readonly T[]): Session<T>[] {
  const out: Session<T>[] = [];
  for (const turn of [...turns].sort((a, b) => a.at - b.at)) {
    const last = out.at(-1);
    if (!last || turn.at - last.end > SESSION_GAP_MS || new Date(turn.at).toDateString() !== new Date(last.end).toDateString()) {
      out.push({ key: `session:${turn.key}`, start: turn.at, end: turn.at, turns: [turn] });
    } else { last.turns.push(turn); last.end = turn.at; }
  }
  return out;
}

export function sessionLabel(start: number, end: number) {
  const when = new Date(start).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const minutes = Math.round((end - start) / 60_000);
  const duration = minutes < 1 ? "Under a minute" : minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
  return { when, duration };
}
