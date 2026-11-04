import { useEffect, useRef, useState } from "react";
import type { AppRecipe, BrickProps, MiniApp, RecipeSave } from "../contract";
import { parseRecipe, previewRecipe, RECIPE_MAX } from "./rules";
import "./app-recipes.css";

type Draft = { mode: "preview" | "fork" | "loaded" | "export"; recipe: AppRecipe; source: MiniApp | null; bytes: string };
export default function AppRecipes({ map, actions, brick }: BrickProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [saved, setSaved] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const mounted = useRef(true);
  const busy = useRef(false);
  const identity = useRef<{ fingerprint: string; id: string } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!draft) return;
    const d = dialog.current!; d.showModal();
    d.querySelector<HTMLElement>("input, button")?.focus();
    return () => { d.close(); returnTo.current?.focus({ preventScroll: true }); };
  }, [!!draft]);
  const open = (next: Draft) => { returnTo.current = document.activeElement as HTMLElement; setMessage(""); setSaved(false); identity.current = null; setDraft(next); };
  const fromApp = (app: MiniApp, mode: Draft["mode"]) => {
    try {
      const bytes = actions.exportRecipe(app), recipe = parseRecipe(bytes);
      open({ mode, recipe, source: structuredClone(app), bytes });
    } catch (e) { setMessage(String((e as Error).message)); }
  };
  const edit = (patch: Partial<AppRecipe>) => {
    if (!draft || busy.current) return;
    setDraft({ ...draft, recipe: { ...draft.recipe, ...patch } }); setSaved(false); setMessage("");
  };
  const save = async () => {
    if (!draft || busy.current || saved) return;
    try {
      const recipe = parseRecipe(JSON.stringify(draft.recipe));
      const source = draft.mode === "fork" ? draft.source : null;
      const fingerprint = JSON.stringify({ recipe, source });
      if (identity.current?.fingerprint !== fingerprint) identity.current = { fingerprint, id: crypto.randomUUID() };
      const request: RecipeSave = { request_id: identity.current.id, recipe, source };
      busy.current = true; setWaiting(true); setMessage("Waiting for core save receipt…");
      const result = await actions.saveRecipe(request);
      if (mounted.current) {
        if (result.request_id !== request.request_id) { setMessage("Save receipt did not match. Draft kept."); return; }
        setSaved(!!result.app_id); setMessage(result.message);
      }
    } catch (e) { if (mounted.current) setMessage((e as Error).message); }
    finally { busy.current = false; if (mounted.current) setWaiting(false); }
  };
  const r = draft?.recipe;
  const editable = draft?.mode === "fork" || draft?.mode === "loaded";
  return <aside className="app-recipes" aria-label={brick.name}>
    <details><summary>{brick.name} · {map.apps.length} apps</summary>
      <p>Copies start disabled. Enable them separately in Apps.</p>
      <label className="app-recipes-file">Import recipe<input type="file" accept="application/json,.json" onChange={async e => {
        const file = e.currentTarget.files?.[0]; e.currentTarget.value = "";
        if (!file) return;
        try {
          if (file.size > RECIPE_MAX) throw Error("Recipe must be at most 32 KiB.");
          const bytes = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
          const recipe = parseRecipe(bytes);
          if (mounted.current) open({ mode: "loaded", recipe, source: null, bytes: JSON.stringify(recipe, null, 2) });
        } catch (err) { if (mounted.current) setMessage((err as Error).message); }
      }} /></label>
      <ul className="app-recipes-apps">{map.apps.map(app => <li key={app.id} data-recipe-app={app.id}>
        <strong>{app.name}</strong><span>{app.enabled ? "Enabled" : "Disabled"}</span>
        <div className="app-recipes-buttons">
          <button onClick={() => fromApp(app, "preview")}>Preview recipe</button>
          <button onClick={() => fromApp(app, "fork")}>Fork</button>
          <button onClick={() => fromApp(app, "export")}>Export recipe</button>
        </div>
      </li>)}</ul>
    </details>
    {!draft && message && <p role="status">{message}</p>}
    {draft && r && <dialog ref={dialog} className="app-recipes-dialog" aria-labelledby="recipe-heading" onCancel={e => { e.preventDefault(); if (!busy.current) setDraft(null); }}>
      <div className="app-recipes-dialog-body">
        <h2 id="recipe-heading">{draft.mode === "fork" ? "Fork app" : draft.mode === "loaded" ? "Import Preview" : draft.mode === "export" ? "Export recipe" : "Preview recipe"}</h2>
        {editable && <fieldset disabled={waiting || saved}>
          <label>Name<input data-recipe-name value={r.name} onChange={e => edit({ name: e.target.value })} /></label>
          <label>Purpose<input value={r.purpose} onChange={e => edit({ purpose: e.target.value })} /></label>
          <label>Watcher<select value={r.watcher.kind} onChange={e => edit({ watcher: e.target.value === "phrase" ? { kind: "phrase", phrase: "" } : e.target.value === "topic" ? { kind: "topic", topic: "" } : e.target.value === "volume" ? { kind: "volume", level: .1, seconds: 3 } : { kind: "new_thought", min_points: 0 } })}>
            <option value="phrase">Phrase</option><option value="topic">Topic</option><option value="new_thought">New thought</option><option value="volume">Volume</option>
          </select></label>
          {r.watcher.kind === "phrase" && <label>Phrase<input data-recipe-phrase value={r.watcher.phrase} onChange={e => edit({ watcher: { kind: "phrase", phrase: e.target.value } })} /></label>}
          {r.watcher.kind === "topic" && <label>Topic<input value={r.watcher.topic} onChange={e => edit({ watcher: { kind: "topic", topic: e.target.value } })} /></label>}
          {r.watcher.kind === "new_thought" && <label>Minimum points<input type="number" min="0" max="8" value={r.watcher.min_points ?? 0} onChange={e => edit({ watcher: { kind: "new_thought", min_points: +e.target.value } })} /></label>}
          {r.watcher.kind === "volume" && <><label>Volume level<input type="number" min="0.01" max="1" step="0.01" value={r.watcher.level} onChange={e => edit({ watcher: { ...r.watcher as { kind: "volume"; level: number; seconds: number }, level: +e.target.value } })} /></label>
            <label>Seconds<input type="number" min="1" max="30" value={r.watcher.seconds} onChange={e => edit({ watcher: { ...r.watcher as { kind: "volume"; level: number; seconds: number }, seconds: +e.target.value } })} /></label></>}
          <label>Cooldown seconds<input type="number" min="10" max="3600" value={r.cooldown_secs} onChange={e => edit({ cooldown_secs: +e.target.value })} /></label>
          <label><input type="checkbox" checked={!!r.prompt} onChange={e => edit({ prompt: e.target.checked ? { system: "", template: "{thought}" } : null })} />Optional prompt</label>
          {r.prompt && <><label>Prompt<textarea value={r.prompt.system} onChange={e => edit({ prompt: { ...r.prompt!, system: e.target.value } })} /></label>
            <label>Input template<textarea value={r.prompt.template} onChange={e => edit({ prompt: { ...r.prompt!, template: e.target.value } })} /></label></>}
          {r.publishers.map((p, i) => {
            const update = (patch: object) => edit({ publishers: r.publishers.map((old, j) => j === i ? { ...old, ...patch } : old) });
            return <div key={i} className="app-recipes-publisher"><strong>{p.kind === "card" ? "Card" : p.kind === "sound" ? "Sound" : "Reminder for approval"}</strong>
              {p.kind === "card" && <label>Card text<textarea data-recipe-card value={p.text} onChange={e => update({ text: e.target.value })} /></label>}
              {p.kind === "reminder" && <><label>Reminder title<input value={p.title} onChange={e => update({ title: e.target.value })} /></label><label>When<input value={p.when ?? ""} onChange={e => update({ when: e.target.value })} /></label></>}
            </div>;
          })}
        </fieldset>}
        <div className="app-recipes-preview">{previewRecipe(r).map((line, i) => <p key={i}>{line}</p>)}</div>
        {draft.mode === "export" && <><p>Exactly these bytes will be handed to the browser to download.</p><pre data-recipe-bytes>{draft.bytes}</pre></>}
        <p role="status" data-recipe-status>{message}</p>
      </div>
      <div className="app-recipes-footer">
        {editable && <button data-recipe-save disabled={waiting || saved || !map.connected} onClick={() => void save()}>{saved ? "Saved disabled app" : draft.mode === "fork" ? "Save fork" : "Save imported recipe"}</button>}
        {draft.mode === "export" && <button onClick={() => { const ok = actions.saveTextFile("app-recipe.json", draft.bytes, "application/json"); setMessage(ok ? "File handed to browser; disk save is not confirmed." : "Download refused."); }}>Download</button>}
        <button data-recipe-close disabled={waiting} onClick={() => setDraft(null)}>Close</button>
      </div>
    </dialog>}
  </aside>;
}
