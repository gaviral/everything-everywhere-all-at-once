import type { RecoveryState } from "./waiting";
import "./recovery-panel.css";

/** B2 mounts this with useCore's recovery state/actions and its current composer draft. */
export type RecoveryPanelProps = {
  recovery: RecoveryState;
  recover: (id: string) => boolean;
  discardRecovery: (id: string) => void;
  draft: string;
  clearDraft: (exact: string) => void;
  sendOnline: (text: string, received: () => void) => boolean;
};
export default function RecoveryPanel({ recovery, recover, discardRecovery, draft, clearDraft, sendOnline }: RecoveryPanelProps) {
  if (!recovery.entries.length && !recovery.storageUnavailable) return null;
  return <section className="recovery-panel" aria-label="Words to recover">
    {recovery.storageUnavailable && <article>
      <p role="status">These words could not be saved on this device. Keep this window open until the receipt arrives.</p>
      <button type="button" disabled={!draft.trim() || !recovery.onlineAvailable || recovery.onlinePending} onClick={() => {
        const exact = draft;
        sendOnline(exact, () => clearDraft(exact));
      }}>{recovery.onlinePending ? "Waiting for receipt…" : "Send online"}</button>
    </article>}
    {recovery.entries.map((entry) => <article key={entry.id}>
      <p>{entry.kind === "speech" ? "Unfinished speech" : "Saved words from another or unknown map"}</p>
      <blockquote>{entry.text}</blockquote>
      <button type="button" onClick={() => recover(entry.id)}>Keep in this map</button>
      <button type="button" onClick={() => discardRecovery(entry.id)}>Discard</button>
    </article>)}
  </section>;
}
