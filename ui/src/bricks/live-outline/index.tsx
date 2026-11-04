import { usePluginState } from "../contract";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useBrickEvent, type BrickProps } from "../contract";
import { layoutOutline, QUIET_MS, trimFillers, type OutlineActivity } from "./outline";
import pluginStyle0 from "./live-outline.css?inline";

export { layoutOutline, trimFillers } from "./outline";

const preview = (text: string) => {
  const characters = Array.from(text);
  return characters.length > 140 ? `${characters.slice(0, 140).join("")}…` : text;
};

export default function LiveOutline({ map, actions, on }: BrickProps) {
  // A visit begins here, never by replaying thoughts already on the map. Word markers let the pure layout distinguish
  // a long spoken turn from silence between landings. The whole stream goes when its talk does.
  const [activity, setActivity] = usePluginState<OutlineActivity[]>('live-outline/index.tsx:activity', () => {
    const at = Date.now();
    return [{ kind: "opened", at }, ...(map.partial.trim() ? [{ kind: "words" as const, at }] : [])];
  });
  const [now, setNow] = useState(activity[0].at);
  const lastActivity = useRef(now);
  const [quiet, setQuiet] = useState(false);
  const [held, setHeld] = useState(map.partial.trim());
  const [originalWords, setOriginalWords] = usePluginState('live-outline/index.tsx:originalWords', false);
  const [expanded, setExpanded] = usePluginState<ReadonlySet<string>>('live-outline/index.tsx:expanded', () => new Set());
  const helpId = useId();

  const record = (next: OutlineActivity) => {
    lastActivity.current = next.at;
    setQuiet(false);
    setNow(next.at);
    setActivity((was) => {
      const previous = was[was.length - 1];
      // Also covers a background tab whose quiet timer was suspended.
      return next.at - previous.at >= QUIET_MS
        ? [{ kind: "opened", at: previous.at + QUIET_MS }, next]
        : [...was, next];
    });
  };

  useBrickEvent(on, "words", (text) => {
    if (!text.trim()) return;
    setHeld(text);
    record({ kind: "words", at: Date.now() });
  });
  useBrickEvent(on, "landed", ({ thoughtId, threadId, mine }) => {
    if (!mine) return;
    record({ kind: "landed", thoughtId, threadId, at: Date.now() });
    // Keep the live line between the final words and their landing; an already-started next turn stays live.
    setHeld(map.partial.trim());
  });

  const latest = activity[activity.length - 1];
  useEffect(() => {
    if (latest.kind === "opened") return;
    const timer = window.setTimeout(() => {
      const time = Date.now();
      if (lastActivity.current !== latest.at || time - latest.at < QUIET_MS) return;
      setActivity([{ kind: "opened", at: latest.at + QUIET_MS }]);
      setNow(time);
      setQuiet(true);
      setHeld("");
      setExpanded(new Set());
    }, Math.max(0, latest.at + QUIET_MS - Date.now()));
    return () => window.clearTimeout(timer);
  }, [latest]);

  const threads = useMemo(() => map.threads.map((thread) => ({
    id: thread.id, title: thread.title, color: map.rooms.get(thread.id) ?? null,
  })), [map.threads, map.rooms]);
  const landings = useMemo(() => {
    const thoughts = new Map(map.thoughts.map((thought) => [thought.id, thought.text]));
    // A thought that has left the map (deleted) leaves the outline, and no longer counts toward its main line.
    return activity.flatMap((entry): OutlineActivity[] => {
      if (entry.kind !== "landed") return [entry];
      const text = thoughts.get(entry.thoughtId);
      return text === undefined ? [] : [{ ...entry, text }];
    });
  }, [activity, map.thoughts]);
  const rows = useMemo(() => layoutOutline(landings, threads, now), [landings, threads, now]);
  const bullets = rows.filter((row) => row.kind === "thought");

  // The newest point stays in view as points land, unless you've scrolled up to read, or are walking the points with the
  // keys (a click on a point leaves focus on it, but that's no reason to stop following).
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const newest = bullets.at(-1)?.thoughtId;
  useLayoutEffect(() => {
    const area = scroller.current, focused = document.activeElement;
    if (area && following.current && !(focused && area.contains(focused) && focused.matches(":focus-visible"))) area.scrollTop = area.scrollHeight;
  }, [newest, bullets.length, originalWords]);
  const live = quiet ? "" : map.partial.trim() || held;
  const liveText = preview(trimFillers(live).text);

  const toggle = (id: string) => setExpanded((was) => {
    const next = new Set(was);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return <section className="live-outline" aria-label="Live outline" data-guide="live-outline">
    <div className="live-outline-top">
      <h2 className="live-outline-title">Live outline</h2>
      <button type="button" className="live-outline-original" role="switch" aria-checked={originalWords}
        onClick={() => setOriginalWords((was) => !was)}>
        <span className="live-outline-switch" aria-hidden="true" />Original words
      </button>
    </div>
    <p id={helpId} className="live-outline-help">Click a point or press Enter to show its full original words; repeat to fold it.
      Double-click a point, or use its go button, to open its topic.</p>
    <div className="live-outline-scroll" ref={scroller} onScroll={(event) => {
      const area = event.currentTarget;
      following.current = area.scrollHeight - area.scrollTop - area.clientHeight < 32;
    }}>
      <ul className="live-outline-list" aria-label="Your talk">
        {rows.map((row) => {
          if (row.kind === "break") return <li key={row.key} className="live-outline-break">New talk</li>;
          const cleaned = trimFillers(row.text);
          const original = originalWords || expanded.has(row.thoughtId);
          const recent = bullets.slice(-5).some((bullet) => bullet.thoughtId === row.thoughtId);
          const style = {
            "--live-outline-level": row.level,
            ...(row.color ? {
              "--live-outline-room": `var(--room-${row.color})`,
              "--live-outline-soft": `var(--room-${row.color}-soft)`,
            } : {}),
          } as CSSProperties;
          return <li key={row.thoughtId} className="live-outline-bullet" style={style} tabIndex={0}
            aria-level={row.level + 1} aria-describedby={helpId} data-thread={row.threadId}
            data-level={row.level} data-recent={recent} data-expanded={original} data-side={row.level > 0}
            onClick={() => toggle(row.thoughtId)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
              event.preventDefault();
              event.stopPropagation();
              toggle(row.thoughtId);
            }}
            onDoubleClick={(event) => { event.stopPropagation(); actions.openThread(row.threadId); }}>
            <div className="live-outline-point">
              {row.chip && <span className="live-outline-chip" title={row.title}>{row.chip}</span>}
              <p className="live-outline-text">{original ? row.text : preview(cleaned.text)}</p>
              {!original && cleaned.trimmed && <span className="live-outline-trimmed">trimmed</span>}
            </div>
            <button type="button" className="live-outline-go" aria-label={`Open ${row.title}`} title="Open topic"
              onClick={(event) => { event.stopPropagation(); actions.openThread(row.threadId); }}
              onDoubleClick={(event) => event.stopPropagation()}>
              <svg className="live-outline-arrow" width="14" height="14" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M4 12 12 4M4 4h8v8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </li>;
        })}
      </ul>
      {!bullets.length && !live && <p className="live-outline-empty">Talk, and your points line up here. Side trips step in, in their topic's color.</p>}
    </div>
    {liveText && <p className="live-outline-live" aria-label="Your words in progress">{liveText}</p>}
  </section>;
}

/** Host attaches these styles only for this mount. */
export const styles = pluginStyle0;
