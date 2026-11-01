import { useEffect, useRef, useState, type FormEvent } from "react";
import type { useCore } from "./core";
import type { MiniApp, Watcher } from "./apps-core";
import { playTune, unlockTune } from "./apps-audio";
import "./apps.css";

// "every day", "every 2 hours", "every 15 minutes": the largest unit that divides it evenly.
function every(secs: number): string {
  const units: [number, string][] = [[604800, "week"], [86400, "day"], [3600, "hour"], [60, "minute"], [1, "second"]];
  const [size, unit] = units.find(([size]) => secs % size === 0) ?? [1, "second"];
  return secs === size ? `every ${unit}` : `every ${secs / size} ${unit}s`;
}

function watching(w: Watcher): string {
  switch (w.kind) {
    case "new_thought": return w.min_points && w.min_points > 1 ? `A new thought, after ${w.min_points} points` : "A new thought";
    case "phrase": return `Hearing “${w.phrase}”`;
    case "topic": return `Talking about ${w.topic}`;
    case "volume": return `Loud voices for ${w.seconds} seconds`;
    case "time": return `${new Date(w.at_ms).toLocaleString()}${w.every_secs ? `, then ${every(w.every_secs)}` : ""}`;
    case "app_request": return "An app request";
  }
}

function Blocks({ app }: { app: MiniApp }) {
  return <ol className="apps-blocks" aria-label="App steps">
    <li><small>When</small>{watching(app.watcher)}</li>
    {app.prompt && <li><small>Consider</small>{app.watcher.kind === "app_request" ? "Look for an existing app" : "One prompt"}</li>}
    {app.publishers.map((p, i) => <li key={i}><small>Then</small>{p.kind === "card" ? "Show a card" : p.kind === "sound" ? "Play a light tune" : "Propose a reminder"}</li>)}
  </ol>;
}

export function Apps({ core }: { core: ReturnType<typeof useCore> }) {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState("");
  const build = core.apps.build;
  const buildArea = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const ready = build?.stage === "ready" || build?.stage === "matched";
  const busy = !!build && ["searching", "composing", "validating"].includes(build.stage);
  useEffect(() => {
    if (!core.snapshotRevision || initialized.current) return;
    initialized.current = true;
    if (core.world.apps.length === 0) setOpen(true);
  }, [core.snapshotRevision, core.world.apps.length]);
  useEffect(() => {
    if (build) setOpen(true);
  }, [build?.id]);
  useEffect(() => {
    if (open && build && ["searching", "ready", "matched", "failed", "kept"].includes(build.stage)) {
      buildArea.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      if ((ready || build.stage === "failed") && (document.activeElement === document.body || document.activeElement?.closest(".apps-form"))) {
        buildArea.current?.focus({ preventScroll: true });
      }
    }
  }, [build?.id, build?.stage, open]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!request.trim() || busy || ready || !core.connected) return;
    core.composeApp(request.trim());
    setRequest("");
    setOpen(true);
  };
  const matched = core.world.apps.find((a) => a.id === build?.match_id);
  const play = () => {
    unlockTune();
    window.setTimeout(() => {
      if (playTune()) core.apps.clearSound();
      else core.showNotice("Sound is unavailable here. You can choose a card instead.");
    }, 50);
  };
  const enabledCount = core.world.apps.filter((a) => a.enabled).length;
  return <aside className={`apps-panel${open ? " is-open" : ""}${core.apps.soundPending ? " has-sound" : ""}`} aria-label="Apps">
    <div className="apps-heading">
      <button className="apps-title" aria-expanded={open} aria-controls="apps-content" onClick={() => setOpen(!open)}>
        <span className="apps-mark" aria-hidden="true">✦</span><strong>Apps</strong><span>{enabledCount} on</span><span className="apps-toggle">{open ? "Close" : "Open"}</span>
      </button>
      {open && <button className="apps-new" onClick={() => document.getElementById("app-request")?.focus()}>Make an app</button>}
    </div>
    {core.apps.soundPending && <div className="apps-sound" role="status">
      <span>{core.apps.soundPending} has a quiet tune for you.</span><button onClick={play}>Play tune</button>
      <button onClick={core.apps.clearSound} aria-label="Dismiss tune">×</button>
    </div>}
    {open && <div id="apps-content">
      {build && <div className={`apps-build ${build.stage}`} ref={buildArea} tabIndex={-1} role="region" aria-label="App being composed">
        <p className="apps-request">“{build.request}”</p>
        <ol className="apps-progress" aria-live="polite" aria-relevant="additions text">
          {build.steps.map((step, i) => <li key={`${build.id}-${i}`} style={{ animationDelay: `${i * 70}ms` }}>
            <span aria-hidden="true">{busy && i === build.steps.length - 1 ? "◌" : build.stage === "failed" && i === build.steps.length - 1 ? "×" : "✓"}</span>{step}
          </li>)}
        </ol>
        {build.draft && !["kept", "discarded"].includes(build.stage) && <div className="apps-preview">
          <strong>{build.draft.name}</strong><p>{build.draft.purpose}</p><Blocks app={build.draft} />
          {build.draft.prompt && <details><summary>Prompt</summary><p className="apps-prompt">{build.draft.prompt.system}</p></details>}
          {build.draft.publishers.some((p) => p.kind === "reminder") && <p className="apps-help">Reminders wait for your approval on the map.</p>}
        </div>}
        {matched && build.stage === "matched" && <div className="apps-preview"><a href={`#app-${matched.id}`}>{matched.name}</a><p>{matched.purpose}</p><Blocks app={matched} /></div>}
        {ready && <div className="apps-decisions">
          <button disabled={!core.connected} onClick={() => core.decideApp(build.id, true)}>{build.stage === "matched" ? "Use this app" : "Keep app"}</button>
          <button className="quiet" disabled={!core.connected} onClick={() => core.decideApp(build.id, false)}>{build.stage === "matched" ? "Dismiss" : "Discard"}</button>
        </div>}
        {["kept", "discarded"].includes(build.stage) && <p role="status">{build.message}</p>}
      </div>}
      <form className="apps-form" onSubmit={submit}>
        <label htmlFor="app-request">What would you like an app to do?</label>
        <div><input id="app-request" value={request} onChange={(e) => setRequest(e.target.value)} maxLength={2000}
          placeholder="Show a card when I mention the demo" disabled={busy || ready} />
          <button disabled={!core.connected || !request.trim() || busy || ready}>Make app</button></div>
        <p className="apps-help">You can also say “make an app that…” while the mic is on.</p>
      </form>
      <div className="apps-list">
        {core.world.apps.length > 0 && <h2 className="apps-list-heading">Your apps</h2>}
        {core.world.apps.map((app) => <article className="apps-row" key={app.id} id={`app-${app.id}`}>
          <div className="apps-info"><strong>{app.name}</strong><p>{app.purpose}</p>
            <details><summary>Steps</summary><Blocks app={app} />
              {app.prompt && <p className="apps-prompt">{app.prompt.system}</p>}
              <button className="apps-remove" disabled={!core.connected} onClick={() => core.removeApp(app.id)}>Remove app</button>
            </details>
            {app.id === "app-volume" && app.watcher.kind === "volume" && <label className="apps-output">When it gets loud
              <select aria-label={`${app.name} response`} value={app.publishers.some((p) => p.kind === "sound") ? "sound" : "card"}
                disabled={!core.connected} onChange={(e) => { if (e.target.value === "sound") unlockTune(); core.appOutput(app.id, e.target.value === "sound"); }}>
                <option value="card">Show a calm card</option><option value="sound">Play a light tune</option>
              </select>
            </label>}
          </div>
          <button className={`apps-switch ${app.enabled ? "on" : ""}`} role="switch" aria-checked={app.enabled}
            aria-label={app.name} disabled={!core.connected} onClick={() => core.toggleApp(app.id, !app.enabled)}>{app.enabled ? "On" : "Off"}</button>
        </article>)}
      </div>
    </div>}
  </aside>;
}
