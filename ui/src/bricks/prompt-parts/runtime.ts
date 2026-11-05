import { INPUT_LIMIT, type PromptPart } from "./records";

function endpoint(path: string) {
  const url = new URL(path, location.origin);
  const room = new URLSearchParams(location.search).get("room");
  if (room) url.searchParams.set("room", room);
  return url;
}

function validateInput(input: string) {
  if (!input.trim()) throw new Error("Add a thought or paste some text first.");
  if (Array.from(input).length > INPUT_LIMIT) throw new Error("Keep each part’s input under 12,000 characters.");
}

async function readStream(response: Response, onText: (text: string) => void) {
  if (!response.body) throw new Error("Spark returned no answer. Try again.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "", output = "", complete = false;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    if (typeof message.error === "string") throw new Error("Spark could not finish this part. Try again.");
    if (typeof message.question === "string" && message.question.trim()) throw new Error(`Spark needs more context: ${message.question}`);
    if (typeof message.delta === "string") {
      output += message.delta;
      if (output.length > 32_000) throw new Error("The answer exceeded this part’s limit.");
      onText(output);
    }
    if (message.done === true) complete = true;
  };
  try {
    while (true) {
      const chunk = await reader.read();
      pending += decoder.decode(chunk.value, { stream: !chunk.done });
      if (pending.length > 64_000) throw new Error("Spark returned an oversized response.");
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        consume(pending.slice(0, newline)); pending = pending.slice(newline + 1);
      }
      if (chunk.done) break;
    }
    consume(pending);
    if (!complete || !output.trim()) throw new Error("The answer ended early. Try again.");
    return output;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Prefer the dedicated route; the existing Meta-only runner keeps this folder deployable alone. */
export async function runPart(part: PromptPart, input: string, signal: AbortSignal, onText: (text: string) => void): Promise<string> {
  validateInput(input);
  const post = (path: string, body: object) => fetch(endpoint(path), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
  let response = await post("/flow/prompt-parts", { part: part.id, input });
  if (response.status === 404 || response.status === 405) {
    response = await post("/flow/run", { prompt: part.prompt, input });
  }
  if (!response.ok) throw new Error("Spark is unavailable. Your input is kept; try again.");
  if (response.headers.get("content-type")?.includes("application/x-ndjson")) return readStream(response, onText);
  const result = await response.json();
  if (typeof result.output !== "string" || !result.output.trim() || result.output.length > 32_000) {
    throw new Error("Spark could not finish this part. Your input is kept; try again.");
  }
  onText(result.output);
  return result.output;
}
