// The playground (bricks.html, docs/bricks.md): one brick on its own against a sample map from samples/, so a builder
// needs neither the core, a key nor the whole app. `?brick=<id>` picks the brick (the template too) and `&sample=`
// the map ("empty" for none). It's mounted as the app mounts it (BrickSlot.tsx), and what it asks for is answered
// here as the app would and logged: a thought added lands on the thread you're on a moment later.
import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { received } from "../apps-audio";
import { BrickMount, useBrickHost } from "../BrickSlot";
import { discover, type BrickModule } from "../bricks-core";
import { apply, type Thought, type World } from "../core";
import { roomColors } from "../rooms";
import "../styles.css";
import "./playground.css";

// Every brick, the template too, and every sample map's journal.
const found = discover(
  import.meta.glob("./*/brick.json", { eager: true, import: "default" }),
  import.meta.glob<BrickModule>("./*/index.tsx"),
);
const SAMPLES: Record<string, string> = Object.fromEntries(Object.entries(import.meta.glob<string>("../../../samples/*.jsonl", { eager: true, query: "?raw", import: "default" }))
  .map(([path, journal]) => [path.split("/").at(-1)!.replace(/\.jsonl$/, ""), journal]));

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
  const [log, setLog] = useState<string[]>([]);
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

  /** A thought on its way, then placed on the thread you're on (else a new one) 1.2 s later, as the placer would. */
  const add = (text: string) => {
    const words = text.trim();
    if (!words || words.length > 2000) { setNotice("That thought is empty or too long."); return false; }
    // Said now, so the newest on the map, even on a sample whose times run ahead of this clock.
    const newest = world.thoughts.reduce((at, t) => Math.max(at, t.at_ms + 1), Date.now());
    const thought: Thought = { id: `pg-${++count.current}`, speaker: "you", text: words, point: words, thread_id: null, placed: false, unclear: "",
      complete: true, at_ms: newest, place_ms: null };
    setWorld((w) => apply(w, { type: "thought_added", thought }));
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

  const rooms = useMemo(() => roomColors(world.threads), [world.threads]);
  const host = useBrickHost(world, revision, "you", connected, rooms, {
    addThought: (text) => { const ok = add(text); said(`addThought “${text}”${ok ? " → lands on the thread you're on in 1.2 s" : " → refused"}`); return ok; },
    openThread: (thread) => {
      said(`openThread ${title(thread)} → in the app: back to the Map, that thread open and highlighted`);
      setWorld((w) => apply(w, { type: "active_changed", thread_id: thread, speaker: "you" }));
    },
    select: (thread) => said(`select ${title(thread)} → in the app: “this” for what's said next`),
    notify: (text) => { said(`notify “${text}”`); setNotice(text); },
    // Placed as the core places it: the change comes back through the window's own reducer, with `by` you. A drag's
    // steps are logged once, at its last.
    position: (id, x, y) => {
      setWorld((w) => apply(w, { type: "positioned", id, x, y, by: "you", at_ms: Date.now() }));
      window.clearTimeout(placedLog.current);
      placedLog.current = window.setTimeout(() => said(x === null || y === null ? `position ${id} → back to the layout` : `position ${id} → placed at ${Math.round(x)}, ${Math.round(y)}`), 250);
    },
    listen: (on) => said(`listen ${on === undefined ? "(switch)" : on ? "on" : "off"} → in the app: as a tap on the mic`),
  });
  const hum = () => VOICES.forEach((level, i) => window.setTimeout(() => received(level), i * 320));

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
      <button type="button" onClick={hum}>Talk, then shout</button>
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
      <p className="playground-map">Map: {world.threads.length} threads · {world.thoughts.filter((t) => t.placed).length} placed · on {title(world.active_by.you ?? world.active)}</p>
    </aside>
    {notice && <div className="playground-notice" role="status">{notice}</div>}
  </div>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Playground /></StrictMode>);
