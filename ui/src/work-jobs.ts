// The helpers' jobs (contract.ts `Job`), as the core relays them (core/src/guide.rs `job`, protocol.rs `ServerMsg::Job`):
// a flat message per state change, the same `id` again for the same job, and the latest jobs replayed to a window that
// joins, right after its snapshot. Kept here, outside the map: jobs are never on it, and a brick switched on late (or
// still loading) must find every job that came before it. BrickSlot.tsx hands them to bricks as `map.jobs`.
import { useSyncExternalStore } from "react";
import type { Job, JobStatus } from "./bricks/contract";

/** What the core sends (the guide's `Job`, plus who and when). */
export type JobMsg = {
  type: "job";
  id: string;
  title: string;
  status: JobStatus;
  result?: string;
  parent?: string;
  demo: boolean;
  by: string;
  at_ms: number;
};

const STATUSES: readonly string[] = ["running", "done", "failed", "waiting"];
/** As many as the core keeps (guide.rs); bound this window's store too. */
const KEPT = 60;

const ended = (status: JobStatus) => status === "done" || status === "failed";
const text = (value: unknown): value is string => typeof value === "string";

let jobs: readonly Job[] = [];
const listeners = new Set<() => void>();
const changed = () => { for (const listener of listeners) listener(); };

/** The job `message` makes of `old` (undefined: a first sighting). Start and end are only ever what this window saw. */
export function merge(old: Job | undefined, job: JobMsg): Job {
  // A job that ended and runs again starts over; otherwise the first sighting of each stands.
  const again = !!old && old.ended_ms !== undefined && job.status === "running";
  return {
    id: job.id, title: job.title, status: job.status, result: job.result, parent: job.parent, demo: job.demo, by: job.by, at_ms: job.at_ms,
    started_ms: again ? job.at_ms : old?.started_ms ?? (job.status === "running" ? job.at_ms : undefined),
    ended_ms: again ? undefined : old?.ended_ms ?? (ended(job.status) ? job.at_ms : undefined),
  };
}

/** A new connection's replay is what's true now: whatever was kept before is let go. */
export function resetJobs() {
  if (!jobs.length) return;
  jobs = [];
  changed();
}

/** Takes a job message in (true: it was one, whether or not it was usable). A job keeps its place in the order it first
 *  came; one with a field of the wrong kind is left out rather than shown wrong. */
export function receiveJob(message: { type: string }): boolean {
  if (message.type !== "job") return false;
  const job = message as JobMsg;
  if (!text(job.id) || !job.id || !text(job.title) || !STATUSES.includes(job.status) || !text(job.by) || typeof job.demo !== "boolean"
    || !Number.isFinite(job.at_ms) || (job.result != null && !text(job.result)) || (job.parent != null && !text(job.parent))) return true;
  const at = jobs.findIndex((old) => old.by === job.by && old.id === job.id);
  const next = merge(jobs[at], job);
  jobs = at < 0 ? [...jobs, next].slice(-KEPT) : jobs.map((old, i) => (i === at ? next : old));
  changed();
  return true;
}

/** The jobs now: the same array until one comes or the connection starts over. */
export function useJobs(): readonly Job[] {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => jobs, () => jobs);
}
