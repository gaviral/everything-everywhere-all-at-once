import { useEffect, useLayoutEffect, useRef, useState } from "react";

// crypto.randomUUID needs a secure page; a guest laptop in a room loads plain http from the LAN.
const newId = () => (window.isSecureContext && crypto.randomUUID ? crypto.randomUUID() : `x${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
import { answerSourceState, sourceRevision, type AnswerSource, type Explanation, type KeptAnswer, type World } from "./core";
import { useMe } from "./room";
import "./bring-here.css";
import { TIPS } from "./Tips";
import { siteText, useSite } from "./site";

// A word, a phrase or a sentence; longer selections are usually for copying.
const LONGEST = 160;
// The core gives up after 20 seconds, so an answer missing after this was lost on the way (a reconnect).
const PATIENCE_MS = 25_000;

type Picked = { id: string; text: string; context: string; threadId: string | null; range: Range; touch: boolean; asked: boolean; source?: AnswerSource; keepable?: boolean };

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
const control = (target: EventTarget | null) =>
  target instanceof Element && !!target.closest("button, a, input, textarea, select, summary, [contenteditable]");

// Select a word or phrase on the map to get it explained in its thread.
export function Explain({ explanations, explain, mark, world, savedOn, keep }: {
  world: World; savedOn: boolean; keep: (id: string) => boolean;
  explanations: Record<string, Explanation>;
  explain: (id: string, text: string, context: string, threadId: string | null, source?: AnswerSource) => boolean;
  /** Marks an answer as off, or takes the mark back; false when it couldn't be sent. */
  mark: (kind: "explain", id: string, off: boolean) => boolean;
}) {
  const { hosted } = useSite();
  const live = useRef({ world, savedOn });
  live.current = { world, savedOn };
  const [picked, setPicked] = useState<Picked | null>(null);
  // Answers marked off in this window, so the toggle shows its state while the card is open.
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());
  const toggleOff = (id: string) => {
    const next = !off.has(id);
    if (!mark("explain", id, next)) return;
    setOff((marked) => { const copy = new Set(marked); if (next) copy.add(id); else copy.delete(id); return copy; });
  };
  const [lost, setLost] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  const dismiss = useRef<HTMLButtonElement>(null);
  const current = useRef(picked);
  current.current = picked;
  // The selection last shown or dismissed, so it doesn't pop back on the next key.
  const seen = useRef<Range | null>(null);

  const ask = (target: Picked) => {
    const id = newId();
    const moveFocus = !!box.current?.contains(document.activeElement);
    setPicked({ ...target, id, asked: true, keepable: live.current.savedOn && !!target.source });
    if (!explain(id, target.text, target.context, target.threadId, target.source)) setLost(id);
    if (moveFocus) requestAnimationFrame(() => dismiss.current?.focus());
  };
  const asking = useRef(ask);
  asking.current = ask;

  // Above the phrase, between the sticky bars at the top and the dock; below it when there's no room
  // above, and for touch, where the system's own menu sits above. Unasked hints follow the selection;
  // a served answer remains readable across resize/text zoom until dismissed or clicked away.
  const place = () => {
    const open = current.current;
    const element = box.current;
    if (!open || !element) return;
    const anchor = open.range.getBoundingClientRect();
    const ceiling = Math.max(0, ...Array.from(document.querySelectorAll("header, .map-tools"), (bar) => bar.getBoundingClientRect().bottom));
    const floor = document.querySelector(".dock")?.getBoundingClientRect().top ?? window.innerHeight;
    if (!open.asked && ((!anchor.width && !anchor.height) || anchor.bottom < ceiling || anchor.top > floor)) return setPicked(null);
    const gap = 8;
    const { offsetWidth: width, offsetHeight: height } = element;
    const fitsAbove = anchor.top - gap - height >= ceiling + gap;
    const fitsBelow = anchor.bottom + gap + height <= floor - gap;
    const below = open.touch ? fitsBelow || !fitsAbove : !fitsAbove && fitsBelow;
    element.style.left = `${Math.max(gap, Math.min(anchor.left + anchor.width / 2 - width / 2, window.innerWidth - width - gap))}px`;
    const top = below ? anchor.bottom + gap : anchor.top - gap - height;
    element.style.top = `${Math.max(ceiling + gap, Math.min(top, floor - height - gap))}px`;
  };
  // After every render, so the box follows the phrase as the live map moves around it.
  useLayoutEffect(place);

  useEffect(() => {
    const pick = (touch: boolean) => {
      const selection = window.getSelection();
      const text = selection?.toString().replace(/\s+/g, " ").trim() ?? "";
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const node = range?.commonAncestorContainer;
      const element = node instanceof Element ? node : node?.parentElement;
      if (!range || !text || text.length > LONGEST || !element?.closest(".map, .spine")) {
        // A bare button goes with its selection; an answer stays until dismissed.
        if (!current.current?.asked) setPicked(null);
        seen.current = null;
        return;
      }
      const last = seen.current;
      if (last && last.toString() === range.toString() && last.compareBoundaryPoints(Range.START_TO_START, range) === 0) return;
      seen.current = range.cloneRange();
      previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const around = element.textContent ?? "";
      const context = element.closest("li")?.getAttribute("title") || (around.length < 300 ? around : text);
      const host = element.closest<HTMLElement>("[data-thought], [id^='point-']");
      const thoughtId = host?.dataset.thought ?? host?.id.replace(/^point-/, "");
      const thought = live.current.world.thoughts.find(t => t.id === thoughtId);
      const field = thought?.point.includes(text) ? "point" : thought?.text.includes(text) ? "text" : null;
      const source: AnswerSource | undefined = thought && field ? { thought_id: thought.id, field, excerpt: thought[field], revision: sourceRevision(thought) } : undefined;
      const threadId = thought?.thread_id || element.closest<HTMLElement>("[data-thread]")?.dataset.thread || element.closest(".thread")?.id.replace(/^thread-/, "") || null;
      setPicked({ id: newId(), text, context, threadId, source, range: seen.current, touch, asked: false });
    };
    const outside = (event: Event) => !box.current?.contains(event.target as Node);
    const onPointerUp = (event: PointerEvent) => {
      if (outside(event)) window.setTimeout(() => pick(event.pointerType === "touch"));
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!outside(event)) return;
      setPicked(null);
      seen.current = null;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if ((event.shiftKey || event.key === "Shift") && !typing(event.target)) pick(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const open = current.current;
      if (!open) return;
      if (event.key === "Escape") {
        // This Escape is for the box only: don't also fold the map's quiet threads.
        if (!typing(event.target)) event.stopPropagation();
        if (box.current?.contains(document.activeElement)) previous.current?.focus({ preventScroll: true });
        setPicked(null);
      } else if (event.key === "Enter" && !open.asked && !control(event.target)) {
        event.preventDefault();
        asking.current(open);
      }
    };
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, []);

  useEffect(() => { if (!savedOn) setPicked(p => p ? { ...p, keepable: false } : p); }, [savedOn]);
  const answer = picked ? explanations[picked.id] : undefined;
  useEffect(() => {
    if (!picked?.asked || answer) return;
    const id = picked.id;
    const timer = window.setTimeout(() => setLost(id), PATIENCE_MS);
    return () => window.clearTimeout(timer);
  }, [picked?.id, picked?.asked, answer]);

  if (!picked) return null;
  const failed = answer?.failed || lost === picked.id;
  return (
    <div ref={box} className="explain" onKeyDown={event => event.stopPropagation()}>
      {!picked.asked ? (
        <button onClick={() => ask(picked)} title="Explain (Enter)" aria-keyshortcuts="Enter">
          Explain “{picked.text.length > 24 ? `${picked.text.slice(0, 24)}…` : picked.text}”
        </button>
      ) : (
        <div className="explain-card">
          <div role="status">{failed ? (
            <>
              {answer?.failed ? siteText(answer.text, hosted) : "Couldn't explain that just now."}
            </>
          ) : answer ? (
            <>
              <span className="ai-mark" role="img" aria-label="AI explanation" data-tip={TIPS.explanation}>✦</span> {answer.text}
            </>
          ) : (
            <span className="explain-wait">Explaining…</span>
          )}</div>
          <span className="explain-actions">
            {savedOn && picked.keepable && answer && !failed && <button onClick={() => keep(picked.id)} disabled={world.kept_answers?.some(a => a.id === picked.id && !a.removed)}>
              {world.kept_answers?.some(a => a.id === picked.id && !a.removed) ? "Saved" : "Keep"}
            </button>}
            {failed && <button onClick={() => ask(picked)}>Try again</button>}
            {answer && !failed && <button className="explain-off" aria-pressed={off.has(picked.id)} onClick={() => toggleOff(picked.id)}
              title={off.has(picked.id) ? "Marked off. Click to take it back." : "Off the mark? Note it, so explanations improve."}>
              {off.has(picked.id) ? "Marked off" : "Off?"}
            </button>}
            <button ref={dismiss} className="quiet" onClick={() => { previous.current?.focus({ preventScroll: true }); setPicked(null); }} aria-label="Dismiss explanation">×</button>
          </span>
        </div>
      )}
    </div>
  );
}


/** Exact historical answers use the existing inspection card and native keyboard buttons. */
export function SavedAnswers({ world, close, jump, visibility, connected }: {
  world: World; close: () => void; jump: (answer: KeptAnswer) => void;
  visibility: (id: string, revision: number, removed: boolean) => boolean; connected: boolean;
}) {
  const me = useMe();
  const [opened, setOpened] = useState<string | null>(null);
  const host = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    host.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const answers = world.kept_answers ?? [];
  const removed = [...answers].reverse().find(a => a.removed && a.owner === me);
  const answer = answers.find(a => a.id === opened && !a.removed);
  const state = answer ? answerSourceState(world, answer.source) : null;
  return <section ref={host} className="bring-here" aria-label="Saved answers" onKeyDown={event => {
    event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); close(); }
  }}>
    <header><span>Saved answers · {answers.filter(a => !a.removed).length}/30</span><button className="shell-btn" onClick={close}>Close</button></header>
    <div className="bring-here-content">
      <p>Exact AI answers kept by people on this map. Saving does not mark anything read, agreed or reviewed.</p>
      {answers.some(a => !a.removed) ? <ul>{answers.filter(a => !a.removed).map(a => <li key={a.id}>
        <button className="shell-btn" aria-expanded={opened === a.id} onClick={() => setOpened(a.id)}>{a.phrase}</button>
      </li>)}</ul> : <p>No saved answers. Select words on the map, Explain, then Keep.</p>}
      {answer && <article aria-label="Historical answer">
        <h2>{answer.phrase}</h2><p>{answer.answer}</p>
        <p className="bring-here-id">{answer.model} · Kept by {answer.owner} · {new Date(answer.at_ms).toLocaleString()}</p>
        <blockquote style={{ margin: "12px 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{answer.source.excerpt}</blockquote>
        <p role="status">{state === "changed" ? "Source changed" : state === "missing" ? "Source no longer available" : "Original source available"}</p>
        <p className="bring-here-id">Source {answer.source.thought_id} · revision {answer.source.revision}</p>
        <p><button className="shell-btn" disabled={state !== "available"} onClick={() => jump(answer)}>Jump to source</button></p>
        {answer.owner === me && <p><button className="shell-btn" disabled={!connected} onClick={() => visibility(answer.id, answer.revision, true)}>Remove saved answer</button></p>}
      </article>}
      {removed && <p>Removed “{removed.phrase}”. <button className="shell-btn" disabled={!connected} onClick={() => visibility(removed.id, removed.revision, false)}>Undo removal</button></p>}
    </div>
  </section>;
}
