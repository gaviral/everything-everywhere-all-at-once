import { destinations, type Copy, type Draft, type Kind, type Plan } from './model';

const kinds: { id: Kind; label: string; mark: string; help: string }[] = [
  { id: 'split', label: 'Split', mark: '⑂', help: 'Give selected points a topic of their own.' },
  { id: 'merge', label: 'Merge', mark: '⋈', help: 'Bring two topics together, keeping their words.' },
  { id: 'parent', label: 'Change parent', mark: '↳', help: 'Move a whole branch to a better home.' },
];

export function OperationPicker({ kind, choose }: { kind: Kind; choose: (kind: Kind) => void }) {
  return <div className="topic-reshape-operations" aria-label="Reshape operation">{kinds.map(item =>
    <button key={item.id} type="button" aria-pressed={kind === item.id} onClick={() => choose(item.id)}>
      <span aria-hidden="true">{item.mark}</span>{item.label}
    </button>)}<p>{kinds.find(item => item.id === kind)!.help}</p></div>;
}

export function DraftFields({ copy, draft, edit }: { copy: Copy; draft: Draft; edit: (patch: Partial<Draft>) => void }) {
  if (draft.kind !== 'split') return <label>{draft.kind === 'merge' ? 'Merge into' : 'New parent'}
    <select value={draft.target} onChange={event => edit({ target: event.target.value })}>
      <option value="">{draft.kind === 'merge' ? 'Choose a destination' : 'Top level · no parent'}</option>
      {destinations(copy, draft).map(topic => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
    </select><small>A topic cannot move into its own child branch.</small>
  </label>;
  const points = copy.points.filter(point => point.topic === draft.source);
  return <><label>New topic name<input value={draft.title} placeholder="A clearer focus…" maxLength={80}
    onChange={event => edit({ title: event.target.value })} /></label>
    <fieldset><legend>Choose points to move · {draft.points.length} selected</legend>
      {points.length ? points.map(point => <label key={point.id} className="topic-reshape-point-choice">
        <input type="checkbox" checked={draft.points.includes(point.id)} onChange={event => edit({ points: event.target.checked ? [...draft.points, point.id] : draft.points.filter(id => id !== point.id) })} />
        <span>{point.text}</span>
      </label>) : <p>No placed points in this topic. Try Merge or Change parent.</p>}
    </fieldset></>;
}

export function TopicGarden({ copy, ids, label }: { copy: Copy; ids?: readonly string[]; label: string }) {
  const topics = ids ? copy.topics.filter(topic => ids.includes(topic.id)) : copy.topics;
  return <section className="topic-reshape-garden" aria-label={label}>
    {topics.map(topic => <article className="topic-reshape-topic" key={topic.id} data-copy-topic={topic.id}>
      <p className="topic-reshape-parent">{topic.parent ? `↳ ${copy.topics.find(parent => parent.id === topic.parent)?.title ?? 'Parent outside this copy'}` : 'Top-level topic'}</p>
      <h3>{topic.title}</h3>
      <ul>{copy.points.filter(point => point.topic === topic.id).map(point => <li key={point.id} data-copy-point={point.id}>{point.text}</li>)}</ul>
      {!copy.points.some(point => point.topic === topic.id) && <p>No direct points</p>}
    </article>)}
  </section>;
}

export function ReshapePreview({ plan, confirm, cancel }: { plan: Plan; confirm: () => void; cancel: () => void }) {
  return <section className="topic-reshape-preview" aria-label="Reshape preview" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
  }}>
    <p className="topic-reshape-eyebrow">Review before confirming</p>
    <h2 tabIndex={-1} id="topic-reshape-preview-title">{plan.label}</h2>
    <ul className="topic-reshape-details">{plan.details.map(detail => <li key={detail}>{detail}</li>)}</ul>
    <div className="topic-reshape-comparison">
      <div><h3>Before</h3><TopicGarden copy={plan.before} ids={plan.affected} label="Before reshape" /></div>
      <div><h3>After</h3><TopicGarden copy={plan.after} ids={plan.affected} label="After reshape" /></div>
    </div>
    <div className="topic-reshape-buttons"><button type="button" className="topic-reshape-primary" onClick={confirm}>Confirm in local copy</button>
      <button type="button" onClick={cancel}>Back to editing</button></div>
    <p className="topic-reshape-footnote">Applies only here. The shared map stays unchanged.</p>
  </section>;
}
