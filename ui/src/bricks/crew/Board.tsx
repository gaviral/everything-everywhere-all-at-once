// The board: the thing being built, part by part, as each one merges.
import { framed, SEALED } from "./frame";
import { merged, type Run } from "./run";

export function Board({ run }: { run: Run }) {
  const parts = merged(run);
  return <section className="crew-board" aria-label="What's merged so far">
    {parts.map(part => <figure key={part.id} className="crew-card">
      <iframe title={part.name} sandbox={SEALED} srcDoc={framed(part.html ?? "")} />
      <figcaption>{part.name}<span>{part.commit}</span></figcaption>
    </figure>)}
    {!parts.length && <p className="crew-board-empty">Parts appear here as they merge.</p>}
  </section>;
}
