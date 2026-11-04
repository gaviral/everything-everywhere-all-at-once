import type { Job } from '../contract';
import { jobKey, matches, stateWords, type Filter } from './model';

export function WorkQueue({ jobs, filter, selected, choose, setFilter }: {
  jobs: readonly Job[]; filter: Filter; selected: string; choose: (key: string) => void; setFilter: (filter: Filter) => void;
}) {
  const visible = jobs.filter(job => matches(job, filter));
  return <nav className="cw-queue" aria-label="Concurrent work">
    <div className="cw-section-title"><div><p className="cw-eyebrow">02 / Alongside you</p><h2>Work in motion</h2></div><span className="cw-count">{jobs.length}</span></div>
    <div className="cw-filters" aria-label="Filter work">{(['all', 'attention', 'results'] as const).map(value => <button key={value} aria-pressed={value === filter} onClick={() => setFilter(value)}>{({ all: 'All work', attention: 'Needs attention', results: 'Has output' })[value]}</button>)}</div>
    <div className="cw-job-list">{visible.map(job => <button className="cw-job" data-selected={selected === jobKey(job)} aria-pressed={selected === jobKey(job)} key={jobKey(job)} onClick={() => choose(jobKey(job))}>
      <span className="cw-state" data-status={job.status}>{job.demo && 'Simulated · '}{stateWords(job)}</span>
      <strong>{job.title}</strong><span>{job.by}{job.helper_kind ? ` · ${job.helper_kind}` : ''}</span>
      {job.parent && <span className="cw-caption">Part of: {jobs.find(parent => parent.id === job.parent && parent.by === job.by)?.title ?? job.parent}</span>}
    </button>)}{!visible.length && <p>No work matches this filter. Try All work.</p>}</div>
  </nav>;
}
