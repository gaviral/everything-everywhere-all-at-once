import { useMemo, useState } from 'react';
import type { CodeFunction, CodePart, PartTag, Piece, Snapshot } from './types';
import { pieces } from './types';
function PartLabels({ part }: { part?: CodePart }) {
  return part ? <span className="cc-part-labels">{part.tags.map(t => <span key={t} className="cc-tag">{t}</span>)}<span className="cc-version" title="Version counts commits touching this file; functions share their file's version.">v{part.version} · {part.version_scope}</span></span> : null;
}
function FunctionCard({ f, byId, parts, trail = [] }: { f: CodeFunction; byId: Map<string, CodeFunction>; parts: Map<string, CodePart>; trail?: string[] }) {
  const [open, setOpen] = useState(false);
  const cycle = trail.includes(f.id);
  return <article className="cc-function"><button className="cc-function-head" aria-expanded={open} onClick={() => setOpen(!open)}><span className="cc-chevron" aria-hidden="true">{open ? '−' : '+'}</span><span><strong>{f.name}</strong><small>{f.file}:{f.line}–{f.end_line}</small></span><span className="cc-metrics">{f.lines} lines · {f.calls.length} calls</span></button><PartLabels part={parts.get(f.id)} />
    {open && <div className="cc-function-body"><p>{f.branches} decision points{f.unresolved > 0 ? ` · ${f.unresolved} external or unresolved call names` : ''}</p>{f.reasons.length > 0 && <p className="cc-signal">Consider splitting: {f.reasons.join(' · ')}</p>}{cycle ? <p>Calls back to a function already open above.</p> : f.calls.length ? <><h4>Calls these pieces</h4>{f.calls.map(id => { const child = byId.get(id); return child ? <FunctionCard key={id} f={child} byId={byId} parts={parts} trail={[...trail, f.id]} /> : null; })}</> : <p>No resolved app calls. A small endpoint, or calls outside this source map.</p>}</div>}
  </article>;
}
function PieceCard({ piece, byId, parts }: { piece: Piece; byId: Map<string, CodeFunction>; parts: Map<string, CodePart> }) {
  const file = piece.id.replace(/^\/(core|ui)\//, '$1/src/');
  return <details className="cc-piece"><summary><span>{piece.name}</span><small>{piece.count} functions</small></summary><PartLabels part={parts.get(file)} /><div className="cc-piece-body">{piece.children.map(p => <PieceCard key={p.id} piece={p} byId={byId} parts={parts} />)}{piece.functions.map(f => <FunctionCard key={f.id} f={f} byId={byId} parts={parts} />)}</div></details>;
}
export function Composition({ data }: { data: Snapshot | null }) {
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<PartTag | 'all'>('all');
  const [tab, setTab] = useState<'composition' | 'splitting'>('composition');
  const parts = useMemo(() => new Map(data?.parts?.map(p => [p.id, p]) ?? []), [data?.parts]);
  const byId = useMemo(() => new Map(data?.functions.map(f => [f.id, f]) ?? []), [data?.functions]);
  function matches(part: CodePart) { return (tag === 'all' || part.tags.includes(tag)) && `${part.name} ${part.file} ${part.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()); }
  const filtered = (data?.functions ?? []).filter(f => parts.has(f.id) ? matches(parts.get(f.id)!) : (tag === 'all' || tag === 'function') && `${f.name} ${f.file}`.toLowerCase().includes(query.toLowerCase()));
  const files = (data?.parts ?? []).filter(p => p.id === p.file && matches(p));
  const tree = pieces(filtered);
  const signals = filtered.filter(f => f.reasons.length).sort((a, b) => b.lines - a.lines);
  return <section className="cc-composition" aria-label="Source composition"><div className="cc-section-heading"><div><p className="cc-eyebrow">02 / PARTS</p><h2>The app, opened up</h2></div><label className="cc-search">Find a part or file<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Name or file…" type="search" /></label></div>
    <div className="cc-tag-filter" role="group" aria-label="Filter parts by type">{(['all', 'prompt', 'function', 'data', 'mechanism', 'view'] as const).map(t => <button key={t} aria-pressed={tag === t} onClick={() => setTag(t)}>{t === 'all' ? 'All types' : t}</button>)}</div>
    <div className="cc-tabs" role="group" aria-label="Source view"><button aria-pressed={tab === 'composition'} onClick={() => setTab('composition')}>Pieces</button><button aria-pressed={tab === 'splitting'} onClick={() => setTab('splitting')}>Consider splitting{data ? ` · ${signals.length}` : ''}</button></div>
    <p className="cc-note">{tab === 'composition' ? 'Folders → files → functions → calls. Expand and collapse in place.' : 'Measured signals, not a verdict: over 60 lines, 8 decision points, or 10 known callees. Longest first.'}</p>
    {data && !filtered.length && !files.length && <p className="cc-empty">No parts match. Try another type or a shorter name.</p>}
    {tab === 'composition' ? tree.map(p => <PieceCard key={p.id} piece={p} byId={byId} parts={parts} />) : signals.map(f => <div key={f.id} className="cc-split"><p>{f.reasons.join(' · ')}</p><FunctionCard f={f} byId={byId} parts={parts} /></div>)}
    {!!files.length && <details className="cc-file-parts" key={tag} open={tag !== 'all'}><summary>File parts · {files.length}</summary>{files.map(p => <article className="cc-file-part" key={p.id}><strong>{p.name}</strong><small>{p.file}:{p.line}</small><PartLabels part={p} /></article>)}</details>}
    <p className="cc-method">Tags describe file roles and named functions using source syntax and file names. Versions count git commits touching each file; functions share that file version. v0 means no committed history. This is a plain parser: dynamic and ambiguous calls stay unresolved.</p>
  </section>;
}
