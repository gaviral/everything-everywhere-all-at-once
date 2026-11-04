import type { AliasTarget } from "../contract";

// Same literal full-turn rule as the core. Never removes internal punctuation or words.
export function normalizePhrase(text: string): string {
  return text.trim().replace(/[.!?…。！？\s]+$/u, "").toLowerCase().split(/\s+/u).join(" ");
}
export function targetLabel(target: AliasTarget, topics: readonly {id: string; title: string}[]): string {
  if (target.kind === "open_topic") return topics.some(t => t.id === target.topic_id)
    ? `Open topic: ${topics.find(t => t.id === target.topic_id)!.title} (${target.topic_id})`
    : `Topic no longer on map (${target.topic_id})`;
  return {next_topic:"Next topic",previous_topic:"Previous topic",show_recap:"Show recap"}[target.kind];
}
