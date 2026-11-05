import type { MapSnapshot } from "../contract";

export type Person = { id: string; name: string; role: string };
export type Turn = { id: string; speaker: string; topic: string | null; title: string; text: string };
export type SharedTopic = { id: string; title: string; turns: Turn[] };
export type ContextPacket = { person: string; own: Turn[]; shared: SharedTopic[] };

/** Match stable topic IDs, never guessed words or a person's display name. */
export function sharedTopics(turns: readonly Turn[], people: readonly Person[]): SharedTopic[] {
  if (people.length !== 2 || people[0].id === people[1].id) return [];
  const topics = new Map<string, Turn[]>();
  for (const turn of turns) {
    if (!turn.topic || !people.some(person => person.id === turn.speaker)) continue;
    topics.set(turn.topic, [...(topics.get(turn.topic) ?? []), turn]);
  }
  return [...topics].filter(([, entries]) => people.every(person => entries.some(turn => turn.speaker === person.id)))
    .map(([id, entries]) => ({ id, title: entries[0].title, turns: entries }));
}

/** This is the sole boundary for a person's Spark handoff. */
export function contextFor(person: Person, turns: readonly Turn[], shared: readonly SharedTopic[]): ContextPacket {
  return {
    person: person.name,
    own: turns.filter(turn => turn.speaker === person.id),
    shared: shared.map(topic => ({ ...topic, turns: [...topic.turns] })),
  };
}

export function roomPeople(map: MapSnapshot): Person[] {
  return [...map.speakers].filter(([, value]) => !value.ai)
    .map(([id]) => ({ id, name: id, role: "Developer" }));
}

/** Read completed, speaker-labelled turns already supplied by the host. No capture starts here. */
export function roomTurns(map: MapSnapshot): Turn[] {
  return map.thoughts.filter(turn => turn.complete && turn.text.trim() && !map.speakers.get(turn.speaker)?.ai)
    .slice().sort((a, b) => a.at_ms - b.at_ms || a.id.localeCompare(b.id))
    .map(turn => ({ id: turn.id, speaker: turn.speaker, topic: turn.thread_id,
      title: map.threads.find(topic => topic.id === turn.thread_id)?.title ?? "Unsorted thought", text: turn.text }));
}

export function packetText(packet: ContextPacket): string {
  return [`Developer: ${packet.person}`, "Use only this developer's words and the shared topics below.",
    "OWN WORDS", ...packet.own.map(turn => `[${turn.title}] ${turn.text}`),
    "SHARED WORDS", ...packet.shared.flatMap(topic => topic.turns.map(turn => `[${topic.title} · ${turn.speaker}] ${turn.text}`))].join("\n\n");
}
