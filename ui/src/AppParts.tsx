import { useSyncExternalStore } from "react";
import type { MiniApp } from "./apps-core";
import { appParts, partUses, type AppPart, type PartsState } from "./app-parts";
import { tuneRunning, watchTune } from "./apps-audio";
import "./app-parts.css";

export type AppPartsState = Omit<PartsState, "sound">;

/** Read-only disclosure: opening it never runs, enables or edits the app. */
export function AppParts({ app, apps, state }: { app: MiniApp; apps: readonly MiniApp[]; state: AppPartsState }) {
  const sound = useSyncExternalStore(watchTune, tuneRunning, () => false);
  const parts = appParts(app, { ...state, sound });
  const uses = partUses(apps);
  const unavailable = parts.some((part) => !!part.unavailable);
  const branch = (part: AppPart, index: number) => {
    const use = uses.get(part.id);
    return <li key={`${part.id}-${index}`} data-part={part.id}>
      <div className="app-part-heading"><strong>{part.name}</strong><span className={part.unavailable ? "part-status" : "part-status part-live"}>{part.unavailable ? "Unavailable" : "Live"}</span></div>
      {part.unavailable && <p className="part-reason">{part.unavailable}</p>}
      {use && use.places > 1 && <p className="part-reuse">Used in {use.apps.length} {use.apps.length === 1 ? "app" : "apps"} · {use.places} places<br />{use.apps.map((a) => a.name).join(", ")}</p>}
      <details className="part-details"><summary>Source &amp; settings<span className="sr-only"> for {part.name}</span></summary>
        <p className="part-source">{part.source}</p><pre>{part.configuration}</pre>
      </details>
      {part.children.length > 0 && <ul>{part.children.map(branch)}</ul>}
    </li>;
  };
  return <details className="app-parts">
    <summary aria-label={`Inspect ${app.name} parts`}>Parts</summary>
    <div className="app-parts-body">
      <p className="app-parts-note">Read-only · Live means available here, not running. App is {app.enabled ? "on" : "off"}. Reuse counts saved placements, including unavailable ones.</p>
      <ul className="app-parts-tree" aria-label={`${app.name} composition`}>
        <li><div className="app-part-heading"><strong>{app.name}</strong><span className={unavailable ? "part-status" : "part-status part-live"}>{unavailable ? "Unavailable" : "Live"}</span></div>
          <ul>{parts.map(branch)}</ul>
        </li>
      </ul>
    </div>
  </details>;
}
