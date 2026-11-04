// Ephemeral state, never replay speech or carry a thinking state across a lost connection.
import { useSyncExternalStore } from "react";
import { replyStopped } from "./page-speech";
import { builtInOn } from "./shell/features";
export type PartnerState = { state: "ready" | "thinking" | "idle" | "cancelled" | "error"; message: string };
const ready: PartnerState = { state: "ready", message: "Ask a question, or say “Partner, …”" };
let state = ready;
const watchers = new Set<() => void>();
function set(next: PartnerState) { state = next; watchers.forEach((watcher) => watcher()); }
export function cancelPartner() { set({ state: "cancelled", message: "Reply stopped." }); }
export function resetPartner() { set(ready); }
export function hearPartner(data: unknown) {
  if (typeof data !== "string" || !data.startsWith('{"type":"partner_state"')) return;
  try {
    const msg = JSON.parse(data);
    if (msg.type === "partner_state" && !replyStopped(msg.reply_id)) set({ state: msg.state, message: msg.message });
  } catch { /* other socket payload */ }
}
export const usePartner = () => useSyncExternalStore((watcher) => { watchers.add(watcher); return () => { watchers.delete(watcher); }; }, () => state, () => ready);

/** A window that opted out never renders or speaks the built-in partner's late captions. */
export function ignorePartner(data: unknown): boolean {
  if (builtInOn("partner") || typeof data !== "string") return false;
  if (!data.startsWith('{"type":"partner_state"') && !data.startsWith('{"type":"guide"')) return false;
  try {
    const msg = JSON.parse(data);
    return msg.type === "partner_state" || (msg.type === "guide" && msg.by === "E2A2O");
  } catch { return false; }
}
