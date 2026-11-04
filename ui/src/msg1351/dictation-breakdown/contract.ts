export type SourceSpan = Readonly<{ start: number; end: number; text: string }>;
export type Kind = "action" | "question" | "note";
export type ReasonOrigin = "stated" | "inferred" | "unspecified" | "corrected";
export type QueueHome = Readonly<{ id: string; name: string; concepts: readonly string[] }>;
export type QueueProposal = Readonly<{ id: string; name: string; reason: string; duplicate: boolean }>;
export type Item = Readonly<{
  id: string; what: string; why: string; reasonOrigin: ReasonOrigin; kind: Kind;
  source: SourceSpan; reviewedBy: "unreviewed" | "human" | "red-team";
}>;
export type Review = Readonly<{ source: string; items: readonly Item[] }>;
export type WorkflowExport = Readonly<{
  schema: "dictation-breakdown/v1"; offsetUnit: "unicode-scalar"; source: string;
  items: readonly Readonly<Item & { queueProposals: readonly QueueProposal[] }>[];
}>;
