export type Look = "current" | "orbit" | "signal" | "paper";

const looks: { id: Look; label: string }[] = [
  { id: "current", label: "Current" },
  { id: "orbit", label: "Orbit" },
  { id: "signal", label: "Signal" },
  { id: "paper", label: "Paper" },
];

export function LookSwitch({ value, onChange }: { value: Look; onChange: (look: Look) => void }) {
  return <div className="worktree-map-look-switch" role="group" aria-label="Presentation look">
    <span>Look</span>{looks.map(look => <button key={look.id} type="button" aria-pressed={value === look.id} onClick={() => onChange(look.id)}>{look.label}</button>)}
  </div>;
}
