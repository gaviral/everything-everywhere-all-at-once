import { connectReplyFormat, receiveReplyFormat, resetReplyFormat, stopReplyFormat } from "./ReplyFormat";
import { builtInOn, watchBuiltIns, setHelpersAvailable, featureAvailable } from "./shell/features";
import { switchBrick, useBricksOn, isOn } from "./bricks-core";
import { voicePolicy } from "./talk/call-core";
import type { VoiceAlias, AliasRequest, AliasResult } from "./bricks/contract";
import { ignorePartner } from "./partner";
import { noticeCommand, useNoticeQueue } from "./notice-queue";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { thoughtId, readWaiting, saveWaiting, receivedWaiting, waitingKey, quarantined, discardQuarantined, type RecoveryState } from "./waiting";
import { switchTalk, talkCommand } from "./talk-preset";
import { receiveStep, resetSteps, stopListeningStep, type StepMsg } from "./model-line";
import { STOP_WAITS, caughtUp, comesFirst, received as cardReceived, type Card as SendCardShown, type SendCardMsg } from "./send-card";
import { gone as pullsGone, NO_PULLS, received as pullsReceived, type Pulls, type PullsCardMsg } from "./pulls-card";
import { comesFirst as noteFirst, received as noteReceived, type NoteCardMsg } from "./note-card";
import { receiveRoute, resetRoute, routePlacing } from "./route";
import { receiveGuide } from "./guide-core";
import { receiveJob, resetJobs, type JobMsg } from "./work-jobs";
import { applyAppChange, isAppChange, useApps, type AppChange, type AppsServerMsg, type AppsWorld } from "./apps-core";
import type { ConnectionRequest, ConnectionReply } from "./app-connections-core";
import { playTune } from "./apps-audio";
import { recipeOf } from "./bricks/app-recipes/rules";
import type { RecipeSave, RecipeResult } from "./apps-core";
import { received, volumeReporter } from "./apps-audio";
import { isDefaultRecap, recapFallback, useRecap, type RecapData, type RecapPeriod, type RecapServerMsg } from "./Recap";
import { coreBack } from "./pictures";
import { openSocket } from "./room";
import type { Found } from "./find";
import { attentionTeller, watchAttention } from "./this-card";
import { failureNotice } from "./action-line";
import { splitThought, tooBig } from "./limits";
import { applyMove, type MoveChange } from "./moves-core";
import { resolveMerged as resolve } from "./merges";
import { whysAfter } from "./whyhere";
import { isResting } from "./site";
import { applyTidy, settle, tidyNote, type Proposal, type TidyChange, type TidyUndo } from "./tidy-core";
import { applyPosition, keepPlaced, placeSender, type Position, type PositionChange } from "./positions-core";
import { annotateMessage, applyAnchored, type Anchor, type AnchorContext, type AnchoredChange } from "./annotate-core";
import { applyTopic, isTopicChange, sendTopicsWith, type TopicChange } from "./topics-core";

// Application liveness: matching replies every 5 s; 15 s silent plus the initial 1 s reconnect backoff.
export const DELIVERY_HEARTBEAT_MS = 5_000;
export const DELIVERY_DEADLINE_MS = 15_000;

// Mirrors core/src/world.rs and core/src/protocol.rs.
export type ThreadStatus = "open" | "dropped";

export interface Thread {
  return_source?: Pause;
  id: string;
  title: string;
  parent_id: string | null;
  status: ThreadStatus;
  last_point: string;
  touched_ms: number;
  tags: { name: string; kept: boolean }[];
  picture: string | null;
  /** While dropped: who left it unfinished. */
  dropped_by: string;
}

export interface Thought {
  id: string;
  speaker: string;
  text: string;
  point: string;
  thread_id: string | null;
  placed: boolean;
  unclear: string;
  guess?: string;
  heard?: string;
  fixed?: string;
  complete: boolean;
  at_ms: number;
  place_ms: number | null;
  /** The words say a decision was made (the core's decided.rs); placements before it have none. */
  decided?: boolean;
  /** Legacy optional field; consent is read only from World.agreements for the exact source revision. */
  agreed_by?: string[];
}

/** What the placer read into a thought (chunks.tsx): the words it carries on across a pause, an assumption that moved
 * it, and why it went where it went. Empty fields are left out. */
export interface Note {
  continues?: string;
  assumed?: string;
  why?: string;
  /** `why` was asked for afterwards (whyhere.tsx), not what decided the placement. */
  later?: boolean;
}

/** A point as it shows: with a capital first letter, the stored words unchanged. A first word that already
 * has a capital inside ("iPhone", "eBay") is a name, and stays as it is. */
export function capitalized(point: string): string {
  return point.replace(/^([\s"'\p{Ps}\p{Pi}]*)(\p{Ll})(\S*)/u, (word: string, lead: string, first: string, rest: string) =>
    /\p{Lu}/u.test(rest) ? word : lead + first.toUpperCase() + rest);
}

/** What stands in for a thread's picture until it has one, on the map and in the Palace. */
export function firstLetter(title: string): string {
  return Array.from(title.trim())[0]?.toLocaleUpperCase() || "?";
}

export type ItemStatus = "new" | "kept" | "dismissed" | "done";
/** An idea's text or a task's title, its day, and where it stands: what the refiner made it, or what it was (`item_refined`). */
export type ItemState = { status: ItemStatus; text: string; when: string };

// An answer to "Explain"; failed when there's none, with a short reason.
export type Explanation = { text: string; failed: boolean };
export type AnswerSource = { thought_id: string; field: "text" | "point"; excerpt: string; revision: string };
export type KeptAnswer = { id: string; source: AnswerSource; phrase: string; answer: string; model: string; owner: string; at_ms: number; revision: number; removed: boolean };

export function sourceRevision(thought: Thought): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(JSON.stringify([thought.text, thought.point]))) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash.toString(16).padStart(16, "0");
}
export function answerSourceState(world: World, source: AnswerSource): "available" | "changed" | "missing" {
  const thought = world.thoughts.find(t => t.id === source.thought_id);
  if (!thought || !thought.thread_id || !world.threads.some(t => t.id === thought.thread_id)) return "missing";
  return sourceRevision(thought) === source.revision && thought[source.field] === source.excerpt ? "available" : "changed";
}

// An answer to "Why here?" (whyhere.tsx); pending until it comes, failed when there's none.
export type WhyAnswer = { text: string; failed: boolean; pending?: boolean };

/** USAGE_FILE's allowances, read by the core; the budget's own count has a separate, current timestamp. */
export type UsageRow = { label: string; used_pct?: number; left?: string; spent_usd?: number; cap_usd?: number };
export type UsageSnapshot = {
  updated: string;
  rows: readonly UsageRow[];
  calls: { used: number; limit: number; at_ms: number };
};

// A view asked for by voice ("palace", "show the map", "let's focus", "show all"), or the "?" list ("what can I
// say?"); also the unfinished card's Later ("later"), setting it aside ("forget it") and Finish it ("finish"), and the
// mic off ("stop listening"), and the map saved as a file ("export my map", export-md.ts). The revision makes the same one asked twice a new ask.
// `answers`: how many answers had been shown when it came (see showNotice).
// "What just happened?" ("notices"): the notices this window showed, newest first, which only it keeps (the Notice timeline).
export type ViewAsk = { view: "map" | "cards" | "palace" | "focus" | "all" | "help" | "later" | "forget" | "finish" | "pause" | "export" | "notices" | "talk" | "features"; revision: number; answers: number };

// "Expand the garden", "collapse this", "expand everything" (thread_id null): a thread and every branch under it.
export type UnfoldAsk = { thread_id: string | null; open: boolean; revision: number };

// Said while a search asks the model. It stays until the answer: the core takes it down with an empty notice
// when something newer stops the search.
export const LOOKING = "Looking through your topics…";
/** The message card's Stop pressed with the connection down (`stopSend`). */
export { STOP_WAITS } from "./send-card";

export interface Suggestion {
  id: string;
  thread_id: string;
  text: string;
  status: ItemStatus;
}

export interface Action {
  id: string;
  thread_id: string;
  kind: "reminder" | "event";
  title: string;
  when: string;
  status: ItemStatus;
  done_ms: number | null;
  /** This window only: why the last "Add to …" didn't add it (the core's `action_failed`), shown on its row until
   *  it is tried again. A reload drops it; the row still offers the button. */
  failed?: string;
}

export type EstimateRequest = { request_id: string; action_id: string; source_title: string; source_thread_id: string; observed_revision: number; minutes: number | null; reason: string; undo_of?: string | null };
export type ActionEstimate = { action_id: string; owner: string; source_title: string; source_thread_id: string; source_topic: string; minutes: number | null; reason: string; revision: number; request: EstimateRequest; cleared?: { minutes: number; reason: string } | null };
export type EstimateResult = { request_id: string; ok: boolean; message: string; estimate: ActionEstimate | null };

// How an import of past chats is going (core/src/import.rs).
export interface ImportStatus {
  id: string;
  file: string;
  state: "reading" | "grouping" | "adding" | "done" | "stopped" | "failed";
  parts: number;
  parts_done: number;
  ideas: number;
  threads: number;
  extended: number;
  points: number;
  questions: number;
  actions: number;
  note: string;
}

export type Citation = { title: string; url: string; start: number; end: number };
export type ResearchKept = { id: string; owner: string; thought_id: string; quote: string; source_point?: string; topic_id: string; topic_title: string; query: string; answer: string; citations: readonly Readonly<Citation>[]; at_ms: number; model: string; simulated: boolean; revision: number; removed: boolean; request_id: string };
export type ResearchCommand = { request_id: string; op: "run" | "keep" | "remove" | "undo"; thought_id?: string; quote?: string; query?: string; answer_id?: string; revision?: number };
export type ResearchResult = { request_id: string; ok: boolean; message: string; answer: ResearchKept | null };
export type DiscussionStatus = { thread_id: string; status: "open" | "resolved"; actor: string; at_ms: number; revision: number; request_id: string; observed_revision: number; reply_count: number };
export type DiscussionResult = { request_id: string; ok: boolean; message: string; discussion: DiscussionStatus | null };
export type Agreement = { revision: string; agreed_by: string[]; requests: string[] };
export type AgreementStatus = { request_id: string; pending: boolean; message: string };

export type Question = { id: string; owner: string; question: string; thought_id: string | null; answer: string; status: "open" | "answered" | "archived"; revision: number; updated_ms: number };
export type QuestionInput = { id: string; text: string; thought_id: string | null; answer: string; status: Question["status"]; expected_revision: number };
export type QuestionResult = { id: string; revision: number; ok: boolean; error?: string };
export interface EvidencePoint { index:number; text:string; region:[number,number,number,number]|null }
export interface EvidenceKept { request_id:string; extraction_id:string; image_id:string; actor:string; target:string; title:string; width:number; height:number; model:string; points:readonly Readonly<EvidencePoint>[]; thought_ids:readonly string[]; removed:boolean }
export type EvidenceRequest = {type:"cancel_evidence";request_id:string} | {type:"evidence_chunk";request_id:string;target:string;title:string;index:number;data:string} | {type:"extract_evidence";request_id:string} | {type:"keep_evidence";request_id:string;extraction_id:string;points:EvidencePoint[]} | {type:"undo_evidence";request_id:string;keep_id:string};
export interface EvidenceResult { request_id:string;ok:boolean;message:string;data:{extraction_id?:string;points?:EvidencePoint[];preview?:string;width?:number;height?:number;model?:string;kept?:EvidenceKept;undone?:string}|null }

export interface ChoiceRelation { id: string; source_id: string; role: string; option_id: string | null; actor: string; excerpt: string; speaker: string; revision: number; removed_by: string | null }
export interface ChoiceMap { id: string; revision: number; relations: readonly Readonly<ChoiceRelation>[]; votes: readonly Readonly<{ actor: string; option_id: string; revision: number }>[] }
export interface ChoiceRequest { request_id: string; choice_id: string; revision: number; operation: string; relation_id?: string; source_id?: string; observed?: string; role?: string; option_id?: string | null; undo_of?: string | null }
export interface ChoiceResult { request_id: string; ok: boolean; message: string }

export interface World extends AppsWorld {
  evidence_kept?: EvidenceKept[];
  choice_maps?: ChoiceMap[];
  research?: ResearchKept[];
  discussions?: DiscussionStatus[];
  action_estimates?: ActionEstimate[];
  questions?: Question[];
  point_edits?: readonly PointEdit[];
  aliases?: VoiceAlias[];
  kept_answers?: KeptAnswer[];
  agreements?: Record<string, Agreement>;
  pauses?: Pause[];
  recaps: RecapData[];
  threads: Thread[];
  thoughts: Thought[];
  captions?: import("./talk/call-core").Caption[];
  /** Where the talk is now; `active_by` has each speaker's own thread. */
  active: string | null;
  active_by: Record<string, string>;
  /** Map-wide destination for whole new thoughts, independent of each speaker's focus. */
  stay_here?: string | null;
  suggestions: Suggestion[];
  actions: Action[];
  merged: Record<string, string>;
  /** Thought id → its note (chunks.tsx). */
  notes?: Record<string, Note>;
  /** Renames and merges the AI wasn't sure of, waiting on their cards (tidy-core.ts). */
  proposals?: Proposal[];
  /** Thread or thought id → where a person or an AI participant put it on the canvas (positions-core.ts). */
  positions?: Record<string, Position>;
  /** A margin note's thread id → the words it's tied to (annotate-core.ts). */
  anchors?: Record<string, Anchor>;
  /** The speakers who joined as an AI participant, in the order they first came (the core's `World::ai`). */
  ai?: string[];
  /** Top thread id → the topic it's under (topics-core.ts). */
  topics?: Record<string, string>;
}

type Change =
  | {type:"evidence_kept";evidence:EvidenceKept}
  | { type: "choice_map_saved"; choice: ChoiceMap; actor: string; request: ChoiceRequest }
  | { type: "action_estimate_set"; estimate: ActionEstimate }
  | { type: "question_saved"; question: Question }
  | { type: "discussion_status"; discussion: DiscussionStatus }
  | { type: "research_kept"; research: ResearchKept }
  | { type: "alias_changed"; alias: VoiceAlias; request_id: string; signature: string }
  | { type: "answer_kept"; answer: KeptAnswer }
  | { type: "kept_answer_visibility"; id: string; revision: number; removed: boolean }
  | { type: "agreement_source"; thought_id: string; revision: string }
  | { type: "thought_agreement"; thought_id: string; revision: string; speaker: string; agree: boolean; request_id: string }
  | { type: "caption_added"; caption: import("./talk/call-core").Caption }
  | {type:"paused";pause:Pause}
  | {type:"pause_resolved";id:string;by_thought:string}
  | {type:"pause_choice";id:string;later_count:number;offer_after_ms:number;hidden:boolean}
  | {type:"return_focused";speaker:string;pause_id:string}
  | { type: "recap_saved"; recap: RecapData }
  | AppChange
  | TidyChange
  | { type: "thought_added"; thought: Thought }
  | { type: "thread_added"; thread: Thread }
  | {
      type: "thought_placed";
      thought_id: string;
      thread_id: string;
      point: string;
      unclear: string;
      guess?: string;
      heard?: string;
      fixed?: string;
      complete: boolean;
      place_ms: number;
      decided?: boolean;
    }
  | { type: "thought_corrected"; thought_id: string; accept: boolean; with?: string }
  | { type: "thought_split"; thought_id: string; text: string; rest: Thought }
  | { type: "thought_skipped"; thought_id: string }
  | { type: "put_back"; id: string; before: string }
  | { type: "thought_decided"; thought_id: string; decided: boolean }
  | { type: "thought_noted"; thought_id: string; note: Note }
  | { type: "point_edited"; request_id: string; thought_id: string; old_point: string; new_point: string; actor: string; undo_of?: string }
  | { type: "thought_repointed"; thought_id: string; point: string }
  | { type: "thread_removed"; thread_id: string }
  | { type: "thread_touched"; thread_id: string; last_point: string; at_ms: number }
  // A card's last point said again after its points changed (a delete, a move, an Undo): it neither reopens nor touches it.
  | { type: "last_point"; thread_id: string; last_point: string }
  | { type: "thread_status"; thread_id: string; status: ThreadStatus; speaker: string }
  | { type: "active_changed"; thread_id: string; speaker: string }
  | { type: "stay_changed"; thread_id: string | null }
  | { type: "thread_renamed"; thread_id: string; title: string }
  | { type: "thread_merged"; from: string; into: string }
  | MoveChange
  | PositionChange
  | AnchoredChange
  | TopicChange
  // A window joined as an AI participant under this name (`?ai`): its words are an AI's from now on.
  | { type: "ai_joined"; speaker: string }
  | { type: "suggestion_added"; suggestion: Suggestion }
  | { type: "action_proposed"; action: Action }
  | { type: "item_status"; id: string; status: ItemStatus; done_ms: number | null }
  // A waiting idea or task goes with the words it was made from to another thread (a move, or its Undo).
  | { type: "item_moved"; id: string; thread_id: string }
  // The refiner brought a waiting idea or task in line with something said later; restored is its Undo (refiner.rs).
  | { type: "item_refined"; id: string; now: ItemState; was: ItemState; why: string }
  | { type: "item_restored"; id: string; to: ItemState }
  | { type: "tag_suggested"; thread_id: string; tag: string }
  | { type: "tag_kept"; thread_id: string; tag: string }
  | { type: "tag_removed"; thread_id: string; tag: string }
  | { type: "thread_picture"; thread_id: string; path: string }
  // An import's record of the messages it read; only the core uses it.
  | { type: "messages_read"; at_ms: number[] };

export type Pause = { id: string; thought_id: string; speaker: string; thread_id: string; revision: number; excerpt: string; at_ms: number; resolved: boolean; later_count: number; offer_after_ms: number; hidden: boolean };
export type ReturnAnchor = { pause: Pause | null; thought_id: string; thread_id: string | null; excerpt: string; current_text: string | null };
export type ReturnResult = { request_id: string | null; anchor: ReturnAnchor | null; message: string; revision: number };

export type Capture = { id: string; text: string; thought_ids: string[]; saved: boolean; local: boolean; replay: boolean; mapped?: boolean; receivedOnly?: boolean; at: number };

type ServerMsg =
  | ({type:"evidence_result"} & EvidenceResult)
  | ({ type: "choice_result" } & ChoiceResult)
  | ({ type: "research_result" } & ResearchResult)
  | ({ type: "discussion_result" } & DiscussionResult)
  | ({ type: "action_estimate_result" } & EstimateResult)
  | ({ type: "question_result" } & QuestionResult)
  | ({ type: "alias_result"; window: number } & AliasResult)
  | { type: "agreement_result"; request_id: string; thought_id: string; ok: boolean; message: string }
  | { type: "returned"; request_id: string | null; anchor: ReturnAnchor | null; message: string }
  | { type: "capture_saved"; capture: { id: string; text: string; thought_ids: string[] }; replay: boolean }
  | { type: "helpers_available" }
  | { type: "map_identity"; id: string }
  | { type: "heartbeat"; id: string }
  | { type: "recoverable_speech"; id: string; text: string }
  | { type: "command_reply"; text: string; speak?: boolean }
  | TextEditResult
  | { type: "partner_state"; state: string; message: string }
  | { type: "text_received"; id: string }
  | JobMsg
  | StepMsg
  | RecapServerMsg
  | AppsServerMsg
  | { type: "snapshot"; world: World }
  | { type: "usage"; data: UsageSnapshot | null }
  | { type: "change"; change: Change; speak?: boolean }
  | { type: "partial"; text: string }
  | { type: "status"; listening: boolean; note: string }
  | { type: "error"; message: string }
  | { type: "action_failed"; id: string; message: string }
  | { type: "notice"; message: string }
  | { type: "notice_control"; show: boolean }
  | { type: "undoable"; id: number }
  | { type: "correctable"; for_ms: number; back_to: string | null }
  | { type: "revert" }
  | { type: "found"; thread_id: string; thought_id: string | null; message: string }
  | { type: "view"; view: ViewAsk["view"] }
  | { type: "unfold"; thread_id: string | null; open: boolean }
  | { type: "explanation"; id: string; text: string; failed: boolean }
  | { type: "why_here"; thought_id: string; text: string; failed: boolean }
  | { type: "import"; status: ImportStatus }
  | { type: "placing"; now: string | null; retries: { thought_id: string; in_ms: number }[] }
  | SendCardMsg
  | PullsCardMsg
  | NoteCardMsg;

/** Where unplaced thoughts stand (the core's `placing` message): the one being placed now, and each that failed a try
 *  with when it tries again, on this window's clock. Any other is waiting in line. */
export type Placing = { now: string | null; retryAt: Record<string, number> };

/** What a pending thought's pill says: waiting in line, being placed, or retrying after a failed try (with when).
 *  Seconds count from when it was said, after the first 5. */
export function pendingLabel(thought: Thought, placing: Placing, now: number, noKey: boolean, refused: boolean, resting = false) {
  if (refused) return "Waiting for a working key";
  if (resting) return "Saved · placed tomorrow";
  if (noKey) return "Needs the AI key";
  const since = Math.max(0, Math.floor((now - thought.at_ms) / 1000));
  const after = since > 5 ? ` · ${since}s` : "";
  if (placing.now === thought.id) return `Finding a place${after}`;
  const retryAt = placing.retryAt[thought.id];
  if (retryAt !== undefined) {
    const left = Math.ceil((retryAt - now) / 1000);
    return left >= 2 ? `Still working on it · retrying in ${left}s` : "Still working on it · retrying";
  }
  // Behind another being placed, or the whole line waiting out a busy service: "Finding a place" only while a call
  // for this one is running.
  return `Waiting${after}`;
}

/** The header's word for where things stand (its dot reads the same). Past the hosted site's daily limit the key is
 *  held back until tomorrow, not missing (site.ts `isResting`). */
export function statusLine(s: { connected: boolean; listening: boolean; noKey: boolean; refused: boolean; resting: boolean; paused: boolean }): string {
  if (!s.connected) return "Connecting…";
  if (s.listening) return "Listening";
  if (s.noKey) return s.refused ? "AI key refused" : s.resting ? "Free tries back tomorrow" : "No AI key";
  return s.paused ? "Paused" : "Ready";
}

/** A notice about the key: the core's (it names MODEL_API_KEY), or the hosted site's daily limit right after it. */
export const aboutKey = (message: string) => message.includes("MODEL_API_KEY") || isResting(message);

export type Landing = { thread: string; thought: string; mine: boolean };

/**
 * The landing the map follows among thoughts just placed (`added`, in list order): the newest, except a late one of
 * yours. A thought of yours that failed a try (`retried`) and lands after you moved on (newer words of yours landed,
 * or you went elsewhere) doesn't move your place (placer.rs `decide`), so it doesn't move the map either: it's
 * returned as `held`, and followed only if the next message moves your place to its thread (`held` passed back).
 * The rest of a late thought cut in two lands just as late, so it joins `retried` (placer.rs `Placing::placed`).
 */
export function landingToFollow(world: World, added: Thought[], me: string, moved: boolean, retried: Set<string>, held: Landing | null) {
  let landing: Landing | null = null;
  let late: Landing | null = null;
  for (const thought of added) {
    if (!thought.thread_id) continue;
    const at = { thread: thought.thread_id, thought: thought.id, mine: thought.speaker === me };
    if (!at.mine || moved || at.thread === world.active || !retried.has(thought.id)) {
      landing = at;
      continue;
    }
    late = at;
    const rest = world.thoughts[world.thoughts.findIndex((t) => t.id === thought.id) + 1];
    if (rest && !rest.placed && rest.speaker === thought.speaker && rest.at_ms === thought.at_ms) retried.add(rest.id);
  }
  if (!landing && moved && held?.thread === world.active) landing = held;
  return { landing, held: late };
}

/**
 * Jumps the map's own follow must leave alone. A jump (find's answer, a "While you were away" row) moves your place
 * and shows its own point; the move would also set off a follow of your place, which ~120 ms later highlighted the
 * thread's newest point instead and could scroll the found one away. Either order is covered: the jump before its
 * move reaches the map (Away: the row reveals, then focus's ActiveChanged comes back) or after it (find: ActiveChanged,
 * then Found). Only a follow of your place is answered, never a landing. A jump that moved your place also stands
 * down any follow of your place scheduled before it, whatever its thread: the map doesn't reschedule for an answered
 * move, so that older follow would otherwise run and pull you back off the jump.
 */
export function jumpTracker() {
  let seq = 0;
  // A jump whose move hasn't reached the map yet.
  let pending: string | null = null;
  let last: { thread: string; seq: number; moved?: boolean } | null = null;
  return {
    jumped(world: World, thread: string) {
      const id = resolve(world, thread);
      seq += 1;
      pending = id;
      last = { thread: id, seq };
    },
    /** At a move of your place: true when a jump already answered it. Any move ends the pending jump. */
    moved(active: string) {
      const answered = pending === active;
      pending = null;
      if (answered && last) last.moved = true;
      return answered;
    },
    /** Taken when a follow is scheduled, for `since`. */
    mark: () => seq,
    /** When the follow runs: true when a jump came after it was scheduled, to its thread or moving your place. */
    since(mark: number, thread: string) {
      const answered = !!last && last.seq > mark && (last.thread === thread || !!last.moved);
      if (answered) pending = null;
      return answered;
    },
  };
}

const EMPTY: World = { questions: [], captions: [], recaps: [], threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [], merged: {}, proposals: [], apps: [], apps_seeded: false };

// Replaces the first whole-word match of `from` in `text` with `to`, as the core does. Ignores case only
// when lowercasing keeps the length, so the cut lines up.
function swap(text: string, from: string, to: string): string {
  const even = text.toLowerCase().length === text.length && from.toLowerCase().length === from.length;
  const [hay, needle] = even ? [text.toLowerCase(), from.toLowerCase()] : [text, from];
  const word = /[A-Za-z0-9]/;
  for (let i = needle ? hay.indexOf(needle) : -1; i >= 0; i = hay.indexOf(needle, i + needle.length)) {
    const end = i + from.length;
    if (!word.test(text[i - 1] ?? "") && !word.test(text[end] ?? "")) return text.slice(0, i) + to + text.slice(end);
  }
  return text;
}

/** An approval that didn't add its action: the core has offered it again (status new); its row says why. */
export function actionFailed(world: World, id: string, message: string): World {
  return { ...world, actions: world.actions.map((a) => (a.id === id ? { ...a, failed: message } : a)) };
}

/** The window's copy of a change, as the core applies it (world.rs `World::apply`). A thread or thought that leaves the
 *  map takes its place on the canvas with it (positions-core.ts). */
export function apply(world: World, raw: Change): World {
  if (raw.type === "answer_kept") {
    let kept = world.kept_answers ?? [];
    if (kept.some(a => a.id === raw.answer.id) || new TextEncoder().encode(raw.answer.answer).length > 2048) return world;
    if (kept.length >= 30) { const i = kept.findIndex(a => a.removed); if (i >= 0) kept = kept.filter((_, n) => n !== i); }
    return kept.length < 30 ? { ...world, kept_answers: [...kept, raw.answer] } : world;
  }
  if (raw.type === "kept_answer_visibility") return { ...world, kept_answers: (world.kept_answers ?? []).map(a => a.id === raw.id && a.revision + 1 === raw.revision ? { ...a, revision: raw.revision, removed: raw.removed } : a) };
  if (raw.type === "agreement_source") {
    if (world.agreements?.[raw.thought_id]?.revision === raw.revision) return world;
    return { ...world, agreements: { ...world.agreements, [raw.thought_id]: { revision: raw.revision, agreed_by: [], requests: [] } } };
  }
  if (raw.type === "thought_agreement") {
    const state = world.agreements?.[raw.thought_id] ?? { revision: "", agreed_by: [], requests: [] };
    const key = `${raw.speaker}:${raw.request_id}`;
    if (state.revision !== raw.revision || state.requests.includes(key) || state.requests.length >= 6000
      || (!state.agreed_by.includes(raw.speaker) && state.agreed_by.length >= 40)
      || world.ai?.includes(raw.speaker) || !world.thoughts.some(t => t.id === raw.thought_id && t.placed)) return world;
    const agreed_by = raw.agree ? [...new Set([...state.agreed_by, raw.speaker])] : state.agreed_by.filter(s => s !== raw.speaker);
    return { ...world, agreements: { ...world.agreements, [raw.thought_id]: { ...state, agreed_by, requests: [...state.requests, key] } } };
  }
  if (raw.type === "positioned") return applyPosition(world, raw);
  // Its thread id isn't followed through merges, as the core's isn't: the note's thread is new when it's tied.
  if (raw.type === "anchored") return applyAnchored(world, raw);
  // By the ids as given, as the core's: a topic names a thread on the map, never one merged away.
  if (isTopicChange(raw)) return applyTopic(world, raw);
  const next = keepPlaced(applyChange(world, raw));
  if (!next.aliases) return next;
  const missing = (alias: VoiceAlias) => alias.target.kind === "open_topic" && !alias.unavailable && !next.threads.some(t => t.id === (alias.target as {topic_id: string}).topic_id);
  if (!next.aliases.some(missing)) return next;
  return { ...next, aliases: next.aliases.map(alias => missing(alias) ? { ...alias, enabled: false, unavailable: true, revision: alias.revision + 1 } : alias) };
}

function applyChange(world: World, raw: Exclude<Change, PositionChange | AnchoredChange | TopicChange | {type:"agreement_source"} | {type:"thought_agreement"} | { type: "answer_kept" | "kept_answer_visibility" }>): World {
  if (raw.type === "evidence_kept") {
    const old=world.evidence_kept?.find(e=>e.request_id===raw.evidence.request_id);
    return {...world,evidence_kept:old?world.evidence_kept!.map(e=>e===old?raw.evidence:e):[...(world.evidence_kept??[]),raw.evidence]};
  }
  if (raw.type === "choice_map_saved") {
    const old = world.choice_maps?.find(c => c.id === raw.choice.id);
    if (old && old.revision >= raw.choice.revision) return world;
    return { ...world, choice_maps: old ? world.choice_maps!.map(c => c === old ? raw.choice : c) : [...(world.choice_maps ?? []), raw.choice] };
  }
  if (raw.type === "alias_changed") {
    const old = world.aliases?.find(a => a.id === raw.alias.id && a.owner === raw.alias.owner);
    if (old && old.revision >= raw.alias.revision) return world;
    return { ...world, aliases: old ? world.aliases!.map(a => a === old ? raw.alias : a) : [...(world.aliases ?? []), raw.alias] };
  }
  if (isAppChange(raw)) return applyAppChange(world, raw);
  if (raw.type === "thread_retitled" || raw.type === "title_chosen" || raw.type === "thread_unmerged" || raw.type === "tidy_proposed") return applyTidy(world, raw) ?? world;
  if (raw.type === "thought_moved") return applyMove(world, raw);
  const r = (id: string) => resolve(world, id);
  if (raw.type === "stay_changed") {
    const id = raw.thread_id ? r(raw.thread_id) : null;
    return { ...world, stay_here: id && world.threads.some((t) => t.id === id) ? id : null };
  }
  const c: Change =
    raw.type === "suggestion_added"
      ? { ...raw, suggestion: { ...raw.suggestion, thread_id: r(raw.suggestion.thread_id) } }
      : raw.type === "action_proposed"
        ? { ...raw, action: { ...raw.action, thread_id: r(raw.action.thread_id) } }
        // An import's points and a new branch can name a thread merged while they were being made.
        : raw.type === "thought_added" && raw.thought.thread_id
          ? { ...raw, thought: { ...raw.thought, thread_id: r(raw.thought.thread_id) } }
          : raw.type === "thread_added" && raw.thread.parent_id
            ? { ...raw, thread: { ...raw.thread, parent_id: r(raw.thread.parent_id) } }
            : "thread_id" in raw
              ? { ...raw, thread_id: r(raw.thread_id) }
              : raw;
  const onThread = (id: string, edit: (t: Thread) => Thread): World => ({
    ...world,
    threads: world.threads.map((t) => (t.id === id ? edit({ ...t, tags: t.tags ?? [] }) : t)),
  });
  switch (c.type) {
    case "research_kept": {
      const old = world.research ?? [];
      const previous = old.find(s => s.id === c.research.id);
      if (previous && previous.revision > c.research.revision) return world;
      return { ...world, research: previous ? old.map(s => s === previous ? c.research : s) : [...old, c.research] };
    }
    case "discussion_status": {
      const old = world.discussions ?? [];
      const previous = old.find(s => s.thread_id === c.discussion.thread_id);
      if (previous && previous.revision > c.discussion.revision) return world;
      return { ...world, discussions: previous ? old.map(s => s === previous ? c.discussion : s) : [...old, c.discussion] };
    }
    case "question_saved": {
      const questions = world.questions ?? [];
      return { ...world, questions: questions.some(q => q.id === c.question.id) ? questions.map(q => q.id === c.question.id ? c.question : q) : [...questions, c.question] };
    }
    case "caption_added":
      return world.captions?.some((old) => old.id === c.caption.id && old.by === c.caption.by) ? world
        : { ...world, captions: [...(world.captions ?? []), c.caption] };
    case "action_estimate_set": {
      const estimates = world.action_estimates ?? [];
      const previous = estimates.find(e => e.action_id === c.estimate.action_id && e.owner === c.estimate.owner);
      if (previous && previous.revision > c.estimate.revision) return world;
      return { ...world, action_estimates: previous ? estimates.map(e => e === previous ? c.estimate : e) : [...estimates, c.estimate] };
    }
    case "paused": return { ...world, pauses: [...(world.pauses ?? []).filter(p=>p.id!==c.pause.id), c.pause] };
    case "pause_resolved": return { ...world, pauses: (world.pauses ?? []).map(p=>p.id===c.id ? {...p,resolved:true}:p) };
    case "pause_choice": return { ...world, pauses: (world.pauses ?? []).map(p=>p.id===c.id ? {...p,later_count:c.later_count,offer_after_ms:c.offer_after_ms,hidden:c.hidden}:p) };
    case "return_focused": return world;
    case "recap_saved":
      return { ...world, recaps: [...world.recaps.filter((r) => r.period !== c.recap.period), c.recap] };
    case "ai_joined":
      return world.ai?.includes(c.speaker) ? world : { ...world, ai: [...(world.ai ?? []), c.speaker] };
    case "tag_suggested":
      return onThread(c.thread_id, (t) =>
        t.tags.some((x) => x.name === c.tag) ? t : { ...t, tags: [...t.tags, { name: c.tag, kept: false }] },
      );
    case "tag_kept":
      return onThread(c.thread_id, (t) => ({ ...t, tags: t.tags.map((x) => (x.name === c.tag ? { ...x, kept: true } : x)) }));
    case "tag_removed":
      return onThread(c.thread_id, (t) => ({ ...t, tags: t.tags.filter((x) => x.name !== c.tag) }));
    case "thread_picture":
      return onThread(c.thread_id, (t) => ({ ...t, picture: c.path }));
    case "messages_read":
      return world;
    case "thread_renamed":
      return { ...world, threads: world.threads.map((t) => (t.id === c.thread_id ? { ...t, title: c.title } : t)), proposals: settle(world, "rename", c.thread_id) };
    case "thread_merged": {
      // As the core: never into itself, or into a thread that isn't there (its thoughts would vanish).
      if (c.from === c.into || !world.threads.some((t) => t.id === c.into)) return world;
      const move = (id: string | null) => (id === c.from ? c.into : id);
      return {
        ...world,
        threads: world.threads.filter((t) => t.id !== c.from).map((t) => ({ ...t, parent_id: move(t.parent_id) })),
        thoughts: world.thoughts.map((t) => ({ ...t, thread_id: move(t.thread_id) })),
        suggestions: world.suggestions.map((s) => ({ ...s, thread_id: move(s.thread_id)! })),
        actions: world.actions.map((a) => ({ ...a, thread_id: move(a.thread_id)! })),
        active: move(world.active),
        stay_here: move(world.stay_here ?? null),
        active_by: Object.fromEntries(Object.entries(world.active_by).map(([who, id]) => [who, move(id)!])),
        merged: { ...world.merged, [c.from]: c.into },
        // Left behind, as the core does (`tidy::record`): a rename meant for `from` would rename `into`.
        proposals: settle(world, null, c.from),
      };
    }
    case "suggestion_added":
      return world.suggestions.some((s) => s.id === c.suggestion.id)
        ? world
        : { ...world, suggestions: [...world.suggestions, c.suggestion] };
    case "action_proposed":
      return world.actions.some((a) => a.id === c.action.id) ? world : { ...world, actions: [...world.actions, c.action] };
    case "item_refined":
    case "item_restored": {
      // As the core's `World::set_item`: the same row, with its new words, day or status.
      const to = c.type === "item_refined" ? c.now : c.to;
      return {
        ...world,
        suggestions: world.suggestions.map((s) => (s.id === c.id ? { ...s, status: to.status, text: to.text } : s)),
        actions: world.actions.map((a) => (a.id === c.id ? { ...a, status: to.status, title: to.text, when: to.when } : a)),
      };
    }
    case "item_moved":
      // As the core: only onto a thread that's there.
      if (!world.threads.some((t) => t.id === c.thread_id)) return world;
      return {
        ...world,
        suggestions: world.suggestions.map((s) => (s.id === c.id ? { ...s, thread_id: c.thread_id } : s)),
        actions: world.actions.map((a) => (a.id === c.id ? { ...a, thread_id: c.thread_id } : a)),
      };
    case "item_status":
      return {
        ...world,
        suggestions: world.suggestions.map((s) => (s.id === c.id ? { ...s, status: c.status } : s)),
        // Trying again (being added), added or dismissed: the last failure no longer applies.
        actions: world.actions.map((a) => (a.id === c.id ? { ...a, status: c.status, done_ms: c.done_ms, failed: c.status === "new" ? a.failed : undefined } : a)),
        proposals: (world.proposals ?? []).map((p) => (p.id === c.id ? { ...p, status: c.status } : p)),
      };
    case "thought_added":
      return world.thoughts.some((t) => t.id === c.thought.id)
        ? world
        : { ...world, thoughts: [...world.thoughts, c.thought] };
    case "thought_split": {
      // Mirrors the core: the thought keeps the words before, and the rest follows it, to be placed next.
      const i = world.thoughts.findIndex((t) => t.id === c.thought_id);
      if (i < 0) return world;
      const thoughts = world.thoughts.map((t) => (t.id === c.thought_id ? { ...t, text: c.text } : t));
      if (!thoughts.some((t) => t.id === c.rest.id)) thoughts.splice(i + 1, 0, c.rest);
      return { ...world, thoughts };
    }
    case "thought_skipped":
      return { ...world, thoughts: world.thoughts.filter((t) => t.id !== c.thought_id) };
    case "thought_decided":
      // The core read the mark again after the words changed (a correction, or a join taken apart).
      return { ...world, thoughts: world.thoughts.map((t) => (t.id === c.thought_id ? { ...t, decided: c.decided } : t)) };
    case "thought_noted": {
      // As the core: an empty note takes it away; a note only for a thought that's there.
      const notes = { ...world.notes };
      if (!c.note.continues && !c.note.assumed && !c.note.why) delete notes[c.thought_id];
      else if (world.thoughts.some((t) => t.id === c.thought_id)) notes[c.thought_id] = c.note;
      return { ...world, notes };
    }
    case "point_edited": {
      const thought = world.thoughts.find(t => t.id === c.thought_id && t.placed && t.point === c.old_point);
      if (!thought) return world;
      const latest = world.thoughts.filter(t => t.placed && t.thread_id === thought.thread_id).reduce<Thought | undefined>((last, t) => !last || t.at_ms >= last.at_ms ? t : last, undefined);
      const { type: _type, ...receipt } = c;
      return { ...world, point_edits: world.point_edits?.some(e => e.actor === c.actor && e.request_id === c.request_id) ? world.point_edits : [...(world.point_edits ?? []), receipt], thoughts: world.thoughts.map(t => t.id === c.thought_id ? { ...t, point: c.new_point } : t),
        threads: world.threads.map(t => t.id === thought.thread_id && latest?.id === thought.id ? { ...t, last_point: c.new_point } : t) };
    }
    case "thought_repointed":
      return repoint(world, c.thought_id, () => c.point);
    case "thread_removed": {
      // As the core: only an empty thread, and nobody stays on it. Words still being placed don't hold it.
      if (world.thoughts.some((t) => t.placed && t.thread_id === c.thread_id) || world.threads.some((t) => t.parent_id === c.thread_id)) return world;
      return {
        ...world,
        threads: world.threads.filter((t) => t.id !== c.thread_id),
        active: world.active === c.thread_id ? null : world.active,
        stay_here: world.stay_here === c.thread_id ? null : world.stay_here,
        active_by: Object.fromEntries(Object.entries(world.active_by).filter(([, id]) => id !== c.thread_id)),
      };
    }
    case "put_back": {
      // As the core: what an Undo brought back stands just before the one that followed it; either missing, nothing.
      const put = <T extends { id: string }>(list: T[]) => {
        const from = list.findIndex((x) => x.id === c.id);
        if (from < 0 || c.id === c.before || !list.some((x) => x.id === c.before)) return list;
        const rest = list.filter((_, i) => i !== from);
        const to = rest.findIndex((x) => x.id === c.before);
        return [...rest.slice(0, to), list[from], ...rest.slice(to)];
      };
      return { ...world, threads: put(world.threads), thoughts: put(world.thoughts) };
    }
    case "thread_added":
      return world.threads.some((t) => t.id === c.thread.id)
        ? world
        : { ...world, threads: [...world.threads, c.thread] };
    case "thought_placed":
      return {
        ...world,
        thoughts: world.thoughts.map((t) =>
          t.id === c.thought_id
            ? {
                ...t,
                thread_id: c.thread_id,
                point: c.point,
                unclear: c.unclear,
                guess: c.guess ?? "",
                // A sure fix is already in the point; the text takes it too, only on first placing.
                text: !t.placed && c.heard && c.fixed ? swap(t.text, c.heard, c.fixed) : t.text,
                heard: c.heard ?? "",
                fixed: c.fixed ?? "",
                complete: c.complete,
                placed: true,
                place_ms: c.place_ms,
                decided: c.decided ?? false,
              }
            : t,
        ),
      };
    case "thread_touched":
      return {
        ...world,
        threads: world.threads.map((t) =>
          t.id === c.thread_id ? { ...t, last_point: c.last_point, touched_ms: c.at_ms, status: "open", dropped_by: "" } : t,
        ),
      };
    case "last_point":
      return { ...world, threads: world.threads.map((t) => (t.id === c.thread_id ? { ...t, last_point: c.last_point } : t)) };
    case "thread_status": {
      const dropped_by = c.status === "dropped" ? c.speaker : "";
      return { ...world, threads: world.threads.map((t) => (t.id === c.thread_id ? { ...t, status: c.status, dropped_by } : t)) };
    }
    case "active_changed":
      return { ...world, active: c.thread_id, active_by: { ...world.active_by, [c.speaker]: c.thread_id } };
    case "thought_corrected": {
      // Mirrors the core: yes swaps the unclear words for the guess, no keeps them;
      // no to a fix made without asking puts the words back as heard.
      const t = world.thoughts.find((x) => x.id === c.thought_id);
      if (!t) return world;
      const undo = !c.accept && !!t.heard && !!t.fixed;
      const correct = (text: string) => {
        // A yes in your own words ("No, Muse Spark") puts those in instead of the guess.
        const to = c.with || t.guess;
        if (c.accept && t.unclear && to) return swap(text, t.unclear, to);
        if (!c.accept && t.heard && t.fixed) return swap(text, t.fixed, t.heard);
        return text;
      };
      const next = {
        ...t,
        text: correct(t.text),
        point: correct(t.point),
        unclear: "",
        guess: "",
        heard: undo ? "" : t.heard,
        fixed: undo ? "" : t.fixed,
      };
      const corrected = {
        ...world,
        thoughts: world.thoughts.map((x) => (x.id === t.id ? next : x)),
        threads: world.threads.map((th) =>
          th.id === t.thread_id && th.last_point === t.point ? { ...th, last_point: next.point } : th,
        ),
      };
      // As the core: a point that carries these words on across a pause (chunks.tsx) takes the same swap.
      const carriers = corrected.thoughts.filter((x) => world.notes?.[x.id]?.continues === t.id);
      let out = carriers.reduce((w, x) => repoint(w, x.id, correct), corrected);
      // As the core: asked about words its own don't hold, they were said in a part it carries on; fixed there too.
      const to = c.with || t.guess;
      if (c.accept && t.unclear && to && swap(t.text, t.unclear, to) === t.text) {
        const seen = [t.id];
        for (let head = world.notes?.[t.id]?.continues; head && !seen.includes(head); head = world.notes?.[head]?.continues) {
          seen.push(head);
          const h = out.thoughts.find((x) => x.id === head);
          if (!h) continue;
          // Each part's point reads the ones before it, so each takes the swap; its words said only where they are.
          if (swap(h.text, t.unclear, to) !== h.text) {
            const answered = h.unclear.toLowerCase() === t.unclear.toLowerCase();
            const fixed = { ...h, text: swap(h.text, t.unclear, to), ...(answered ? { unclear: "", guess: "" } : {}) };
            out = { ...out, thoughts: out.thoughts.map((x) => (x.id === head ? fixed : x)) };
          }
          out = repoint(out, head, correct);
        }
      }
      return out;
    }
    // A change this window doesn't know (a newer core, a tab open across a redeploy): the map as it was, not undefined.
    default:
      return world;
  }
}

/** Thought `id`'s point becomes `point(old)`; the thread's last point, a copy, keeps in step (the core's `repoint`). */
function repoint(world: World, id: string, point: (old: string) => string): World {
  const t = world.thoughts.find((x) => x.id === id);
  if (!t) return world;
  const next = point(t.point);
  return {
    ...world,
    thoughts: world.thoughts.map((x) => (x.id === id ? { ...x, point: next } : x)),
    threads: world.threads.map((th) => (th.id === t.thread_id && th.last_point === t.point ? { ...th, last_point: next } : th)),
  };
}

/**
 * Picks out the messages that answer a move you asked for: a view said aloud, a search's jump, "where was I?",
 * "next one" or "last one". An open Recap makes way for those, so you see where you went. Your own words landing
 * on another thread move you too, but that's talk, not a request: the sheet stays while you read. `speaker` is
 * you; each message comes with the map as it was before it.
 */
export function movesAsked(speaker?: string) {
  // The thread your words just landed on, until the rest of that commit is in: the placer sends the landing, its
  // ThreadTouched and any drops, then the move (placer.rs `decide`).
  let landing: string | null = null;
  return (world: World, msg: ServerMsg) => {
    const change = msg.type === "change" ? msg.change : null;
    const landed = landing;
    if (change?.type !== "thread_touched" && change?.type !== "thread_status") landing = null;
    // Not Later, the mic or an export: they leave the map as it is.
    if (msg.type === "found" || msg.type === "unfold" || (msg.type === "view" && !["later", "forget", "pause", "export"].includes(msg.view))) return true;
    if (!speaker || !change) return false;
    if (change.type === "thought_placed" && world.thoughts.some((t) => t.id === change.thought_id && t.speaker === speaker)) {
      landing = change.thread_id;
    }
    // The placer decides the move on the map from before the model answered, so it comes even when you've gone
    // there yourself meanwhile (a click): still talk. An import's end opens you on its newest thread when you had
    // no place yet (import.rs `land`): not asked for either.
    return change.type === "active_changed" && change.speaker === speaker && change.thread_id !== landed
      && (world.active_by[speaker] ?? world.active) !== null;
  };
}

/** The stream a tab stops still ends within this (asr.rs waits at most 3.8 s for the voice service). */
const MIC_TAIL_MS = 4_000;

export type PointEdit = { request_id: string; thought_id: string; old_point: string; new_point: string; actor: string; undo_of?: string };
export type TextEditResult =
  | { type: "point_proposal"; request_id: string; thought_id: string; text: string; failed: boolean }
  | { type: "point_edit_result"; request_id: string; thought_id: string; ok: boolean; message: string };
export type TextEditRequest =
  | { type: "shorter_point"; request_id: string; thought_id: string; observed: string }
  | { type: "edit_point"; request_id: string; thought_id: string; observed: string; replacement: string; undo_of?: string };

export function useCore(speaker?: string) {
  const evidenceOn = useRef(false);
  const evidenceWaits = useRef(new Map<string,(result:EvidenceResult)=>void>());
  const failEvidenceWaits = (message:string) => { for(const [request_id,done] of evidenceWaits.current) done({request_id,ok:false,message,data:null});evidenceWaits.current.clear(); };
  const choiceOn = useRef(false);
  const choiceWaits = useRef(new Map<string, (r: ChoiceResult) => void>());
  const failChoiceWaits = (message: string) => {
    for (const [request_id, resolve] of choiceWaits.current) resolve({request_id, ok:false, message});
    choiceWaits.current.clear();
  };
  const researchOn = useRef(false);
  const researchWaits = useRef(new Map<string, (r: ResearchResult) => void>());
  const failResearch = (message: string) => { for (const [request_id, done] of researchWaits.current) done({ request_id, ok: false, message, answer: null }); researchWaits.current.clear(); };
  const discussionOn = useRef(false);
  const discussionWaits = useRef(new Map<string, (r: DiscussionResult) => void>());
  const failDiscussions = (message: string) => { for (const [request_id, done] of discussionWaits.current) done({ request_id, ok: false, message, discussion: null }); discussionWaits.current.clear(); };
  const estimatesOn = useRef(false);
  const estimateWaits = useRef(new Map<string, { resolve: (result: EstimateResult) => void; timer: ReturnType<typeof setTimeout> }>());
  const failEstimateWaits = (message: string) => {
    for (const [request_id, wait] of estimateWaits.current) { clearTimeout(wait.timer); wait.resolve({ request_id, ok: false, message, estimate: null }); }
    estimateWaits.current.clear();
  };
  const aliasesOn = useRef(false);
  const aliasWaiting = useRef(new Map<string, (answer: AliasResult) => void>());
  const aliasFail = (message: string) => { for (const [request_id, resolve] of aliasWaiting.current) resolve({request_id, ok:false, message}); aliasWaiting.current.clear(); };
  const recap = useRecap();
  const receiveRecap = recap.receive;
  const recapDisconnected = recap.disconnected;
  const closeRecap = recap.close;
  const apps = useApps();
  const receiveApps = apps.receive;
  const resetApps = apps.reset;
  const [world, setWorld] = useState<World>(EMPTY);
  const questionWaiters = useRef(new Map<string, { revision: number; create: boolean; input: QuestionInput; receive: (result: QuestionResult) => void }>());
  const [agreementStatus, setAgreementStatus] = useState<Record<string, AgreementStatus>>({});
  const agreementPending = useRef(new Map<string, string>());
  const [snapshotRevision, setSnapshotRevision] = useState(0);
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const { queue: noticeQueue, current: currentNotice } = useNoticeQueue();
  const mapChange = currentNotice?.kind === "map" ? currentNotice.value : null;
  const [partial, setPartial] = useState("");
  const [voiceDraft, setVoiceDraft] = useState("");
  const [handoff, setHandoff] = useState("");
  const [voiceErrorRevision, setVoiceErrorRevision] = useState(0);
  // The words of the last voice error, so the window can say why the mic stopped (notice-rules.ts `micStopped`).
  const [voiceError, setVoiceError] = useState("");
  const [listening, setListening] = useState(false);
  // The core can replay this speaker's listening state from another window or an older session on load/reconnect.
  // It is not permission to capture here: only App's mic tap calls listen(true). Never persist this tab's intent.
  const localMic = useRef(false);
  // Until when the stream this tab just stopped may still finish: its last words and their end (the hand-off to the
  // thought on its way) are still this tab's. The core waits at most 3.8 s for the voice service (asr.rs QUIET_MAX).
  const micTail = useRef(0);
  const [voiceStatusRevision, setVoiceStatusRevision] = useState(0);
  // How many times a stream said it was listening: a window that starts its mic again knows a "not listening" that
  // comes before its stream's "listening" is the old stream's, late.
  const [listenedRevision, setListenedRevision] = useState(0);
  const [connected, setConnected] = useState(false);
  const notice = currentNotice?.kind === "notice" ? currentNotice.value.text : "";
  const noticeNumber = useRef(0);
  const setNotice = (change: string | ((shown: string) => string)) => {
    const current = noticeQueue.snapshot();
    const shown = current?.kind === "notice" ? current.value.text : "";
    const text = typeof change === "function" ? change(shown) : change;
    if (typeof change === "function" && text === shown) return;
    if (!text) { noticeQueue.drop("notice", "search", false); return; }
    if (text !== LOOKING) noticeQueue.drop("notice", "search", false);
    const group = aboutKey(text) ? "key" : /microphone|\bmic\b|Live audio/i.test(text) ? "microphone" : "notice";
    noticeQueue.push("notice", text === LOOKING ? "search" : String(++noticeNumber.current), { text, undo: null }, group);
  };
  // Every notice and map update as it comes up, for the bricks' on("notice") (App.tsx `takeNotices` after each render):
  // kept where each is said, since one render can carry several, the same words twice too. Clearing one says nothing.
  const notices = useRef<{ text: string; kind: "notice" | "error" | "map-change"; time: number }[]>([]);
  const sayNotice = (text: string, kind: "notice" | "error" = "notice") => {
    if (text) notices.current.push({ text, kind, time: Date.now() });
    setNotice(text);
  };
  const takeNotices = useCallback(() => notices.current.splice(0), []);
  // The notice up now, for the socket handler, whose `notice` would be the one from when it connected.
  const noticeShown = useRef("");
  useEffect(() => { noticeShown.current = notice; }, [notice]);
  // The notice's Undo: the id the core sent for the request it answers (catalog.rs), until a newer notice.
  const undoId = currentNotice?.kind === "notice" ? currentNotice.value.undo : null;
  // History follows the latest answered turn even when its notice is queued or only shown in the status line.
  const [latestUndoId, setLatestUndoId] = useState<number | null>(null);
  const setUndoId = (id: number | null) => { setLatestUndoId(id); noticeQueue.updateUndo(id); };
  // Every answer shown, counted, the same words again too: a repeat gets its reading time again (App.tsx), and an
  // answer the window makes for a view request stands down when the core has answered since (showNotice).
  const answers = useRef(0);
  const [answerRevision, setAnswerRevision] = useState(0);
  const answered = () => setAnswerRevision(++answers.current);
  // Bumped by the core's "revert": put back the view and folds from before the last voice ask (revert.ts).
  const [revertAsk, setRevertAsk] = useState(0);
  // Whether your last turn can still be corrected, until when here, and where undoing it takes you (catalog.rs
  // `Correctable`): the "this" mark previews a correction from it (attention-core.ts `thisBase`).
  const [correctable, setCorrectable] = useState<{ until: number; back_to: string | null } | null>(null);
  // What "this" means here, as last told; told again on every connection, since the core forgets it (this-card.ts).
  const attention = useRef(attentionTeller());
  const [found, setFound] = useState<Found | null>(null);
  const [textEditResult, setTextEditResult] = useState<TextEditResult | null>(null);
  const [returnResult, setReturnResult] = useState<ReturnResult | null>(null);
  const exactFound = useRef<{thread: string; thought: string} | null>(null);
  const [viewAsk, setViewAsk] = useState<ViewAsk | null>(null);
  const [unfoldAsk, setUnfoldAsk] = useState<UnfoldAsk | null>(null);
  // The core says so on connect when it has no model key, or once the service refused it: the map can be
  // browsed, nothing new is placed. Kept, so it can be said again when the mic is tried.
  const [keyNotice, setKeyNotice] = useState("");
  const lastMapKey = `e2a2o.last-map.${speaker ?? "you"}`;
  const mapId = useRef<string | null>(null);
  const identityReady = useRef(false);
  const queueKey = useRef<string | null>(null);
  const outbox = useRef<string[]>([]);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const keepCaptures = (messages: string[], local: boolean) => setCaptures(was => {
    const added = messages.map(message => JSON.parse(message)).filter(message => !was.some(capture => capture.id === message.id))
      .map(message => ({ id: message.id, text: message.text, thought_ids: [], saved: false, local, replay: false, at: Date.now() }));
    return added.length ? [...was, ...added] : was;
  });
  // Explicit, non-durable sends stay here until receipts arrive. Never replay them automatically in another map.
  const onlineSend = useRef<{ map: string; text: string; messages: string[]; awaiting: Set<string>; received: () => void } | null>(null);
  const [recovery, setRecovery] = useState<RecoveryState>({ entries: [], storageUnavailable: false });
  const refreshRecovery = () => {
    try {
      // Read storage while this catch is active, not in React's deferred updater.
      const entries = quarantined(speaker ?? "you", mapId.current);
      setRecovery((state) => ({ ...state, entries: [...state.entries.filter(entry => entry.kind === "speech"), ...entries] }));
    }
    catch { setRecovery((state) => ({ ...state, storageUnavailable: true })); }
  };
  const [queuedCount, setQueuedCount] = useState(0);
  const [placing, setPlacing] = useState<Placing>({ now: null, retryAt: {} });
  const [explanations, setExplanations] = useState<Record<string, Explanation>>({});
  const [whys, setWhys] = useState<Record<string, WhyAnswer>>({});
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  // The ready-to-send message card, while it counts down and for a moment after (send-card.ts).
  const sendSource = useRef<SendCardShown | null>(null);
  const setSendCard = (change: SendCardShown | null | ((shown: SendCardShown | null) => SendCardShown | null)) => {
    sendSource.current = typeof change === "function" ? change(sendSource.current) : change;
    if (sendSource.current) noticeQueue.push("send", String(sendSource.current.id), sendSource.current);
    else if (!sendSource.current) noticeQueue.drop("send");
    redrawSend((n) => n + 1);
  };
  const sendCard = currentNotice?.kind === "send" ? currentNotice.value : null;
  const [, redrawSend] = useState(0);
  // The GitHub card, from asking until it's read or closed, and which ask is newest (pulls-card.ts).
  const pullsSource = useRef<Pulls>(NO_PULLS);
  const setPulls = (change: Pulls | ((shown: Pulls) => Pulls)) => {
    pullsSource.current = typeof change === "function" ? change(pullsSource.current) : change;
    if (pullsSource.current.card) noticeQueue.push("pulls", String(pullsSource.current.card.id), pullsSource.current.card);
    else noticeQueue.drop("pulls");
  };
  // The note card: what "save this thread as a note" wrote, or would have (note-card.ts).
  const noteCard = currentNotice?.kind === "note" ? currentNotice.value : null;
  const socket = useRef<WebSocket | null>(null);
  const connectionPending = useRef(new Map<string, { resolve: (r: ConnectionReply) => void; timer: number }>());
  const connectionsOn = useBricksOn().has("app-connections");
  const connectionSocket = useRef<WebSocket | null>(null);
  useEffect(() => {
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "connections_switch", on: connectionsOn }));
      connectionSocket.current = connectionsOn ? ws : null;
    }
    if (!connectionsOn || !connected) {
      for (const [request_id, pending] of connectionPending.current) {
        clearTimeout(pending.timer);
        pending.resolve({ request_id, plans: [], play: false, message: "Connection ended or feature off. Refresh to review; nothing is retried." });
      }
      connectionPending.current.clear();
    }
  }, [connectionsOn, connected]);
  const recipeOptedSocket = useRef<WebSocket | null>(null);
  const recipesOn = useBricksOn().has("app-recipes");
  const recipePending = useRef(new Map<string, { resolve: (r: RecipeResult) => void; timer: number }>());
  const endRecipes = useCallback((message: string) => {
    for (const [request_id, pending] of recipePending.current) { window.clearTimeout(pending.timer); pending.resolve({ request_id, app_id: null, message }); }
    recipePending.current.clear();
  }, []);
  useEffect(() => {
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN && recipesOn && recipeOptedSocket.current !== ws) {
      ws.send(JSON.stringify({ type: "recipes_switch", on: true })); recipeOptedSocket.current = ws;
    } else if (!recipesOn && ws && recipeOptedSocket.current === ws) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "recipes_switch", on: false }));
      recipeOptedSocket.current = null;
    }
    if (!recipesOn) endRecipes("App recipes is off. Draft kept.");
  }, [recipesOn, connected, endRecipes]);
  // A message card's Stop pressed while the connection was down: the next connection carries it (`open`).
  const stopWaiting = useRef<number | null>(null);

  useEffect(() => {
    let closed = false;
    let retry = 500;
    let timer: number | undefined;
    let heartbeat: number | undefined;
    let currentWorld = EMPTY;
    let changeId = 0;
    let lastPartial = "";
    let awaitingThought = false;
    let handoffTimer: number | undefined;
    // The message card the core last sent about since this connection opened or its last snapshot, if any.
    let cardTold: number | null = null;
    const helpersPreference = () => {
      if (featureAvailable("helpers") && socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: "helpers_switch", on: builtInOn("helpers") }));
    };
    const unwatchHelpers = watchBuiltIns(helpersPreference);
    let formatOn: boolean | undefined;
    const formatPreference = () => {
      const next = builtInOn("reply-format") && builtInOn("partner");
      if (!next && formatOn) stopReplyFormat();
      if (socket.current?.readyState !== WebSocket.OPEN || next === formatOn) return;
      formatOn = next;
      socket.current.send(JSON.stringify({ type: "reply_format", on: next }));
    };
    // Room's existing partner handler runs first; this operation never enables partner on its own.
    const unwatchFormat = watchBuiltIns(() => { if (formatOn && (!builtInOn("reply-format") || !builtInOn("partner"))) stopReplyFormat(); queueMicrotask(formatPreference); });
    let savedWasOn = false;
    const savedPreference = () => {
      const on = builtInOn("saved-answers");
      if (socket.current?.readyState === WebSocket.OPEN && on !== savedWasOn) {
        socket.current.send(JSON.stringify({ type: "saved_answers", on }));
        savedWasOn = on;
      }
    };
    const unwatchSaved = watchBuiltIns(savedPreference);
    const agreementPreference = () => {
      if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: "agreement_switch", on: builtInOn("explicit-agreement") }));
      if (!builtInOn("explicit-agreement")) { agreementPending.current.clear(); setAgreementStatus({}); }
    };
    const unwatchAgreement = watchBuiltIns(agreementPreference);
    const shownSwarms = new Set<string>();
    const asked = movesAsked(speaker);

    const open = () => {
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      // A Stop pressed offline rides on the connection itself, so the core applies it before this window counts as
      // open, and a count that ends meanwhile can't send first (core/src/main.rs `connect`, messages.rs `finish`).
      const waiting = stopWaiting.current;
      const ws = openSocket(`${scheme}://${location.host}/ws`, waiting === null ? { identity: "1" } : { identity: "1", stop: String(waiting) });
      ws.binaryType = "arraybuffer";
      socket.current = ws;
      let ended = false;
      const heartbeatId = thoughtId();
      let lastReply = Date.now();
      ws.onopen = () => {
        noticeQueue.reset("note");
        ws.send(JSON.stringify({type:"voice_shortcuts",on:aliasesOn.current}));
        if (isOn("app-recipes")) { ws.send(JSON.stringify({ type: "recipes_switch", on: true })); recipeOptedSocket.current = ws; }
        formatOn = undefined;
        connectReplyFormat(message => { if (ws.readyState !== WebSocket.OPEN || ended) return false; ws.send(JSON.stringify(message)); return true; });
        formatPreference();
        noticeQueue.reset("note");
        if (evidenceOn.current) ws.send(JSON.stringify({type:"image_evidence",on:true}));
        if (choiceOn.current) ws.send(JSON.stringify({ type: "choice_maps", on: true }));
        if (researchOn.current) ws.send(JSON.stringify({ type: "research_feature", on: true }));
        if (discussionOn.current) ws.send(JSON.stringify({ type: "discussion_feature", on: true }));
        savedWasOn = false;
        savedPreference();
        if (estimatesOn.current) ws.send(JSON.stringify({ type: "action_estimates", on: true }));
        resetApps();
        resetSteps();
        resetRoute();
        setHelpersAvailable(false);
        setConnected(true);
        if (builtInOn("review-text-edits")) ws.send(JSON.stringify({ type: "review_text_edits", on: true }));
        agreementPreference();
        retry = 500;
        cardTold = null;
        // One pressed while this connection was still opening goes now, ahead of everything else.
        const late = stopWaiting.current;
        stopWaiting.current = null;
        if (late !== null && late !== waiting) ws.send(JSON.stringify({ type: "stop_send", id: late }));
        identityReady.current = false;
        lastReply = Date.now();
        heartbeat = window.setInterval(() => {
          if (socket.current !== ws || ended) return;
          if (Date.now() - lastReply >= DELIVERY_DEADLINE_MS) {
            ws.close();
            // A half-open connection may never finish its close handshake.
            ws.onclose?.call(ws, {} as CloseEvent);
            return;
          }
          try { ws.send(JSON.stringify({ type: "heartbeat", id: heartbeatId })); }
          catch { ws.onclose?.call(ws, {} as CloseEvent); }
        }, DELIVERY_HEARTBEAT_MS);
        attention.current.resend((message) => ws.send(message));
        coreBack();
        window.dispatchEvent(new Event("e2a2o-build"));
      };
      ws.onmessage = (event) => {
        if (socket.current !== ws || ended) return;
        if (ignorePartner(event.data)) return;
        const incoming = JSON.parse(event.data as string);
        if (incoming.type === "build_available") { window.dispatchEvent(new Event("e2a2o-build")); return; }
        if (incoming.type === "app_connection_result") {
          const pending = connectionPending.current.get(incoming.request_id);
          if (pending) {
            clearTimeout(pending.timer); connectionPending.current.delete(incoming.request_id);
            if (incoming.play && !playTune(false)) incoming.message = "Tune confirmed, but browser audio is unavailable. Calendar receipt is unchanged.";
            pending.resolve(incoming);
          }
          return;
        }
        if (incoming.type === "recipe_result") {
          if (!isOn("app-recipes")) return;
          const pending = recipePending.current.get(incoming.request_id);
          if (pending) { window.clearTimeout(pending.timer); recipePending.current.delete(incoming.request_id); pending.resolve(incoming); }
          return;
        }
        const msg = incoming as ServerMsg;
        if (receiveReplyFormat(incoming)) return;
        if (msg.type === "question_result") {
          const waiter = questionWaiters.current.get(msg.id);
          const matching = waiter && currentWorld.questions?.some(q => q.id === msg.id && q.revision === msg.revision
            && q.question === waiter.input.text && q.answer === waiter.input.answer && q.status === waiter.input.status && q.thought_id === waiter.input.thought_id);
          if (waiter && (!msg.ok || (matching && (msg.revision === waiter.revision || (waiter.create && msg.revision > 0))))) {
            questionWaiters.current.delete(msg.id);
            waiter.receive(msg);
          }
          return;
        }
        // In the same update as the move, so the map follows you there (App.tsx doesn't while Recap is open).
        if (asked(currentWorld, msg)) closeRecap();
        if (receiveRecap(msg)) return;
        if (receiveApps(msg)) return;
        if (msg.type === "step" && msg.step === "listen" && !localMic.current) return;
        if (receiveStep(msg)) return;
        if (receiveRoute(msg)) return;
        // Someone pointing at a part of the screen, or a caption (Guide.tsx): never the map.
        if (receiveGuide(msg)) return;
        if (msg.type === "job" && msg.id.startsWith("helpers:") && !msg.parent && msg.status === "running" && !shownSwarms.has(msg.id)) {
          shownSwarms.add(msg.id);
          switchBrick("work-spine", true);
        }
        if (receiveJob(msg)) return;
        switch (msg.type) {
          case "evidence_result": {
            if(evidenceOn.current){ const done=evidenceWaits.current.get(msg.request_id);if(done){evidenceWaits.current.delete(msg.request_id);done(msg);} }
            break;
          }
          case "choice_result": {
            if (choiceOn.current) { const done = choiceWaits.current.get(msg.request_id); if (done) { choiceWaits.current.delete(msg.request_id); done(msg); } }
            break;
          }
          case "research_result": {
            researchWaits.current.get(msg.request_id)?.(msg); researchWaits.current.delete(msg.request_id); break;
          }
          case "discussion_result": {
            discussionWaits.current.get(msg.request_id)?.(msg); discussionWaits.current.delete(msg.request_id); break;
          }
          case "action_estimate_result": {
            if (!estimatesOn.current) break;
            const wait = estimateWaits.current.get(msg.request_id);
            if (wait) { clearTimeout(wait.timer); estimateWaits.current.delete(msg.request_id); wait.resolve(msg); }
            break;
          }
          case "point_proposal":
          case "point_edit_result":
            if (builtInOn("review-text-edits")) setTextEditResult(msg);
            break;
          case "alias_result": {
            if (aliasesOn.current) { aliasWaiting.current.get(msg.request_id)?.(msg); aliasWaiting.current.delete(msg.request_id); }
            break;
          }
          case "returned": {
            setReturnResult(was => ({ ...msg, revision: (was?.revision ?? 0) + 1 }));
            if (msg.anchor?.thread_id && msg.anchor.current_text !== null) {
              exactFound.current = {thread: msg.anchor.thread_id, thought: msg.anchor.thought_id};
              setFound(was => ({thread_id: msg.anchor!.thread_id!, thought_id: msg.anchor!.thought_id, revision: (was?.revision ?? 0)+1, preserveFocus: true}));
            }
            break;
          }
          case "helpers_available":
            setHelpersAvailable(true);
            helpersPreference();
            break;
          case "heartbeat":
            if (msg.id === heartbeatId) lastReply = Date.now();
            break;
          case "map_identity": {
            if (!msg.id) break;
            if (mapId.current !== msg.id) { setCaptures([]); setReturnResult(null); exactFound.current=null; }
            if (mapId.current !== msg.id) setRecovery(state => ({ ...state, entries: state.entries.filter(entry => entry.kind !== "speech") }));
            mapId.current = msg.id;
            identityReady.current = true;
            queueKey.current = waitingKey(speaker ?? "you", msg.id);
            try { localStorage.setItem(lastMapKey, msg.id); } catch { /* Reading saved entries may still work. */ }
            try { outbox.current = readWaiting(queueKey.current); }
            catch { outbox.current = []; }
            setQueuedCount(outbox.current.length);
            keepCaptures(outbox.current, true);
            refreshRecovery();
            for (const message of outbox.current) ws.send(message);
            break;
          }
          case "capture_saved":
            setCaptures(was => {
              const old = was.find(capture => capture.id === msg.capture.id);
              const capture = { ...msg.capture, saved: true, local: true, mapped: true, replay: msg.replay, at: old?.at ?? Date.now() };
              return [...was.filter(item => item.id !== capture.id), capture];
            });
            break;
          case "recoverable_speech": {
            setRecovery(state => ({ ...state, entries: [...state.entries.filter(entry => entry.id !== msg.id),
              ...(msg.text ? [{ id: msg.id, text: msg.text, kind: "speech" as const }] : [])] }));
            break;
          }
          case "text_received": {
            setCaptures(was => was.map(capture => capture.id === msg.id ? { ...capture, saved: true, local: true } : capture));
            if (!identityReady.current || !queueKey.current) break;
            const pending = onlineSend.current;
            if (pending?.map === mapId.current && pending.awaiting.delete(msg.id) && pending.awaiting.size === 0) {
              onlineSend.current = null;
              setRecovery(state => ({ ...state, onlinePending: false }));
              pending.received();
            }
            try { receivedWaiting(queueKey.current, msg.id); outbox.current = readWaiting(queueKey.current); }
            catch { break; } // Retrying a saved entry is safe: the core remembers its id.
            setQueuedCount(outbox.current!.length);
            break;
          }
          case "usage":
            setUsage(msg.data);
            break;
          case "agreement_result":
            if (builtInOn("explicit-agreement") && agreementPending.current.get(msg.thought_id) === msg.request_id) {
              agreementPending.current.delete(msg.thought_id);
              setAgreementStatus(was => ({ ...was, [msg.thought_id]: { request_id: msg.request_id, pending: false, message: msg.message } }));
            }
            break;
          case "snapshot":
            agreementPending.current.clear(); setAgreementStatus({});
            setUsage(null);
            resetJobs();
            setFound(null);
            // A word about the key is the core's to repeat: it does, right after this, while it still holds.
            setKeyNotice("");
            noticeQueue.dropGroup("key");
            // The core sends a running import's status right after the snapshot; one it doesn't has ended
            // (it finished while this window was away, or the core restarted).
            setImportStatus((status) => (status && ["reading", "grouping", "adding"].includes(status.state) ? null : status));
            // A new connection, maybe to a restarted core whose Undo ids start again at 1: no Undo from before it.
            setUndoId(null);
            // The core sends the card first (send-card.ts `caughtUp`).
            {
              const told = cardTold;
              cardTold = null;
              setSendCard((shown) => caughtUp(shown, told));
            }
            currentWorld = { ...EMPTY, ...msg.world };
            setWorld(currentWorld);
            setSnapshotRevision((revision) => revision + 1);
            setWhys((w) => whysAfter(w, msg));
            break;
          case "change": {
            const change = msg.change;
            if (change.type === "agreement_source") {
              agreementPending.current.delete(change.thought_id);
              setAgreementStatus(was => Object.fromEntries(Object.entries(was).filter(([id]) => id !== change.thought_id)));
            }
            if (change.type === "thought_split") setCaptures(was => was.map(capture => capture.thought_ids.includes(change.thought_id)
              ? { ...capture, thought_ids: [...new Set([...capture.thought_ids, change.rest.id])] } : capture));
            // An AI rename, a merge, or one undone: said above the map, with Undo where it can be taken back.
            const note = tidyNote(currentWorld, change);
            if (note) {
              const id = ++changeId;
              notices.current.push({ text: note.text, kind: "map-change", time: Date.now() });
              noticeQueue.push("map", String(id), { ...note, id });
            }
            if (change.type === "thought_added" && change.thought.speaker === speaker && (awaitingThought || (!!lastPartial && change.thought.text.trim() === lastPartial.trim()))) {
              setVoiceDraft("");
              window.clearTimeout(handoffTimer);
              lastPartial = "";
              awaitingThought = false;
              setHandoff("");
            }
            currentWorld = apply(currentWorld, change);
            setWorld(currentWorld);
            setWhys((w) => whysAfter(w, msg));
            break;
          }
          case "action_failed": {
            const action = currentWorld.actions.find((a) => a.id === msg.id);
            currentWorld = actionFailed(currentWorld, msg.id, msg.message);
            setWorld(currentWorld);
            if (!action) break;
            // Its row says why when it's on screen; else the notice does (action-line.ts `failureNotice`).
            const row = document.getElementById(`item-${msg.id}`)?.getBoundingClientRect();
            const inView = !!row && row.height > 0 && row.bottom > 0 && row.top < window.innerHeight;
            const say = failureNotice(action.title, msg.message, inView, noticeShown.current);
            if (say) { sayNotice(say, "error"); setUndoId(null); answered(); }
            break;
          }
          case "partial":
            if (!localMic.current && Date.now() >= micTail.current) break;
            if (!localMic.current && !msg.text) micTail.current = 0;
            window.clearTimeout(handoffTimer);
            if (msg.text) {
              lastPartial = msg.text;
              setVoiceDraft(msg.text);
              awaitingThought = false;
              setHandoff("");
            } else if (lastPartial) {
              awaitingThought = true;
              setHandoff(lastPartial);
              handoffTimer = window.setTimeout(() => { lastPartial = ""; awaitingThought = false; setHandoff(""); }, 1500);
            }
            setPartial(msg.text);
            break;
          case "status":
            setListening(localMic.current && msg.listening);
            setVoiceStatusRevision((revision) => revision + 1);
            if (msg.listening) setListenedRevision((revision) => revision + 1);
            break;
          case "notice_control":
            noticeQueue.control(msg.show);
            break;
          case "error":
            if (msg.message.startsWith("Voice Transcribe:") || msg.message.startsWith("Speech service error:")) {
              setVoiceError(msg.message);
              setVoiceErrorRevision((revision) => revision + 1);
              break;
            }
          // Other errors and notices use the same notice area.
          case "notice":
            // Past the daily limit the core has no key, so a later "needs MODEL_API_KEY" (making an app) is the same
            // limit: the window keeps saying back tomorrow until the next snapshot.
            if (aboutKey(msg.message)) setKeyNotice((held) => (isResting(held) && !isResting(msg.message) ? held : msg.message));
            if (msg.message) sayNotice(msg.message, msg.type);
            else noticeQueue.drop("notice", "search", false);
            // A newer answer: the Undo shown was for the one before.
            if (msg.message) { setUndoId(null); answered(); }
            break;
          case "undoable":
            setUndoId(msg.id);
            break;
          case "correctable":
            // The core now remembers a newer turn, not the one an Undo shown was for: that Undo can't work, so it goes
            // (a turn's own `correctable` comes before its `undoable`).
            setUndoId(null);
            setCorrectable(msg.for_ms > 0 ? { until: Date.now() + msg.for_ms, back_to: msg.back_to } : null);
            break;
          case "revert":
            setRevertAsk((n) => n + 1);
            break;
          case "placing":
            routePlacing(msg.now);
            setPlacing({ now: msg.now, retryAt: Object.fromEntries(msg.retries.map((r) => [r.thought_id, Date.now() + r.in_ms])) });
            break;
          case "found":
            if (exactFound.current?.thread === msg.thread_id && exactFound.current?.thought === msg.thought_id) { exactFound.current = null; break; }
            setFound((previous) => ({ thread_id: msg.thread_id, thought_id: msg.thought_id, preserveFocus: /^(Back to|You're on)/.test(msg.message), revision: (previous?.revision ?? 0) + 1 }));
            sayNotice(msg.message);
            setUndoId(null);
            answered();
            break;
          case "view": {
            // Counted now, not in the updater: React may run that only at render, after answers that came later.
            const shown = answers.current;
            setViewAsk((previous) => ({ view: msg.view, revision: (previous?.revision ?? 0) + 1, answers: shown }));
            break;
          }
          case "unfold":
            setUnfoldAsk((previous) => ({ thread_id: msg.thread_id, open: msg.open, revision: (previous?.revision ?? 0) + 1 }));
            break;
          case "explanation":
            setExplanations((e) => ({ ...e, [msg.id]: { text: msg.text, failed: msg.failed } }));
            break;
          case "why_here":
            setWhys((w) => ({ ...w, [msg.thought_id]: { text: msg.text, failed: msg.failed } }));
            break;
          case "import":
            setImportStatus(msg.status);
            break;
          case "send_card": {
            if (msg.purpose === "helpers" && msg.state === "counting") switchBrick("work-spine", true);
            cardTold = msg.id;
            const at = Date.now();
            setSendCard((shown) => cardReceived(shown, msg, at));
            // Recap is modal: the countdown and its Stop would sit under it, out of reach.
            if (comesFirst(msg)) closeRecap();
            break;
          }
          case "pulls_card":
            setPulls(pullsReceived(NO_PULLS, msg));
            break;
          case "note_card":
            const queued = noticeQueue.find("note", String(msg.id));
            const note = noteReceived(queued?.kind === "note" ? queued.value : null, msg);
            if (note) noticeQueue.push("note", String(msg.id), note);
            if (noteFirst(msg)) closeRecap();
            break;
        }
      };
      ws.onclose = () => {
        failEvidenceWaits("Connection lost. Unkept image expired; keep your draft and extract again explicitly.");
        failChoiceWaits("Save unconfirmed: connection lost. Draft kept.");
        failResearch("Research unconfirmed: connection lost. Query kept; retry explicitly.");
        failDiscussions("Save unconfirmed: connection lost. Retry explicitly.");
        failEstimateWaits("Save unconfirmed: connection lost. Your draft is kept; retry explicitly.");
        for (const [id, waiter] of questionWaiters.current) waiter.receive({ id, revision: 0, ok: false, error: "Disconnected before confirmation. Review the saved list after reconnecting. Nothing will retry automatically." });
        questionWaiters.current.clear();
        aliasFail("Connection lost. Draft kept. Retry explicitly when connected.");
        if (ended) return;
        if (voicePolicy.snapshot().enabled) voicePolicy.end();
        ended = true;
        connectReplyFormat(null);
        resetReplyFormat();
        agreementPending.current.clear(); setAgreementStatus({});
        window.clearInterval(heartbeat);
        identityReady.current = false;
        setRecovery(state => ({ ...state, onlinePending: false }));
        setUsage(null);
        window.clearTimeout(handoffTimer);
        lastPartial = "";
        awaitingThought = false;
        setPartial("");
        setHandoff("");
        // No answer comes on a closed connection.
        noticeQueue.drop("notice", "search", false);
        setWhys((w) => Object.values(w).some((a) => a.pending) ? Object.fromEntries(Object.entries(w).filter(([, a]) => !a.pending)) : w);
        // A core that restarted has no last turn to correct; one that didn't says so again with your next turn.
        setCorrectable(null);
        // The GitHub card's answer can't come on a closed connection, and a restarted core numbers its asks from 1.
        setPulls(NO_PULLS);
        recapDisconnected();
        setConnected(false);
        endRecipes("Connection lost. Draft kept; retry explicitly.");
        connectionSocket.current = null;
        for (const [request_id, pending] of connectionPending.current) { clearTimeout(pending.timer); pending.resolve({ request_id, plans: [], play: false, message: "Connection lost. Refresh to review; nothing is retried." }); }
        connectionPending.current.clear();
        localMic.current = false;
        micTail.current = 0;
        stopListeningStep();
        setListening(false);
        setVoiceStatusRevision((revision) => revision + 1);
        if (!closed) timer = window.setTimeout(open, (retry = Math.min(retry * 2, 8000)));
      };
    };
    try {
      mapId.current = localStorage.getItem(lastMapKey);
      queueKey.current = mapId.current ? waitingKey(speaker ?? "you", mapId.current) : null;
      if (queueKey.current) outbox.current = readWaiting(queueKey.current);
      setQueuedCount(outbox.current.length);
      keepCaptures(outbox.current, true);
    } catch { /* A failed save keeps the draft. */ }
    refreshRecovery();
    const storageChanged = () => {
      try { if (queueKey.current) outbox.current = readWaiting(queueKey.current); } catch { return; }
      setQueuedCount(outbox.current.length);
      refreshRecovery();
    };
    window.addEventListener("storage", storageChanged);
    open();
    return () => {
      window.removeEventListener("storage", storageChanged);
      unwatchHelpers();
      unwatchFormat();
      connectReplyFormat(null);
      resetReplyFormat();
      unwatchSaved();
      unwatchAgreement();
      agreementPending.current.clear();
      closed = true;
      window.clearTimeout(timer);
      window.clearInterval(heartbeat);
      window.clearTimeout(handoffTimer);
      failEvidenceWaits("Window closed. Draft not confirmed.");
      failChoiceWaits("Save unconfirmed: window closed. Draft kept.");
      failEstimateWaits("Save unconfirmed: window closed.");
      socket.current?.close();
    };
  }, [receiveApps, resetApps, receiveRecap, recapDisconnected, closeRecap, speaker]);

  const send = useCallback((data: string | ArrayBuffer) => {
    const big = tooBig(data);
    // Past the core's cap it would end this window's connection (core/src/protocol.rs `FRAME_MAX`).
    if (big) { sayNotice(big); answered(); return false; }
    if (socket.current?.readyState !== WebSocket.OPEN) return false;
    socket.current.send(data);
    return true;
  }, []);
  useEffect(() => {
    let previous = builtInOn("review-text-edits");
    return watchBuiltIns(() => {
      const on = builtInOn("review-text-edits");
      if (on === previous) return;
      previous = on;
      send(JSON.stringify({ type: "review_text_edits", on }));
      if (!on) setTextEditResult(null);
    });
  }, [send]);
  const placeAt = useMemo(() => placeSender((data) => send(data)), [send]);
  const sendOrWarn = useCallback((data: string) => {
    if (send(data)) return true;
    sayNotice("Not connected — try again when connected.");
    answered();
    return false;
  }, [send]);
  // A brick's renameTopic and moveToTopic (topics-core.ts) go through this window's connection.
  useEffect(() => sendTopicsWith(sendOrWarn), [sendOrWarn]);
  const setItem = useCallback((id: string, status: ItemStatus) => sendOrWarn(JSON.stringify({ type: "item", id, status })), [sendOrWarn]);
  const approve = useCallback((id: string) => sendOrWarn(JSON.stringify({ type: "approve", id })), [sendOrWarn]);
  // The message card's Stop or Esc: the core stops it (it alone sends); its "stopped" takes the card down.
  // Pressed while the connection is down, the Stop waits and the next connection carries it. A count that ends first,
  // with none of the speaker's windows connected, ends unsent anyway (core/src/messages.rs `finish`).
  const stopSend = useCallback((id: number) => {
    if (send(JSON.stringify({ type: "stop_send", id }))) return true;
    stopWaiting.current = id;
    if (sendSource.current?.id === id) {
      setSendCard({ ...sendSource.current, stopPending: true });
      notices.current.push({ text: STOP_WAITS, kind: "notice", time: Date.now() });
    } else sayNotice(STOP_WAITS);
    answered();
    return false;
  }, [send]);
  const pullsCardGone = useCallback((id: number) => { noticeQueue.drop("pulls", String(id)); pullsSource.current = pullsGone(pullsSource.current, id); }, [noticeQueue]);
  const sendCardGone = useCallback((id: number) => { noticeQueue.drop("send", String(id)); }, [noticeQueue]);
  // The note card's Open in Notes: the core shows the note it wrote, in Notes on the host's Mac; it never changes it.
  const openNote = useCallback((id: number) => sendOrWarn(JSON.stringify({ type: "open_note", id })), [sendOrWarn]);
  const noteCardGone = useCallback((id: number) => { noticeQueue.drop("note", String(id)); }, [noticeQueue]);
  // "This" for spoken requests: the card you selected or point at (this-card.ts).
  useEffect(() => watchAttention((selected, pointed, point) => attention.current.tell(selected, pointed, send, point)), [send]);
  const correct = useCallback((thought_id: string, accept: boolean) => sendOrWarn(JSON.stringify({ type: "correct", thought_id, accept })), [sendOrWarn]);
  const unlink = useCallback((thought_id: string) => sendOrWarn(JSON.stringify({ type: "unlink", thought_id })), [sendOrWarn]);
  const tag = useCallback((thread_id: string, tag: string, keep: boolean) => sendOrWarn(JSON.stringify({ type: "tag", thread_id, tag, keep })), [sendOrWarn]);
  // A point to another thread (null: a new one of its own), and a title typed on a card (core moves.rs).
  const move = useCallback((thought_id: string, thread_id: string | null) => sendOrWarn(JSON.stringify({ type: "move", thought_id, thread_id })), [sendOrWarn]);
  const rename = useCallback((thread_id: string, title: string) => sendOrWarn(JSON.stringify({ type: "rename", thread_id, title })), [sendOrWarn]);
  // A point off the map, with Undo on the notice that answers (core moves.rs `delete`; "delete this" said does the same).
  const remove = useCallback((thought_id: string) => sendOrWarn(JSON.stringify({ type: "delete", thought_id })), [sendOrWarn]);
  const volume = useMemo(() => volumeReporter((level) => { if (send(JSON.stringify({ type: "app_volume", level }))) received(level); }), [send]);

  const noKey = keyNotice !== "";
  const requestRecap = (requested?: RecapPeriod) => {
    const since = requested === undefined ? recapFallback(world) : undefined;
    const period = since !== undefined ? "session" : requested ?? "today";
    const sent = !noKey && send(JSON.stringify({ type: "recap", period }));
    recap.open(period, world.recaps.find((r) => r.period === period) ?? null, sent, since);
  };

  return {
    setImageEvidenceOn:(on:boolean)=>{const changed=evidenceOn.current!==on;evidenceOn.current=on;if(changed)send(JSON.stringify({type:"image_evidence",on}));if(!on)failEvidenceWaits("Image evidence is off. Unkept image discarded.");},
    imageEvidence:(request:EvidenceRequest):Promise<EvidenceResult>=>new Promise(resolve=>{
      const fail=(message:string)=>resolve({request_id:request.request_id,ok:false,message,data:null});
      if(!evidenceOn.current){fail("Image evidence is off.");return;}
      if(request.type==="evidence_chunk"){if(send(JSON.stringify(request)))resolve({request_id:request.request_id,ok:true,message:"Upload queued; extraction and save are unconfirmed.",data:null});else fail("Not connected. Image not uploaded.");return;}
      if(evidenceWaits.current.has(request.request_id)){fail("Already waiting for this request.");return;}
      const timer=setTimeout(()=>{evidenceWaits.current.delete(request.request_id);fail("No acknowledgement. Draft kept; retry explicitly.");},60000);
      const done=(result:EvidenceResult)=>{clearTimeout(timer);resolve(result);};evidenceWaits.current.set(request.request_id,done);
      if(!send(JSON.stringify(request))){evidenceWaits.current.delete(request.request_id);done({request_id:request.request_id,ok:false,message:"Not connected. Draft kept.",data:null});}
    }),
    setChoiceMapsOn: (on: boolean) => {
      const changed = choiceOn.current !== on; choiceOn.current = on;
      if (changed) send(JSON.stringify({type:"choice_maps", on}));
      if (!on) failChoiceWaits("Choice map is off. Draft kept.");
    },
    saveChoice: (request: ChoiceRequest): Promise<ChoiceResult> => new Promise(resolve => {
      if (!choiceOn.current) { resolve({request_id:request.request_id,ok:false,message:"Choice map is off."}); return; }
      if (choiceWaits.current.has(request.request_id)) { resolve({request_id:request.request_id,ok:false,message:"Already waiting for this save."}); return; }
      const timer = setTimeout(() => { choiceWaits.current.delete(request.request_id); resolve({request_id:request.request_id,ok:false,message:"Save unconfirmed. Draft kept; retry explicitly."}); }, 12000);
      const done = (r: ChoiceResult) => { clearTimeout(timer); resolve(r); };
      choiceWaits.current.set(request.request_id, done);
      if (!send(JSON.stringify({type:"save_choice",request}))) { choiceWaits.current.delete(request.request_id); done({request_id:request.request_id,ok:false,message:"Not connected. Draft kept; retry explicitly."}); }
    }),
    setResearchOn: (on: boolean) => {
      researchOn.current = on; send(JSON.stringify({ type: "research_feature", on }));
      if (!on) failResearch("Research this question is off.");
    },
    cancelResearch: () => { send(JSON.stringify({ type: "cancel_research" })); failResearch("Research cancelled. Your query is kept."); },
    research: (request: ResearchCommand): Promise<ResearchResult> => new Promise(resolve => {
      const failed = (message: string): ResearchResult => ({ request_id: request.request_id, ok: false, message, answer: null });
      if (!researchOn.current) { resolve(failed("Research this question is off.")); return; }
      if (researchWaits.current.has(request.request_id)) { resolve(failed("This request is already pending.")); return; }
      const timer = setTimeout(() => { researchWaits.current.delete(request.request_id); resolve(failed("Research unconfirmed. Query kept; retry explicitly.")); }, 55000);
      researchWaits.current.set(request.request_id, r => { clearTimeout(timer); resolve(r); });
      if (!send(JSON.stringify({ type: "research_action", ...request }))) { researchWaits.current.get(request.request_id)?.(failed("Not connected. Query kept; retry explicitly.")); researchWaits.current.delete(request.request_id); }
    }),
    setDiscussionOn: (on: boolean) => {
      discussionOn.current = on; send(JSON.stringify({ type: "discussion_feature", on }));
      if (!on) failDiscussions("Discussion status is off.");
    },
    setDiscussion: (thread_id: string, status: "open" | "resolved", observed_revision: number): Promise<DiscussionResult> => new Promise(resolve => {
      const request_id = crypto.randomUUID();
      if (!discussionOn.current) { resolve({ request_id, ok: false, message: "Discussion status is off.", discussion: null }); return; }
      const timer = setTimeout(() => { discussionWaits.current.delete(request_id); resolve({ request_id, ok: false, message: "Save unconfirmed. Retry explicitly.", discussion: null }); }, 12000);
      discussionWaits.current.set(request_id, r => { clearTimeout(timer); resolve(r); });
      if (!send(JSON.stringify({ type: "set_discussion", request_id, thread_id, status, observed_revision }))) { discussionWaits.current.get(request_id)?.({ request_id, ok: false, message: "Not connected. Retry explicitly.", discussion: null }); discussionWaits.current.delete(request_id); }
    }),
    setActionEstimatesOn: (on: boolean) => {
      const changed = estimatesOn.current !== on;
      estimatesOn.current = on;
      if (changed) send(JSON.stringify({ type: "action_estimates", on }));
      if (!on) failEstimateWaits("Action estimates is off. Your draft has not been confirmed.");
    },
    setActionEstimate: (request: EstimateRequest): Promise<EstimateResult> => new Promise(resolve => {
      const failed = (message: string) => resolve({ request_id: request.request_id, ok: false, message, estimate: null });
      if (!estimatesOn.current) { failed("Action estimates is off."); return; }
      if (estimateWaits.current.has(request.request_id)) { failed("This estimate is already waiting for a save acknowledgement."); return; }
      const timer = setTimeout(() => { estimateWaits.current.delete(request.request_id); failed("Save unconfirmed. Your draft is kept; retry explicitly."); }, 12000);
      estimateWaits.current.set(request.request_id, { resolve, timer });
      if (!send(JSON.stringify({ type: "set_action_estimate", ...request }))) {
        clearTimeout(timer); estimateWaits.current.delete(request.request_id); failed("Not connected. Your draft is kept; retry explicitly.");
      }
    }),
    saveQuestion: (input: QuestionInput, receive: (result: QuestionResult) => void): boolean => {
      const ws = socket.current;
      if (!identityReady.current || ws?.readyState !== WebSocket.OPEN || questionWaiters.current.has(input.id)) return false;
      questionWaiters.current.set(input.id, { revision: input.expected_revision + 1, create: input.expected_revision === 0, input, receive });
      try { ws.send(JSON.stringify({ type: "save_question", ...input })); return true; }
      catch { questionWaiters.current.delete(input.id); return false; }
    },
    textEditResult,
    sendTextEdit: (message: TextEditRequest) => builtInOn("review-text-edits") && send(JSON.stringify(message)),
    voiceShortcuts: (on: boolean) => {
      aliasesOn.current = on;
      if (!on) aliasFail("My voice shortcuts is off. Draft kept.");
      send(JSON.stringify({type:"voice_shortcuts",on}));
    },
    voiceShortcut: (request: AliasRequest): Promise<AliasResult> => {
      if (!aliasesOn.current) return Promise.resolve({request_id:request.request_id,ok:false,message:"My voice shortcuts is off."});
      return new Promise(resolve => {
        const timer = window.setTimeout(() => { aliasWaiting.current.delete(request.request_id); resolve({request_id:request.request_id,ok:false,message:"No save acknowledgement. Draft kept. Retry explicitly."}); }, 10000);
        aliasWaiting.current.set(request.request_id, result => { window.clearTimeout(timer); resolve(result); });
        if (!send(JSON.stringify({type:"alias_operation",...request}))) {
          aliasWaiting.current.get(request.request_id)?.({request_id:request.request_id,ok:false,message:"Not connected. Draft kept. Retry explicitly."}); aliasWaiting.current.delete(request.request_id);
        }
      });
    },
    appConnection: (request: ConnectionRequest): Promise<ConnectionReply> => new Promise(resolve => {
      const request_id = crypto.randomUUID();
      const fail = (message: string) => resolve({ request_id, plans: [], play: false, message });
      const ws = socket.current;
      if (!isOn("app-connections") || ws?.readyState !== WebSocket.OPEN) { fail("Not connected or App connections is off. Nothing was sent."); return; }
      if (connectionSocket.current !== ws) { ws.send(JSON.stringify({ type: "connections_switch", on: true })); connectionSocket.current = ws; }
      const timer = window.setTimeout(() => { connectionPending.current.delete(request_id); fail("No receipt. Refresh to review the step before starting a new plan. Nothing is retried."); }, 25000);
      connectionPending.current.set(request_id, { resolve, timer });
      if (!send(JSON.stringify({ type: "app_connection", request_id, ...request }))) {
        clearTimeout(timer); connectionPending.current.delete(request_id); fail("Connection lost. Refresh to review; nothing is retried.");
      }
    }),
    exportRecipe: (app: import("./apps-core").MiniApp) => JSON.stringify(recipeOf(app), null, 2),
    saveRecipe: (save: RecipeSave): Promise<RecipeResult> => new Promise(resolve => {
      if (!isOn("app-recipes") || socket.current?.readyState !== WebSocket.OPEN) { resolve({ request_id: save.request_id, app_id: null, message: "Not connected or App recipes is off. Draft kept." }); return; }
      if (recipePending.current.has(save.request_id)) { resolve({ request_id: save.request_id, app_id: null, message: "Save already waiting for the core." }); return; }
      const timer = window.setTimeout(() => { recipePending.current.delete(save.request_id); resolve({ request_id: save.request_id, app_id: null, message: "No save receipt. Draft kept; retry explicitly." }); }, 10000);
      recipePending.current.set(save.request_id, { resolve, timer });
      if (!send(JSON.stringify({ type: "save_recipe", save }))) endRecipes("Connection lost. Draft kept; retry explicitly.");
    }),
    agreementStatus,
    agreeThought: (thought_id: string, revision: string, agree: boolean) => {
      if (!builtInOn("explicit-agreement") || !identityReady.current || agreementPending.current.has(thought_id)) return false;
      const request_id = thoughtId();
      if (!send(JSON.stringify({ type: "agree_thought", thought_id, revision, request_id, agree }))) return false;
      agreementPending.current.set(thought_id, request_id);
      setAgreementStatus(was => ({ ...was, [thought_id]: { request_id, pending: true, message: "Saving agreement…" } }));
      return true;
    },
    returnResult,
    clearReturn: () => setReturnResult(null),
    resumePause: (pause_id: string) => {
      const request_id = thoughtId();
      return send(JSON.stringify({type:"resume",pause_id,request_id})) ? request_id : null;
    },
    pauseChoice: (pause_id: string, later: boolean) => send(JSON.stringify({type:"pause_choice",pause_id,later})),
    captures,
    mapIdentity: mapId.current,
    confirmedMapIdentity: connected && identityReady.current ? mapId.current : null,
    retryCapture: (id: string) => {
      const capture = captures.find(capture => capture.id === id);
      if (!capture || !identityReady.current) return false;
      if (!capture.saved) {
        const message = outbox.current.find(message => JSON.parse(message).id === id);
        return !!message && send(message);
      }
      if (noKey) { sayNotice("Your words are saved. Add a working AI key to place them automatically."); return false; }
      return capture.thought_ids.some(thought => send(JSON.stringify({ type: "retry_placement", id: thought })));
    },
    recovery: { ...recovery, onlineAvailable: connected && identityReady.current },
    sendOnline: (text: string, received: () => void) => {
      const ws = socket.current;
      if (!identityReady.current || !mapId.current || ws?.readyState !== WebSocket.OPEN || recovery.onlinePending) return false;
      const parts = splitThought(text);
      if (!parts.length || parts.length > 50) return false;
      let pending = onlineSend.current;
      if (pending && (pending.map !== mapId.current || pending.text !== text)) return false;
      if (!pending) {
        const messages = parts.map(part => JSON.stringify({ type: "text", id: thoughtId(), text: part }));
        pending = { map: mapId.current, text, messages, awaiting: new Set(messages.map(message => JSON.parse(message).id)), received };
        onlineSend.current = pending;
        keepCaptures(messages, false);
      }
      pending.received = received;
      setRecovery(state => ({ ...state, onlinePending: true }));
      try {
        for (const message of pending.messages) if (pending.awaiting.has(JSON.parse(message).id)) ws.send(message);
        return true;
      } catch {
        setRecovery(state => ({ ...state, onlinePending: false }));
        return false;
      }
    },
    deliveryMapId: mapId.current,
    recover: (id: string) => {
      const entry = recovery.entries.find((entry) => entry.id === id);
      if (entry?.kind === "speech") return identityReady.current && send(JSON.stringify({ type: "recover_speech", id, keep: true }));
      if (!entry?.message || !queueKey.current || !identityReady.current) return false;
      try {
        const parsed = JSON.parse(entry.message);
        const message = JSON.stringify({ ...parsed, id: parsed.id ?? thoughtId() });
        saveWaiting(queueKey.current, [message]);
        discardQuarantined(entry);
        outbox.current = readWaiting(queueKey.current);
        setQueuedCount(outbox.current.length);
        refreshRecovery();
        socket.current?.send(message);
        return true;
      } catch { return false; }
    },
    discardRecovery: (id: string) => {
      const entry = recovery.entries.find((entry) => entry.id === id);
      if (entry?.kind === "speech") { if (identityReady.current) send(JSON.stringify({ type: "recover_speech", id, keep: false })); return; }
      if (entry) { try { discardQuarantined(entry); refreshRecovery(); } catch { /* Retain it if storage fails. */ } }
    },
    recap,
    requestRecap,
    apps,
    composeApp: (request: string) => send(JSON.stringify({ type: "compose_app", request })),
    decideApp: (build_id: string, keep: boolean) => send(JSON.stringify({ type: "decide_app", build_id, keep })),
    toggleApp: (id: string, enabled: boolean) => send(JSON.stringify({ type: "toggle_app", id, enabled })),
    removeApp: (id: string) => send(JSON.stringify({ type: "remove_app", id })),
    appOutput: (id: string, sound: boolean) => send(JSON.stringify({ type: "app_output", id, sound })),
    world,
    usage,
    sendCard,
    stopSend,
    sendCardGone,
    pullsCard: currentNotice?.kind === "pulls" ? currentNotice.value : null,
    noticeQueue,
    unfinishedNotice: currentNotice?.kind === "unfinished" ? currentNotice.value : null,
    pullsCardGone,
    noteCard,
    openNote,
    noteCardGone,
    snapshotRevision,
    mapChange,
    partial,
    voiceDraft,
    clearVoiceDraft: () => setVoiceDraft(""),
    handoff,
    voiceErrorRevision,
    voiceError,
    listening,
    voiceStatusRevision,
    listenedRevision,
    connected,
    notice,
    noticeKey: currentNotice?.kind === "notice" ? currentNotice.key : null,
    takeNotices,
    answerRevision,
    noKey,
    keyRefused: keyNotice.includes("refused"),
    resting: isResting(keyNotice),
    keyNotice,
    found,
    viewAsk,
    unfoldAsk,
    queuedCount,
    placing,
    clearNotice: useCallback(() => { const e = noticeQueue.snapshot(); if (e?.kind === "notice") noticeQueue.drop("notice", e.key); }, [noticeQueue]),
    undoId,
    latestUndoId,
    revertAsk,
    correctable,
    // Where your attention is, as told to the core: the "this" mark on the map picks from it (Attention.tsx).
    attending: attention.current,
    // A brick's `select` (bricks/contract.ts): that thread is "this", as a card selected on the map would be, until your
    // attention moves again.
    select: useCallback((thread_id: string | null) => attention.current.tell(thread_id, null, send), [send]),
    // A brick's `position` (bricks/contract.ts): a card or a point put somewhere on the canvas, for every window; a
    // drag's steps go at most once a frame, its last one on the drop (positions-core.ts `placeSender`).
    position: placeAt,
    // A brick's `annotate`: a margin note on words of a point, for every window (core annotate.rs); one the core would
    // refuse for its words is said here and never sent.
    annotate: useCallback((thoughtId: string, quote: string, text: string, context?: AnchorContext) => {
      const made = annotateMessage(thoughtId, quote, text, context);
      if ("refused" in made) { sayNotice(made.refused); setUndoId(null); answered(); return false; }
      return sendOrWarn(made.message);
    }, [sendOrWarn]),
    // Offline it's disabled; a click that races the drop says so (sendOrWarn) instead of doing nothing, as ⌘Z does.
    undo: (id: number) => { setUndoId(null); sendOrWarn(JSON.stringify({ type: "undo", id })); },
    // ⌘Z / Ctrl+Z: "undo that" without words, the core's last turn for you (catalog.rs `undo_last`).
    undoLast: useCallback(() => { setUndoId(null); sendOrWarn(JSON.stringify({ type: "undo_last" })); }, [sendOrWarn]),
    // A proposal's Rename or Merge (apply) or its ×, and the Undo on an AI rename's or a merge's note.
    tidy: useCallback((id: string, apply: boolean) => sendOrWarn(JSON.stringify({ type: "tidy", id, apply })), [sendOrWarn]),
    // Newest first, so each puts back the title or thread from before it.
    untidy: (undo: TidyUndo[]) => [...undo].reverse().forEach((u) => sendOrWarn(JSON.stringify({ type: "untidy", ...u }))),
    // The Undo on a note about ideas or tasks the AI withdrew or corrected: each as it was, newest first.
    restore: (ids: string[]) => [...ids].reverse().forEach((id) => sendOrWarn(JSON.stringify({ type: "restore", id }))),
    hideMapChange: useCallback(() => { const e = noticeQueue.snapshot(); if (e?.kind === "map") noticeQueue.drop("map", e.key); }, [noticeQueue]),
    // A newer answer, made here: an Undo shown was for the one before ("The mic is already off." had "Expand everything"'s).
    // Said for a view request (`asked`), it stands down if the core has answered since: "No, I meant stop listening"
    // sends the view, then "Did … instead" with its Undo, and both can reach one render (review).
    showNotice: (message: string, asked?: ViewAsk | null) => {
      if (asked && answers.current > asked.answers) return;
      sayNotice(message);
      setUndoId(null);
      answered();
    },
    sendText: (text: string) => {
      const preset = talkCommand(text);
      if (preset !== null) {
        switchTalk(preset);
        sayNotice(preset ? "Talk is on. Say or type “all features” to go back." : "Your features are back.");
        setUndoId(null); answered(); return true;
      }
      const control = noticeCommand(text);
      if (control !== null) { noticeQueue.control(control); return true; }
      if (isDefaultRecap(text)) { requestRecap(); return true; }
      if (!queueKey.current || (socket.current?.readyState === WebSocket.OPEN && !identityReady.current)) {
        sayNotice("Waiting for this map to identify itself. Keep your words here and try again."); return false;
      }
      const parts = splitThought(text);
      try { outbox.current = readWaiting(queueKey.current!); } catch { /* A failed save below keeps the draft. */ }
      const online = socket.current?.readyState === WebSocket.OPEN;
      // Reserve the whole batch before sending: a full offline queue must keep the entire draft for retry.
      if (outbox.current!.length + parts.length > 50) {
        sayNotice("Too many thoughts are waiting to send. Reconnect, then try sending this one again."); answered(); return false;
      }
      const messages = parts.map((part) => JSON.stringify({ type: "text", id: thoughtId(), text: part }));
      {
        try {
          // Save the entire batch before telling the composer it can clear the draft.
          saveWaiting(queueKey.current!, messages);
        } catch {
          setRecovery(state => ({ ...state, storageUnavailable: true }));
          sayNotice("Couldn't save this thought. Keep it here, or choose Send online and wait for its receipt."); answered(); return false;
        }
        setRecovery(state => ({ ...state, storageUnavailable: false }));
        keepCaptures(messages, true);
        outbox.current = readWaiting(queueKey.current!);
        setQueuedCount(outbox.current.length);
      }
      if (online) for (const message of messages) socket.current!.send(message);
      if (parts.length > 1) { sayNotice(`Sent in ${parts.length} parts`); setUndoId(null); answered(); }
      return true;
    },
    sendAudio: (frame: ArrayBuffer) => { if (localMic.current) { volume.feed(frame); send(frame); } },
    // A pending permission prompt cannot migrate to a reconnected socket.
    micConnection: () => { const ws = socket.current; return () => socket.current === ws && ws?.readyState === WebSocket.OPEN; },
    listen: (on: boolean) => {
      volume.reset();
      const sent = send(JSON.stringify({ type: "listen", on }));
      const was = localMic.current;
      localMic.current = on && sent;
      micTail.current = was && !localMic.current && sent ? Date.now() + MIC_TAIL_MS : 0;
      if (!localMic.current) { stopListeningStep(); setListening(false); if (!micTail.current) { setPartial(""); setHandoff(""); } }
      return sent;
    },
    focus: (thread_id: string) => sendOrWarn(JSON.stringify({ type: "focus", thread_id })),
    stay: useCallback((thread_id: string | null) => sendOrWarn(JSON.stringify({ type: "stay", thread_id })), [sendOrWarn]),
    // "Try a sample map": the core fills an empty map with the sample, or the one named (core/src/sample.rs).
    sample: (name?: string) => sendOrWarn(JSON.stringify(name ? { type: "sample", name } : { type: "sample" })),
    setItem, approve, correct, unlink, tag, move, rename, remove,
    visible: useCallback(() => send(JSON.stringify({ type: "visible" })), [send]),
    explanations,
    whys,
    // "Why here?" on a point or a "While you were away" row: one ask at a time per thought; the core answers from the
    // map when it can, else asks the model once and keeps the answer as the thought's note.
    askWhy: useCallback((thought_id: string) => {
      if (!send(JSON.stringify({ type: "why_here", thought_id }))) {
        setWhys((w) => ({ ...w, [thought_id]: { text: "Not connected. Try again when connected.", failed: true } }));
        return;
      }
      setWhys((w) => ({ ...w, [thought_id]: { text: "", failed: false, pending: true } }));
    }, [send]),
    explain: (id: string, text: string, context: string, thread_id: string | null, reuse = false, source?: AnswerSource) =>
      send(JSON.stringify({ type: "explain", id, text, context, thread_id, reuse, ...(builtInOn("saved-answers") && source ? { source } : {}) })),
    keepAnswer: (id: string) => builtInOn("saved-answers") && send(JSON.stringify({ type: "keep_answer", id })),
    savedAnswerVisibility: (id: string, revision: number, removed: boolean) => builtInOn("saved-answers") && send(JSON.stringify({ type: "kept_answer_visibility", id, revision, removed })),
    // An "off" mark on an AI answer, or taking it back: the core journals it as a label for improving the prompt.
    mark: (kind: "explain" | "recap", id: string, off: boolean) => send(JSON.stringify({ type: "mark", kind, id, off })),
    importStatus,
    startImport: (id: string) => send(JSON.stringify({ type: "import_start", id })),
    cancelImport: () => send(JSON.stringify({ type: "import_cancel" })),
  };
}
