import type { RemoteGesture, RemotePosition } from "../bricks/contract";
export type RemoteMessage = RemoteGesture | RemotePosition;
const listeners = new Set<(message: RemoteMessage) => void>();
export function watchRemote(hear: (message: RemoteMessage) => void) {
  listeners.add(hear);
  return () => { listeners.delete(hear); };
}
/** Called by the existing room socket. Nothing here is saved or replayed. */
export function hearRemote(data: unknown) {
  if (typeof data !== "string") return;
  try {
    const envelope = JSON.parse(data);
    if (envelope.type === "remote_selection") for (const hear of listeners) hear(envelope.message);
  } catch { /* other socket traffic */ }
}
