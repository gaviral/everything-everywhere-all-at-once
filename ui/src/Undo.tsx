import "./undo.css";
import { undoKeyLabel } from "./notice-rules";

/** Undo on a notice that answers a request you can take back (a filing, a fold, a correction): the core sends its id
 *  right after the notice, and a newer notice drops it. It names what it takes back (the notice's words) and the
 *  other ways to: the key, which shows here so it's learned, and "undo that", which work after the notice goes. */
export function UndoButton({ id, onUndo, what, mac, offline = false }: { id: number | null; onUndo: (id: number) => void; what: string; mac: boolean; offline?: boolean }) {
  if (id == null) return null;
  const key = undoKeyLabel(mac);
  return (
    // Away from the core it couldn't reach it: disabled, as the window's other core buttons are, until it's back.
    <button className="undo" data-guide="undo" disabled={offline} onClick={() => onUndo(id)} aria-label={`Undo “${what}”`} aria-keyshortcuts={mac ? "Meta+Z" : "Control+Z"}
      title={`Takes back “${what}”. ${key} or say “undo that” work too, after this goes.`}>
      Undo <kbd aria-hidden="true">{key}</kbd>
    </button>
  );
}
