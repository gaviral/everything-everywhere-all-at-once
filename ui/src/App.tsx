import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";
import { useCore, type Action, type ItemStatus, type Thread, type Thought, type World } from "./core";

type Handlers = {
  setItem: (id: string, status: ItemStatus) => void;
  approve: (id: string) => void;
  tag: (threadId: string, tag: string, keep: boolean) => void;
  correct: (thoughtId: string, accept: boolean) => void;
};
import { startMic } from "./mic";

const spring = { type: "spring", stiffness: 220, damping: 28 } as const;

export default function App() {
  const core = useCore();
  const reducedMotion = useReducedMotion();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { world } = core;
  const [stopMic, setStopMic] = useState<(() => void) | null>(null);
  const [draft, setDraft] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const seenThoughts = useRef<Set<string> | null>(null);
  useEffect(() => {
    const placed = world.thoughts.filter((thought) => thought.placed);
    if (seenThoughts.current) {
      const added = placed.filter((thought) => !seenThoughts.current!.has(thought.id));
      if (added.length) {
        const thought = added[added.length - 1];
        const title = world.threads.find((thread) => thread.id === thought.thread_id)?.title;
        setAnnouncement(`${thought.point}${title ? ` — ${title}` : ""}`);
      }
    }
    seenThoughts.current = new Set(placed.map((thought) => thought.id));
  }, [world.thoughts, world.threads]);

  // Coming back to the window is a good moment to tidy the map.
  const { visible } = core;
  useEffect(() => {
    const back = () => {
      if (document.visibilityState === "visible") visible();
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
  }, [visible]);

  // Notices fade on their own.
  useEffect(() => {
    if (!core.notice) return;
    const timer = window.setTimeout(core.clearNotice, 3500);
    return () => window.clearTimeout(timer);
  }, [core.notice, core.clearNotice]);

  // The camera follows the conversation; threads themselves never move.
  useEffect(() => {
    if (world.active) {
      document.getElementById(`thread-${world.active}`)?.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "nearest" });
    }
  }, [world.active, reducedMotion]);

  // True once the voice service confirms it's listening; if it then stops (an error, a dropped
  // connection), the mic turns off too instead of pulsing at nothing.
  const heard = useRef(false);
  useEffect(() => {
    if (core.listening) heard.current = true;
    else if (heard.current && stopMic) {
      heard.current = false;
      stopMic();
      setStopMic(null);
    }
  }, [core.listening]);

  const toggleMic = async () => {
    heard.current = false;
    if (stopMic) {
      stopMic();
      setStopMic(null);
      core.listen(false);
      return;
    }
    try {
      core.listen(true);
      const stop = await startMic(core.sendAudio);
      setStopMic(() => stop);
    } catch (err) {
      core.listen(false);
      core.showNotice(`Couldn't start the mic: ${err instanceof Error ? err.message : "no access"}`);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft.trim()) core.sendText(draft.trim());
    setDraft("");
  };

  const roots = world.threads.filter((t) => !t.parent_id);
  const pending = world.thoughts.filter((t) => !t.placed);
  const activePath = new Set<string>();
  let current = world.threads.find((t) => t.id === world.active);
  while (current && !activePath.has(current.id)) {
    activePath.add(current.id);
    current = world.threads.find((t) => t.id === current?.parent_id);
  }

  // Pull-back: at a natural pause, offer the most recently dropped thread.
  const [lastActivity, setLastActivity] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => setLastActivity(Date.now()), [core.partial, world.thoughts.length]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 400);
    return () => window.clearInterval(timer);
  }, []);
  const dropKey = (t: Thread) => `${t.id}:${t.touched_ms}`;
  const dropped = world.threads
    .filter((t) => t.status === "dropped" && !dismissed.includes(dropKey(t)))
    .sort((a, b) => b.touched_ms - a.touched_ms)[0];
  const pullBack = dropped && now - lastActivity > 2500 ? dropped : null;
  const lastWords = pullBack
    ? world.thoughts.filter((t) => t.placed && t.thread_id === pullBack.id && t.speaker === "you").at(-1)?.text ?? ""
    : "";

  // Select a word or phrase on the map to get it explained in its context.
  const [selection, setSelection] = useState<{
    id: string;
    text: string;
    context: string;
    x: number;
    y: number;
    asked: boolean;
  } | null>(null);
  useEffect(() => {
    const onUp = () => {
      const picked = window.getSelection();
      const text = picked?.toString().trim() ?? "";
      if (!picked || !text || text.length > 80 || picked.rangeCount === 0) return;
      const range = picked.getRangeAt(0);
      const node = range.commonAncestorContainer;
      const element = node instanceof Element ? node : node.parentElement;
      if (!element?.closest(".map")) return;
      const rect = range.getBoundingClientRect();
      const context =
        element.closest("li")?.getAttribute("title") || element.closest(".thread")?.textContent || text;
      setSelection({ id: crypto.randomUUID(), text, context, x: rect.left + rect.width / 2, y: rect.top, asked: false });
    };
    const onDown = (event: MouseEvent) => {
      if (!(event.target as Element).closest(".explain")) setSelection(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelection(null);
      else if (event.key.startsWith("Arrow") && event.shiftKey) onUp();
    };
    document.addEventListener("keyup", onKey);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keyup", onKey);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("mousedown", onDown);
    };
  }, []);

  const goBack = (thread: Thread) => {
    core.focus(thread.id);
    setDismissed((d) => [...d, dropKey(thread)]);
    document.getElementById(`thread-${thread.id}`)?.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "center" });
  };

  return (
    <MotionConfig reducedMotion="user">
    <div className="app">
      <header>
        <div className="brand">
          E2A2O <small>threads</small>
        </div>
        <div className="status">
          <span className={core.connected ? "dot ok" : "dot"} />
          {!core.connected ? "Connecting…" : core.listening ? "Listening" : "Ready"}
        </div>
      </header>

      <AnimatePresence>
        {core.notice && (
          <motion.div
            className="notice" role="status"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            onClick={core.clearNotice}
          >
            {core.notice}
          </motion.div>
        )}
      </AnimatePresence>

      {selection && (
        <div className="explain" style={{ left: selection.x, top: selection.y }}>
          {selection.asked ? (
            <div className="explain-text">{core.explanations[selection.id] ?? "…"}</div>
          ) : (
            <button
              onClick={() => {
                core.explain(selection.id, selection.text, selection.context);
                setSelection({ ...selection, asked: true });
              }}
            >
              Explain “{selection.text.length > 24 ? `${selection.text.slice(0, 24)}…` : selection.text}”
            </button>
          )}
        </div>
      )}

      <main className="map" aria-label="Thread map">
        {roots.length === 0 && pending.length === 0 ? (
          <div className="empty">
            <h1>Think out loud.</h1>
            <p>Speak or type a thought to start your map.</p>
            <p className="empty-hint">Use the mic below, or type and press Enter.</p>
          </div>
        ) : (
          roots.map((t) => (
            <ThreadCard
              key={t.id}
              thread={t}
              world={world}
              activePath={activePath}
              expanded={expanded}
              setExpanded={setExpanded}
              on={{ setItem: core.setItem, approve: core.approve, tag: core.tag, correct: core.correct }}
            />
          ))
        )}
      </main>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
      <section className="dock" aria-label="Your thoughts">
        <div className="dock-inner">
          <AnimatePresence>
            {pullBack && (
              <motion.div
                key={dropKey(pullBack)}
                className="pullback" role="status"
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8 }}
                transition={spring}
              >
                {pullBack.picture && <img className="picture" src={pullBack.picture} alt="" />}
                <div className="pullback-text">
                  <div className="pullback-title">
                    You didn't finish <b>{pullBack.title}</b>
                  </div>
                  {lastWords && <div className="pullback-quote">“{lastWords}”</div>}
                </div>
                <div className="pullback-actions">
                  <button onClick={() => goBack(pullBack)}>Finish it</button>
                  <button className="quiet" onClick={() => setDismissed((d) => [...d, dropKey(pullBack)])}>
                    Later
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="live">{core.partial}</div>
          <div className="pending">
            {pending.map((t) => (
              <motion.span key={t.id} layoutId={reducedMotion ? undefined : t.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={spring} className="pill">
                {t.text}
              </motion.span>
            ))}
          </div>
          <form className="composer" onSubmit={submit}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={core.listening ? "Listening… or type" : "Type a thought, or tap the mic"}
              aria-label="Type a thought"
            />
            <button
              type="button"
              className={stopMic ? "mic on" : "mic"}
              onClick={toggleMic}
              aria-label={stopMic ? "Stop listening" : "Start listening"}
              aria-pressed={!!stopMic}
            >
              <MicIcon />
            </button>
          </form>
        </div>
      </section>
    </div>
    </MotionConfig>
  );
}

function ThreadCard({ thread, world, on, activePath, expanded, setExpanded, depth = 2 }: {
  thread: Thread; world: World; on: Handlers; activePath: Set<string>;
  expanded: Record<string, boolean>; setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>; depth?: number;
}) {
  const reducedMotion = useReducedMotion();
  const thoughts = useMemo(
    () => world.thoughts.filter((t) => t.placed && t.thread_id === thread.id),
    [world.thoughts, thread.id],
  );
  const ideas = world.suggestions.filter((s) => s.thread_id === thread.id && s.status !== "dismissed");
  const actions = world.actions.filter((a) => a.thread_id === thread.id && a.status !== "dismissed");
  const branches = world.threads.filter((t) => t.parent_id === thread.id);
  const active = world.active === thread.id;
  const collapsed = !activePath.has(thread.id) && (expanded[thread.id] === false || (expanded[thread.id] === undefined && world.threads.length >= 60));
  const classes = ["thread", active ? "active" : "", thread.status === "dropped" ? "dropped" : ""].join(" ");

  return (
    <motion.section
      layout={reducedMotion ? false : true}
      id={`thread-${thread.id}`}
      className={classes}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
    >
      <div className="thread-head">
        {thread.picture && <img className="picture" src={thread.picture} alt="" />}
        <div className="head-text">
          <div className="head-line">
            <div className="title" role="heading" aria-level={Math.min(depth, 6)}>{thread.title}</div>
            {thread.status === "dropped" && <span className="chip dropped">left off</span>}
            {active && <span className="chip now">active</span>}
          </div>
          {(thread.tags ?? []).length > 0 && (
            <div className="tags">
              {thread.tags.map((t) => (
                <button
                  key={t.name}
                  className={t.kept ? "tag kept" : "tag"}
                  aria-pressed={t.kept}
                  title={t.kept ? "Remove tag" : "Keep this tag"}
                  onClick={() => on.tag(thread.id, t.name, !t.kept)}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </div>
        {!activePath.has(thread.id) && <button className="collapse" aria-expanded={!collapsed} onClick={() => setExpanded((state) => ({ ...state, [thread.id]: collapsed }))}>{collapsed ? "Show" : "Hide"} <span className="sr-only">{thread.title}</span></button>}
      </div>
      {!collapsed && <>
      <ul className="points">
        {thoughts.map((t) => (
          <Point key={t.id} thought={t} on={on} />
        ))}
      </ul>
      {ideas.map((s) => (
        <motion.div key={s.id} layout className={`ai ${s.status}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <span className="ai-mark">✦</span>
          <span>{s.text}</span>
          {s.status === "new" && (
            <span className="ai-actions">
              <button aria-label={`Keep suggestion: ${s.text}`} onClick={() => on.setItem(s.id, "kept")}>Keep</button>
              <button className="quiet" onClick={() => on.setItem(s.id, "dismissed")} aria-label={`Dismiss suggestion: ${s.text}`}>
                ×
              </button>
            </span>
          )}
        </motion.div>
      ))}
      {actions.map((a) => (
        <ActionRow key={a.id} action={a} on={on} />
      ))}
      {branches.length > 0 && (
        <div className="branches">
          {branches.map((b) => (
            <ThreadCard key={b.id} thread={b} world={world} on={on} activePath={activePath} expanded={expanded} setExpanded={setExpanded} depth={depth + 1} />
          ))}
        </div>
      )}
      </>}
    </motion.section>
  );
}

function Point({ thought, on }: { thought: Thought; on: Handlers }) {
  // Your own thoughts need no name; anyone else's (a person in the room, or Claude) shows who said it.
  const other = thought.speaker !== "you";
  const reducedMotion = useReducedMotion();
  return (
    <motion.li layout={reducedMotion ? false : true} layoutId={reducedMotion ? undefined : thought.id} transition={spring} title={thought.text} className={other ? "other" : undefined}>
      {other && <span className="speaker">{thought.speaker}</span>}
      <span>{thought.point}</span>
      {thought.unclear && thought.guess ? (
        <span className="did-you-mean">
          Did you mean “{thought.guess}”?
          <button onClick={() => on.correct(thought.id, true)}>Yes</button>
          <button className="quiet" onClick={() => on.correct(thought.id, false)} aria-label={`No, keep “${thought.unclear}”`}>
            No
          </button>
        </span>
      ) : (
        thought.unclear && (
          <span className="unclear" title={`Might be misheard: ${thought.unclear}`} role="img" aria-label={`Might be misheard: ${thought.unclear}`}>
            ?
          </span>
        )
      )}
      {thought.place_ms != null && <span className="speed">{(thought.place_ms / 1000).toFixed(1)} s</span>}
    </motion.li>
  );
}

function ActionRow({ action, on }: { action: Action; on: Handlers }) {
  // Matches the core: an event without a date goes to Reminders.
  const app = action.kind === "event" && action.when ? "Calendar" : "Reminders";
  const when = action.when
    ? new Date(`${action.when}T09:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    : "";
  return (
    <motion.div layout className={`action ${action.status}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <span className="action-icon">{action.status === "done" ? "✓" : action.kind === "event" ? "◷" : "○"}</span>
      <span>
        {action.title}
        {when && <span className="when"> · {when}</span>}
      </span>
      {action.status === "new" && (
        <span className="ai-actions">
          <button aria-label={`Add ${action.title} to ${app}`} onClick={() => on.approve(action.id)}>Add to {app}</button>
          <button className="quiet" onClick={() => on.setItem(action.id, "dismissed")} aria-label={`Dismiss ${action.title}`}>
            ×
          </button>
        </span>
      )}
      {action.status === "done" && action.done_ms != null && (
        <span className="when ai-actions">
          in {app} · {(action.done_ms / 1000).toFixed(1)} s
        </span>
      )}
    </motion.div>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}
