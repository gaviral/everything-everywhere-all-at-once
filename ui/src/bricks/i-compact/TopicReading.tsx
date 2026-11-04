import { usePluginState, type BrickActions } from "../contract";
import { emptyNotes, headingId, sourceRevision, type ReadingTopic, type TopicNotes as Notes } from "./model";
import { SourceCard } from "./SourceCard";
import { TopicNotes } from "./TopicNotes";

export function TopicReading({ topic, children, scope, example, connected, actions }: {
  topic: ReadingTopic; children: React.ReactNode; scope: string; example: boolean; connected: boolean; actions: BrickActions;
}) {
  const [notes, update] = usePluginState<Notes>(JSON.stringify(["i-compact-notes", scope, topic.id]), emptyNotes);
  const [expanded, expand] = usePluginState<boolean>(JSON.stringify(["i-compact-expanded", scope, topic.id]), true);
  const revision = sourceRevision(topic);
  const stale = !!notes.synthesis && notes.synthesis.revision !== revision;
  const uncertain = topic.sources.filter(source => source.uncertainty).length;
  return <details className="i-compact-topic" open={expanded} onToggle={event => {
    if (event.target === event.currentTarget) expand(event.currentTarget.open);
  }}>
    <summary>
      <span><span className="i-compact-eyebrow">{topic.parent ? "Supporting topic" : "The main thread"}</span>
        <h2 id={headingId(topic.id)}>{topic.title}</h2>
        <span className="i-compact-meta">{topic.sources.length} source {topic.sources.length === 1 ? "point" : "points"}
          {uncertain > 0 && ` · ${uncertain} with uncertainty`}{stale && " · Synthesis invalidated"}</span>
      </span><span className="i-compact-fold" aria-hidden="true">⌄</span>
    </summary>
    <div className="i-compact-topic-body">
      <div className="i-compact-columns"><div>
        <p className="i-compact-eyebrow">Source-bound concise messages</p>
        {topic.sources.length ? topic.sources.map(source => <SourceCard key={source.id} source={source} example={example} actions={actions} />)
          : <p>No placed source points in this topic yet.</p>}
      </div><TopicNotes topic={topic} revision={revision} notes={notes} update={update} connected={connected} /></div>
      {children && <div className="i-compact-children">{children}</div>}
    </div>
  </details>;
}
