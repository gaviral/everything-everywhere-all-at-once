// Bubbles: every thread as a bubble in a place of its own, sized by its points, floating gently; a thought landing
// makes its bubble ripple. Concerns that stay apart look apart at a glance. A view brick (docs/bricks.md): once it's
// on in the Catalog, its name joins Map and Palace. A bubble opens its thread on the map, as a Palace picture does,
// and pointing at one makes it "this" (data-thread), so "rename this to …" works here too.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useBrickEvent, type BrickProps, type Thread } from "../contract";
import "./bubbles.css";

/** The spiral's step, in px at full size: the room each bubble has. A one-point bubble is 0.84 of it across (84 px),
 *  which holds its title in two lines at 12 px. */
const STEP = 100;
/** A bubble's radius in steps. Neighbours sit at least 1.8 steps apart, so two of the largest side by side still clear. */
const SMALLEST = 0.42;
const LARGEST = 0.88;
/** Points at which a bubble is full size. Its area grows with its points up to here: the sample maps' threads have 1 to
 *  6 points, so theirs differ at a glance, and a busier thread still has room to grow. */
const FULL = 8;
/** The sunflower's turn (137.5°): each new bubble takes the widest gap left, so none ever has to move for it. */
const TURN = Math.PI * (3 - Math.sqrt(5));
/** Room around the outermost bubbles for the float and the ripple, in steps. */
const EDGE = 0.2;

const spot = (slot: number) => ({ x: Math.sqrt(slot + 0.5) * Math.cos(slot * TURN), y: Math.sqrt(slot + 0.5) * Math.sin(slot * TURN) });
const radius = (points: number) => Math.max(SMALLEST, LARGEST * Math.sqrt(Math.min(points, FULL) / FULL));
/** A number from 0 to 1 that stays with a thread, so each floats at its own pace and the field never bobs in step. */
const hash = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 997, 7) / 997;
const topicStyle = (index: number) => ({
  "--room": `var(--bubbles-topic-${index % 6})`,
  "--room-soft": `var(--bubbles-topic-${index % 6}-soft)`,
}) as CSSProperties;

export default function Bubbles({ map, actions, on }: BrickProps) {
  // Each thread keeps the slot it first had while this view is open: a thread merged away leaves a gap, and nothing
  // else moves (the AI moves the camera, not the furniture).
  const slots = useRef(new Map<string, number>());
  for (const thread of map.threads) if (!slots.current.has(thread.id)) slots.current.set(thread.id, slots.current.size);
  const field = useMemo(() => {
    const used = map.threads.map((thread) => slots.current.get(thread.id)!);
    const spots = Array.from({ length: Math.max(0, ...used) + 1 }, (_, slot) => spot(slot));
    const reach = LARGEST + EDGE;
    const left = Math.min(...spots.map((s) => s.x)) - reach, right = Math.max(...spots.map((s) => s.x)) + reach;
    const top = Math.min(...spots.map((s) => s.y)) - reach, bottom = Math.max(...spots.map((s) => s.y)) + reach;
    return { left, top, width: right - left, height: bottom - top };
  }, [map.threads]);
  // The bubble a thought just landed on ripples once; a second landing there ripples again.
  const [ripples, setRipples] = useState<Record<string, number>>({});
  useBrickEvent(on, "landed", ({ threadId }) => setRipples((was) => ({ ...was, [threadId]: (was[threadId] ?? 0) + 1 })));
  const showTopics = map.topics.length >= 2;
  const [heldTopic, setHeldTopic] = useState<string | null>(null);
  const [hoveredTopic, setHoveredTopic] = useState<string | null>(null);
  const [focusedTopic, setFocusedTopic] = useState<string | null>(null);
  const topics = map.topics.map((topic, index) => ({
    name: topic.name, label: topic.name, style: topicStyle(index),
    count: map.threads.filter((thread) => thread.topic === topic.name).length,
  }));
  const unsorted = map.threads.filter((thread) => thread.topic === undefined).length;
  if (unsorted) topics.push({ name: "", label: "Not sorted yet", style: {}, count: unsorted });
  const highlightedTopic = showTopics
    ? [hoveredTopic, focusedTopic, heldTopic].find((name) => name !== null && topics.some((topic) => topic.name === name)) ?? null
    : null;
  useEffect(() => {
    if (!showTopics) return;
    const release = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setHeldTopic(null);
      setHoveredTopic(null);
      setFocusedTopic(null);
    };
    document.addEventListener("keydown", release);
    return () => document.removeEventListener("keydown", release);
  }, [showTopics]);

  if (!map.threads.length) return <p className="bubbles-empty">Nothing on the map yet. Say or type a thought, and it floats in here.</p>;
  const bubble = (thread: Thread) => {
    const points = map.points.get(thread.id) ?? 0;
    const at = spot(slots.current.get(thread.id)!);
    const size = (2 * radius(points)) / field.width;
    const room = map.rooms.get(thread.id);
    const topicIndex = map.topics.findIndex((topic) => topic.name === thread.topic);
    const pace = hash(thread.id);
    const where = map.active === thread.id ? "where you are" : thread.status === "dropped" ? "left off" : "";
    const style: CSSProperties & Record<`--${string}`, string> = {
      left: `${((at.x - field.left) / field.width) * 100}%`,
      top: `${((at.y - field.top) / field.height) * 100}%`,
      width: `${size * 100}%`,
      "--float": `${7 + pace * 4}s`,
      "--delay": `${-pace * 11}s`,
      ...(showTopics ? (topicIndex >= 0 ? topicStyle(topicIndex) : {})
        : room ? { "--room": `var(--room-${room})`, "--room-soft": `var(--room-${room}-soft)` } : {}),
    };
    const classes = ["bubbles-bubble", map.active === thread.id ? "bubbles-here" : "", thread.status === "dropped" ? "bubbles-left" : "",
      showTopics && topicIndex >= 0 ? "bubbles-sorted" : "",
      highlightedTopic !== null && (thread.topic ?? "") !== highlightedTopic ? "bubbles-faded" : ""].filter(Boolean).join(" ");
    return <li key={thread.id} className={classes} style={style}>
      <button type="button" className="bubbles-face" data-thread={thread.id} title={thread.topic !== undefined ? `${thread.title} · ${thread.topic}` : thread.title}
        aria-label={`${thread.title}, ${points} ${points === 1 ? "thought" : "thoughts"}${thread.topic !== undefined ? `, in ${thread.topic}` : ""}${where ? `, ${where}` : ""}`} onClick={() => actions.openThread(thread.id)}>
        <span className="bubbles-letter" aria-hidden="true">{Array.from(thread.title.trim())[0]?.toLocaleUpperCase() ?? "?"}</span>
        <span className="bubbles-title" aria-hidden="true">{thread.title}</span>
        <span className="bubbles-count" aria-hidden="true">{points} {points === 1 ? "thought" : "thoughts"}</span>
        {ripples[thread.id] && <span key={ripples[thread.id]} className="bubbles-ripple" aria-hidden="true" />}
      </button>
    </li>;
  };
  return <div className="bubbles">
    <div className="bubbles-intro">
      <div><span className="bubbles-eyebrow">Every thread, sized by what was said</span><h1>Your bubbles</h1></div>
      <p>{showTopics ? "Open a bubble to go to its thread. Pick a theme to see only its bubbles." : "Open a bubble to go to its thread."}</p>
    </div>
    {showTopics && <ul className="bubbles-topics" aria-label="Themes">
      {topics.map(({ name, label, style, count }) => <li key={name}>
        <button type="button" className="bubbles-topic" data-topic={name} aria-pressed={heldTopic === name} style={style}
          onMouseEnter={() => setHoveredTopic(name)} onMouseLeave={() => setHoveredTopic(null)}
          onFocus={() => { setHoveredTopic(null); setFocusedTopic(name); }} onBlur={() => setFocusedTopic(null)}
          onClick={() => {
            setHeldTopic((held) => held === name ? null : name);
            // Let a second click release the highlight even while the chip still has focus or the pointer.
            setHoveredTopic(null);
            setFocusedTopic(null);
          }}>
          <span className="bubbles-swatch" aria-hidden="true" />
          <span>{label}<span className="bubbles-topic-count"> · {count}</span></span>
        </button>
      </li>)}
    </ul>}
    <ul className="bubbles-field" aria-label="Threads as bubbles" style={{ aspectRatio: `${field.width} / ${field.height}`, maxWidth: `${field.width * STEP}px` }}>
      {map.threads.map(bubble)}
    </ul>
  </div>;
}
