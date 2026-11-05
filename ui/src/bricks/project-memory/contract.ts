import type { BrickProps } from "../contract";

export type MemoryKind = "decision" | "part" | "ask" | "revision";
export type MemoryVisibility = "public" | "private";

/** Only explicitly supplied public material can enter this read-only view. */
export interface MemorySource {
  readonly id: string;
  readonly visibility: MemoryVisibility;
  readonly title: string;
  readonly locator: string;
  readonly excerpt: string;
}

export interface MemoryRecord {
  readonly id: string;
  readonly visibility: MemoryVisibility;
  readonly kind: MemoryKind;
  readonly title: string;
  readonly summary: string;
  readonly state: "current" | "unresolved";
  readonly sourceIds: readonly string[];
  readonly relatedIds?: readonly string[];
  readonly supersedes?: string;
  /** Ownership is evidence, never inferred from a mention or a missing DAG entry. */
  readonly ownership?: { readonly status: "receipt-needed" } | { readonly status: "confirmed"; readonly name: string };
}

export interface MemoryCollection {
  readonly visibility: MemoryVisibility;
  readonly title: string;
  readonly example: boolean;
  readonly sources: readonly MemorySource[];
  readonly records: readonly MemoryRecord[];
}

export interface ProjectMemoryProps extends BrickProps {
  /** Optional public collection. The default is a synthetic fixture, never the live map. */
  readonly memory?: MemoryCollection;
}

/** Synthetic workshop planning records for the example view. */
export const publicExample: MemoryCollection = {
  visibility: "public",
  title: "Community workshop",
  example: true,
  sources: [
    { id: "first-sketch", visibility: "public", title: "First sketch", locator: "Example note · 01", excerpt: "Begin on an empty canvas so the visitor can choose their own starting point." },
    { id: "walkthrough", visibility: "public", title: "Walkthrough review", locator: "Example note · 02", excerpt: "Replace the empty opening with a clearly labelled example. People should understand the project before adding anything. This replaces the first sketch's opening decision." },
    { id: "parts", visibility: "public", title: "Parts outline", locator: "Example note · 03", excerpt: "Project memory keeps decisions, parts, open asks and revisions together. Each record links to its supplied source. The venue plan is mentioned, but no owner is recorded in the outline." },
    { id: "receipt-gap", visibility: "public", title: "Receipt gap", locator: "Example note · 04", excerpt: "The original venue confirmation has not been supplied. Recover it and verify its owner and scope before assigning a replacement. A mention alone is not an assignment." },
    { id: "revision-review", visibility: "public", title: "Whole-project review", locator: "Example note · 05", excerpt: "For the next whole-project revision: keep the useful example opening, retain the replaced decision with its reason, and resolve the venue confirmation gap before revising ownership. Confirm which example best explains the project." },
  ],
  records: [
    { id: "useful-opening", visibility: "public", kind: "decision", title: "Open with a useful example", summary: "Show what the project does before asking someone to begin. Label the example clearly.", state: "current", sourceIds: ["walkthrough"], supersedes: "empty-opening", relatedIds: ["whole-review"] },
    { id: "memory-part", visibility: "public", kind: "part", title: "A memory for the whole project", summary: "A read-only index of the choices, pieces and questions that shape the next revision.", state: "current", sourceIds: ["parts"], relatedIds: ["whole-review"] },
    { id: "canvas-part", visibility: "public", kind: "part", title: "Venue plan · owner unverified", summary: "The lane is mentioned, but its original receipt is missing. Ownership stays unassigned until that evidence is recovered.", state: "unresolved", sourceIds: ["parts", "receipt-gap"], relatedIds: ["recover-receipt"], ownership: { status: "receipt-needed" } },
    { id: "recover-receipt", visibility: "public", kind: "ask", title: "Recover the venue confirmation", summary: "Find the original receipt, verify scope and ownership, then consider whether a replacement is needed.", state: "unresolved", sourceIds: ["receipt-gap"], relatedIds: ["canvas-part", "whole-review"] },
    { id: "example-question", visibility: "public", kind: "ask", title: "Which example tells the story?", summary: "Choose the public example that makes the whole project easiest to understand.", state: "unresolved", sourceIds: ["revision-review"], relatedIds: ["useful-opening"] },
    { id: "whole-review", visibility: "public", kind: "revision", title: "Keep the reasons when the plan changes", summary: "Carry the current opening forward, preserve the replaced choice, and leave the venue coordinator open pending its receipt.", state: "current", sourceIds: ["revision-review"], relatedIds: ["useful-opening", "empty-opening", "recover-receipt"] },
    { id: "empty-opening", visibility: "public", kind: "decision", title: "Start with a blank canvas", summary: "The first sketch left the opening empty. The walkthrough replaced this with a useful example.", state: "current", sourceIds: ["first-sketch"], relatedIds: ["whole-review"] },
  ],
};
