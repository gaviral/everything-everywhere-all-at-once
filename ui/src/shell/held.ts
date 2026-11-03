// Questions held for your pause (the Friend's, lane L4's `hold` message): a stack above the shelf, bottom right, its main
// words bold so they catch the eye, each with Answer ↵ and Later L. The guide holds a question here instead of saying it
// mid-sentence; the shell only shows the stack (shell/Held.tsx). Of this window only, newest on top.
import { useSyncExternalStore } from "react";

export type HeldQuestion = {
  /** One per question: holding the same id again replaces it. */
  id: string;
  /** Who asks: an AI participant's name ("Friend") shows ✦ before it. */
  by: string;
  /** The words that catch the eye, bold: "Which Saturday?" */
  main: string;
  /** The rest of it, plain: "Lena leaves on the 14th." */
  rest?: string;
  /** Answer ↵: what answering does (the Friend asks it now). Without one, the composer takes focus with the stack. */
  answer?: () => void;
  /** Later L: set aside until the next pause; the asker may hold it again then. */
  later?: () => void;
};

let held: readonly HeldQuestion[] = [];
const watchers = new Set<() => void>();
const changed = (next: readonly HeldQuestion[]) => { held = next; for (const watcher of watchers) watcher(); };

/** Holds a question for your pause (the newest on top); the same id again replaces it in place. */
export function holdQuestion(question: HeldQuestion) {
  const at = held.findIndex((q) => q.id === question.id);
  changed(at >= 0 ? held.map((q, i) => (i === at ? question : q)) : [question, ...held]);
}

/** Lets a question go: answered, set aside, or no longer worth asking. */
export function dropHeld(id: string) {
  if (held.some((q) => q.id === id)) changed(held.filter((q) => q.id !== id));
}

export function useHeld(): readonly HeldQuestion[] {
  return useSyncExternalStore((watcher) => { watchers.add(watcher); return () => { watchers.delete(watcher); }; }, () => held, () => held);
}

// The seam a page check (scripts/shell-check.mjs) and the guide's bridge use to hold one without the guide's code.
if (typeof window !== "undefined") (window as unknown as { e2a2oHold?: typeof holdQuestion }).e2a2oHold = holdQuestion;
