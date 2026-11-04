import type { Job, MapSnapshot, ThoughtSource } from '../contract';

export type Filter = 'all' | 'attention' | 'results';
export type HeldThought = ThoughtSource & { example?: boolean };
export type Workspace = { source: HeldThought | null; intent: string; selected: string; filter: Filter; reviewed: string[] };

export function sourcesOf(map: MapSnapshot): HeldThought[] {
  return map.thoughts.filter(t => t.placed && t.thread_id && t.speaker === map.me && t.text.trim())
    .map(t => ({ id: t.id, text: t.text, threadId: t.thread_id!, at: t.at_ms, speaker: t.speaker })).reverse();
}

export const jobKey = (job: Job) => JSON.stringify([job.by, job.id]);
export const versionKey = (job: Job) => JSON.stringify([jobKey(job), job.status, job.outcome, job.result_id, job.result, job.at_ms]);
export const hasOutput = (job: Job) => !!job.result?.trim() || !!job.result_id;
export const matches = (job: Job, filter: Filter) => filter === 'all' || (filter === 'attention' ? job.status === 'waiting' || job.status === 'failed' : hasOutput(job));

export function stateWords(job: Job): string {
  if (job.status === 'done') {
    if (job.outcome === 'failed') return 'Failed';
    if (job.outcome === 'stopped') return 'Stopped';
    if (job.outcome === 'partial') return 'Partial result';
    if (job.outcome === 'no_change') return 'No changes';
    if (job.outcome === 'dry_run') return 'Dry run';
    return 'Execution finished';
  }
  return ({ preparing: 'Preparing', queued: 'Queued', running: 'Running', failed: 'Failed', stopped: 'Stopped', waiting: 'Needs your input' })[job.status];
}

export function sourceAvailable(source: HeldThought, map: MapSnapshot): boolean {
  return !source.example && map.thoughts.some(t => t.id === source.id && t.placed && t.text === source.text && t.thread_id === source.threadId && t.at_ms === source.at && t.speaker === source.speaker)
    && map.threads.some(t => t.id === source.threadId);
}

export const exampleSource: HeldThought = { id: 'example-source', speaker: 'Example', threadId: 'example', at: 0, example: true,
  text: 'Make the opening easier to follow. Keep my original idea while helpers explore the details.' };
export const exampleJobs: readonly Job[] = [
  { id: 'example-answer', by: 'Thinking helper', title: 'A clearer opening', status: 'done', demo: true, at_ms: 0, helper_kind: 'thinking',
    result: 'Start with one thought on screen. Reveal two independent explorations beside it. Read one useful result, then return to the exact words that started it.' },
  { id: 'example-code', by: 'Coding helper', title: 'Draft a return button', status: 'queued', demo: true, at_ms: 0, helper_kind: 'coding' },
  { id: 'example-question', by: 'Thinking helper', title: 'Choose the audience', status: 'waiting', demo: true, at_ms: 0,
    result: 'Should the opening speak to a first-time visitor or a returning collaborator?' },
];
