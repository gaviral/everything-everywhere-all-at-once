import { useRef, useState } from "react";
import type { BrickProps, Thought, Thread } from "../contract";
import { useCorrectionRequests } from "./requests";
import "./phone-correction.css";

export default function PhoneCorrection(props: BrickProps) {
  return <CorrectionPanel key={`${props.map.mapIdentity ?? "example"}:${props.map.me}`} {...props} />;
}

function CorrectionPanel({ map }: BrickProps) {
  const [open, setOpen] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const request = useCorrectionRequests();
  const title = (id: string | null) => map.threads.find(t => t.id === id)?.title ?? "Unavailable topic";
  const close = () => { setOpen(false); launcher.current?.focus(); };
  return <aside className="phone-correction" aria-label="Correct a landing" onKeyDown={e => { e.stopPropagation(); if (e.key === "Escape") close(); }}>
    <button className="correction-launch" ref={launcher} aria-expanded={open} onClick={() => setOpen(!open)}>↗ Correct a landing</button>
    {open && <section className="correction-sheet" role="region" aria-label="Landing correction">
      <header><div><small>PUT IT WHERE IT BELONGS</small><h2>Right thought.<br />Wrong topic?</h2></div><button aria-label="Close correction" onClick={close}>×</button></header>
      <LandingPicker thoughts={map.thoughts} topics={map.threads} connected={map.connected} request={request} />
      <ReceiptControls request={request} title={title} connected={map.connected} />
    </section>}
  </aside>;
}

function LandingPicker({ thoughts: source, topics, connected, request }: {
  thoughts: readonly Thought[]; topics: readonly Thread[]; connected: boolean; request: ReturnType<typeof useCorrectionRequests>;
}) {
  const [selected, setSelected] = useState("");
  const [destination, setDestination] = useState("");
  const thoughts = [...source].reverse().filter(t => t.placed && topics.some(topic => topic.id === t.thread_id));
  const thought = thoughts.find(t => t.id === selected) ?? thoughts[0];
  const targets = topics.filter(t => t.id !== thought?.thread_id);
  const target = targets.find(t => t.id === destination) ?? targets[0];
  if (!thought) return <Example />;
  const correct = () => {
    if (!target) return;
    void request.submit({ request_id: crypto.randomUUID(), thought_id: thought.id, observed_text: thought.text, from: thought.thread_id!, to: target.id });
  };
  return <>
    <label>Choose the thought<select value={thought.id} disabled={request.busy || !!request.retry} onChange={e => { setSelected(e.target.value); setDestination(""); }}>
      {thoughts.map(t => <option key={t.id} value={t.id}>{(t.text || t.point).slice(0, 100)}</option>)}
    </select></label>
    <ThoughtCard thought={thought} topic={topics.find(t => t.id === thought.thread_id)?.title ?? "Unavailable topic"} />
    <label>Move to<select value={target?.id ?? ""} disabled={request.busy || !!request.retry} onChange={e => setDestination(e.target.value)}>
      {!targets.length && <option value="">Add another topic first</option>}
      {targets.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
    </select></label>
    <button className="correction-primary" disabled={request.busy || !!request.retry || !target || !connected} onClick={correct}>Move this thought ↗</button>
  </>;
}

function ReceiptControls({ request, title, connected }: {
  request: ReturnType<typeof useCorrectionRequests>; title: (id: string) => string; connected: boolean;
}) {
  const { busy, message, retry, undo } = request;
  return <>
    <p className="correction-status" role="status" aria-live="polite">{message || (connected ? "You choose. One thought moves." : "Reconnect to correct a live landing.")}</p>
    {retry && <div className="correction-retry"><p>“{retry.observed_text}”<br />Unconfirmed: {title(retry.from)} → {title(retry.to)}. Retrying checks this same move.</p><button disabled={busy || !connected} onClick={() => void request.submit(retry)}>Retry same request</button><button disabled={busy} onClick={request.review}>Review current landing</button></div>}
    {undo && !retry && <div className="correction-receipt"><small>LAST CONFIRMED CORRECTION</small><p>“{undo.observed_text}”</p><button className="correction-undo" disabled={busy || !connected} onClick={request.undoMove}>Undo that move · back to {title(undo.from)}</button></div>}
  </>;
}

function ThoughtCard({ thought, topic }: { thought: Thought; topic: string }) {
  return <blockquote><small>LANDED IN {topic}</small><p>{thought.text || thought.point}</p></blockquote>;
}

function Example() {
  return <div className="correction-example"><small>EXAMPLE · NO LIVE THOUGHTS YET</small><blockquote><small>LANDED IN GARDEN</small><p>Learn to throw on the pottery wheel.</p></blockquote><p className="correction-example-destination">↗ Pottery class</p><p>Once a thought lands, choose its topic here. You can undo that exact move.</p></div>;
}
