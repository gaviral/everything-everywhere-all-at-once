import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DependencySequences, dependencySequencesFeature } from "./index";
import type { DependencyAdapter, DependencySnapshot } from "./contracts";
import { syntheticSnapshot } from "./fixtures";

function Preview() {
  const [enabled, setEnabled] = useState<boolean>(dependencySequencesFeature.defaultEnabled);
  const [counts, setCounts] = useState({ reads: 0, subscriptions: 0 });
  const [completed, setCompleted] = useState(false);
  const mode = useRef("normal"), held = useRef<(() => void) | null>(null);
  const complete = useRef(false), listeners = useRef(new Set<() => void>());
  const queuedUpdate = useRef<(() => void) | null>(null);
  const enableButton = useRef<HTMLButtonElement>(null);
  const [adapter] = useState<DependencyAdapter>(() => ({
    async readSnapshot({ signal }) {
      setCounts(counts => ({ ...counts, reads: counts.reads + 1 }));
      if (mode.current === "fail") throw new Error("Synthetic unavailable snapshot");
      if (mode.current === "invalid") return { revision: "invalid", parts: [{ id: "B" }] } as unknown as DependencySnapshot;
      if (mode.current === "hold") await new Promise<void>(resolve => { held.current = resolve; signal.addEventListener("abort", () => { held.current = null; resolve(); }, { once: true }); });
      if (mode.current === "empty") return { revision: "sample-empty", parts: [] };
      const snapshot = syntheticSnapshot(complete.current);
      return mode.current === "remove" ? { ...snapshot, parts: snapshot.parts.filter(part => part.id !== "B") } : snapshot;
    },
    subscribe(changed) {
      queuedUpdate.current = changed;
      listeners.current.add(changed); setCounts(counts => ({ ...counts, subscriptions: counts.subscriptions + 1 }));
      return () => { listeners.current.delete(changed); setCounts(counts => ({ ...counts, subscriptions: counts.subscriptions - 1 })); };
    },
  }));
  useEffect(() => { if (!enabled) enableButton.current?.focus(); }, [enabled]);
  function changeMode(next: string) { mode.current = next; listeners.current.forEach(changed => changed()); }
  return <>
    <section className="ds-preview-host" aria-label="Synthetic preview host"><h2>Host preview</h2><p>Synthetic data only · Feature is {enabled ? "on" : "off"} · No job or external action is available.</p>
      <p aria-label="Adapter activity">Snapshot reads: {counts.reads} · Active subscriptions: {counts.subscriptions}</p>
      {!enabled && <button ref={enableButton} onClick={() => setEnabled(true)}>Enable dependency sequences</button>}
      {!enabled && counts.reads > 0 && <button onClick={() => queuedUpdate.current?.()}>Deliver queued update</button>}
      {enabled && <div className="ds-preview-controls" aria-label="Synthetic fixture controls">
        <button onClick={() => { complete.current = !complete.current; setCompleted(complete.current); changeMode("normal"); }}>{completed ? "Reset A to pending" : "Mark A complete"}</button>
        <button onClick={() => changeMode("fail")}>Simulate unavailable snapshot</button>
        <button onClick={() => changeMode("invalid")}>Simulate invalid snapshot</button>
        <button onClick={() => changeMode("remove")}>Hide B in snapshot</button>
        <button onClick={() => changeMode("empty")}>Supply empty snapshot</button>
        <button onClick={() => changeMode("normal")}>Restore sample snapshot</button>
        <button onClick={() => changeMode("hold")}>Hold next read</button>
        <button onClick={() => { mode.current = "normal"; held.current?.(); held.current = null; }}>Release held read</button>
      </div>}
    </section>
    <DependencySequences enabled={enabled} adapter={adapter} onDisable={() => setEnabled(false)} />
  </>;
}

createRoot(document.getElementById("root")!).render(<Preview />);
