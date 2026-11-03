import { createContext, useContext, useMemo, type ReactNode } from "react";
import "./stay-here.css";

type Stay = { thread: string | null; connected: boolean; stay: (thread: string | null) => void };
const StayContext = createContext<Stay | null>(null);

export const useStayingHere = () => useContext(StayContext)?.thread ?? null;

export function StayProvider({ thread, connected, stay, children }: Stay & { children: ReactNode }) {
  const value = useMemo(() => ({ thread, connected, stay }), [thread, connected, stay]);
  return <StayContext.Provider value={value}>{children}</StayContext.Provider>;
}

/** The state stays visible even on a folded topic; its release is a named keyboard/touch target. */
export function StayHere({ thread, title = "this topic" }: { thread: string; title?: string }) {
  const state = useContext(StayContext);
  if (!state) return null;
  const pinned = state.thread === thread;
  return <span className={`${pinned ? "staying-here" : "stay-control"} nodrag nopan`}>
    {pinned && <span key="label" title="Everyone's new thoughts land here whole">Staying here</span>}
    {/* Keep the same button, so pinning and releasing preserve keyboard focus. */}
    <button key="control" type="button" className={pinned ? undefined : "stay-here"} disabled={!state.connected}
      aria-label={pinned ? `Let go of ${title}` : `Stay here in ${title}`}
      title={pinned ? "Let go" : "Keep everyone's new thoughts whole in this topic"}
      onClick={(event) => { event.stopPropagation(); state.stay(pinned ? null : thread); }}>{pinned ? "×" : "Stay here"}</button>
  </span>;
}
