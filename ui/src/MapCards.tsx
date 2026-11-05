import { memo, useContext, useEffect, useLayoutEffect, useRef, type Dispatch, type SetStateAction, type MutableRefObject, type MouseEvent } from "react";
import "./map-cards.css";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { capitalized, firstLetter, type Action, type ItemStatus, type Suggestion, type Thread, type Thought } from "./core";
import { AgreementControls } from "./bricks/spine/nodes";
import { SuggestPoint } from "./TextEditReview";
import { StayHere } from "./StayHere";
import { usePicture } from "./pictures";
import { useTopicImages } from "./topic-images";
import { actionLine, dismissable } from "./action-line";
import { leftBy, useMe } from "./room";
import { roomStyle } from "./rooms";
import { ProposalRows, useWaitingProposals } from "./Tidy";
import { MovePoint, ThreadTitle, useDropPoint } from "./Moves";
import { PointNote, useIdeas, useNote, wordsSaid } from "./chunks";
import { hoverTitle, WhyContext, WhyHere, whyLine } from "./whyhere";
import { ARRIVE, ThisTag, UnseenDot, usePointMarks } from "./Attention";
import { intoColumns, POINT_OWN, saidDiffers, useSaidOpen, useTwoColumns } from "./legible";
import { headClickToggles } from "./ux-rules";
import { sameCard } from "./search-rules";
import { useRouteMark } from "./route";
import { TIPS } from "./Tips";
import { downloadIcs, useSite } from "./site";
import { togglesPoint } from "./keys";
import { Markdown } from "./md";

const spring = { type: "spring", stiffness: 220, damping: 28 } as const;
const ROUTE_CLASS = { candidate: "route-candidate", here: "route-here", via: "route-via" } as const;

type Handlers = {
  setItem: (id: string, status: ItemStatus) => void;
  approve: (id: string) => void;
  tag: (threadId: string, tag: string, keep: boolean) => void;
  correct: (thoughtId: string, accept: boolean) => void;
  unlink: (thoughtId: string) => void;
};
/** How a dismissed suggestion or action leaves: a 150 ms fade, as a card's body folds (ThreadCard). A fade isn't motion,
 *  so it stays under Reduce Motion, where the rows below snap up instead of gliding (MotionConfig "user"). */
const EXIT = { opacity: 0, transition: { duration: 0.15 } };

type MapProps = {
  active: string | null; on: Handlers; activePath: Set<string>; rooms: Map<string, string>;
  childrenByParent: Map<string | null, Thread[]>; thoughtsByThread: Map<string, Thought[]>;
  ideasByThread: Map<string, Suggestion[]>; actionsByThread: Map<string, Action[]>;
  /** Found cards search holds open (search-rules.ts). */
  held: Set<string>; expanded: Record<string, boolean>;
  setExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
  keptOpen: MutableRefObject<Set<string>>;
};

const cardScroll = new WeakMap<MapProps["keptOpen"], number>();

// The composer, live transcript and pull-back timer update independently of the map.
export const MapCards = memo(function MapCards(props: MapProps) {
  useLayoutEffect(() => {
    if (!document.documentElement.classList.contains("shell2")) return;
    const visit = props.keptOpen;
    const top = cardScroll.get(visit) ?? 0;
    // The shell changes its view after child layout effects; restore once Cards owns page scrolling.
    const restore = requestAnimationFrame(() => window.scrollTo({ top, behavior: "instant" }));
    const remember = () => {
      if (document.documentElement.dataset.view === "cards") cardScroll.set(visit, window.scrollY);
    };
    window.addEventListener("scroll", remember, { passive: true });
    return () => {
      cancelAnimationFrame(restore);
      window.removeEventListener("scroll", remember);
    };
  }, [props.keptOpen]);
  const roots = props.childrenByParent.get(null) ?? [];
  // A wide window holds two columns (legible.ts); a lone thread sits in the middle (legible.css).
  const two = useTwoColumns();
  if (roots.length === 0) return <p className="no-results">Nothing found. Try different words.</p>;
  if (!two) return roots.map((thread) => <ThreadCard key={thread.id} thread={thread} {...props} />);
  return intoColumns(roots).map((column, i) => <div key={i} className="map-column">{column.map((thread) => <ThreadCard key={thread.id} thread={thread} {...props} />)}</div>);
});

// A card skips re-rendering while nothing it shows changed (sameCard), so a letter that leaves it as it was costs it nothing.
const ThreadCard = memo(function ThreadCard({ thread, active, rooms, on, activePath, childrenByParent, thoughtsByThread, ideasByThread, actionsByThread, held, expanded, setExpanded, keptOpen, depth = 2 }: MapProps & { thread: Thread; depth?: number }) {
  const reducedMotion = useReducedMotion();
  const thoughts = thoughtsByThread.get(thread.id) ?? [];
  // Two parts said across a pause show as one point (chunks.tsx).
  const points = useIdeas(thoughts);
  const ideas = ideasByThread.get(thread.id) ?? [];
  const actions = actionsByThread.get(thread.id) ?? [];
  const waiting = ideas.filter((idea) => idea.status === "new").length + actions.filter((action) => action.status === "new").length + useWaitingProposals(thread.id);
  const branches = childrenByParent.get(thread.id) ?? [];
  const isActive = active === thread.id;
  const collapsed = held.has(thread.id) ? false : expanded[thread.id] ?? !activePath.has(thread.id);
  // Your own unfinished thread is flagged; someone else's tag just says whose it is.
  const me = useMe();
  const by = thread.status === "dropped" ? leftBy(thread, me) : "";
  // A point dragged by its Move lands on the card under it (Moves.tsx).
  const drop = useDropPoint(thread.id);
  // Live routing (route.ts): lit while the placer weighs it, or on the path a thought just took.
  const route = useRouteMark(thread.id, active);
  const routeClasses = route ? `route-lit ${ROUTE_CLASS[route.kind]}${route.deep ? " route-deep" : ""}` : "";
  const classes = ["thread", isActive ? "active" : "", collapsed ? "collapsed" : "", thread.status === "dropped" && thread.dropped_by === me ? "dropped" : "", drop.over ? "drop-over" : "", routeClasses].join(" ");

  const toggle = (event: MouseEvent) => {
    if (held.has(thread.id)) return;
    // Option-click opens or folds every branch under it too, as "expand …" does.
    const under = (id: string): string[] => (childrenByParent.get(id) ?? []).flatMap((b) => [b.id, ...under(b.id)]);
    const ids = event.altKey ? [thread.id, ...under(thread.id)] : [thread.id];
    for (const id of ids) if (event.altKey && collapsed) keptOpen.current.add(id); else keptOpen.current.delete(id);
    setExpanded((state) => ({ ...state, ...Object.fromEntries(ids.map((id) => [id, !collapsed])) }));
  };

  return (
    <motion.section
      layout={reducedMotion ? false : true}
      id={`thread-${thread.id}`}
      data-guide={`thread:${thread.id}`}
      aria-labelledby={`title-${thread.id}`}
      className={classes}
      style={roomStyle(rooms.get(thread.id))}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      {...drop.props}
    >
      <ThisTag thread={thread.id} />
      {route?.tag && <span key={route.tag} className={`route-tag ${route.kind}`} title={route.title ?? undefined}>{route.tag}{route.title && <span className="sr-only"> · {route.title}</span>}</span>}
      {/* The whole head opens or folds the card (ux-rules.ts); the button stays for the keyboard and screen readers. */}
      <div className="thread-head" onClick={(event) => {
        if (headClickToggles(event.target as Element, window.getSelection()?.toString())) toggle(event);
      }}>
        <UnseenDot thread={thread.id} />
        <ThreadPicture thread={thread} marked />
        <div className="head-text">
          <div className="head-line">
            <ThreadTitle thread={thread} depth={depth} onOpen={toggle} />
            <StayHere thread={thread.id} title={thread.title} />
            {thread.status === "dropped" && <span className="chip dropped">{by ? `${by} left off` : "left off"}</span>}
            {isActive && <span className="chip now">active</span>}
            <span className="thread-count">{points.length} {points.length === 1 ? "thought" : "thoughts"}</span>
            {/* Folding a thread mustn't hide what waits for you there: the AI's proposals still to keep or dismiss. */}
            {collapsed && waiting > 0 && <span className="chip waiting">{waiting} new</span>}
          </div>
          {/* A suggested tag waits until the thread has said enough (3 thoughts) for it to add anything; kept tags always show. */}
          {!collapsed && (thread.tags ?? []).some((t) => t.kept || thoughts.length >= 3) && (
            <div className="tags">
              {thread.tags.filter((t) => t.kept || thoughts.length >= 3).map((t) => (
                <button
                  key={t.name}
                  className={t.kept ? "tag kept" : "tag"}
                  aria-label={`${t.kept ? "Kept tag" : "AI-suggested tag"}: ${t.name}`}
                  aria-pressed={t.kept}
                  title={t.kept ? "Remove tag" : undefined}
                  data-tip={t.kept ? undefined : TIPS.tag}
                  onClick={() => on.tag(thread.id, t.name, !t.kept)}
                >
                  {!t.kept && <span aria-hidden="true">✦ </span>}{t.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="collapse thread-toggle" aria-expanded={!collapsed} aria-disabled={held.has(thread.id)} onClick={toggle}>{collapsed ? "Show" : "Hide"} <span className="sr-only">{thread.title}</span></button>
      </div>
      <AnimatePresence initial={false}>
      {!collapsed && <motion.div key="body" initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.15 }}>
      <ul className="points">
        {points.map(({ thought: t, heads }) => (
          <Point key={t.id} thought={t} heads={heads} on={on} />
        ))}
      </ul>
      {/* A dismissed row fades out (EXIT) and the rows below glide up, rather than the row vanishing under the click. */}
      <AnimatePresence initial={false}>
      {ideas.map((s) => (
        <motion.div key={s.id} id={`item-${s.id}`} layout className={`ai ${s.status}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={EXIT}>
          <span className="ai-mark" role="img" aria-label="AI suggestion" data-tip={s.status === "kept" ? TIPS.kept : TIPS.suggestion}>✦</span>
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
      </AnimatePresence>
      <ProposalRows thread={thread.id} />
      <AnimatePresence initial={false}>
      {actions.map((a) => (
        <ActionRow key={a.id} action={a} on={on} />
      ))}
      </AnimatePresence>
      </motion.div>}
      </AnimatePresence>
      {branches.length > 0 && (
        <div className="branches">
          {branches.map((b) => (
            <ThreadCard key={b.id} thread={b} active={active} rooms={rooms} on={on} activePath={activePath} childrenByParent={childrenByParent} thoughtsByThread={thoughtsByThread} ideasByThread={ideasByThread} actionsByThread={actionsByThread} held={held} expanded={expanded} setExpanded={setExpanded} keptOpen={keptOpen} depth={depth + 1} />
          ))}
        </div>
      )}
    </motion.section>
  );
}, sameCard);

/** A thread's picture slot, there from the start with the thread's first letter (as in the Palace): a picture that
 *  arrives later fades in over it once decoded and moves nothing; one that fails to load leaves the letter (the
 *  rule in pictures.ts). A card used to grow 5–19 px when its picture came, its title sliding right, and a picture
 *  that failed showed a broken-image glyph. ✦ marks a picture only once one shows. */
export function ThreadPicture({ thread, marked = false }: { thread: Thread; marked?: boolean }) {
  const images = useTopicImages();
  const { shown, img } = usePicture(images && thread.picture ? [thread.picture] : []);
  return (
    <span className="picture-wrap">
      <span className="picture picture-letter" aria-hidden="true">{firstLetter(thread.title)}</span>
      {img && <img key={img.src} {...img} className={`picture ${img.className}`} />}
      {marked && shown && <span className="picture-mark" role="img" aria-label="AI-generated picture" data-tip={TIPS.picture}>✦</span>}
    </span>
  );
}

const Point = memo(function Point({ thought, heads, on }: { thought: Thought; heads: Thought[]; on: Handlers }) {
  // Your own thoughts need no name; anyone else's (a person in the room, or Helper) shows who said it.
  const me = useMe();
  const other = thought.speaker !== me && thought.speaker !== "you";
  const reducedMotion = useReducedMotion();
  // "Latest" while it's your newest point; under Reduce Motion a point arriving fades in instead of jumping.
  const { latest, arriving } = usePointMarks(thought.id);
  const fade = reducedMotion && arriving ? ARRIVE : { transition: spring };
  // Every point takes focus from a tap, so a phone shows its Move (moves.css); only one with a placement time to read
  // is a stop for Tab, as Move and Words said are their own.
  // The words behind the point open under it by click or tap anywhere on it, not by hover alone (a phone has none);
  // from the keyboard or a screen reader, by its "Words said" button (legible.css shows its focus on the whole point).
  // Joined across a pause, the words are each part as said; "why here" opens with them, and every placed point has
  // one to ask for (whyhere.tsx), so every placed point opens. The hover card says it too once it's known (C225).
  const why = whyLine(useNote(thought.id), useContext(WhyContext).whys[thought.id]);
  const words = heads.length ? wordsSaid(heads, thought) : `“${thought.text.trim()}”`;
  // Words that only repeat the point stay out (legible.ts); then it opens to its reason alone.
  const differ = heads.length > 0 || saidDiffers(thought.text, thought.point);
  const said = differ || thought.placed;
  const [open, flip] = useSaidOpen(thought.id);
  const toggle = said ? (event: MouseEvent) => {
    // Its own controls (legible.ts `POINT_OWN`; marks' tips in Tips.tsx) and selecting words to explain keep their jobs.
    if ((event.target as HTMLElement).closest(POINT_OWN) || !(window.getSelection()?.isCollapsed ?? true)) return;
    flip();
  } : undefined;
  // No layoutDependency: a point measures its box every time it renders. Measuring only when its thread's thoughts
  // changed left a point that had just landed in a branch drawn ≈ 100 px under its card for 13–15 s after "Show" on a
  // card above (its card moved, Motion projected it from its old box: the move counted twice). scripts/points-check.mjs.
  return (
    <motion.li id={`point-${thought.id}`} data-guide={`point:${thought.id}`} layout={reducedMotion ? false : true} layoutId={reducedMotion ? undefined : thought.id} {...fade} data-latest={latest || undefined} data-heads={heads.map((h) => h.id).join(" ") || undefined} title={said && !open ? hoverTitle(differ ? (heads.length ? words : thought.text) : "", why) || undefined : undefined} className={[other ? "other" : "", said ? "has-said" : "", open ? "said-open" : ""].filter(Boolean).join(" ") || undefined} tabIndex={thought.place_ms != null ? 0 : -1} onClick={toggle}
      onKeyDown={said ? (event) => { if (togglesPoint({ key: event.key, onPoint: event.target === event.currentTarget, taken: event.defaultPrevented })) { event.preventDefault(); flip(); } } : undefined}>
      {other && <span className="speaker">{thought.speaker}</span>}
      {/* Every point is a short version of the person's own words, so it stays unmarked: ✦ is for what the AI adds or proposes. */}
      {/* Said in so many words ("Decided: …", decided.rs in the core), so it's the person's own mark, not ✦: it says
          which points are settled at a glance, and they're what Recap leads with. */}
      {thought.decided && <span className="decided"><span aria-hidden="true">✓ </span>Decided</span>}
      <span><Markdown text={capitalized(thought.point)} /></span>
      {latest && <span className="sr-only">(your latest thought)</span>}
      {said && <button type="button" className="said-toggle" aria-expanded={open} aria-controls={`said-${thought.id}`} onClick={flip}>{differ ? "Words said" : "Why here"}</button>}
      {thought.placed && <SuggestPoint ids={[...heads.map(h => h.id), thought.id]} />}
      <AgreementControls ids={[...heads.map(head => head.id), thought.id]} />
      <MovePoint thought={thought} />
      <PointNote thought={thought} heads={heads} unlink={on.unlink} />
      {/* Joined across a pause, each part keeps its own "Did you mean" and undo of a fix. */}
      {heads.map((head) => <Fixes key={head.id} thought={head} on={on} />)}
      <Fixes thought={thought} on={on} />
      {thought.place_ms != null && <><span className="speed" aria-hidden="true">{(thought.place_ms / 1000).toFixed(1)} s</span><span className="sr-only">Placed in {(thought.place_ms / 1000).toFixed(1)} seconds</span></>}
      {said && <span id={`said-${thought.id}`} className="said" hidden={!open}>{differ && [...heads, thought].flatMap((part, i) => [i > 0 ? " … " : "", "“", <Markdown key={part.id} text={part.text.trim()} />, "”"])}{thought.placed && open && <WhyHere thoughtId={thought.id} />}</span>}
    </motion.li>
  );
});

/** A point's speech fixes: "✦ fixed" (one tap puts the words back) and "Did you mean …?". */
export function Fixes({ thought, on }: { thought: Thought; on: Handlers }) {
  return (
    <>
      {thought.heard && thought.fixed && (
        // Fixed without asking: quiet until you look, and one tap puts the words back.
        <button className="fixed" onClick={() => on.correct(thought.id, false)} aria-label={`Undo fix: heard “${thought.heard}”`}>
          <span><span aria-hidden="true">✦</span> fixed</span>
          <span><span aria-hidden="true">✦</span> heard “<Markdown text={thought.heard} />” · undo</span>
        </button>
      )}
      {thought.unclear && thought.guess ? (
        <span className="did-you-mean">
          {/* title="": the point's own title (its words said) would show a second, system tip over this one. */}
          <span className="ai-mark" role="img" aria-label="AI suggestion" data-tip={TIPS.guess} title="">✦</span> Did you mean “<Markdown text={thought.guess} />”?
          <button onClick={() => on.correct(thought.id, true)}>Yes</button>
          <button className="quiet" onClick={() => on.correct(thought.id, false)} aria-label={`No, keep “${thought.unclear}”`}>
            No
          </button>
        </span>
      ) : (
        thought.unclear && (
          <span className="unclear" data-tip={TIPS.unclear(thought.unclear)} title="" role="img" aria-label={`Might be misheard: ${thought.unclear}`}>
            ?
          </span>
        )
      )}
    </>
  );
}

// A real YYYY-MM-DD day, as the core checks it: "Saturday" or "2026-11-31" (which a Date rolls over to December 1) isn't one.
function day(when: string): Date | null {
  const [y, m, d] = when.split("-").map(Number);
  const date = new Date(y, m - 1, d, 9);
  return /^\d{4}-\d{2}-\d{2}$/.test(when) && y >= 2000 && y <= 2100 && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

function ActionRow({ action, on }: { action: Action; on: Handlers }) {
  // Matches the core: an event without a real date goes to Reminders.
  const date = day(action.when);
  const app = action.kind === "event" && date ? "Calendar" : "Reminders";
  const when = date ? date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
  // How soon it's due, in words and in amber's shade (what needs you): overdue darkest, today full, later quiet.
  const days = date ? Math.round((new Date(date).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000) : null;
  const due = days == null || action.status === "done" ? "" : days < 0 ? "overdue" : days === 0 ? "today" : days === 1 ? "tomorrow" : "";
  const dueText = due === "overdue" ? `Overdue · ${when}` : due === "today" ? "Today" : due === "tomorrow" ? "Tomorrow" : when;
  // Off a Mac, or hosted, a dated item saves as a calendar file instead (site.ts).
  const { calendarFile } = useSite();
  const line = actionLine(action, app, calendarFile);
  // Add pressed from the keyboard: its button goes while Apple's side runs, so focus waits on the row instead of
  // falling to the page, and goes to "Try again" if it comes back (unless you've moved on). A click's isn't moved.
  const row = useRef<HTMLDivElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  const keyed = useRef(false);
  const approve = () => {
    keyed.current = !!add.current?.matches(":focus-visible");
    if (keyed.current) row.current?.focus({ preventScroll: true });
    // The file is saved here, in the browser; the core then marks it saved for every window.
    if (calendarFile && !downloadIcs(action)) return;
    on.approve(action.id);
  };
  useEffect(() => {
    if (action.status === "kept" || !keyed.current) return;
    keyed.current = false;
    const focused = document.activeElement;
    if (action.status === "new" && (focused === row.current || focused === document.body)) add.current?.focus({ preventScroll: true });
  }, [action.status]);
  return (
    <motion.div ref={row} tabIndex={-1} id={`item-${action.id}`} layout className={`action ${action.status}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={EXIT}>
      <span className="action-icon" role="img" aria-label={action.status === "done" ? "Added" : "AI-proposed action"}
        data-tip={calendarFile ? TIPS.file(action.status === "done", !!line.button) : action.status === "done" ? TIPS.added(app) : action.status === "kept" ? TIPS.adding(app) : TIPS.action(app)}>{action.status === "done" ? "✓" : "✦"}</span>
      <span>
        {action.title}
        {when && <span className={`when${due ? ` due ${due}` : ""}`}> · {dueText}</span>}
        {/* Under the title, beside its "Try again", where the click was: a notice elsewhere is missed on camera. */}
        {line.failed && <span className="action-failed" role="alert">{line.failed}</span>}
      </span>
      {/* × on every waiting item: one with no day has nothing to download hosted, but can still be dismissed. */}
      {dismissable(action) && (
        <span className="ai-actions">
          {line.button && <button ref={add} aria-label={line.label} onClick={approve}>{line.button}</button>}
          <button className="quiet" onClick={() => on.setItem(action.id, "dismissed")} aria-label={`Dismiss ${action.title}`}>
            ×
          </button>
        </span>
      )}
      {line.status && <span className="when ai-actions" role="status">{line.status}</span>}
    </motion.div>
  );
}
