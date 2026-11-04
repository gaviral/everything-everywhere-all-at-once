export const looks = [
  { id: "original", name: "Original" },
  { id: "orbit", name: "Orbit" },
  { id: "paper", name: "Paper" },
  { id: "signal", name: "Signal" },
] as const;
export type Look = typeof looks[number]["id"];

export function LookPicker({ look, onChange }: { look: Look; onChange: (look: Look) => void }) {
  return <div className="pd-look-picker" role="group" aria-label="Presentation look">
    <span>Look</span>{looks.map(option => <button key={option.id} type="button" data-look-choice={option.id}
      aria-pressed={look === option.id} onClick={() => onChange(option.id)}>{option.name}</button>)}
  </div>;
}
