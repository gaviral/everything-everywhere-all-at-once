import { lazy, memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";
import { capitalized, firstLetter, LOOKING, useCore, type Action, type ItemStatus, type Suggestion, type Thread, type Thought } from "./core";
import { ImportChats } from "./Import";
import { Away, useAway } from "./Away";

type Handlers = {
  setItem: (id: string, status: ItemStatus) => void;
  approve: (id: string) => void;
  tag: (threadId: string, tag: string, keep: boolean) => void;
  correct: (thoughtId: string, accept: boolean) => void;
};
import { startMic } from "./mic";
import { Apps } from "./Apps";
import { Explain } from "./Explain";
import { Palace } from "./Palace";
import { Recap } from "./Recap";
import { hasToured, Tour } from "./Tour";
import { leftBy, RoomControl, useMe } from "./room";
import { useFindJump } from "./find";

const spring = { type: "spring", stiffness: 220, damping: 28 } as const;
const RECORDING = typeof location !== "undefined" && new URLSearchParams(location.search).has("recording");
// `?level` adds a meter of the loudness readings the core receives, for tuning volume apps; without it, it isn't loaded.
const LevelMeter = typeof location !== "undefined" && new URLSearchParams(location.search).has("level") ? lazy(() => import("./Level")) : null;

export default function App() {
  const me = useMe();
  const core = useCore(me);
  const reducedMotion = useReducedMotion();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const world = useMemo(() => ({ ...core.world, active: core.world.active_by[me] ?? core.world.active }), [core.world, me]);
  const sessionCounts = useMemo(() => {
    const times = world.thoughts.map((thought) => thought.at_ms).filter((time) => time <= Date.now()).sort((a, b) => a - b);
    let start = times.at(-1) ?? 0;
    for (let i = times.length - 1; i > 0 && times[i] - times[i - 1] < 30 * 60 * 1000; i--) start = times[i - 1];
    const threads = new Set<string>();
    const threadIds = new Set(world.threads.map((thread) => thread.id));
    const mergeCount = Object.keys(world.merged).length;
    let thoughts = 0;
    for (const thought of world.thoughts) {
      if (!thought.placed || !thought.thread_id || thought.at_ms < start || thought.at_ms > Date.now()) continue;
      let id = thought.thread_id;
      for (let hops = mergeCount; hops > 0 && world.merged[id]; hops--) id = world.merged[id];
      if (threadIds.has(id)) { thoughts++; threads.add(id); }
    }
    return { thoughts, threads: threads.size };
  }, [world.thoughts, world.threads, world.merged]);
  const [stopMic, setStopMic] = useState<(() => void) | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => () => { stopMic?.(); }, [stopMic]);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [view, setView] = useState<"map" | "palace">("map");
  const reveal = useFindJump(core.found, world, { setView, setQuery, setFocusMode, setExpanded });
  const away = useAway(world, me, core.snapshotRevision > 0);
  const hasAway = away.items.length > 0;
  useEffect(() => { if (core.found) away.dismiss(); }, [core.found, away.dismiss]);
  // The "?" list of what you can say, opened by its button or by asking ("What can I say?"). It closes on your next
  // turn, Esc or a click outside it, never on a timer: what you say next is your own sign you're done reading.
  const [helpOpen, setHelpOpen] = useState(false);
  // Ahead of the view effect: a spoken turn's end and the list it asked for can arrive in one render.
  useEffect(() => { if (core.handoff) setHelpOpen(false); }, [core.handoff]);
  useEffect(() => {
    if (!helpOpen) return;
    const outside = (event: PointerEvent) => { if (!(event.target instanceof Element && event.target.closest(".shortcuts"))) setHelpOpen(false); };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [helpOpen]);
  // A view said aloud works as its button: Map or Palace, Focus on (with a thread to focus on), or off ("show all");
  // and the "?" list, on an empty map too, where "What can I say?" is most likely.
  useEffect(() => {
    if (!core.viewAsk) return;
    const asked = core.viewAsk.view;
    if (asked === "help") { setHelpOpen(true); return; }
    if (!world.threads.length) return;
    setView(asked === "palace" ? "palace" : "map");
    if (asked === "all" || (asked === "focus" && world.active)) {
      setFocusMode(asked === "focus");
      setQuery("");
    }
  }, [core.viewAsk]);
  const [startingMic, setStartingMic] = useState(false);
  const [firstHint, setFirstHint] = useState(false);
  const startedEmpty = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);
  const dockRef = useRef<HTMLElement>(null);
  const mapRef = useRef<HTMLElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const [noticeFocused, setNoticeFocused] = useState(false);
  const lastNavigation = useRef(0);
  const following = useRef(false);
  useEffect(() => {
    const navigate = () => { lastNavigation.current = Date.now(); };
    // A scroll is you moving around only just after you pressed something (a scrollbar, a key): the page also
    // scrolls on its own when a thread folds away and the page gets shorter, or a picture loads above, and that
    // held the next landing back for 5 s (rehearsal 3: a thought stayed under the composer for 6 s).
    let pressed = 0;
    let holding = false;
    const press = () => { pressed = Date.now(); };
    const down = () => { holding = true; press(); };
    const up = () => { holding = false; press(); };
    const scroll = () => { if (!following.current && (holding || Date.now() - pressed < 1000)) navigate(); };
    const key = (event: KeyboardEvent) => {
      press();
      // Keys typed into a field (a space in a thought, "j" in a search) aren't moving around the map.
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]")) return;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " ", "j", "k"].includes(event.key)) navigate();
    };
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    window.addEventListener("wheel", navigate, { passive: true });
    window.addEventListener("touchstart", navigate, { passive: true });
    window.addEventListener("touchmove", navigate, { passive: true });
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      window.removeEventListener("wheel", navigate);
      window.removeEventListener("touchstart", navigate);
      window.removeEventListener("touchmove", navigate);
      window.removeEventListener("keydown", key, true);
    };
  }, []);
  const seenThoughts = useRef<Set<string> | null>(null);
  const seenSnapshot = useRef(0);
  const seenActive = useRef<string | null>(null);
  // What the map shows next: the newest landing, or your own place when it moves without one ("where was I?").
  const followTarget = useRef<{ thread: string; thought?: string } | null>(null);
  // Your newest landing since the map last looked. The core sends a turn's changes one by one, so a new topic can
  // arrive as a landing and then your place moving to it.
  const followLanding = useRef<{ thread: string; thought: string } | null>(null);
  const followTimer = useRef<number | undefined>(undefined);
  const followFrame = useRef(0);
  // The landing the map last showed you, and when: the unfinished card keeps clear of it.
  const shownLanding = useRef<{ thought: string; at: number } | null>(null);
  // The map holds still while something else has your eyes: a search, or a panel, menu or dialog over it.
  const lookingElsewhere = () => document.activeElement === searchRef.current || !!searchRef.current?.value.trim() ||
    !!document.querySelector(".apps-panel.is-open, dialog[open], .room-menu[open], .shortcuts[open], .tour-tip, .explain");
  useEffect(() => () => { window.clearTimeout(followTimer.current); cancelAnimationFrame(followFrame.current); }, []);
  useEffect(() => {
    const placed = world.thoughts.filter((thought) => thought.placed);
    if (!core.snapshotRevision) return;
    let landing: { thread: string; thought: string; mine: boolean } | null = null;
    let moved = false;
    if (seenThoughts.current && seenSnapshot.current === core.snapshotRevision) {
      const added = placed.filter((thought) => !seenThoughts.current!.has(thought.id));
      if (added.length) {
        const thought = added[added.length - 1];
        const title = world.threads.find((thread) => thread.id === thought.thread_id)?.title;
        setAnnouncement(`${thought.speaker !== me && thought.speaker !== "you" ? `${thought.speaker}: ` : ""}${thought.point}${title ? ` — ${title}` : ""}`);
        if (thought.thread_id) landing = { thread: thought.thread_id, thought: thought.id, mine: thought.speaker === me };
      }
      moved = !!world.active && world.active !== seenActive.current;
    }
    seenThoughts.current = new Set(placed.map((thought) => thought.id));
    seenSnapshot.current = core.snapshotRevision;
    seenActive.current = world.active;
    // Where you are goes first: your thought landing on another thread means "…, where was I?" moved you on in the
    // same breath (your place can end where it started, so it doesn't count as moving).
    const elsewhere = !!world.active && (moved || (!!landing?.mine && landing.thread !== world.active));
    // A landing gets one chance to follow; never catch up later while someone is reading. In a room only your own
    // words move your view.
    const follow = elsewhere && landing?.thread !== world.active ? { thread: world.active! } : landing?.mine ? landing : null;
    if (!follow || view !== "map" || query.trim() || core.recap.view) return;
    followTarget.current = follow;
    if (landing?.mine) followLanding.current = landing;
    // One look once a turn's messages are in: when a thought lands and "Back to …" follows, the map goes back too.
    const look = () => {
      // A scroll the map is already making (the last landing's, or clearing the unfinished card) isn't interrupted:
      // the look waits for it to end, then runs. Dropping it left off screen a thought that landed as the card rose.
      if (following.current) { followFrame.current = requestAnimationFrame(look); return; }
      const target = followTarget.current;
      const landed = followLanding.current;
      followTarget.current = null;
      followLanding.current = null;
      if (!target || lookingElsewhere()) return;
      const card = document.getElementById(`thread-${target.thread}`);
      if (!card) return;
      const top = Math.max(0, ...Array.from(document.querySelectorAll("header, .map-tools"), (bar) => bar.getBoundingClientRect().bottom));
      const bottom = Math.min(window.innerHeight, dockRef.current?.getBoundingClientRect().top ?? window.innerHeight);
      if (bottom <= top) return;
      // Your words landing, also when your place moved with them to a new topic. Your place moving on its own
      // ("where was I?", "next one") is what you asked for, so it's never held back.
      const thought = target.thought ?? (landed?.thread === target.thread ? landed.thought : undefined);
      // Moving the map holds a landing back only when its thread's title and points are out of view: you went to
      // read elsewhere. A nudge or a key press that leaves them on screen doesn't. The 5 s is the old guess at
      // reading, kept until a rule without a timer replaces it.
      const own = ownRect(card);
      if (thought && Date.now() - lastNavigation.current < 5000 && (own.bottom <= top || own.top >= bottom)) return;
      // The thought itself (a thread's latest, when you moved back to it), where it will settle: a landing point
      // starts out where its pending pill was, in the dock.
      const point = thought ? document.getElementById(`point-${thought}`)
        : card.querySelector<HTMLElement>(":scope > div > .points > li:last-child");
      const rect = settledRect(point ?? card);
      shownLanding.current = thought && point ? { thought, at: Date.now() } : null;
      if (point ? rect.top >= top && rect.bottom <= bottom : rect.bottom > top && rect.top < bottom) return;
      const delta = point ? (rect.top + rect.bottom) / 2 - (top + bottom) / 2 : rect.top >= bottom ? rect.top - top - 12 : rect.bottom - bottom + 12;
      scrollForMap(following, delta, !!reducedMotion);
    };
    window.clearTimeout(followTimer.current);
    cancelAnimationFrame(followFrame.current);
    followTimer.current = window.setTimeout(() => { followFrame.current = requestAnimationFrame(look); }, 120);
  }, [world.thoughts, world.threads, world.active, core.snapshotRevision, me, view, query, core.recap.view, reducedMotion]);

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
  useHeightVar(dockRef, "--dock-height");
  // The map's tools stick right under the header, whatever height it wraps to, and a card brought to the top
  // (Back to active, Finish it, a Palace tile) stops under both.
  const headerRef = useRef<HTMLElement>(null);
  const toolsRef = useRef<HTMLElement>(null);
  useHeightVar(headerRef, "--header-height");
  useHeightVar(toolsRef, "--tools-height", world.threads.length > 0);

  useEffect(() => { if (!core.notice) setNoticeFocused(false); }, [core.notice]);
  // A new find result restarts the timeout even if its notice text is unchanged.
  useEffect(() => {
    // "Looking through your threads…" stays until its answer, which can take longer than this (find.rs PATIENCE).
    if (!core.notice || noticeFocused || core.notice === LOOKING || /MODEL_API_KEY|^(The mic|Microphone|Couldn't start the mic|Connection lost)/i.test(core.notice)) return;
    const timer = window.setTimeout(core.clearNotice, 5000);
    return () => window.clearTimeout(timer);
  }, [core.notice, core.found, core.clearNotice, noticeFocused]);

  // Stop local audio when the service reports a stop or the connection drops, and tell the core,
  // so the next tap starts a fresh session.
  const voiceStartedAt = useRef(0);
  const voiceErrorStartedAt = useRef(0);
  const voiceRevisions = useRef({ status: 0, error: 0 });
  voiceRevisions.current = { status: core.voiceStatusRevision, error: core.voiceErrorRevision };
  useEffect(() => {
    if (stopMic && ((!core.listening && core.voiceStatusRevision > voiceStartedAt.current) || core.voiceErrorRevision > voiceErrorStartedAt.current)) {
      stopMic();
      setStopMic(null);
      core.listen(false);
      core.showNotice(core.noKey ? core.keyNotice : "The mic stopped. Tap it to keep talking.");
    }
  }, [core.listening, core.voiceStatusRevision, core.voiceErrorRevision, stopMic]);

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
    // Without a key the core can't listen: say so, without asking the browser for the microphone first.
    if (core.noKey) {
      core.showNotice(core.keyNotice);
      return;
    }
    setStartingMic(true);
    try {
      const stopAudio = await startMic(core.sendAudio);
      let stopped = false;
      const stop = () => { if (!stopped) { stopped = true; stopAudio(); } };
      if (!mounted.current) { stop(); return; }
      voiceStartedAt.current = voiceRevisions.current.status;
      voiceErrorStartedAt.current = voiceRevisions.current.error;
      setStopMic(() => stop);
      if (!core.listen(true)) {
        stop();
        setStopMic(null);
        core.showNotice("Connection lost. Reconnect to use the microphone; you can still type below.");
      }
    } catch (err) {
      if (!mounted.current) return;
      core.listen(false);
      const denied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "PermissionDeniedError");
      core.showNotice(denied ? "Microphone access is off. Allow it in your browser settings, or type below." : `Couldn't start the mic. ${err instanceof Error ? err.message : "Try again."} You can type below.`);
    } finally {
      if (mounted.current) setStartingMic(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft.trim()) {
      setHelpOpen(false);
      if (!world.threads.length && !world.thoughts.length) startedEmpty.current = true;
      if (core.sendText(draft.trim())) setDraft("");
    }
  };

  // Your own thoughts on their way; in a room the other person's land on the map with their name.
  const pending = useMemo(() => world.thoughts.filter((t) => !t.placed && t.speaker === me), [world.thoughts, me]);
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
    if (!hasToured()) return;
    requestAnimationFrame(() => scrollCardToTop(target, true));
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
  const previousThoughtGroups = useRef(new Map<string, Thought[]>());
  const thoughtsByThread = useMemo(() => {
    const grouped = new Map<string, Thought[]>();
    for (const thought of world.thoughts) if (thought.placed && thought.thread_id) {
      const group = grouped.get(thought.thread_id) ?? [];
      group.push(thought);
      grouped.set(thought.thread_id, group);
    }
    // In the order they were said, not the order they arrived: an import adds its old points after the live ones.
    // A time well ahead of the clock (a sample map dated for the demo) counts as the earliest, as in the core;
    // an hour's grace keeps another laptop's clock a little behind from sending its newest point to the top.
    const limit = Date.now() + 60 * 60 * 1000;
    const said = (thought: Thought) => (thought.at_ms > limit ? 0 : thought.at_ms);
    for (const group of grouped.values()) group.sort((a, b) => said(a) - said(b));
    for (const [id, group] of grouped) {
      const previous = previousThoughtGroups.current.get(id);
      if (previous && previous.length === group.length && previous.every((thought, i) => thought === group[i])) grouped.set(id, previous);
    }
    previousThoughtGroups.current = grouped;
    return grouped;
  }, [world.thoughts]);
  // Keep fields separate so a query cannot match across two different pieces of text.
  const previousSearchIndex = useRef(new Map<string, { thread: Thread; thoughts: Thought[] | undefined; fields: string[] }>());
  const searchIndex = useMemo(() => {
    const next = new Map<string, { thread: Thread; thoughts: Thought[] | undefined; fields: string[] }>();
    const entries = world.threads.map((thread) => {
      const thoughts = thoughtsByThread.get(thread.id);
      const previous = previousSearchIndex.current.get(thread.id);
      const entry = previous?.thread === thread && previous.thoughts === thoughts ? previous : {
        thread, thoughts,
        fields: [thread.title, ...(thread.tags ?? []).map((tag) => tag.name), ...(thoughts ?? []).flatMap((thought) => [thought.text, thought.point])].map((text) => text.toLocaleLowerCase()),
      };
      next.set(thread.id, entry);
      return { id: thread.id, fields: entry.fields };
    });
    previousSearchIndex.current = next;
    return entries;
  }, [world.threads, thoughtsByThread]);
  const search = query.trim().toLocaleLowerCase();
  const matches = useMemo(() => new Set(search ? searchIndex.filter(({ fields }) => fields.some((text) => text.includes(search))).map(({ id }) => id) : []), [search, searchIndex]);
  const children = useMemo(() => {
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
    const grouped = new Map<string | null, Thread[]>();
    for (const thread of world.threads) {
      if (!visibleIds.has(thread.id)) continue;
      const parent = thread.parent_id && threadById.has(thread.parent_id) ? thread.parent_id : null;
      const group = grouped.get(parent) ?? [];
      group.push(thread);
      grouped.set(parent, group);
    }
    return grouped;
  }, [world.threads, world.active, threadById, search, matches, focusMode]);
  const ideasByThread = useMemo(() => groupItems(world.suggestions), [world.suggestions]);
  const actionsByThread = useMemo(() => groupItems(world.actions), [world.actions]);
  const on = useMemo(() => ({ setItem: core.setItem, approve: core.approve, tag: core.tag, correct: core.correct }), [core.setItem, core.approve, core.tag, core.correct]);

  const jumpToActive = () => {
    setQuery("");
    setFocusMode(false);
    if (world.active) requestAnimationFrame(() => {
      const card = document.getElementById(`thread-${world.active}`);
      if (card) scrollCardToTop(card, !!reducedMotion);
    });
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      const target = event.target as HTMLElement;
      if (event.key === "Escape" && document.querySelector(".shortcuts[open]")) {
        event.preventDefault();
        setHelpOpen(false);
        document.querySelector<HTMLElement>(".shortcuts summary")?.focus();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === "/") { away.dismiss(); event.preventDefault(); searchRef.current?.focus(); }
      if ((event.key === "j" || event.key === "k") && !event.repeat) {
        const buttons = Array.from(mapRef.current?.querySelectorAll<HTMLButtonElement>(".thread-toggle:not(:disabled)") ?? []);
        if (!buttons.length) return;
        away.dismiss();
        event.preventDefault();
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = index < 0 ? 0 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === "j" ? 1 : -1)));
        buttons[next].focus();
        buttons[next].scrollIntoView({ block: "nearest" });
      }
      if (event.key === "Escape") {
        if (hasAway) { away.dismiss(); return; }
        setExpanded(Object.fromEntries(world.threads.filter((thread) => !activePath.has(thread.id)).map((thread) => [thread.id, true])));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [world.threads, activePath, hasAway, away.dismiss]);

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
  const [mapAnnouncement, setMapAnnouncement] = useState("");
  useEffect(() => {
    if (!core.mapChange) return;
    setMapChangeVisible(true);
    setMapAnnouncement("");
    const announcement = window.setTimeout(() => setMapAnnouncement(core.mapChange!.text), 700);
    const timer = window.setTimeout(() => setMapChangeVisible(false), 10000);
    return () => { window.clearTimeout(announcement); window.clearTimeout(timer); };
  }, [core.mapChange]);

  // Pull-back: at a natural pause, offer the most recently dropped thread.
  const [lastActivity, setLastActivity] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [laterAt, setLaterAt] = useState<Record<string, number>>({});
  useEffect(() => setLastActivity(Date.now()), [core.partial, world.thoughts.length]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 400);
    return () => window.clearInterval(timer);
  }, []);
  const dropKey = (t: Thread) => `${t.id}:${t.touched_ms}`;
  // Once the return card covers an unfinished thread, don't repeat it in the pull-back.
  useEffect(() => {
    const covered = away.items.filter((item) => item.unfinished)
      .flatMap((item) => world.threads.filter((t) => t.id === item.threadId && t.dropped_by === me).map(dropKey));
    if (covered.length) setDismissed((previous) => covered.every((key) => previous.includes(key)) ? previous : [...new Set([...previous, ...covered])]);
  }, [away.items, world.threads, me]);
  // Only threads you left: in a room, the other person's are theirs to pick up.
  const dropped = world.threads
    .filter((t) => t.status === "dropped" && t.dropped_by === me && !dismissed.includes(dropKey(t)) &&
      (laterAt[dropKey(t)] === undefined || now - laterAt[dropKey(t)] >= 5 * 60 * 1000))
    .sort((a, b) => b.touched_ms - a.touched_ms)[0];
  const pullBack = dropped && now - lastActivity > 2500 ? dropped : null;
  // The card grows the dock upward as it rises; the thought the map just showed you moves clear of it, once. Under
  // 10 s: in a talk paced like the demo's (a turn every 6 s, landing 2–4 s after its words, the card after 2.5 s of
  // quiet) the newest landing is younger than that when the card rises. Not once you've moved the map yourself.
  const pullKey = !hasAway && pullBack ? dropKey(pullBack) : "";
  useEffect(() => {
    if (!pullKey || view !== "map") return;
    let frame = 0;
    const keepClear = () => {
      const shown = shownLanding.current;
      if (!shown || Date.now() - shown.at > 10000 || lastNavigation.current > shown.at || lookingElsewhere()) return;
      // After the map's own scroll, when the card rises while it still runs.
      if (following.current) { frame = requestAnimationFrame(keepClear); return; }
      const point = document.getElementById(`point-${shown.thought}`);
      const dockTop = dockRef.current?.getBoundingClientRect().top;
      if (!point || dockTop === undefined) return;
      const rect = settledRect(point);
      // The 12 px the follow leaves between a card and the dock.
      const overlap = rect.bottom + 12 - dockTop;
      if (overlap > 0 && rect.top < window.innerHeight) scrollForMap(following, overlap, !!reducedMotion);
    };
    // The map's end has already grown with the dock: its height is published as the card renders (useHeightVar).
    keepClear();
    return () => cancelAnimationFrame(frame);
  }, [pullKey, view, reducedMotion]);
  // Your last words there by when you said them, as the core's Thought::said_at: imported points land last in
  // the list with their old times, and a time ahead of the clock (a sample map) counts as the earliest.
  const saidAt = (t: Thought) => (t.at_ms > now ? 0 : t.at_ms);
  const lastWords = pullBack
    ? world.thoughts.filter((t) => t.placed && t.thread_id === pullBack.id && t.speaker === me)
      .reduce<Thought | undefined>((last, t) => (!last || saidAt(t) >= saidAt(last) ? t : last), undefined)?.text ?? ""
    : "";

  const goBack = (thread: Thread) => {
    setView("map");
    setExpanded((state) => {
      const next = { ...state };
      let current: Thread | undefined = thread;
      const visited = new Set<string>();
      while (current && !visited.has(current.id)) {
        visited.add(current.id);
        next[current.id] = false;
        current = current.parent_id ? threadById.get(current.parent_id) : undefined;
      }
      return next;
    });
    setQuery("");
    setFocusMode(false);
    core.focus(thread.id);
    setDismissed((d) => [...d, dropKey(thread)]);
    requestAnimationFrame(() => {
      const target = document.getElementById(`thread-${thread.id}`);
      if (target) scrollCardToTop(target, !!reducedMotion);
      target?.querySelector<HTMLButtonElement>(".thread-toggle")?.focus({ preventScroll: true });
    });
  };

  const friendlyNotice = core.notice && (
    !core.keyRefused && core.notice.includes("MODEL_API_KEY") ? "No AI key: you can browse the map, but new thoughts and listening need MODEL_API_KEY in .env (see .env.example)."
    : core.notice.startsWith("Couldn't place a thought:") ? "Couldn't place a thought. It's saved and will retry automatically."
    : core.notice.startsWith("Voice Transcribe:") ? "The voice service reported a problem. You can type below or try the microphone again."
    : core.notice.startsWith("Speech service error:") ? "The voice service stopped. You can type below; check your connection and try the microphone again."
    : core.notice
  );

  return (
    <MotionConfig reducedMotion="user">
    <div className="app" onClickCapture={(event) => {
      const target = event.target as HTMLElement;
      if (hasAway && !target.closest(".away") && target.closest("button, a, summary")) away.dismiss();
    }} onChangeCapture={() => { if (hasAway) away.dismiss(); }}>
      <header ref={headerRef}>
        <div className="brand">
          E2A2O <small>threads</small>
          {sessionCounts.thoughts > 0 && <span className="session-count">This session · {sessionCounts.thoughts} {sessionCounts.thoughts === 1 ? "thought" : "thoughts"} · {sessionCounts.threads} {sessionCounts.threads === 1 ? "thread" : "threads"}</span>}
        </div>
        <div className="header-actions">
        <RoomControl speakers={world.thoughts.map((thought) => thought.speaker)} />
        {/* What you can say comes first: asking for this list by voice is how most people open it. */}
        <details className="shortcuts" open={helpOpen} onToggle={(event) => setHelpOpen(event.currentTarget.open)}><summary aria-label="Voice and keyboard commands">?</summary><div className="keyboard-hint">
          <strong>Say or type</strong>
          <div>“What can I say?” · opens this list</div>
          <div>“Where was I?” or “Go back” · return to where you left off</div>
          <div>“Next one” or “Last one” · the thread after or before yours in creation order, wrapping around</div>
          <div>These three also work at the end of a sentence: “…due Friday, where was I?” keeps your words</div>
          <div>“New thread” or “Create a new one” · your next thought starts one</div>
          <div>“Palace” or “Map” · switch the view, as the buttons do · “Focus” or “Show all” · turn Focus on or off</div>
          <div>“Where did I talk about [topic]?” or “Go to the one about [topic]” · “Recap” or “Recap this session” · “Make an app that…”</div>
          <strong>Keyboard</strong>
          <div>Map: / search · j / k move between threads · Enter show or hide · Esc fold quiet threads</div>
          <div>Palace: arrow keys move · Enter open a thread</div>
          <div>Esc clears search or closes the room menu when focused there</div>
          <div>Select map text with Shift + arrows, then Enter to explain · Esc dismisses it</div>
          <strong>On the map</strong>
          <div>✦ added or suggested by AI</div>
        </div></details>
        <button className="recap-button" onClick={(event) => { event.currentTarget.focus(); core.requestRecap(); }}>Recap</button>
        <ImportChats core={core} />
        <div className="status">
          <span className={!core.connected ? "dot" : core.noKey ? "dot warn" : "dot ok"} role="img" aria-label={!core.connected ? "Connecting" : core.listening ? "Listening" : core.noKey ? (core.keyRefused ? "AI key refused" : "No AI key") : "Ready"} />
          <span aria-hidden="true">{!core.connected ? "Connecting…" : core.listening ? "Listening" : core.noKey ? (core.keyRefused ? "AI key refused" : "No AI key") : "Ready"}</span>
          {RECORDING && <TakeClock running={core.listening || !!core.partial || pending.length > 0} />}
        </div>
        </div>
      </header>

      <div className="sr-only" role="status">{friendlyNotice}</div>
      <div className="sr-only" role="status">{mapAnnouncement}</div>
      <AnimatePresence>
        {core.notice && (
          <motion.div
            className="notice"
            onFocus={() => setNoticeFocused(true)}
            onBlur={() => setNoticeFocused(false)}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <span>{friendlyNotice}</span>
            <button onClick={core.clearNotice} aria-label="Dismiss notice">×</button>
          </motion.div>
        )}
      </AnimatePresence>

      {core.mapChange && mapChangeVisible && (
        <div className="map-change"><span aria-hidden="true">✦</span> {core.mapChange.text}<button onClick={() => setMapChangeVisible(false)} aria-label="Dismiss map update">×</button></div>
      )}

      <Explain explanations={core.explanations} explain={core.explain} />

      <div id="tour-tools" />
      <Apps core={core} />
      <div id="tour-map" />
      {world.threads.length > 0 && <nav ref={toolsRef} className="map-tools" aria-label="Map navigation">
        <div className="map-tools-inner">
          <div className="palace-switch" role="group" aria-label="View">
            <button aria-pressed={view === "map"} onClick={() => setView("map")}>Map</button>
            <button aria-pressed={view === "palace"} onClick={() => setView("palace")}>Palace</button>
          </div>
          {view === "map" && <><label className="search"><span className="sr-only">Search threads</span><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setQuery(""); event.currentTarget.blur(); } }} placeholder="Search threads" type="search" /></label>
          {/* With one thread, Focus and Back to active would show the screen you already have. Focus keeps its name
              while on: pressed is its state, as a toggle button's is. */}
          {world.threads.length > 1 && <button aria-pressed={focusMode} onClick={() => { setFocusMode((value) => !value); setQuery(""); }} disabled={!world.active}>Focus</button>}
          {world.threads.length > 1 && world.active && <button className="back-to-active" onClick={jumpToActive}>Back to active</button>}
          </>}
        </div>
        {view === "map" && search && <div className="search-summary" role="status">{matches.size} {matches.size === 1 ? "thread" : "threads"} found <button onClick={() => setQuery("")}>Clear</button></div>}
      </nav>}
      {view === "palace" && world.threads.length > 0 ? <Palace threads={world.threads} active={world.active} onOpen={goBack} /> : <main ref={mapRef} className="map" aria-label="Thread map">
        {world.threads.length === 0 ? (
          <div className="empty">
            <h1>Think out loud.</h1>
            <p>{startingMic ? "Starting the microphone…" : core.listening ? "Listening. Say what's on your mind." : pending.length ? (core.noKey ? "Saved. Thoughts find their place once the AI key works." : "Finding a place for your thought…") : "Start with whatever is on your mind."}</p>
            {!core.listening && !pending.length && <p className="empty-hint">Tap the mic to talk, or type below and press Enter.</p>}
          </div>
        ) : (
          <MapCards active={world.active} activePath={activePath} childrenByParent={children} thoughtsByThread={thoughtsByThread} ideasByThread={ideasByThread} actionsByThread={actionsByThread} matches={matches} searching={!!search} expanded={expanded} setExpanded={setExpanded} on={on} />
        )}
      </main>}

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
      <section ref={dockRef} className="dock" aria-label="Your thoughts">
        <div className="dock-inner">
          <div className="sr-only" role="status" aria-live="polite">{hasAway ? "While you were away. Your thoughts are ready to explore above the composer." : ""}</div>
          <Away items={away.items} onDismiss={away.dismiss} onDismissFocus={() => composerRef.current?.focus({ preventScroll: true })} onFollow={(item) => {
            core.focus(item.threadId);
            reveal(item.threadId, item.thoughtId ?? null, item.itemId);
            away.dismiss();
          }} />
          <AnimatePresence>
            {!hasAway && pullBack && (
              <motion.div
                key={dropKey(pullBack)}
                className="pullback" role="status"
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8 }}
                transition={spring}
              >
                <ThreadPicture thread={pullBack} />
                <div className="pullback-text">
                  <div className="pullback-title">
                    You didn't finish <b>{pullBack.title}</b>
                  </div>
                  {lastWords && <div className="pullback-quote">“{lastWords}”</div>}
                </div>
                <div className="pullback-actions">
                  <button onClick={() => goBack(pullBack)}>Finish it</button>
                  <button className="quiet" onClick={() => {
                    const key = dropKey(pullBack);
                    if (laterAt[key] !== undefined) setDismissed((d) => [...d, key]);
                    else setLaterAt((previous) => ({ ...previous, [key]: Date.now() }));
                  }}>
                    Later
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {core.queuedCount > 0 && <div className="first-hint" role="status">{core.queuedCount} {core.queuedCount === 1 ? "thought" : "thoughts"} waiting to send when connected.</div>}
          {firstHint && !core.partial && <div className="first-hint">Your thought found a thread. Keep going, or try another topic.</div>}
          {(core.partial || core.handoff || (!pending.length && (core.listening || startingMic))) && <div className={core.partial || core.handoff ? "live words" : "live"}>{core.partial || core.handoff || (startingMic ? "Starting the microphone…" : "Listening…")}</div>}
          <div className="pending">
            {pending.map((t) => (
              <PendingThought key={t.id} thought={t} noKey={core.noKey} refused={core.keyRefused} reducedMotion={!!reducedMotion} />
            ))}
          </div>
          <div id="tour-composer" />
          <form className="composer" onSubmit={submit}>
            <input
              ref={composerRef}
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
      {core.snapshotRevision > 0 && <Tour populated={world.threads.length > 0} noKey={core.noKey} />}
      {LevelMeter && <Suspense fallback={null}><LevelMeter apps={world.apps} /></Suspense>}
      <Recap view={core.recap.view} world={world} connected={core.connected} noKey={core.noKey} listening={core.listening} onRequest={core.requestRecap} onClose={core.recap.close} onFocus={(id) => {
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

/** Where an element sits in the viewport once the map's motion settles: layout animations move things with
 *  transforms (a landing point starts where its pending pill was), and offsets leave transforms out. */
function settledRect(element: HTMLElement) {
  let y = 0;
  for (let at: HTMLElement | null = element; at; at = at.offsetParent as HTMLElement | null) y += at.offsetTop;
  return { top: y - window.scrollY, bottom: y - window.scrollY + element.offsetHeight };
}

/** Brings a card to the top of the map, its scroll margin under the header and tools, aiming at where it will
 *  settle: it can still be sliding into place when this runs, and scrollIntoView aimed at where it was. A card
 *  opened from a Palace tile mounts 8 px low and stopped 4 px under the tools, not 12 (on first load too, with
 *  motion on); with motion on, Back to active from Focus stopped it 294 px down, still sliding to its place as the
 *  other cards came back. */
function scrollCardToTop(card: HTMLElement, instant: boolean) {
  const margin = parseFloat(getComputedStyle(card).scrollMarginTop) || 0;
  window.scrollBy({ top: settledRect(card).top - margin, behavior: instant ? "instant" : "smooth" });
}

/** A thread's own part of its card, its title and points: the card also holds its branches, below them. */
function ownRect(card: HTMLElement) {
  const rect = settledRect(card);
  const branches = card.querySelector<HTMLElement>(":scope > .branches");
  return branches ? { top: rect.top, bottom: settledRect(branches).top } : rect;
}

/** Scrolls the page for the map itself. That isn't you moving around, until it ends: smooth scrolling can outlast a
 *  fixed second when frames are slow, and a late scroll event then held the next landing back for 5 s. */
function scrollForMap(following: { current: boolean }, top: number, instant: boolean) {
  // A scroll that can't move (the page's end, under a pixel) sends no scrollend, and a landing waiting for the map's
  // scroll to end would wait out the cap.
  const end = document.documentElement.scrollHeight - window.innerHeight;
  if (Math.abs(Math.min(Math.max(window.scrollY + top, 0), end) - window.scrollY) < 1) return;
  following.current = true;
  const ends = "onscrollend" in document;
  const done = () => { following.current = false; document.removeEventListener("scrollend", done); window.clearTimeout(cap); };
  const cap = window.setTimeout(done, ends ? 2000 : instant ? 100 : 1000);
  if (ends) document.addEventListener("scrollend", done);
  window.scrollBy({ top, behavior: instant ? "instant" : "smooth" });
}

/** Publishes an element's height as a CSS variable while it's on the page, so styles use what is measured: on any
 *  resize, and at once after each render, since a scroll can read it in the next frame, before the resize is
 *  observed (a Palace tile opens the map, whose tools are three rows on a phone, not one). */
function useHeightVar(ref: RefObject<HTMLElement | null>, name: string, present = true) {
  const publish = (element: HTMLElement) => {
    const height = `${element.offsetHeight}px`;
    if (document.documentElement.style.getPropertyValue(name) !== height) document.documentElement.style.setProperty(name, height);
  };
  useLayoutEffect(() => { if (ref.current) publish(ref.current); });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => publish(element));
    observer.observe(element);
    return () => { observer.disconnect(); document.documentElement.style.removeProperty(name); };
  }, [present]);
}

function groupItems<T extends { thread_id: string; status: ItemStatus }>(items: T[]) {
  const grouped = new Map<string, T[]>();
  for (const item of items) if (item.status !== "dismissed") {
    const group = grouped.get(item.thread_id) ?? [];
    group.push(item);
    grouped.set(item.thread_id, group);
  }
  return grouped;
}

type MapProps = {
  active: string | null; on: Handlers; activePath: Set<string>;
  childrenByParent: Map<string | null, Thread[]>; thoughtsByThread: Map<string, Thought[]>;
  ideasByThread: Map<string, Suggestion[]>; actionsByThread: Map<string, Action[]>;
  matches: Set<string>; searching: boolean; expanded: Record<string, boolean>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
};

// The composer, live transcript and pull-back timer update independently of the map.
const MapCards = memo(function MapCards(props: MapProps) {
  const roots = props.childrenByParent.get(null) ?? [];
  return roots.length === 0 ? <p className="no-results">No threads match. Try another search.</p>
    : roots.map((thread) => <ThreadCard key={thread.id} thread={thread} {...props} />);
});

function ThreadCard({ thread, active, on, activePath, childrenByParent, thoughtsByThread, ideasByThread, actionsByThread, matches, searching, expanded, setExpanded, depth = 2 }: MapProps & { thread: Thread; depth?: number }) {
  const reducedMotion = useReducedMotion();
  const thoughts = thoughtsByThread.get(thread.id) ?? [];
  const ideas = ideasByThread.get(thread.id) ?? [];
  const actions = actionsByThread.get(thread.id) ?? [];
  const branches = childrenByParent.get(thread.id) ?? [];
  const isActive = active === thread.id;
  const collapsed = searching && matches.has(thread.id) ? false : expanded[thread.id] ?? !activePath.has(thread.id);
  // Your own unfinished thread is flagged; someone else's tag just says whose it is.
  const me = useMe();
  const by = thread.status === "dropped" ? leftBy(thread, me) : "";
  const classes = ["thread", isActive ? "active" : "", collapsed ? "collapsed" : "", thread.status === "dropped" && thread.dropped_by === me ? "dropped" : ""].join(" ");

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
        <ThreadPicture thread={thread} marked />
        <div className="head-text">
          <div className="head-line">
            <div className="title" id={`title-${thread.id}`} role="heading" aria-level={Math.min(depth, 6)}>{thread.title}</div>
            {thread.status === "dropped" && <span className="chip dropped">{by ? `${by} left off` : "left off"}</span>}
            {isActive && <span className="chip now">active</span>}
            <span className="thread-count">{thoughts.length} {thoughts.length === 1 ? "thought" : "thoughts"}</span>
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
                  title={t.kept ? "Remove tag" : "Keep this tag"}
                  onClick={() => on.tag(thread.id, t.name, !t.kept)}
                >
                  {!t.kept && <span aria-hidden="true">✦ </span>}{t.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="collapse thread-toggle" aria-expanded={!collapsed} aria-disabled={searching && matches.has(thread.id)} onClick={() => { if (!(searching && matches.has(thread.id))) setExpanded((state) => ({ ...state, [thread.id]: !collapsed })); }}>{collapsed ? "Show" : "Hide"} <span className="sr-only">{thread.title}</span></button>
      </div>
      <AnimatePresence initial={false}>
      {!collapsed && <motion.div key="body" initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.15 }}>
      <ul className="points">
        {thoughts.map((t) => (
          <Point key={t.id} thought={t} on={on} layoutDependency={thoughts} />
        ))}
      </ul>
      {ideas.map((s) => (
        <motion.div key={s.id} id={`item-${s.id}`} layout className={`ai ${s.status}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
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
            <ThreadCard key={b.id} thread={b} active={active} on={on} activePath={activePath} childrenByParent={childrenByParent} thoughtsByThread={thoughtsByThread} ideasByThread={ideasByThread} actionsByThread={actionsByThread} matches={matches} searching={searching} expanded={expanded} setExpanded={setExpanded} depth={depth + 1} />
          ))}
        </div>
      )}
    </motion.section>
  );
}

/** A thread's picture slot, there from the start with the thread's first letter (as in the Palace): a picture that
 *  arrives later fades in over it and moves nothing. A card used to grow 5–19 px when its picture came, its title
 *  sliding right. ✦ marks a picture only once one shows. */
function ThreadPicture({ thread, marked = false }: { thread: Thread; marked?: boolean }) {
  const [loaded, setLoaded] = useState<string | null>(null);
  const shown = !!thread.picture && loaded === thread.picture;
  return (
    <span className="picture-wrap">
      <span className="picture picture-letter" aria-hidden="true">{firstLetter(thread.title)}</span>
      {thread.picture && <img key={thread.picture} className={shown ? "picture is-shown" : "picture"} src={thread.picture} alt="" onLoad={() => setLoaded(thread.picture)} />}
      {marked && shown && <span className="picture-mark" role="img" aria-label="AI-generated picture">✦</span>}
    </span>
  );
}

const Point = memo(function Point({ thought, on, layoutDependency }: { thought: Thought; on: Handlers; layoutDependency: Thought[] }) {
  // Your own thoughts need no name; anyone else's (a person in the room, or Claude) shows who said it.
  const me = useMe();
  const other = thought.speaker !== me && thought.speaker !== "you";
  const reducedMotion = useReducedMotion();
  return (
    <motion.li id={`point-${thought.id}`} layoutDependency={layoutDependency} layout={reducedMotion ? false : true} layoutId={reducedMotion ? undefined : thought.id} transition={spring} title={thought.text} className={other ? "other" : undefined} tabIndex={thought.place_ms != null ? 0 : undefined}>
      {other && <span className="speaker">{thought.speaker}</span>}
      {/* Every point is a short version of the person's own words, so it stays unmarked: ✦ is for what the AI adds or proposes. */}
      <span>{capitalized(thought.point)}</span>
      {thought.heard && thought.fixed && (
        // Fixed without asking: quiet until you look, and one tap puts the words back.
        <button className="fixed" onClick={() => on.correct(thought.id, false)} aria-label={`Undo fix: heard “${thought.heard}”`}>
          <span><span aria-hidden="true">✦</span> fixed</span>
          <span><span aria-hidden="true">✦</span> heard “{thought.heard}” · undo</span>
        </button>
      )}
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
      {thought.place_ms != null && <><span className="speed" aria-hidden="true">{(thought.place_ms / 1000).toFixed(1)} s</span><span className="sr-only">Placed in {(thought.place_ms / 1000).toFixed(1)} seconds</span></>}
    </motion.li>
  );
});

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
  return (
    <motion.div id={`item-${action.id}`} layout className={`action ${action.status}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
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
      {action.status === "kept" && <span className="when ai-actions">Adding to {app}…</span>}
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

function PendingThought({ thought, noKey, refused, reducedMotion }: { thought: Thought; noKey: boolean; refused: boolean; reducedMotion: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (noKey) return;
    const started = Date.now();
    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
      interval = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    }, 6000);
    return () => { window.clearTimeout(timeout); window.clearInterval(interval); };
  }, [noKey]);
  return <motion.span layoutId={reducedMotion ? undefined : thought.id} initial={false} className="pill">
    <span className="pending-label">{refused ? "Waiting for a working key" : noKey ? "Needs the AI key" : `Finding a thread${elapsed > 5 ? ` · ${elapsed}s` : ""}`}</span> {thought.text}
  </motion.span>;
}

// A recording's clock: it starts with the first word heard or typed and never stops, so a cut would show as a jump.
function TakeClock({ running }: { running: boolean }) {
  const [start, setStart] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (running && start == null) setStart(Date.now());
  }, [running, start]);
  useEffect(() => {
    if (start == null) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [start]);
  const seconds = start == null ? 0 : Math.max(0, Math.floor((now - start) / 1000));
  return <span className="take-clock" aria-hidden="true">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>;
}
