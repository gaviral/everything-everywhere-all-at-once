import { Fragment } from "react";
import type { BrickActions } from "../contract";
import { tagTokens, type TaggedThought, type TagGroup } from "./tags";

export function TagStrip({ groups, total, selected, select }: {
  groups: TagGroup[]; total: number; selected: string | null; select: (tag: string | null) => void;
}) {
  return <nav className="hashtags-strip" aria-label="Filter thoughts by hashtag" data-guide="hashtags:tags">
    <button className="hashtags-chip" aria-pressed={selected === null} onClick={() => select(null)}>
      All tagged <span>{total}</span>
    </button>
    {groups.map(group => <button key={group.name} className="hashtags-chip" aria-pressed={selected === group.name}
      onClick={() => select(group.name)} aria-label={`#${group.name}, ${group.count} ${group.count === 1 ? "thought" : "thoughts"}`}>
      #{group.name} <span>{group.count}</span>
    </button>)}
  </nav>;
}

function TaggedWords({ text, selected }: { text: string; selected: string | null }) {
  let cursor = 0;
  const words = tagTokens(text).map(token => {
    const before = text.slice(cursor, token.start);
    cursor = token.end;
    return <Fragment key={token.start}>{before}<mark className="hashtags-mark"
      data-selected={selected === token.name}>{text.slice(token.start, token.end)}</mark></Fragment>;
  });
  return <>{words}{text.slice(cursor)}</>;
}

function ThoughtCard({ thought, selected, example, openThought, ai }: {
  thought: TaggedThought; selected: string | null; example: boolean;
  openThought: BrickActions["openThought"]; ai: boolean;
}) {
  return <article className="hashtags-thought" data-thought={example ? undefined : thought.id}
    data-thread={example ? undefined : thought.threadId ?? undefined}
    data-guide={example ? undefined : `point:${thought.id}`}>
    <div className="hashtags-topic"><span className="hashtags-dot" />{thought.topic}</div>
    <p className="hashtags-words"><TaggedWords text={thought.text} selected={selected} /></p>
    <div className="hashtags-source">
      <span>{thought.speaker}{ai ? " · AI" : ""}</span>
      {example ? <span>Illustrative tags</span> : thought.navigable
        ? <button className="hashtags-source-link" onClick={() => openThought(thought.id)} aria-label={`Open original thought in ${thought.topic}`}>Open original ↗</button>
        : <span>{thought.topic === "Waiting for a topic" ? "Still placing" : "Source unavailable"}</span>}
    </div>
  </article>;
}

export function ThoughtResults({ thoughts, selected, example, actions, isAI }: {
  thoughts: TaggedThought[]; selected: string | null; example: boolean;
  actions: BrickActions; isAI: (speaker: string) => boolean;
}) {
  return <div className="hashtags-results" aria-label="Tagged thoughts">
    {thoughts.map(thought => <ThoughtCard key={thought.id} thought={thought} selected={selected}
      example={example} openThought={actions.openThought} ai={isAI(thought.speaker)} />)}
    {!thoughts.length && <p className="hashtags-no-results">No thoughts carry #{selected} now. Choose All tagged to see the rest.</p>}
  </div>;
}
