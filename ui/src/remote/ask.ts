// What waits for you on the Remote: the questions the AI helpers ask, one at a time, and the quick answers a question
// offers. Pure, so scripts/remote-check.mjs runs it without a browser.
import type { Job } from "../bricks/contract";
import { questions } from "../bricks/work-spine/jobs";
import type { Held } from "../guide-core";

/** One question waiting for an answer. */
export interface Ask {
  /** Who asks, by the name an answer goes to (`answer`'s `to`). */
  by: string;
  text: string;
  /** Simulated: it came from a prepared feed, not a real helper. */
  demo: boolean;
  /** Where the guide holds it (guide-core.ts `Held.n`): each one that says these words, dropped once it's answered. */
  held: number[];
}

/** Who asked what: a job that waits on a question and a hold that asks it are the same question. */
export const keyOf = (ask: Pick<Ask, "by" | "text">) => `${ask.by}|${ask.text}`;

/** The questions waiting for you, the oldest first: each waiting job that asks (a job's words are a question only where it
 *  is the one waiting: work-spine/jobs.ts `questions`), then those a helper only held, in the order held. A job still
 *  waiting is a question even if its hold never reached this window (one sent before it joined isn't replayed, the jobs
 *  are), and one in `answered` (keys, `keyOf`) is not shown again. */
export function asksOf(jobs: readonly Job[], held: readonly Held[], answered: ReadonlySet<string> = new Set()): Ask[] {
  const asking = questions(jobs);
  const out = new Map<string, Ask>();
  const waiting = jobs.filter((job) => asking.has(job.id) && job.result).sort((a, b) => a.at_ms - b.at_ms);
  for (const job of waiting) out.set(keyOf({ by: job.by, text: job.result! }), { by: job.by, text: job.result!, demo: job.demo, held: [] });
  for (const hold of held) {
    if (hold.kind !== "question") continue;
    const key = keyOf(hold);
    const ask = out.get(key) ?? { by: hold.by, text: hold.text, demo: false, held: [] };
    ask.held.push(hold.n);
    out.set(key, ask);
  }
  return [...out].filter(([key]) => !answered.has(key)).map(([, ask]) => ask);
}

/** A question that begins like one asks for a yes, a no or a choice among things it names, not for what follows. */
const QUESTION_WORDS = /^(am|are|is|was|were|do|does|did|can|could|will|would|shall|should|may|might|must|have|has|had|which|what|who|whom|whose|when|where|why|how)\b/i;
/** The longest a quick answer runs. */
const OPTION_WORDS = 12;

/** Quick answers for a question that reads "A, or B?": A and B, each a short instruction that answers it as it stands
 *  ("Mention the pottery class in Mom's card, or keep it a surprise?"). Nothing for any other question, or one that
 *  may not answer so: it begins as a question does ("Do you want it, or not?"), names three things, or holds a colon. */
export function options(question: string): string[] {
  const line = question.trim().replace(/\s+/g, " ").replace(/[?!.]+$/, "");
  const at = line.search(/,\s+or\s+/i);
  if (at < 0) return [];
  const first = line.slice(0, at).trim();
  const second = line.slice(at).replace(/^,\s+or\s+/i, "").trim();
  const long = (words: string) => words.split(" ").length > OPTION_WORDS;
  if (!first || !second || /[,:]/.test(first + second) || QUESTION_WORDS.test(first) || long(first) || long(second)) return [];
  if (first.toLowerCase() === second.toLowerCase()) return [];
  return [first, second].map((words) => words[0].toUpperCase() + words.slice(1));
}
