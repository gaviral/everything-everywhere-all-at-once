import { usePluginState } from "../contract";
// The Work spine itself: the jobs as bubbles on a line, oldest at the top and the newest at the foot ("Just now"), each
// with its state in words, side jobs folded under their parent. The lane (beside the Canvas) and the card in the dock
// (a phone, a narrow window) both show this and differ only in what's around it.
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Job } from "../contract";
import { below, forest, justNow, parts, questions, stateOf, tally, type Node } from "./jobs";

/** What the page says when a job's state words aren't enough. */
const DEMO_WORDS = "Demo mode · simulated";
/** How long a bubble that just arrived, or just changed, stays marked. */
const FRESH_MS = 2400;
/** A window that opens (or a connection's replay that arrives) within this of the list isn't news. */
const SETTLE_MS = 600;
/** How long after a wheel, a finger, a key or a press the list's place is its reader's. */
const HAND_MS = 400;

const COUNT_CLASS = { preparing: "work-spine-preparing", queued: "work-spine-queued", stopped: "work-spine-stopped", running: "work-spine-running", waiting: "work-spine-waiting", failed: "work-spine-failed" } as const;
const STATE_CLASS = { preparing: "work-spine-state-preparing", queued: "work-spine-state-queued", stopped: "work-spine-state-stopped", running: "work-spine-state-running", waiting: "work-spine-state-waiting", failed: "work-spine-state-failed", done: "work-spine-state-done" } as const;

/** "2 running · 1 waiting": what isn't over, or went wrong (waiting counts the questions that need you); the quiet words
 *  when nothing is. */
export function Counts({ jobs }: { jobs: readonly Job[] }) {
  if (!jobs.length) return <>No jobs yet</>;
  const shown = parts(tally(jobs, questions(jobs)));
  if (!shown.length) return <>All done</>;
  return <>{shown.map((part, i) => <span key={part.key}>{i > 0 && " · "}<span className={COUNT_CLASS[part.key]}>{part.text}</span></span>)}</>;
}

/** The label that heads the Work spine when any job shown is simulated. */
export const isDemo = (jobs: readonly Job[]) => jobs.some((job) => job.demo);
export function DemoLabel() {
  return <span className="work-spine-demo">{DEMO_WORDS}</span>;
}

/** What's new since this opened: a job that came, or one whose state or words changed, marked for FRESH_MS (the
 *  bubble settles in, a landed result glows). What was there when it opened, or came in its first moments (a
 *  connection's replay), is not news. */
export function useFresh(jobs: readonly Job[]): ReadonlyMap<string, "new" | "landed"> {
  const seen = useRef<Map<string, string> | null>(null);
  const opened = useRef(Date.now());
  const timers = useRef(new Set<number>());
  const [fresh, setFresh] = useState<ReadonlyMap<string, "new" | "landed">>(new Map());
  useEffect(() => () => { for (const timer of timers.current) window.clearTimeout(timer); }, []);
  useLayoutEffect(() => {
    const now = new Map(jobs.map((job) => [job.id, `${job.status}|${job.result ?? ""}`]));
    const before = seen.current;
    seen.current = now;
    if (!before || Date.now() - opened.current < SETTLE_MS) return;
    const news = new Map<string, "new" | "landed">();
    for (const job of jobs) {
      const was = before.get(job.id);
      if (was === undefined) news.set(job.id, "new");
      else if (was !== now.get(job.id)) news.set(job.id, "landed");
    }
    if (!news.size) return;
    setFresh((was) => new Map([...was, ...news]));
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setFresh((was) => { const next = new Map(was); for (const [id, kind] of news) if (next.get(id) === kind) next.delete(id); return next; });
    }, FRESH_MS);
    timers.current.add(timer);
  }, [jobs]);
  return fresh;
}

/** The time, ticking once a second while a job runs (its clock) and every few seconds while "Just now" can still be
 *  true, else not at all; a new job brings it up to date at once. */
export function useNow(jobs: readonly Job[]): number {
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

interface Shared {
  now: number;
  open: ReadonlySet<string>;
  toggle: (id: string) => void;
  fresh: ReadonlyMap<string, "new" | "landed">;
  /** The job "Just now" marks. */
  latest: string | null;
  /** The waiting jobs that ask (jobs.ts `questions`): only they wear the question's bar. */
  asks: ReadonlySet<string>;
  /** More than one sender: each bubble says who. */
  many: boolean;
  ai: (name: string) => boolean;
  /** The list stops following the newest (a fold was opened: what's under it is what you're reading). */
  release: () => void;
}

type Proposal = {
  base: string; status: "created" | "running" | "completed" | "failed" | "stopped";
  exit_code: number | null; validation: string; no_change: boolean; truncated: boolean;
  files: { path: string; additions: number; deletions: number; binary: boolean; truncated: boolean; withheld: boolean; diff: string }[];
};
const executionWords = { created: "Not started", running: "Running", completed: "Execution completed", failed: "Failed", stopped: "Stopped" };

function CodingResult({ job, release }: { job: Job; release: () => void }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<Proposal | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open || !job.result_id) return;
    const controller = new AbortController();
    setResult(null); setError("");
    fetch("/helper-result", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result_id: job.result_id }), signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error(response.status === 403 ? "Only the host can inspect this proposal." : "Proposal unavailable. Close and reopen to retry.");
      const proposal: Proposal = await response.json();
      if (!controller.signal.aborted) setResult(proposal);
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Proposal unavailable."); });
    return () => controller.abort();
  }, [open, job.result_id, job.status]);
  return <details className="work-spine-result work-spine-proposal" onToggle={(event) => {
    setOpen(event.currentTarget.open); if (event.currentTarget.open) release();
  }}>
    <summary>Inspect changes</summary>
    {open && <div className="work-spine-proposal-body" aria-live="polite">
      {error ? <p role="alert">{error}</p> : !result ? <p>Reading proposal…</p> : <>
        <p>{executionWords[result.status]}{result.exit_code !== null && ` · Exit ${result.exit_code}`} · {result.validation === "not_run" ? "Validation not run" : "Validation status unavailable"}</p>
        <p className="work-spine-base">Base <code>{result.base}</code></p>
        <p>{result.no_change ? "No changes." : `${result.files.length} files shown · proposed changes need review.`}</p>
        {result.truncated && <p>Result truncated · file counts or text may be incomplete.</p>}
        {result.files.map((file, i) => <section key={i} className="work-spine-file">
          <p>{file.path} {file.withheld ? "· Private or unsupported file withheld" : file.binary ? "· Binary change · text unavailable" : `· +${file.additions} −${file.deletions}`}</p>
          {file.diff && <pre tabIndex={0} aria-label={`Changes in ${file.path}`}>{file.diff}</pre>}
          {file.truncated && <p>File text truncated.</p>}
        </section>)}
      </>}
    </div>}
  </details>;
}

function Bubble({ node, shared }: { node: Node; shared: Shared }) {
  const { job, kids } = node;
  const state = stateOf(job, shared.now);
  const folded = below(node);
  const open = shared.open.has(job.id);
  const listId = useId();
  const item = useRef<HTMLLIElement>(null);
  const first = useRef(true);
  // Opening a fold brings what it opened into view, even at the foot of the list, with its parent still above it as
  // far as they both fit.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const box = item.current?.closest(".work-spine-scroll");
    if (!open || !item.current || !box) return;
    const at = item.current.getBoundingClientRect(), room = box.getBoundingClientRect();
    const hangs = at.bottom - (room.bottom - 14), canRise = at.top - (room.top + 14);
    if (hangs > 0) box.scrollTop += Math.min(hangs, Math.max(canRise, 0));
  }, [open]);
  const more = parts(tally(folded, shared.asks));
  const inside = !open && shared.latest !== null && folded.some((hidden) => hidden.id === shared.latest);
  const side = folded.length === 1 ? "job" : "jobs";
  return <li ref={item} className="work-spine-job" data-job-id={job.id} data-status={job.status} data-helper-kind={job.helper_kind} data-parent={job.parent} data-fresh={shared.fresh.get(job.id)}>
    <article className="work-spine-bubble">
      {shared.many && <p className="work-spine-by">{shared.ai(job.by) && <span className="ai-mark" aria-hidden="true">✦ </span>}{job.by}</p>}
      <p className="work-spine-job-title">{job.title}</p>
      {job.helper_kind && !job.parent && <p className="work-spine-requested">{job.requested_count} {job.helper_kind} helpers requested</p>}
      <p className={`work-spine-state ${STATE_CLASS[job.status]}`}>
        <span className="work-spine-mark" aria-hidden="true">{state.mark || <i className="work-spine-pulse" />}</span>
        <span className="work-spine-word">{state.word}</span>
        {state.clock && <>{" "}<span className="work-spine-clock">{state.clock}</span></>}
        {shared.latest === job.id && <>{" "}<span className="work-spine-now">Just now</span></>}
      </p>
      {job.result && (job.id.startsWith("helpers:") && job.parent && job.helper_kind === "thinking" && job.status === "done"
        ? <details className="work-spine-result" onToggle={(event) => { if (event.currentTarget.open) shared.release(); }}><summary>Read answer</summary><p>{job.result}</p></details>
        : <p className={shared.asks.has(job.id) ? "work-spine-question" : "work-spine-result"}>{job.result}</p>)}
      {job.result_id && job.helper_kind === "coding" && job.parent && <CodingResult job={job} release={shared.release} />}
    </article>
    {kids.length > 0 && <>
      <button type="button" className="work-spine-fold" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => { shared.release(); shared.toggle(job.id); }}>
        <span className="work-spine-fold-count">{open ? "Hide side " + side : "+" + folded.length + " side " + side}<span className="sr-only"> of {job.title}</span></span>
        {!open && more.map((part) => <Fragment key={part.key}>{" "}<span className={COUNT_CLASS[part.key]}>{part.text}</span></Fragment>)}
        {inside && <>{" "}<span className="work-spine-now">Just now</span></>}
      </button>
      {open && <ol id={listId} className="work-spine-kids">{kids.map((kid) => <Bubble key={kid.job.id} node={kid} shared={shared} />)}</ol>}
    </>}
  </li>;
}

/** The list: a scroll of bubbles that follows the newest while you're at its foot and lets go once you scroll up (a
 *  "Latest" button brings you back). */
export function JobList({ jobs, now, open, toggle, fresh, ai }: { jobs: readonly Job[]; now: number; open: ReadonlySet<string>; toggle: (id: string) => void;
  fresh: ReadonlyMap<string, "new" | "landed">; ai: (name: string) => boolean }) {
  const tree = useMemo(() => forest(jobs), [jobs]);
  const many = useMemo(() => new Set(jobs.map((job) => job.by)).size > 1, [jobs]);
  const asks = useMemo(() => questions(jobs), [jobs]);
  const scroller = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = usePluginState("job-scroll", 0);
  const [following, setFollowing] = usePluginState("job-following", true);
  // A following list goes to the current foot; only an older reading position needs its saved offset.
  useLayoutEffect(() => { if (scroller.current && !following) scroller.current.scrollTop = scroll; }, []);
  const stuck = useRef(following);
  const followScroll = useRef<number | null>(null);
  /** When a hand last touched the list (wheel, finger, key, press): for that moment its place is the hand's, whether or not
   *  the scroll event has come yet. */
  const handAt = useRef(0);
  const byHand = () => { handAt.current = Date.now(); followScroll.current = null; };
  const [away, setAway] = useState(!following);
  const followFoot = (value: boolean) => {
    if (stuck.current !== value) setFollowing(value);
    stuck.current = value;
    setAway(!value);
  };
  const atFoot = (box: HTMLElement) => box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  const scrollToFoot = (box: HTMLElement) => {
    const before = box.scrollTop;
    box.scrollTop = box.scrollHeight;
    if (box.scrollTop !== before) followScroll.current = box.scrollTop;
  };
  const follow = () => {
    const box = scroller.current;
    if (!box) return;
    if (box.scrollHeight <= box.clientHeight + 1) {
      // With nothing to scroll there's nothing to hold your place in: following resumes.
      followFoot(true);
    } else if (Date.now() - handAt.current < HAND_MS) {
      // A hand is on it: a render landing between its scroll and the scroll event must not pull the list back.
      followFoot(atFoot(box));
      return;
    }
    if (stuck.current) scrollToFoot(box);
  };
  useLayoutEffect(follow);
  const empty = tree.length === 0;
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const watch = new ResizeObserver(follow);
    watch.observe(box);
    if (box.firstElementChild) watch.observe(box.firstElementChild);
    return () => watch.disconnect();
  }, [empty]);
  /** "Latest": back to the newest, and following again; the press that asked is a hand, but this is where it wanted to go. */
  const toFoot = () => {
    const box = scroller.current;
    if (!box) return;
    handAt.current = 0;
    followFoot(true);
    scrollToFoot(box);
  };
  const scrolled = () => {
    const box = scroller.current;
    if (!box) return;
    // A follow scroll can arrive after a new job grows the list. It isn't a hand releasing follow.
    const ownScroll = followScroll.current === box.scrollTop;
    followScroll.current = null;
    if (ownScroll && stuck.current) {
      follow();
      setScroll(box.scrollTop);
      return;
    }
    setScroll(box.scrollTop);
    followFoot(atFoot(box));
  };
  // Reserve Latest's row in the same render that opens a fold, before its contents are brought into view.
  const shared: Shared = { now, open, toggle, fresh, latest: justNow(jobs, now), asks, many, ai, release: () => followFoot(false) };
  return <div className="work-spine-listbox">
    <div ref={scroller} className="work-spine-scroll" tabIndex={0} role="region" aria-label="Jobs, oldest first" onScroll={scrolled}
      onWheel={byHand} onTouchMove={byHand} onKeyDown={byHand} onPointerDown={byHand}>
      {empty ? <p className="work-spine-empty">When an AI helper starts work, it shows up here. Try the simulated feed from a terminal in the app folder:<code>node scripts/demo-jobs.mjs</code>Use <code>--port PORT</code> if the app is on another port. No AI key needed.</p>
        : <ol className="work-spine-list">{tree.map((node) => <Bubble key={node.job.id} node={node} shared={shared} />)}</ol>}
    </div>
    {away && <button type="button" className="work-spine-latest" onClick={toFoot}>↓ Latest</button>}
  </div>;
}
