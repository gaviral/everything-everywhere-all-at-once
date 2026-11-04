import { endpoint, request, type Part } from "./data";
export type Result = { text?: string; image?: string; ms: number; error?: string; label?: string };
export async function runPart(part: Part, mode: string, input: string, signal: AbortSignal): Promise<Result> {
  if (!part.prompt) return request("/workshop/run", signal, { model: part.model, mode, input });
  const response = await fetch(endpoint("/flow/run"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: part.prompt, input }), signal });
  if (!response.ok || !response.body) throw Error("The box could not run. Try again.");
  if (!response.headers.get("content-type")?.includes("ndjson")) { const value = await response.json(); throw Error(value.error || "No stream returned"); }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = "", text = "", ms = 0, done = false;
  const accept = (line: string) => {
    const value = JSON.parse(line);
    if (value.error) throw Error(value.error);
    text += value.delta ?? ""; ms = value.ms ?? ms;
    if (value.done) { done = true; if (value.question) text = value.question; }
  };
  for (;;) {
    const chunk = await reader.read();
    pending += decoder.decode(chunk.value, { stream: !chunk.done });
    const lines = pending.split("\n"); pending = lines.pop() ?? "";
    lines.filter(Boolean).forEach(accept);
    if (chunk.done) break;
  }
  if (pending.trim()) accept(pending);
  if (!done) throw Error("The stream ended early. Try again.");
  return { text, ms };
}
