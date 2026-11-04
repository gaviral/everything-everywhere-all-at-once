import { useState } from 'react';
import type { Thought } from '../contract';
import { createArtifact, type Artifact } from './model';

export function ArtifactIntake({ thoughts, add }: { thoughts: readonly Thought[]; add: (artifact: Artifact) => void }) {
  const [title, name] = useState('');
  const [body, write] = useState('');
  const [source, select] = useState('');
  const sources = thoughts.filter(thought => thought.placed && thought.text.trim());
  return <details className="revision-review-intake"><summary>Bring your own work</summary>
    <form onSubmit={event => { event.preventDefault(); add(createArtifact(title, body)); name(''); write(''); }}>
      <label>Artifact title<input value={title} onChange={event => name(event.target.value)} maxLength={120} required /></label>
      <label>Artifact words<textarea value={body} onChange={event => write(event.target.value)} maxLength={20000} required /></label>
      <button type="submit" disabled={!title.trim() || !body.trim()}>Create artifact</button>
    </form>
    {!!sources.length && <div className="revision-review-import"><label>Or start from words on the map<select value={source} onChange={event => select(event.target.value)}>
      <option value="">Choose a source</option>{sources.map(thought => <option key={thought.id} value={thought.id}>{thought.speaker}: {thought.text.slice(0, 80)}</option>)}
    </select></label><button type="button" disabled={!source} onClick={() => {
      const thought = sources.find(item => item.id === source);
      if (thought) add(createArtifact(thought.point.trim().slice(0, 120) || 'Map passage', thought.text, thought.id));
    }}>Create working copy</button><p>A separate artifact. Its revisions do not edit or track changes to the original map words.</p></div>}
  </details>;
}
