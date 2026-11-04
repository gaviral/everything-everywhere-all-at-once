import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { DiscussionResult, DiscussionStatus, World } from "./core";
import "./discussion.css";

type ReadOnlyTree<T> = T extends (infer U)[] ? readonly ReadOnlyTree<U>[] : T extends object ? { readonly [K in keyof T]: ReadOnlyTree<T[K]> } : T;
type DiscussionWorld = ReadOnlyTree<Pick<World, "thoughts" | "threads" | "anchors" | "discussions">>;
type Host = { world: DiscussionWorld; enabled: boolean; showResolved: boolean; setShowResolved(on: boolean): void; set(thread: string, status: "open" | "resolved", revision: number): Promise<DiscussionResult> };
export const DiscussionContext = createContext<Host | null>(null);
export function DiscussionProvider({ world, enabled, set, children }: { world: DiscussionWorld; enabled: boolean; set: Host["set"]; children: ReactNode }) {
  const [showResolved, setShowResolved] = useState(false);
  return <DiscussionContext.Provider value={{ world, enabled, set, showResolved, setShowResolved }}>{children}{enabled && <DiscussionShelf />}</DiscussionContext.Provider>;
}
function DiscussionShelf() {
  const host = useContext(DiscussionContext)!;
  const [open, setOpen] = useState(false);
  const ids = Object.keys(host.world.anchors ?? {});
  if (!ids.length) return null;
  return <aside className="discussion-shelf"><button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>Discussions ({ids.length})</button>{open && <div className="discussion-list">
    <label><input type="checkbox" checked={host.showResolved} onChange={e => host.setShowResolved(e.target.checked)} />Show resolved</label>
    {ids.map(id => <DiscussionBadge key={id} thread={id} />)}
  </div>}</aside>;
}
export function discussionCollapsed(host: Host | null, thread: string) { return !!host?.enabled && !host.showResolved && host.world.discussions?.some(s => s.thread_id === thread && s.status === "resolved"); }
export function DiscussionBody({ thread, children }: { thread: string; children: ReactNode }) {
  const host = useContext(DiscussionContext);
  if (!discussionCollapsed(host, thread)) return <>{children}</>;
  const count = host!.world.thoughts.filter(t => t.thread_id === thread).length;
  return <span className="discussion-count">{count} {count === 1 ? "comment" : "comments"} · resolved discussion</span>;
}
export function DiscussionBadge({ thread }: { thread: string }) {
  const host = useContext(DiscussionContext);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const sourceButton = useRef<HTMLButtonElement>(null);
  const live = useRef(true);
  const epoch = useRef(0);
  useEffect(() => { epoch.current++; live.current = !!host?.enabled; setBusy(false); return () => { live.current = false; epoch.current++; }; }, [host?.enabled]);
  useEffect(() => { if (open && host?.enabled) dialog.current?.showModal(); else dialog.current?.close(); }, [open, host?.enabled]);
  useEffect(() => {
    const panel = dialog.current;
    if (!open || !panel) return;
    const observer = new ResizeObserver(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && panel.contains(active)) active.scrollIntoView({ block: "nearest" });
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, [open]);
  if (!host?.enabled) return null;
  const { world } = host;
  const status: DiscussionStatus | undefined = world.discussions?.find(s => s.thread_id === thread);
  const resolved = status?.status === "resolved";
  const anchor = world.anchors?.[thread];
  const source = world.thoughts.find(t => t.id === anchor?.thought_id && t.placed && world.threads.some(th => th.id === t.thread_id));
  const text = source?.point || source?.text || "";
  let occurrences = 0;
  if (anchor?.quote) for (let at = text.indexOf(anchor.quote); at >= 0; at = text.indexOf(anchor.quote, at + 1)) occurrences++;
  const warning = !source ? "Source no longer on map" : occurrences > 1 ? "Anchor ambiguous" : occurrences !== 1 || (anchor?.context && text !== anchor.context.source_text) ? "Source changed" : "";
  const replies = world.thoughts.filter(t => t.thread_id === thread);
  const newReply = resolved && replies.length > (status?.reply_count ?? 0);
  const close = () => { dialog.current?.close(); setOpen(false); sourceButton.current?.focus(); };
  const save = async () => {
    const started = epoch.current;
    setBusy(true); setMessage("Saving…");
    const r = await host.set(thread, resolved ? "open" : "resolved", status?.revision ?? 0);
    if (live.current && started === epoch.current) { setMessage(r.message); setBusy(false); }
  };
  return <span className="discussion-controls nodrag nopan" data-discussion={thread}>
    <span>{resolved ? `Resolved by ${status.actor}` : "Open discussion"}{newReply ? " · New reply on resolved discussion" : ""}</span>
    <button ref={sourceButton} type="button" onClick={() => { setOpen(true); setMessage(""); }} aria-label={`Open discussion: ${anchor?.quote ?? thread}`}>Open discussion ({replies.length})</button>
    <button type="button" disabled={busy} onClick={() => void save()}>{resolved ? "Reopen" : "Resolve"}</button>
    {!open && message && <span role="status">{message}</span>}
    {open && createPortal(<dialog ref={dialog} className="discussion-dialog" aria-label="Anchored discussion" onFocusCapture={e => { if (e.target instanceof HTMLElement) e.target.scrollIntoView({ block: "nearest" }); }} onCancel={e => { e.preventDefault(); close(); }} onClose={close}>
      <h2>{resolved ? `Resolved by ${status.actor}` : "Open discussion"}</h2>
      {newReply && <p>New reply on resolved discussion</p>}
      <blockquote>{anchor?.quote}</blockquote>{warning && <p>{warning}</p>}
      {source && <details><summary>Open source</summary><p>{text}</p></details>}
      <ol>{replies.map(t => <li key={t.id}><strong>{t.speaker}</strong><p>{t.point || t.text}</p></li>)}</ol>
      <label><input type="checkbox" checked={host.showResolved} onChange={e => host.setShowResolved(e.target.checked)} />Show resolved</label>
      <p role="status">{message}</p>
      <button type="button" disabled={busy} onClick={() => void save()}>{resolved ? "Reopen" : "Resolve"}</button><button type="button" autoFocus onClick={close}>Close discussion</button>
    </dialog>, document.body)}
  </span>;
}
