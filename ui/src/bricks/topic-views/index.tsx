import { useState } from 'react';
import type { BrickProps, Thought } from '../contract';
import { example } from './example';
import { emptyNotebook, keepVisit, readVisit, referenceOf, type Material, type Visit, type View } from './model';
import { TopicTree } from './TopicTree';
import { SourceCard } from './SourceCard';
import { NotesView } from './NotesView';
import './topic-views.css';

const labels: Record<View, string> = { tree: 'Topic tree', conversation: 'Conversation', notes: 'Notes' };

function TopicWorkspace({ material, scope, actions }: { material: Material; scope: string; actions: BrickProps['actions'] }) {
  const [visit, setVisit] = useState(() => readVisit(scope, material));
  const save = (next: Visit) => { keepVisit(scope, next); setVisit(next); };
  const selected = material.threads.find(thread => thread.id === visit.topic);
  const title = selected?.title ?? (visit.topic ? 'Topic no longer on map' : 'Unassigned thoughts');
  const notebook = visit.notebooks[visit.topic] ?? emptyNotebook();
  const choose = (id: string) => save({ ...visit, topic: id, source: null, all: false });
  const read = (thought: Thought) => save({ ...visit, view: 'conversation', topic: thought.thread_id ?? '', source: thought.id, all: false });
  const pin = (thought: Thought) => {
    if (notebook.references.some(reference => reference.id === thought.id)) return;
    save({ ...visit, notebooks: { ...visit.notebooks, [visit.topic]: { ...notebook, references: [...notebook.references, referenceOf(thought)] } } });
  };
  const shown = material.thoughts.filter(thought => visit.view === 'conversation' && visit.all || (thought.thread_id ?? '') === visit.topic)
    .slice().sort((a, b) => a.at_ms - b.at_ms);
  return <section className="topic-views" aria-label="Topic views">
    <header className="topic-views-heading"><div><p className="topic-views-eyebrow">One conversation. Connected perspectives.</p>
      <h1>Follow the idea.</h1><p>Topics give it shape. Conversation keeps the words. Notes are yours.</p></div>
      <span className="topic-views-badge">{material.example ? 'Interactive example · community garden' : 'Live map · linked by source identity'}</span>
    </header>
    <nav className="topic-views-switch" aria-label="Material view">{(Object.keys(labels) as View[]).map(view => <button type="button" key={view} aria-pressed={visit.view === view} onClick={() => save({ ...visit, view })}>{labels[view]}</button>)}</nav>
    <div className="topic-views-workspace">
      <TopicTree material={material} selected={visit.topic} choose={choose} />
      <div className="topic-views-paper">
        <p className="topic-views-eyebrow">{labels[visit.view]} <span>· {visit.view === 'tree' ? 'Organized points' : visit.view === 'conversation' ? 'Original words in time order' : 'Independent writing with references'}</span></p>
        <h2>{title}</h2><small className="topic-views-identity">Topic {visit.topic || 'unassigned'}</small>
        {visit.view === 'notes' ? <NotesView notebook={notebook} material={material} title={title}
          change={next => save({ ...visit, notebooks: { ...visit.notebooks, [visit.topic]: next } })}
          read={reference => { const source = material.thoughts.find(thought => thought.id === reference.id); if (source) read(source); }} />
          : <>
            {visit.view === 'conversation' && <label className="topic-views-filter"><input type="checkbox" checked={visit.all} onChange={event => save({ ...visit, all: event.target.checked })} /> Show whole conversation</label>}
            {!shown.length && <p className="topic-views-empty">{selected ? 'No thoughts directly linked to this topic yet. Choose a child topic or show the whole conversation.' : 'This topic has no current sources. Your notes and references remain available.'}</p>}
            {shown.map(thought => <SourceCard key={thought.id} thought={thought} topic={material.threads.find(thread => thread.id === thought.thread_id)?.title ?? 'Unassigned'}
              original={visit.view === 'conversation'} selected={visit.source === thought.id} kept={notebook.references.some(reference => reference.id === thought.id)}
              read={() => read(thought)} pin={() => pin(thought)} open={!material.example && thought.placed && thought.thread_id ? () => { actions.openThought(thought.id); } : undefined} />)}
          </>}
      </div>
    </div>
    <p className="topic-views-footer">{material.example ? 'Example content · explore freely. Your live map is unchanged.' : 'Topic links follow the map. Notes stay in this tab for this visit.'}</p>
  </section>;
}

export default function TopicViews({ map, actions }: BrickProps) {
  const material: Material = map.threads.length || map.thoughts.length ? { threads: map.threads, thoughts: map.thoughts, example: false } : example;
  const scope = JSON.stringify([map.visitKey ?? map.mapIdentity ?? 'visit', map.me, material.example]);
  return <TopicWorkspace key={scope} material={material} scope={scope} actions={actions} />;
}
