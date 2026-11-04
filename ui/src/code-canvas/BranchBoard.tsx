import { useEffect, useRef, useState } from 'react';
import type { AgentLane, AgentState, CodeBranch } from './types';
import type { MergeMoment } from './useSnapshot';
const integrations = ['main', 'staging', 'dev'];
function Work({ agents }: { agents: AgentLane[] }) {
  if (!agents.length) return <p className="cc-note">No agent update for this lane.</p>;
  return <>{agents.map(agent => <div className="cc-agent" key={agent.id}><p className="cc-agent-who">{agent.who} <span className="cc-pill">{agent.state}</span></p><p><span className="cc-work-label">Now</span>{agent.now || 'No current task reported.'}</p>{agent.finished.length > 0 && <p className="cc-latest-finished"><span className="cc-work-label">Finished</span>{agent.finished.at(-1)}</p>}{agent.finished.length > 0 && <details><summary>Finished · {agent.finished.length}</summary><ul>{agent.finished.map((done, i) => <li key={i}>{done}</li>)}</ul></details>}</div>)}</>;
}
function BranchCard({ branch, agents, recent }: { branch: CodeBranch; agents: AgentLane[]; recent: boolean }) {
  const state = branch.state === 'merging' ? 'Merging now' : branch.merged_into ? `In ${branch.merged_into}` : integrations.includes(branch.name) ? 'Git integration' : 'Local git branch';
  return <article data-branch={branch.name} data-target={branch.merged_into || branch.parent || ''} data-joined={!!branch.merged_into} className={`cc-branch ${recent ? 'cc-just-merged' : ''}`}>
    <div className="cc-branch-top"><h3 className="cc-branch-name">{branch.name}</h3><span className="cc-pill">{state}</span></div>
    <small>{branch.current ? 'This checkout · ' : ''}{branch.tip}{branch.joined_at ? ` · joined at ${branch.joined_at}` : ''}</small>
    {integrations.includes(branch.name) ? <p className="cc-note">{branch.name === 'main' ? 'The shared foundation' : branch.name === 'staging' ? 'Work gathered for checking' : 'Lanes brought together'}</p> : <Work agents={agents} />}
    {!integrations.includes(branch.name) && <small>{branch.ahead} ahead of main · {branch.behind} behind</small>}
  </article>;
}
function MergeLines({ board, revision }: { board: React.RefObject<HTMLDivElement | null>; revision: string }) {
  const [paths, setPaths] = useState<{ d: string; joined: boolean }[]>([]);
  const [size, setSize] = useState({ width: 1, height: 1 });
  useEffect(() => {
    const node = board.current;
    if (!node) return;
    function measure() {
      if (!node) return;
      const origin = node.getBoundingClientRect();
      const cards = [...node.querySelectorAll<HTMLElement>('[data-branch]')];
      setSize({ width: node.scrollWidth, height: node.scrollHeight });
      setPaths(cards.flatMap(card => {
        const target = cards.find(c => c.dataset.branch === card.dataset.target);
        if (!target) return [];
        const from = card.getBoundingClientRect(), to = target.getBoundingClientRect();
        const sx = from.left - origin.left, sy = from.top - origin.top + 32;
        const tx = to.left - origin.left + to.width / 2, ty = to.bottom - origin.top;
        const gutter = sx - 12, baseline = node.scrollHeight - 24;
        return [{ d: `M ${sx} ${sy} H ${gutter} V ${baseline} H ${tx} V ${ty}`, joined: card.dataset.joined === 'true' }];
      }));
    }
    const observer = new ResizeObserver(measure); observer.observe(node);
    node.querySelectorAll('[data-branch]').forEach(c => observer.observe(c));
    measure(); return () => observer.disconnect();
  }, [board, revision]);
  return <svg className="cc-merge-lines" width={size.width} height={size.height} aria-hidden="true"><defs><marker id="cc-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="none" stroke="currentColor" /></marker></defs>{paths.map((p, i) => <path key={i} d={p.d} strokeDasharray={p.joined ? undefined : '6 6'} markerEnd="url(#cc-arrow)" />)}</svg>;
}
export function BranchBoard({ branches, agents, moments }: { branches: CodeBranch[]; agents?: AgentState; moments: MergeMoment[] }) {
  const [filter, setFilter] = useState('active');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(8);
  const board = useRef<HTMLDivElement>(null);
  const order = useRef<string[]>([]);
  for (const branch of [...branches].sort((a,b) => Number(b.current)-Number(a.current) || a.name.localeCompare(b.name))) if (!order.current.includes(branch.name)) order.current.push(branch.name);
  const lanes = agents?.lanes ?? [];
  const candidates = branches.filter(b => !integrations.includes(b.name) && (filter === 'all' || !b.merged_into || b.state === 'merging' || moments.some(m => m.lane === b.name) || lanes.some(a => a.branch === b.name && a.state === 'Working')) && b.name.toLowerCase().includes(query.toLowerCase())).sort((a, b) => order.current.indexOf(a.name) - order.current.indexOf(b.name));
  const visible = candidates.slice(0, limit);
  const unassigned = lanes.filter(a => !branches.some(b => b.name === a.branch));
  const revision = JSON.stringify([visible, branches.filter(b => integrations.includes(b.name))]);
  return <section className="cc-branches" aria-label="Local git branch tree"><div className="cc-section-heading"><div><p className="cc-eyebrow">01 / AGENT WORK</p><h2>All the work. One place.</h2></div><div className="cc-board-filters"><label>Git branches<select aria-label="Show git branches" value={filter} onChange={e => { setFilter(e.target.value); setLimit(8); }}><option value="active">Active lanes</option><option value="all">All lanes, including merged</option></select></label><label>Find a lane<input type="search" value={query} onChange={e => { setQuery(e.target.value); setLimit(8); }} /></label></div></div>
    <p className="cc-note">Main at the left. Solid lines show where work joined; dashed lines show its starting branch. Local git, updated live.</p>
    <div className="cc-merge-moments" role="status">{moments.length ? <><strong>Just joined</strong><span>{moments[0].text}</span><details><summary>Recent joins · {moments.length}</summary>{moments.map(m => <p key={m.id}>{m.text}</p>)}</details></> : <span>Watching for the next merge.</span>}</div>
    <div className="cc-branch-scroll" tabIndex={0} aria-label="Git branch columns, scroll horizontally for lanes"><div className="cc-branch-board" ref={board}>
      <MergeLines board={board} revision={revision} />
      {integrations.map((name, i) => <div className={`cc-integration cc-integration-${i}`} key={name}><p className="cc-column-label">{name}</p>{branches.find(b => b.name === name) ? <BranchCard branch={branches.find(b => b.name === name)!} agents={[]} recent={false} /> : <div className="cc-branch cc-missing"><h3>{name}</h3><p>No local git branch yet</p></div>}</div>)}
      <div className="cc-lanes"><p className="cc-column-label">Lanes · {candidates.length}</p>{visible.map(b => <BranchCard key={b.name} branch={b} agents={lanes.filter(a => a.branch === b.name)} recent={moments.some(m => m.lane === b.name)} />)}{!visible.length && <p className="cc-empty">{query ? 'No lanes match this search.' : 'No active lanes. Choose all lanes to see finished work.'}</p>}{candidates.length > limit && <button onClick={() => setLimit(limit + 8)}>Show more lanes · {candidates.length - limit} remaining</button>}</div>
    </div></div>
    {agents?.notice && <p className="cc-warning" role="status">{agents.notice}</p>}
    {agents?.updated_at && <p className="cc-feed-time">Agent feed · {new Date(agents.updated_at).toLocaleString()} · {agents.available ? 'Local file' : 'Last known update'}</p>}
    {unassigned.length > 0 && <details className="cc-unassigned"><summary>Work without a matched git branch · {unassigned.length}</summary><p className="cc-note">No git branch association was reported. These jobs are kept separate.</p><Work agents={unassigned} /></details>}
    {!!agents?.summary.length && <details className="cc-hub-summary"><summary>Coordination update</summary>{agents.summary.map((s, i) => <p key={i}>{s}</p>)}</details>}
  </section>;
}
