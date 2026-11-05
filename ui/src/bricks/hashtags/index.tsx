import { useMemo, useRef } from "react";
import type { BrickProps } from "../contract";
import { EXAMPLE_THOUGHTS } from "./examples";
import { TagStrip, ThoughtResults } from "./parts";
import { useTagReturnFocus, useTagSelection } from "./selection";
import { taggedThoughts, tagGroups, type TaggedThought } from "./tags";
import "./hashtags.css";

function HashtagCollection({ map, actions, thoughts, example, scope }: BrickProps & {
  thoughts: TaggedThought[]; example: boolean; scope: string;
}) {
  const [selected, select] = useTagSelection(scope);
  const strip = useRef<HTMLDivElement>(null);
  useTagReturnFocus(strip, selected);
  const groups = useMemo(() => tagGroups(thoughts), [thoughts]);
  const shown = selected ? thoughts.filter(thought => thought.tags.includes(selected)) : thoughts;
  const topicCount = new Set(shown.map(thought => thought.threadId ?? thought.topic)).size;
  function backToTags() {
    select(null);
    strip.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }
  return <section className="hashtags" aria-label="Hashtags" data-guide="hashtags"
    onKeyDown={event => { if (event.key === "Escape" && selected) { event.stopPropagation(); backToTags(); } }}>
    <div className="hashtags-intro">
      <div><p className="hashtags-eyebrow">Threads of thought</p><h1 className="hashtags-title">One tag. Many connections.</h1></div>
      <button className="hashtags-back" onClick={() => actions.closeView()}>← Back to map</button>
    </div>
    <p className="hashtags-help">Type <strong>#rollback</strong> or say <strong>“hashtag rollback”</strong> in a thought. Find it here, across every topic.</p>
    {example && <aside className="hashtags-example" role="note"><strong>Example · developer debugging sample</strong>
      <span>No tagged thoughts yet. These sample sentences have illustrative tags added. Your first tagged thought replaces this preview.</span></aside>}
    <div ref={strip}><TagStrip groups={groups} total={thoughts.length} selected={selected} select={select} /></div>
    <div className="hashtags-heading">
      <div><h2 className="hashtags-result-title">{selected ? `#${selected}` : "A thread across topics"}</h2>
        <p className="hashtags-count" role="status">{shown.length} {example ? "example " : ""}{shown.length === 1 ? "thought" : "thoughts"} · {topicCount} {topicCount === 1 ? "topic" : "topics"}</p></div>
      {selected && <button className="hashtags-back" onClick={backToTags}>← All tags</button>}
    </div>
    <ThoughtResults thoughts={shown} selected={selected} example={example} actions={actions}
      isAI={speaker => map.speakers.get(speaker)?.ai ?? false} />
  </section>;
}

export default function Hashtags(props: BrickProps) {
  const live = useMemo(() => taggedThoughts(props.map.thoughts, props.map.threads), [props.map.thoughts, props.map.threads]);
  const example = live.length === 0;
  const scope = JSON.stringify([props.map.visitKey ?? props.map.mapIdentity ?? "local", props.map.me, example]);
  return <HashtagCollection key={scope} {...props} scope={scope} example={example} thoughts={example ? EXAMPLE_THOUGHTS : live} />;
}
