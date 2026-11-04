import type { WorkStatus as Work } from './types';
import './work-status.css';

function Counts({ work }: { work: Work }) {
  const counts = work.counts;
  return <dl className="cc-work-counts">
    <div><dt>Running now</dt><dd>{counts.running_now}</dd></div>
    <div><dt>Built and on the TV</dt><dd>{counts.built_on_tv}</dd></div>
    <div><dt>Written down only</dt><dd>{counts.written_only}</dd></div>
    <div><dt>Waiting on you</dt><dd>{counts.waiting_on_you}</dd></div>
  </dl>;
}

function IdleWarning({ work }: { work: Work }) {
  const count = work.counts.written_only;
  return <div className="cc-idle-warning" role="alert">
    <h2>{count} {count === 1 ? 'idea' : 'ideas'} written down,<br />nobody working on them</h2>
    <p>No live work is confirmed for these ideas.</p>
    {!!work.top_written.length && <ul>{work.top_written.map(title => <li key={title}>{title}</li>)}</ul>}
  </div>;
}

export function WorkStatus({ work, stale }: { work?: Work; stale: boolean }) {
  if (!work?.available || stale) return <section className="cc-work-unknown" role="status">Work status unavailable. We can’t confirm who is working.</section>;
  return <section className="cc-work-status" aria-label="Work status">
    {work.idle_warning && <IdleWarning work={work} />}
    <Counts work={work} />
  </section>;
}
