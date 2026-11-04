import type { Job } from "../contract";

// Only these exact fields define a reviewed version. Nothing is persisted or sent.
export type ReviewMark = readonly [string, string, number, Job["status"], string, string | undefined, boolean];
export const versionOf = (job: Job): ReviewMark => [job.by, job.id, job.at_ms, job.status, job.title, job.result, job.demo];
export const sameVersion = (a: ReviewMark, b: ReviewMark) => a.every((field, i) => field === b[i]);
export const isReviewed = (job: Job, marks: readonly ReviewMark[]) => marks.some((mark) => sameVersion(mark, versionOf(job)));
export const finishedJobs = (jobs: readonly Job[]) => jobs.filter((job) => job.status === "done").sort((a, b) => b.at_ms - a.at_ms);
export function pruneMarks(marks: readonly ReviewMark[], jobs: readonly Job[]): readonly ReviewMark[] {
  const kept = marks.filter((mark) => jobs.some((job) => sameVersion(mark, versionOf(job)))).slice(-60);
  return kept.length === marks.length ? marks : kept;
}
export function toggleReview(marks: readonly ReviewMark[], job: Job): readonly ReviewMark[] {
  return isReviewed(job, marks) ? marks.filter((mark) => !sameVersion(mark, versionOf(job))) : [...marks, versionOf(job)].slice(-60);
}
