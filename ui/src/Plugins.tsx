import { useEffect, useRef, useState } from "react";
import type { CatalogRow } from "./shell/Shell";
import { importedIds } from "./bricks-core";
import { adapterFor, importFolder, usePluginStatuses } from "./plugins-core";
import { visitOnly } from "./plugin-store";
import "./plugins.css";
export function Plugins({ rows }: { rows: CatalogRow[] }) {
  const statuses = usePluginStatuses();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.setAttribute("webkitdirectory", ""); }, []);
  return <section className="plugins" aria-label="Plugins">
    <h2>Plugins</h2><p>Load and unload features. Your work stays here.</p>
    <label className="plugins-add">Add plugin<input ref={input} type="file" multiple disabled={busy} aria-label="Add plugin folder" onChange={async event => {
      const files = [...(event.currentTarget.files ?? [])]; event.currentTarget.value = "";
      setBusy(true); setError("");
      try { await importFolder(files, rows.map(row => row.id)); } catch (err) { setError(String(err)); } finally { setBusy(false); }
    }} /></label>
    <p>Local trusted code has the same page privileges as built-in plugins. Choose a prepared folder.</p>
    {visitOnly && <p role="status">For this visit only</p>}
    {error && <p role="alert">{error}</p>}
    <ul>{rows.map(row => {
      const lifecycle = statuses[row.id];
      const status = row.on ? lifecycle?.status ?? "Loaded" : "Unloaded";
      const masked = row.suspended;
      return <li key={row.id} data-plugin-row={row.id}>
        <div><strong>{row.name}</strong><p>{row.does}</p><small>{importedIds.has(row.id) ? "Imported folder" : row.kind === "app" ? "Saved app · shared across this map" : "Bundled · this browser"}</small>
        <p role="status">{masked ?? status}{lifecycle?.error && status === "Failed" ? ` · ${lifecycle.error}` : ""}</p></div>
        <button type="button" disabled={!row.toggle || row.disabled || !!masked || busy} onClick={() => { if (row.toggle) { const adapter = adapterFor(row.id, row.toggle); if (row.on) adapter.deactivate(); else adapter.activate(); } }}>{row.on ? "Unload" : "Load"} {row.name}</button>
        {row.show && <button type="button" onClick={row.show}>Show</button>}
      </li>;
    })}</ul>
  </section>;
}
export function PluginsModal({ rows, close }: { rows: CatalogRow[]; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement; ref.current?.showModal(); return () => previous?.focus(); }, []);
  return <dialog ref={ref} className="plugins-modal" onCancel={event => { event.preventDefault(); close(); }}><button type="button" onClick={close}>Close Plugins</button><Plugins rows={rows} /></dialog>;
}
