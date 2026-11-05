// The board: what's been built so far, part by part, as each one merges.
import { PartView } from "./kit";
import { merged, type Run } from "./run";

export function Board({ run }: { run: Run }) {
  const parts = merged(run);
  return <section className="crew-board" aria-label="What's merged so far">
    {parts.map((part, index) => part.spec && <div key={part.id} className="crew-card">
      <div className="crew-card-meta"><span>Part {String(index + 1).padStart(2, "0")}</span><span>{part.fixed ? "Fixed · merged" : "Merged"}</span></div>
      <PartView spec={part.spec} />
    </div>)}
    {!parts.length && <p className="crew-board-empty">Parts land here as they merge.</p>}
  </section>;
}
