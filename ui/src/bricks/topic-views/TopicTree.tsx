import type { CSSProperties } from 'react';
import type { Material } from './model';
import { topicRows } from './model';

export function TopicTree({ material, selected, choose }: { material: Material; selected: string; choose(id: string): void }) {
  return <nav className="topic-views-tree" aria-label="Canonical topics">
    <p className="topic-views-eyebrow">Topic tree</p>
    <p>One topic identity, wherever you read it.</p>
    <ul>{topicRows(material.threads).map(({ thread, depth }) => <li key={thread.id} style={{ '--topic-depth': Math.min(depth, 4) } as CSSProperties}>
      <button type="button" aria-pressed={selected === thread.id} onClick={() => choose(thread.id)}>
        <span aria-hidden="true">{depth ? '↳' : '✳'}</span><span>{thread.title}<small>{material.thoughts.filter(thought => thought.thread_id === thread.id).length} thoughts</small></span>
      </button>
    </li>)}</ul>
    {!material.threads.length && <p>No topics assigned yet. Read the original conversation while thoughts are placed.</p>}
  </nav>;
}
