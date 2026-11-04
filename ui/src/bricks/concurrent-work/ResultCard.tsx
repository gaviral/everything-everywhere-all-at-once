import type { Job } from '../contract';
import { hasOutput, stateWords } from './model';
import { ProposalOutput } from './Proposal';

export function ResultCard({ job, reviewed, mark, connected }: { job: Job | undefined; reviewed: boolean; mark: () => void; connected: boolean }) {
  return <article className="cw-result" aria-label="Selected output">
    <p className="cw-eyebrow">03 / Take a closer look</p>
    {!job ? <><h2>Choose a piece of work.</h2><p>Your return point stays beside you.</p></> : <>
      <span className="cw-state" data-status={job.status}>{job.demo && 'Simulated · '}{stateWords(job)}</span>
      <h2>{job.title}</h2><p className="cw-by">Reported by {job.by}</p>
      {!connected && !job.demo && <p role="status">Disconnected · last reported state, not a live update.</p>}
      <div className="cw-output">{job.result ? <p>{job.result}</p> : <p>{job.status === 'queued' || job.status === 'preparing' ? 'No output yet. This work has not started.' : job.status === 'running' ? 'Work is running. No output supplied yet.' : 'No result text supplied.'}</p>}</div>
      {job.helper_kind === 'coding' && <p className="cw-proposal-note">Code proposal · this view never applies changes. Execution finishing does not prove validation or acceptance.</p>}
      {job.result_id && job.helper_kind === 'coding' && <ProposalOutput key={JSON.stringify([job.result_id, job.at_ms, job.status])} job={job} connected={connected} />}
      {hasOutput(job) && <div className="cw-review"><button aria-pressed={reviewed} onClick={mark}>{reviewed ? '✓ Reviewed this version' : 'Mark this version reviewed'}</button><p className="cw-caption">A local reading mark for this visit. It does not accept, apply or complete work.</p></div>}
    </>}
  </article>;
}
