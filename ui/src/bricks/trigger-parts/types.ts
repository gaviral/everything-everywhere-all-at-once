import type { Item, Review, SourceSpan } from "../../msg1351/dictation-breakdown/contract";

export type MatcherId = "exact" | "regex" | "fuzzy" | "ai";
export type Candidate = { id: string; source: SourceSpan };
export type Evidence = { matcher: MatcherId; phrase: string; reason: string; example?: boolean };
export type Trigger = Candidate & Evidence;
export type Judgement = { id: string; reason: string };
export type Dispute = Judgement & { by: "You" | "Muse Spark" | "Example AI" };
export type StartedPart = { item: Item; trigger?: Trigger };
export type Breakdown = { review: Review; parts: StartedPart[]; triggers: Trigger[] };
export type Switches = Record<MatcherId, boolean>;
