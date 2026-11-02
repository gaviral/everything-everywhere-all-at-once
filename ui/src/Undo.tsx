import "./undo.css";

/** Undo on a notice that answers a request you can take back (a filing, a fold, a correction): the core sends its id
 *  right after the notice, and a newer notice drops it. Spoken, it's "scratch that". */
export function UndoButton({ id, onUndo }: { id: number | null; onUndo: (id: number) => void }) {
  if (id == null) return null;
  return <button className="undo" onClick={() => onUndo(id)}>Undo</button>;
}
