import { useState } from "react";
import { usePluginState, type BrickProps } from "../contract";
import { exampleTopics } from "./examples";
import { mapTopics, topicForest } from "./model";
import { TopicReading } from "./TopicReading";
import { VisitState } from "./VisitState";
import pluginStyles from "./i-compact.css?inline";

export default function FaithfulReading(props: BrickProps) {
  const scope = JSON.stringify([props.map.mapIdentity ?? props.map.visitKey ?? "current-visit", props.map.me]);
  return <VisitState scope={scope}><ReadingVisit key={scope} {...props} scope={scope} /></VisitState>;
}

function ReadingVisit({ map, actions, scope }: BrickProps & { scope: string }) {
  const [example, setExample] = usePluginState<boolean>(`i-compact-mode:${scope}`, !map.thoughts.some(thought => thought.placed));
  const [changed, setChanged] = usePluginState<boolean>(`i-compact-example-revision:${scope}`, false);
  const [notice, setNotice] = useState("");
  const branches = topicForest(example ? exampleTopics(changed) : mapTopics(map));
  const renderBranch = ({ topic, children }: typeof branches[number]): React.ReactNode => <TopicReading
    key={JSON.stringify([example, topic.id])} topic={topic} scope={JSON.stringify([scope, example])} example={example}
    connected={example || map.connected} actions={actions}>
    {children.length ? children.map(renderBranch) : null}
  </TopicReading>;
  return <section className="i-compact" aria-label="Faithful reading" data-guide="i-compact"
    onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.stopPropagation(); actions.closeView(); } }}>
    <div className="i-compact-intro"><div><p className="i-compact-eyebrow">Faithful reading</p>
      <h1>Less to read.<br /><em>Meaning within reach.</em></h1>
      <p>Read the point. Keep the conditions. Open the exact words.</p>
    </div><button type="button" onClick={() => actions.closeView()}>Back to map ↗</button></div>
    <div className="i-compact-toolbar"><div role="group" aria-label="Reading source">
      <button type="button" aria-pressed={!example} onClick={() => { setExample(false); setNotice(""); }}>This map</button>
      <button type="button" aria-pressed={example} onClick={() => { setExample(true); setNotice(""); }}>Example reading</button>
    </div>{example && <button type="button" onClick={() => { setChanged(!changed); setNotice("Example original wording changed. Any synthesis tied to different wording needs review."); }}>Change example source</button>}</div>
    <p className="i-compact-context">{example ? "Clearly labelled example · neighbourhood library pilot · no shared map changes"
      : "This map · existing concise points and exact originals · personal notes stay in this browser visit"}</p>
    {!example && !map.connected && <p className="i-compact-warning" role="status">Disconnected · last received sources. Freshness cannot be confirmed; synthesis review is paused.</p>}
    {notice && <p className="i-compact-warning" role="status">{notice}</p>}
    {branches.length ? branches.map(renderBranch) : <p className="i-compact-empty">No topics on this map yet. Open Example reading to try the complete flow.</p>}
  </section>;
}

export const styles = pluginStyles;
