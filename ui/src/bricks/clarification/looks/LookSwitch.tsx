export type Look = "original" | "margin" | "paper" | "night";

const looks: { id: Look; label: string }[] = [
  { id: "original", label: "Original" },
  { id: "margin", label: "Margin" },
  { id: "paper", label: "Paper" },
  { id: "night", label: "Night" },
];

export function LookSwitch({ look, onChange }: { look: Look; onChange: (look: Look) => void }) {
  return <fieldset className="clarification-look-switch">
    <legend>Look</legend>
    {looks.map(item => <button type="button" key={item.id} aria-pressed={look === item.id} onClick={() => onChange(item.id)}>{item.label}</button>)}
  </fieldset>;
}
