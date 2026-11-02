import { asIdeas } from "./chunks";
import { capitalized, type Thought, type Thread, type World } from "./core";

// "Export my map" (or the Export button): the map as a Markdown file, made in this window from the map it already
// holds, so nothing leaves the machine but the file the person saves. Threads are headings in the map's own order
// (its threads in order, each followed by its branches one level down), thoughts are bullets in the order said with
// the time said, and a decision is marked where it was said. A bullet is the point as the card shows it; the words
// behind it stay where the card keeps them, one click away, and in the journal: with them, the file ran twice as long
// (the founder sample: 30 points, every one with a longer "said" line), and an outline is what people paste on. scripts/export-check.mjs holds it to that.

export type Exported = { name: string; text: string; threads: number; thoughts: number };

type Options = { now?: number; timeZone?: string; locale?: string };

// A choice said outright: "I decided…", "we've settled on…", "made up my mind", "we chose…". Not "I can't decide",
// "haven't decided" or "I'm going with Sam" (a trip, not a choice): a decision marked that wasn't one would misstate
// the person's own record, so only words that can't mean anything else count.
// Each clause is read on its own, and one that denies or asks it doesn't count: "I haven't made up my mind",
// "not sure we decided", "have we decided on the train" (speech often comes without its "?"), "if we chose…".
const DECIDED = /\b(?:(?:i|we)(?:'ve| have)? (?:finally )?(?:decided|settled on|chose)|made up (?:my|our) minds?)\b/i;
const DENIED = /\b(?:not|never|no|yet to)\b|n't\b/i;
const ASKED = /\b(?:have|has|had|did|do|does|if|whether)(?: you| i| we| they)?\s*$/i;

export function saysDecided(words: string): boolean {
  for (const clause of words.replace(/[’‘]/g, "'").match(/[^.,;!?]+[.,;!?]*/g) ?? []) {
    const found = DECIDED.exec(clause);
    if (!found || clause.trim().endsWith("?")) continue;
    const before = clause.slice(0, found.index);
    if (!DENIED.test(before) && !ASKED.test(before)) return true;
  }
  return false;
}

// Words that carry meaning, for matching a recap's decision to the thought it came from.
const QUIET = new Set(["the", "a", "an", "to", "of", "for", "and", "or", "on", "in", "at", "with", "my", "our", "it", "is", "be", "that", "this", "you", "your", "i", "we", "decided", "decide", "will"]);
const contentWords = (text: string) => new Set(text.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !QUIET.has(w)));

/** The thought a recap's decision restates: most of its words in the thought's point or words (the latest on a tie). */
export function decidedAt(decision: string, thoughts: Thought[]): Thought | null {
  const wanted = [...contentWords(decision)];
  if (wanted.length === 0) return null;
  let best: Thought | null = null;
  let bestShare = 0.6;
  for (const thought of thoughts) {
    const has = contentWords(`${thought.point} ${thought.text}`);
    const share = wanted.filter((w) => has.has(w)).length / wanted.length;
    if (share >= bestShare) { best = thought; bestShare = share; }
  }
  return best;
}

/** Text as Markdown shows it literally, on one line. */
export function inline(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/[\\`*_[\]<>]/g, "\\$&");
}

export function mapMarkdown(world: World, { now = Date.now(), timeZone, locale = "en-US" }: Options = {}): Exported {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const clock = new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit" });
  const date = new Intl.DateTimeFormat(locale, { timeZone, month: "short", day: "numeric" });
  const dateYear = new Intl.DateTimeFormat(locale, { timeZone, month: "short", day: "numeric", year: "numeric" });
  const thisYear = day.format(now).slice(0, 4);
  // As the map: a time well ahead of the clock (a sample dated for a demo) sorts first; an hour's grace for another
  // laptop's clock. Unknown (0) shows no time.
  const limit = now + 60 * 60 * 1000;
  const said = (t: Thought) => (t.at_ms > limit ? 0 : t.at_ms);
  const when = (ms: number, withDate: boolean) => {
    if (!withDate) return clock.format(ms);
    return `${(day.format(ms).slice(0, 4) === thisYear ? date : dateYear).format(ms)}, ${clock.format(ms)}`;
  };

  const byThread = new Map<string, Thought[]>();
  const waiting: Thought[] = [];
  for (const thought of world.thoughts) {
    if (thought.placed && thought.thread_id) byThread.set(thought.thread_id, [...(byThread.get(thought.thread_id) ?? []), thought]);
    else waiting.push(thought);
  }
  for (const group of byThread.values()) group.sort((a, b) => said(a) - said(b));
  const speakers = new Set(world.thoughts.map((t) => t.speaker));
  const who = (t: Thought) => (speakers.size > 1 ? `${inline(t.speaker)}: ` : "");

  // A recap's decisions, each on its thread (a merged one's on the thread it went into), said once.
  const live = (id: string) => {
    for (let hops = Object.keys(world.merged).length; hops > 0 && world.merged[id]; hops--) id = world.merged[id];
    return id;
  };
  // Only from a recap that still matches the map: a thought scratched (or placed) since in its window means the recap
  // spoke of a map that's gone, and an undone decision mustn't come back as **Decided:** (the core redoes it on asking).
  const current = (recap: World["recaps"][number]) => recap.thought_count === undefined || recap.thought_count ===
    world.thoughts.filter((t) => t.placed && t.thread_id && t.at_ms >= recap.since_ms && t.at_ms <= recap.through_ms).length;
  const decisions = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const recap of world.recaps.filter(current)) for (const item of recap.decisions) {
    const key = item.text.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const id = live(item.thread_id);
    decisions.set(id, [...(decisions.get(id) ?? []), item.text]);
  }

  // One bullet per point as the card shows it: words said across a pause read as one point, at the later one's place.
  const bullets = (thoughts: Thought[], marked: Set<string>) => {
    const lines: string[] = [];
    let lastDay = "";
    for (const { thought: t, heads } of asIdeas(thoughts, world.notes ?? {})) {
      const ms = said(t);
      const today = ms ? day.format(ms) : lastDay;
      const time = ms ? `${when(ms, today !== lastDay)} · ` : "";
      lastDay = today;
      const point = capitalized(t.point || t.text);
      const decided = [t, ...heads].some((part) => marked.has(part.id));
      lines.push(`- ${time}${who(t)}${decided ? "**Decided:** " : ""}${inline(point)}`);
      count++;
    }
    return lines;
  };

  const saidDecided = (thoughts: Thought[]) => new Set(thoughts.filter((t) => saysDecided(`${t.point} ${t.text}`)).map((t) => t.id));
  const ids = new Set(world.threads.map((t) => t.id));
  const children = new Map<string | null, Thread[]>();
  for (const thread of world.threads) {
    const parent = thread.parent_id && ids.has(thread.parent_id) ? thread.parent_id : null;
    children.set(parent, [...(children.get(parent) ?? []), thread]);
  }
  const out: string[] = [];
  const done = new Set<string>();
  let count = 0;
  const section = (thread: Thread, depth: number) => {
    if (done.has(thread.id)) return;
    done.add(thread.id);
    const thoughts = byThread.get(thread.id) ?? [];
    const marked = saidDecided(thoughts);
    const unmatched: string[] = [];
    for (const decision of decisions.get(thread.id) ?? []) {
      const at = decidedAt(decision, thoughts);
      if (at) marked.add(at.id); else unmatched.push(decision);
    }
    out.push("", `${"#".repeat(Math.min(depth, 6))} ${inline(thread.title) || "Untitled"}`, "");
    const lines = [
      ...unmatched.map((d) => `- **Decided:** ${inline(capitalized(d))}`),
      ...bullets(thoughts, marked),
      ...world.actions.filter((a) => a.thread_id === thread.id && a.status !== "dismissed").map((a) =>
        `- [${a.status === "done" ? "x" : " "}] ${a.kind === "event" ? "Event" : "Reminder"}: ${inline(a.title)}${a.when ? ` · ${inline(a.when)}` : ""}${a.status === "new" ? " (proposed by AI)" : ""}`),
      ...world.suggestions.filter((s) => s.thread_id === thread.id && s.status === "kept").map((s) => `- Idea: ${inline(s.text)}`),
    ];
    out.push(...(lines.length ? lines : ["- Nothing said here yet"]));
    for (const branch of children.get(thread.id) ?? []) section(branch, depth + 1);
  };
  for (const root of children.get(null) ?? []) section(root, 2);
  // A thread on a loop of parents (never expected) still makes it in.
  for (const thread of world.threads) section(thread, 2);
  if (waiting.length) {
    out.push("", "## Not placed yet", "", ...bullets([...waiting].sort((a, b) => said(a) - said(b)), saidDecided(waiting)));
  }

  const threads = world.threads.length;
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const head = ["# Thread map", "", `Exported ${dateYear.format(now)}, ${clock.format(now)} · ${plural(threads, "thread")} · ${plural(count, "thought")}`];
  const stamp = `${day.format(now)}-${new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now).replace(":", "")}`;
  return { name: `thread-map-${stamp}.md`, text: [...head, ...out, ""].join("\n"), threads, thoughts: count };
}

/** What the notice says once the file is made. */
export function exportedNotice(e: Exported): string {
  return `Exported ${e.threads} ${e.threads === 1 ? "thread" : "threads"} and ${e.thoughts} ${e.thoughts === 1 ? "thought" : "thoughts"} as ${e.name}`;
}

/** Hands the file to the browser to save: a link to it in this page's memory, clicked, then let go. */
export function download(e: Exported): void {
  const url = URL.createObjectURL(new Blob([e.text], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = e.name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked a moment later: some browsers start the save only after the click returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
