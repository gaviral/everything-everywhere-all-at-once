import { AppMark } from "../AppMark";
import { useEffect, useState } from 'react';
import { BranchBoard } from './BranchBoard';
import { Composition } from './Composition';
import { NeedsYou } from './NeedsYou';
import { useSnapshot } from './useSnapshot';
import { WorkStatus } from './WorkStatus';
import { SystemView } from './system-view/SystemView';
import './code-canvas.css';
export default function CodeCanvas() {
  const [tv, setTv] = useState(() => { try { return localStorage.getItem('agent-work-tv') === '1'; } catch { return false; } });
  function toggleTv() { setTv(old => { try { localStorage.setItem('agent-work-tv', old ? '0' : '1'); } catch { /* still usable without storage */ } return !old; }); }
  const { data, status, stale, moments, refresh } = useSnapshot();
  useEffect(() => { document.title = 'Agent work · E2A2O'; }, []);
  // names-ok: Git branch/branches means local Git refs, not conversational Tangents.
  return <main className={`code-canvas ${tv ? 'cc-tv' : ''}`}><header className="cc-header"><div><p className="cc-eyebrow"><AppMark size="2em" dark /> / AGENT WORK</p><h1>Keep up with what’s happening.</h1><p>Who’s working. What’s done. What needs you.</p></div><div className="cc-header-actions"><button aria-pressed={tv} onClick={toggleTv}>TV size</button><a className="cc-back" href="/">Back to map ↗</a></div></header>
    <div className={`cc-live ${stale ? 'cc-stale' : ''}`} role="status"><span>{stale && data ? 'Showing last read · ' : ''}{status}</span><span>{data ? `${data.files} files · ${data.functions.length} functions · ${data.branches.length} branches` : 'Optional local view · no model needed'}</span><button onClick={refresh}>Read again</button></div>
    {data?.warnings.map(w => <p className="cc-warning" key={w}>{w}</p>)}
    <WorkStatus work={data?.agents?.work_status} stale={stale || !data?.agents?.available} />
    <SystemView />
    <BranchBoard branches={data?.branches ?? []} agents={data?.agents} moments={moments} />
    <Composition data={data} />
    <NeedsYou needs={data?.agents?.needs_you ?? []} refresh={refresh} confirmed={!!data?.agents?.available && !stale} loading={!data && !stale} />
  </main>;
}
