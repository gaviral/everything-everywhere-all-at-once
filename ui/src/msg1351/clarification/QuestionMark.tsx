import type { Source, SourceAnchor } from "./contracts";
import { anchorIsCurrent } from "./SourceAnchor";

export function QuestionMark({ source, anchor }: { source: Source; anchor: SourceAnchor | null }) {
  if (!anchor || !anchorIsCurrent(anchor, source)) return <p className="clarification-source">{source.text}</p>;
  return <p className="clarification-source">{source.text.slice(0, anchor.start)}<mark>{anchor.quote}</mark>{source.text.slice(anchor.end)}</p>;
}
