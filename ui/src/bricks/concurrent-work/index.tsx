import { useEffect } from 'react';
import { usePluginState, type BrickProps } from '../contract';
import { exampleJobs, exampleSource, jobKey, sourcesOf, versionKey, type Workspace } from './model';
import { SourceCard } from './SourceCard';
import { WorkQueue } from './WorkQueue';
import { ResultCard } from './ResultCard';
import css from './work.css?inline';

export default function ConcurrentWork({ map, actions }: BrickProps) {
  const scope = JSON.stringify([map.visitKey ?? map.mapIdentity ?? 'connection', map.me]);
  return <WorkspaceView key={scope} map={map} actions={actions} scope={scope} />;
}

function WorkspaceView({ map, actions, scope }: Pick<BrickProps, 'map' | 'actions'> & { scope: string }) {
  const [workspace, set] = usePluginState<Workspace>(`concurrent-work:${scope}`, () => ({ source: sourcesOf(map)[0] ?? null, intent: '', selected: '', filter: 'all', reviewed: [] }));
  const example = map.jobs.length === 0;
  const jobs = example ? exampleJobs : map.jobs;
  useEffect(() => {
    const source = sourcesOf(map)[0];
    const leavingExample = !example && exampleJobs.some(job => jobKey(job) === workspace.selected);
    if (((!workspace.source || workspace.source.example) && source) || !workspace.selected || leavingExample) set(old => ({ ...old,
      source: !old.source || old.source.example ? source ?? null : old.source,
      selected: !old.selected || leavingExample ? jobKey(jobs[0]) : old.selected,
    }));
  }, [map.thoughts, jobs, example, workspace.source, workspace.selected, set]);
  const selected = workspace.selected ? jobs.find(job => jobKey(job) === workspace.selected) : jobs[0];
  const version = selected ? versionKey(selected) : '';
  const source = workspace.source ?? sourcesOf(map)[0] ?? (example ? exampleSource : null);
  return <section className="concurrent-work" aria-label="Thought and concurrent work">
    <header className="cw-header"><div><p className="cw-eyebrow">Thought & work</p><h1>Explore. Keep your place.</h1><p>{example ? 'Interactive example · no live helper work reported.' : `${map.connected ? 'Connection work' : 'Disconnected · last reported work'} · inspect one result without losing your original thought.`}</p></div><button onClick={() => actions.closeView()}>Back to map</button></header>
    <div className="cw-layout">
      <SourceCard source={source} intent={workspace.intent} map={map} actions={actions} hold={source => set(old => ({ ...old, source }))} setIntent={intent => set(old => ({ ...old, source, intent }))} />
      <div className="cw-work">
        <WorkQueue jobs={jobs} filter={workspace.filter} selected={selected ? jobKey(selected) : workspace.selected} choose={selected => set(old => ({ ...old, source, selected }))} setFilter={filter => set(old => ({ ...old, source, filter }))} />
        <ResultCard job={selected} connected={map.connected} reviewed={workspace.reviewed.includes(version)} mark={() => set(old => ({ ...old, source, reviewed: old.reviewed.includes(version) ? old.reviewed.filter(v => v !== version) : [...old.reviewed.slice(-119), version] }))} />
      </div>
    </div>
  </section>;
}

export const styles = css;
