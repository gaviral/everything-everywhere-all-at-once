import type { ReactNode } from "react";
import { DecisionEmphasis } from "./emphasis";
import { ItemKindLabel, type ItemKind } from "./kind";

export type ProposalContent = { what: string; why?: string; how?: string; emphasis?: readonly string[] };

/** These slots keep the caller's warnings and action handlers outside the formatting switch. */
export function ReadingCard({ kind, title, meta, warnings, actions, children }: {
  kind: ItemKind; title: string; meta?: ReactNode; warnings?: ReactNode; actions?: ReactNode; children: ReactNode;
}) {
  return <article className="reading-format-card" data-kind={kind}>
    <div className="reading-format-card-top"><ItemKindLabel kind={kind} />{meta && <span className="reading-format-meta">{meta}</span>}</div>
    <h2 className="reading-format-card-title">{title}</h2>
    <div className="reading-format-content">{children}</div>
    {warnings && <div className="reading-format-warning">{warnings}</div>}
    {actions && <div className="reading-format-actions">{actions}</div>}
  </article>;
}

export function What({ text, emphasis }: { text: string; emphasis?: readonly string[] }) {
  return <section className="reading-format-what" aria-label="What"><h3>What</h3>
    <p><DecisionEmphasis text={text} phrases={emphasis} /></p></section>;
}

export function Why({ text }: { text?: string }) {
  return <section className="reading-format-why" aria-label="Why"><h3>Why</h3>
    <p>{text || "No reason supplied in this item."}</p></section>;
}

export function How({ text }: { text?: string }) {
  return <section className="reading-format-how" aria-label="How"><h3>How</h3>
    <p>{text || "No steps supplied in this item."}</p></section>;
}

/** Only structured fields become sections. Freeform results stay intact as children. */
export function Proposal({ content, reading }: { content: ProposalContent; reading: boolean }) {
  if (!reading) return <div className="reading-format-plain">
    <p>What: {content.what}</p>{content.why && <p>Why: {content.why}</p>}{content.how && <p>How: {content.how}</p>}
  </div>;
  return <div className="reading-format-proposal">
    <What text={content.what} emphasis={content.emphasis} />
    <div className="reading-format-reasons"><Why text={content.why} /><How text={content.how} /></div>
  </div>;
}
