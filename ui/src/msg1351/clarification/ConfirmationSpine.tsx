import { useId } from "react";

export function ConfirmationSpine({ quote, understanding, onChange, disabled }: {
  quote: string; understanding: string; onChange(value: string): void; disabled: boolean;
}) {
  const id = useId();
  return <div className="clarification-spine">
    <h3>What does “{quote}” mean here?</h3>
    <label htmlFor={id}>My current understanding</label>
    <input id={id} value={understanding} onChange={(event) => onChange(event.target.value)}
      maxLength={120} placeholder="A few words in your own terms" disabled={disabled} />
    <small>Confirming keeps this explanation beside the original words.</small>
  </div>;
}
