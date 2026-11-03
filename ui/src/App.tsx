import { SpeechFixesContext } from "./bricks/contract";
import { switchTalk, useTalk } from "./talk-preset";
import "./talk-preset.css";
import { useCardNotice } from "./notice-queue";
import { memo, useContext, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";
import { capitalized, firstLetter, LOOKING, useCore, type Action, type ItemStatus, jumpTracker, landingToFollow, pendingLabel, statusLine, aboutKey, type Landing, type Placing, type Suggestion, type Thread, type Thought, type ViewAsk } from "./core";
import { download, exportedNotice, mapMarkdown } from "./export-md";
import { ImportChats } from "./Import";
import { StayHere, StayProvider } from "./StayHere";
import { Away, useAway } from "./Away";
import { usePicture } from "./pictures";
import { actionLine, dismissable } from "./action-line";

type Handlers = {
  setItem: (id: string, status: ItemStatus) => void;
  approve: (id: string) => void;
  tag: (threadId: string, tag: string, keep: boolean) => void;
  correct: (thoughtId: string, accept: boolean) => void;
  unlink: (thoughtId: string) => void;
};
import { micFailure, micPlace, startMic, watchMicPermission } from "./mic";
import { Apps, buildInTheWay, DockBuild, DockTune } from "./Apps";
import { Explain } from "./Explain";
import { Palace } from "./Palace";
import { Recap } from "./Recap";
import { hasToured, Tour } from "./Tour";
import { leftBy, RoomControl, useMe } from "./room";
import { roomColors, roomStyle } from "./rooms";
import { useFindJump, viewAfterJump } from "./find";
import { landedNow } from "./landed";
import { resolveMerged } from "./merges";
import { UndoButton } from "./Undo";
import { ProposalRows, TidyProvider, useWaitingProposals } from "./Tidy";
import { MovePoint, MovesProvider, ThreadTitle, useDropPoint } from "./Moves";
import { useRevert } from "./revert";
import { ideaCounts, NotesContext, PointNote, useIdeas, useNote, wordsSaid } from "./chunks";
import { hoverTitle, WhyContext, WhyHere, whyLine } from "./whyhere";
import { ARRIVE, AttentionNote, AttentionProvider, look, ThisEcho, wordsIn, ThisTag, UnseenDot, useAttention, usePointMarks } from "./Attention";
import { intoColumns, POINT_OWN, saidDiffers, useSaidOpen, useTalking, useTwoColumns } from "./legible";
import { isUndoKey, micNotice, micStopped, staysUp, undoKeyGoesTo, undoKeyLabel, undoUpFor, upFor } from "./notice-rules";

/** ⌘ or Ctrl: which one Undo uses here. */
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
import { emptyLine, headClickToggles, liveLine, showsLiveLine } from "./ux-rules";
import { heldOpen, mapQuery, RANK_LIMIT, sameCard, searchFields, searchMatches, steady } from "./search-rules";
import { composerHint, MIC_OFFLINE, MicButton, micEnds, micState } from "./MicButton";
import { Symbols } from "./Symbols";
import { useOnScreen } from "./onscreen";
import { downloadIcs, keyWords, modelsLine, moreSamples, useSite } from "./site";
import { ModelLine } from "./ModelLine";
import { useLanes, useRouteMark } from "./route";
const ROUTE_CLASS = { candidate: "route-candidate", here: "route-here", via: "route-via" } as const;
import "./route.css";
import { Tips, TIPS } from "./Tips";
import { InstallHint, useInstallHint } from "./Install";
import { COMPOSER_ID, opensHelp, togglesPoint } from "./keys";
import { cardAt, dismiss, dropKey, lastWords as lastWordsOn, leftOff, lingerMs as unfinishedLingerMs, putOff, useHidden } from "./unfinished";
import { SendCard } from "./SendCard";
import { PullsCard } from "./PullsCard";
import { NoteCard } from "./NoteCard";
import { BRICKS, closeCatalog, isCore, isOn, openCatalogAt, switchBrick, useBricksOn, useCatalogAt, useCatalogOpen } from "./bricks-core";
import { BrickMount, BrickSlot, useBrickHost } from "./BrickSlot";
import type { ViewDestination } from "./bricks/contract";
import { Catalog } from "./Catalog";
import { Guide } from "./Guide";
import { showHint } from "./guide-core";
import { Markdown } from "./md";
import { CARDS_FLAG, DEMO, SAMPLE_FLAG, SHELL2 } from "./shell/flag";
import { useShellCountdownPlacement } from "./shell/countdown";
import { BUILT_INS, switchBuiltIn, useBuiltInsOn } from "./shell/features";
import { useHistory, type Entry } from "./shell/history";
import { FEATURE_NAMES, NAMES } from "./shell/names";
import { Icon, Keycap, mod, modAria, type Mode } from "./shell/parts";
import { CatalogTab, CornerButton, Find, HistoryTab, HeldStack, Rail, RAIL_KEYS, SettingsTab, StatusLine, TalkTurns, TopLeft, TopRight, Welcome, type CatalogRow, type RailTab } from "./shell/Shell";
import { useHeld, dropHeld } from "./shell/held";
import { usePhone } from "./shell/usePhone";
import "./shell/shell.css";
import { TalkRail } from "./talk/TalkRail";
import { inCall as callOn, peopleHere, useCall } from "./talk/call-core";

const spring = { type: "spring", stiffness: 220, damping: 28 } as const;
const RECORDING = typeof location !== "undefined" && new URLSearchParams(location.search).has("recording");
/** This tab loaded the sample map (the new shell stamps it SAMPLE). */
const SAMPLE_KEY = "e2a2o.sampleMap";
function readSession(key: string) { try { return sessionStorage.getItem(key) === "1"; } catch { return false; } }
function writeSession(key: string, on: boolean) { try { if (on) sessionStorage.setItem(key, "1"); else sessionStorage.removeItem(key); } catch { /* private mode */ } }

export default function App() {
  const me = useMe();
  const core = useCore(me);
  const site = useSite();
  const reducedMotion = useReducedMotion();
  const phone = usePhone();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Threads opened with all their branches ("expand …", Option-click): they stay open as you move about the map,
  // where a card you opened with a plain click folds again once you've been there and left.
  const keptOpen = useRef(new Set<string>());
  const world = useMemo(() => ({ ...core.world, active: core.world.active_by[me] ?? core.world.active }), [core.world, me]);
  const sessionCounts = useMemo(() => {
    const times = world.thoughts.map((thought) => thought.at_ms).filter((time) => time <= Date.now()).sort((a, b) => a - b);
    let start = times.at(-1) ?? 0;
    for (let i = times.length - 1; i > 0 && times[i] - times[i - 1] < 30 * 60 * 1000; i--) start = times[i - 1];
    // Ideas, as the cards count them, and as Recap does.
    return ideaCounts(world, start, Date.now());
  }, [world.thoughts, world.threads, world.merged, world.notes]);
  const [stopMic, setStopMic] = useState<(() => void) | null>(null);
  const micStart = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; micStart.current?.abort(); }; }, []);
  useEffect(() => () => { stopMic?.(); }, [stopMic]);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const talk = useTalk();
  useEffect(() => {
    if (talk) core.showNotice("Talk is on. Say or type “all features” to go back.");
  }, [talk]);
  const [focusMode, setFocusMode] = useState(false);
  // "map", "palace", "cards" (the shell's: the Catalog's built-in view), or the id of a view brick that's on
  // (bricks-core.ts): its name joins the Map and Palace switch.
  const home = !SHELL2 && !CARDS_FLAG && isOn("spine") ? "spine" : "map";
  const [view, setView] = useState<string>(home);
  const [destination, setDestination] = useState<ViewDestination | null>(null);
  const reveal = useFindJump(core.found, world, { setView, setQuery, setFocusMode, setExpanded, setDestination }, home);
  // Find's answers and Away's rows show their own point: the move they make isn't followed to the newest one.
  const jumps = useRef(jumpTracker()).current;
  const worldNow = useRef(world);
  worldNow.current = world;
  useEffect(() => { if (core.found) jumps.jumped(worldNow.current, core.found.thread_id); }, [core.found, jumps]);
  const attention = useAttention({ world, revision: core.snapshotRevision, me, view, covered: !!core.recap.view, words: core.partial || core.handoff || "", reveal, attending: core.attending, correctable: core.correctable });
  const away = useAway(world, me, core.snapshotRevision > 0);
  const hasAway = away.items.length > 0;
  useEffect(() => { if (core.found) away.dismiss(); }, [core.found, away.dismiss]);
  // The "?" list of what you can say, opened by its button or by asking ("What can I say?"). It closes on your next
  // turn, Esc or a click outside it, never on a timer: what you say next is your own sign you're done reading.
  const [helpOpen, setHelpOpen] = useState(false);
  // On a phone the "?" sits mid-header: the list shifts into view rather than run past an edge (onscreen.ts).
  const helpList = useRef<HTMLDivElement>(null);
  useOnScreen(helpList);
  // Ahead of the view effect: a spoken turn's end and the list it asked for can arrive in one render.
  useEffect(() => { if (core.handoff) setHelpOpen(false); }, [core.handoff]);
  useEffect(() => {
    if (!helpOpen) return;
    const outside = (event: PointerEvent) => { if (!(event.target instanceof Element && event.target.closest(".shortcuts"))) setHelpOpen(false); };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [helpOpen]);
  // The map keeps its place while you look at the Palace, as a tab does: Map (the button or "map") brings you back
  // where you were. Opening a thread from the Palace, a search or "where was I?" goes to that thread instead.
  const mapScroll = useRef<number | null>(null);
  // With the room the page's end left for the dock then (useDockRoom): a dock card that went while the map was at its
  // end left its room, which the Palace's own top gives back, so the map came back on a shorter page, 74 px down.
  const mapRoom = useRef(0);
  const restoreMap = useRef(false);
  // Leaving the map keeps its place; coming back to it, from the Palace or a view brick, puts it back.
  const showView = (next: string) => {
    if (next === view) return;
    setDestination(null);
    if (view === "map") {
      mapScroll.current = window.scrollY;
      mapRoom.current = dockRoom.now();
    }
    if (next === "map") restoreMap.current = true;
    setView(next);
  };
  // Export, or "export my map": the whole map as a Markdown file, made here from the map this window holds (export-md.ts).
  const exportMap = (asked?: ViewAsk | null) => {
    if (!world.threads.length && !world.thoughts.length) { core.showNotice("Nothing on the map yet to export.", asked); return; }
    const file = mapMarkdown(world);
    download(file);
    core.showNotice(exportedNotice(file), asked);
  };
  // "Scratch that" after a view or fold said aloud: what this window showed before it (revert.ts).
  const keepShown = useRevert(core.revertAsk, () => ({ view, focusMode, query, expanded, kept: [...keptOpen.current] }), (shown) => {
    showView(shown.view);
    setFocusMode(shown.focusMode);
    setQuery(shown.query);
    setExpanded(shown.expanded);
    keptOpen.current = new Set(shown.kept);
  });
  useLayoutEffect(() => {
    if (view !== "map" || !restoreMap.current) return;
    restoreMap.current = false;
    if (mapScroll.current === null) return;
    dockRoom.hold(mapRoom.current);
    window.scrollTo({ top: mapScroll.current, behavior: "instant" });
  }, [view]);
  // A view said aloud works as its button: Map or Palace, Focus on (with a thread to focus on), or off ("show all");
  // and the "?" list, on an empty map too, where "What can I say?" is most likely.
  useEffect(() => {
    if (!core.viewAsk) return;
    const asked = core.viewAsk.view;
    if (asked === "talk" || asked === "features") {
      switchTalk(asked === "talk");
      core.showNotice(asked === "talk" ? "Talk is on. Say or type “all features” to go back." : "Your features are back.", core.viewAsk);
      return;
    }
    // The unfinished card's buttons, the mic and the notices ("what just happened?"), said aloud: handled where those live.
    if (asked === "later" || asked === "forget" || asked === "finish" || asked === "pause" || asked === "notices") return;
    if (asked === "help") { setHelpOpen(true); return; }
    if (asked === "export") { exportMap(core.viewAsk); return; }
    keepShown();
    if (!world.threads.length) return;
    if (asked === "palace" || asked === "map") showView(asked);
    else if (asked === "cards") {
      // "Cards" is the list of topic cards: the Map view on the classic page, the Cards feature in the shell (when it is on).
      if (!SHELL2) showView("map");
      else if (builtIns.has("cards")) showView("cards");
      else core.showNotice("Cards is off: switch it on in Features.", core.viewAsk);
    } else setView((was) => viewAfterJump(was, "map"));
    if (asked === "all" || (asked === "focus" && world.active)) {
      setFocusMode(asked === "focus");
      setQuery("");
    }
  }, [core.viewAsk]);
  const [startingMic, setStartingMic] = useState(false);
  // The browser ("site") or the computer ("mac") keeps the mic from this page: it looks blocked until that changes
  // (mic.ts `micFailure`, `watchMicPermission`); a tap still tries, and says how to allow it.
  const [micBlocked, setMicBlocked] = useState<"" | "site" | "mac">("");
  const micBlockedNow = useRef(micBlocked);
  micBlockedNow.current = micBlocked;
  const [firstHint, setFirstHint] = useState(false);
  const startedEmpty = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // Typed in the composer since the last thought went: ⌘Z there then restores the typing, not the last turn.
  const typedSinceSend = useRef(false);
  const dockRef = useRef<HTMLElement>(null);
  const mapRef = useRef<HTMLElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const [railTab, setRailTab] = useState<RailTab | null>(null);
  const [noticeFocused, setNoticeFocused] = useState(false);
  // The pointer on the notice: on its way to Undo or ×, so the notice waits for it.
  const [noticeHeld, setNoticeHeld] = useState(false);
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
  // Every thought ever placed here: one an Undo brings back isn't a landing to follow (landed.ts).
  const everPlaced = useRef(new Set<string>());
  const seenSnapshot = useRef(0);
  const seenActive = useRef<string | null>(null);
  // What the map shows next: the newest landing, or your own place when it moves without one ("where was I?").
  const followTarget = useRef<{ thread: string; thought?: string } | null>(null);
  // Your newest landing since the map last looked. The core sends a turn's changes one by one, so a new topic can
  // arrive as a landing and then your place moving to it.
  const followLanding = useRef<{ thread: string; thought: string } | null>(null);
  // Your thoughts that failed a try, and a late landing held back (see `landingToFollow`).
  const retried = useRef(new Set<string>());
  const heldLanding = useRef<Landing | null>(null);
  useEffect(() => {
    for (const id of Object.keys(core.placing.retryAt)) retried.current.add(id);
  }, [core.placing]);
  const followTimer = useRef<number | undefined>(undefined);
  const followFrame = useRef(0);
  // The landing the map last showed you, and when: the unfinished card keeps clear of it.
  const shownLanding = useRef<{ thought: string; at: number } | null>(null);
  // The map holds still while something else has your eyes: a search, typing in the Apps panel, or a menu or dialog
  // over it. An Apps panel left open doesn't count: it stays open after Keep, and froze the map with no note.
  const lookingElsewhere = () => document.activeElement === searchRef.current || !!searchRef.current?.value.trim() ||
    !!document.querySelector(".apps-panel input:focus, dialog[open], .room-menu[open], .shortcuts[open], .tour-tip, .explain");
  useEffect(() => () => { window.clearTimeout(followTimer.current); cancelAnimationFrame(followFrame.current); }, []);
  useEffect(() => {
    const placed = world.thoughts.filter((thought) => thought.placed);
    if (!core.snapshotRevision) return;
    let landing: Landing | null = null;
    let moved = false;
    const held = heldLanding.current;
    heldLanding.current = null;
    if (seenThoughts.current && seenSnapshot.current === core.snapshotRevision) {
      const added = landedNow(placed, seenThoughts.current, everPlaced.current);
      moved = !!world.active && world.active !== seenActive.current;
      if (added.length) {
        const thought = added[added.length - 1];
        const title = world.threads.find((thread) => thread.id === thought.thread_id)?.title;
        setAnnouncement(`${thought.speaker !== me && thought.speaker !== "you" ? `${thought.speaker}: ` : ""}${thought.decided ? "Decided: " : ""}${thought.point}${title ? ` — ${title}` : ""}`);
      }
      ({ landing, held: heldLanding.current } = landingToFollow(world, added, me, moved, retried.current, held));
      // A retry that landed late isn't followed (you've moved on): the dock says where it went.
      if (heldLanding.current) attention.held(heldLanding.current);
    }
    seenThoughts.current = new Set(placed.map((thought) => thought.id));
    for (const thought of placed) everPlaced.current.add(thought.id);
    seenSnapshot.current = core.snapshotRevision;
    seenActive.current = world.active;
    const answered = moved && jumps.moved(world.active!);
    // Where you are goes first: your thought landing on another thread means "…, where was I?" moved you on in the
    // same breath (your place can end where it started, so it doesn't count as moving).
    const elsewhere = !!world.active && (moved || (!!landing?.mine && landing.thread !== world.active));
    // A landing gets one chance to follow; never catch up later while someone is reading. In a room only your own
    // words move your view.
    const follow = elsewhere && landing?.thread !== world.active ? { thread: world.active! } : landing?.mine ? landing : null;
    if (!follow) return;
    // Your place moved by a jump that shows its own point: the jump is the look.
    if (answered && !("thought" in follow)) return;
    // Your landing the map won't show (another view, a search, Recap open): the dock says where it went.
    if ((view !== "map" && view !== "spine") || query.trim() || core.recap.view) { if (landing?.mine) attention.held(landing); return; }
    // The Canvas follows with its own camera; cards' scroll and landing notice stay with cards.
    if (view === "spine") return;
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
      if (!target) return;
      if (!target.thought && !landed && jumps.since(scheduled, target.thread)) return;
      if (lookingElsewhere()) { if (landed) attention.held({ ...landed, mine: true }); return; }
      const card = document.getElementById(`thread-${target.thread}`);
      if (!card) return;
      const top = mapTop();
      const bottom = Math.min(window.innerHeight, dockRef.current?.getBoundingClientRect().top ?? window.innerHeight);
      if (bottom <= top) return;
      // Your words landing, also when your place moved with them to a new topic. Your place moving on its own
      // ("where was I?", "next one") is what you asked for, so it's never held back.
      const thought = target.thought ?? (landed?.thread === target.thread ? landed.thought : undefined);
      // Moving the map holds a landing back only when its thread's title and points are out of view: you went to
      // read elsewhere. A nudge or a key press that leaves them on screen doesn't. The 5 s is the old guess at
      // reading, kept until a rule without a timer replaces it.
      const own = ownRect(card);
      if (thought && Date.now() - lastNavigation.current < 5000 && (own.bottom <= top || own.top >= bottom)) {
        attention.held({ thread: target.thread, thought, mine: true });
        return;
      }
      // The thought itself (a thread's latest, when you moved back to it), where it will settle: a landing point
      // starts out where its pending pill was, in the dock.
      const point = thought ? document.getElementById(`point-${thought}`)
        : card.querySelector<HTMLElement>(":scope > div > .points > li:last-child");
      const rect = settledRect(point ?? card);
      shownLanding.current = thought && point ? { thought, at: Date.now() } : null;
      // Look here: the thought shown, highlighted once the map holds still, for as long as reading it takes.
      const shownId = point?.id.replace(/^point-/, "");
      if (shownId) attention.shown(shownId, target.thread);
      if (point ? rect.top >= top && rect.bottom <= bottom : rect.bottom > top && rect.top < bottom) return;
      const delta = point ? (rect.top + rect.bottom) / 2 - (top + bottom) / 2 : rect.top >= bottom ? rect.top - top - 12 : rect.bottom - bottom + 12;
      scrollForMap(following, delta, !!reducedMotion);
    };
    const scheduled = jumps.mark();
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

  // Keep the end of the map reachable even when pending thoughts or the card grow, and never shorten the page under
  // you when they go.
  // Measure the whole bottom bar, including its input row and any cards above it.
  useHeightVar(dockRef, "--dock-height", true);
  useShellCountdownPlacement(SHELL2);
  const dockRoom = useDockRoom(dockRef);
  // The map's tools stick right under the header, whatever height it wraps to, and a card brought to the top
  // (Back to active, Finish it, a Palace tile) stops under both.
  const headerRef = useRef<HTMLElement>(null);
  const toolsRef = useRef<HTMLElement>(null);
  useHeightVar(headerRef, "--header-height");
  useHeightVar(toolsRef, "--tools-height", world.threads.length > 0);
  // The notice lane's notices and cards share the room down to the dock (useLaneRoom).
  const laneRef = useRef<HTMLDivElement>(null);
  useLaneRoom(laneRef, headerRef, dockRef);

  // A point tapped or tabbed to on a phone or a short window shows whole with its Delete and Move: not under the stack
  // of notices, the header or the dock (at 320 × 568 the notices covered a focused point's words and buttons). The
  // laptop's notices are a narrow column of no height in the flow: there the browser's own scroll to focus stays.
  useEffect(() => {
    const stacked = window.matchMedia("(max-width: 560px), (max-height: 560px)");
    const showPoint = (event: FocusEvent) => {
      const point = stacked.matches ? (event.target as Element | null)?.closest?.(".points li") : null;
      if (!point) return;
      // A frame on, once its Delete and Move have their row.
      requestAnimationFrame(() => {
        if (!point.contains(document.activeElement) || following.current) return;
        const top = mapTop();
        const bottom = Math.min(window.innerHeight, dockRef.current?.getBoundingClientRect().top ?? window.innerHeight);
        const rect = point.getBoundingClientRect();
        if (bottom <= top || (rect.top >= top && rect.bottom <= bottom)) return;
        // Too tall for the band, or above it: its first line goes to the band's top; below it, its foot to the band's foot.
        const delta = rect.top < top || rect.height > bottom - top - 16 ? rect.top - top - 8 : rect.bottom - bottom + 8;
        scrollForMap(following, delta, !!reducedMotion);
      });
    };
    document.addEventListener("focusin", showPoint);
    return () => document.removeEventListener("focusin", showPoint);
  }, [reducedMotion]);

  // A focused button that leaves the notice (Undo, once used, by key or by a click in Chrome) never says blur, which
  // kept every later notice up for good: on each change, look where focus is now.
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setNoticeFocused(!!core.notice && !!noticeRef.current?.contains(document.activeElement)); }, [core.notice, core.undoId]);
  // The pointer leaves with the notice: a mouseleave never comes when the notice is gone.
  useEffect(() => { if (!core.notice) setNoticeHeld(false); }, [core.notice]);
  // A new answer restarts the timeout even if its words are unchanged (a find result, "stop listening" said again).
  useEffect(() => {
    // "Looking through your threads…" stays until its answer, which can take longer than this (find.rs PATIENCE).
    if ((SHELL2 && railTab === "history") || !core.notice || noticeFocused || noticeHeld || core.notice === LOOKING || staysUp(core.notice)) return;
    // With Undo, long enough to act on it, not just read it (notice-rules.ts `undoUpFor`).
    const shown = friendlyNotice || core.notice;
    const timer = window.setTimeout(core.clearNotice, core.undoId ? undoUpFor(shown) : upFor(shown));
    return () => window.clearTimeout(timer);
  }, [core.notice, core.noticeKey, core.clearNotice, core.undoId, noticeFocused, noticeHeld, railTab]);

  // The running mic's stop, as effects of one render see it: the first to stop the mic clears it at once, so the
  // next effect in the same render finds the mic off (`stopMic` there is still the render's value).
  const liveStop = useRef<(() => void) | null>(null);
  liveStop.current = stopMic;
  /** Stops the mic if it runs; false if it was already off. */
  const releaseMic = () => {
    const stop = liveStop.current;
    liveStop.current = null;
    setStopMic(null);
    stop?.();
    return !!stop;
  };

  // A permission prompt can outlive a disconnect or pagehide (including the back/forward cache). Cancel it;
  // neither reconnect nor restoring a page may finish an old start. Only a new mic tap starts capture.
  useEffect(() => {
    if (!core.connected) micStart.current?.abort();
  }, [core.connected]);
  useEffect(() => {
    const hide = () => { micStart.current?.abort(); if (releaseMic()) core.listen(false); };
    window.addEventListener("pagehide", hide);
    return () => window.removeEventListener("pagehide", hide);
  }, []);

  // "Stop listening": the mic closes, as its button does, and stays off until you tap it (starting it again by voice
  // would need it to keep listening). The core has ended the stream already and drops anything heard after. Before
  // the stream's end below: both often arrive in one render, and then "Paused" is the answer, not "The mic stopped".
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (core.viewAsk?.view !== "pause") return;
    if (!releaseMic()) { core.showNotice("The mic is already off.", core.viewAsk); return; }
    core.listen(false);
    setPaused(true);
    core.showNotice("Paused: nothing is heard until you tap the mic.", core.viewAsk);
  }, [core.viewAsk]);

  // Stop local audio when the service reports a stop or the connection drops, and tell the core,
  // so the next tap starts a fresh session.
  const voiceStartedAt = useRef(0);
  const voiceErrorStartedAt = useRef(0);
  const voiceListenedAt = useRef(0);
  const voiceRevisions = useRef({ status: 0, error: 0, listened: 0 });
  voiceRevisions.current = { status: core.voiceStatusRevision, error: core.voiceErrorRevision, listened: core.listenedRevision };
  useEffect(() => {
    // Only this mic's stream can end it: the mic tapped off and on fast, the old stream's late "not listening"
    // comes before the new one's "listening" and is passed over.
    const ends = micEnds({ connected: core.connected, listening: core.listening, failed: core.voiceErrorRevision > voiceErrorStartedAt.current,
      statusNew: core.voiceStatusRevision > voiceStartedAt.current, listenedNew: core.listenedRevision > voiceListenedAt.current });
    if (liveStop.current && ends) {
      releaseMic();
      core.listen(false);
      core.showNotice(ends === "offline" ? MIC_OFFLINE : core.noKey ? core.keyNotice : micStopped(ends === "failed" ? core.voiceError : ""));
    }
  }, [core.connected, core.listening, core.voiceStatusRevision, core.voiceErrorRevision, core.listenedRevision, stopMic]);

  useEffect(() => {
    if (liveStop.current && aboutKey(core.notice)) { releaseMic(); core.listen(false); }
  }, [core.notice, stopMic]);

  // The site's mic permission, where the browser says it: "denied" looks blocked; allowed later (from the address
  // bar's icon), it says so and looks ready, without a reload. A block by the computer shows no change here: it lifts
  // when the browser is reopened.
  const showNotice = useRef(core.showNotice);
  showNotice.current = core.showNotice;
  useEffect(() => watchMicPermission(navigator.permissions, (state) => {
    if (state === "denied") setMicBlocked("site");
    else if (micBlockedNow.current === "site") {
      setMicBlocked("");
      showNotice.current("Microphone allowed. Tap to talk.");
    }
  }), []);

  // Capture starts only from a gesture in this tab. The mic button's click (keyboard activation too) passes its event,
  // which must be the browser's own, never a script's; a caller without one (a brick's listen, the Keys brick's ⌘D)
  // still meets mic.ts's check that a click or key press is under way in this tab.
  const toggleMic = async (event?: { isTrusted: boolean }) => {
    if ((event && !event.isTrusted) || micStart.current || (!core.connected && !liveStop.current)) return;
    if (!world.threads.length && !world.thoughts.length) startedEmpty.current = true;
    setPaused(false);
    if (liveStop.current) {
      releaseMic();
      core.listen(false);
      return;
    }
    // Without a key the core can't listen: say so, without asking the browser for the microphone first.
    if (core.noKey) {
      core.showNotice(core.keyNotice);
      return;
    }
    const attempt = new AbortController();
    micStart.current = attempt;
    const sameConnection = core.micConnection();
    setStartingMic(true);
    if (micNotice(core.notice)) core.clearNotice();
    try {
      let stopped = false;
      // The browser ended the mic itself (unplugged, or another app took it): off, and said so, rather than
      // "Listening" to nothing. Starts "The mic stopped", so it stays up until the mic is tapped (notice-rules.ts).
      const ended = () => {
        if (stopped || !mounted.current) return;
        stopped = true;
        if (liveStop.current === stop) liveStop.current = null;
        setStopMic(null);
        core.listen(false);
        core.showNotice("The mic stopped: the microphone went away. Tap it to listen again, or type below.");
      };
      const stopAudio = await startMic(core.sendAudio, ended, attempt.signal);
      const stop = () => { if (!stopped) { stopped = true; stopAudio(); } };
      if (!mounted.current || attempt.signal.aborted || !sameConnection()) { stop(); return; }
      setMicBlocked("");
      voiceStartedAt.current = voiceRevisions.current.status;
      voiceErrorStartedAt.current = voiceRevisions.current.error;
      voiceListenedAt.current = voiceRevisions.current.listened;
      liveStop.current = stop;
      setStopMic(() => stop);
      if (!core.listen(true)) {
        releaseMic();
        core.showNotice("Connection lost. Reconnect to use the microphone; you can still type below.");
      }
    } catch (err) {
      if (!mounted.current || attempt.signal.aborted) return;
      core.listen(false);
      // The browser's own words go to the console; the window says where to fix it (mic.ts).
      console.warn("The mic didn't start:", err);
      const failed = micFailure(err, micPlace());
      if (failed.blocked) setMicBlocked(failed.blocked);
      core.showNotice(failed.words);
    } finally {
      if (micStart.current === attempt) micStart.current = null;
      if (mounted.current) setStartingMic(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft.trim()) {
      setHelpOpen(false);
      if (!world.threads.length && !world.thoughts.length) startedEmpty.current = true;
      if (core.sendText(draft.trim())) { setDraft(""); typedSinceSend.current = false; }
    }
  };

  // A one-row textarea preserves pasted paragraphs; Enter still sends as it did in the input.
  const submitOnEnter = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  // Your own thoughts on their way; in a room the other person's land on the map with their name.
  const pending = useMemo(() => world.thoughts.filter((t) => !t.placed && t.speaker === me), [world.thoughts, me]);
  // While you talk the map quiets all but where you are (legible.css); at a natural pause everything reads again.
  // On its way means about to land: not a thought waiting for a key or for a retry, which can wait for minutes.
  const onItsWay = core.noKey || core.keyRefused ? 0 : pending.filter((t) => core.placing.retryAt[t.id] === undefined).length;
  const talking = useTalking({ heard: core.partial || core.handoff, inFlight: onItsWay });
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
        // Opened with its branches: it stays open after you leave (review).
        if (!(keptOpen.current.has(thread.id) && next[thread.id] === false)) {
          delete next[thread.id];
          keptOpen.current.delete(thread.id);
        }
        thread = world.threads.find((item) => item.id === thread?.parent_id);
      }
      return next;
    });
  }, [world.active]);

  const threadById = useMemo(() => new Map(world.threads.map((thread) => [thread.id, thread])), [world.threads]);
  const notes = useMemo(() => world.notes ?? {}, [world.notes]);
  const whyAsk = useMemo(() => ({ whys: core.whys, ask: core.askWhy }), [core.whys, core.askWhy]);
  const rooms = useMemo(() => roomColors(world.threads), [world.threads]);
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
  const ideasByThread = useMemo(() => groupItems(world.suggestions), [world.suggestions]);
  const actionsByThread = useMemo(() => groupItems(world.actions), [world.actions]);
  // Everything the card shows is found: title, tags, thoughts, ideas and reminders (searchFields), each a separate
  // field so a query cannot match across two pieces of text. An entry is rebuilt only when its card's items change:
  // groups are new arrays after any item changes, so they're compared item by item (a letter costs only the scan).
  type SearchEntry = { thread: Thread; thoughts: Thought[] | undefined; ideas: Suggestion[] | undefined; actions: Action[] | undefined; fields: string[] };
  const previousSearchIndex = useRef(new Map<string, SearchEntry>());
  const searchIndex = useMemo(() => {
    const next = new Map<string, SearchEntry>();
    const same = <T,>(a: T[] | undefined, b: T[] | undefined) => a === b || (!!a && !!b && a.length === b.length && a.every((item, i) => item === b[i]));
    const entries = world.threads.map((thread) => {
      const thoughts = thoughtsByThread.get(thread.id), ideas = ideasByThread.get(thread.id), actions = actionsByThread.get(thread.id);
      const previous = previousSearchIndex.current.get(thread.id);
      const entry = previous?.thread === thread && previous.thoughts === thoughts && same(previous.ideas, ideas) && same(previous.actions, actions)
        ? previous : { thread, thoughts, ideas, actions, fields: searchFields(thread, thoughts, ideas, actions) };
      next.set(thread.id, entry);
      return { id: thread.id, fields: entry.fields };
    });
    previousSearchIndex.current = next;
    return entries;
  }, [world.threads, thoughtsByThread, ideasByThread, actionsByThread]);
  // The box shows each letter at once; the map follows a moment later and gives way to the next letter
  // (useDeferredValue), so typing never waits on the cards. At 1,000 threads a letter used to freeze the page ≈ 1 s.
  const deferredQuery = useDeferredValue(query);
  const search = mapQuery(query, deferredQuery).trim().toLocaleLowerCase();
  const matches = useMemo(() => searchMatches(searchIndex, search), [search, searchIndex]);
  const held = useMemo(() => heldOpen(matches), [matches]);
  const previousChildren = useRef<Map<string | null, Thread[]> | undefined>(undefined);
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
    // Found threads show best first (up to RANK_LIMIT): matches come ranked, so a thread joins visibleIds at its best
    // found branch's place.
    const place = search && matches.size <= RANK_LIMIT ? new Map([...visibleIds].map((id, i) => [id, i])) : undefined;
    if (place) for (const group of grouped.values()) group.sort((a, b) => place.get(a.id)! - place.get(b.id)!);
    return previousChildren.current = steady(previousChildren.current, grouped);
  }, [world.threads, world.active, threadById, search, matches, focusMode]);
  const on = useMemo(() => ({ setItem: core.setItem, approve: core.approve, tag: core.tag, correct: core.correct, unlink: core.unlink }), [core.setItem, core.approve, core.tag, core.correct, core.unlink]);
  const speechFixes = useMemo(() => (thought: Thought) => <Fixes thought={thought} on={on} />, [on]);

  // "Expand the garden", "collapse this", "expand everything": the thread and every branch under it stay open (or
  // folded) until you change them; where you are on the map doesn't fold them again. An opened thread comes to the top.
  useEffect(() => {
    const ask = core.unfoldAsk;
    if (!ask) return;
    keepShown();
    const id = ask.thread_id && resolveMerged(world, ask.thread_id);
    if (id && !world.threads.some((thread) => thread.id === id)) return;
    const ids = id ? [id, ...branchesUnder(world.threads, id)] : world.threads.map((thread) => thread.id);
    setView((was) => viewAfterJump(was, "map"));
    setQuery("");
    setFocusMode(false);
    const kept = keptOpen.current;
    setExpanded((state) => {
      const next = { ...state };
      for (const each of ids) {
        next[each] = !ask.open;
        if (ask.open) kept.add(each); else kept.delete(each);
      }
      // Its own card shows only under open parents.
      const byId = new Map(world.threads.map((thread) => [thread.id, thread]));
      for (let parent = id ? byId.get(id)?.parent_id : null; ask.open && parent && next[parent] !== false; parent = byId.get(parent)?.parent_id) {
        next[parent] = false;
        kept.add(parent);
      }
      return next;
    });
    if (!id) return;
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => {
      const card = document.getElementById(`thread-${id}`);
      if (card) scrollCardToTop(card, !!reducedMotion);
    }));
    return () => cancelAnimationFrame(frame);
  }, [core.unfoldAsk]);

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
      // ⌘Z / Ctrl+Z: "undo that", the last turn, with or without the notice up. A field with words in it keeps the
      // browser's own undo of typing; the empty composer after sending a thought doesn't (persona run 2026-11-01).
      const field = target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      const goesTo = isUndoKey(event, MAC) ? undoKeyGoesTo({ repeat: event.repeat, field, composer: target === composerRef.current,
        composerEmpty: !composerRef.current?.value, typedSinceSend: typedSinceSend.current }) : "browser";
      if (goesTo !== "browser") {
        event.preventDefault();
        if (goesTo === "app") core.undoLast();
        return;
      }
      if (opensHelp({ key: event.key, field, modified: event.metaKey || event.ctrlKey || event.altKey })) {
        // The list opens where its ? button is, with focus on it: Esc or ? again closes it there.
        away.dismiss();
        event.preventDefault();
        setHelpOpen((open) => !open);
        document.querySelector<HTMLElement>(".shortcuts summary")?.focus();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || field) return;
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
        // One Esc, one thing: the shell's rail closes by its own key handler below (which may run before this one, with the
        // rail already gone, or after it), and the next Esc folds the cards.
        if (SHELL2 && (event.defaultPrevented || document.querySelector(".shell-rail"))) return;
        keptOpen.current.clear();
        setExpanded(Object.fromEntries(world.threads.filter((thread) => !activePath.has(thread.id)).map((thread) => [thread.id, true])));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [world.threads, activePath, hasAway, away.dismiss, core.undoLast]);

  const previousPlaced = useRef<number | null>(null);
  useEffect(() => {
    const count = world.thoughts.filter((thought) => thought.placed).length;
    if (!SHELL2 && startedEmpty.current && previousPlaced.current === 0 && count === 1 && world.threads.length === 1) setFirstHint(true);
    previousPlaced.current = count;
  }, [world.thoughts, world.threads.length, core.partial]);
  const firstNotice = useCardNotice(core.noticeQueue, "first-thought", !SHELL2 && firstHint ? "first" : null,
    "Got it. Keep going, or start a new topic.", () => setFirstHint(false));

  const [mapAnnouncement, setMapAnnouncement] = useState("");
  const { mapChange, hideMapChange } = core;
  const [mapHeld, setMapHeld] = useState(false);
  const [mapFocused, setMapFocused] = useState(false);
  useEffect(() => { setMapHeld(false); setMapFocused(false); }, [mapChange?.id]);
  const mapHold = {
    onMouseEnter: () => setMapHeld(true), onMouseLeave: () => setMapHeld(false),
    onFocus: () => setMapFocused(true),
    onBlur: (e: React.FocusEvent<HTMLDivElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setMapFocused(false); },
  };
  useEffect(() => {
    if (!mapChange) return;
    setMapAnnouncement("");
    const announcement = window.setTimeout(() => setMapAnnouncement(mapChange.text), 700);
    // Reading time starts only when this queued update reaches the screen.
    const timer = mapHeld || mapFocused || (SHELL2 && railTab === "history") ? undefined : window.setTimeout(hideMapChange, upFor(`${mapChange.text} ${mapChange.undo || mapChange.restore ? "Undo" : ""}`));
    return () => { window.clearTimeout(announcement); window.clearTimeout(timer); };
  }, [mapChange, hideMapChange, mapHeld, mapFocused, railTab]);

  // Pull-back: at a natural pause, offer the most recently dropped thread (unfinished.ts).
  const [lastActivity, setLastActivity] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [hidden, setHidden] = useHidden(world.thoughts, me);
  useEffect(() => setLastActivity(Date.now()), [core.partial, world.thoughts.length]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 400);
    return () => window.clearInterval(timer);
  }, []);
  // Once the return card covers an unfinished thread, don't repeat it in the pull-back.
  useEffect(() => {
    const covered = away.items.filter((item) => item.unfinished)
      .flatMap((item) => world.threads.filter((t) => t.id === item.threadId && t.dropped_by === me).map(dropKey));
    if (covered.length) setHidden((was) => dismiss(was, covered));
  }, [away.items, world.threads, me]);
  const dropped = leftOff(world.threads, me, hidden, now);
  // Once offered, keep this card through new speech (even on its thread) until it has had time to be read.
  const pullBack = core.unfinishedNotice && leftOff([core.unfinishedNotice], me, hidden, now) ? core.unfinishedNotice : null;
  useEffect(() => {
    const next = cardAt(dropped, now, lastActivity);
    if (next && !hasAway) core.noticeQueue.push("unfinished", dropKey(next), next);
  }, [dropped, now, lastActivity, hasAway, core.noticeQueue]);
  useEffect(() => {
    if (core.unfinishedNotice && !pullBack) core.noticeQueue.drop("unfinished", dropKey(core.unfinishedNotice));
  }, [core.unfinishedNotice, pullBack, core.noticeQueue]);
  const [pullBackHovered, setPullBackHovered] = useState(false);
  const [pullBackFocused, setPullBackFocused] = useState(false);
  const pullBackKey = pullBack ? dropKey(pullBack) : null;
  useEffect(() => { setPullBackHovered(false); setPullBackFocused(false); }, [pullBackKey]);
  const pullBackHold = {
    onMouseEnter: () => setPullBackHovered(true),
    onMouseLeave: () => setPullBackHovered(false),
    onFocus: () => setPullBackFocused(true),
    onBlur: (event: React.FocusEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPullBackFocused(false);
    },
  };
  const later = (thread: Thread) => { core.noticeQueue.drop("unfinished", dropKey(thread), false); setHidden((was) => putOff(was, thread, Date.now())); };
  const forget = (thread: Thread) => { core.noticeQueue.drop("unfinished", dropKey(thread)); setHidden((was) => dismiss(was, [dropKey(thread)])); };
  // Installing is offered once, after a thought of yours found its thread, in a lull: nothing else in the dock
  // and nothing being said or typed, so it never covers a card that needs you or interrupts a thought.
  const placedMine = useMemo(() => world.thoughts.filter((t) => t.placed && t.speaker === me).map((t) => t.id), [world.thoughts, me]);
  const buildGone = useState<string | null>(null);
  const install = useInstallHint(placedMine, view === "map" && !hasAway && !pullBack && !buildInTheWay(core.apps, buildGone[0]) && !firstHint
    && !core.partial && !core.handoff && !pending.length && !core.listening && !stopMic && !startingMic && !draft && core.queuedCount === 0 && !attention.value.note?.title,
    core.snapshotRevision > 0);
  // Said aloud: "later" and "finish it" as the buttons; "forget it" sets the card aside as a second Later does. Each
  // acts on the card you see (or would see at the next pause); with none, "forget it" takes the one hidden for now
  // and "finish it" the newest you left. Your words stay on the map either way.
  useEffect(() => {
    const asked = core.viewAsk?.view;
    if (asked !== "later" && asked !== "forget" && asked !== "finish") return;
    const mine = world.threads.filter((t) => t.status === "dropped" && t.dropped_by === me).sort((a, b) => b.touched_ms - a.touched_ms);
    const yours = mine.find((t) => !hidden.dismissed.includes(dropKey(t)));
    if (asked === "finish") {
      const card = pullBack ?? dropped ?? mine[0];
      if (!card) { core.showNotice("Nothing unfinished to finish.", core.viewAsk); return; }
      finishThread(card);
      core.showNotice(`Back to ${card.title}`, core.viewAsk);
      return;
    }
    const card = pullBack ?? (asked === "later" ? dropped : dropped ?? yours);
    if (!card) { core.showNotice("Nothing unfinished to set aside.", core.viewAsk); return; }
    if (asked === "later") {
      later(card);
      core.showNotice(`Later: ${card.title} comes back after a while.`, core.viewAsk);
    } else {
      setHidden((was) => dismiss(was, [dropKey(card)]));
      core.showNotice(`Set aside: ${card.title}. What you said stays on the map.`, core.viewAsk);
    }
  }, [core.viewAsk]);
  // A card rising in the dock (the unfinished card, a build's) grows it upward; the thought the map just showed you
  // moves clear of it, once. Under 10 s: in a talk paced like the demo's (a turn every 6 s, landing 2–4 s after its
  // words, the card after 2.5 s of quiet) the newest landing is younger than that when the card rises. Not once you've
  // moved the map yourself. Your own words in the dock (the live line, a thought on its way) don't move it: they land
  // next, and the follow shows them. A build's card covered a thought just landed above the dock (review).
  const clearFrame = useRef(0);
  const cardsHeight = useRef(0);
  const keepClear = () => {
    cancelAnimationFrame(clearFrame.current);
    const shown = shownLanding.current;
    if (view !== "map" || !shown || Date.now() - shown.at > 10000 || lastNavigation.current > shown.at || lookingElsewhere()) return;
    // After the map's own scroll, when the card rises while it still runs.
    if (following.current) { clearFrame.current = requestAnimationFrame(keepClear); return; }
    const point = document.getElementById(`point-${shown.thought}`);
    const dockTop = dockRef.current?.getBoundingClientRect().top;
    if (!point || dockTop === undefined) return;
    const rect = settledRect(point);
    // The 12 px the follow leaves between a card and the dock.
    const overlap = rect.bottom + 12 - dockTop;
    if (overlap > 0 && rect.top < window.innerHeight) scrollForMap(following, overlap, !!reducedMotion);
  };
  // After each render, the dock's cards as measured: any growing, keep clear. The map's end has already grown with the
  // dock (useDockRoom's layout effect runs before this one).
  useLayoutEffect(() => {
    const cards = dockRef.current?.querySelectorAll<HTMLElement>("[data-dock-card]") ?? [];
    const height = Array.from(cards, (card) => card.offsetHeight).reduce((sum, h) => sum + h, 0);
    const grew = height > cardsHeight.current;
    cardsHeight.current = height;
    if (grew) keepClear();
  });
  useEffect(() => () => cancelAnimationFrame(clearFrame.current), []);
  // A move changes where words belong, not when this thread was last spoken on. Future sample times count as earliest.
  const lastWords = pullBack ? lastWordsOn(world.thoughts.filter((t) => (t.at_ms > now ? 0 : t.at_ms) <= pullBack.touched_ms), pullBack, me, now) : "";
  useEffect(() => {
    if (!pullBack || pullBackHovered || pullBackFocused) return;
    const timer = window.setTimeout(() => forget(pullBack), unfinishedLingerMs(pullBack.title, lastWords));
    return () => window.clearTimeout(timer);
  }, [pullBack, lastWords, hasAway, pullBackHovered, pullBackFocused]);

  const goBack = (thread: Thread, focus: "thread" | "composer" = "thread") => {
    setView((was) => viewAfterJump(was, home));
    const latest = [...world.thoughts].reverse().find((thought) => thought.thread_id === thread.id && thought.placed);
    setDestination((was) => ({ threadId: thread.id, thoughtId: latest?.id ?? null, revision: (was?.revision ?? 0) + 1 }));
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
    setHidden((was) => dismiss(was, [dropKey(thread)]));
    requestAnimationFrame(() => {
      const target = document.getElementById(`thread-${thread.id}`);
      if (target) scrollCardToTop(target, !!reducedMotion);
      const field = focus === "composer" ? composerRef.current : target?.querySelector<HTMLButtonElement>(".thread-toggle");
      field?.focus({ preventScroll: true });
      // Look here: where you left off, the thread's last point (else its head).
      const spot = target?.querySelector<HTMLElement>(":scope > div > .points > li:last-child") ?? target?.querySelector<HTMLElement>(":scope > .thread-head");
      if (spot) look(spot, `${thread.title} ${spot.matches("li") ? wordsIn(spot) : ""}`);
    });
  };
  // Finish it reveals the same destination, but the next words belong in the composer. Choose focus in goBack's
  // one post-render callback so a queued thread-toggle focus cannot take it back. The existing draft stays intact.
  const finishThread = (thread: Thread) => goBack(thread, "composer");
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey
        || event.repeat || event.isComposing || hasAway || !pullBack || document.querySelector("dialog[open]")) return;
      // Fields and focused controls keep their own Enter (including a native click on Finish it or Later).
      if (event.target !== document.body && event.target !== document.documentElement) return;
      event.preventDefault();
      finishThread(pullBack);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pullBack, hasAway]);

  // Bricks (docs/bricks.md): what each is handed, and the views among those on. A brick's actions are the app's own:
  // openThread is a Palace picture's goBack, select tells the core "this" as pointing at a card does, listen is the mic
  // button's tap (the Keys brick's ⌘D). It starts the mic only inside a click or key press in this tab, as the tap does,
  // and not while the button can't be pressed (starting, or offline with nothing to stop). annotate sends a margin note
  // (core annotate.rs), openCatalog is Apps' Catalog button, at a brick's row, and hint is the guide's arrow or corner
  // caption, here only (guide-core.ts `showHint`).
  const brickHost = useBrickHost(world, core.snapshotRevision, me, core.connected, rooms, core.partial, {
    addThought: core.sendText,
    openThread: (id) => { const thread = threadById.get(resolveMerged(world, id)); if (thread) goBack(thread); },
    select: core.select,
    notify: (text) => core.showNotice(text),
    position: core.position,
    listen: (on) => {
      const capturing = !!stopMic;
      if (on === capturing || startingMic || (!core.connected && !capturing)) return;
      if (!capturing && navigator.userActivation?.isActive === false) return;
      void toggleMic();
    },
    annotate: core.annotate,
    openCatalog: (id) => openCatalogAt(id ?? null),
    hint: showHint,
  }, destination, core.usage);
  const bricksOn = useBricksOn();
  const builtIns = useBuiltInsOn();
  // A brick that shows your live words itself (brick.json `showsLiveWords`: Tiny transcript) takes them from the dock.
  const wordsElsewhere = BRICKS.some((brick) => brick.info.showsLiveWords && bricksOn.has(brick.info.id));
  const viewBricks = BRICKS.filter((brick) => brick.info.kind === "view" && bricksOn.has(brick.info.id));
  const viewBrick = viewBricks.find((brick) => brick.info.id === view);
  // A view that's gone while it's shown hands the window back to the map: a view brick switched off, or the shell's Cards
  // (the Features page's built-in view; the classic page has no such view, its map is the cards) switched off or never on.
  const viewGone = !talk && (view === "cards" ? !(SHELL2 && builtIns.has("cards")) : view !== "map" && view !== "palace" && !viewBrick);
  useEffect(() => { if (viewGone) showView("map"); }, [viewGone]);

  const mic = micState({ connected: core.connected, capturing: !!stopMic, starting: startingMic, serviceOn: core.listening,
    words: !!core.partial, paused, noKey: core.noKey, refused: core.keyRefused, resting: core.resting, blocked: !!micBlocked });

  const status = statusLine({ connected: core.connected, listening: !!stopMic, noKey: core.noKey, refused: core.keyRefused, resting: core.resting, paused });

  const noticeText = (text: string) => text && (
    // Hosted, the key is the site's own, so its words never send anyone to .env (site.ts).
    (site.hosted || !core.keyRefused) && aboutKey(text) ? keyWords(site.hosted, core.keyRefused, "notice", core.resting)
    : text.startsWith("Couldn't place a thought:") ? "Couldn't sort that thought yet. It's saved and will retry."
    : text
  );
  const friendlyNotice = noticeText(core.notice);
  // What came up since the last render, in the lane's words, to the bricks (on("notice")).
  useEffect(() => {
    for (const notice of core.takeNotices()) brickHost.emit("notice", { ...notice, text: noticeText(notice.text) });
  });
  // The shell's own state (shell/): the rail's tab, the built-ins' switches, History, the mode.
  const listeningOn = !SHELL2 || builtIns.has("listening");
  const catalogOpen = useCatalogOpen();
  const catalogAt = useCatalogAt();
  const heldQuestions = useHeld();
  const history = useHistory(brickHost.on, world, core.mapChange, core.undoId);
  const call = useCall();
  const inCall = peopleHere(call) >= 2;

  // "What just happened?": the notices this window showed are a brick's to show (the Notice timeline's list); with none
  // on to hear it, the answer says where to switch it on. In the new shell they're History's, which opens.
  useEffect(() => {
    if (core.viewAsk?.view !== "notices") return;
    if (SHELL2) { setRailTab("history"); return; }
    if (!brickHost.emit("asked", { what: "notices" })) core.showNotice("Notification history is off: switch it on in Features, and it keeps notices from then on.", core.viewAsk);
  }, [core.viewAsk]);

  // The Catalog asked for (a feature's openCatalog, at its row): the rail opens at its tab. Leaving the tab lets it go,
  // so the next ask opens it again. A call opens Talk as it starts; "What can I say?" or ? opens Settings, its list.
  useEffect(() => { if (SHELL2 && catalogOpen) setRailTab("catalog"); }, [catalogOpen, catalogAt]);
  useEffect(() => { if (SHELL2 && catalogOpen && railTab !== "catalog") closeCatalog(); }, [railTab]);
  // In a call, Talk is the call's own rail (lane L5's TalkRail, until this rail hosts it): this one leaves its tab out.
  useEffect(() => { if (SHELL2 && callOn(call)) setRailTab((was) => (was === "talk" ? null : was)); }, [callOn(call)]);
  useEffect(() => { if (SHELL2 && helpOpen) { setRailTab("settings"); setHelpOpen(false); } }, [helpOpen]);
  const toggleTab = (tab: RailTab) => setRailTab((was) => (was === tab ? null : tab));
  // The mic's time, from when it started listening.
  const [micSince, setMicSince] = useState<number | null>(null);
  useEffect(() => setMicSince(stopMic ? Date.now() : null), [stopMic]);
  // Listening switched off in the Catalog stops a mic that runs.
  useEffect(() => { if (!listeningOn && releaseMic()) core.listen(false); }, [listeningOn]);
  // The sample map, loaded from the first screen (or ?sample): stamped SAMPLE until the map is emptied.
  const [sampleMap, setSampleMap] = useState(() => SAMPLE_FLAG || readSession(SAMPLE_KEY));
  const sawThreads = useRef(false);
  useEffect(() => {
    if (world.threads.length) { sawThreads.current = true; return; }
    if (sawThreads.current && sampleMap) { setSampleMap(false); writeSession(SAMPLE_KEY, false); }
  }, [world.threads.length]);
  const loadSample = (name?: string) => { core.sample(name); setSampleMap(true); writeSession(SAMPLE_KEY, true); };
  const mode: Mode | null = DEMO ? "demo" : inCall ? "call" : sampleMap ? "sample" : site.hosted ? "guest" : null;
  // The held stack sits above the shelf (the Spine's, bottom right); the rail ends above both.
  useLayoutEffect(() => {
    if (!SHELL2) return;
    const root = document.documentElement.style;
    const set = (name: string, px: number) => { if (root.getPropertyValue(name) !== `${px}px`) root.setProperty(name, `${px}px`); };
    const shelf = document.querySelector('[data-slot="shelf"]')?.getBoundingClientRect();
    const shelfTop = shelf && shelf.height && shelf.top > window.innerHeight / 2 ? Math.round(window.innerHeight - shelf.top + 12) : 36;
    set("--shelf-top", shelfTop);
    const held = document.querySelector('[data-slot="held"]')?.getBoundingClientRect();
    set("--rail-bottom", held && held.height ? Math.round(window.innerHeight - held.top + 12) : shelfTop);
  });
  useEffect(() => { if (SHELL2) document.documentElement.dataset.view = view; }, [view]);
  // The shell's keys, outside a field: T Talk, Y History, C Catalog, "," Settings, R Recap, L a held question's Later,
  // Esc closes the rail; ⌘D or Ctrl+D the mic, from anywhere (the Keys feature's own, when it's on).
  // Listened for once, reading each render's values through `shellKey`. A listener taken off and put back by every render
  // is skipped by a key press whose earlier listener re-rendered in between: the map's Esc above sets state, and for a
  // real key press the browser runs that render before the next listener (a script's dispatched event runs them all
  // first), so a real Esc never closed the rail.
  const shellKey = useRef<(event: KeyboardEvent) => void>(() => {});
  shellKey.current = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    const field = target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "d") {
      if (bricksOn.has("keys") || !listeningOn) return;
      event.preventDefault();
      if (!event.repeat) void toggleMic(event);
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || field || event.repeat || document.querySelector("dialog[open]")) return;
    if (event.key === "Escape" && railTab) { event.preventDefault(); setRailTab(null); return; }
    if (talk) return;
    const key = event.key.toLowerCase();
    const tab = (Object.keys(RAIL_KEYS) as RailTab[]).find((t) => RAIL_KEYS[t].toLowerCase() === key);
    if (tab && !(tab === "talk" && callOn(call))) { event.preventDefault(); toggleTab(tab); return; }
    if (key === "r" && builtIns.has("recap") && world.thoughts.length) { event.preventDefault(); core.requestRecap(); return; }
    if (key === "l" && heldQuestions.length) { event.preventDefault(); const top = heldQuestions[0]; dropHeld(top.id); top.later?.(); return; }
    if (key === "m" && view !== "map") { event.preventDefault(); showView("map"); }
    if (key === "e" && !world.threads.length && !world.thoughts.length && site.sample && core.connected) { event.preventDefault(); loadSample(); }
    if (key === "e" && builtIns.has("export") && (world.threads.length || world.thoughts.length)) { event.preventDefault(); exportMap(); }
  };
  useEffect(() => {
    if (!SHELL2) return;
    const onKey = (event: KeyboardEvent) => shellKey.current(event);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const spine = BRICKS.find((brick) => brick.info.id === "spine" && bricksOn.has("spine"));
  const talkExit = talk && <button type="button" className="talk-exit" onClick={() => {
    switchTalk(false);
    composerRef.current?.focus({ preventScroll: true });
  }}>All features</button>;

  // The classic page (`?shell=1`, kept for one release; `?cards` too), and the shell after it.
  if (!SHELL2) return (
    <MotionConfig reducedMotion="user">
    <AttentionProvider value={attention.value}>
    <WhyContext.Provider value={whyAsk}>
    <SpeechFixesContext.Provider value={speechFixes}>
    <StayProvider thread={world.stay_here ?? null} connected={core.connected} stay={core.stay}>
    <div className="app" onClickCapture={(event) => {
      const target = event.target as HTMLElement;
      if (hasAway && !target.closest(".away") && target.closest("button, a, summary")) away.dismiss();
    }} onChangeCapture={() => { if (hasAway) away.dismiss(); }}>
      {/* The page's first stop: Tab, then Enter, and you're typing (it took 46 Tabs past the header and the map). */}
      <a className="skip-link" href={`#${COMPOSER_ID}`} onClick={(event) => { event.preventDefault(); composerRef.current?.focus(); }}>Skip to Type a thought</a>
      {talkExit}
      <header ref={headerRef}>
        <div className="brand" data-slot="top-left">
          E2A2O
          {sessionCounts.thoughts > 0 && <span className="session-count">This session · {sessionCounts.thoughts} {sessionCounts.thoughts === 1 ? "thought" : "thoughts"} · {sessionCounts.threads} {sessionCounts.threads === 1 ? "topic" : "topics"}</span>}
        </div>
        <div className="header-actions" data-slot="top-right">
        <RoomControl speakers={world.thoughts.map((thought) => thought.speaker)} />
        {/* What you can say comes first: asking for this list by voice is how most people open it. */}
        <details className="shortcuts" open={helpOpen} onToggle={(event) => setHelpOpen(event.currentTarget.open)}><summary aria-label="Help: voice and keyboard commands" data-guide="help">?</summary><div ref={helpList} className="keyboard-hint">
          <strong>Say or type</strong>
          <div>“What can I say?” · opens this list</div>
          <div>“What just happened?” · the notices you may have missed, newest first, in Notification history</div>
          <div>“Where was I?” or “What was I thinking?” · back to where you left off</div>
          <div>“Next one” or “Last one” · the topic after or before yours in creation order, wrapping around</div>
          <div>These three also work at the end of a sentence: “…due Friday, where was I?” keeps your words</div>
          <div>“New topic” · your next thought starts one · “New topic about [words]” · starts it with those words</div>
          <div>“Add [words] to [topic]” · files them there at once; “…to the packing list” starts that list</div>
          <div>“Move that to [topic]” · your last thought goes there, or drag a point's Move onto a card · “Rename this to [title]” · or click a title · “Delete this” · the point you're on, else your last; or a point's Delete</div>
          <div>“Finish it”, “Later” or “Forget it” · the unfinished card's buttons</div>
          <div>“Stop showing this” · hide this kind of notice. “Show those again” · bring them back.</div>
          <div>“Expand [topic]” · opens it and every tangent · “Collapse this” · “Expand everything”</div>
          <div>“Pictures” or “Cards” · switch the view, as the buttons do · “Focus” or “Show all” · turn Focus on or off · “Focus on this” · the card you point at</div>
          <div>“Stay here” · everyone's new thoughts stay whole in this topic · “Let go” or × on Staying here · release it</div>
          <div>“Where did I talk about [topic]?” or “Go to the one about [topic]” · “Recap” or “Recap this session” · “Make an app that…”</div>
          <div>“Export my map” · saves it as a Markdown file, as Export does</div>
          <div>“Add it to Reminders” · the proposed reminder · “Keep it” · the app just built · “Stop listening” · tap the mic to talk again</div>
          <div>“No, I meant [request]” · redoes your last turn as that · “Scratch that” · undoes it · “Yes” or “No” · answers “Did you mean …?” · “this” · the card you selected or point at</div>
          <strong>Keyboard</strong>
          <div>? · opens or closes this list · Tab, then Enter · from the page's top, straight to typing</div>
          <div>Cards: / search · j / k move between topics · Enter show or hide · on a point · Enter or Space shows or hides the words you said · Option-click Show or Hide for every tangent · Esc fold quiet topics</div>
          <div>{undoKeyLabel(MAC)} · undoes your last turn, as “Scratch that” does, after its notice has gone too</div>
          <div>Pictures: arrow keys move · Enter open a topic</div>
          <div>Esc clears search or closes the Share menu when focused there</div>
          <div>Select map text with Shift + arrows, then Enter to explain · Esc dismisses it</div>
          <Symbols />
        </div></details>
        <button className="recap-button" data-guide="recap" onClick={(event) => { event.currentTarget.focus(); core.requestRecap(); }}>Recap</button>
        <ImportChats core={core} />
        {/* Import's other half, in its shape (an arrow out on a phone); once anything's said, placed or not. */}
        {(world.threads.length > 0 || world.thoughts.length > 0) && <button className="import-open" onClick={() => exportMap()} aria-label="Export map as Markdown" data-guide="export">
          <span className="import-long">Export</span>
          <span className="import-short"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5M4 17v3h16v-3" /></svg></span>
        </button>}
        <div className={stopMic ? "status capturing" : "status"} data-guide="status" data-slot="status">
          <span className={!core.connected ? "dot" : core.noKey ? "dot warn" : "dot ok"} role="img" aria-label={core.connected ? status : "Connecting"} />
          {/* On a phone, beside the header's buttons, the short form keeps it to one line; the dot's name says it all. */}
          <span aria-hidden="true">{core.connected && core.resting && !stopMic ? <><span className="status-long">{status}</span><span className="status-short">Back tomorrow</span></> : status}</span>
          {RECORDING && <TakeClock running={core.listening || !!core.partial || pending.length > 0} />}
        </div>
        </div>
      </header>

      <div id="tour-tools" />
      {!talk && <Apps core={core} />}
      <div id="tour-map" />
      <div className="sr-only" role="status">{friendlyNotice}</div>
      <div className="sr-only" role="status">{mapAnnouncement}</div>
      {/* Under the Apps pill, so an answer never covers it; it stays under the header as the map scrolls. Its notices
          and cards are one column (styles.css .notice-stack; on a phone or a short window the lane's own), so they
          stack instead of covering each other. */}
      <div ref={laneRef} className="notice-lane">
      <div className="notice-stack">
      <AnimatePresence>
        {core.notice && (
          <motion.div
            ref={noticeRef}
            className="notice"
            data-guide="notice"
            onFocus={() => setNoticeFocused(true)}
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setNoticeFocused(false); }}
            onMouseEnter={() => setNoticeHeld(true)}
            onMouseLeave={() => setNoticeHeld(false)}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <span>{friendlyNotice}</span>
            <UndoButton id={core.undoId} onUndo={core.undo} what={friendlyNotice} mac={MAC} offline={!core.connected} />
            <button onClick={core.clearNotice} aria-label="Dismiss notice">×</button>
          </motion.div>
        )}
      </AnimatePresence>

      {!talk && <>
      <SendCard card={core.sendCard} onStop={core.stopSend} onGone={core.sendCardGone} />
      <PullsCard card={core.pullsCard} onGone={core.pullsCardGone} />
      <NoteCard card={core.noteCard} onOpen={core.openNote} onGone={core.noteCardGone} />
      </>}

      {core.mapChange && (
        <div className="map-change" {...mapHold}>
          {core.mapChange.ai && <span aria-hidden="true" data-tip={core.mapChange.refined ? TIPS.mapRefined : TIPS.mapChange}>✦</span>} {core.mapChange.text}
          {(core.mapChange.undo || core.mapChange.restore) && <button className="undo" disabled={!core.connected} onClick={() => { core.untidy(core.mapChange!.undo ?? []); core.restore(core.mapChange!.restore ?? []); core.hideMapChange(); }}>Undo</button>}
          <button onClick={core.hideMapChange} aria-label="Dismiss map update">×</button>
        </div>
      )}
      </div>
      </div>

      <Explain explanations={core.explanations} explain={core.explain} mark={core.mark} />

      {!talk && world.threads.length > 0 && <nav ref={toolsRef} className="map-tools" aria-label="Map navigation">
        <div className="map-tools-inner">
          <div className="palace-switch" role="group" aria-label="View" data-guide="views">
            <button aria-pressed={view === "map"} onClick={() => showView("map")} data-guide="view:map">Cards</button>
            <button aria-pressed={view === "palace"} onClick={() => showView("palace")} data-guide="view:palace">Pictures</button>
            {viewBricks.map((brick) => <button key={brick.info.id} aria-pressed={view === brick.info.id} onClick={() => showView(brick.info.id)} data-guide={`view:${brick.info.id}`}>{brick.info.name}</button>)}
          </div>
          {view === "map" && <><label className="search" data-guide="search"><span className="sr-only">Search topics</span><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setQuery(""); event.currentTarget.blur(); } }} placeholder="Search topics" type="search" /></label>
          {/* With one thread, Focus and Back to active would show the screen you already have. Focus keeps its name
              while on: pressed is its state, as a toggle button's is. */}
          {world.threads.length > 1 && <button aria-pressed={focusMode} onClick={() => { setFocusMode((value) => !value); setQuery(""); }} disabled={!world.active} data-guide="focus">Focus</button>}
          {world.threads.length > 1 && world.active && <button className="back-to-active" onClick={jumpToActive} data-guide="back-to-active">Back to current</button>}
          </>}
        </div>
        {view === "map" && search && <div className="search-summary" role="status">{matches.size} {matches.size === 1 ? "topic" : "topics"} found <button onClick={() => setQuery("")}>Clear</button></div>}
      </nav>}
      {talk && spine ? <BrickMount brick={spine} host={brickHost} />
        : view === "palace" && world.threads.length > 0 ? <Palace threads={world.threads} active={world.active} onOpen={goBack} />
        : viewBrick && world.threads.length > 0 ? <BrickMount brick={viewBrick} host={brickHost} /> : <main ref={mapRef} className={talking && world.active && !search ? "map talking" : "map"} aria-label="Cards" data-guide="map">
        {/* Before the first snapshot the world is the empty one: nothing, not a welcome to a map that isn't empty. */}
        {world.threads.length === 0 ? (
          core.snapshotRevision === 0 ? null : <div className="empty">
            <h1>Think out loud.</h1>
            <p>{emptyLine({ starting: startingMic, listening: core.listening, pending: pending.length, noKey: core.noKey, resting: core.resting })}</p>
            {!core.listening && !pending.length && <p className="empty-hint">Tap the mic to talk, or type below and press Enter.</p>}
            {/* A newcomer sees a full map at once, if they'd rather look around first (core/src/sample.rs). */}
            {site.sample && !core.listening && !pending.length && !world.thoughts.length && <p className="empty-sample">
              <button type="button" className="sample-button" onClick={() => core.sample()} disabled={!core.connected}>See an example</button>
              <span>A student's week, with pictures. Add your own thoughts.</span>
              {moreSamples(site.samples).length > 0 && <span className="more-samples" role="group" aria-label="Shorter sample maps">
                <span>Or a shorter one:</span>
                <span className="sample-links">{moreSamples(site.samples).map((choice) =>
                  <button key={choice.id} type="button" className="sample-link" onClick={() => core.sample(choice.id)} disabled={!core.connected}>{choice.label}</button>)}</span>
              </span>}
            </p>}
            {!core.noKey && modelsLine(site.models) && <p className="empty-models">{modelsLine(site.models)}</p>}
          </div>
        ) : (
          <NotesContext.Provider value={notes}>
          <TidyProvider world={world} decide={core.tidy}>
          <MovesProvider threads={world.threads} move={core.move} rename={core.rename} remove={core.remove}>
          <MapCards active={world.active} rooms={rooms} activePath={activePath} childrenByParent={children} thoughtsByThread={thoughtsByThread} ideasByThread={ideasByThread} actionsByThread={actionsByThread} held={held} expanded={expanded} setExpanded={setExpanded} keptOpen={keptOpen} on={on} />
          </MovesProvider>
          </TidyProvider>
          </NotesContext.Provider>
        )}
      </main>}

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
      <section ref={dockRef} className={view === "palace" ? "dock in-palace" : "dock"} aria-label="Your thoughts">
        <div className="dock-inner">
          <div className="sr-only" role="status" aria-live="polite">{hasAway ? "Since you left. Your thoughts are ready to explore above the input box." : ""}</div>
          {!talk && <>
          <NotesContext.Provider value={notes}>
          <Away queue={core.noticeQueue} items={away.items} onDismiss={away.dismiss} onDismissFocus={() => composerRef.current?.focus({ preventScroll: true })} onFollow={(item) => {
            jumps.jumped(world, item.threadId);
            core.focus(item.threadId);
            reveal(item.threadId, item.thoughtId ?? null, item.itemId);
            away.dismiss();
          }} />
          </NotesContext.Provider>
          <AnimatePresence>
            {pullBack && (
              <motion.div
                key={dropKey(pullBack)}
                className="pullback" role="status" data-dock-card data-guide="unfinished"
                {...pullBackHold}
                style={roomStyle(rooms.get(pullBack.id))}
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
                  {lastWords && <UnfinishedQuote key={pullBackKey} text={lastWords} />}
                </div>
                <div className="pullback-actions">
                  <button onClick={() => finishThread(pullBack)}>Finish it</button>
                  {/* Feedback catalog: goBack(pullBack)'s navigation, with composer focus for the next words. */}
                  <button className="quiet" onClick={() => later(pullBack)}>
                    Later
                  </button>
                  <button className="quiet" onClick={() => forget(pullBack)}>Forget it</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {/* Under the unfinished card, both needing you: the app you just asked for sits nearest your words, and the
              unfinished card rising or going above it doesn't move its Keep (the dock grows upward). */}
          <DockBuild core={core} dismissed={buildGone} onLeave={() => composerRef.current?.focus({ preventScroll: true })} />
          <DockTune core={core} />
          {core.queuedCount > 0 && <div className="first-hint" role="status">{core.queuedCount} {core.queuedCount === 1 ? "thought" : "thoughts"} waiting to send when connected.</div>}
          {firstNotice.visible && <div {...firstNotice.hold} className="first-hint">Got it. Keep going, or start a new topic.</div>}
          <AttentionNote onGo={attention.go} />
          <BrickSlot kind="card" host={brickHost} />
          {install && <InstallHint queue={core.noticeQueue} hint={install} onLeave={() => composerRef.current?.focus({ preventScroll: true })} />}
          </>}
          {/* One span: the live line rolls up as one block (legible.css), with "· this: …" running on after the words. */}
          {showsLiveLine({ words: !!(core.partial || core.handoff), pending: pending.length, listening: core.listening, starting: startingMic, wordsElsewhere, view }) && <div className={core.partial || core.handoff ? "live words" : "live"}><span><Markdown text={liveLine(core.partial || core.handoff, startingMic)} /><ThisEcho /></span></div>}
          <div className="pending" data-guide="pending">
            {pending.map((t) => (
              <PendingThought key={t.id} thought={t} placing={core.placing} noKey={core.noKey} refused={core.keyRefused} resting={core.resting} reducedMotion={!!reducedMotion} words={!bricksOn.has("bubble-flight")} />
            ))}
          </div>
          <div id="tour-composer" />
          <form className="composer" onSubmit={submit} data-guide="composer">
            <textarea
              rows={1}
              id={COMPOSER_ID}
              ref={composerRef}
              value={draft}
              onKeyDown={submitOnEnter}
              enterKeyHint="send"
              onChange={(e) => { typedSinceSend.current = true; setDraft(e.target.value); }}
              placeholder={composerHint(mic)}
              aria-label="Type a thought"
            />
            <ModelLine hearing={!!core.partial} hidden={!!draft} />
            <MicButton state={mic} capturing={!!stopMic} disabled={startingMic || (!core.connected && !stopMic)} onClick={toggleMic} />
          </form>
        </div>
      </section>
      {!talk && core.snapshotRevision > 0 && <Tour populated={world.threads.length > 0} noKey={core.noKey} resting={core.resting} />}
      <BrickSlot kind="panel" host={brickHost} />
      {!talk && <TalkRail host={brickHost} />}
      <BrickSlot kind="input" host={brickHost} />
      {!talk && <Tips />}
      {!talk && <Catalog />}
      {/* Another participant pointing at a part of the screen, or saying a caption (docs/guide.md). */}
      <Guide world={world} view={view} query={query} focus={focusMode} />
      <Recap view={talk ? null : core.recap.view} world={world} connected={core.connected} noKey={core.noKey} resting={core.resting} listening={core.listening} onRequest={core.requestRecap} onMark={core.mark} onClose={core.recap.close} onFocus={(id) => {
        const thread = world.threads.find((t) => t.id === id);
        if (thread) goBack(thread);
        requestAnimationFrame(() => {
          const target = document.getElementById(`thread-${id}`)?.querySelector<HTMLButtonElement>(".thread-toggle");
          target?.focus({ preventScroll: true });
        });
      }} />
    </div>
    </StayProvider>
    </SpeechFixesContext.Provider>
    </WhyContext.Provider>
    </AttentionProvider>
    </MotionConfig>
  );

  // The shell (the default, shell/): four corners, the stage, the status line, the rail.
  const empty = world.threads.length === 0;
  // The first open's composer: a bigger mic and "Tap to talk", until the first tap or the first thought.
  const big = listeningOn && !world.thoughts.length && !stopMic && !startingMic && !draft;
  const stalled = pending.find((t) => core.placing.retryAt[t.id] !== undefined) ?? (core.noKey || core.keyRefused || core.resting ? pending[0] : undefined);
  const aiNames = new Set(world.ai ?? []);
  const findResults = search ? [...matches].slice(0, 6).map((id) => threadById.get(id)).filter((t): t is Thread => !!t)
    .map((thread) => ({ thread, points: thoughtsByThread.get(thread.id)?.length ?? 0 })) : [];
  // A view's Show: takes you to it, and the rail gets out of its way (a sheet over it on a phone; on a laptop it covers
  // the cards' right-hand column, where the buttons are).
  const openView = (id: string) => { setRailTab(null); showView(id); };
  const rows: CatalogRow[] = [
    { id: "preset-talk", kind: "panel" as const, name: "Talk", does: "Keep just what you need to talk. Turn off to bring your features back.",
      on: talk, core: false, toggle: switchTalk },
    ...BRICKS.map(({ info }): CatalogRow => {
      const named = FEATURE_NAMES[info.id];
      return { id: info.id, kind: info.kind, name: named?.name ?? info.name, aka: named?.aka, does: named?.does ?? info.does, lives: named?.lives,
        on: bricksOn.has(info.id), core: isCore(info.id), toggle: (value) => switchBrick(info.id, value),
      show: info.kind === "view" && info.id !== "spine" && bricksOn.has(info.id) ? () => openView(info.id) : undefined };
    }),
    ...BUILT_INS.map((b): CatalogRow => {
      const named = FEATURE_NAMES[b.id];
      const shows = b.id === "cards" ? "cards" : b.id === "pictures" ? "palace" : null;
      return { id: b.id, kind: b.kind, name: named.name, aka: named.aka, does: named.does ?? "", lives: named.lives, on: builtIns.has(b.id), core: false,
        toggle: (value) => { switchBuiltIn(b.id, value); if (!value && shows === view) showView("map"); }, show: shows && builtIns.has(b.id) ? () => openView(shows) : undefined };
    }),
    ...world.apps.map((app): CatalogRow => ({ id: `app-${app.id}`, kind: "app", name: app.name, does: app.purpose, on: app.enabled, core: false,
      toggle: (value) => core.toggleApp(app.id, value), disabled: !core.connected })),
  ].sort((a, b) => Number(b.core) - Number(a.core) || a.name.localeCompare(b.name));
  const undoEntry = (entry: Entry) => {
    const undo = entry.undo;
    if (!undo) return;
    if (undo.kind === "turn") core.undo(undo.id);
    else if (undo.kind === "change") { core.untidy(undo.undo); core.restore(undo.restore); }
    else core.remove(undo.thoughtId);
    history.markUndone(entry.n);
  };
  const show = (id: string) => {
    const thread = threadById.get(resolveMerged(world, id));
    if (!thread) return;
    if (phone) setRailTab(null);
    goBack(thread);
  };
  const keys: [string, string][] = [
    ["/", "Find a topic or words"], [mod("D"), "Start or stop listening"], [RAIL_KEYS.talk, "Talk: what's said, as turns"],
    [RAIL_KEYS.history, "History: what happened, with Undo"], [RAIL_KEYS.catalog, "Features: turn features on or off"], [RAIL_KEYS.settings, "Settings"],
    ...(builtIns.has("recap") ? [["R", "Recap this session"] as [string, string]] : []), [mod("Z"), "Undo your last turn"], ["esc", "Close the panel"],
  ];
  const tabs: RailTab[] = callOn(call) ? ["history", "catalog", "settings"] : ["talk", "history", "catalog", "settings"];
  return (
    <MotionConfig reducedMotion="user">
    <AttentionProvider value={attention.value}>
    <WhyContext.Provider value={whyAsk}>
    <SpeechFixesContext.Provider value={speechFixes}>
    <StayProvider thread={world.stay_here ?? null} connected={core.connected} stay={core.stay}>
    <div className="app shell" onClickCapture={(event) => {
      const target = event.target as HTMLElement;
      if (hasAway && !target.closest(".away") && target.closest("button, a, summary")) away.dismiss();
    }} onChangeCapture={() => { if (hasAway) away.dismiss(); }}>
      <a className="skip-link" href={`#${COMPOSER_ID}`} onClick={(event) => { event.preventDefault(); composerRef.current?.focus(); }}>Skip to Type a thought</a>
      {talkExit}
      <TopLeft mapName={inCall ? NAMES.map.call : NAMES.map.alone} mode={mode} wordmark={!phone || empty} />
      <TopRight>
        {!empty && <Find inputRef={searchRef} query={query} setQuery={setQuery} results={findResults} go={(thread) => goBack(thread)} />}
        {builtIns.has("export") && (world.threads.length > 0 || world.thoughts.length > 0) &&
          <CornerButton icon="export" label={NAMES.export} keyName="E" keyAria="E" onClick={() => exportMap()} guide="export" />}
        {builtIns.has("import") && <ImportChats core={core} />}
        <CornerButton icon="catalog" label={NAMES.catalog} keyName={RAIL_KEYS.catalog} keyAria={RAIL_KEYS.catalog} pressed={railTab === "catalog"}
          onClick={() => toggleTab("catalog")} guide="catalog" controls="shell-tabpanel" />
        <RoomControl speakers={world.thoughts.map((thought) => thought.speaker)} />
      </TopRight>

      <div className="sr-only" role="status">{friendlyNotice}</div>
      <div className="sr-only" role="status">{mapAnnouncement}</div>
      <Explain explanations={core.explanations} explain={core.explain} mark={core.mark} />

      {!talk && view === "palace" && !empty ? <Palace threads={world.threads} active={world.active} onOpen={goBack} />
        : !talk && view === "cards" && !empty ? <main ref={mapRef} className="map" aria-label="Cards" data-guide="map">
          <NotesContext.Provider value={notes}><TidyProvider world={world} decide={core.tidy}><MovesProvider threads={world.threads} move={core.move} rename={core.rename} remove={core.remove}>
            <MapCards active={world.active} rooms={rooms} activePath={activePath} childrenByParent={children} thoughtsByThread={thoughtsByThread} ideasByThread={ideasByThread} actionsByThread={actionsByThread} held={held} expanded={expanded} setExpanded={setExpanded} keptOpen={keptOpen} on={on} />
          </MovesProvider></TidyProvider></NotesContext.Provider>
        </main>
        : !talk && viewBrick && viewBrick.info.id !== "spine" && !empty ? <BrickMount brick={viewBrick} host={brickHost} />
        : !empty && spine ? <BrickMount brick={spine} host={brickHost} />
        : <main ref={mapRef} className="shell-main" aria-label="Your map" data-guide="map">
          {/* Before the first snapshot the world is the empty one: nothing, not a welcome to a map that isn't empty. */}
          {core.snapshotRevision > 0 && empty && <Welcome models={!core.noKey ? modelsLine(site.models) : ""} sample={site.sample && !core.listening && !pending.length && !world.thoughts.length
            ? <p className="shell-samples">
              <button type="button" className="shell-btn shell-sample" onClick={() => loadSample()} disabled={!core.connected} aria-keyshortcuts="E">See an example<Keycap>E</Keycap></button>
              <span>A student's week. Add your own thoughts.</span>
            </p> : null} />}
          {!empty && !spine && <p className="shell-empty-line">{NAMES.findNone}</p>}
        </main>}
      {view !== "map" && <div className="shell-corner shell-bl" data-slot="bottom-left">
        <button type="button" className="shell-pill shell-button" onClick={() => showView("map")} aria-keyshortcuts="M">
          <Icon name="back" /><span className="shell-label">{NAMES.backToMap}</span><Keycap>M</Keycap>
        </button>
      </div>}

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
      <footer ref={dockRef} className="dock shell-dock">
      {/* Cards, notices and captions stay above the bottom bar's input row. */}
      <section className="shell-stage" data-slot="stage" aria-label="Your thoughts">
        <div className="shell-cards" hidden={talk}>
          <NotesContext.Provider value={notes}>
          <Away queue={core.noticeQueue} items={away.items} onDismiss={away.dismiss} onDismissFocus={() => composerRef.current?.focus({ preventScroll: true })} onFollow={(item) => {
            jumps.jumped(world, item.threadId);
            core.focus(item.threadId);
            reveal(item.threadId, item.thoughtId ?? null, item.itemId);
            away.dismiss();
          }} />
          </NotesContext.Provider>
          {pullBack && <div className="pullback" role="status" data-dock-card data-guide="unfinished" style={roomStyle(rooms.get(pullBack.id))} {...pullBackHold}>
            <ThreadPicture thread={pullBack} />
            <div className="pullback-text">
              <div className="pullback-title">You didn't finish <b>{pullBack.title}</b></div>
              {lastWords && <UnfinishedQuote key={pullBackKey} text={lastWords} />}
            </div>
            <div className="pullback-actions">
              <button onClick={() => finishThread(pullBack)} aria-keyshortcuts="Enter">Finish it</button>
              {/* Feedback catalog: goBack(pullBack)'s navigation, with composer focus for the next words. */}
              <button className="quiet" onClick={() => later(pullBack)} aria-keyshortcuts="L">Later</button>
              <button className="quiet" onClick={() => forget(pullBack)}>Forget it</button>
            </div>
          </div>}
          <DockBuild core={core} dismissed={buildGone} onLeave={() => composerRef.current?.focus({ preventScroll: true })} />
          <DockTune core={core} />
          <AttentionNote onGo={attention.go} />
          <BrickSlot kind="card" host={brickHost} />
          {install && <InstallHint queue={core.noticeQueue} hint={install} onLeave={() => composerRef.current?.focus({ preventScroll: true })} />}
          <SendCard card={core.sendCard} onStop={core.stopSend} onGone={core.sendCardGone} />
          <PullsCard card={core.pullsCard} onGone={core.pullsCardGone} />
          <NoteCard card={core.noteCard} onOpen={core.openNote} onGone={core.noteCardGone} />
        </div>
        {/* With History open, a notice is its newest line there, with its Undo: not said twice. */}
        <AnimatePresence>
          {core.notice && (talk || railTab !== "history") && !aboutKey(core.notice) && (
            <motion.div ref={noticeRef} className="notice" data-guide="notice" role="status"
              onFocus={() => setNoticeFocused(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setNoticeFocused(false); }}
              onMouseEnter={() => setNoticeHeld(true)} onMouseLeave={() => setNoticeHeld(false)}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <span>{friendlyNotice}</span>
              <UndoButton id={core.undoId} onUndo={core.undo} what={friendlyNotice} mac={MAC} offline={!core.connected} />
              <button className="shell-rail-close" onClick={core.clearNotice} aria-label="Dismiss notice" aria-keyshortcuts="Escape"><Icon name="close" /></button>
            </motion.div>
          )}
        </AnimatePresence>
        {core.mapChange && !core.notice && (talk || railTab !== "history") && <div className="map-change" role="status" {...mapHold}>
          <span>{core.mapChange.ai && <span aria-hidden="true" className="ai-mark" data-tip={core.mapChange.refined ? TIPS.mapRefined : TIPS.mapChange}>✦ </span>}{core.mapChange.text}</span>
          {(core.mapChange.undo || core.mapChange.restore) && <button className="undo" disabled={!core.connected} aria-keyshortcuts={modAria("Z")}
            onClick={() => { core.untidy(core.mapChange!.undo ?? []); core.restore(core.mapChange!.restore ?? []); core.hideMapChange(); }}>Undo</button>}
          <button className="shell-rail-close" onClick={core.hideMapChange} aria-label="Dismiss map update" aria-keyshortcuts="Escape"><Icon name="close" /></button>
        </div>}
        <div className="shell-captions" id="shell-caption" />
      </section>

      <StatusLine openHistory={() => toggleTab("history")} state={{
        mic, typingOnly: !listeningOn, hosted: site.hosted, since: micSince, now, call: inCall,
        first: !world.thoughts.length, waiting: pending.length,
        stalled: stalled ? pendingLabel(stalled, core.placing, now, core.noKey, core.keyRefused, core.resting) : "",
        queued: core.queuedCount, connected: core.connected,
      }}>
        <form className={big ? "shell-composer shell-composer-big" : "shell-composer"} onSubmit={submit} data-guide="composer">
          {listeningOn && <MicButton state={mic} capturing={!!stopMic} disabled={startingMic || (!core.connected && !stopMic)} onClick={toggleMic} shortcut={modAria("D")} />}
          {big && <span className="shell-composer-label">{NAMES.composer.firstTap}</span>}
          <textarea rows={1} id={COMPOSER_ID} ref={composerRef} value={draft} onKeyDown={submitOnEnter} enterKeyHint="send"
            onChange={(e) => { typedSinceSend.current = true; setDraft(e.target.value); }}
            placeholder={big ? NAMES.composer.firstType : inCall ? NAMES.composer.call : NAMES.composer.idle} aria-label="Type a thought" aria-keyshortcuts="Enter" />
          {listeningOn && <Keycap>{mod("D")}</Keycap>}
        </form>
      </StatusLine>
      </footer>

      <div className="shell-corner shell-br" data-slot="bottom-right">
        <HeldStack phone={phone} answerFallback={() => composerRef.current?.focus()} />
      </div>

      {!talk && railTab && <Rail tab={railTab} setTab={setRailTab} close={() => setRailTab(null)} tabs={tabs}>
        {/* Talk: lane L5's call (people, turns, the read line, the level meter) takes this line's place. */}
        {railTab === "talk" && <TalkTurns thoughts={world.thoughts} me={me} ai={aiNames} />}
        {railTab === "history" && <HistoryTab entries={history.entries} undoId={core.undoId} now={now} onUndo={undoEntry} onShow={show}
          recap={builtIns.has("recap") && world.thoughts.length ? () => core.requestRecap() : null} />}
        {railTab === "catalog" && <CatalogTab rows={rows} at={catalogAt?.id ?? null} />}
        {railTab === "settings" && <SettingsTab keys={keys} say={<ShellSay />} />}
      </Rail>}

      {!talk && <TalkRail host={brickHost} />}
      {/* Floating features; the Notice timeline's list is History's here. */}
      {BRICKS.filter((brick) => (brick.info.kind === "panel" || brick.info.kind === "input") && bricksOn.has(brick.info.id) && brick.info.id !== "notice-timeline")
        .map((brick) => <BrickMount key={brick.info.id} brick={brick} host={brickHost} />)}
      {!talk && <Tips />}
      <Guide world={world} view={view} query={query} focus={focusMode} />
      <Recap view={talk ? null : core.recap.view} world={world} connected={core.connected} noKey={core.noKey} resting={core.resting} listening={core.listening} onRequest={core.requestRecap} onMark={core.mark} onClose={core.recap.close} onFocus={(id) => {
        const thread = world.threads.find((t) => t.id === id);
        if (thread) goBack(thread);
      }} />
    </div>
    </StayProvider>
    </SpeechFixesContext.Provider>
    </WhyContext.Provider>
    </AttentionProvider>
    </MotionConfig>
  );
}

/** What you can say, in the new shell's Settings: the voice commands people use most, in plain words. */
function ShellSay() {
  return <>
    <div>“Where was I?” · back to where you left off</div>
    <div>“Next one” or “Last one” · the topic after or before yours</div>
    <div>“New topic about …” · starts one with those words</div>
    <div>“Stay here” · everyone's new thoughts stay whole here · “Let go” · release</div>
    <div>“Add … to …” · files the words there at once</div>
    <div>“Move that to …” · “Rename this to …” · “Delete this”</div>
    <div>“What just happened?” · opens History</div>
    <div>“Recap” · a summary of this session</div>
    <div>“Make an app that …” · one made for you to keep or not</div>
    <div>“Scratch that” or {undoKeyLabel(MAC)} · undoes your last turn</div>
    <div>“Stop listening” · the mic stops; tap it to talk again</div>
  </>;
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
/** Every thread under `id`, however deep. */
function branchesUnder(threads: Thread[], id: string): string[] {
  const out: string[] = [];
  const queue = [id];
  while (queue.length) {
    const parent = queue.shift();
    for (const thread of threads) {
      if (thread.parent_id === parent && thread.id !== id && !out.includes(thread.id)) { out.push(thread.id); queue.push(thread.id); }
    }
  }
  return out;
}

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
function useHeightVar(ref: RefObject<HTMLElement | null>, name: string, present = true, below = 0) {
  const publish = (element: HTMLElement) => {
    const height = `${element.offsetHeight + below}px`;
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

/** Where the map shows clear of what's pinned over it: under the header, the tools row and, on a phone or a short
 *  window, the stack of notices (a lane of its own height there; the laptop's lane has no height, so it's left out). */
function mapTop() {
  const bars = Array.from(document.querySelectorAll<HTMLElement>("header, .map-tools, .notice-lane"))
    .filter((bar) => !bar.classList.contains("notice-lane") || (bar.offsetHeight > 0 && !!bar.querySelector(".notice-stack > *")));
  return Math.max(0, ...bars.map((bar) => bar.getBoundingClientRect().bottom));
}

/** The least height a notice shows whole in: its own, but for the message card, whose words scroll (send-card.css), its
 *  heading, Stop and one line of words. Read from its parts: its own height may be what the lane's cap left it. */
function leastHeight(notice: HTMLElement) {
  const text = notice.querySelector<HTMLElement>(":scope > .send-card-text");
  if (!text) return notice.offsetHeight;
  const px = (value: string) => parseFloat(value) || 0;
  const card = getComputedStyle(notice), words = getComputedStyle(text);
  let total = px(card.paddingTop) + px(card.paddingBottom) + px(card.borderTopWidth) + px(card.borderBottomWidth);
  for (const part of Array.from(notice.children) as HTMLElement[]) {
    if (part === text) total += px(words.lineHeight) + px(words.marginTop) + px(words.marginBottom);
    else if (getComputedStyle(part).position !== "absolute") total += part.offsetHeight;
  }
  return Math.ceil(total);
}

/** Where the notice lane may be, and the room its notices and cards share (styles.css). --lane-top, on a phone or a
 *  short window: just under the header, or 8 px from the top once a short window's header has scrolled away (there the
 *  lane is fixed: in the flow, the tour above it left it 22 px). --lane-room: from where the lane is to the dock's top,
 *  less 8 px of air. On a laptop all of it bounds the lane's column (.notice-stack), and past it the GitHub list and the
 *  note's points scroll inside their cards: with ten pull requests, a note and a message up at once, the note card ran
 *  335 px past a 900 px window and the GitHub card covered the composer (scripts/lane-check.mjs). On a phone or a short
 *  window the lane itself is the stack: never under the composer (at 320 × 568 the message card's Stop was under the
 *  mic), and at most half of the room, so the map keeps a band to show a point in. Measured on scroll too, as the lane
 *  moves up to stick. A fixed lane also goes below the tour's tip while it's on screen (scripts/phone-check.mjs). */
function useLaneRoom(ref: RefObject<HTMLElement | null>, headerRef: RefObject<HTMLElement | null>, dockRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const lane = ref.current;
    if (!lane) return;
    // Where the lane itself stacks the notices (styles.css); a laptop's lane has no height and its column hangs from it.
    const stacked = window.matchMedia("(max-width: 560px), (max-height: 560px)");
    let frame = 0;
    const set = (name: string, px: number) => { if (lane.style.getPropertyValue(name) !== `${px}px`) lane.style.setProperty(name, `${px}px`); };
    const measure = () => {
      frame = 0;
      const dock = dockRef.current?.getBoundingClientRect().top ?? window.innerHeight;
      const fixed = getComputedStyle(lane).position === "fixed";
      let laneTop = Math.max(8, Math.round((headerRef.current?.getBoundingClientRect().bottom ?? 0) + 6));
      // A fixed lane goes under the tour's tip while you're in it (focus is: each step focuses its Next) and it's on
      // screen: on its side, the stack covered its words and Next. Where both don't fit, the first notice stays whole
      // and covers only the tip's foot. Once you're on the map (a point tapped), the map's band comes first.
      // The first notice as it's drawn (the message card comes first by its CSS order), and the least it shows whole in.
      const notices = Array.from(lane.querySelector(":scope > .notice-stack")?.children ?? []) as HTMLElement[];
      const first = notices.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
      const least = first ? leastHeight(first) : 0;
      const tip = fixed ? document.querySelector(".tour-tip") : null;
      const tour = tip?.contains(document.activeElement) ? tip.getBoundingClientRect() : undefined;
      if (tour && tour.bottom > laneTop && tour.top < dock) laneTop = Math.max(laneTop, Math.round(Math.min(tour.bottom + 6, dock - 16 - least)));
      set("--lane-top", laneTop);
      // A laptop's lane, fixed or not, is where its own CSS puts it (it reads no --lane-top).
      const top = fixed && stacked.matches ? laneTop : Math.max(0, lane.getBoundingClientRect().top);
      // On a phone or a short window the stack gets at most half of what's left above the dock, the map the rest: at
      // 320 × 568 and on its side three notices took it all, and a point tapped or landing had nowhere to show. The
      // first notice always shows whole (the message card's Stop), and the rest scroll in the lane.
      const left = Math.max(0, Math.floor(dock - top - 8));
      set("--lane-room", stacked.matches ? Math.min(left, Math.max(least + 16, Math.floor(left / 2))) : left);
    };
    const soon = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    // What moves the lane, the header or the dock without a scroll: the Apps panel, the tour, a dock card, a notice.
    const observer = new ResizeObserver(soon);
    for (const element of [document.body, lane, headerRef.current, dockRef.current]) if (element) observer.observe(element);
    window.addEventListener("scroll", soon, { passive: true });
    window.addEventListener("resize", soon);
    document.addEventListener("focusin", soon);
    document.addEventListener("focusout", soon);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", soon);
      window.removeEventListener("resize", soon);
      document.removeEventListener("focusin", soon);
      document.removeEventListener("focusout", soon);
    };
  }, []);
}

/** The room the page's end leaves for the dock, as --dock-room: the map and the Palace pad their ends with it. It
 *  grows with the dock at once; when the dock shrinks (a card goes), it gives back only what is below the screen, and
 *  the rest as you scroll up. A page at its end used to get shorter by all the dock gave back, which pulled the map
 *  down in one frame: 78 px as the unfinished card went (rough cut, take 2, 56.4 s), 74 px as a build's card went
 *  (1440×900). */
function useDockRoom(ref: RefObject<HTMLElement | null>) {
  const room = useRef(0);
  const set = (next: number) => {
    room.current = next;
    document.documentElement.style.setProperty("--dock-room", `${next}px`);
  };
  const fit = useRef(() => {
    const dock = ref.current;
    if (!dock) return;
    const height = dock.offsetHeight;
    const page = document.documentElement;
    const below = Math.max(0, Math.floor(page.scrollHeight - window.innerHeight - window.scrollY));
    const next = height >= room.current ? height : Math.max(height, room.current - below);
    if (next !== room.current) set(next);
  }).current;
  useLayoutEffect(fit);
  useEffect(() => {
    const dock = ref.current;
    if (!dock) return;
    const observer = new ResizeObserver(fit);
    observer.observe(dock);
    window.addEventListener("scroll", fit, { passive: true });
    window.addEventListener("resize", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
      room.current = 0;
      document.documentElement.style.removeProperty("--dock-room");
    };
  }, []);
  return useMemo(() => ({
    /** The room the page's end leaves now. */
    now: () => room.current,
    /** At least this much again (a place saved with the room it had), given back as you scroll up. */
    hold: (px: number) => { if (px > room.current) set(px); },
  }), []);
}

/** How a dismissed suggestion or action leaves: a 150 ms fade, as a card's body folds (ThreadCard). A fade isn't motion,
 *  so it stays under Reduce Motion, where the rows below snap up instead of gliding (MotionConfig "user"). */
const EXIT = { opacity: 0, transition: { duration: 0.15 } };

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
  active: string | null; on: Handlers; activePath: Set<string>; rooms: Map<string, string>;
  childrenByParent: Map<string | null, Thread[]>; thoughtsByThread: Map<string, Thought[]>;
  ideasByThread: Map<string, Suggestion[]>; actionsByThread: Map<string, Action[]>;
  /** Found cards search holds open (search-rules.ts). */
  held: Set<string>; expanded: Record<string, boolean>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  keptOpen: React.MutableRefObject<Set<string>>;
};

// The composer, live transcript and pull-back timer update independently of the map.
const MapCards = memo(function MapCards(props: MapProps) {
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

  const toggle = (event: React.MouseEvent) => {
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

function UnfinishedQuote({ text }: { text: string }) {
  const quote = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [more, setMore] = useState(false);
  useLayoutEffect(() => {
    const el = quote.current;
    if (!el || expanded) return;
    const measure = () => setMore(el.scrollHeight > el.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, expanded]);
  return <>
    <div ref={quote} className="pullback-quote" data-expanded={expanded}>“<Markdown text={text} />”</div>
    {more && <button type="button" className="pullback-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      {expanded ? "Show less" : "Show more"}
    </button>}
  </>;
}

/** A thread's picture slot, there from the start with the thread's first letter (as in the Palace): a picture that
 *  arrives later fades in over it once decoded and moves nothing; one that fails to load leaves the letter (the
 *  rule in pictures.ts). A card used to grow 5–19 px when its picture came, its title sliding right, and a picture
 *  that failed showed a broken-image glyph. ✦ marks a picture only once one shows. */
function ThreadPicture({ thread, marked = false }: { thread: Thread; marked?: boolean }) {
  const { shown, img } = usePicture(thread.picture ? [thread.picture] : []);
  return (
    <span className="picture-wrap">
      <span className="picture picture-letter" aria-hidden="true">{firstLetter(thread.title)}</span>
      {img && <img key={img.src} {...img} className={`picture ${img.className}`} />}
      {marked && shown && <span className="picture-mark" role="img" aria-label="AI-generated picture" data-tip={TIPS.picture}>✦</span>}
    </span>
  );
}

const Point = memo(function Point({ thought, heads, on }: { thought: Thought; heads: Thought[]; on: Handlers }) {
  // Your own thoughts need no name; anyone else's (a person in the room, or Claude) shows who said it.
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
  const toggle = said ? (event: React.MouseEvent) => {
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
function Fixes({ thought, on }: { thought: Thought; on: Handlers }) {
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

/** A thought on its way to the map, and honestly where it stands (`pendingLabel`). */
/** `words`: false while a flight carries them (Bubble flight), so the pill says only where it stands, not them twice. */
function PendingThought({ thought, placing, noKey, refused, resting, reducedMotion, words = true }: { thought: Thought; placing: Placing; noKey: boolean; refused: boolean; resting: boolean; reducedMotion: boolean; words?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (noKey || refused) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [noKey, refused]);
  const retryAt = placing.retryAt[thought.id];
  const label = pendingLabel(thought, placing, now, noKey, refused, resting);
  // The race (placer.rs `RACE`): one dot a call, while they run; the first good answer places it.
  const lanes = useLanes(thought.id);
  return <motion.span layoutId={reducedMotion ? undefined : thought.id} initial={false} className="pill">
    <span className={retryAt !== undefined && placing.now !== thought.id ? "pending-label retrying" : "pending-label"}>{label}</span>
    {lanes > 1 && <span className="lanes" title={`${lanes} calls race: the first good answer places it`}>{Array.from({ length: lanes }, (_, i) => <i key={i} aria-hidden="true" />)}<span className="sr-only">{lanes} calls racing</span></span>} {words && <Markdown text={thought.text} />}
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
