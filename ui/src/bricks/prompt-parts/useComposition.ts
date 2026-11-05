import { useEffect, useRef, useState } from "react";
import { usePluginState } from "../contract";
import { EXAMPLE_ANSWERS, EXAMPLE_INPUT, type PromptPart } from "./records";
import { runPart } from "./runtime";

export type Result = { partId: string; input: string; text: string; status: "example" | "running" | "done" | "failed" | "stopped" };
export type Composition = { source: string; results: Result[]; example: boolean };
const initial: Composition = { source: EXAMPLE_INPUT, example: true, results: [
  { partId: "explain-diff", input: EXAMPLE_INPUT, text: EXAMPLE_ANSWERS[0], status: "example" },
  { partId: "pr-description", input: EXAMPLE_ANSWERS[0], text: EXAMPLE_ANSWERS[1], status: "example" },
] };

export function useComposition() {
  const [composition, setComposition] = usePluginState<Composition>("composition", initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    setComposition(old => ({ ...old, results: old.results.map(row => row.status === "running" ? { ...row, status: "stopped" } : row) }));
    return () => { active.current?.abort(); active.current = null; };
  }, []);

  async function run(parts: PromptPart[], source: string) {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError("");
    const results: Result[] = [];
    let input = source;
    const publish = () => { if (active.current === controller) setComposition({ source, example: false, results: results.map(row => ({ ...row })) }); };
    try {
      for (const part of parts) {
        controller.signal.throwIfAborted();
        const row: Result = { partId: part.id, input, text: "", status: "running" };
        results.push(row); publish();
        const timeout = setTimeout(() => controller.abort(new Error("Spark took too long. Try again.")), 45_000);
        try {
          input = await runPart(part, input, controller.signal, text => { row.text = text; publish(); });
          controller.signal.throwIfAborted();
          row.status = "done"; publish();
        } finally { clearTimeout(timeout); }
      }
    } catch (reason) {
      const row = results.at(-1);
      if (row?.status === "running") row.status = controller.signal.aborted ? "stopped" : "failed";
      publish();
      if (active.current === controller) setError(controller.signal.aborted
        ? controller.signal.reason instanceof Error && controller.signal.reason.name !== "AbortError" ? controller.signal.reason.message : "Stopped. Completed answers and your input are kept."
        : reason instanceof Error ? reason.message : "This part could not finish. Try again.");
    } finally {
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }
  const showExample = () => { setComposition(initial); setError(""); };
  return { composition, busy, error, run, showExample, stop: () => active.current?.abort() };
}
