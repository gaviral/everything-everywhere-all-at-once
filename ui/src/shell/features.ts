// The app's built-in features with a switch, as the features in folders have (bricks-core.ts): the Cards and Pictures
// views, listening, recap, import and export, in the Catalog's one list. A switch acts at once and only in this browser;
// other windows of the browser follow. Cards, Pictures, import and export start off: none is part of a first visit.
import { useSyncExternalStore } from "react";
import { voicePolicy } from "../talk/call-core";
import { talkOn, watchTalk } from "../talk-preset";
import type { BrickKind } from "../bricks/contract";
import { speechAvailable, watchSpeechAvailability } from "../speech-voice";

export type BuiltIn = { id: "learned-action-labels" | "quiet-solo-attribution" | "placement-details" | "stable-topic-titles" | "phone-topic-overview" | "loose-topics" | "explicit-agreement" | "saved-answers" | "discussion-status" | "plugins" | "built-in-speech" | "phone-remote" | "reply-format" | "review-text-edits" | "compare-return-controls" | "voice-policy-comparison" | "reuse-explanations" | "warm-pictures" | "full-content" | "canvas-tools" | "terse" | "helpers" | "conversation-spine" | "email" | "partner" | "listening" | "recap" | "import" | "export" | "cards" | "pictures" | "semantic-zoom" | "bring-here" | "rotate-canvas" | "compare-phone-reading"; kind: BrickKind; defaultOn: boolean };

export const BUILT_INS: readonly BuiltIn[] = [
  { id: "learned-action-labels", kind: "panel", defaultOn: false },
  { id: "quiet-solo-attribution", kind: "panel", defaultOn: false },
  { id: "placement-details", kind: "panel", defaultOn: false },
  { id: "stable-topic-titles", kind: "panel", defaultOn: false },
  { id: "phone-topic-overview", kind: "panel", defaultOn: false },
  { id: "plugins", kind: "panel", defaultOn: false },
  { id: "discussion-status", kind: "panel", defaultOn: false },
  { id: "reply-format", kind: "panel", defaultOn: false },
  { id: "saved-answers", kind: "panel", defaultOn: false },
  { id: "explicit-agreement", kind: "panel", defaultOn: false },
  { id: "full-content", kind: "panel", defaultOn: false },
  { id: "loose-topics", kind: "panel", defaultOn: false },
  { id: "canvas-tools", kind: "panel", defaultOn: false },
  { id: "terse", kind: "view", defaultOn: false },
  { id: "bring-here", kind: "panel", defaultOn: false },
  { id: "voice-policy-comparison", kind: "input", defaultOn: false },
  { id: "compare-return-controls", kind: "card", defaultOn: false },
  { id: "review-text-edits", kind: "panel", defaultOn: false },
  { id: "conversation-spine", kind: "view", defaultOn: false },
  { id: "email", kind: "input", defaultOn: true },
  { id: "helpers", kind: "input", defaultOn: true },
  { id: "reuse-explanations", kind: "input", defaultOn: false },
  { id: "partner", kind: "input", defaultOn: false },
  { id: "built-in-speech", kind: "input", defaultOn: true },
  // The views beside the Canvas: off until switched on; each then has its Show.
  { id: "cards", kind: "view", defaultOn: false },
  { id: "pictures", kind: "view", defaultOn: false },
  { id: "compare-phone-reading", kind: "panel", defaultOn: false },
  { id: "warm-pictures", kind: "input", defaultOn: false },
  { id: "semantic-zoom", kind: "panel", defaultOn: false },
  { id: "rotate-canvas", kind: "panel", defaultOn: false },
  { id: "phone-remote", kind: "input", defaultOn: false },
  { id: "listening", kind: "input", defaultOn: true },
  { id: "import", kind: "input", defaultOn: false },
  { id: "recap", kind: "panel", defaultOn: true },
  { id: "export", kind: "panel", defaultOn: false },
];

let helpersAvailable = false;
export const featureAvailable = (id: string) => (id !== "helpers" || helpersAvailable) && (id !== "built-in-speech" || speechAvailable());
export function setHelpersAvailable(value: boolean) { if (helpersAvailable !== value) { helpersAvailable = value; changed(); } }

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
const changed = () => { on = onOf(switches); voicePolicy.configure(on.has("voice-policy-comparison")); for (const watcher of watchers) watcher(); };
if (browser) window.addEventListener("storage", (event) => { if (event.key === STORE) { switches = read(); changed(); } });

watchTalk(changed);
watchSpeechAvailability(changed);

function onOf(kept: Switches): ReadonlySet<BuiltIn["id"]> {
  if (talkOn()) return new Set([...(kept.plugins && kept.listening === false ? [] : ["listening" as const]), ...(kept.plugins ? ["plugins" as const] : []), ...(speechAvailable() && (kept["built-in-speech"] ?? true) ? ["built-in-speech" as const] : [])]);
  return new Set(BUILT_INS.filter((b) => featureAvailable(b.id) && (kept[b.id] ?? b.defaultOn)).map((b) => b.id));
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
/** Browser choice before the Talk preset or availability policy is applied. */
export const builtInChoice = (id: BuiltIn["id"]) => read()[id] ?? BUILT_INS.find((b) => b.id === id)!.defaultOn;
export const watchBuiltIns = (watcher: () => void) => { watchers.add(watcher); return () => { watchers.delete(watcher); }; };

voicePolicy.configure(on.has("voice-policy-comparison"));
