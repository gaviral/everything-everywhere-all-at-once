import type { MapSnapshot } from "../contract";

export const manualChecks = [
  { id: "sends", title: "Sends off", detail: "Check outgoing sends are disabled." },
  { id: "microphone", title: "Your microphone", detail: "Choose the intended input yourself." },
  { id: "optional", title: "Optional parts off", detail: "Review the switches in Features." },
  { id: "private", title: "Private parts off", detail: "Hide private content and connections." },
  { id: "machine", title: "Machine-only parts off", detail: "Disable tools meant for this machine." },
  { id: "music", title: "Music ready", detail: "Check the track, output and volume." },
] as const;
export type ManualId = typeof manualChecks[number]["id"];
export type Marks = Partial<Record<ManualId | "build", boolean>>;

/** Only a commit-shaped baked identifier can identify this loaded page. A server's
 * latest build could be different, so never fetch it and call it the current one. */
export function commitHash(value: unknown): string | null {
  return typeof value === "string" && /^[a-f\d]{7,40}$/i.test(value.trim()) ? value.trim() : null;
}

export function readMapCheck(map: MapSnapshot) {
  if (!map.connected) return { done: false, label: "Waiting for the map", detail: "Reconnect before checking an empty map." };
  const other = map.suggestions.length + map.reminders.length + map.questions.length
    + (map.research?.length ?? 0) + (map.evidenceKept?.length ?? 0)
    + (map.choiceMaps?.length ?? 0) + (map.actionEstimates?.length ?? 0)
    + Object.keys(map.notes).length + Object.keys(map.positions).length;
  const done = map.threads.length === 0 && map.thoughts.length === 0 && other === 0 && !map.partial.trim();
  const counts = `${map.threads.length} topics · ${map.thoughts.length} thoughts`;
  return { done, label: done ? "Map is empty" : "Map needs attention",
    detail: map.partial.trim() ? "Live words are arriving." : other ? `${counts} · other saved content present` : counts };
}
