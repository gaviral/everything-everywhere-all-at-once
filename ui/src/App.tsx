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
import { Apps } from "./Apps";
import { Recap } from "./Recap";

const spring = { type: "spring", stiffness: 220, damping: 28 } as const;

export default function App() {
  const core = useCore();
  const reducedMotion = useReducedMotion();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { world } = core;
  const [stopMic, setStopMic] = useState<(() => void) | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [recentFirst, setRecentFirst] = useState(false);
  const [startingMic, setStartingMic] = useState(false);
  const [firstHint, setFirstHint] = useState(false);
  const startedEmpty = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const dockRef = useRef<HTMLElement>(null);
  const mapRef = useRef<HTMLElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const seenThoughts = useRef<Set<string> | null>(null);
  const seenSnapshot = useRef(0);
  useEffect(() => {
    const placed = world.thoughts.filter((thought) => thought.placed);
    if (!core.snapshotRevision) return;
    if (seenThoughts.current && seenSnapshot.current === core.snapshotRevision) {
      const added = placed.filter((thought) => !seenThoughts.current!.has(thought.id));
      if (added.length) {
        const thought = added[added.length - 1];
        const title = world.threads.find((thread) => thread.id === thought.thread_id)?.title;
        setAnnouncement(`${thought.point}${title ? ` — ${title}` : ""}`);
      }
    }
    seenThoughts.current = new Set(placed.map((thought) => thought.id));
    seenSnapshot.current = core.snapshotRevision;
  }, [world.thoughts, world.threads, core.snapshotRevision]);

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

  // Keep the end of the map reachable even when pending thoughts or the card grow.
  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    const update = () => document.documentElement.style.setProperty("--dock-height", `${dock.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(dock);
    return () => { observer.disconnect(); document.documentElement.style.removeProperty("--dock-height"); };
  }, []);

  useEffect(() => {
    if (!core.notice || /MODEL_API_KEY|mic|microphone/i.test(core.notice)) return;
    const timer = window.setTimeout(core.clearNotice, 5000);
    return () => window.clearTimeout(timer);
  }, [core.notice, core.clearNotice]);

  // Stop local audio when the service reports a stop or the connection drops.
  const voiceStartedAt = useRef(0);
  useEffect(() => {
    if (stopMic && !core.listening && core.voiceStatusRevision > voiceStartedAt.current) {
      stopMic();
      setStopMic(null);
    }
  }, [core.listening, core.voiceStatusRevision, stopMic]);

  useEffect(() => {
    if (stopMic && core.notice.includes("MODEL_API_KEY")) {
      stopMic();
      setStopMic(null);
    }
  }, [core.notice, stopMic]);

  const toggleMic = async () => {
    if (!world.threads.length && !world.thoughts.length) startedEmpty.current = true;
    if (stopMic) {
      stopMic();
      setStopMic(null);
      core.listen(false);
      return;
    }
    setStartingMic(true);
    try {
      const stop = await startMic(core.sendAudio);
      voiceStartedAt.current = core.voiceStatusRevision;
      setStopMic(() => stop);
      if (!core.listen(true)) {
        stop();
        setStopMic(null);
        core.showNotice("Connection lost. Reconnect to use the microphone; you can still type below.");
      }
    } catch (err) {
      core.listen(false);
      const denied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "PermissionDeniedError");
      core.showNotice(denied ? "Microphone access is off. Allow it in your browser settings, or type below." : `Couldn't start the mic. ${err instanceof Error ? err.message : "Try again."} You can type below.`);
    } finally {
      setStartingMic(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft.trim()) {
      if (!world.threads.length && !world.thoughts.length) startedEmpty.current = true;
      if (core.sendText(draft.trim())) setDraft("");
    }
  };

  const pending = world.thoughts.filter((t) => !t.placed);
  const activePath = useMemo(() => {
    const path = new Set<string>();
    const byId = new Map(world.threads.map((thread) => [thread.id, thread]));
    let current = world.active ? byId.get(world.active) : undefined;
    while (current && !path.has(current.id)) {
      path.add(current.id);
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    return path;
  }, [world.threads, world.active]);

  useEffect(() => {
    const ids = new Set(world.threads.map((thread) => thread.id));
    setExpanded((state) => {
      if (Object.keys(state).every((id) => ids.has(id))) return state;
      return Object.fromEntries(Object.entries(state).filter(([id]) => ids.has(id)));
    });
  }, [world.threads]);

  // Position the initial snapshot once; later activity must not interrupt reading.
  const positionedInitial = useRef(false);
  useEffect(() => {
    if (positionedInitial.current || !core.snapshotRevision || !world.active) return;
    const target = document.getElementById(`thread-${world.active}`);
    if (!target) return;
    positionedInitial.current = true;
    requestAnimationFrame(() => target.scrollIntoView({ behavior: "instant", block: "start" }));
  }, [core.snapshotRevision, world.active, world.threads]);

  useEffect(() => {
    if (!world.active) return;
    setExpanded((state) => {
      const next = { ...state };
      let thread = world.threads.find((item) => item.id === world.active);
      const visited = new Set<string>();
      while (thread && !visited.has(thread.id)) {
        visited.add(thread.id);
        delete next[thread.id];
        thread = world.threads.find((item) => item.id === thread?.parent_id);
      }
      return next;
    });
  }, [world.active]);

  const threadById = useMemo(() => new Map(world.threads.map((thread) => [thread.id, thread])), [world.threads]);
  const thoughtsByThread = useMemo(() => {
    const grouped = new Map<string, Thought[]>();
    for (const thought of world.thoughts) if (thought.placed && thought.thread_id) {
      const group = grouped.get(thought.thread_id) ?? [];
      group.push(thought);
      grouped.set(thought.thread_id, group);
    }
    return grouped;
  }, [world.thoughts]);
  const search = query.trim().toLocaleLowerCase();
  const matches = new Set(world.threads.filter((thread) => search && [thread.title, ...(thread.tags ?? []).map((tag) => tag.name), ...(thoughtsByThread.get(thread.id) ?? []).flatMap((thought) => [thought.text, thought.point])].some((text) => text.toLocaleLowerCase().includes(search))).map((thread) => thread.id));
  const visibleIds = new Set<string>();
  const addWithParents = (id: string) => {
    let thread = threadById.get(id);
    while (thread && !visibleIds.has(thread.id)) {
      visibleIds.add(thread.id);
      thread = thread.parent_id ? threadById.get(thread.parent_id) : undefined;
    }
  };
  if (search) matches.forEach(addWithParents);
  else if (focusMode && world.active && threadById.has(world.active)) {
    addWithParents(world.active);
    world.threads.filter((thread) => thread.parent_id === world.active).forEach((thread) => visibleIds.add(thread.id));
  } else world.threads.forEach((thread) => visibleIds.add(thread.id));
  const children = new Map<string | null, Thread[]>();
  for (const thread of world.threads) {
    if (!visibleIds.has(thread.id)) continue;
    const parent = thread.parent_id && threadById.has(thread.parent_id) ? thread.parent_id : null;
    const group = children.get(parent) ?? [];
    group.push(thread);
    children.set(parent, group);
  }
  if (recentFirst) children.forEach((group) => group.sort((a, b) => b.touched_ms - a.touched_ms));
  const roots = children.get(null) ?? [];

  const jumpToActive = () => {
    setQuery("");
    setFocusMode(false);
    if (world.active) requestAnimationFrame(() => {
      document.getElementById(`thread-${world.active}`)?.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "start" });
    });
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      const target = event.target as HTMLElement;
      if (event.metaKey || event.ctrlKey || event.altKey || target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === "/") { event.preventDefault(); searchRef.current?.focus(); }
      if ((event.key === "j" || event.key === "k") && !event.repeat) {
        const buttons = Array.from(mapRef.current?.querySelectorAll<HTMLButtonElement>(".thread-toggle:not(:disabled)") ?? []);
        if (!buttons.length) return;
        event.preventDefault();
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = index < 0 ? 0 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === "j" ? 1 : -1)));
        buttons[next].focus();
        buttons[next].scrollIntoView({ block: "nearest" });
      }
      if (event.key === "Escape") {
        setExpanded(Object.fromEntries(world.threads.filter((thread) => !activePath.has(thread.id)).map((thread) => [thread.id, true])));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [world.threads, activePath]);

  const previousPlaced = useRef<number | null>(null);
  useEffect(() => {
    const count = world.thoughts.filter((thought) => thought.placed).length;
    if (startedEmpty.current && previousPlaced.current === 0 && count === 1 && world.threads.length === 1) setFirstHint(true);
    if (count > 1 || world.threads.length > 1 || core.partial) setFirstHint(false);
    previousPlaced.current = count;
  }, [world.thoughts, world.threads.length, core.partial]);
  useEffect(() => {
    if (!firstHint) return;
    const timer = window.setTimeout(() => setFirstHint(false), 10000);
    return () => window.clearTimeout(timer);
  }, [firstHint]);

  const [mapChangeVisible, setMapChangeVisible] = useState(false);
  useEffect(() => {
    if (!core.mapChange) return;
    setMapChangeVisible(true);
    const timer = window.setTimeout(() => setMapChangeVisible(false), 10000);
    return () => window.clearTimeout(timer);
  }, [core.mapChange]);

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
    setQuery("");
    setFocusMode(false);
    core.focus(thread.id);
    setDismissed((d) => [...d, dropKey(thread)]);
    requestAnimationFrame(() => document.getElementById(`thread-${thread.id}`)?.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "start" }));
  };

  return (
    <MotionConfig reducedMotion="user">
    <div className="app">
      <header>
        <div className="brand">
          E2A2O <small>threads</small>
        </div>
        <div className="header-actions">
        <button className="recap-button" onClick={(event) => { event.currentTarget.focus(); core.requestRecap("today"); }}><span aria-hidden="true">✦</span> Recap</button>
        <div className="status">
          <span className={core.connected ? "dot ok" : "dot"} />
          {!core.connected ? "Connecting…" : core.listening ? "Listening" : "Ready"}
        </div>
        </div>
      </header>

      <AnimatePresence>
        {core.notice && (
          <motion.div
            className="notice" role="status"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <span>{core.notice.includes("MODEL_API_KEY") ? "Set MODEL_API_KEY in .env to turn on listening and placement. See .env.example." : core.notice}</span>
            <button onClick={core.clearNotice} aria-label="Dismiss notice">×</button>
          </motion.div>
        )}
      </AnimatePresence>

      {core.mapChange && mapChangeVisible && (
        <div className="map-change" role="status"><span aria-hidden="true">✦</span> {core.mapChange.text}<button onClick={() => setMapChangeVisible(false)} aria-label="Dismiss map update">×</button></div>
      )}

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

      <Apps core={core} />
      {world.threads.length > 0 && <nav className="map-tools" aria-label="Map navigation">
        <div className="map-tools-inner">
          <label className="search"><span className="sr-only">Search threads</span><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setQuery(""); event.currentTarget.blur(); } }} placeholder="Search threads" type="search" /></label>
          <button aria-pressed={focusMode} onClick={() => { setFocusMode((value) => !value); setQuery(""); }} disabled={!world.active}>{focusMode ? "Show all" : "Focus"}</button>
          <button aria-pressed={recentFirst} onClick={() => setRecentFirst((value) => !value)}>{recentFirst ? "Recent first" : "Map order"}</button>
          {world.active && <button className="back-to-active" onClick={jumpToActive}>Back to active</button>}
          <details className="shortcuts"><summary aria-label="Keyboard shortcuts">?</summary><div className="keyboard-hint"><div>✦ added or suggested by AI</div><div>/ search · j / k move · Enter show or hide · Esc fold quiet threads</div></div></details>
        </div>
        {search && <div className="search-summary" role="status">{matches.size} {matches.size === 1 ? "thread" : "threads"} found <button onClick={() => setQuery("")}>Clear</button></div>}
      </nav>}
      <main ref={mapRef} className="map" aria-label="Thread map">
        {world.threads.length === 0 ? (
          <div className="empty">
            <h1>Think out loud.</h1>
            <p>{startingMic ? "Starting the microphone…" : core.listening ? "Listening. Say what's on your mind." : pending.length ? "Finding a place for your thought…" : "Start with whatever is on your mind."}</p>
            {!core.listening && !pending.length && <p className="empty-hint">Tap the mic to talk, or type below and press Enter.</p>}
          </div>
        ) : (
          roots.length === 0 ? <p className="no-results">No threads match. Try another search.</p> : roots.map((t) => (
            <ThreadCard
              key={t.id}
              thread={t}
              world={world}
              activePath={activePath}
              childrenByParent={children}
              thoughtsByThread={thoughtsByThread}
              matches={matches}
              searching={!!search}
              expanded={expanded}
              setExpanded={setExpanded}
              on={{ setItem: core.setItem, approve: core.approve, tag: core.tag, correct: core.correct }}
            />
          ))
        )}
      </main>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
      <section ref={dockRef} className="dock" aria-label="Your thoughts">
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
          {core.queuedCount > 0 && <div className="first-hint" role="status">{core.queuedCount} {core.queuedCount === 1 ? "thought" : "thoughts"} waiting to send when connected.</div>}
          {firstHint && !core.partial && <div className="first-hint">Your thought found a thread. Keep going, or try another topic.</div>}
          {(core.partial || core.listening || startingMic) && <div className="live">{core.partial || (startingMic ? "Starting the microphone…" : "Listening…")}</div>}
          <div className="pending">
            {pending.map((t) => (
              <motion.span key={t.id} layoutId={reducedMotion ? undefined : t.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={spring} className="pill">
                <span className="pending-label">Finding a thread</span> {t.text}
              </motion.span>
            ))}
          </div>
          <form className="composer" onSubmit={submit}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={core.listening ? "Listening… or type" : core.connected ? "Type a thought, or tap the mic" : "Type a thought — it will send when connected"}
              aria-label="Type a thought"
            />
            <button
              type="button"
              className={stopMic ? "mic on" : "mic"}
              onClick={toggleMic}
              disabled={startingMic || (!core.connected && !stopMic)}
              aria-label={stopMic ? "Stop listening" : "Start listening"}
              aria-pressed={!!stopMic}
            >
              <MicIcon />
            </button>
          </form>
        </div>
      </section>
      <Recap view={core.recap.view} world={world} connected={core.connected} onRequest={core.requestRecap} onClose={core.recap.close} onFocus={(id) => {
        const thread = world.threads.find((t) => t.id === id);
        if (thread) goBack(thread);
        requestAnimationFrame(() => {
          const target = document.getElementById(`thread-${id}`)?.querySelector<HTMLButtonElement>(".thread-toggle");
          target?.focus({ preventScroll: true });
        });
      }} />
    </div>
    </MotionConfig>
  );
}

function ThreadCard({ thread, world, on, activePath, childrenByParent, thoughtsByThread, matches, searching, expanded, setExpanded, depth = 2 }: {
  thread: Thread; world: World; on: Handlers; activePath: Set<string>;
  childrenByParent: Map<string | null, Thread[]>; thoughtsByThread: Map<string, Thought[]>; matches: Set<string>; searching: boolean;
  expanded: Record<string, boolean>; setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>; depth?: number;
}) {
  const reducedMotion = useReducedMotion();
  const thoughts = thoughtsByThread.get(thread.id) ?? [];
  const ideas = world.suggestions.filter((s) => s.thread_id === thread.id && s.status !== "dismissed");
  const actions = world.actions.filter((a) => a.thread_id === thread.id && a.status !== "dismissed");
  const branches = childrenByParent.get(thread.id) ?? [];
  const active = world.active === thread.id;
  const collapsed = searching && matches.has(thread.id) ? false : expanded[thread.id] ?? !activePath.has(thread.id);
  const classes = ["thread", active ? "active" : "", collapsed ? "collapsed" : "", thread.status === "dropped" ? "dropped" : ""].join(" ");

  return (
    <motion.section
      layout={reducedMotion ? false : true}
      id={`thread-${thread.id}`}
      aria-labelledby={`title-${thread.id}`}
      className={classes}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
    >
      <div className="thread-head">
        {thread.picture && <span className="picture-wrap"><img className="picture" src={thread.picture} alt="" /><span className="picture-mark" role="img" aria-label="AI-generated picture">✦</span></span>}
        <div className="head-text">
          <div className="head-line">
            <div className="title" id={`title-${thread.id}`} role="heading" aria-level={Math.min(depth, 6)}>{thread.title}</div>
            {thread.status === "dropped" && <span className="chip dropped">left off</span>}
            {active && <span className="chip now">active</span>}
            <span className="thread-count">{thoughts.length} {thoughts.length === 1 ? "thought" : "thoughts"}</span>
          </div>
          {!collapsed && (thread.tags ?? []).length > 0 && (
            <div className="tags">
              {thread.tags.map((t) => (
                <button
                  key={t.name}
                  className={t.kept ? "tag kept" : "tag"}
                  aria-label={`${t.kept ? "Kept tag" : "AI-suggested tag"}: ${t.name}`}
                  aria-pressed={t.kept}
                  title={t.kept ? "Remove tag" : "Keep this tag"}
                  onClick={() => on.tag(thread.id, t.name, !t.kept)}
                >
                  {!t.kept && <span aria-hidden="true">✦ </span>}{t.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="collapse thread-toggle" aria-expanded={!collapsed} onClick={() => setExpanded((state) => ({ ...state, [thread.id]: !collapsed }))} disabled={searching && matches.has(thread.id)}>{collapsed ? "Show" : "Hide"} <span className="sr-only">{thread.title}</span></button>
      </div>
      <AnimatePresence initial={false}>
      {!collapsed && <motion.div key="body" initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.15 }}>
      <ul className="points">
        {thoughts.map((t) => (
          <Point key={t.id} thought={t} on={on} />
        ))}
      </ul>
      {ideas.map((s) => (
        <motion.div key={s.id} layout className={`ai ${s.status}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <span className="ai-mark" role="img" aria-label="AI suggestion">✦</span>
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
      </motion.div>}
      </AnimatePresence>
      {branches.length > 0 && (
        <div className="branches">
          {branches.map((b) => (
            <ThreadCard key={b.id} thread={b} world={world} on={on} activePath={activePath} childrenByParent={childrenByParent} thoughtsByThread={thoughtsByThread} matches={matches} searching={searching} expanded={expanded} setExpanded={setExpanded} depth={depth + 1} />
          ))}
        </div>
      )}
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
      {/* Every point is a short version of the person's own words, so it stays unmarked: ✦ is for what the AI adds or proposes. */}
      <span>{thought.point}</span>
      {thought.unclear && thought.guess ? (
        <span className="did-you-mean">
          <span className="ai-mark" role="img" aria-label="AI suggestion">✦</span> Did you mean “{thought.guess}”?
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
      <span className="action-icon" role="img" aria-label={action.status === "done" ? "Added" : "AI-proposed action"}>{action.status === "done" ? "✓" : "✦"}</span>
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
