import type { Item, Kind, SourceSpan } from "./contract";

function itemKind(text: string): Kind {
  if (text.includes("?")) return "question";
  return /\b(add|build|fix|make|send|keep|paint|test|rename|schedule)\b/i.test(text) ? "action" : "note";
}
function itemReason(text: string): Pick<Item, "why" | "reasonOrigin"> {
  const because = /\bbecause\s+([^.!?]+)/i.exec(text);
  if (because) return { why: because[1].trim(), reasonOrigin: "stated" };
  if (/^\s*(back to|returning to)\b/i.test(text)) return { why: "Resumes an earlier topic (cue-based inference).", reasonOrigin: "inferred" };
  return { why: "", reasonOrigin: "unspecified" };
}
export function extractItem(source: SourceSpan): Item {
  return Object.freeze({ id: `span-${source.start}-${source.end}`, what: source.text.trim(),
    ...itemReason(source.text), kind: itemKind(source.text), source, reviewedBy: "unreviewed" });
}
