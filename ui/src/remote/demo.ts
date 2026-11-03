// The Remote's own demo: with no room, the page plays samples/demo-jobs.json (the timeline scripts/demo-jobs.mjs plays to a
// core) as if an AI helper called "agent" were sending it, so a phone opened on its own still has work to show and a
// question to answer. Every job in it says it's simulated, and so does the page.
import raw from "../../../samples/demo-jobs.json?raw";
import { receiveGuide, type GuideMsg } from "../guide-core";
import { receiveJob, resetJobs, type JobMsg } from "../work-jobs";

/** What the feed sends, as the file has it (scripts/demo-jobs.mjs checks the file itself). */
type Step = { at: number; message: { type: "job" } & Omit<JobMsg, "type" | "by" | "at_ms"> | { type: "hold"; text: string } };

/** The helper the feed plays. */
export const HELPER = "agent";

const read = (): Step[] => {
  try {
    const steps: unknown = JSON.parse(raw);
    return Array.isArray(steps) ? steps.filter((step): step is Step => Number.isFinite(step?.at) && typeof step?.message?.type === "string") : [];
  } catch { return []; }
};
export const STEPS: readonly Step[] = read();

/** One step arrives now, stamped as the core stamps what it relays. */
function deliver({ message }: Step) {
  const at_ms = Date.now();
  if (message.type === "job") {
    const job: JobMsg = { ...message, by: HELPER, at_ms };
    receiveJob(job);
  } else {
    const hold: GuideMsg = { type: "guide", kind: "hold", target: null, text: message.text, by: HELPER, at_ms };
    receiveGuide(hold);
  }
}

/** Plays the feed from the start, `speed` times faster than real time (the file's `at` is in seconds); returns the way to
 *  stop it, which takes what it showed away. */
export function playFeed(speed = 1, steps: readonly Step[] = STEPS): () => void {
  resetJobs();
  const timers = steps.map((step) => window.setTimeout(() => deliver(step), (step.at * 1000) / speed));
  return () => {
    for (const timer of timers) window.clearTimeout(timer);
    const withdraw: GuideMsg = { type: "guide", kind: "hold", target: null, text: "", by: HELPER, at_ms: Date.now() };
    receiveGuide(withdraw);
    resetJobs();
  };
}
