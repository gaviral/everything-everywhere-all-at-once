// The shell's regions (docs/bricks.md "Slots"), each marked with its data-slot name so a feature, the guide or a check
// finds it wherever the layout puts it:
//  - top left: the wordmark, the map's name and its one stamp; top right: Find, Catalog, the people in a call
//  - status: the line flush at the bottom that names every state once (the mic and its time, live words, what waits)
//  - rail: the panel at the right, one tab at a time (Talk, History, Catalog, Settings), closed when you're alone
//  - held: questions waiting for your pause, above the shelf at the bottom right
// The stage (bottom center: composer, captions, one notice) is App.tsx's, which holds what it shows.
import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { BrickKind } from "../bricks/contract";
import type { MicState } from "../MicButton";
import type { Thread, Thought } from "../core";
import { canUndo, type Entry } from "./history";
import { dropHeld, useHeld } from "./held";
import { FEATURE_NAMES, KIND_NAMES, NAMES } from "./names";
import { shown } from "../talk/call-core";
import { Icon, Keycap, mod, modAria, Stamp, type Mode } from "./parts";

const cls = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

// ── Top left ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The wordmark, the map's name and its one stamp. */
export function TopLeft({ mapName, mode, wordmark }: { mapName: string; mode: Mode | null; wordmark: boolean }) {
  return <div className="shell-corner shell-tl" data-slot="top-left">
    <div className="shell-pill shell-identity">
      {wordmark && <><span className="shell-wordmark">{NAMES.wordmark}</span><span className="shell-sep" aria-hidden="true" /></>}
      <span className="shell-mapname">{mapName}</span>
      <Stamp mode={mode} />
    </div>
  </div>;
}

// ── Top right: Find, Catalog, people ─────────────────────────────────────────────────────────────────────────────────

/** Find: its field is the pill, so "/" goes straight to typing; the topics that match list under it, best first. Enter
 *  or a click goes to one (the view moves there); Esc clears it and lets go. */
export function Find({ inputRef, query, setQuery, results, go }: {
  inputRef: React.RefObject<HTMLInputElement | null>; query: string; setQuery: (q: string) => void;
  results: { thread: Thread; points: number }[]; go: (thread: Thread) => void;
}) {
  const [at, setAt] = useState(0);
  const [focused, setFocused] = useState(false);
  useEffect(() => setAt(0), [query]);
  const shown = focused && query.trim().length > 0;
  const key = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setQuery(""); event.currentTarget.blur(); return; }
    if (!results.length) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setAt((i) => Math.min(results.length - 1, i + 1)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
    if (event.key === "Enter") { event.preventDefault(); const pick = results[at] ?? results[0]; if (pick) { go(pick.thread); setQuery(""); event.currentTarget.blur(); } }
  };
  return <div className={cls("shell-find", (focused || query) && "shell-find-open")} data-guide="search">
    <label className="shell-pill shell-find-field">
      <Icon name="find" />
      <span className="sr-only">{NAMES.find}</span>
      <input ref={inputRef} type="search" value={query} placeholder={focused ? NAMES.findPlaceholder : NAMES.find} aria-keyshortcuts="/"
        onChange={(event) => setQuery(event.target.value)} onKeyDown={key} onFocus={() => setFocused(true)} onBlur={() => window.setTimeout(() => setFocused(false), 120)}
        role="combobox" aria-expanded={shown} aria-controls="shell-find-results" aria-autocomplete="list" />
      {!focused && !query && <Keycap>/</Keycap>}
      {focused && <Keycap>esc</Keycap>}
    </label>
    {shown && <div id="shell-find-results" className="shell-find-results" role="listbox" aria-label="Topics found">
      {results.length ? results.map(({ thread, points }, i) => <button key={thread.id} type="button" role="option" aria-selected={i === at} className="shell-find-row"
        aria-keyshortcuts={i === at ? "Enter" : undefined} onPointerDown={(event) => event.preventDefault()} onClick={() => { go(thread); setQuery(""); inputRef.current?.blur(); }}>
        <span className="shell-find-title">{thread.title}</span>
        <span className="shell-find-meta">{points} {points === 1 ? "point" : "points"}</span>
        {i === at && <Keycap>↵</Keycap>}
      </button>) : <p className="shell-find-none">{NAMES.findNone}</p>}
    </div>}
  </div>;
}

export function TopRight({ children }: { children: ReactNode }) {
  return <div className="shell-corner shell-tr" data-slot="top-right">{children}</div>;
}

/** A corner's button: an icon, its name (gone on a phone, where the icon stays), its key. */
export function CornerButton({ icon, label, keyName, keyAria, pressed, onClick, guide, controls }: {
  icon: Parameters<typeof Icon>[0]["name"]; label: string; keyName: string; keyAria: string; pressed?: boolean; onClick: () => void; guide?: string; controls?: string;
}) {
  return <button type="button" className={cls("shell-pill", "shell-button", pressed && "shell-on")} aria-pressed={pressed} aria-keyshortcuts={keyAria}
    aria-controls={controls} onClick={onClick} data-guide={guide} title={`${label} (${keyName})`}>
    <Icon name={icon} /><span className="shell-label">{label}</span><Keycap>{keyName}</Keycap>
  </button>;
}

// ── The status line ──────────────────────────────────────────────────────────────────────────────────────────────────

export type StatusState = {
  mic: MicState;
  /** Listening is switched off in the Catalog: typing only. */
  typingOnly: boolean;
  hosted: boolean;
  /** When the mic started (ms), while it runs. */
  since: number | null;
  now: number;
  /** In a call: the mic is "on" for the room (lane L5 says who's here). */
  call: boolean;
  /** First open: nothing said yet, so the line says how to start. */
  first: boolean;
  /** Your thoughts on their way, and the first one's trouble, if any (pendingLabel's words). */
  waiting: number;
  stalled: string;
  /** Typed while away from the core: they go once it's back. */
  queued: number;
  connected: boolean;
};

/** "2:14": minutes and seconds since `since`. */
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** The mic's state in the line's words, and its dot. Each state is named here once, and nowhere else on screen. */
export function micWords(s: StatusState): { dot: "on" | "off" | "wait" | "warn"; text: string } {
  if (s.typingOnly && s.mic !== "listening" && s.mic !== "hearing") return { dot: "off", text: "Typing only" };
  switch (s.mic) {
    case "offline": return { dot: "wait", text: "Connecting…" };
    case "starting": return { dot: "wait", text: "Starting the mic…" };
    case "listening":
    case "hearing": return { dot: "on", text: `${s.call ? "Mic on" : "Listening"}${s.since ? ` ${clock(s.now - s.since)}` : ""}` };
    case "paused": return { dot: "off", text: "Paused" };
    case "nokey": return { dot: "warn", text: s.hosted ? "Listening unavailable" : "No AI key" };
    case "refused": return { dot: "warn", text: s.hosted ? "Service error" : "AI key refused" };
    case "resting": return { dot: "warn", text: "Free tries back tomorrow" };
    case "blocked": return { dot: "warn", text: "Mic blocked" };
    default: return { dot: "off", text: "Mic off" };
  }
}

const DOTS = { on: "shell-dot shell-dot-on", off: "shell-dot shell-dot-off", wait: "shell-dot shell-dot-wait", warn: "shell-dot shell-dot-warn" } as const;

/** What follows the state, when there's one thing to know: what a state that needs something needs, how to start on a
 *  first open. */
function micHint(s: StatusState): string {
  if (s.typingOnly) return "";
  const help = NAMES.stateHelp;
  if (s.mic === "nokey") return s.hosted ? help.nokeyHosted : help.nokey;
  if (s.mic === "refused") return s.hosted ? help.refusedHosted : help.refused;
  if (s.mic === "resting") return help.resting;
  if (s.mic === "blocked") return help.blocked;
  if (s.first && (s.mic === "off" || s.mic === "paused")) return `Nothing is heard until you tap the mic or press ${mod("D")}.`;
  return "";
}

/** The status line: 24 px, flush at the very bottom. Live words (Tiny transcript, lane L3) take its middle: anything a
 *  feature puts in `[data-slot="status"]` lands between the state and what waits (shell.css). */
export const StatusLine = memo(function StatusLine({ state, openHistory }: { state: StatusState; openHistory: () => void }) {
  const mic = micWords(state);
  const hint = micHint(state);
  const waiting = state.stalled ? state.stalled : state.waiting ? `${state.waiting} waiting` : "";
  // Said once per change of state, never per tick of its clock or per word heard.
  const said = mic.text.replace(/ \d+:\d\d$/, "");
  return <div className="shell-status" data-slot="status" data-guide="status">
    <span className="sr-only" role="status">{said}</span>
    <span className="shell-status-state">
      <i className={DOTS[mic.dot]} aria-hidden="true" />
      <span className="shell-status-word">{mic.text}</span>
      {hint && <><span className="shell-status-sep" aria-hidden="true" /><span className="shell-status-hint">{hint}</span></>}
    </span>
    <button type="button" className="shell-status-right" onClick={openHistory} aria-keyshortcuts="Y" title="What happened: History (Y)">
      {[
        waiting && <span key="wait" className={cls("shell-status-wait", !!state.stalled && "shell-amber")}><i aria-hidden="true" />{waiting}</span>,
        state.queued > 0 && <span key="queued" className="shell-status-wait shell-amber"><i aria-hidden="true" />{state.queued} to send when connected</span>,
        state.connected && !state.queued && <span key="saved">Saved</span>,
      ].filter(Boolean).flatMap((item, i) => (i ? [<span key={`sep${i}`} className="shell-status-sep" aria-hidden="true" />, item] : [item]))}
    </button>
  </div>;
});

// ── The held stack ───────────────────────────────────────────────────────────────────────────────────────────────────

/** One held region: the next card first, the rest behind a count, or all behind a phone chip. */
export function HeldStack({ answerFallback, phone }: { answerFallback: () => void; phone: boolean }) {
  const held = useHeld();
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  useEffect(() => { if (!held.length) { setOpen(false); setAll(false); } }, [held.length]);
  const top = held[0];
  useEffect(() => {
    // Supplied cards own their state and removal. Handle their keys before the shell's default Later removes one.
    const key = (event: KeyboardEvent) => {
      if (top?.content == null || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.repeat || document.querySelector("dialog[open]")) return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key.toLowerCase() === "l") top.later?.();
      else if (event.key === "Enter" && !event.shiftKey && !(phone && !open) &&
        (!target || target === document.body || target === document.documentElement)) top.answer?.();
      else return; // A focused card button keeps its native Enter click, which answers just once.
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [top, phone, open]);
  if (!held.length) return null;
  const more = held.length - 1;
  if (phone && !open) return <div className="shell-held-chip-row" data-slot="held">
    <button type="button" className="shell-held-chip" onClick={() => setOpen(true)} aria-expanded={false} aria-keyshortcuts="L" title={NAMES.held.label}>
      {NAMES.held.label.split(" ")[0]} <span className="shell-count">{held.length}</span>
    </button>
  </div>;
  return <section className="shell-held guide-held" data-slot="held" aria-label={NAMES.held.label}
    style={{ maxHeight: "calc(100dvh - 180px)", overflowY: "auto", padding: 0, border: 0, background: "none", boxShadow: "none" }}>
    {(all ? held : held.slice(0, 1)).map((item) => {
      const answer = () => { dropHeld(item.id); (item.answer ?? answerFallback)(); };
      const later = () => { dropHeld(item.id); item.later?.(); };
      return <div key={item.id} data-held-id={item.id}>
        {item.content ?? <div className="shell-held" style={{ width: "100%" }}>
          <p className="shell-held-head"><span>{NAMES.held.label}{held.length > 1 ? ` · ${held.length}` : ""}</span><span className="shell-held-when">{NAMES.held.asks}</span></p>
          <p className="shell-held-q">{item.ai ? <span className="ai-mark shell-held-by" data-tip={NAMES.tips.friend}>✦ {shown(item.by)}</span> : <span className="shell-held-by">{shown(item.by)}</span>} <b>{item.main}</b>{item.rest ? ` ${item.rest}` : ""}</p>
          <div className="shell-held-acts" data-held-keys="">
            <button type="button" className="shell-btn" onClick={answer} aria-keyshortcuts="Enter">{NAMES.held.answer}<Keycap>↵</Keycap></button>
            <button type="button" className="shell-btn" onClick={later} aria-keyshortcuts="L">{NAMES.held.later}<Keycap>L</Keycap></button>
          </div>
        </div>}
      </div>;
    })}
    {more > 0 && <button type="button" className="guide-held-more" aria-expanded={all} onClick={() => setAll(!all)}>
      {all ? "Just the next" : <><b>{more}</b> more held</>}
    </button>}
    {phone && <button type="button" className="shell-held-chip" aria-expanded={open} onClick={() => setOpen(false)}>
      {NAMES.held.label.split(" ")[0]} <span className="shell-count">{held.length}</span>
    </button>}
  </section>;
}

// ── The rail ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type RailTab = "talk" | "history" | "catalog" | "settings";
export const RAIL_KEYS: Record<RailTab, string> = { talk: "T", history: "Y", catalog: "C", settings: "," };
const TAB_ICONS: Record<RailTab, Parameters<typeof Icon>[0]["name"]> = { talk: "talk", history: "history", catalog: "catalog", settings: "settings" };

export function Rail({ tab, setTab, close, tabs, children }: { tab: RailTab; setTab: (tab: RailTab) => void; close: () => void; tabs: RailTab[]; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  // Arrows move between the tabs, as a tab list's do.
  const arrows = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next = tabs[(tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    setTab(next);
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus());
  };
  return <aside ref={panel} className="shell-rail" data-slot="rail" aria-label={NAMES.tabs[tab]}>
    <div className="shell-tabs" role="tablist" aria-label="Panel" onKeyDown={arrows}>
      {tabs.map((t) => <button key={t} type="button" role="tab" data-tab={t} id={`shell-tab-${t}`} aria-selected={t === tab} aria-controls="shell-tabpanel"
        tabIndex={t === tab ? 0 : -1} aria-keyshortcuts={RAIL_KEYS[t]} className={cls("shell-tab", t === tab && "shell-on")} onClick={() => setTab(t)}>
        <Icon name={TAB_ICONS[t]} />{NAMES.tabs[t]}<Keycap>{RAIL_KEYS[t]}</Keycap>
      </button>)}
      <button type="button" className="shell-rail-close" onClick={close} aria-label={`${NAMES.close} the panel`} aria-keyshortcuts="Escape" title={NAMES.close}>
        <Icon name="close" /><Keycap>esc</Keycap>
      </button>
    </div>
    <div className="shell-tabpanel" id="shell-tabpanel" role="tabpanel" aria-labelledby={`shell-tab-${tab}`}>{children}</div>
  </aside>;
}

// ── History ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const ago = (time: number, now: number) => {
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} hr` : `${Math.floor(hours / 24)} d`;
};

export const HistoryTab = memo(function HistoryTab({ entries, undoId, now, recap, onUndo, onShow }: {
  entries: Entry[]; undoId: number | null; now: number; recap: (() => void) | null;
  onUndo: (entry: Entry) => void; onShow: (threadId: string) => void;
}) {
  return <div className="shell-history">
    {recap && <button type="button" className="shell-row-button" onClick={recap} aria-keyshortcuts="R">
      <Icon name="recap" /><span>{NAMES.recap} this session</span><Keycap>R</Keycap>
    </button>}
    {entries.length ? <ol className="shell-history-list">
      {entries.map((entry) => <li key={entry.n} className={cls("shell-history-entry", entry.kind === "error" && "shell-amber", entry.undone && "shell-undone")}>
        <p className="shell-history-text">{entry.ai && <span className="ai-mark" aria-label="by the AI" data-tip={NAMES.tips.ai}>✦ </span>}{entry.text}</p>
        <p className="shell-history-meta">
          <time dateTime={new Date(entry.at).toISOString()} title={new Date(entry.at).toLocaleTimeString()}>{ago(entry.at, now)}</time>
          {entry.detail && <><span aria-hidden="true">·</span><span>{entry.detail}</span></>}
          {entry.threadId && <button type="button" className="shell-link" onClick={() => onShow(entry.threadId!)} aria-keyshortcuts="Enter">Show</button>}
          {canUndo(entry, undoId) && <button type="button" className="shell-link" onClick={() => onUndo(entry)} aria-keyshortcuts={entry.undo?.kind === "turn" ? modAria("Z") : undefined}>
            {NAMES.history.undo}{entry.undo?.kind === "turn" && <Keycap>{mod("Z")}</Keycap>}</button>}
          {entry.undone && <span>{NAMES.history.undone}</span>}
        </p>
      </li>)}
    </ol> : <p className="shell-empty-line">{NAMES.history.empty}</p>}
  </div>;
});

// ── Catalog ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type CatalogRow = { id: string; kind: BrickKind | "app"; name: string; aka?: string; does: string; lives?: string; on: boolean; core: boolean;
  toggle?: (on: boolean) => void; disabled?: boolean; /** A view that's on: shows it. */ show?: () => void };

/** One short page: a row per feature, grouped by kind, each with its switch (the core's: on, built in). Arrows move
 *  between the switches; Space switches the one focused. */
export const CatalogTab = memo(function CatalogTab({ rows, at }: { rows: CatalogRow[]; at: string | null }) {
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!at) return;
    const row = list.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(at)}"]`);
    row?.scrollIntoView({ block: "nearest" });
    row?.querySelector<HTMLElement>("[role=switch]")?.focus({ preventScroll: true });
  }, [at]);
  const kinds: (BrickKind | "app")[] = ["view", "card", "panel", "input", "app"];
  const on = rows.filter((r) => r.on).length;
  const arrows = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const switches = [...(list.current?.querySelectorAll<HTMLElement>("[role=switch]:not(:disabled)") ?? [])];
    const i = switches.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    event.preventDefault();
    switches[Math.max(0, Math.min(switches.length - 1, i + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
  };
  return <div ref={list} className="shell-catalog" onKeyDown={arrows} data-key="↑ ↓ Space">
    <p className="shell-lead">{NAMES.catalogTab.lead(on, rows.length)}</p>
    {kinds.filter((kind) => rows.some((r) => r.kind === kind)).map((kind) => <section key={kind} className="shell-catalog-group" aria-label={KIND_NAMES[kind]}>
      <h3>{KIND_NAMES[kind]}</h3>
      <ul>{rows.filter((r) => r.kind === kind).map((row) => <li key={row.id} className={cls("shell-catalog-row", row.id === at && "shell-at")} data-row={row.id} title={row.does}>
        <span className="shell-catalog-name">{row.name}{row.aka && <span className="shell-aka">{row.aka}</span>}</span>
        {row.show ? <button type="button" className="shell-link" onClick={row.show} aria-keyshortcuts="Enter">{NAMES.show}</button>
          : row.lives && <span className="shell-catalog-lives">{row.lives}</span>}
        {row.core ? <span className="shell-catalog-core">{NAMES.catalogTab.core}</span>
          : <button type="button" role="switch" aria-checked={row.on} aria-label={row.name} aria-describedby={`does-${row.id}`} disabled={row.disabled}
            className={cls("shell-switch", row.on && "shell-on")} onClick={() => row.toggle?.(!row.on)}><i aria-hidden="true" /></button>}
        <span id={`does-${row.id}`} className="sr-only">{row.does}</span>
      </li>)}</ul>
    </section>)}
    <p className="shell-foot">{NAMES.catalogTab.missing}</p>
  </div>;
});

// ── Talk (lane L5 builds the call's; alone, your own turns) ──────────────────────────────────────────────────────────

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export const TalkTurns = memo(function TalkTurns({ thoughts, me, ai }: { thoughts: readonly Thought[]; me: string; ai: ReadonlySet<string> }) {
  const end = useRef<HTMLLIElement>(null);
  const turns = thoughts.filter((t) => t.text.trim()).slice(-60);
  useLayoutEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [turns.length]);
  if (!turns.length) return <p className="shell-empty-line">What's said shows here as turns, oldest first: yours, and in a call everyone's.</p>;
  return <ol className="shell-turns">
    {turns.map((t, i) => <li key={t.id} ref={i === turns.length - 1 ? end : undefined} className="shell-turn">
      <p className="shell-turn-who">{ai.has(t.speaker) ? <b className="ai-mark" data-tip={NAMES.tips.friend}>✦ {shown(t.speaker)}</b>
        : <b>{t.speaker === me || t.speaker === "you" ? "You" : t.speaker}</b>} <span>{time(t.at_ms)}</span></p>
      <p className="shell-turn-text">{t.text}</p>
    </li>)}
  </ol>;
});

// ── Settings: the index of what can be set, what you can say, and the keys ──────────────────────────────────────────

export function SettingsTab({ say, keys }: { say: ReactNode; keys: [string, string][] }) {
  return <div className="shell-settings">
    <h3>{NAMES.settings.keys}</h3>
    <dl className="shell-keys">{keys.map(([key, what]) => <div key={key + what}><dt><Keycap>{key}</Keycap></dt><dd>{what}</dd></div>)}</dl>
    <h3>{NAMES.settings.say}</h3>
    <div className="shell-say">{say}</div>
  </div>;
}

// ── First open: an empty map ─────────────────────────────────────────────────────────────────────────────────────────

export function Welcome({ models, sample }: { models: string; sample: ReactNode }) {
  return <section className="shell-welcome" aria-labelledby="shell-welcome-title">
    <h1 id="shell-welcome-title">Think out loud.<br />Keep your place.</h1>
    <p className="shell-welcome-how">Talk or type, in any order. Each thought lands on its own topic a few seconds after you stop. Lost your place? Say “where was I?”</p>
    {sample}
    {models && <p className="shell-welcome-models">{models}</p>}
  </section>;
}

export const FEATURE = (id: string, fallback: { name: string; does: string }) => {
  const named = FEATURE_NAMES[id];
  return { name: named?.name ?? fallback.name, aka: named?.aka, does: named?.does ?? fallback.does, lives: named?.lives };
};
