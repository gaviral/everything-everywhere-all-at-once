import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { TextEditReviewContext, type PointReviewAction } from "./bricks/contract";
import type { PointEdit, TextEditRequest, TextEditResult, Thought } from "./core";
import { parseMarkdown } from "./md";
import { builtInOn, useBuiltInsOn } from "./shell/features";
import { reviewSources } from "./this-card";
import "./text-edit-review.css";

type Host = { actor: string; edits?: readonly PointEdit[]; thoughts: readonly Thought[]; connected: boolean; result: TextEditResult | null; send(message: TextEditRequest): boolean };
type Opened = { sources: Thought[]; focus: HTMLElement };

export function useTextEditReview(host: Host) {
  const enabled = useBuiltInsOn().has("review-text-edits");
  const [opened, setOpened] = useState<Opened | null>(null);
  const latest = useRef(host.thoughts);
  latest.current = host.thoughts;
  const open = useCallback<PointReviewAction>((ids, focus) => {
    if (!builtInOn("review-text-edits")) return;
    const sources = reviewSources(ids, latest.current).map(t => ({ ...t }));
    if (sources.length) setOpened({ sources, focus });
  }, []);
  useEffect(() => { if (!enabled) setOpened(null); }, [enabled]);
  return { open, context: useMemo(() => ({ enabled, open }), [enabled, open]),
    panel: enabled && opened ? <TextEditReview key={opened.sources.map(t => t.id).join(" ")} {...host} opened={opened} close={() => setOpened(null)} /> : null };
}

export function SuggestPoint({ ids }: { ids: readonly string[] }) {
  const review = useContext(TextEditReviewContext);
  return review.enabled ? <button type="button" className="suggest-point" onClick={event => review.open(ids, event.currentTarget)}>Suggest a shorter point</button> : null;
}

/** Word LCS: plain text nodes with semantic deletion/insertion, never HTML from a model. */
export function wordDiff(before: string, after: string): { kind: "same" | "delete" | "insert"; text: string; before?: string }[] {
  const a = before.match(/\S+\s*/g) ?? [], b = after.match(/\S+\s*/g) ?? [];
  // Bound comparison work for long legacy points; still mark each deleted/inserted word.
  if (a.length * b.length > 1_000_000) return [
    ...a.map(text => ({ kind: "delete" as const, text })), ...b.map(text => ({ kind: "insert" as const, text })),
  ];
  const rows = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    rows[i][j] = a[i].trim() === b[j].trim() ? 1 + rows[i + 1][j + 1] : Math.max(rows[i + 1][j], rows[i][j + 1]);
  const result: { kind: "same" | "delete" | "insert"; text: string; before?: string }[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].trim() === b[j].trim()) { result.push({ kind: "same", text: b[j++], before: a[i++] }); }
    else if (i < a.length && (j === b.length || rows[i + 1][j] >= rows[i][j + 1])) result.push({ kind: "delete", text: a[i++] });
    else result.push({ kind: "insert", text: b[j++] });
  }
  return result;
}

export function TextEditReview({ actor, edits, thoughts, connected, result, send, opened, close }: Host & { opened: Opened; close(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [source, setSource] = useState<Thought | null>(opened.sources.length === 1 ? opened.sources[0] : null);
  const [proposal, setProposal] = useState("");
  const [modelProposal, setModelProposal] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<"generate" | "accept" | "undo" | null>(null);
  const [accepted, setAccepted] = useState<{ id: string; old: string; value: string } | null>(null);
  const [finished, setFinished] = useState(false);
  const generation = useRef<{ id: string; version: number } | null>(null);
  const version = useRef(0);
  const mutation = useRef<{ id: string; observed: string; replacement: string; undo: boolean } | null>(null);
  const previousEdit = source && [...(edits ?? [])].reverse().find(e => e.thought_id === source.id);
  const prior = previousEdit && previousEdit.actor === actor && !previousEdit.undo_of ? { id: previousEdit.request_id, old: previousEdit.old_point, value: previousEdit.new_point } : null;
  const undoable = accepted ?? prior;
  const live = source && thoughts.find(t => t.id === source.id);
  const stale = !!source && (!live || live.point !== (accepted?.value ?? source.point));
  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      // Canvas tools hide without focus inside their point: reveal the action before returning to it.
      opened.focus.closest("[data-heads]")?.querySelector<HTMLElement>(".spine-text, .spine-aside-face, .spine-card-face")?.focus({ preventScroll: true });
      opened.focus.focus({ preventScroll: true });
    };
  }, [opened]);
  useEffect(() => {
    if (!connected) { setPending(null); setMessage("Connection lost. Your proposal is kept. Retry explicitly when connected."); }
    else setMessage(was => was.startsWith("Connection lost.") ? "Connected again. Your proposal is kept. Retry explicitly." : was);
  }, [connected]);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => {
      if (pending === "generate") generation.current = null;
      setPending(null);
      setMessage(pending === "generate" ? "No proposal arrived. Your words are kept; try again explicitly." : "No save acknowledgement arrived. Your proposal is kept; retry the same edit explicitly.");
    }, pending === "generate" ? 25000 : 15000);
    return () => window.clearTimeout(timer);
  }, [pending]);
  useEffect(() => {
    if (!source || result?.thought_id !== source.id || !builtInOn("review-text-edits")) return;
    if (result.type === "point_proposal" && generation.current?.id === result.request_id) {
      setPending(null);
      if (result.failed) setMessage(result.text);
      else if (generation.current.version === version.current) { setProposal(result.text); setMessage("Proposal ready. Review before accepting."); }
      else { setModelProposal(result.text); setMessage("Your typed proposal is kept. A model proposal is available below."); }
      generation.current = null;
    } else if (result.type === "point_edit_result" && mutation.current?.id === result.request_id) {
      setPending(null); setMessage(result.message);
      if (result.ok) {
        const edit = mutation.current;
        if (edit.undo) { setAccepted(null); setFinished(true); setMessage("Point restored."); }
        else { setAccepted({ id: edit.id, old: edit.observed, value: edit.replacement }); setMessage("Point saved."); }
        mutation.current = null;
      }
    }
  }, [result, source]);
  const generate = () => {
    if (!source || pending || !connected || !builtInOn("review-text-edits")) return;
    const id = crypto.randomUUID();
    generation.current = { id, version: version.current };
    if (send({ type: "shorter_point", request_id: id, thought_id: source.id, observed: source.point })) { setPending("generate"); setMessage("Making one proposal…"); }
    else { generation.current = null; setMessage("Couldn't send. Your proposal is kept."); }
  };
  const edit = (undo: boolean) => {
    if (!source || pending || !connected || !builtInOn("review-text-edits")) return;
    const observed = undo ? undoable!.value : source.point, replacement = undo ? undoable!.old : proposal;
    // An explicit retry of the same edit keeps its identity, even after a lost acknowledgement.
    if (!mutation.current || mutation.current.observed !== observed || mutation.current.replacement !== replacement || mutation.current.undo !== undo)
      mutation.current = { id: crypto.randomUUID(), observed, replacement, undo };
    if (send({ type: "edit_point", request_id: mutation.current.id, thought_id: source.id, observed, replacement, ...(undo ? { undo_of: undoable!.id } : {}) })) { setPending(undo ? "undo" : "accept"); setMessage("Saving point…"); }
    else setMessage("Couldn't send. Your proposal is kept.");
  };
  const diff = useMemo(() => wordDiff(source?.point ?? "", proposal), [source?.point, proposal]);
  const valid = !!proposal.trim() && [...proposal].length <= 1200 && proposal !== source?.point;
  return <dialog ref={dialog} className="text-edit-review" aria-labelledby="text-edit-title" onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }} onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); close(); } }}>
    <header><h2 id="text-edit-title">Review text edit</h2><button type="button" onClick={close} aria-label="Close review">Close</button></header>
    {!source ? <section><p>Select one source thought first.</p>{opened.sources.map(t => <button className="review-source" type="button" key={t.id} onClick={() => setSource(t)}>{t.point}<small>{t.speaker} · {new Date(t.at_ms).toLocaleTimeString()}</small></button>)}</section> : <>
      <div className="text-edit-body">
        <section><h3>Current point at opening</h3><div className="review-current">{parseMarkdown(source.point)}</div></section>
        {stale && <section><h3>Current saved point</h3><div className="review-current">{live ? parseMarkdown(live.point) : "Source no longer on the map."}</div></section>}
        <section><h3>Original recognized text</h3><p>{source.text}</p></section>
        {stale && <p role="alert">This source changed or left the map. Accept and Undo must match the saved point. Keep your proposal for manual copy.</p>}
        <label>Replacement proposal<textarea aria-label="Replacement proposal" value={proposal} maxLength={2400} readOnly={!!accepted || finished} onChange={event => { version.current++; setProposal(event.target.value); }} /></label>
        <small>{[...proposal].length} / 1,200 characters</small>
        <button type="button" onClick={generate} disabled={!connected || !!pending || !!accepted || finished || stale}>Make shorter</button>
        {modelProposal && <section><p>{modelProposal}</p><button type="button" onClick={() => { version.current++; setProposal(modelProposal); setModelProposal(""); }}>Use model proposal</button></section>}
        <section className="review-diff" aria-label="Word changes"><h3>Before · deleted words struck through</h3><p>{diff.filter(w => w.kind !== "insert").map((w, i) => w.kind === "delete" ? <del key={i}>{w.text}</del> : <span key={i}>{w.before ?? w.text}</span>)}</p>
          <h3>After · inserted words underlined</h3><p>{diff.filter(w => w.kind !== "delete").map((w, i) => w.kind === "insert" ? <ins key={i}>{w.text}</ins> : <span key={i}>{w.text}</span>)}</p></section>
        <p role="status" aria-live="polite">{message}</p>
      </div>
      <footer>{undoable && !finished && <button type="button" disabled={!!pending || !connected} onClick={() => edit(true)}>Undo point edit</button>}{accepted ? <span>Accepted</span> : !finished && <button type="button" disabled={!valid || !!pending || !connected} onClick={() => edit(false)}>Accept</button>}
        <button type="button" onClick={close}>{accepted || finished ? "Close" : "Reject"}</button></footer>
    </>}
  </dialog>;
}
