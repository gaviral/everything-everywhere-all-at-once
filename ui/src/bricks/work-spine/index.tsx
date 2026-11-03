// The Work spine: what the AI helpers are doing, as jobs on a spine of their own beside your thoughts: running (with a live
// clock), done (how long, and what it found), failed (why), waiting (the question it holds for you). Beside the Canvas on
// a laptop in the new shell: a lane at the page's right that the Canvas gives room to, never under it. Anywhere narrower
// (a phone, a small window), on today's page, or while a call's Talk rail holds the page's right: a card in the dock above
// the composer, one line until it's tapped, then the list opening as a sheet above the dock, so the composer is never
// covered. The jobs are `map.jobs` (work-jobs.ts keeps them); nothing here asks the core for anything.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BrickProps, Job } from "../contract";
import { Counts, DemoLabel, isDemo, JobList, useFresh } from "./list";
import { justNow } from "./jobs";
import "./work-spine.css";

/** The lane needs a window this wide in the new shell: the Canvas keeps at least 600 px beside it. */
const LANE_MIN = 1000;

/** A rail that stays open at the page's right (the call's Talk): it holds the side the lane would need. The shell's own
 *  rail (the Catalog, History) comes and goes over the lane, as it does over the Canvas, and is not this. */
const OTHER_RAIL = '[data-slot="rail"]:not(.shell-rail)';

/** Whether the lane has room: the new shell's page, wide enough, and nothing else holding the page's right side. */
function useLane(): boolean {
  const shell = document.documentElement.classList.contains("shell2");
  const [wide, setWide] = useState(() => shell && matchMedia(`(min-width: ${LANE_MIN}px)`).matches);
  const [taken, setTaken] = useState(() => shell && !!document.querySelector(OTHER_RAIL));
  useEffect(() => {
    if (!shell) return;
    const media = matchMedia(`(min-width: ${LANE_MIN}px)`);
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    const look = () => setTaken(!!document.querySelector(OTHER_RAIL));
    look();
    const watch = new MutationObserver(look);
    watch.observe(document.body, { childList: true, subtree: true });
    return () => { media.removeEventListener("change", update); watch.disconnect(); };
  }, [shell]);
  return shell && wide && !taken;
}

/** The time, ticking once a second while a job runs (its clock) and every few seconds while "Just now" can still be
 *  true, else not at all; a new job brings it up to date at once. */
function useNow(jobs: readonly Job[]): number {
  const [now, setNow] = useState(() => Date.now());
  const running = jobs.some((job) => job.status === "running");
  const recent = justNow(jobs, now) !== null;
  useEffect(() => {
    setNow(Date.now());
    if (!running && !recent) return;
    const timer = window.setInterval(() => setNow(Date.now()), running ? 1000 : 5000);
    return () => window.clearInterval(timer);
  }, [jobs, running, recent]);
  return now;
}

/** One polite line for a screen reader when a job lands, fails or asks: never each tick of a running clock. */
function Announce({ jobs }: { jobs: readonly Job[] }) {
  const [said, setSaid] = useState("");
  const was = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const now = new Map(jobs.map((job) => [job.id, `${job.status}|${job.result ?? ""}`]));
    const before = was.current;
    was.current = now;
    if (!before) return;
    const changed = jobs.filter((job) => job.status !== "running" && before.get(job.id) !== now.get(job.id)).at(-1);
    if (!changed) return;
    const line = `${changed.title}: ${changed.status === "waiting" ? "waiting for you" : changed.status}`;
    setSaid(changed.result ? `${line}. ${changed.result}` : line);
  }, [jobs]);
  return <p className="sr-only" role="status">{said}</p>;
}

interface Shared {
  jobs: readonly Job[];
  now: number;
  open: ReadonlySet<string>;
  toggle: (id: string) => void;
  fresh: ReadonlyMap<string, "new" | "landed">;
  ai: (name: string) => boolean;
}

/** The lane: the page's right side, from the window's top to its foot. It tells the page how wide it is (`--room-right`,
 *  shell.css), so the Canvas ends where it begins, and where its words may start and stop: below the corner buttons and
 *  the call's Talk pill, above whatever stands at the window's foot where the lane is (the stage in a narrow window, a
 *  held card), else just above the status line. It's drawn at the body, outside the dock's own box, so it stays where
 *  the window puts it. */
function Lane({ jobs, now, open, toggle, fresh, ai }: Shared) {
  const pane = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = pane.current;
    if (!element) return;
    const root = document.documentElement.style;
    const watched = new Set<Element>();
    const watch = new ResizeObserver(() => measure());
    const set = (style: CSSStyleDeclaration, name: string, px: number) => { if (style.getPropertyValue(name) !== `${px}px`) style.setProperty(name, `${px}px`); };
    function measure() {
      const box = element!.getBoundingClientRect();
      set(root, "--room-right", Math.round(box.width));
      const over = (el: Element) => { const at = el.getBoundingClientRect(); return at.width > 0 && at.height > 0 && at.right > box.left && at.left < box.right ? at : null; };
      let top = 68, foot = 36;
      for (const el of document.querySelectorAll('[data-slot="top-right"], .talk-pill')) { const at = over(el); if (at) top = Math.max(top, at.bottom + 12); }
      for (const el of document.querySelectorAll('[data-slot="stage"], [data-slot="bottom-right"]')) { const at = over(el); if (at) foot = Math.max(foot, innerHeight - at.top + 12); }
      set(element!.style, "--work-spine-top", Math.round(top));
      set(element!.style, "--work-spine-foot", Math.round(foot));
      // What's measured may come or go (the Talk pill, a held card): look at whatever's there now.
      for (const el of document.querySelectorAll('[data-slot="top-right"], [data-slot="stage"], [data-slot="bottom-right"], .talk-pill')) {
        if (!watched.has(el)) { watched.add(el); watch.observe(el); }
      }
    }
    watch.observe(element);
    measure();
    // A corner that appears or goes (a card, the pill) changes what the lane must clear.
    const look = new MutationObserver(measure);
    look.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", measure);
    return () => { watch.disconnect(); look.disconnect(); window.removeEventListener("resize", measure); root.removeProperty("--room-right"); };
  }, []);
  return createPortal(<aside ref={pane} className="work-spine-lane" aria-label="Work spine" data-guide="work-spine">
    <Announce jobs={jobs} />
    <div className="work-spine-head">
      <span className="work-spine-badge ai-mark" aria-hidden="true">✦</span>
      <div className="work-spine-head-text">
        <div className="work-spine-top"><h2 className="work-spine-title">Work spine</h2>{isDemo(jobs) && <DemoLabel />}</div>
        <p className="work-spine-counts"><Counts jobs={jobs} /></p>
      </div>
    </div>
    <JobList jobs={jobs} now={now} open={open} toggle={toggle} fresh={fresh} ai={ai} />
  </aside>, document.body);
}

/** The card in the dock: one line (the badge, the name, the counts) that stays where it is. Tapped, the list opens above
 *  the dock as a sheet, so nothing moves and the composer is never covered; Esc, the card again, or a press anywhere
 *  else puts it away. */
function DockCard({ jobs, now, open, toggle, fresh, ai }: Shared) {
  const [expanded, setExpanded] = useState(false);
  const bar = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const sheetId = useId();
  // The sheet stands right above the card, as wide as it is, wherever the page puts it (the stage's width, a card above).
  const [place, setPlace] = useState<{ left: number; width: number; bottom: number } | null>(null);
  useLayoutEffect(() => {
    const element = bar.current;
    if (!expanded || !element) { setPlace(null); return; }
    const measure = () => {
      const at = element.getBoundingClientRect();
      const next = { left: Math.round(at.left), width: Math.round(at.width), bottom: Math.round(innerHeight - at.top + 8) };
      setPlace((was) => (was && was.left === next.left && was.width === next.width && was.bottom === next.bottom ? was : next));
    };
    measure();
    window.addEventListener("resize", measure);
    // The page keeps the dock's height on <html> (--dock-height), so it changing is the stage growing or shrinking.
    const watch = new MutationObserver(measure);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    return () => { window.removeEventListener("resize", measure); watch.disconnect(); };
  }, [expanded]);
  useEffect(() => {
    if (!expanded) return;
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!sheet.current?.contains(target) && !bar.current?.contains(target)) setExpanded(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setExpanded(false);
      bar.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key); };
  }, [expanded]);
  return <section className="work-spine-card" aria-label="Work spine" data-guide="work-spine" data-open={expanded}>
    <Announce jobs={jobs} />
    <button ref={bar} type="button" className="work-spine-bar" aria-expanded={expanded} aria-controls={expanded ? sheetId : undefined} onClick={() => setExpanded(!expanded)}>
      <span className="work-spine-badge ai-mark" aria-hidden="true">✦</span>
      <span className="work-spine-bar-text">
        <span className="work-spine-top"><span className="work-spine-title">Work spine</span>{isDemo(jobs) && <>{" "}<DemoLabel /></>}</span>{" "}
        <span className="work-spine-counts"><Counts jobs={jobs} /></span>
      </span>
      <span className="work-spine-chevron" aria-hidden="true" />
    </button>
    {expanded && createPortal(<div ref={sheet} id={sheetId} className="work-spine-sheet" style={place ?? undefined}><JobList jobs={jobs} now={now} open={open} toggle={toggle} fresh={fresh} ai={ai} /></div>, document.body)}
  </section>;
}

export default function WorkSpine({ map }: BrickProps) {
  const jobs = map.jobs;
  const lane = useLane();
  const now = useNow(jobs);
  const fresh = useFresh(jobs);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback((id: string) => setOpen((was) => { const next = new Set(was); if (!next.delete(id)) next.add(id); return next; }), []);
  const ai = useCallback((name: string) => !!map.speakers.get(name)?.ai, [map.speakers]);
  const shared: Shared = { jobs, now, open, toggle, fresh, ai };
  // In the lane nothing is drawn where the dock's cards go, so the dock takes no room for it.
  return lane ? <Lane {...shared} /> : <DockCard {...shared} />;
}
