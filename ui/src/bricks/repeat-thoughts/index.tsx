import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BrickProps } from "../contract";
import { markRepeat, newVisit, pairKey, pairValid, repeatCandidate, type Pair } from "./rules";
import "./repeat-thoughts.css";

// One tab, one current map. Switching maps discards these labels; nothing is persisted/exported.
let memory = { scope: "", visit: newVisit() };

export default function RepeatThoughts({ map, actions, on }: BrickProps) {
  const scope = map.visitKey ?? "playground";
  if (memory.scope !== scope) memory = { scope, visit: newVisit() };
  const visit = memory.visit;
  const [shown, setShown] = useState<{ scope: string; pair: Pair } | null>(null);
  const [status, setStatus] = useState("");
  const [, redraw] = useState(0);
  const latest = useRef(map);
  const check = useRef<HTMLButtonElement>(null);
  const pending = useRef(new Set<string>());
  const inspect = useRef(() => {});
  const pair = shown?.scope === scope && pairValid(shown.pair, map.thoughts) ? shown.pair : null;
  useLayoutEffect(() => { latest.current = map; });
  useEffect(() => {
    pending.current.clear();
    setShown(null);
    setStatus("");
    let live = true;
    // A host may still be waiting for a model label for an already placed thought.
    const placedAtMount = new Set(latest.current.thoughts.filter((thought) => thought.placed).map((thought) => thought.id));
    // No consumer name: unlike a view, this card must never replay a late mount's landing.
    const stop = on("landed", (event) => {
      if (!live || !event.mine || placedAtMount.has(event.thoughtId)) return;
      pending.current.add(event.thoughtId);
      if (pending.current.size > 100) pending.current.delete(pending.current.values().next().value!);
      inspectPending();
    });
    function inspectPending() {
      const now = latest.current;
      for (const id of pending.current) {
        if (!now.captureSources?.some((capture) => capture.thoughtIds.includes(id))) continue;
        pending.current.delete(id);
        const found = repeatCandidate(now.thoughts, id, now.me);
        setShown(found && !visit.dismissed.has(pairKey(found)) ? { scope, pair: found } : null);
        setStatus("");
      }
    }
    // A receipt can arrive just after the landing; the next map render joins the two.
    inspect.current = inspectPending;
    return () => { live = false; stop(); pending.current.clear(); inspect.current = () => {}; };
  }, [on, scope, visit]);
  useEffect(() => {
    if (shown && !pairValid(shown.pair, map.thoughts)) setShown(null);
    visit.marks = visit.marks.filter((mark) => pairValid(mark, map.thoughts));
    inspect.current();
  }, [map.thoughts, map.captureSources, visit]);

  const checkLatest = () => {
    const now = latest.current;
    const current = now.thoughts.map((thought, i) => ({ thought, i }))
      .filter(({ thought }) => thought.placed && thought.thread_id && thought.speaker === now.me)
      .sort((a, b) => b.thought.at_ms - a.thought.at_ms || b.i - a.i)[0]?.thought;
    const found = current ? repeatCandidate(now.thoughts, current.id, now.me) : null;
    const offered = found && !visit.dismissed.has(pairKey(found)) ? found : null;
    setShown(offered ? { scope, pair: offered } : null);
    setStatus(offered ? "" : "No possible repeat for your latest thought.");
  };
  const marked = pair && visit.marks.some((mark) => pairKey(mark) === pairKey(pair) && pairValid(mark, map.thoughts));
  const stale = () => { setShown(null); setStatus("That source changed or left the map. Check latest again."); check.current?.focus(); };
  return <section className="repeat-thoughts-card" aria-label="Recognize repeated thoughts">
    <div className="repeat-thoughts-head"><strong>{pair ? "Possible repeat" : "Repeated thoughts"}</strong>
      <button ref={check} type="button" onClick={checkLatest}>Check latest</button></div>
    {pair && <>
      <div className="repeat-thoughts-sources">{([ ["Earlier", pair.earlier], ["New", pair.current] ] as const).map(([label, source]) =>
        <blockquote className="repeat-thoughts-source" key={source.id} data-repeat-source={source.id}>
          <div className="repeat-thoughts-time">{label} · <time dateTime={new Date(source.at).toISOString()}>{new Date(source.at).toLocaleString()}</time></div>
          <p>{source.text}</p>
        </blockquote>)}</div>
      <div className="repeat-thoughts-actions">
        <button type="button" onClick={() => { if (!pairValid(pair, latest.current.thoughts) || !actions.openThought(pair.earlier)) stale(); }}>Open earlier</button>
        <button type="button" onClick={() => { visit.dismissed.add(pairKey(pair)); setShown(null); setStatus("Both thoughts kept."); check.current?.focus(); }}>Keep both</button>
        <button type="button" disabled={!!marked} onClick={() => { if (!markRepeat(visit, pair, latest.current.thoughts)) { stale(); return; } redraw((n) => n + 1); }}>That is a repeat</button>
      </div>
      {marked && <p className="repeat-thoughts-status" role="status">Repeat marked in this tab.</p>}
    </>}
    {!pair && <p className="repeat-thoughts-status" role="status">{status || "New captures can offer an earlier thought. Check latest to compare what is here already."}</p>}
  </section>;
}
