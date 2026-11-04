import type { Thought } from "../contract";
import type { Display } from "./controls";

function Time({ at }: { at: number }) {
  const date = new Date(at);
  return Number.isFinite(at) && !Number.isNaN(date.valueOf())
    ? <time dateTime={date.toISOString()}>{date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time>
    : <span>Time unavailable</span>;
}

export function Metadata({ thought, display, ai }: { thought: Thought; display: Display; ai: boolean }) {
  return <div className="contextual-folds-metadata">
    {display.identity && <span>{thought.speaker || "Unnamed speaker"}{ai ? " · AI" : ""}</span>}
    {!display.identity && ai && <span>AI words</span>}
    {display.time ? <Time at={thought.at_ms} /> : <details className="contextual-folds-peek">
      <summary aria-label="Peek time">◷</summary><Time at={thought.at_ms} />
    </details>}
  </div>;
}
