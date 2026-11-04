export type ItemKind = "thought" | "decision" | "proposal" | "result" | "reminder" | "event";

const kinds: Record<ItemKind, { label: string; symbol: string }> = {
  thought: { label: "Thought", symbol: "◦" },
  decision: { label: "Recorded decision", symbol: "✓" },
  proposal: { label: "Proposal", symbol: "◇" },
  result: { label: "Helper result", symbol: "↳" },
  reminder: { label: "Reminder", symbol: "◷" },
  event: { label: "Event", symbol: "▦" },
};

/** Kind is supplied by the record, never guessed from its wording. */
export function ItemKindLabel({ kind }: { kind: ItemKind }) {
  const { label, symbol } = kinds[kind];
  return <span className="reading-format-kind" data-kind={kind}>
    <span aria-hidden="true">{symbol}</span>{label}
  </span>;
}
