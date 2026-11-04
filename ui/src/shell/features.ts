// The app's built-in features with a switch, as the features in folders have (bricks-core.ts): the Cards and Pictures
// views, listening, recap, import and export, in the Catalog's one list. A switch acts at once and only in this browser;
// other windows of the browser follow. Cards, Pictures, import and export start off: none is part of a first visit.
import { useSyncExternalStore } from "react";
import { talkOn, watchTalk } from "../talk-preset";
import type { BrickKind } from "../bricks/contract";

export type BuiltIn = { id: "conversation-spine" | "partner" | "listening" | "recap" | "import" | "export" | "cards" | "pictures" | "semantic-zoom"; kind: BrickKind; defaultOn: boolean };

export const BUILT_INS: readonly BuiltIn[] = [
  { id: "conversation-spine", kind: "view", defaultOn: false },
  { id: "partner", kind: "input", defaultOn: false },
  // The views beside the Canvas: off until switched on; each then has its Show.
  { id: "cards", kind: "view", defaultOn: false },
  { id: "pictures", kind: "view", defaultOn: false },
  { id: "semantic-zoom", kind: "panel", defaultOn: false },
  { id: "listening", kind: "input", defaultOn: true },
  { id: "import", kind: "input", defaultOn: false },
  { id: "recap", kind: "panel", defaultOn: true },
  { id: "export", kind: "panel", defaultOn: false },
];

const STORE = "e2a2o.features";
type Switches = Partial<Record<BuiltIn["id"], boolean>>;

function read(): Switches {
  try {
    const kept = JSON.parse(localStorage.getItem(STORE) ?? "{}");
    if (!kept || typeof kept !== "object" || Array.isArray(kept)) return {};
    return Object.fromEntries(Object.entries(kept).filter(([id, value]) => typeof value === "boolean" && BUILT_INS.some((b) => b.id === id)));
  } catch { return {}; }
}

const browser = typeof window !== "undefined";
let switches: Switches = browser ? read() : {};
let on = onOf(switches);
const watchers = new Set<() => void>();
const changed = () => { on = onOf(switches); for (const watcher of watchers) watcher(); };
if (browser) window.addEventListener("storage", (event) => { if (event.key === STORE) { switches = read(); changed(); } });

watchTalk(changed);

function onOf(kept: Switches): ReadonlySet<BuiltIn["id"]> {
  if (talkOn()) return new Set(["listening"]);
  return new Set(BUILT_INS.filter((b) => kept[b.id] ?? b.defaultOn).map((b) => b.id));
}

/** The built-ins on now; a new set only when one is switched. */
export function useBuiltInsOn(): ReadonlySet<BuiltIn["id"]> {
  return useSyncExternalStore((watcher) => { watchers.add(watcher); return () => { watchers.delete(watcher); }; }, () => on, () => on);
}

export function switchBuiltIn(id: BuiltIn["id"], value: boolean) {
  switches = { ...switches, [id]: value };
  try { localStorage.setItem(STORE, JSON.stringify(switches)); } catch { /* private mode: for this visit */ }
  changed();
}

export const builtInOn = (id: BuiltIn["id"]) => on.has(id);
export const watchBuiltIns = (watcher: () => void) => { watchers.add(watcher); return () => { watchers.delete(watcher); }; };
