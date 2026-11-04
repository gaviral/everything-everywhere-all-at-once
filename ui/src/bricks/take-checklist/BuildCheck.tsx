import { CheckTile } from "./CheckTile";
import { commitHash } from "./checks";

export function BuildCheck({ reported, entered, checked, onEnter, onToggle }: {
  reported: string | null; entered: string; checked: boolean;
  onEnter: (value: string) => void; onToggle: () => void;
}) {
  if (reported) return <CheckTile title="This build" detail={reported} done source="Page reports · commit" />;
  return <CheckTile title="Which build?" detail={checked ? "Commit entered and checked by you." : "Page commit unavailable. Check by hand."}
    done={checked} source={checked ? "Checked by you" : "Check by hand"}>
    <div className="take-checklist-build-input">
      <input aria-label="Commit hash checked by hand" placeholder="Commit hash" value={entered}
        maxLength={40} spellCheck={false} autoComplete="off" onChange={event => onEnter(event.target.value)} />
      <button type="button" aria-label="Confirm build commit" aria-pressed={checked}
        disabled={!commitHash(entered)} onClick={onToggle}>{checked ? "✓" : "Tick"}</button>
    </div>
  </CheckTile>;
}
