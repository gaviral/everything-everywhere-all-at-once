import { useSyncExternalStore } from "react";
import type { VariantSession } from "./selection";
import { VariantReference } from "./VariantReference";

export function VariantSelection({ session }: { session: VariantSession }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return <section aria-label="Choose feature set">
    <h3>Choose one feature set</h3>
    <p>Selection is kept in this session. The host applies the active choice.</p>
    <div className="demo-variants-choices">{session.references.map(reference => <article key={reference.id}>
      <VariantReference reference={reference} />
      <button type="button" aria-pressed={state.selectedId === reference.id} onClick={() => session.select(reference.id)}>
        Use {reference.title}
      </button>
    </article>)}</div>
    <button type="button" disabled={!state.selectedId} onClick={session.disableSelection}>Disable choice</button>
    <p role="status">{state.activeId ? `Active choice: ${session.references.find(r => r.id === state.activeId)!.title}`
      : state.selectedId ? "Feature off. Choice retained; no active feature set." : "No active feature set."}</p>
  </section>;
}
