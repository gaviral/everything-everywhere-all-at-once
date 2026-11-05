import { useState } from "react";
import { contextFor, packetText, type Person, type Turn, type SharedTopic } from "./context";
import { exampleOutput } from "./example";

const tones: Record<string, string> = { peach: "pair-room-peach", mint: "pair-room-mint" };

export function NameChip({ person, tone }: { person: Person; tone: string }) {
  return <span className={`pair-room-name ${tones[tone]}`}><span className="pair-room-avatar">{person.name.slice(0, 1)}</span>{person.name}</span>;
}

function SparkCard({ person, turns, shared, example }: { person: Person; turns: Turn[]; shared: SharedTopic[]; example: boolean }) {
  const [output, setOutput] = useState<"ask" | "build" | null>(null);
  const packet = contextFor(person, turns, shared);
  return <section className="pair-room-spark" aria-label={`Spark for ${person.name}`}>
    <div className="pair-room-spark-heading"><span>✳</span><strong>Spark for {person.name}</strong></div>
    <p>{example ? "Example responses · no model calls" : "Context ready for Spark · preview only"}</p>
    {example && <div className="pair-room-actions">
      <button type="button" aria-pressed={output === "ask"} onClick={() => setOutput(output === "ask" ? null : "ask")}>Ask a question <span>↗</span></button>
      <button type="button" aria-pressed={output === "build"} onClick={() => setOutput(output === "build" ? null : "build")}>Build a draft <span>↗</span></button>
    </div>}
    {example && output && <div className="pair-room-output" role="status"><span className="pair-room-eyebrow">{output === "ask" ? "Example question" : "Example draft · not executed"}</span>
      {output === "build" ? <pre>{exampleOutput(packet, output)}</pre> : <p>{exampleOutput(packet, output)}</p>}
    </div>}
    <details className="pair-room-context"><summary>Inspect {person.name}'s context <span>{packet.own.length} own · {shared.length} shared</span></summary>
      <p>Only {person.name}'s words and the shared topics. Other personal topics stay out.</p><pre>{packetText(packet)}</pre>
    </details>
  </section>;
}

export function DeveloperLane({ person, tone, turns, shared, partial, example }: { person: Person; tone: string; turns: Turn[]; shared: SharedTopic[]; partial: Turn | null; example: boolean }) {
  const own = turns.filter(turn => turn.speaker === person.id);
  const speaking = partial?.speaker === person.id;
  return <section className={`pair-room-lane ${tones[tone]}`} aria-label={`${person.name}'s lane`}>
    <div className="pair-room-lane-title"><NameChip person={person} tone={tone} /><span className="pair-room-label">{speaking ? "Speaking…" : person.role}</span></div>
    <div className="pair-room-thread" aria-label={`${person.name}'s words`}>
      {own.map(turn => <article className="pair-room-turn" key={turn.id}><span className="pair-room-eyebrow">{turn.title}</span><p>{turn.text}</p></article>)}
      {speaking && <article className="pair-room-turn pair-room-partial"><span className="pair-room-eyebrow">{partial.title} · arriving</span><p>{partial.text}<span className="pair-room-caret" aria-hidden="true">▍</span></p></article>}
      {!own.length && !speaking && <p className="pair-room-empty">{person.name}'s next completed turn will appear here.</p>}
    </div>
    <SparkCard person={person} turns={turns} shared={shared} example={example} />
  </section>;
}

export function SharedColumn({ topics, people }: { topics: SharedTopic[]; people: Person[] }) {
  return <aside className="pair-room-shared" aria-label="Shared context">
    <span className="pair-room-orbit" aria-hidden="true">◎</span>
    <span className="pair-room-eyebrow">Where your thinking meets</span><h2>Shared ground</h2>
    <p className="pair-room-shared-intro">Same topic. Both voices. Context you can each build on.</p>
    {topics.map(topic => <section className="pair-room-shared-topic" key={topic.id}>
      <h3>{topic.title}</h3><span className="pair-room-shared-badge">↔ Both contributed</span>
      {people.map((person, i) => <div className="pair-room-shared-voice" key={person.id}><NameChip person={person} tone={i === 0 ? "peach" : "mint"} />
        {topic.turns.filter(turn => turn.speaker === person.id).map(turn => <p key={turn.id}>{turn.text}</p>)}
      </div>)}
    </section>)}
    {!topics.length && <p className="pair-room-empty">A topic appears here once both developers have spoken about it.</p>}
    <p className="pair-room-shared-note">Shared topics contain both speakers' words. Everything else stays in its own lane.</p>
  </aside>;
}
