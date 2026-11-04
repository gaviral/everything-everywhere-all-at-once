import { useEffect, useRef, useState } from "react";
import { EXAMPLE_FAST, EXAMPLE_QUESTION, type AdvisorProvider, type FastState, type ReviewState, type Scenario } from "./contract";

/** Deterministic injected results demonstrate the handoff, never a measured model run. */
export function exampleProvider(scenario: Scenario): AdvisorProvider {
  return {
    kind: "injected",
    async fast() {
      if (scenario === "fast-failure") throw new Error("Example fast model is unavailable. Try another example.");
      return EXAMPLE_FAST;
    },
    async review() {
      if (scenario === "review-failure") throw new Error("Example larger model is unavailable. The fast answer is still here.");
      const agrees = scenario === "agree";
      return {
        model: "Llama 3.3 70B", source: "injected", verdict: agrees ? "agree" : "disagree",
        text: agrees ? "Show three features, connected by one clear audience goal." : "Show one complete journey. Keep the other features ready for questions.",
        rationale: agrees ? "Breadth can work if each feature advances the same story. Rehearse the transitions first." : "Three separate reveals risk hiding the payoff. One finished journey makes the value easier to remember.",
      };
    },
  };
}

/** Existing same-origin provider seam; core/src/flow.rs pins the runtime to Meta. */
async function flowText(question: string, signal: AbortSignal): Promise<string> {
  const url = new URL("/flow/run", location.origin);
  const room = new URLSearchParams(location.search).get("room");
  if (room) url.searchParams.set("room", room);
  const response = await fetch(url, {
    method: "POST", signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "Give a concise first-pass recommendation in at most three sentences. State uncertainty. This is advice only; take no action.", input: question, variant: 1 }),
  });
  if (!response.ok) throw new Error(`Meta request failed (${response.status}). Try again explicitly.`);
  if (!response.body || !response.headers.get("content-type")?.includes("ndjson")) throw new Error("Meta returned no usable result stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "", text = "", done = false;
  function consume(line: string) {
    if (!line.trim()) return;
    const event: unknown = JSON.parse(line);
    if (!event || typeof event !== "object") throw new Error("Meta returned an invalid result.");
    const row = event as Record<string, unknown>;
    if (row.error) throw new Error("Meta could not finish the answer. Try again explicitly.");
    if (row.question) throw new Error(`Meta needs clarification: ${String(row.question).slice(0, 500)}`);
    if (done) throw new Error("Meta returned data after completion.");
    if (typeof row.delta === "string") text += row.delta;
    if (row.done === true) done = true;
    if (text.length > 12000) throw new Error("Meta answer exceeded the preview limit.");
  }
  try {
    while (true) {
      const chunk = await reader.read();
      pending += decoder.decode(chunk.value, { stream: !chunk.done });
      if (pending.length > 32000) throw new Error("Meta stream exceeded the preview limit.");
      const lines = pending.split("\n"); pending = lines.pop() ?? "";
      lines.forEach(consume);
      if (chunk.done) break;
    }
    consume(pending);
    if (!done || !text.trim()) throw new Error("Meta stopped before completing an answer.");
    return text.trim();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export const flowProvider: AdvisorProvider = {
  kind: "live",
  async fast(question, signal) { return { text: await flowText(question, signal), model: "Muse Spark 1.3", source: "live" }; },
};

/** One operation at a time. Edits, mode changes, cancellation and unmount invalidate it. */
export function useAdvisor(provider: AdvisorProvider) {
  const [question, setQuestion] = useState(provider.kind === "injected" ? EXAMPLE_QUESTION : "");
  const [fast, setFast] = useState<FastState>(provider.kind === "injected" ? { status: "ready", answer: EXAMPLE_FAST } : { status: "idle" });
  const [review, setReview] = useState<ReviewState>({ status: "idle" });
  const [reason, setReason] = useState("Challenge assumptions");
  const [notice, setNotice] = useState(provider.kind === "injected" ? "Example fast result ready. Larger review is your choice." : "Type a question. Only an explicit request sends it to Meta.");
  const pending = useRef<AbortController | null>(null);
  const version = useRef(0);
  const busy = fast.status === "running" || review.status === "running";
  function invalidate() { version.current++; pending.current?.abort(); pending.current = null; }
  useEffect(() => () => { version.current++; pending.current?.abort(); }, []);
  function reset(example: boolean, failed = false) {
    invalidate(); setQuestion(example ? EXAMPLE_QUESTION : ""); setReview({ status: "idle" });
    setFast(example && failed ? { status: "failed", message: "Example fast model is unavailable. Retry or choose another example." } : example ? { status: "ready", answer: EXAMPLE_FAST } : { status: "idle" });
    setNotice(example ? "Injected example · no model request made." : "Type a question. Only an explicit request sends it to Meta.");
  }
  function edit(value: string) {
    invalidate(); setQuestion(value); setFast({ status: "idle" }); setReview({ status: "idle" });
    setNotice("Question changed. Request a new fast answer before reviewing.");
  }
  function cancel() {
    invalidate();
    if (fast.status === "running") setFast({ status: "idle" });
    if (review.status === "running") setReview({ status: "idle" });
    setNotice("Request cancelled. No answer was chosen.");
  }
  async function run(stage: "fast" | "review") {
    if (pending.current || !question.trim()) return;
    if (stage === "review" && (fast.status !== "ready" || !provider.review)) return;
    const controller = new AbortController(); pending.current = controller;
    const epoch = ++version.current;
    if (stage === "fast") { setFast({ status: "running" }); setReview({ status: "idle" }); }
    else setReview({ status: "running" });
    setNotice(stage === "fast" ? "Requesting a first pass…" : "Review requested explicitly. Keeping the fast answer visible…");
    try {
      if (stage === "fast") {
        const answer = await provider.fast(question.trim(), controller.signal);
        if (epoch !== version.current) return;
        setFast({ status: "ready", answer }); setNotice("Fast answer ready. Review is optional.");
      } else if (fast.status === "ready" && provider.review) {
        const answer = await provider.review({ question: question.trim(), fast: fast.answer, reason }, controller.signal);
        if (epoch !== version.current) return;
        setReview({ status: "done", answer }); setNotice(answer.verdict === "agree" ? "The reviewer agrees. You still decide." : "The models disagree. Compare both answers before deciding.");
      }
    } catch (error) {
      if (epoch !== version.current) return;
      const message = error instanceof Error ? error.message : "The request could not finish.";
      if (stage === "fast") setFast({ status: "failed", message });
      else setReview({ status: "failed", message });
      setNotice("Request failed. Nothing was accepted or retried automatically.");
    } finally { if (epoch === version.current) pending.current = null; }
  }
  return { question, fast, review, reason, setReason, notice, busy, reset, edit, cancel, run };
}
export type AdvisorController = ReturnType<typeof useAdvisor>;
