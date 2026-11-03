// The Talk tab: who's in the call and what each is doing, what was said as messages ("as if people are sending messages
// to each other"), "Speaking now…" for whoever has the floor (never their words: those come with the turn), how far
// each person has read, a catch-up for what you missed, replies tied to the words they answer (margin notes, through
// `actions.annotate`, so the map shows them too), and how far the Friend may interrupt. It reads the map as a brick
// does and the call as the core tells it (call-core.ts). The rail's Talk tab once the shell has one; until then
// TalkRail.tsx stands in under the shell.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import type { BrickActions, BrickInfo, MapSnapshot } from "../bricks/contract";
import { useGuide } from "../guide-core";
import { sendToCore } from "../room";
import { TIPS } from "../Tips";
import { clock, initialOf, LEVELS, named, ordered, shown, stateWord, useCall, useSaid, type Call, type Level, type Person, type Said } from "./call-core";
import { newerMark, readersAt, readFor, turnIndex, turnsOf, unreadOf, type Turn } from "./turns";
import "./talk.css";

/** Who Talk acts as when it asks the map for something (a reply it sends is yours; this names it in a hint). */
export const TALK: BrickInfo = { id: "talk", name: "Talk", does: "Who's in the call, what was said, and how far each of you has read.", kind: "panel", defaultOn: true, demoSafe: true };

/** A row of the list: a turn from the journal, or something the Friend said here. */
type Row = { kind: "turn"; turn: Turn; i: number } | { kind: "said"; said: Said };

const HEAD_GAP_MS = 3 * 60_000;
const READ_KEY = "e2a2o.talk.read.";

function stored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function store(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* kept for this visit only */ }
}

/** The tab's body: people, turns, the meter. `open`: it's on screen (a closed rail reads nothing). */
export function Talk({ map, actions, open = true }: { map: MapSnapshot; actions: BrickActions; open?: boolean }) {
  const call = useCall();
  return call ? <TalkBody map={map} actions={actions} open={open} call={call} /> : null;
}

function TalkBody({ map, actions, open, call }: { map: MapSnapshot; actions: BrickActions; open: boolean; call: Call }) {
  const me = map.me;
  const turns = useMemo(() => turnsOf(map.thoughts, map.threads), [map.thoughts, map.threads]);
  const ai = (name: string) => !!map.speakers.get(name)?.ai || !!call?.people.find((p) => p.name === name)?.ai;
  // What an AI participant said or showed (call-core.ts keeps it); the caption up now is its live turn, kept once down.
  const saidAll = useSaid();
  const guide = useGuide();
  const captioning = guide.caption && ai(guide.caption.by) ? guide.caption : null;
  const said = useMemo(() => {
    const theirs = saidAll.filter((s) => ai(s.by));
    let live = -1;
    if (captioning) for (let i = theirs.length - 1; i >= 0 && live < 0; i--) if (theirs[i].level === "Speak" && theirs[i].by === captioning.by && theirs[i].text === captioning.text) live = i;
    return theirs.filter((_, i) => i !== live);
  }, [saidAll, captioning, map.speakers, call.people]);

  // How far you've read: the newer of this browser's mark and the core's (another window of yours), told to the core
  // as it moves and again on each connection, so the others see it and a restarted core learns it again.
  const readKey = READ_KEY + me;
  const coreMark = call?.people.find((p) => p.name === me)?.read ?? null;
  const [mark, setMark] = useState<string | null>(() => stored(readKey));
  const markIndex = turnIndex(turns, newerMark(turns, mark, coreMark));
  const markNow = markIndex >= 0 ? turns[markIndex].key : null;
  const markSent = useRef(markNow);
  markSent.current = markNow;
  useEffect(() => { if (map.connected && markSent.current) sendToCore({ type: "read", thought_id: markSent.current }); }, [map.connected]);
  const see = (i: number) => {
    if (i <= markIndex || !turns[i]) return;
    const key = turns[i].key;
    setMark(key);
    store(readKey, key);
    sendToCore({ type: "read", thought_id: key });
  };

  const from = call?.started_ms ?? 0;
  const firstInCall = turns.findIndex((turn) => turn.at >= from);
  const earlier = firstInCall < 0 ? turns.length : firstInCall;
  const unread = unreadOf(turns, markIndex, me, from);
  const firstUnread = unread.length ? turns.indexOf(unread[0]) : -1;
  const meNow = call?.people.find((p) => p.name === me);
  const late = !!meNow && meNow.joined_ms > from + 1000 && markIndex < firstInCall;
  const before = late ? turns.filter((turn) => turn.at >= from && turn.at < meNow!.joined_ms && turn.speaker !== me).length : 0;

  const [showEarlier, setShowEarlier] = useState(false);
  const rows = useMemo(() => {
    const out: Row[] = turns.map((turn, i) => ({ kind: "turn" as const, turn, i })).filter((row) => showEarlier || row.i >= earlier);
    for (const s of said) if (showEarlier || s.at >= from) out.push({ kind: "said", said: s });
    return out.sort((a, b) => at(a) - at(b));
  }, [turns, said, showEarlier, earlier, from]);

  // Who has the floor now: a person whose mic hears words, or the Friend while its caption is up.
  const live = ordered(call, me).filter((p) => p.speaking && p.here);
  const liveFriend = captioning && !live.some((p) => p.name === captioning.by) ? captioning.by : null;

  const scroller = useRef<HTMLDivElement>(null);
  const seen = useDwell(scroller, open, see, rows.length + live.length + (liveFriend ? 1 : 0));
  // Once the list has said what's in view (a frame after it shows), so the bar never flashes up on a list already there.
  const showCatchUp = unread.length > 0 && !!seen && !seen.has(firstUnread);
  const goToMissed = () => {
    const row = scroller.current?.querySelector<HTMLElement>(`[data-turn="${firstUnread}"]`);
    row?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    // Focused, so R answers it and the keys go on from there; no ring for a move the page made.
    row?.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
  };

  const [replying, setReplying] = useState<{ key: string; thoughtId: string; quote: string } | null>(null);
  const [picked, setPicked] = useState<{ key: string; thoughtId: string; quote: string } | null>(null);
  // Words picked in one part of a turn (a point on the map) can be answered beside them.
  const pick = () => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";
    const start = selection?.anchorNode?.parentElement?.closest<HTMLElement>("[data-part]");
    const end = selection?.focusNode?.parentElement?.closest<HTMLElement>("[data-part]");
    if (!text || !start || start !== end || start.dataset.placed !== "true") return setPicked(null);
    setPicked({ key: start.dataset.turnKey!, thoughtId: start.dataset.part!, quote: text });
  };
  const readers = useMemo(() => readersAt(turns, call?.people ?? [], me), [turns, call?.people, me]);

  let previous: Row | null = null;
  const items: ReactNode[] = [];
  for (const row of rows) {
    // A name over each run of one person's turns; again after the read line, a pause, or a note.
    const afterLine = previous?.kind === "turn" && previous.i === markIndex && unread.length > 0;
    const head = !previous || afterLine || speakerOf(previous) !== speakerOf(row) || at(row) - at(previous) > HEAD_GAP_MS || row.kind === "said" || previous.kind === "said"
      || (row.kind === "turn" && !!row.turn.note) || (previous.kind === "turn" && !!previous.turn.note);
    previous = row;
    if (row.kind === "said") {
      items.push(<li key={`said-${row.said.at}-${row.said.by}`} className="talk-turn">
        <TurnHead name={row.said.by} me={me} ai at={row.said.at} level={row.said.level} />
        <div className="talk-words">{row.said.text}</div>
      </li>);
      continue;
    }
    const { turn, i } = row;
    const noteOf = turn.note ? { key: turn.key, thoughtId: turn.note.thoughtId, quote: turn.note.quote } : null;
    const wholeOf = turn.parts[0].placed ? { key: turn.key, thoughtId: turn.parts[0].thoughtId, quote: turn.parts[0].text } : null;
    const seenHere = readers.get(i);
    items.push(<li key={turn.key} className={["talk-turn", turn.speaker === me && "talk-mine", seenHere && "talk-has-seen"].filter(Boolean).join(" ")} data-turn={i} data-read-ms={readFor(turn)} tabIndex={-1}
      onMouseUp={pick} onKeyUp={pick} onKeyDown={(event: KeyboardEvent) => {
        if (event.key !== "r" || event.metaKey || event.ctrlKey || event.altKey || event.target !== event.currentTarget) return;
        const to = noteOf ?? wholeOf;
        if (to) { event.preventDefault(); setReplying(to); }
      }}>
      {head && <TurnHead name={turn.speaker} me={me} ai={ai(turn.speaker)} at={turn.at} level={turn.note && ai(turn.speaker) ? "Comment" : undefined}
        onShow={() => actions.hint("Here on the map", `point:${turn.note?.thoughtId ?? turn.parts[0].thoughtId}`)}
        reply={noteOf && replying?.key !== turn.key ? () => setReplying(noteOf) : undefined} />}
      {turn.note && <div className="talk-on">on “{turn.note.quote}”</div>}
      <div className="talk-words">
        {turn.parts.map((part) => <span key={part.thoughtId} data-part={part.thoughtId} data-placed={String(part.placed)} data-turn-key={turn.key}>{part.text} </span>)}
      </div>
      {seenHere && <span className="talk-seen" title={`${seenHere.join(", ")} read up to here`}>
        {seenHere.map((name) => <span key={name} className="talk-seen-mark" aria-hidden="true">{initialOf(name)}</span>)}
        <span className="sr-only">{seenHere.join(", ")} read up to here</span>
      </span>}
      {replying?.key === turn.key
        ? <ReplyBox quote={replying.quote} send={(text) => actions.annotate(replying.thoughtId, replying.quote, text)} done={() => setReplying(null)} />
        : picked?.key === turn.key && <button type="button" className="talk-reply-start" onMouseDown={(event) => event.preventDefault()} onClick={() => { setReplying(picked); setPicked(null); }}>
            Reply to “{short(picked.quote)}” <kbd>↵</kbd></button>}
    </li>);
    if (i === markIndex && unread.length > 0) items.push(<li key="read-line" className="talk-read-line" role="separator">You read up to here</li>);
  }

  // Enter on picked words starts the reply, as its button says; picking elsewhere, or nothing, lets them go. Never while
  // you're typing somewhere (the composer's Enter is its own).
  useEffect(() => {
    if (!picked) return;
    const typing = () => !!document.activeElement?.closest("input, textarea, select, [contenteditable='true']");
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Enter" || event.isComposing || typing()) return;
      event.preventDefault();
      setReplying(picked);
      setPicked(null);
    };
    const onSelect = () => { if (!window.getSelection()?.toString().trim()) setPicked(null); };
    window.addEventListener("keydown", onKey);
    document.addEventListener("selectionchange", onSelect);
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("selectionchange", onSelect); };
  }, [picked]);

  const friend = call.people.find((p) => p.ai && p.here);
  return (
    <section className="talk" aria-label="Talk">
      <People call={call} me={me} captioning={captioning?.by ?? null} />
      <div className="talk-list">
        {/* Over the list's top, so coming and going it moves no turn; it goes once the first you missed is in view. */}
        {showCatchUp && <button type="button" className="talk-catch-up" onClick={goToMissed}>
          {late && before > 0 ? `Joined ${clock(meNow!.joined_ms)} · ${before} ${before === 1 ? "turn" : "turns"} before you` : `${unread.length} ${unread.length === 1 ? "turn" : "turns"} since you left`}
          <span className="talk-catch-up-go">Catch up</span></button>}
        <div ref={scroller} className="talk-scroll">
        <ol className="talk-turns">
          <li className="talk-start">
            <span>Call started {clock(call.started_ms)}{earlier > 0 && <> · {earlier} earlier {earlier === 1 ? "turn" : "turns"} · </>}</span>
            {earlier > 0 && <button type="button" className="talk-link" onClick={() => setShowEarlier((shown) => !shown)}>{showEarlier ? "Hide" : "Show"}</button>}
          </li>
          {items}
          {live.map((person) => <LiveTurn key={person.name} name={person.name} me={me} ai={person.ai} />)}
          {liveFriend && <LiveTurn name={liveFriend} me={me} ai level="Speak · at a pause" />}
        </ol>
        </div>
      </div>
      {friend && <Meter call={call} friend={friend} me={me} />}
    </section>
  );
}

const at = (row: Row) => (row.kind === "turn" ? row.turn.at : row.said.at);
const speakerOf = (row: Row) => (row.kind === "turn" ? row.turn.speaker : row.said.by);
const short = (quote: string) => (quote.length > 32 ? `${quote.slice(0, 30).trimEnd()}…` : quote);
const shownName = (name: string, me: string) => (name === me ? "You" : shown(name));

/** A turn's name line: who, when (a click shows it on the map), the Friend's level; a note's Reply at its end. */
function TurnHead({ name, me, ai, at, level, onShow, reply }: { name: string; me: string; ai: boolean; at: number; level?: string; onShow?: () => void; reply?: () => void }) {
  return <div className={ai ? "talk-head talk-ai" : "talk-head"}>
    <span className="talk-name">{ai && "✦ "}{shownName(name, me)}</span>
    {onShow ? <button type="button" className="talk-time" onClick={onShow} title="Show it on the map">{clock(at)}</button> : <span className="talk-time">{clock(at)}</span>}
    {level && <span className="talk-level">{level}</span>}
    {reply && <button type="button" className="talk-reply-quiet" onClick={reply}>Reply</button>}
  </div>;
}

/** "Speaking now…" for whoever has the floor: their words come with the turn, never twice. */
function LiveTurn({ name, me, ai, level }: { name: string; me: string; ai: boolean; level?: string }) {
  return <li className={ai ? "talk-turn talk-live talk-live-ai" : "talk-turn talk-live"}>
    <div className={ai ? "talk-head talk-ai" : "talk-head"}>
      <span className="talk-name">{ai && "✦ "}{shownName(name, me)}</span><span className="talk-time">now</span>{level && <span className="talk-level">{level}</span>}
    </div>
    <div className="talk-words talk-speaking"><span className="talk-bars" aria-hidden="true"><i /><i /><i /><i /></span>Speaking now…</div>
  </li>;
}

/** The box a reply is typed in: Enter sends it as a margin note on the words, Esc lets it go. */
function ReplyBox({ quote, send, done }: { quote: string; send: (text: string) => boolean; done: () => void }) {
  const [text, setText] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);
  return <form className="talk-reply" onSubmit={(event) => { event.preventDefault(); if (text.trim() && send(text.trim())) done(); }}>
    <label className="talk-reply-label" htmlFor="talk-reply-field">Reply to “{short(quote)}”</label>
    <input id="talk-reply-field" ref={field} value={text} onChange={(event) => setText(event.target.value)} maxLength={6000} autoComplete="off"
      placeholder="Your reply, beside those words" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); done(); } }} />
  </form>;
}

/** Everyone in the call, you first: a letter, a name, what they're doing now. */
export function People({ call, me, captioning }: { call: Call; me: string; captioning: string | null }) {
  return <ul className="talk-people" aria-label="In the call">
    {ordered(call, me).map((person) => <li key={person.name} className={person.here ? "talk-person" : "talk-person talk-gone"}>
      <Avatar person={person} me={me} speaking={person.speaking || captioning === person.name} />
      <span className="talk-person-text">
        <span className="talk-person-name">{shownName(person.name, me)}</span>
        <span className={person.ai ? "talk-person-state talk-ai" : "talk-person-state"}>{stateWord(person, captioning === person.name)}</span>
      </span>
    </li>)}
  </ul>;
}

/** Someone's letter: yours ringed blue, the Friend's ✦ in its purple, a ring while they have the floor. */
export function Avatar({ person, me, speaking }: { person: Person; me: string; speaking: boolean }) {
  const cls = ["talk-avatar", person.name === me && "talk-avatar-you", person.ai && "talk-avatar-ai", speaking && "talk-avatar-speaking"].filter(Boolean).join(" ");
  return <span className={cls} aria-hidden="true" data-tip={person.ai ? TIPS.participant : undefined}>{initialOf(person.name, person.ai)}</span>;
}

/** How far the Friend may interrupt: five levels, the one set filled; anyone in the call may change it. */
function Meter({ call, friend, me }: { call: Call; friend: Person; me: string }) {
  const [failed, setFailed] = useState(false);
  const index = LEVELS.findIndex((level) => level.id === call.level);
  const set = (level: Level) => { setFailed(!sendToCore({ type: "level", level })); };
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (event: KeyboardEvent, i: number) => {
    const to = event.key === "ArrowRight" || event.key === "ArrowDown" ? i + 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? i - 1 : -2;
    if (to === -2 || to < 0 || to >= LEVELS.length) return;
    event.preventDefault();
    set(LEVELS[to].id);
    buttons.current[to]?.focus();
  };
  const who = named(friend);
  return <div className="talk-meter">
    <div className="talk-meter-label" id="talk-meter-label">{who.charAt(0).toUpperCase() + who.slice(1)}'s interruption level</div>
    <div className="talk-levels" role="radiogroup" aria-labelledby="talk-meter-label">
      {LEVELS.map((level, i) => <button key={level.id} ref={(el) => { buttons.current[i] = el; }} type="button" role="radio" aria-checked={i === index}
        tabIndex={i === index ? 0 : -1} className={["talk-level-step", i < index && "talk-level-in", i === index && "talk-level-on", level.id === "stop" && "talk-level-stop"].filter(Boolean).join(" ")}
        onClick={() => set(level.id)} onKeyDown={(event) => move(event, i)}>{level.name}</button>)}
    </div>
    <p className="talk-meter-says" aria-live="polite">{failed ? "Not connected — try again when connected." : LEVELS[index]?.says}
      {!failed && call.level_by && call.level_by !== me && <span className="talk-meter-by"> Set by {call.level_by}.</span>}</p>
  </div>;
}

/** Reading: a turn counts as read once it has been in view, whole, for its reading time (turns.ts `readFor`) while the
 *  page shows and Talk is open; `see` gets its index. Keeps the list at its newest while you're there, as a chat does,
 *  and returns which turns are in view now. `size` changes when rows come or go. */
function useDwell(scroller: RefObject<HTMLDivElement | null>, open: boolean, see: (i: number) => void, size: number): ReadonlySet<number> | null {
  const [inView, setInView] = useState<ReadonlySet<number> | null>(null);
  const latest = useRef(see);
  latest.current = see;
  const atEnd = useRef(true);
  const placed = useRef(false);
  // At the newest when you were there: new rows keep it there. First time: at the read line if there's one, else the end.
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    if (!placed.current) {
      placed.current = true;
      const line = box.querySelector<HTMLElement>(".talk-read-line");
      if (line) { box.scrollTop = Math.max(0, line.offsetTop - box.clientHeight / 3); atEnd.current = false; return; }
    }
    if (atEnd.current) box.scrollTop = box.scrollHeight;
  }, [size, scroller]);
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const onScroll = () => { atEnd.current = box.scrollHeight - box.scrollTop - box.clientHeight < 24; };
    box.addEventListener("scroll", onScroll, { passive: true });
    return () => box.removeEventListener("scroll", onScroll);
  }, [scroller]);
  useEffect(() => {
    const box = scroller.current;
    if (!box || !open || typeof IntersectionObserver === "undefined") return;
    const timers = new Map<Element, number>();
    const whole = new Set<Element>();
    const start = (el: Element) => {
      if (timers.has(el) || document.visibilityState === "hidden") return;
      const ms = Number((el as HTMLElement).dataset.readMs) || 1500;
      timers.set(el, window.setTimeout(() => {
        timers.delete(el);
        if (whole.has(el) && document.visibilityState !== "hidden") latest.current(Number((el as HTMLElement).dataset.turn));
      }, ms));
    };
    const stop = (el: Element) => { window.clearTimeout(timers.get(el)); timers.delete(el); };
    const report = () => setInView(new Set([...whole].map((el) => Number((el as HTMLElement).dataset.turn))));
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const full = entry.isIntersecting && (entry.intersectionRatio > 0.98 || entry.intersectionRect.height >= box.clientHeight * 0.8);
        if (full) { whole.add(entry.target); start(entry.target); } else { whole.delete(entry.target); stop(entry.target); }
      }
      report();
    }, { root: box, threshold: [0, 0.5, 0.99] });
    const watched = new Set<Element>();
    const sync = () => {
      const now = new Set(box.querySelectorAll("[data-turn]"));
      for (const el of now) if (!watched.has(el)) { watched.add(el); observer.observe(el); }
      for (const el of watched) if (!now.has(el)) { watched.delete(el); whole.delete(el); stop(el); observer.unobserve(el); }
    };
    sync();
    const mutations = new MutationObserver(sync);
    mutations.observe(box, { childList: true, subtree: true });
    const visibility = () => {
      if (document.visibilityState === "hidden") for (const el of [...timers.keys()]) stop(el);
      else for (const el of whole) start(el);
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      observer.disconnect();
      mutations.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      for (const el of [...timers.keys()]) stop(el);
    };
  }, [open, scroller]);
  return inView;
}
