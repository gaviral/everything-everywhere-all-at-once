import { useCardNotice, type NoticeQueue } from "./notice-queue";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WhyHere } from "./whyhere";
import type { World } from "./core";
import { resolveMerged as resolve } from "./merges";
import { TIPS } from "./Tips";
import "./away.css";
import { Markdown } from "./md";

export const AWAY_AFTER_MS = 30_000;

// The card's rule, in its own words (C219: "how did it appear there … what about all the other things"): only
// threads where your own words landed while this window was hidden or in the background for 30 s or more, with the
// AI's new proposals on those threads; threads you didn't talk in, and other people's, stay out by design.
export const AWAY_WHAT = "Topics your thoughts were added to · newest first";
export const AWAY_WHEN = `Shown after ${AWAY_AFTER_MS / 1000} s or more away · a row takes you there`;

export type AwayItem = {
  key: string;
  threadId: string;
  thoughtId?: string;
  itemId?: string;
  title: string;
  detail: string;
  point?: string;
  kind: "thread" | "proposal";
  unfinished?: boolean;
  /** The row can say why its point went to that thread (whyhere.tsx): every thread row but a new top-level thread,
   *  whose "New thread" already is the answer. */
  why?: boolean;
  at: number;
  sourceAt?: number;
};

/** A map diff, not a recap request. Only this speaker's newly placed words count. */
export function awayItems(before: World, after: World, me: string, observed: Map<string, number> = new Map()): AwayItem[] {
  const placedBefore = new Set(before.thoughts.filter((t) => t.placed).map((t) => t.id));
  const oldThreads = new Set(before.threads.map((t) => resolve(after, t.id)));
  const threads = new Map(after.threads.map((t) => [t.id, t]));
  const own = after.thoughts.filter((t) => t.speaker === me && t.placed && t.thread_id);
  const landed = own.filter((t) => !placedBefore.has(t.id));
  // No card for an idle absence, other people's speech, renames or proposals alone.
  if (!landed.length) return [];
  const groups = new Map<string, typeof landed>();
  for (const thought of landed) {
    const id = resolve(after, thought.thread_id!);
    if (!threads.has(id)) continue;
    const group = groups.get(id) ?? [];
    group.push(thought);
    groups.set(id, group);
  }
  const lastOwn = new Map<string, typeof own[number]>();
  for (const thought of own) {
    const id = resolve(after, thought.thread_id!);
    const previous = lastOwn.get(id);
    if (!previous || thought.at_ms >= previous.at_ms) lastOwn.set(id, thought);
  }
  const newlyDropped = (id: string) => !before.threads.some((t) => resolve(after, t.id) === id && t.status === "dropped" && t.dropped_by === me);
  const unfinished = [...lastOwn.entries()].filter(([id, thought]) => {
    const thread = threads.get(id);
    return thread && ((thread.status === "dropped" && thread.dropped_by === me && newlyDropped(id))
      || (!thought.complete && groups.has(id) && (thread.status !== "dropped" || thread.dropped_by === me)));
  }).sort((a, b) => b[1].at_ms - a[1].at_ms)[0];
  const items: AwayItem[] = [];
  for (const [id, thoughts] of groups) {
    const latest = [...thoughts].sort((a, b) => b.at_ms - a.at_ms)[0];
    const changes = oldThreads.has(id) ? `${thoughts.length} new ${thoughts.length === 1 ? "point" : "points"}` : "New topic";
    const why = oldThreads.has(id) || !!threads.get(id)!.parent_id;
    items.push({ key: `thread:${id}`, threadId: id, thoughtId: latest.id, why, title: threads.get(id)!.title,
      detail: `${changes}${unfinished?.[0] === id ? " · Left unfinished" : ""} · ${latest.point || latest.text}`,
      point: latest.point || latest.text,
      kind: "thread", unfinished: unfinished?.[0] === id, sourceAt: latest.at_ms,
      at: thoughts.reduce((at, t) => Math.max(at, observed.get(t.id) ?? t.at_ms), 0) });
  }
  // A thought begun before looking away may be left behind when the speaker moves on.
  if (unfinished && !groups.has(unfinished[0])) {
    const [id, thought] = unfinished;
    items.push({ key: `thread:${id}`, threadId: id, thoughtId: thought.id, why: true, title: threads.get(id)!.title,
      detail: `Left unfinished · ${thought.point || thought.text}`, kind: "thread", unfinished: true,
      point: thought.point || thought.text,
      sourceAt: thought.at_ms, at: observed.get(`dropped:${id}`) ?? thought.at_ms });
  }
  const oldProposals = new Set([...before.suggestions, ...before.actions].map((p) => p.id));
  for (const proposal of [...after.suggestions, ...after.actions]) {
    const id = resolve(after, proposal.thread_id);
    // Proposals have no speaker field. Scope them to threads where this person landed words.
    if (oldProposals.has(proposal.id) || proposal.status !== "new" || !groups.has(id)) continue;
    items.push({ key: `proposal:${proposal.id}`, threadId: id, itemId: proposal.id,
      title: "text" in proposal ? proposal.text : proposal.title,
      detail: `New ${"text" in proposal ? "suggestion" : proposal.kind} · ${threads.get(id)!.title}`,
      kind: "proposal", at: observed.get(proposal.id) ?? threads.get(id)!.touched_ms });
  }
  // Your own threads lead, newest first; each one's new proposals follow it.
  const newest = (a: AwayItem, b: AwayItem) => b.at - a.at || (b.sourceAt ?? b.at) - (a.sourceAt ?? a.at) || a.key.localeCompare(b.key);
  return items.filter((item) => item.kind === "thread").sort(newest).flatMap((row) =>
    [row, ...items.filter((item) => item.kind === "proposal" && item.threadId === row.threadId).sort(newest)]);
}

/** Whether you spoke again after coming back, which dismisses the card: new speech arrives unplaced, said
 * at a time of its own. The rest of a turn the placer split keeps that turn's time, and imported points
 * arrive placed: neither is you speaking. */
export function spokeAgain(through: World, now: World, me: string): boolean {
  const said = new Set(through.thoughts.map((t) => t.at_ms));
  return now.thoughts.some((t) => t.speaker === me && !t.placed && !said.has(t.at_ms));
}

type Absence = { before: World; since: number; observed: Map<string, number> };
type Return = Absence & { through: World };

/** Hidden and blurred are one continuous absence; duplicate focus events cannot restart it. */
// `?recording` in the address: a screen recording driven from a terminal isn't someone walking away.
const RECORDING = typeof location !== "undefined" && (new URLSearchParams(location.search).has("recording") || new URLSearchParams(location.search).has("film"));

export function useAway(world: World, me: string, ready: boolean) {
  const current = useRef(world);
  current.current = world;
  const absence = useRef<Absence | null>(null);
  const [returned, setReturned] = useState<Return | null>(null);
  const dismiss = useCallback(() => setReturned(null), []);

  useEffect(() => {
    if (!ready || RECORDING) return;
    const looking = () => document.visibilityState === "visible" && document.hasFocus();
    const leave = () => {
      if (!absence.current) absence.current = { before: current.current, since: Date.now(), observed: new Map() };
    };
    const back = () => {
      if (!looking()) return;
      const away = absence.current;
      absence.current = null;
      if (away && Date.now() - away.since >= AWAY_AFTER_MS) {
        setReturned(awayItems(away.before, current.current, me, away.observed).length ? { ...away, through: current.current } : null);
      }
    };
    const visibility = () => { if (looking()) back(); else leave(); };
    if (!looking()) leave();
    window.addEventListener("blur", leave);
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", visibility);
      absence.current = null;
    };
  }, [ready, me]);

  useEffect(() => {
    const away = absence.current;
    if (away) {
      const now = Date.now();
      for (const thought of world.thoughts) if (thought.placed && !away.observed.has(thought.id)) away.observed.set(thought.id, now);
      for (const proposal of [...world.suggestions, ...world.actions]) if (!away.observed.has(proposal.id)) away.observed.set(proposal.id, now);
      for (const thread of world.threads) if (thread.status === "dropped" && thread.dropped_by === me && !away.observed.has(`dropped:${thread.id}`)) away.observed.set(`dropped:${thread.id}`, now);
    }
    // Continuing to speak is an action too; don't dismiss for late placement of an existing turn.
    if (returned && spokeAgain(returned.through, world, me)) dismiss();
  }, [world, me, returned, dismiss]);

  const items = useMemo(() => {
    if (!returned) return [];
    // Freeze the return boundary, but follow subsequent merges/renames and proposal decisions.
    const eligible = new Set(returned.through.thoughts.map((t) => t.id));
    const proposals = new Set([...returned.through.suggestions, ...returned.through.actions].map((p) => p.id));
    return awayItems(returned.before, { ...world,
      thoughts: world.thoughts.filter((t) => eligible.has(t.id)),
      suggestions: world.suggestions.filter((p) => proposals.has(p.id)),
      actions: world.actions.filter((p) => proposals.has(p.id)),
    }, me, returned.observed);
  }, [returned, world, me]);
  return { items, dismiss };
}

export function Away({ items: incoming, onFollow, onDismiss, onDismissFocus, queue }: {
  queue: NoticeQueue;
  items: AwayItem[];
  onFollow: (item: AwayItem) => void;
  onDismiss: () => void;
  onDismissFocus: () => void;
}) {
  const [why, setWhy] = useState<ReadonlySet<string>>(new Set());
  // A card gone forgets what it had open: a later card's row on the same thread would otherwise open (and ask) at once.
  useEffect(() => { if (!incoming.length) setWhy((open) => (open.size ? new Set() : open)); }, [incoming.length]);
  const notice = useCardNotice(queue, "away", incoming.length ? incoming.map((i) => `${i.key}:${i.at}`).join("|") : null,
    `Since you left ${AWAY_WHAT} ${incoming.map((i) => `${i.title} ${i.detail}`).join(" ")} ${AWAY_WHEN}`, onDismiss, false, incoming);
  const items = notice.data ?? [];
  if (!items.length || !notice.visible) return null;
  const flip = (key: string) => setWhy((open) => { const next = new Set(open); if (!next.delete(key)) next.add(key); return next; });
  const close = () => { notice.close(); onDismissFocus(); };
  return <section {...notice.hold} className="away" data-guide="away" aria-labelledby="away-title" onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); close(); }
  }}>
    <div className="away-top">
      {/* The rule, said where the question comes up (why these threads, and what about the rest): see awayItems. */}
      <div><h2 id="away-title">Since you left</h2><p>{AWAY_WHAT}</p></div>
      <button className="away-dismiss" onClick={close} aria-label="Dismiss Since you left">×</button>
    </div>
    <ol className="away-items" aria-label="What landed since you left">
      {items.map((item) => <li key={item.key}>
        {/* A row only takes you there; nothing is kept, added or dismissed from here. */}
        <a href={`#${item.itemId ? `item-${item.itemId}` : item.thoughtId ? `point-${item.thoughtId}` : `thread-${item.threadId}`}`}
          aria-describedby="away-when"
          onClick={(event) => { event.preventDefault(); onFollow(item); notice.close(); }}>
          <span className="away-text">
            <span className="away-title">{item.kind === "proposal" && <span className="away-mark" role="img" aria-label="AI proposal" data-tip={TIPS.awayProposal}>✦ </span>}{item.title}</span>
            <span className="away-detail">{item.point ? <>{item.detail.slice(0, -item.point.length)}<Markdown text={item.point} /></> : item.detail}</span>
          </span>
          <span className="away-go" aria-hidden="true">›</span>
        </a>
        {/* Why its point went there, on demand: the row stays one glance until asked (C225). */}
        {item.why && item.thoughtId && <button type="button" className="away-why" aria-expanded={why.has(item.key)}
          aria-controls={`away-why-${item.key}`} aria-label={`Why it went to ${item.title}`} onClick={() => flip(item.key)}>Why?</button>}
        {item.why && item.thoughtId && <p className="away-why-line" id={`away-why-${item.key}`} hidden={!why.has(item.key)}>
          {why.has(item.key) && <WhyHere thoughtId={item.thoughtId} auto />}
        </p>}
      </li>)}
    </ol>
    <p className="away-when" id="away-when">{AWAY_WHEN}</p>
  </section>;
}
