import { useId } from "react";
import type { MapSnapshot } from "../contract";
import type { ReaderInstance } from "./state";

// Both placements use this component; the definition supplies only the heading.
export function TopicReader({ heading, instance, map, change, definition }: {
  heading: string; instance: ReaderInstance; map: MapSnapshot;
  change: (patch: Partial<Pick<ReaderInstance, "topicId" | "draft" | "expanded">>) => void;
  definition: () => void;
}) {
  const body = useId();
  const topic = map.threads.find(t => t.id === instance.topicId);
  const thoughts = map.thoughts.filter(t => t.thread_id === instance.topicId);
  return <article className="view-instances-reader" data-instance={instance.id}>
    <h4>{heading || "Topic reader"}</h4>
    <p>Instance ID <code>{instance.id}</code></p>
    <div className="view-instances-actions">
      <button type="button" onClick={definition}>Definition: {instance.definitionId}</button>
      <button type="button" aria-expanded={instance.expanded} aria-controls={body}
        onClick={() => change({ expanded: !instance.expanded })}>{instance.expanded ? "Fold reader" : "Show reader"}</button>
    </div>
    <div id={body} hidden={!instance.expanded}>
      <label>Existing topic
        <select value={instance.topicId} onChange={e => change({ topicId: e.target.value })}>
          <option value="">Choose a topic</option>
          {instance.topicId && !topic && <option value={instance.topicId}>Topic unavailable</option>}
          {map.threads.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      </label>
      {topic && <div className="view-instances-content"><strong>{topic.title}</strong>
        {thoughts.length ? <ul>{thoughts.map(t => <li key={t.id}>{t.point || t.text}</li>)}</ul> : <p>No thoughts in this topic yet.</p>}
      </div>}
      {!map.threads.length && <p>No existing topics yet. Readers never create topics.</p>}
      <label>Local draft · this instance
        <textarea value={instance.draft} onChange={e => change({ draft: e.target.value })} rows={3} />
      </label>
    </div>
  </article>;
}
