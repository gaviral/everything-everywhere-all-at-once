// The playground (bricks.html, docs/bricks.md): one brick on its own against a sample map from samples/, so a builder
// needs neither the core, a key nor the whole app. `?brick=<id>` picks the brick (the template too) and `&sample=`
// the map ("empty" for none). It's mounted as the app mounts it (BrickSlot.tsx), and what it asks for is answered
// here as the app would and logged: a thought added lands on the thread you're on a moment later, placed by a model
// as the core's route says, and a margin note comes back as the core's changes would. What the brick hears is listed
// too. `window.brickActions` is the shown brick's own actions, to try one from the console (scripts/bricks-check.mjs does).
import { StrictMode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { noteChanges } from "../annotate-core";
import { received } from "../apps-audio";
import { BrickMount, useBrickHost } from "../BrickSlot";
import { discover, type BrickModule } from "../bricks-core";
import { apply, type Thought, type World } from "../core";
import { receiveRoute, type RouteMsg } from "../route";
import { roomColors } from "../rooms";
import { moveChange, renameChange } from "../topics-core";
import { receiveJob, type JobMsg } from "../work-jobs";
import type { BrickActions, BrickEvents } from "./contract";
import "../styles.css";
import "./playground.css";

// Every brick, the template too, and every sample map's journal.
const found = discover(
  import.meta.glob("./*/brick.json", { eager: true, import: "default" }),
  import.meta.glob<BrickModule>("./*/index.tsx"),
);
const SAMPLES: Record<string, string> = Object.fromEntries(Object.entries(import.meta.glob<string>("../../../samples/*.jsonl", { eager: true, query: "?raw", import: "default" }))
  .map(([path, journal]) => [path.split("/").at(-1)!.replace(/\.jsonl$/, ""), journal]));

// "Helper jobs": a simulated helper's work as the core relays it (work-jobs.ts), each step at its offset in ms: a job runs
// with a side job under it, one ends, one asks, one fails.
const JOBS: [number, string, JobMsg["status"], string, { result?: string; parent?: string }][] = [
  [0, "plan", "running", "Plan Mom's birthday on Saturday", {}],
  [600, "class", "running", "Find the pottery class on Main Street", { parent: "plan" }],
  [2600, "class", "done", "Find the pottery class on Main Street", { parent: "plan", result: "Saturdays at 10 AM · $45 a person · 2 seats left" }],
  [3400, "card", "waiting", "Draft a birthday card for Mom", { parent: "plan", result: "Mention the pottery class in Mom's card, or keep it a surprise?" }],
  [4200, "seats", "failed", "Book two pottery seats", { result: "The booking site needs your sign-in, so it's left for you" }],
];

// The Volume watcher, as the core seeds it, so the Level meter has its line to draw.
const VOLUME_APP: World["apps"][number] = { id: "app-volume", name: "Volume watcher", purpose: "Offer a quiet pause when voices stay loud for a few seconds.",
  watcher: { kind: "volume", level: 0.087, seconds: 3 }, prompt: null, publishers: [{ kind: "card", text: "Voices have been loud for a little while." }],
  enabled: true, request: "", cooldown_secs: 60, created_ms: 0, last_run_ms: 0 };
const EMPTY: World = { recaps: [], threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [], merged: {}, proposals: [], notes: {}, apps: [VOLUME_APP], apps_seeded: true };

/** A sample map, replayed through the window's own reducer (core.ts `apply`), as the core plays it into an empty map. */
function sampleWorld(name: string): World {
  let world = EMPTY;
  for (const line of (SAMPLES[name] ?? "").split("\n")) if (line.trim()) world = apply(world, JSON.parse(line));
  return world;
}

// What "Add a thought" says: lines a person might, each landing on the thread you're on.
const LINES = ["Ask Priya about the slides before Friday", "Maybe the bus is faster than biking in the rain", "Write down the three numbers for the budget"];
// "Say a thought": a word heard every 250 ms (talk at about 150 words a minute, as the transcriber sends its drafts),
// and the turn's end 600 ms after the last (the pause the transcriber waits for before it calls a turn done).
const WORD_MS = 250;
const TURN_END_MS = 600;
// The model a placement names (placer.rs `MODELS`' first), and how long after the change its route comes, as the core
// sends it right after (a landing waits for it, BrickSlot.tsx).
const MODEL = "muse-spark-1.3";
const ROUTE_AFTER_MS = 40;
// The loudness readings of the Level meter's own test (its help line): normal talk, a pause, a raised voice, a pause,
// a shout; at the voices apps.rs gives (0.075, 0.1, a shout above 0.15), a reading every 320 ms, pauses of two seconds.
const PAUSE = Array(7).fill(0.01);
const VOICES = [...Array(10).fill(0.075), ...PAUSE, ...Array(10).fill(0.1), ...PAUSE, ...Array(8).fill(0.2), ...PAUSE];

function Playground() {
  const params = new URLSearchParams(location.search);
  const [id, setId] = useState(params.get("brick") ?? found.bricks[0]?.info.id ?? "");
  const [sample, setSample] = useState(params.get("sample") ?? (SAMPLES["student-week"] ? "student-week" : "empty"));
  const [world, setWorld] = useState(() => sampleWorld(sample));
  // Bumped with each map picked, as the core's snapshot count is: a new map's thoughts aren't landings.
  const [revision, setRevision] = useState(1);
  const [connected, setConnected] = useState(true);
  // Your words as they're heard (`map.partial`), while "Say a thought" talks.
  const [partial, setPartial] = useState("");
  const talk = useRef<number[]>([]);
  const [log, setLog] = useState<string[]>([]);
  // What the brick heard (`on`), newest first.
  const [heard, setHeard] = useState<{ n: number; name: string; value: string }[]>([]);
  const heardCount = useRef(0);
  const jobRuns = useRef(0);
  const [notice, setNotice] = useState("");
  const [errors, setErrors] = useState(0);
  const brick = found.bricks.find((b) => b.info.id === id);
  const said = (line: string) => setLog((was) => [line, ...was].slice(0, 40));
  const title = (thread: string | null) => world.threads.find((t) => t.id === thread)?.title ?? thread ?? "none";
  const count = useRef(0);
  const placedLog = useRef(0);

  // The address keeps what's picked, so a reload (Vite's, after an edit) comes back to it.
  useEffect(() => {
    const next = new URLSearchParams({ brick: id, sample });
    history.replaceState(null, "", `?${next}`);
  }, [id, sample]);
  useEffect(() => { setWorld(sampleWorld(sample)); setRevision((n) => n + 1); }, [sample]);
  // An error the brick throws outside a render (an effect, a click) is counted and logged; one in a render shows its
  // own "stopped working" line (BrickSlot.tsx). scripts/bricks-check.mjs reads the count.
  useEffect(() => {
    const caught = (event: ErrorEvent | PromiseRejectionEvent) => {
      setErrors((n) => n + 1);
      said(`Error: ${"message" in event ? event.message : String(event.reason)}`);
    };
    window.addEventListener("error", caught);
    window.addEventListener("unhandledrejection", caught);
    return () => { window.removeEventListener("error", caught); window.removeEventListener("unhandledrejection", caught); };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  /** A thought on its way, then placed on the thread you're on (else a new one) 1.2 s later, as the placer would, its
   *  route naming the model just after (`speaker`: someone else's, the Friend's). */
  const add = (text: string, speaker = "you") => {
    const words = text.trim();
    if (!words || words.length > 2000) { showNotice("That thought is empty or too long."); return false; }
    // Said now, so the newest on the map, even on a sample whose times run ahead of this clock.
    const newest = world.thoughts.reduce((at, t) => Math.max(at, t.at_ms + 1), Date.now());
    const thought: Thought = { id: `pg-${++count.current}`, speaker, text: words, point: words, thread_id: null, placed: false, unclear: "",
      complete: true, at_ms: newest, place_ms: null };
    setWorld((w) => apply(w, { type: "thought_added", thought }));
    const route = (msg: RouteMsg) => receiveRoute(msg);
    route({ type: "route", route: { stage: "weighing", thought_id: thought.id, candidates: [], lanes: 1 } });
    window.setTimeout(() => window.setTimeout(() => route({ type: "route", route: { stage: "decided", thought_id: thought.id, path: [], new: false, skipped: false,
      pick: { action: "continue", thread_id: "" }, rule: null, why: "", lane: 0, lanes: 1, ms: 1200, model: MODEL } }), ROUTE_AFTER_MS), 1200);
    window.setTimeout(() => setWorld((w) => {
      let thread = w.active_by.you ?? w.active;
      if (!thread || !w.threads.some((t) => t.id === thread)) {
        thread = `PG${count.current}`;
        w = apply(w, { type: "thread_added", thread: { id: thread, title: words.split(" ").slice(0, 3).join(" "), parent_id: null, status: "open", last_point: "", touched_ms: Date.now(), tags: [], picture: null, dropped_by: "" } });
      }
      w = apply(w, { type: "thought_placed", thought_id: thought.id, thread_id: thread, point: words, unclear: "", complete: true, place_ms: 1200 });
      return apply(w, { type: "thread_touched", thread_id: thread, last_point: words, at_ms: Date.now() });
    }), 1200);
    return true;
  };
  const latestAdd = useRef(add);
  useLayoutEffect(() => { latestAdd.current = add; });

  /** A thought said aloud, as the core passes it on: its words as heard, one more at a time (`map.partial`), then at
   *  the turn's end no words and the thought itself, which lands as one added does. */
  const say = (text: string) => {
    for (const timer of talk.current) window.clearTimeout(timer);
    const words = text.split(" ");
    talk.current = words.map((_, i) => window.setTimeout(() => setPartial(words.slice(0, i + 1).join(" ")), i * WORD_MS));
    talk.current.push(window.setTimeout(() => { setPartial(""); latestAdd.current(text); }, (words.length - 1) * WORD_MS + TURN_END_MS));
  };

  // A margin note, answered with the changes the core would send (annotate.rs), by you.
  const annotate = (thoughtId: string, quote: string, text: string) => {
    const changes = noteChanges(world, "you", thoughtId, quote, text, Date.now(), { thread: () => `PGN${++count.current}`, thought: () => `pg-${++count.current}` });
    if (!changes) { said(`annotate ${thoughtId} “${quote}” → refused: no words, or that point isn't on a thread`); return false; }
    setWorld((w) => changes.reduce<World>((at, change) => apply(at, change as Parameters<typeof apply>[1]), w));
    said(`annotate ${thoughtId} “${quote}”: “${text}” → ${changes.length > 3 ? "a new note on those words" : "a reply in their note"}`);
    return true;
  };
  // The Friend (an AI participant) joins, once, and says one; it lands as yours do.
  const friend = () => {
    setWorld((w) => apply(w, { type: "ai_joined", speaker: "Friend" }));
    add("The deposit comes back after the walkthrough", "Friend");
  };
  // The guide's arrow at the first thread, and off again: as another participant's point is heard.
  const [pointed, setPointed] = useState(false);

  const rooms = useMemo(() => roomColors(world.threads), [world.threads]);
  const host = useBrickHost(world, revision, "you", connected, rooms, partial, {
    addThought: (text) => { const ok = add(text); said(`addThought “${text}”${ok ? " → lands on the thread you're on in 1.2 s" : " → refused"}`); return ok; },
    openThread: (thread) => {
      said(`openThread ${title(thread)} → in the app: back to the Map, that thread open and highlighted`);
      setWorld((w) => apply(w, { type: "active_changed", thread_id: thread, speaker: "you" }));
    },
    select: (thread) => said(`select ${title(thread)} → in the app: “this” for what's said next`),
    notify: (text) => { said(`notify “${text}”`); showNotice(text); },
    // Placed as the core places it: the change comes back through the window's own reducer, with `by` you. A drag's
    // steps are logged once, at its last.
    position: (id, x, y) => {
      setWorld((w) => apply(w, { type: "positioned", id, x, y, by: "you", at_ms: Date.now() }));
      window.clearTimeout(placedLog.current);
      placedLog.current = window.setTimeout(() => said(x === null || y === null ? `position ${id} → back to the layout` : `position ${id} → placed at ${Math.round(x)}, ${Math.round(y)}`), 250);
    },
    listen: (on) => said(`listen ${on === undefined ? "(switch)" : on ? "on" : "off"} → in the app: as a tap on the mic`),
    annotate,
    openCatalog: (id) => said(`openCatalog${id ? ` ${id}` : ""} → in the app: the Catalog opens${id ? " at that brick's row" : ""}`),
    // A topic renamed or a thread moved under one, as the core answers it (topics.rs): the change comes back through the
    // window's own reducer.
    renameTopic: (from, to) => {
      const change = renameChange(world, from, to);
      said(`renameTopic “${from}” → “${to}” → ${change ? `renamed “${change.type === "topic_renamed" ? change.to : to}”` : "refused: no such theme, no name, or the same"}`);
      if (change) setWorld((w) => apply(w, change));
      return !!change;
    },
    moveToTopic: (threadId, topic) => {
      const change = moveChange(world, threadId, topic);
      said(`moveToTopic ${title(threadId)} → “${topic}” → ${change ? `moved ${change.type === "topic_set" ? title(change.thread_id) : ""} there` : "refused: no such thread, no name, or it's there already"}`);
      if (change) setWorld((w) => apply(w, change));
      return !!change;
    },
    hint: (text, target, by) => {
      const ok = !!text.trim() && !/[\r\n]/.test(text.trim()) && [...text.trim()].length <= 140 && (target === null || /^[A-Za-z0-9:._-]{1,100}$/.test(target));
      said(`hint “${text}”${target ? ` at ${target}` : ""} → ${ok ? `in the app: ${target ? "an arrow at it" : "a corner caption"}, from ${by}` : "refused: not one line of 140 characters, or not a name"}`);
      if (ok) showNotice(`${by}: ${text.trim()}`);
      return ok;
    },
  });
  // What the brick hears, listed as it passes.
  useEffect(() => {
    const names: (keyof BrickEvents)[] = ["landed", "words", "notice", "pointing", "asked", "speaking"];
    const stops = names.map((name) => host.on(name, (value) => setHeard((was) => [{ n: ++heardCount.current, name, value: JSON.stringify(value) }, ...was].slice(0, 8))));
    return () => stops.forEach((stop) => stop());
  }, [host.on]);
  // The shown brick's own actions, for the console and the check.
  useEffect(() => {
    const info = brick?.info;
    (window as unknown as { brickActions?: BrickActions }).brickActions = info ? host.actionsFor(info) : undefined;
  }, [brick, host]);
  // Said in the notice lane and heard by the brick, as the app does: the same words again are another notice.
  const showNotice = (text: string) => {
    setNotice(text);
    if (text) host.emit("notice", { text, kind: "notice", time: Date.now() });
  };
  const hum = () => VOICES.forEach((level, i) => window.setTimeout(() => received(level), i * 320));
  // Each press is a new run, so its jobs are new ones: what the core would relay, simulated, as it's stamped.
  const playJobs = () => {
    const run = ++jobRuns.current;
    for (const [at, id, status, title, more] of JOBS) {
      window.setTimeout(() => {
        const message: JobMsg = { type: "job", id: `run${run}-${id}`, title, status, demo: true, by: "Helper", at_ms: Date.now(), result: more.result, parent: more.parent && `run${run}-${more.parent}` };
        receiveJob(message);
      }, at);
    }
  };

  return <div className="playground" data-errors={errors} data-brick-shown={brick ? id : ""}>
    <div className="playground-bar" role="toolbar" aria-label="Playground">
      <strong>Bricks playground</strong>
      <label>Brick <select value={id} onChange={(event) => setId(event.target.value)}>
        {!brick && <option value={id}>{id || "none"}</option>}
        {found.bricks.map(({ info }) => <option key={info.id} value={info.id}>{info.name} ({info.id})</option>)}
      </select></label>
      <label>Map <select value={sample} onChange={(event) => setSample(event.target.value)}>
        {Object.keys(SAMPLES).map((name) => <option key={name} value={name}>{name}</option>)}
        <option value="empty">empty</option>
      </select></label>
      <button type="button" onClick={() => add(LINES[count.current % LINES.length])}>Add a thought</button>
      <button type="button" onClick={() => say(LINES[count.current % LINES.length])}>Say a thought</button>
      <button type="button" onClick={hum}>Talk, then shout</button>
      <button type="button" onClick={() => showNotice("A notice to come back to.")}>Show a notice</button>
      <button type="button" onClick={friend}>The Friend says one</button>
      <button type="button" onClick={playJobs}>Helper jobs</button>
      <button type="button" onClick={() => {
        const thread = world.threads[0];
        host.emit("pointing", pointed || !thread ? null : { target: `thread:${thread.id}`, by: "Friend", threadId: thread.id });
        setPointed(!pointed && !!thread);
      }}>{pointed ? "Stop pointing" : "Point at a thread"}</button>
      <button type="button" onClick={() => host.emit("asked", { what: "notices" })}>Ask what just happened</button>
      <button type="button" onClick={() => {
        host.emit("speaking", { speaker: "Maya", on: true, mine: false });
        window.setTimeout(() => host.emit("speaking", { speaker: "Maya", on: false, mine: false }), 1500);
      }}>Someone speaks</button>
      <label className="playground-check"><input type="checkbox" checked={!connected} onChange={(event) => setConnected(!event.target.checked)} /> Core away</label>
    </div>
    {brick ? <p className="playground-about"><strong>{brick.info.name}</strong> · {brick.info.kind} · {brick.info.does} · {brick.info.defaultOn ? "on" : "off"} by default · {brick.info.demoSafe ? "demo-safe" : "not for the demo"}</p>
      : <p className="playground-about playground-wrong">{found.problems[id] ? `“${id}” can't load: ${found.problems[id].join("; ")}.` : `No brick “${id}” here. Pick one above.`}</p>}
    <div className={`playground-stage playground-${brick?.info.kind ?? "none"}`}>
      {brick?.info.kind === "card" ? <div className="playground-dock"><BrickMount key={id} brick={brick} host={host} /></div>
        : brick && <BrickMount key={id} brick={brick} host={host} />}
      {(brick?.info.kind === "panel" || brick?.info.kind === "input") && <p className="playground-hint">A {brick.info.kind} places itself on the page: look at its edges.</p>}
    </div>
    <aside className="playground-log" aria-label="What the brick asked for">
      <strong>What it asked for</strong>
      {log.length ? <ol>{log.map((line, i) => <li key={log.length - i}>{line}</li>)}</ol> : <p>Nothing yet. Its actions show here.</p>}
      <p className="playground-map">Map: {world.threads.length} threads · {world.thoughts.filter((t) => t.placed).length} placed · {Object.keys(world.anchors ?? {}).length} notes · on {title(world.active_by.you ?? world.active)}{world.ai?.length ? ` · AI: ${world.ai.join(", ")}` : ""}</p>
      <strong>What it heard</strong>
      {heard.length ? <ol className="playground-heard">{heard.map((event) => <li key={event.n} data-event={event.name}>{event.name}: {event.value}</li>)}</ol> : <p>Nothing yet. Its events show here.</p>}
    </aside>
    {notice && <div className="playground-notice" role="status">{notice}</div>}
  </div>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Playground /></StrictMode>);
