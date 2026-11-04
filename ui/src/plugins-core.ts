import "./plugin-api";
import { useSyncExternalStore } from "react";
import { addBrick, BRICKS, importedIds, infoProblems, switchBrick, type BrickModule } from "./bricks-core";
import { BUILT_INS } from "./shell/features";
import { keepPackage, packages, type Package } from "./plugin-store";
export type Status = "Loaded" | "Unloaded" | "Loading" | "Unloading" | "Failed";
let statuses: Record<string, { status: Status; error?: string }> = {};
const watchers = new Set<() => void>();
export function report(id: string, status: Status, error?: string) {
  statuses = { ...statuses, [id]: { status, error } };
  for (const fn of watchers) fn();
}
export function usePluginStatuses() { return useSyncExternalStore(fn => { watchers.add(fn); return () => { watchers.delete(fn); }; }, () => statuses); }
const styles = new Map<string, string>();
export function keepStyles(id: string, css: string) { styles.set(id, css); }
export function attachStyle(id: string) {
  const css = styles.get(id);
  if (!css) return () => {};
  const style = document.createElement("style"); style.dataset.plugin = id; style.textContent = css; document.head.append(style);
  return () => style.remove();
}
function register(value: Package) {
  if (BRICKS.some(b => b.info.id === value.info.id)) return;
  importedIds.add(value.info.id); styles.set(value.info.id, value.css);
  let loaded: Promise<BrickModule> | null = null;
  const load = async (): Promise<BrickModule> => {
    const url = URL.createObjectURL(new Blob([value.js], { type: "text/javascript" }));
    try {
      const module = await import(/* @vite-ignore */ url) as BrickModule;
      if (typeof module.default !== "function" && typeof module.default !== "object") throw new Error("Entry must export a React component");
      return module;
    } finally { URL.revokeObjectURL(url); }
  };
  addBrick({ info: value.info, revision: value.revision, load: () => loaded ??= load().catch(error => { loaded = null; throw error; }) });
  report(value.info.id, "Unloaded");
}
let restoring: Promise<void> | undefined;
export function restorePlugins() { return restoring ??= packages().then(values => { for (const value of values) register(value); }); }
/** Validate everything before changing durable storage or registry. */
export async function importFolder(files: readonly File[], reserved: readonly string[]) {
  if (!files.length) throw new Error("Choose a prepared plugin folder");
  if (files.reduce((n, f) => n + f.size, 0) > 5 * 1024 * 1024) throw new Error("Plugin exceeds 5 MiB");
  const entries = new Map<string, File>();
  let folder = "";
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    const parts = path.split("/");
    if (parts.length !== 2 || parts.some(p => !p || p === "." || p === ".." || /[:\\]/.test(p))) throw new Error("Only manifest-declared relative files are allowed");
    if (folder && folder !== parts[0]) throw new Error("Choose one folder");
    folder = parts[0];
    if (entries.has(parts[1])) throw new Error("Duplicate file");
    entries.set(parts[1], file);
  }
  const read = async (name: string) => { const file = entries.get(name); if (!file) throw new Error(`Missing ${name}`); return file.text(); };
  const info = JSON.parse(await read("brick.json"));
  const problems = infoProblems(info, folder);
  if (problems.length) throw new Error(problems.join("; "));
  if (info.defaultOn !== false) throw new Error("Imported defaultOn must be false");
  if ([...BRICKS.map(b => b.info.id), ...BUILT_INS.map(b => b.id), "preset-talk", ...reserved].includes(info.id)) throw new Error("Duplicate plugin ID");
  const manifest = JSON.parse(await read("plugin.json"));
  if (manifest.apiVersion !== 1 || manifest.entry !== "index.js" || (manifest.css !== undefined && manifest.css !== "style.css")) throw new Error("Expected API 1, index.js and optional style.css");
  const allowed = ["brick.json", "plugin.json", "index.js", ...(manifest.css ? ["style.css"] : [])];
  if ([...entries.keys()].some(name => !allowed.includes(name))) throw new Error("Undeclared asset");
  const js = await read("index.js");
  // Packaging emits one self-contained ESM file; no dependency fetches at runtime.
  if (/\bimport\s*(?:\(|["'{*]|[\w$]+\s*(?:,|from))|\bexport\s*[^;]*\bfrom\s*["']/.test(js)) throw new Error("Entry must be bundled without imports");
  if (!/export\s*\{[^}]*\bdefault\b|export\s+default\b/.test(js)) throw new Error("Missing default export");
  try { new Function(js.replace(/export\s*\{[^}]*\};?\s*$/, "").replace(/\bexport\s+default\s+/g, "const __pluginDefault = ").replace(/\bexport\s+(?=(?:const|let|var|function|class)\b)/g, "")); } catch { throw new Error("Malformed bundle"); }
  const css = manifest.css ? await read("style.css") : "";
  if (/@import|url\s*\(/i.test(css)) throw new Error("Styles must be self-contained");
  const value: Package = { info, js, css, revision: crypto.randomUUID() };
  await keepPackage(value); switchBrick(value.info.id, false); register(value);
  try { localStorage.setItem("e2a2o.plugins.changed", value.revision); } catch { /* for this visit */ }
  return info.id;
}

/** Built-ins and saved apps adapt their existing toggle paths; no second preference store. */
export type PluginAdapter = { id: string; activate(): void; deactivate(): void };
export function adapterFor(id: string, toggle: (on: boolean) => void): PluginAdapter {
  return { id, activate: () => toggle(true), deactivate: () => toggle(false) };
}

if (typeof window !== "undefined") window.addEventListener("storage", event => {
  if (event.key === "e2a2o.plugins.changed") void packages().then(values => { for (const value of values) register(value); });
});
