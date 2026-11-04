import { useState } from 'react';
import type { BrickProps } from '../contract';
import { ArtifactIntake } from './ArtifactIntake';
import { CompletionEvidence } from './CompletionEvidence';
import { PassageComments } from './PassageComments';
import { ReviewDecision } from './ReviewDecision';
import { RevisionEditor } from './RevisionEditor';
import { RevisionHistory } from './RevisionHistory';
import { current, status, type Command } from './model';
import { useWorkspace } from './useWorkspace';
import css from './revision-review.css?inline';

function ReviewWorkspace({ map, actions, scope }: BrickProps & { scope: string }) {
  const { workspace, artifact, select, add, send } = useWorkspace(scope);
  const [message, inform] = useState('');
  const revision = current(artifact);
  const key = `${scope}:${artifact.id}:${revision.number}`;
  const dispatch = (command: Command) => send(revision.number, command);
  const human = !map.speakers.get(map.me)?.ai;
  return <section className="revision-review" aria-label="Revision review" data-guide="revision-review">
    <div className="revision-review-heading"><div><p className="revision-review-eyebrow">Words → decision → effect</p><h1>Review is a step.<br />Completion is a result.</h1>
      <p>Passage comments ask. A person approves one revision.<br />Checked evidence closes the work.</p></div><div className="revision-review-seal" aria-hidden="true">r{revision.number}<span>one exact version</span></div></div>
    <p className="revision-review-local">Local workspace · this visit and participant only. Export the record before reloading. Nothing is published or changed on the map.</p>
    <ArtifactIntake thoughts={map.thoughts} add={add} />
    <div className="revision-review-toolbar"><label>Artifact<select aria-label="Choose artifact" value={artifact.id} onChange={event => select(event.target.value)}>
      {workspace.artifacts.map(item => <option key={item.id} value={item.id}>{item.example ? 'Example · ' : ''}{current(item).title}</option>)}
    </select></label><button type="button" onClick={() => {
      const accepted = actions.saveTextFile('revision-review.txt', JSON.stringify({ format: 'revision-review-v1', scope: 'local human review record', artifact }, null, 2), 'text/plain');
      inform(accepted ? 'Record handed to your browser. Check its downloads to keep the file.' : 'Export was refused. Your record remains in this visit.');
    }}>Export review record</button></div>
    <p role="status">{message}</p>
    <div className="revision-review-state"><span>{artifact.example ? 'Interactive example · no real work' : 'Your artifact · working copy'}</span><strong data-review-status>{status(revision)} · r{revision.number}</strong></div>
    {artifact.sourceId && <button type="button" onClick={() => actions.openThought(artifact.sourceId!)}>Open original map words</button>}
    <div className="revision-review-layout">
      <div className="revision-review-document"><p className="revision-review-eyebrow">01 · Exact passage</p>
        <PassageComments key={key} revision={revision} actor={map.me} comments={artifact.comments.filter(comment => comment.revision === revision.number)} send={dispatch} />
        <RevisionEditor key={key + ':editor'} scope={`${scope}:${artifact.id}`} revision={revision} send={dispatch} />
      </div>
      <div className="revision-review-decisions"><ReviewDecision key={key} revision={revision} actor={map.me} human={human} send={dispatch} />
        <CompletionEvidence key={key + ':effect'} revision={revision} actor={map.me} human={human} send={dispatch} /></div>
    </div>
    <RevisionHistory artifact={artifact} />
  </section>;
}

export default function RevisionReview(props: BrickProps) {
  const scope = `revision-review:${props.map.visitKey ?? props.map.mapIdentity ?? 'visit'}:${props.map.me}`;
  return <ReviewWorkspace key={scope} {...props} scope={scope} />;
}

export const styles = css;
