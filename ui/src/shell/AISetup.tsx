import { useEffect, useRef } from "react";
import { AI_SETUP_STEPS, useSite } from "../site";

/** A deliberate setup step, separate from the map and its history. */
export function AISetup({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { hosted } = useSite();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current!.showModal();
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className="ai-setup" aria-labelledby="ai-setup-title" onCancel={onClose}>
    <h2 id="ai-setup-title">Set up AI</h2>
    {hosted ? <p>Ask the person running this site to add a working Meta AI key, then return here.</p>
      : <ol>{AI_SETUP_STEPS.map(step => <li key={step}>{step}</li>)}</ol>}
    <p>You can keep exploring the map and saving typed thoughts while AI is unavailable.</p>
    <button type="button" className="shell-btn" onClick={onClose} aria-keyshortcuts="Enter" autoFocus>Back to the map</button>
  </dialog>;
}
