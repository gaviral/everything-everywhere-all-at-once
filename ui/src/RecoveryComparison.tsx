import { useEffect, useState, type HTMLAttributes, type ReactNode } from "react";
import type { Thread } from "./core";
import "./recovery-comparison.css";

/** Presentation only: both layouts use the host's existing named return and dismissal operations. */
export default function RecoveryComparison({ enabled, source, quote, finish, later, forget, hold, children }: {
  enabled: boolean;
  source: Thread | null;
  quote: string;
  finish: (source: Thread, keyboard: boolean) => unknown;
  later: (source: Thread) => void;
  forget: (source: Thread) => void;
  hold: HTMLAttributes<HTMLElement>;
  children: ReactNode;
}) {
  // A visit-local choice, discarded when the setting is turned off. No preset or retained taste inference.
  const [variant, setVariant] = useState<"Card" | "Compact">("Card");
  useEffect(() => { if (!enabled) setVariant("Card"); }, [enabled]);
  if (!enabled) return <>{children}</>;
  return <section className="recovery-comparison" aria-label="Compare return controls" {...hold}
    data-variant={variant} data-return-pause={source?.return_source?.id}
    data-return-thought={source?.return_source?.thought_id} data-return-thread={source?.id}>
    <div className="recovery-comparison-choices" role="group" aria-label="Return controls">
      <span>{source && !source.return_source ? "Topic return" : "Compare return controls"}</span>
      {(["Card", "Compact"] as const).map(choice => <button key={choice} type="button" aria-pressed={variant === choice}
        onClick={() => setVariant(choice)}>{choice}</button>)}
    </div>
    {variant === "Card" ? children : source && <div className="recovery-compact" data-dock-card>
      <button type="button" className="recovery-compact-return" disabled={!source.return_source}
        onClick={event => finish(source, event.detail === 0)}>Return to {source.title}</button>
      <details key={source.return_source?.id ?? source.id}>
        <summary>Details</summary>
        <blockquote>{quote}</blockquote>
        {!source.return_source && <p>Exact interruption source unavailable.</p>}
        <div className="pullback-actions">
          <button type="button" className="quiet" onClick={() => later(source)}>Later</button>
          <button type="button" className="quiet" onClick={() => forget(source)}>Forget it</button>
        </div>
      </details>
    </div>}
  </section>;
}
