// A run: what was said, the parts it became, and how far each has climbed. Nothing here talks to anything.
export type Stage = "waiting" | "building" | "trying" | "fixing" | "merged" | "off";
export type Level = "waiting" | "moving" | "done";
export type Part = { id: string; name: string; job: string; needs: string[]; reuse?: string | null };
export type PartRun = Part & { stage: Stage; html?: string; commit?: string; ms?: number; reused?: boolean; fixed?: boolean; why?: string };
export type Run = {
  id: string; name: string; said: string; startedAt: number; planMs: number; parts: PartRun[];
  staging: Level; main: Level; commit?: string; commits?: string; catalog?: number; doneMs?: number;
};

/** How far up its branch each stage has climbed, 0 to 1. */
export const CLIMB: Record<Stage, number> = { waiting: 0.02, building: 0.42, trying: 0.72, fixing: 0.6, merged: 1, off: 0.72 };

export const started = (plan: { run: string; name: string; parts: Part[]; ms: number }, said: string, at: number): Run => ({
  id: plan.run, name: plan.name, said, startedAt: at, planMs: plan.ms, staging: "waiting", main: "waiting",
  parts: plan.parts.map(part => ({ ...part, needs: part.needs ?? [], stage: "waiting" })),
});

export const withPart = (run: Run, id: string, change: Partial<PartRun>): Run =>
  ({ ...run, parts: run.parts.map(part => part.id === id ? { ...part, ...change } : part) });

export const merged = (run: Run) => run.parts.filter(part => part.stage === "merged");
export const count = (run: Run, stage: Stage) => run.parts.filter(part => part.stage === stage).length;

/** Each part once everything it needs has settled; everything else at the same time. */
export async function inDependencyOrder(parts: readonly Part[], work: (part: Part) => Promise<void>) {
  const settled = new Map<string, Promise<void>>();
  for (const part of parts) {
    settled.set(part.id, Promise.all(part.needs.map(need => settled.get(need))).then(() => work(part)));
  }
  await Promise.all(settled.values());
}
