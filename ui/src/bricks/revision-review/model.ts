export type Decision = { kind: 'approved' | 'changes'; actor: string; at: number; reason: string };
export type Receipt = { effect: string; evidence: string; actor: string; at: number };
export type Revision = { number: number; title: string; body: string; ready: boolean; decision?: Decision; receipt?: Receipt };
export type Passage = { start: number; end: number; quote: string };
export type Annotation = Passage & { id: string; revision: number; text: string; actor: string };
export type Artifact = { id: string; example: boolean; sourceId?: string; revisions: Revision[]; comments: Annotation[] };
export type Workspace = { artifacts: Artifact[]; selected: string };
export type Command =
  | { kind: 'revise'; title: string; body: string }
  | { kind: 'ready' }
  | { kind: 'comment'; passage: Passage; text: string; actor: string }
  | { kind: 'decide'; decision: Decision; confirmed: boolean }
  | { kind: 'complete'; receipt: Receipt; confirmed: boolean };

export function current(artifact: Artifact): Revision { return artifact.revisions[artifact.revisions.length - 1]; }
export function status(revision: Revision): string {
  if (revision.receipt && revision.decision?.kind === 'approved') return 'Completed · human verified';
  if (revision.decision?.kind === 'approved') return 'Approved · effect pending';
  if (revision.decision?.kind === 'changes') return 'Changes requested';
  return revision.ready ? 'Ready for review' : 'Draft';
}
export function createArtifact(title: string, body: string, sourceId?: string): Artifact {
  return { id: crypto.randomUUID(), example: false, sourceId, revisions: [{ number: 1, title: title.trim(), body, ready: false }], comments: [] };
}
export function initialWorkspace(): Workspace {
  const body = 'Give every visitor a clear next step.\n\nThe opening guide explains where to begin, what to try, and how to return to the map.';
  const quote = 'a clear next step';
  return { selected: 'example', artifacts: [{ id: 'example', example: true,
    revisions: [{ number: 1, title: 'A warmer welcome', body, ready: true }],
    comments: [{ id: 'example-note', revision: 1, start: body.indexOf(quote), end: body.indexOf(quote) + quote.length, quote, text: 'Can we name the first action here?', actor: 'Example reviewer' }] }] };
}
/** Every mutation carries the revision the person saw. A late action cannot approve newer words. */
export function applyCommand(artifact: Artifact, observed: number, command: Command): Artifact {
  const revision = current(artifact);
  if (observed !== revision.number) return artifact;
  if (command.kind === 'revise') {
    if (!command.title.trim() || !command.body.trim() || (command.title.trim() === revision.title && command.body === revision.body)) return artifact;
    return { ...artifact, revisions: [...artifact.revisions, { number: revision.number + 1, title: command.title.trim(), body: command.body, ready: false }] };
  }
  if (command.kind === 'comment') {
    const { start, end, quote } = command.passage;
    if (!command.text.trim() || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > revision.body.length || revision.body.slice(start, end) !== quote) return artifact;
    return { ...artifact, comments: [...artifact.comments, { ...command.passage, id: crypto.randomUUID(), revision: observed, text: command.text.trim(), actor: command.actor }] };
  }
  let next = revision;
  if (command.kind === 'ready' && !revision.decision) next = { ...revision, ready: true };
  if (command.kind === 'decide' && revision.ready && !revision.decision && command.confirmed && command.decision.actor.trim()
    && (command.decision.kind === 'approved' || command.decision.reason.trim())) next = { ...revision, decision: command.decision };
  if (command.kind === 'complete' && revision.decision?.kind === 'approved' && !revision.receipt && command.confirmed
    && command.receipt.effect.trim() && command.receipt.evidence.trim() && command.receipt.actor.trim()) next = { ...revision, receipt: command.receipt };
  return next === revision ? artifact : { ...artifact, revisions: [...artifact.revisions.slice(0, -1), next] };
}
