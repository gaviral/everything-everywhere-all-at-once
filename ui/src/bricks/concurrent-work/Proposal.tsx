import { useEffect, useState } from 'react';
import type { Job } from '../contract';

type File = { path: string; diff: string; additions: number; deletions: number; withheld: boolean; binary: boolean; truncated: boolean };
type Proposal = { base: string; status: 'created' | 'running' | 'completed' | 'failed' | 'stopped'; exit_code: number | null;
  validation: string; no_change: boolean; truncated: boolean; files: File[] };

function readProposal(value: unknown): Proposal {
  if (!value || typeof value !== 'object') throw new Error('Proposal format unavailable.');
  const p = value as Proposal;
  if (typeof p.base !== 'string' || !['created', 'running', 'completed', 'failed', 'stopped'].includes(p.status)
    || (p.exit_code !== null && !Number.isInteger(p.exit_code)) || typeof p.validation !== 'string'
    || typeof p.no_change !== 'boolean' || typeof p.truncated !== 'boolean' || !Array.isArray(p.files)
    || !p.files.every(f => f && typeof f.path === 'string' && typeof f.diff === 'string' && Number.isInteger(f.additions)
      && Number.isInteger(f.deletions) && ['withheld', 'binary', 'truncated'].every(key => typeof f[key as keyof File] === 'boolean'))) throw new Error('Proposal format unavailable.');
  return p;
}

export function ProposalOutput({ job, connected }: { job: Job; connected: boolean }) {
  const [result, setResult] = useState<Proposal | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!job.result_id || job.demo || !connected) return;
    const request = new AbortController();
    setResult(null); setError('');
    fetch('/helper-result', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result_id: job.result_id }), signal: request.signal,
    }).then(async response => {
      if (!response.ok) throw new Error(response.status === 403 ? 'Only the host can inspect this proposal.' : 'Proposal unavailable. Select another job and return to try again.');
      const result = readProposal(await response.json());
      if (!request.signal.aborted) setResult(result);
    }).catch((error: unknown) => { if (!request.signal.aborted) setError(error instanceof Error ? error.message : 'Proposal unavailable.'); });
    return () => request.abort();
  }, [job.result_id, job.at_ms, job.status, job.demo, connected]);
  if (job.demo) return <p>Simulated work has no live proposal to inspect.</p>;
  if (!connected) return <p>Reconnect to inspect this proposal. No changes applied by this view.</p>;
  if (error) return <p role="alert">{error}</p>;
  if (!result) return <p role="status">Reading proposal…</p>;
  return <div className="cw-proposal">
    <p className="cw-state">{({ created: 'Not started', running: 'Running', completed: 'Execution completed', failed: 'Failed', stopped: 'Stopped' })[result.status]}{result.exit_code !== null && ` · Exit ${result.exit_code}`}</p>
    <p>{result.validation === 'not_run' ? 'Validation not run' : 'Validation status unavailable'} · Read-only proposal</p>
    <p className="cw-caption">Base <code>{result.base}</code></p>
    <p>{result.no_change ? 'No changes supplied.' : `${result.files.length} files shown. Proposed changes need review.`}</p>
    {result.truncated && <p>Output truncated; this is an incomplete view.</p>}
    {result.files.map((file, i) => <section key={i}><h3>{file.path}</h3><p>{file.withheld ? 'Private or unsupported file withheld' : file.binary ? 'Binary change · text unavailable' : `+${file.additions} −${file.deletions}`}</p>
      {file.diff && <pre tabIndex={0} aria-label={`Proposed changes in ${file.path}`}>{file.diff}</pre>}{file.truncated && <p>File text truncated.</p>}</section>)}
  </div>;
}
