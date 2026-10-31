import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useCore, type Thread, type Thought, type World } from "./core";
import { startMic } from "./mic";

const spring = { type: "spring", stiffness: 380, damping: 34 } as const;

export default function App() {
  const core = useCore();
  const { world } = core;
  const [stopMic, setStopMic] = useState<(() => void) | null>(null);
  const [draft, setDraft] = useState("");

  // The camera follows the conversation; threads themselves never move.
  useEffect(() => {
    if (world.active) {
      document.getElementById(`thread-${world.active}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [world.active]);

  const toggleMic = async () => {
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
    } catch {
      core.listen(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft.trim()) core.sendText(draft.trim());
    setDraft("");
  };

  const roots = world.threads.filter((t) => !t.parent_id);
  const pending = world.thoughts.filter((t) => !t.placed);

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
    ? world.thoughts.filter((t) => t.placed && t.thread_id === pullBack.id).at(-1)?.text ?? ""
    : "";

  const goBack = (thread: Thread) => {
    core.focus(thread.id);
    setDismissed((d) => [...d, dropKey(thread)]);
    document.getElementById(`thread-${thread.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="app">
      <header>
        <div className="brand">
          E2A2O <small>threads</small>
        </div>
        <div className="status">
          <span className={core.connected ? "dot ok" : "dot"} />
          {!core.connected ? "Connecting" : core.listening ? "Listening" : "Ready"}
        </div>
      </header>

      <AnimatePresence>
        {core.notice && (
          <motion.div
            className="notice"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            onClick={core.clearNotice}
          >
            {core.notice}
          </motion.div>
        )}
      </AnimatePresence>

      <main className="map">
        {roots.length === 0 && pending.length === 0 ? (
          <div className="empty">
            <h1>Think out loud.</h1>
            <p>Talk or type. Every thought finds its thread, and nothing you start gets lost.</p>
          </div>
        ) : (
          roots.map((t) => <ThreadCard key={t.id} thread={t} world={world} />)
        )}
      </main>

      <div className="dock">
        <div className="dock-inner">
          <AnimatePresence>
            {pullBack && (
              <motion.div
                key={dropKey(pullBack)}
                className="pullback"
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8 }}
                transition={spring}
              >
                <div>
                  <div className="pullback-title">
                    You dropped <b>{pullBack.title}</b> mid-thought
                  </div>
                  <div className="pullback-quote">“{lastWords}…”</div>
                </div>
                <div className="pullback-actions">
                  <button onClick={() => goBack(pullBack)}>Go back</button>
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
              <motion.span key={t.id} layoutId={t.id} transition={spring} className="pill">
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
            >
              <MicIcon />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function ThreadCard({ thread, world }: { thread: Thread; world: World }) {
  const thoughts = useMemo(
    () => world.thoughts.filter((t) => t.placed && t.thread_id === thread.id),
    [world.thoughts, thread.id],
  );
  const branches = world.threads.filter((t) => t.parent_id === thread.id);
  const active = world.active === thread.id;
  const classes = ["thread", active ? "active" : "", thread.status === "dropped" ? "dropped" : ""].join(" ");

  return (
    <motion.section
      layout="position"
      id={`thread-${thread.id}`}
      className={classes}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
    >
      <div className="thread-head">
        <span className="title">{thread.title}</span>
        {thread.status === "dropped" && <span className="chip dropped">dropped</span>}
        {active && <span className="chip now">now</span>}
      </div>
      <ul className="points">
        {thoughts.map((t) => (
          <Point key={t.id} thought={t} />
        ))}
      </ul>
      {branches.length > 0 && (
        <div className="branches">
          {branches.map((b) => (
            <ThreadCard key={b.id} thread={b} world={world} />
          ))}
        </div>
      )}
    </motion.section>
  );
}

function Point({ thought }: { thought: Thought }) {
  return (
    <motion.li layoutId={thought.id} transition={spring} title={thought.text}>
      <span>{thought.point}</span>
      {thought.unclear && (
        <span className="unclear" title={`Did I hear this right? ${thought.unclear}`}>
          ?
        </span>
      )}
      {thought.place_ms != null && <span className="speed">{(thought.place_ms / 1000).toFixed(1)} s</span>}
    </motion.li>
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
