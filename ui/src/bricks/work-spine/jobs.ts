// What the jobs say, in words and as a tree: pure, so the lane and the card in the dock read the same answers.
import type { Job } from "../contract";

/** A job and the side jobs that hang from it, each of those with its own, in the order they came. */
export interface Node {
  readonly job: Job;
  readonly kids: readonly Node[];
}

/** The parent `job` hangs from: only one that's here and doesn't lead back to the job itself. A side job whose parent
 *  hasn't come (or never will) stands alone, so nothing a helper reported is ever out of sight. */
function parentIn(job: Job, byId: ReadonlyMap<string, Job>): string | undefined {
  const seen = new Set<string>();
  for (let up = job.parent; up !== undefined && byId.has(up) && !seen.has(up); up = byId.get(up)!.parent) {
    if (up === job.id) return undefined;
    seen.add(up);
  }
  return job.parent !== undefined && byId.has(job.parent) ? job.parent : undefined;
}

/** The jobs as a forest: those that stand alone, oldest first, and under each its side jobs, oldest first. */
export function forest(jobs: readonly Job[]): Node[] {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const under = new Map<string, Job[]>();
  const alone: Job[] = [];
  for (const job of jobs) {
    const parent = parentIn(job, byId);
    if (parent === undefined) { alone.push(job); continue; }
    under.set(parent, [...(under.get(parent) ?? []), job]);
  }
  const node = (job: Job): Node => ({ job, kids: (under.get(job.id) ?? []).map(node) });
  return alone.map(node);
}

/** Every job under `node`, however deep (not `node` itself). */
export function below(node: Node): Job[] {
  return node.kids.flatMap((kid) => [kid.job, ...below(kid)]);
}

/** The waiting jobs that ask something themselves. A job that waits only because a side job under it does has a summary
 *  for its words ("Class found · card drafted · waiting on your answer"), not a question, and isn't one more thing that
 *  needs you: it's the side job that asks. */
export function questions(jobs: readonly Job[]): ReadonlySet<string> {
  const out = new Set<string>();
  const walk = (node: Node) => {
    if (node.job.status === "waiting" && !below(node).some((under) => under.status === "waiting")) out.add(node.job.id);
    node.kids.forEach(walk);
  };
  forest(jobs).forEach(walk);
  return out;
}

export interface Tally { running: number; waiting: number; failed: number; done: number }

/** How many jobs are in each state; with `asks` (`questions`), a waiting job that isn't one of them isn't counted. */
export function tally(jobs: readonly Job[], asks?: ReadonlySet<string>): Tally {
  const out: Tally = { running: 0, waiting: 0, failed: 0, done: 0 };
  for (const job of jobs) if (job.status !== "waiting" || !asks || asks.has(job.id)) out[job.status]++;
  return out;
}

/** "2 running · 1 waiting": what isn't over yet or went wrong, as parts a view can color; none when all is done. */
export function parts(count: Tally): { key: "running" | "waiting" | "failed"; text: string }[] {
  return ([["running", "running"], ["waiting", "waiting"], ["failed", "failed"]] as const)
    .filter(([key]) => count[key] > 0).map(([key, word]) => ({ key, text: `${count[key]} ${word}` }));
}

/** How long, in words: "12 s", "1 min 5 s", "2 h 3 min". Under a second says so rather than "0 s". */
export function lengthOf(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  if (s < 1) return "under 1 s";
  if (s < 60) return `${s} s`;
  const minutes = Math.floor(s / 60), seconds = s % 60;
  if (s < 3600) return seconds ? `${minutes} min ${seconds} s` : `${minutes} min`;
  const hours = Math.floor(s / 3600), rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** A running job's clock, as the status line's is: "0:12", "14:05", "1:02:03". */
export function clock(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  return s < 3600 ? `${Math.floor(s / 60)}:${two(s % 60)}` : `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
}

/** How long "Just now" lasts. */
export const JUST_NOW_MS = 60_000;

/** The job whose state changed last, while that was a moment ago: the one "Just now" marks. A job's change time is the
 *  core's stamp, so a replay to a window that joined later marks nothing: it's all older than a moment. */
export function justNow(jobs: readonly Job[], now: number): string | null {
  let last: Job | null = null;
  for (const job of jobs) if (!last || job.at_ms >= last.at_ms) last = job;
  return last && now - last.at_ms < JUST_NOW_MS ? last.id : null;
}

/** What a job's state line says: a mark, its words, and (running) its clock, with how long it took once it's over,
 *  only when this window saw both ends. */
export function stateOf(job: Job, now: number): { mark: string; word: string; clock?: string } {
  const took = job.started_ms !== undefined && job.ended_ms !== undefined ? lengthOf(job.ended_ms - job.started_ms) : "";
  switch (job.status) {
    case "running": return { mark: "", word: "Running", clock: job.started_ms !== undefined ? clock(now - job.started_ms) : undefined };
    case "done": return { mark: "✓", word: took ? `Done in ${took}` : "Done" };
    case "failed": return { mark: "✕", word: took ? `Failed after ${took}` : "Failed" };
    case "waiting": return { mark: "?", word: "Waiting for you" };
  }
}
