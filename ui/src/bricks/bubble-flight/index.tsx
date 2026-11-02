// Bubble flight (docs/bricks.md, a panel): a thought of yours leaves the dock as a bubble and, once placed, flies to
// its thread's card, filling the ≈ 2.7 s between saying it and seeing it land. After your first five it only lifts and
// fades. A thought still unplaced after 5 s fades where it is (the dock's pill has it), and with reduced motion nothing
// shows: the app turns every animation off then (styles.css), so a bubble could only hang there.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useBrickEvent, type BrickProps } from "../contract";
import "./bubble-flight.css";

type Flight = {
  id: string;
  text: string;
  x: number;
  y: number;
  compact: boolean;
  /** Bubbles that leave in one go (a long paste sent in parts) stack, each a row above the last. */
  slot: number;
  threadId?: string;
};
type Phase = "depart" | "fly" | "fade";

// How long a bubble waits for its thought to be placed before it fades where it is: past the slowest of nine in ten
// placings measured (≈ 4 s; the median ≈ 2.7 s, the length of the lift in bubble-flight.css).
const WAIT_MS = 5000;
// Each phase's end, past its animations' own (fly 400 ms, fade 150 ms, the quick slide 600 ms): a bubble goes even if an
// animation never ends (a hidden tab runs none).
const GONE_MS = { fly: 600, fade: 300, quick: 800 };
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, Math.max(low, high)));

function Bubble({ flight, remove }: { flight: Flight; remove: (id: string) => void }) {
  const element = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("depart");
  const now = useRef<Phase>("depart");
  // From where the bubble is drawn now, mid-lift, into its next phase.
  const go = (next: Phase) => {
    const bubble = element.current;
    if (!bubble || now.current !== "depart") return;
    const rect = bubble.getBoundingClientRect();
    bubble.style.setProperty("--bubble-flight-from-x", `${rect.left - bubble.offsetLeft}px`);
    bubble.style.setProperty("--bubble-flight-from-y", `${rect.top - bubble.offsetTop}px`);
    now.current = next;
    setPhase(next);
  };

  useLayoutEffect(() => {
    const bubble = element.current!;
    const position = () => {
      const height = bubble.offsetHeight;
      bubble.style.left = `${clamp(flight.x - bubble.offsetWidth / 2, 8, innerWidth - bubble.offsetWidth - 8)}px`;
      bubble.style.top = `${clamp(flight.y - height - flight.slot * (height + 6) - (flight.compact ? 8 : 0), 8, innerHeight - height - 8)}px`;
    };
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [flight.x, flight.y, flight.slot, flight.compact]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!flight.compact && phase === "depart") go("fade");
      else remove(flight.id);
    }, flight.compact ? GONE_MS.quick : phase === "depart" ? WAIT_MS : GONE_MS[phase]);
    return () => window.clearTimeout(timer);
  }, [phase, flight.compact]);

  useEffect(() => {
    if (!flight.threadId || flight.compact || now.current !== "depart") return;
    const bubble = element.current!;
    let frame = 0;
    const started = performance.now();
    const aim = () => {
      // A new thread's card can mount just after the landing: allow a few frames, then fade where it is if there's
      // still none (another view is open). Never a guessed destination before placement.
      const card = document.getElementById(`thread-${flight.threadId}`);
      if (now.current === "depart") {
        if (!card && performance.now() - started < 200) { frame = requestAnimationFrame(aim); return; }
        go(card ? "fly" : "fade");
      }
      if (card && now.current === "fly") {
        const target = card.getBoundingClientRect();
        const x = clamp(target.left + target.width / 2 - bubble.offsetWidth / 2, 8, innerWidth - bubble.offsetWidth - 8);
        const y = clamp(target.top, 8, innerHeight - bubble.offsetHeight - 8);
        bubble.style.setProperty("--bubble-flight-to-x", `${x - bubble.offsetLeft}px`);
        bubble.style.setProperty("--bubble-flight-to-y", `${y - bubble.offsetTop}px`);
        // Follow the card through the map's landing scroll, for this short hand-off only.
        frame = requestAnimationFrame(aim);
      }
    };
    frame = requestAnimationFrame(aim);
    return () => cancelAnimationFrame(frame);
  }, [flight.threadId, flight.compact]);

  const classes = ["bubble-flight-bubble", flight.compact ? "bubble-flight-compact" : "bubble-flight-full",
    phase === "fly" ? "bubble-flight-flying" : "", phase === "fade" ? "bubble-flight-fading" : ""].join(" ");
  return <div ref={element} className={classes} data-thought-id={flight.id} data-thread-id={flight.threadId}
    onAnimationEnd={(event) => {
      if (["bubble-flight-quick", "bubble-flight-fade-out"].includes(event.animationName)) remove(flight.id);
    }}>{flight.text}</div>;
}

export default function BubbleFlight({ map, on }: BrickProps) {
  // Seed placed history, including a full map, so enabling the brick never replays old thoughts.
  const seen = useRef(new Set(map.thoughts.filter((thought) => thought.placed).map((thought) => thought.id)));
  const count = useRef(0);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const remove = (id: string) => setFlights((was) => was.filter((flight) => flight.id !== id));

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => { setReduced(preference.matches); if (preference.matches) setFlights([]); };
    changed();
    preference.addEventListener("change", changed);
    return () => preference.removeEventListener("change", changed);
  }, []);

  useBrickEvent(on, "landed", ({ thoughtId, threadId, mine }) => {
    if (mine) setFlights((was) => was.map((flight) => flight.id === thoughtId ? { ...flight, threadId } : flight));
  });

  useEffect(() => {
    const added: Flight[] = [];
    // Each thought on its way grows the dock by its pill, so bubbles from separate changes stack by themselves.
    let stacked = 0;
    for (const thought of map.thoughts) {
      if (seen.current.has(thought.id)) continue;
      seen.current.add(thought.id);
      if (thought.placed || thought.speaker !== map.me || reduced) continue;
      const compact = count.current++ >= 5;
      // From the dock's top edge, clear of the pill that shows the same words; the composer's where there's no dock.
      const composer = document.querySelector(".composer")?.getBoundingClientRect();
      const dock = document.querySelector(".dock")?.getBoundingClientRect();
      // No made-up origin without a composer (the playground has none).
      if (composer) added.push({ id: thought.id, text: thought.text, compact, slot: compact ? 0 : stacked++,
        x: composer.left + composer.width / 2, y: dock && dock.height ? Math.min(dock.top, composer.top) : composer.top });
    }
    const thoughts = new Map(map.thoughts.map((thought) => [thought.id, thought]));
    setFlights((was) => [...was, ...added].filter((flight) => thoughts.get(flight.id)?.speaker === map.me).map((flight) => {
      const thought = thoughts.get(flight.id)!;
      return thought.placed && thought.thread_id && flight.threadId !== thought.thread_id
        ? { ...flight, threadId: thought.thread_id } : flight;
    }));
  }, [map.thoughts, map.me, reduced]);

  if (reduced) return null;
  return <div className="bubble-flight" aria-hidden="true">
    {flights.map((flight) => <Bubble key={flight.id} flight={flight} remove={remove} />)}
  </div>;
}
