// The Remote's own demo: with no room, the page plays samples/demo-jobs.json (the timeline scripts/demo-jobs.mjs plays to a
// core) as if an AI helper called "agent" were sending it, so a phone opened on its own still has work to show and a
// question to answer. Every job in it says it's simulated, and so does the page.
import raw from "../../../samples/demo-jobs.json?raw";
import { receiveGuide, type GuideMsg } from "../guide-core";
import { receiveJob, resetJobs, type JobMsg } from "../work-jobs";
import type { Ask } from "./ask";

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

/** Plays the feed from the start, `speed` times faster than real time (the file's `at` is in seconds). Answers continue
 *  this local feed; stopping it cancels playback and takes what it showed away. */
export function playFeed(speed = 1, steps: readonly Step[] = STEPS) {
  resetJobs();
  const jobs = steps.map((step) => step.message).filter((m) => m.type === "job");
  const card = jobs.find((m) => m.id === "demo-card" && m.status === "waiting");
  const birthday = jobs.find((m) => m.id === "demo-birthday");
  let active = true, cardWaiting = false, answered = false;
  const timers = steps.map((step) => window.setTimeout(() => {
    if (!active) return;
    const m = step.message;
    if (answered && ((m.type === "hold" && m.text === card?.result) ||
      (m.type === "job" && m.id === birthday?.id && m.status === "waiting"))) return;
    if (m === card) cardWaiting = true;
    deliver(step);
  }, (step.at * 1000) / speed));
  const answer = (ask: Ask, text: string): boolean => {
    if (!active || !cardWaiting || answered || ask.by !== HELPER || ask.text !== card?.result) return false;
    const choice = text.trim().toLowerCase();
    const result = choice === "keep it a surprise" || choice === "keep it a surprise, thanks"
      ? "Keeps the class a surprise"
      : choice === "mention the pottery class in mom's card" ? "Mentions the pottery class" : null;
    if (result && card && birthday) {
      answered = true;
      cardWaiting = false;
      for (const message of [
        { ...card, status: "done" as const, result },
        { ...birthday, status: "done" as const, result: "Class found · card ready" },
        { type: "hold" as const, text: "" },
      ]) deliver({ at: 0, message });
    }
    return true;
  };
  const stop = () => {
    active = false;
    for (const timer of timers) window.clearTimeout(timer);
    deliver({ at: 0, message: { type: "hold", text: "" } });
    resetJobs();
  };
  return { answer, stop };
}
