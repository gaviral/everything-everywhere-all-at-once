// What each thing on the Spine looks like (layout.ts places them; index.tsx puts them on the canvas). Far out, words
// that couldn't be read become soft bars the length of their lines ("greeking"), and a topic's title grows to stay
// readable; close in, every word shows. Origin without words: your points plain, another's with their initial on the
// line, the Friend's with ✦; what was agreed carries both marks.
import { createContext, Fragment, memo, useContext, useEffect, useLayoutEffect, useRef, useState, useId, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from "react";
import { useStore, type Node, type NodeProps } from "@xyflow/react";
import { G, type Entry, type Item, type Who } from "./layout";
import { SpeechFixesContext, SemanticZoomContext, type Pause, type Thought } from "../contract";
import { StayHere } from "../../StayHere";
import { C } from "./conversation";

/** Below this zoom a point's 15 px words are under 11 px on screen, the smallest the app sets: they turn to bars. */
export const READ = 0.75;
/** Semantic zoom keeps the real words mounted while CSS blends them into an overview. */
function useFar() {
  const semantic = useContext(SemanticZoomContext);
  return useStore((s) => !semantic && far(s.transform[2]));
}

export type ItemData = {
  item: Item;
  pauses?: readonly Pause[];
  overview?: { thread: string; title: string; count: number }[];
  here: boolean;
  pulse: number;
  fresh: boolean;
  picked: boolean;
  /** Not the topic you're on, while the view follows you (or not what the Friend points at): 78%, so less to read. */
  dim: boolean;
  /** A thought of yours landed here and its flight is still in the air: the slot stays open (dashed) until it arrives. */
  arriving: string | null;
  /** The camera just cut here (Reduce Motion): a ring for a second shows where. */
  cut: boolean;
  /** Its words are being picked for a margin note. */
  selecting: boolean;
  /** A named topic's header with a spine carried over its columns: where the spine would go. */
  hot?: boolean;
};
export type ItemNode = Node<ItemData, "item">;

/** What a thing on the canvas can ask of the view. */
export interface Acts {
  /** Jump along a projection link on this canvas. */
  visit(key: string): void;
  resume(id:string,keyboard:boolean): void;
  toggle(thread: string): void;
  pick(item: Item): void;
  words(item: Item): void;
  focus(item: Item): void;
  openOnMap(thread: string): void;
  read(item: Item): void;
  shelve(item: Item): void;
  unpin(item: Item): void;
  /** Starts picking words in a point (a double click), from where it was clicked. */
  select(item: Item, x: number, y: number): void;
  /** Answers a point's words: all of them (from the keyboard), or a margin note's own words (a reply to it). */
  reply(item: Item, quote?: string): void;
  /** Opens or folds a folded question. */
  unfold(margin: string): void;
  /** The named topics, in the map's order: what a spine can be moved under. */
  topics: readonly string[];
  /** A topic renamed on its header, for everyone. */
  renameTopic(from: string, to: string): void;
  /** A spine moved under another topic, for everyone. */
  moveToTopic(thread: string, topic: string): void;
}
export const ActsContext = createContext<Acts | null>(null);

const cls = (...names: (string | false | undefined | null)[]) => names.filter(Boolean).join(" ");
export const roomStyle = (room: string | undefined): CSSProperties | undefined =>
  room ? ({ "--spine-room": `var(--room-${room})`, "--spine-room-soft": `var(--room-${room}-soft)` } as CSSProperties) : undefined;
const far = (zoom: number) => zoom < READ;

/** "3 points · 12 min ago": what a closed tangent holds and how fresh it is. */
export function recap(item: Item, now: number) {
  const n = item.count ?? 0;
  const parts = [n ? `${n} ${n === 1 ? "point" : "points"}` : "Nothing yet"];
  if (item.dropped) parts.push("left off");
  if (item.since) parts.push(ago(now - item.since));
  return parts.join(" · ");
}
export function ago(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}
/** A head's line: how many points, then who (once someone else has spoken on it) or when. */
export function headMeta(item: Item, now: number) {
  const n = item.count ?? 0;
  const count = n ? `${n} ${n === 1 ? "point" : "points"}` : "Nothing yet";
  const people = item.speakers ?? [];
  if (people.some((who) => !who.me)) return `${count} · ${people.map((who) => (who.ai ? "✦ AI helper" : who.name)).join(", ")}`;
  return item.since ? `${count} · ${ago(now - item.since)}` : count;
}

/** Words too small to read, as bars the length of their lines. */
function Bars({ lines, line, x, y = 0, thick }: { lines: number[]; line: number; x: number; y?: number; thick?: boolean }) {
  return <span className={cls("spine-bars", thick && "spine-bars-thick")} aria-hidden="true">
    {lines.map((w, i) => <span key={i} style={{ left: x, top: y + i * line + line / 2, width: Math.max(12, w) }} />)}
  </span>;
}

/** An initial on the line: another person's, or ✦ for the Friend. */
export function Initial({ who, small, style }: { who: Who; small?: boolean; style?: CSSProperties }) {
  return <span className={cls("spine-who", small && "spine-who-small", who.ai && "spine-who-ai", who.me && "spine-who-me")} style={style} title={who.name} aria-hidden="true">{who.initial}</span>;
}

/** The small controls a thing shows while pointed at or focused: open its thread on the map, keep it on the shelf, and
 *  (placed by hand) put it back where the layout would. */
function Tools({ item }: { item: Item }) {
  const acts = useContext(ActsContext)!;
  const thread = item.kind === "head" || item.kind === "card" || item.kind === "aside";
  return <span className="spine-tools">
    {thread && <button type="button" className="spine-tool nodrag" aria-label={`Open ${item.title} on the map`} title="Open on the map" onClick={() => acts.openOnMap(item.thread)}>↗</button>}
    <button type="button" className="spine-tool nodrag" aria-label="Keep on the shelf" title="Keep on the shelf" onClick={() => acts.shelve(item)}>⤓</button>
    {item.kind === "head" && acts.topics.length >= 2 && <TopicTool item={item} />}
    {item.pinned && <button type="button" className="spine-tool spine-tool-pin nodrag" aria-label="Unpin: back to its place in the layout"
      title={item.by && item.by !== "you" ? `Placed by ${item.by} · unpin` : "Unpin: back to its place"} onClick={() => acts.unpin(item)}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M5 1.5h6l-1 4.5 2.5 2.5h-9L6 6z M8 8.5v6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></svg>
    </button>}
  </span>;
}

/** A spine's topic, picked from the named ones: the keyboard's and a phone's way to move it, as dragging it onto another
 *  topic's columns does. */
function TopicTool({ item }: { item: Item }) {
  const acts = useContext(ActsContext)!;
  const now = item.group ?? "";
  return <label className="spine-tool spine-tool-topic nodrag" title={now ? `Theme: ${now} · move to another` : "Not sorted yet · put it under a theme"}>
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M2.5 5h9m-2.5-2.5L11.5 5 9 7.5M13.5 11h-9M7 8.5 4.5 11 7 13.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    <select className="spine-tool-select" value={now} aria-label={`Theme of ${item.title}`} onChange={(event) => { if (event.target.value) acts.moveToTopic(item.thread, event.target.value); }}>
      {!now && <option value="">Not sorted yet</option>}
      {acts.topics.map((name) => <option key={name} value={name}>{name}</option>)}
    </select>
  </label>;
}

/** Far out, a topic's name is 18 px on screen, unless its longest word wouldn't fit across its columns (`cqi`: the
 *  header's width), so it wraps only between words: a word's width is about 0.6 of the size a letter. */
const farSize = (name: string) => {
  const longest = Math.max(4, ...name.split(/\s+/).map((word) => [...word].length));
  return `min(calc(18px * var(--spine-k, 1)), ${(100 / (0.6 * longest)).toFixed(1)}cqi)`;
};

/** A named topic's header: its name over a hairline as wide as its columns, and how many spines it holds. A double click
 *  (or Enter) renames it for everyone; "Not sorted yet" holds new spines until the AI sorts them (within a minute) and
 *  isn't renamed. Far out, its name keeps a size you can read, growing up from its line, never into the spines under it. */
function Group({ data }: { data: ItemData }) {
  const { item } = data;
  const acts = useContext(ActsContext)!;
  const zoomedOut = useFar();
  const name = item.group ?? "";
  const [editing, setEditing] = useState(false);
  // Shown at once while the core makes it so (the header comes back under its new name); a refused one lets go.
  const [pending, setPending] = useState<string | null>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    if (pending === null) return;
    const timer = window.setTimeout(() => setPending(null), 4000);
    return () => window.clearTimeout(timer);
  }, [pending]);
  const shown = pending ?? name;
  const count = `${item.count ?? 0} ${item.count === 1 ? "topic" : "topics"}`;
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    const next = value?.trim().split(/\s+/).join(" ") ?? "";
    if (next && next !== name) {
      setPending(next);
      acts.renameTopic(name, next);
    }
  };
  const start = () => { if (name) { done.current = false; setEditing(true); } };
  return <div className={cls("spine-group", !name && "spine-group-unsorted", data.hot && "spine-group-hot", zoomedOut && "spine-group-far", data.fresh && "spine-fresh")}>
    {editing
      ? <input className="spine-group-field nodrag nopan" defaultValue={name} maxLength={40} autoFocus aria-label={`New name for the theme ${name}`}
        onFocus={(event) => event.currentTarget.select()} onBlur={(event) => finish(event.currentTarget.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") { event.preventDefault(); finish(event.currentTarget.value); }
          else if (event.key === "Escape") { event.preventDefault(); finish(null); }
        }} />
      : <button type="button" className="spine-group-name" style={zoomedOut ? { fontSize: farSize(name ? shown : "Not sorted yet") } : { maxWidth: Math.max(80, item.box.w - 90) }} onDoubleClick={start} onFocus={() => acts.focus(item)}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === "F2") { event.preventDefault(); start(); } }}
        title={name ? `${shown} · double-click to rename` : "New topics wait here until the AI puts them under a theme, within a minute"}
        aria-label={name ? `Theme ${shown}, ${count}. Press Enter to rename it` : `Not sorted yet, ${count}`}>{name ? shown : "Not sorted yet"}</button>}
    {(!zoomedOut || data.hot) && !editing && <span className="spine-group-count" aria-hidden="true">{data.hot ? "Move here" : count}</span>}
  </div>;
}

function Tile({ item }: { item: Item }) {
  const [shown, setShown] = useState(false);
  const letter = Array.from((item.title ?? "").trim())[0]?.toLocaleUpperCase() ?? "?";
  return <span className="spine-tile" aria-hidden="true">
    <span className="spine-letter">{letter}</span>
    {item.picture && <img className={cls("spine-picture", shown && "spine-picture-shown")} src={item.picture} alt="" draggable={false}
      onLoad={() => setShown(true)} onError={() => setShown(false)} />}
  </span>;
}

/** Far out, a title's lines: as many as fit (13/16 on screen, 3 at most) before the topic under it starts. */
const LABEL_LINE = 16;
const LABEL_PAD = 6;

function Head({ data, now }: { data: ItemData; now: number }) {
  const { item, here, picked } = data;
  const acts = useContext(ActsContext)!;
  const zoomedOut = useFar();
  const semantic = useContext(SemanticZoomContext);
  const labelLines = useStore((s) => semantic ? 3 : Math.max(1, Math.min(3, Math.floor(((item.reach ?? Infinity) * s.transform[2] - LABEL_PAD) / LABEL_LINE))));
  const lines = item.titleLines?.length ?? 1;
  const top = Math.max(0, (G.tile - lines * G.titleLine - G.headMeta) / 2);
  const meta = headMeta(item, now);
  return <div className={cls("spine-head", item.pinned && "spine-pinned", item.dropped && "spine-left", here && "spine-on", picked && "spine-picked", data.fresh && "spine-fresh",
    data.dim && "spine-dim", data.cut && "spine-cut", zoomedOut && "spine-head-far")} style={roomStyle(item.room)} data-thread={item.thread} data-guide={`thread:${item.thread}`}>
    <Tile item={item} />
    <StayHere thread={item.thread} title={item.title} />
    <button type="button" className="spine-title" style={{ left: G.titleX, top, width: G.titleW, WebkitLineClamp: G.titleMax }}
      title={item.title} onClick={() => acts.pick(item)} onFocus={() => acts.focus(item)} onDoubleClick={() => acts.openOnMap(item.thread)}
      aria-label={`${item.title}: ${meta}${item.dropped ? ", left off" : ""}${here ? ", where you are" : ""}`}>
      {item.title}
    </button>
    <span className="spine-head-meta" style={{ left: G.titleX, top: top + lines * G.titleLine }} aria-hidden="true">{meta}</span>
    {zoomedOut && <span className="spine-label" style={{ WebkitLineClamp: labelLines }} aria-hidden="true">{item.title}</span>}
    <Tools item={item} />
  </div>;
}

/** A point's words, with the words that carry a margin note underlined, and room kept after a folded question for its
 *  "…?" (the layout measured it there). The page's color sits behind the words line by line, not the whole box, so a
 *  string or a curve can start right where the words end. */
function Words({ item }: { item: Item }) {
  const shown = item.shown ?? item.text ?? "";
  const quotes = (item.quotes ?? []).filter((q) => q.start >= 0);
  const parts: ReactNode[] = [];
  const fixes = useContext(SpeechFixesContext);
  // Split only the text runs, so a margin note can still underline the same uncertain words.
  const marked = (start: number, end: number) => {
    const runs: ReactNode[] = [];
    let at = start;
    for (const f of item.fixes ?? []) {
      const left = Math.max(at, f.start), right = Math.min(end, f.start + f.thought.unclear.length);
      if (left >= right) continue;
      runs.push(shown.slice(at, left));
      runs.push(<SpeechCheck key={f.thought.id} thought={f.thought} controls={fixes?.(f.thought)}>{shown.slice(left, right)}</SpeechCheck>);
      at = right;
    }
    runs.push(shown.slice(at, end));
    return runs;
  };
  let at = 0;
  for (const q of quotes) {
    if (q.start < at) continue;
    parts.push(...marked(at, q.start));
    parts.push(<span key={q.margin} className="spine-quote" data-margin={q.margin}>{marked(q.start, q.end)}</span>);
    at = q.end;
    if (q.folded) {
      parts.push(...marked(at, q.fold));
      parts.push(<span key={`${q.margin}-room`} className="spine-fold-room" data-fold={q.margin} aria-hidden="true">{" …?"}</span>);
      at = q.fold;
    }
  }
  parts.push(...marked(at, shown.length));
  const fixed = item.marks?.find((m) => m.kind === "fixed");
  return <span className="spine-words">{parts.map((part, i) => <Fragment key={i}>{part}</Fragment>)}{fixed && <span className="spine-mark-ai" title={fixed.text} aria-hidden="true">{" ✦"}</span>}</span>;
}

/** The uncertain words open the same controls as Cards, on the top layer so they stay clear of the canvas. */
function SpeechCheck({ thought, controls, children }: { thought: Thought; controls: ReactNode; children: ReactNode }) {
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLSpanElement>(null);
  const id = useId();
  return <>
    <button ref={button} type="button" className="spine-uncertain nodrag nopan" popoverTarget={id}
      aria-label={`Check possibly misheard words: ${thought.unclear}`} title="Might be misheard · check words"
      onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}>{children}</button>
    <span ref={panel} id={id} popover="auto" className="spine-fixes nodrag nopan" role="group" aria-label="Check words"
      onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}
      onToggle={() => {
        const el = panel.current, anchor = button.current;
        if (!el?.matches(":popover-open") || !anchor) return;
        const r = anchor.getBoundingClientRect(), box = el.getBoundingClientRect();
        el.style.left = `${Math.max(G.pad, Math.min(r.left, innerWidth - box.width - G.pad))}px`;
        el.style.top = `${Math.max(G.pad, Math.min(r.bottom, innerHeight - box.height - G.pad))}px`;
      }}>{controls}</span>
  </>;
}

/** Under a point: ✓ Decided (or ✓ Agreed with who agreed), Left off. */
function Chips({ item, offset = 0 }: { item: Item; offset?: number }) {
  return <span className="spine-chips" style={{ left: item.look!.textX, top: item.lines!.length * item.look!.line + offset + 5 }}>
    {item.decided && (item.agreed ? <span className="spine-chip spine-agreed">✓ Agreed{item.agreed.map((who) => <Initial key={who.name} who={who} small />)}</span>
      : <span className="spine-chip">✓ Decided</span>)}
    {item.left && <span className="spine-chip spine-chip-left">Left off</span>}
  </span>;
}

/** A margin note's entries, as a note beside the words or tucked under them. */
function Entries({ entries, thread }: { entries: Entry[]; thread?: string }) {
  return <>{entries.map((entry, i) => <span key={i} className="spine-entry" data-thought={entry.thoughtId} data-thread={thread}>
    {entry.who.me ? <span className="spine-entry-mine" aria-hidden="true" /> : <Initial who={entry.who} small />}
    <span className="spine-entry-text" style={{ WebkitLineClamp: entry.lines.length }}><span className="spine-speaker">{entry.who.name}</span>{entry.text}</span>
  </span>)}</>;
}

function Point({ data }: { data: ItemData }) {
  const { item, here, pulse, picked, arriving } = data;
  const acts = useContext(ActsContext)!;
  const zoomedOut = useFar();
  const look = item.look!;
  const lines = item.lines ?? [0];
  const textH = lines.length * look.line;
  const wordsH = item.wordsOpen === undefined ? 0 : G.pointLine + G.pointGap;
  const label = `${item.who ? `${item.who.name}: ` : ""}${item.text}${item.decided ? item.agreed ? " (agreed)" : " (decided)" : ""}${item.left ? " (left off)" : ""}${here ? ", your latest point" : ""}`;
  const keys = (event: KeyboardEvent) => {
    // The page's word-selection handler needs Enter without defaultPrevented to open Reply.
    if (event.key === "Enter" && data.selecting) return;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); acts.pick(item); }
    else if ((event.key === "r" || event.key === "R") && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); acts.reply(item); }
  };
  return <div className={cls("spine-point", look.variant === "mini" && "spine-point-mini", item.pinned && "spine-pinned", here && "spine-on", picked && "spine-picked",
    data.fresh && "spine-fresh", data.dim && "spine-dim", item.left && "spine-point-left", arriving && "spine-arriving", data.cut && "spine-cut", data.selecting && "spine-selecting")}
    style={roomStyle(item.room)} data-thread={item.thread} data-thought={item.id} data-heads={item.thoughts?.join(" ")}
    data-readable={!zoomedOut && !arriving ? "true" : undefined} data-guide={`point:${item.id}`} data-slot={arriving ? `slot:${arriving}` : undefined}>
    {item.who ? <Initial who={item.who} small={look.variant === "mini"} style={{ left: look.lineX, top: look.line / 2 }} />
      : <span className={cls("spine-dot", item.decided && "spine-dot-decided")} style={{ left: look.lineX, top: look.line / 2 }} aria-hidden="true" />}
    {pulse > 0 && !arriving && <span key={pulse} className="spine-ring" style={{ left: look.lineX, top: look.line / 2 }} aria-hidden="true" />}
    {arriving && <span className="spine-slot-box" style={{ left: look.textX - 9, width: look.textW - 6, top: -3, height: textH + 6 }} aria-hidden="true" />}
    {zoomedOut ? <Bars lines={lines} line={look.line} x={look.textX} />
      : <span role="button" tabIndex={0} className={cls("spine-text", data.selecting && "nodrag nopan")} style={{ left: look.textX, width: look.textW, WebkitLineClamp: lines.length, lineHeight: `${look.line}px` }}
        title={item.text} aria-label={label} onClick={(event) => { if (!data.selecting && !(event.target as Element).closest(".spine-fold")) acts.pick(item); }}
        onKeyDown={keys} onFocus={() => acts.focus(item)} onDoubleClick={(event: MouseEvent) => { if (!data.selecting) acts.select(item, event.clientX, event.clientY); }}>
        <span className="spine-speaker">{item.who?.name ?? "you"}</span><Words item={item} />
      </span>}
    {!zoomedOut && item.quotes?.filter((q) => q.folded && q.start >= 0).map((q) => <Fold key={q.margin} margin={q.margin} />)}
    {!zoomedOut && item.wordsOpen !== undefined && <button type="button" className="spine-original nodrag nopan"
      style={{ left: look.textX, top: textH, height: wordsH }} aria-expanded={item.wordsOpen}
      onClick={() => acts.words(item)}>{item.wordsOpen ? "Show less" : "Words said"}</button>}
    {!zoomedOut && item.chips && <Chips item={item} offset={wordsH} />}
    {!zoomedOut && item.landing && <span className="spine-landing" style={{ left: look.textX, top: textH + wordsH + (item.chips ? G.chips : 0) + 2 }}>{item.landing}</span>}
    {!zoomedOut && item.tucks && <span className="spine-tucks" style={{ left: look.textX, width: look.textW, top: textH + wordsH + (item.chips ? G.chips : 0) + (item.landing ? G.landLine : 0) }}>
      {item.tucks.map((tuck) => tuck.thread
        ? <button key={tuck.margin} type="button" className="spine-tuck spine-tuck-tangent nodrag" data-thread={tuck.thread} onClick={() => acts.toggle(tuck.thread!)}
          aria-label={`${tuck.title}, a tangent: ${tuck.entries[0]?.text ?? "nothing yet"}. Open it`}>
          <span className="spine-tuck-title">{`${tuck.title} · tangent`}</span>
          {tuck.entries.map((entry, i) => <span key={i} className="spine-entry-text" style={{ WebkitLineClamp: G.marginMax }}><span className="spine-speaker">{entry.who.name}: </span>{entry.text}</span>)}
        </button>
        : <span key={tuck.margin} className="spine-tuck" data-margin={tuck.margin}><Entries entries={tuck.entries} thread={tuck.margin} /></span>)}
    </span>}
    <PausedSources data={data} />
    <Tools item={item} />
  </div>;
}

function PausedSources({ data }: { data: ItemData }) {
  const acts = useContext(ActsContext)!;
  const pauses = data.pauses ?? [];
  return <>{pauses.map((pause, i) => <button key={pause.id} type="button" className="spine-paused-mark nodrag nopan"
    data-paused-source={pause.id} data-source-thought={pause.thought_id} title={pause.excerpt} aria-label={`Paused here: ${pause.excerpt} (interruption ${pause.revision})`}
    style={{ left: data.item.look?.textX ?? G.textX, top: data.item.box.h - (pauses.length - i) * 44, height: 44 }}
    onClick={event => { event.stopPropagation(); acts.resume(pause.id, event.detail === 0); }}>Paused here</button>)}</>;
}

function ConversationPoint({ data }: { data: ItemData }) {
  const { item } = data;
  const acts = useContext(ActsContext)!;
  const who = item.who!;
  const textH = item.lines!.length * G.pointLine;
  return <div className={cls("spine-point", "spine-conversation-turn", data.picked && "spine-picked", data.cut && "spine-cut")}
    data-thread={item.thread || undefined} data-thought={item.id} data-guide={`point:${item.id}`}>
    <Initial who={who} style={{ left: G.lineX, top: C.speaker + G.dotY }} />
    <span className="spine-turn-speaker" style={{ left: G.textX }}>{who.ai ? `✦ ${who.name}` : who.name}</span>
    <span className="spine-text" data-spine-target tabIndex={0} role="button" style={{ left: G.textX, top: C.speaker, width: G.textW, WebkitLineClamp: item.lines!.length }}
      aria-label={`${who.name}: ${item.text}`} onFocus={() => acts.focus(item)} onClick={() => acts.pick(item)}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); acts.pick(item); } }}>
      <Words item={item} />
    </span>
    <span className="spine-turn-status" style={{ left: G.textX, top: C.speaker + textH }}>
      {item.decided ? "✓ Decided" : item.left ? "Left off" : ""}
    </span>
    <span className="spine-turn-topics" style={{ left: G.textX, top: C.speaker + textH + C.status, width: G.textW }}>
      {item.replyTo && <button type="button" className="nodrag nopan" aria-label="Back to the turn these words answer" onClick={() => acts.visit(item.replyTo!)}>↖ Reply to</button>}
      {item.memberships?.map((topic) => <button key={topic.thread} type="button" className="nodrag nopan" title={topic.title}
        aria-label={`Topic: ${topic.title}`} onClick={() => acts.visit(`t:${topic.thread}`)}>↗ {topic.title}</button>)}
      {!item.memberships?.length && <span className="spine-turn-sorting">Awaiting topic</span>}
    </span>
    <PausedSources data={data} />
  </div>;
}

function ConversationHead({ item }: { item: Item }) {
  return <div className="spine-conversation-head" data-spine-target tabIndex={-1} data-session={item.session ? item.id : undefined}><strong>{item.title ?? "Conversation"}</strong><span>{item.subtitle ?? `${item.count} turns · topics linked beside your words`}</span></div>;
}

function TopicProjection({ data }: { data: ItemData }) {
  const { item } = data;
  const acts = useContext(ActsContext)!;
  return <div className={cls("spine-topic", data.picked && "spine-picked")} data-thread={item.thread} style={roomStyle(item.room)}>
    <span className="spine-topic-count">{item.count} {item.count === 1 ? "turn" : "turns"} · topic</span>
    <button type="button" data-spine-target className="spine-topic-title nodrag nopan" title={item.title} aria-expanded={!!item.open}
      aria-label={`${item.title}: ${item.count} turns. ${item.open ? "Fold" : "Show linked turns"}`}
      onFocus={() => acts.focus(item)} onClick={() => acts.toggle(item.thread)}>{item.title}<span aria-hidden="true">{item.open ? " −" : " +"}</span></button>
    {item.parentTopic && <button type="button" className="spine-topic-parent nodrag nopan" title={item.parentTopic.title}
      onClick={() => acts.visit(`t:${item.parentTopic!.thread}`)}>Tangent of {item.parentTopic.title}</button>}
    {item.open && <div className="spine-topic-members">{item.members?.map((member) => <button key={member.key} type="button" className="spine-topic-member nodrag nopan"
      aria-label={`Back to ${member.speaker}: ${member.text}`} onClick={() => acts.visit(member.key)}>
      <span>{member.speaker}</span><span>{member.text}</span>
    </button>)}</div>}
  </div>;
}

/** A folded question's "…?", over the room its words keep for it (measured where the browser set it): open shows the
 *  note. */
function Fold({ margin }: { margin: string }) {
  const acts = useContext(ActsContext)!;
  const self = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const room = self.current?.parentElement?.querySelector<HTMLElement>(`[data-fold="${CSS.escape(margin)}"]`);
    const text = room?.offsetParent as HTMLElement | null;
    if (!room || !text) return;
    const next = { left: text.offsetLeft + room.offsetLeft + 4, top: text.offsetTop + room.offsetTop + (room.offsetHeight - 20) / 2 };
    setAt((was) => (was && was.left === next.left && was.top === next.top ? was : next));
  });
  return <button ref={self} type="button" className="spine-fold nodrag" data-fold-for={margin} aria-label="A question on these words: show it" title="A question: show it"
    style={at ? { left: at.left, top: at.top } : { visibility: "hidden" }} onClick={(event) => { event.stopPropagation(); acts.unfold(margin); }}>…?</button>;
}

/** A tangent's name in Pictures, from this zoom in: it is 100 px of text, and the room beside its card (the card, its 48 unit
 *  gutter and the 96 of lane before the next topic: 376 units, less its 72 unit picture and a 5 px gap) holds that only from
 *  here. Further out its picture stands alone, as on a phone's whole-map view, where names would only cover each other. */
const NAMED = 0.35;

function Card({ data, now }: { data: ItemData; now: number }) {
  const { item, here, pulse, picked } = data;
  const acts = useContext(ActsContext)!;
  const zoomedOut = useFar();
  const named = useStore((s) => s.transform[2] >= NAMED);
  const titleLines = item.titleLines ?? [0];
  const inner = G.cardW - 2 * G.pad;
  return <div className={cls("spine-card", item.open && "spine-card-open", item.slim && "spine-card-slim", item.side === -1 && "spine-card-west", !!item.tangents && "spine-card-nest", item.pinned && "spine-pinned", item.dropped && "spine-left", here && "spine-on",
    picked && "spine-picked", data.fresh && "spine-fresh", data.dim && "spine-dim", data.cut && "spine-cut")} style={roomStyle(item.room)} data-thread={item.thread} data-guide={`thread:${item.thread}`}
    data-slot={data.arriving ? `slot:${data.arriving}` : undefined}>
    {pulse > 0 && <span key={pulse} className="spine-card-ring" aria-hidden="true" />}
    <StayHere thread={item.thread} title={item.title} />
    {item.open && item.line && <span className="spine-card-line" style={{ left: item.line.x, top: item.line.y1, height: Math.max(0, item.line.y2 - item.line.y1) }} aria-hidden="true" />}
    <button type="button" className="spine-card-face" onClick={() => acts.toggle(item.thread)} onFocus={() => acts.focus(item)} onDoubleClick={() => acts.openOnMap(item.thread)}
      aria-expanded={!!item.open} title={item.title}
      aria-label={`${item.title}, a tangent: ${recap(item, now)}${here ? ", where you are" : ""}${item.open ? "" : `. Latest: ${item.latest || "nothing yet"}`}`}>
      {zoomedOut ? <Bars lines={titleLines} line={G.cardTitleLine} x={G.pad} y={G.pad} thick />
        : <span className="spine-card-title" style={{ WebkitLineClamp: G.cardTitleMax, width: inner }}>{item.title}</span>}
      {!item.open && (item.latestLines?.length ? (zoomedOut
        ? <Bars lines={item.latestLines} line={G.smallLine} x={G.pad} y={G.pad + titleLines.length * G.cardTitleLine + 4} />
        : <span key={item.latest} className="spine-card-latest" style={{ WebkitLineClamp: G.cardPointMax, width: inner }}>{item.latest}</span>) : null)}
      {!item.open && !zoomedOut && <span className="spine-card-recap">{`Tangent · ${recap(item, now)}`}</span>}
      {/* The Pictures stop (CSS shows it there only): the tangent as its small picture and its name, at the edge its curve comes in to. */}
      {zoomedOut && <span className="spine-card-pic" aria-hidden="true"><Tile item={item} />{named && <span className="spine-label">{item.title}</span>}</span>}
    </button>
    <Tools item={item} />
  </div>;
}

/** Where your thought on its way is expected: a hollow dot on the line and a dashed box (`data-slot`, the flight's aim). */
function Slot({ data }: { data: ItemData }) {
  const { item } = data;
  const look = item.look!;
  return <div className={cls("spine-slot", data.dim && "spine-dim")} style={roomStyle(item.room)} data-thread={item.thread} data-slot={`slot:${item.id}`} aria-hidden="true">
    <span className="spine-slot-dot" style={{ left: look.lineX, top: item.box.h / 2 }} />
    <span className="spine-slot-box" style={{ left: look.textX - 9, width: look.textW - 6, top: 0, height: item.box.h }} />
  </div>;
}

/** Most of a bubble's box that may lie past the canvas's edge and still count as whole: its shadow and a pixel of rounding. */
const WHOLE = 0.98;

/** Whether `ref`'s box lies whole inside the canvas (`.spine-frame`, which ends where the page's lane or rail begins); false
 *  while any edge slices it, or it is wholly out of view. The browser reports it as the canvas pans, zooms and resizes, so
 *  nothing here runs a frame at a time. Where there's no observer (a render without a page), whole. */
function useWhole(ref: RefObject<HTMLElement | null>): boolean {
  const [whole, setWhole] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current, frame = el?.closest(".spine-frame");
    if (!el || !frame || typeof IntersectionObserver === "undefined") return;
    const watch = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setWhole(last.intersectionRatio >= WHOLE);
    }, { root: frame, threshold: [WHOLE] });
    watch.observe(el);
    return () => watch.disconnect();
  }, [ref]);
  return whole;
}

/** A lone aside: one thought on its own, floating as a bubble of its words. It shows whole or not at all: a closed shape the
 *  screen's edge cuts through ("…ot sent yet") reads as a fault, where a topic's open column running off the edge reads as
 *  "more this way". It comes back, whole, as the canvas is moved to it. One you hold (dragged, on its way to the shelf) or
 *  have picked stays, as it is where your hand has it. */
function Aside({ data, dragging }: { data: ItemData; dragging: boolean }) {
  const { item, here, pulse, picked } = data;
  const acts = useContext(ActsContext)!;
  const zoomedOut = useFar();
  const bubble = useRef<HTMLDivElement>(null);
  const whole = useWhole(bubble) || dragging || picked;
  return <div ref={bubble} className={cls("spine-aside", item.pinned && "spine-pinned", here && "spine-on", picked && "spine-picked", data.fresh && "spine-fresh", data.dim && "spine-dim",
    data.cut && "spine-cut")} style={roomStyle(item.room)} data-edge={whole ? undefined : "cut"} data-thread={item.thread}
    data-thought={item.thoughts?.[0]} data-heads={item.thoughts?.join(" ")} data-readable={!zoomedOut && whole ? "true" : undefined} data-guide={`thread:${item.thread}`}>
    <StayHere thread={item.thread} title={item.title} />
    {pulse > 0 && <span key={pulse} className="spine-card-ring" aria-hidden="true" />}
    <button type="button" className="spine-aside-face" onClick={() => acts.pick(item)} onFocus={() => acts.focus(item)} onDoubleClick={() => acts.openOnMap(item.thread)}
      title={item.title} aria-label={`${item.who ? `${item.who.name}: ` : ""}${item.text}, an aside on its own (${item.title})`}>
      {zoomedOut ? <Bars lines={item.lines ?? [0]} line={G.asideLine} x={G.asideIn} y={G.asidePad} />
        : <span className="spine-aside-text" style={{ WebkitLineClamp: 3 }}>{item.who && <Initial who={item.who} small />}<span className="spine-speaker">{item.who?.name ?? "you"}</span>{item.text}</span>}
    </button>
    <Tools item={item} />
  </div>;
}

/** A margin note: the note and its latest reply beside the words they answer, tied to them by a string. */
function Margin({ data }: { data: ItemData }) {
  const { item } = data;
  const acts = useContext(ActsContext)!;
  const zoomedOut = useFar();
  if (zoomedOut) return <div className={cls("spine-margin", data.dim && "spine-dim")} aria-hidden="true"><Bars lines={(item.entries ?? []).flatMap((e) => e.lines)} line={G.marginLine} x={26} /></div>;
  return <div className={cls("spine-margin", data.dim && "spine-dim", data.fresh && "spine-fresh")} style={roomStyle(item.room)} data-margin={item.margin} role="note"
    aria-label={`A note on these words: ${(item.entries ?? []).map((e) => `${e.who.ai ? "the AI helper" : e.who.name}: ${e.text}`).join("; ")}`}>
    <Entries entries={item.entries ?? []} thread={item.margin} />
    {item.more && <span className="spine-margin-more">{`${item.more} more`}</span>}
    <button type="button" className="spine-margin-reply nodrag" onClick={() => acts.reply(item)}>Reply</button>
  </div>;
}

function Notch({ data }: { data: ItemData }) {
  const look = data.item.look!;
  return <span className={cls("spine-notch", data.dim && "spine-dim")} style={{ ...roomStyle(data.item.room), left: look.lineX }} aria-hidden="true" />;
}

/** The clock for "12 min ago", from the view (a minute's tick), so a card's recap stays true without a new map. */
export const NowContext = createContext(Date.now());

function Detail({ data, dragging }: { data: ItemData; dragging: boolean }) {
  const now = useContext(NowContext);
  switch (data.item.kind) {
    case "conversation": return <ConversationHead item={data.item} />;
    case "topic": return <TopicProjection data={data} />;
    case "head": return <Head data={data} now={now} />;
    case "card": return <Card data={data} now={now} />;
    case "point": return data.item.conversation ? <ConversationPoint data={data} /> : <Point data={data} />;
    case "slot": return <Slot data={data} />;
    case "aside": return <Aside data={data} dragging={dragging} />;
    case "margin": return <Margin data={data} />;
    case "group": return <Group data={data} />;
    default: return <Notch data={data} />;
  }
}

export const ItemView = memo(function ItemView({ data, dragging }: NodeProps<ItemNode>) {
  const semantic = useContext(SemanticZoomContext);
  const acts = useContext(ActsContext)!;
  const { item } = data;
  if (!semantic) return <Detail data={data} dragging={dragging} />;
  if (item.kind === "group") return <Detail data={data} dragging={dragging} />;
  const small = item.kind === "card" || item.kind === "aside" || item.kind === "margin" || item.look?.font === "small";
  const tuckedTop = item.kind === "point" ? (item.lines?.length ?? 1) * (item.look?.line ?? G.pointLine) + (item.chips ? G.chips : 0) : 0;
  return <div className={cls("spine-semantic-item", small && "spine-semantic-small")} style={roomStyle(item.room)}>
    <div className="spine-semantic-detail"><Detail data={data} dragging={dragging} /></div>
    {data.overview?.map(({ thread, title, count }, index) => <button key={thread} type="button" style={{ top: `calc(${tuckedTop}px + ${index * 96}px * var(--spine-k, 1))` }} className={cls("spine-semantic-summary", "nodrag", "nopan", item.kind === "point" && "spine-semantic-small", data.here && "spine-semantic-here")}
      data-thread={thread} data-semantic-order={tuckedTop + index * 96} aria-label={`${title}, ${count} ${count === 1 ? "thought" : "thoughts"}. Zoom in to read`}
      onClick={() => acts.read(item)}>
      <span className="spine-semantic-title">{title}</span>
      <span className="spine-semantic-count">{count} {count === 1 ? "thought" : "thoughts"}</span>
    </button>)}
  </div>;
});
