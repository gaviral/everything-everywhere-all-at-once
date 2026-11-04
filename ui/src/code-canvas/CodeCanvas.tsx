import { useEffect, useMemo, useRef, useState } from 'react';
import type { CodeBranch, CodeFunction, Piece, Snapshot } from './types';
import { pieces } from './types';
import './code-canvas.css';

function FunctionCard({ f, byId, trail = [] }: { f: CodeFunction; byId: Map<string, CodeFunction>; trail?: string[] }) {
  const [open, setOpen] = useState(false);
  const cycle = trail.includes(f.id);
  return <article className="cc-function">
    <button className="cc-function-head" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="cc-chevron" aria-hidden="true">{open ? '−' : '+'}</span>
      <span><strong>{f.name}</strong><small>{f.file}:{f.line}–{f.end_line}</small></span>
      <span className="cc-metrics">{f.lines} lines · {f.calls.length} calls</span>
    </button>
    {open && <div className="cc-function-body">
      <p>{f.branches} decision points{f.unresolved > 0 ? ` · ${f.unresolved} external or unresolved call names` : ''}</p>
      {f.reasons.length > 0 && <p className="cc-signal">Consider splitting: {f.reasons.join(' · ')}</p>}
      {cycle ? <p>Calls back to a function already open above.</p> : f.calls.length ? <><h4>Calls these pieces</h4>{f.calls.map(id => { const child = byId.get(id); return child ? <FunctionCard key={id} f={child} byId={byId} trail={[...trail, f.id]} /> : null; })}</> : <p>No resolved app calls. A small endpoint, or calls outside this source map.</p>}
    </div>}
  </article>;
}
function PieceCard({ piece, byId }: { piece: Piece; byId: Map<string, CodeFunction> }) {
  return <details className="cc-piece"><summary><span>{piece.name}</span><small>{piece.count} functions</small></summary>
    <div className="cc-piece-body">{piece.children.map(p => <PieceCard key={p.id} piece={p} byId={byId} />)}{piece.functions.map(f => <FunctionCard key={f.id} f={f} byId={byId} />)}</div>
  </details>;
}
function BranchNode({ branch, all, trail = [] }: { branch: CodeBranch; all: CodeBranch[]; trail?: string[] }) {
  const children = all.filter(b => b.parent === branch.name && !trail.includes(b.name)).sort((a, b) => Number(a.current) - Number(b.current) || a.name.localeCompare(b.name));
  return <li className="cc-branch-node">{children.length > 0 && <ul>{children.map(b => <BranchNode key={b.name} branch={b} all={all} trail={[...trail, branch.name]} />)}</ul>}
    <div className={`cc-branch cc-state-${branch.state}`}><span className="cc-branch-name">{branch.name}{branch.current && <small>this checkout</small>}</span><span className="cc-pill">{branch.state === 'main' && branch.name !== 'main' ? 'in main' : branch.state}</span>
      <small>{branch.tip} · {branch.ahead} ahead · {branch.behind} behind{branch.fork ? ` · fork ${branch.fork}` : ''}</small>
    </div>
  </li>;
}
export default function CodeCanvas() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState('Reading local source…');
  const [stale, setStale] = useState(false);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'composition' | 'splitting'>('composition');
  const [branchFilter, setBranchFilter] = useState('active');
  const refresh = useRef<(() => void) | null>(null);
  useEffect(() => {
    document.title = 'Code canvas · E2A2O';
    let disposed = false; let timer: ReturnType<typeof setTimeout>; let controller: AbortController;
    let running = false;
    async function read() {
      if (running || disposed) return;
      running = true; clearTimeout(timer); controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const result = await fetch('/code-canvas/snapshot', { cache: 'no-store', signal: controller.signal });
        if (!result.ok) throw new Error(result.status === 404 ? 'Code canvas is off. Start the local core with E2A2O_CODE_CANVAS=1.' : 'Local source could not be read.');
        const next: Snapshot = await result.json();
        if (!disposed) { setData(next); setStale(false); setStatus(`Live · read ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`); }
      } catch (error) { if (!disposed) { setStale(true); setStatus(error instanceof Error && error.name !== 'AbortError' ? error.message : 'Source read timed out. Retrying.'); } }
      finally { clearTimeout(timeout); running = false; if (!disposed) timer = setTimeout(read, 4000); }
    }
    refresh.current = () => { void read(); };
    void read();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, []);
  const byId = useMemo(() => new Map(data?.functions.map(f => [f.id, f]) ?? []), [data]);
  const filtered = useMemo(() => data?.functions.filter(f => `${f.name} ${f.file}`.toLowerCase().includes(query.toLowerCase())) ?? [], [data, query]);
  const tree = useMemo(() => pieces(filtered), [filtered]);
  const signals = useMemo(() => filtered.filter(f => f.reasons.length).sort((a, b) => b.lines - a.lines), [filtered]);
  const branchSet = useMemo(() => {
    if (!data) return [];
    const names = new Set(data.branches.filter(b => branchFilter === 'all' || b.state !== 'main' || b.name === 'main').map(b => b.name));
    let changed = true;
    while (changed) { changed = false; for (const b of data.branches) if (names.has(b.name) && b.parent && !names.has(b.parent)) { names.add(b.parent); changed = true; } }
    return data.branches.filter(b => names.has(b.name));
  }, [data, branchFilter]);
  const branchScroll = useRef<HTMLDivElement>(null);
  const positioned = useRef('');
  useEffect(() => {
    if (branchSet.length && branchScroll.current && positioned.current !== branchFilter) {
      branchScroll.current.scrollTop = branchScroll.current.scrollHeight;
      positioned.current = branchFilter;
    }
  }, [branchSet, branchFilter]);
  // names-ok: Git branch/branches means local Git refs, not conversational Tangents.
  return <main className="code-canvas">
    <header className="cc-header"><div><p className="cc-eyebrow">E2A2O / LOCAL SOURCE</p><h1>Everything is made of pieces.</h1><p>Open a piece. See the functions it uses. Follow the work as it grows.</p></div><a className="cc-back" href="/">Back to map ↗</a></header>
    <div className={`cc-live ${stale ? 'cc-stale' : ''}`} role="status"><span>{stale && data ? 'Showing last read · ' : ''}{status}</span><span>{data ? `${data.files} files · ${data.functions.length} functions · ${data.branches.length} branches` : 'Optional local view · no model needed'}</span><button onClick={() => refresh.current?.()}>Read again</button></div>
    {data?.warnings.map(w => <p className="cc-warning" key={w}>{w}</p>)}
    <div className="cc-layout"><section className="cc-composition" aria-label="Source composition">
      <div className="cc-section-heading"><div><p className="cc-eyebrow">01 / COMPOSITION</p><h2>The app, opened up</h2></div><label className="cc-search">Find a function or file<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Name or file…" type="search" /></label></div>
      <div className="cc-tabs" role="group" aria-label="Source view"><button aria-pressed={tab === 'composition'} onClick={() => setTab('composition')}>Pieces</button><button aria-pressed={tab === 'splitting'} onClick={() => setTab('splitting')}>Consider splitting{data ? ` · ${signals.length}` : ''}</button></div>
      <p className="cc-note">{tab === 'composition' ? 'Folders → files → functions → calls. Expand and collapse in place.' : 'Measured signals, not a verdict: over 60 lines, 8 decision points, or 10 known callees. Longest first.'}</p>
      {data && filtered.length === 0 && <p className="cc-empty">No functions match. Try a shorter name.</p>}
      {tab === 'composition' ? tree.map(p => <PieceCard key={p.id} piece={p} byId={byId} />) : signals.map(f => <div key={f.id} className="cc-split"><p>{f.reasons.join(' · ')}</p><FunctionCard f={f} byId={byId} /></div>)}
      <p className="cc-method">Read directly from Rust and TypeScript, including test functions. Plain parsing finds named functions and arrow functions; known calls and JSX components link by name. Ambiguous, dynamic and external calls stay unresolved. Lines and decision keywords are measured; multiple jobs need a person’s judgment.</p>
    </section><aside className="cc-branches" aria-label="Local branch tree"><div className="cc-section-heading"><div><p className="cc-eyebrow">02 / BRANCHES</p><h2>Work grows upward</h2></div></div>
      <p className="cc-note">Main is the root. Follow each fork upward to its local branch.</p>
      <label className="cc-branch-filter">Show<select value={branchFilter} onChange={e => setBranchFilter(e.target.value)}><option value="active">Active work + main</option><option value="all">All local branches</option></select></label>
      <div className="cc-branch-scroll" ref={branchScroll}><ul className="cc-branch-tree">{branchSet.filter(b => !b.parent || !branchSet.some(p => p.name === b.parent)).map(b => <BranchNode key={b.name} branch={b} all={branchSet} />)}</ul></div>
      <p className="cc-method">Dev is the default. Stage, staging and train names suggest staging. “In main” means the tip is in main’s ancestry. Merging means a local worktree has MERGE_HEAD. A fork records the nearest named ancestor, or shared main history. Names suggest workflow, not deployment.</p>
    </aside></div>
  </main>;
}
