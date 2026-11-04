import { stepDuration, steps } from "./example";

export type Phase = "ready" | "running" | "paused" | "cancelled" | "done";
export type Run = { phase: Phase; elapsed: number; outputs: string[][] };
export type Command = { type: "start" | "pause" | "resume" | "cancel" } | { type: "tick"; milliseconds: number };

export function newRun(): Run {
  return { phase: "ready", elapsed: 0, outputs: [] };
}

function advance(run: Run, milliseconds: number): Run {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return run;
  const elapsed = Math.min(steps.length * stepDuration, run.elapsed + milliseconds);
  const completed = Math.floor(elapsed / stepDuration);
  const outputs = [...run.outputs];
  while (outputs.length < completed) {
    const index = outputs.length;
    outputs.push(steps[index].run(outputs[index - 1] ?? []));
  }
  return { phase: completed === steps.length ? "done" : "running", elapsed, outputs };
}

/** Terminal states reject late ticks; only an explicit new run discards retained results. */
export function workflow(run: Run, command: Command): Run {
  switch (command.type) {
    case "start": return ["ready", "cancelled", "done"].includes(run.phase) ? { ...newRun(), phase: "running" } : run;
    case "pause": return run.phase === "running" ? { ...run, phase: "paused" } : run;
    case "resume": return run.phase === "paused" ? { ...run, phase: "running" } : run;
    case "cancel": return ["running", "paused"].includes(run.phase) ? { ...run, phase: "cancelled" } : run;
    case "tick": return run.phase === "running" ? advance(run, command.milliseconds) : run;
  }
}

export function stepState(run: Run, index: number): string {
  if (index < run.outputs.length) return "Done";
  if (run.phase === "cancelled") return "Cancelled";
  if (index > run.outputs.length || run.phase === "ready") return "Waiting";
  return run.phase === "paused" ? "Paused" : "Running";
}
