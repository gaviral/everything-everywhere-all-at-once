import { useEffect, useRef, useState, type ReactNode } from "react";
import { Keycap } from "./parts";

/** A name stays until its shortcut successfully opens the action; clicks alone never count as learning. */
export function LearnedAction({ id, label, icon, shortcut, active, onClick, guide, controls, tip, learningEnabled = true, keepLabel = false }: {
  id: string; label: string; icon: ReactNode; shortcut: string; active: boolean; onClick(): void;
  guide?: string; controls?: string; tip: string; learningEnabled?: boolean; keepLabel?: boolean;
}) {
  const storageKey = `e2a2o.learned-action.${id}`;
  const [learned, setLearned] = useState(() => {
    try { return localStorage.getItem(storageKey) === "1"; } catch { return false; }
  });
  const shortcutEvent = useRef<KeyboardEvent | null>(null);
  const wasActive = useRef(active);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "");
      shortcutEvent.current = learningEnabled && event.isTrusted && !event.repeat && !typing && !event.metaKey && !event.ctrlKey && !event.altKey
        && event.key.toLowerCase() === shortcut.toLowerCase() ? event : null;
    };
    const pointer = () => { shortcutEvent.current = null; };
    document.addEventListener("keydown", key, true);
    document.addEventListener("pointerdown", pointer, true);
    return () => { document.removeEventListener("keydown", key, true); document.removeEventListener("pointerdown", pointer, true); };
  }, [shortcut, learningEnabled]);
  useEffect(() => {
    if (learningEnabled && active && !wasActive.current && shortcutEvent.current?.defaultPrevented) {
      setLearned(true);
      try { localStorage.setItem(storageKey, "1"); } catch { /* The visible choice still lasts for this page. */ }
    }
    wasActive.current = active;
    shortcutEvent.current = null;
  }, [active, learningEnabled, storageKey]);
  const compact = learningEnabled && !keepLabel && learned;
  return <button type="button" className={`shell-pill shell-button learned-action${compact ? " learned-action-compact" : ""}${active ? " shell-on" : ""}`}
    aria-label={label} aria-pressed={active} aria-keyshortcuts={shortcut} aria-controls={controls} data-guide={guide} data-tip={tip} onClick={onClick}>
    {icon}<span className={compact ? "sr-only" : "learned-action-word"}>{label}</span><Keycap>{shortcut}</Keycap>
  </button>;
}
