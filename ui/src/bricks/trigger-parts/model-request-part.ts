/** The existing same-origin Flow endpoint is pinned server-side to Meta Muse Spark. */
export async function requestJudgement(prompt: string, input: unknown, signal: AbortSignal): Promise<string> {
  const url = new URL("/flow/run", location.origin);
  const room = new URLSearchParams(location.search).get("room");
  if (room) url.searchParams.set("room", room);
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, input: JSON.stringify(input), variant: 1 }), signal });
  if (!response.ok) throw new Error(`Muse Spark is unavailable (${response.status}).`);
  if (!response.body || !response.headers.get("content-type")?.includes("ndjson")) throw new Error("Muse Spark did not return a response stream.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = "", output = "", complete = false;
  const readLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (typeof event.error === "string") throw new Error(event.error);
    if (event.question) throw new Error("Muse Spark requested clarification. Edit the dictation and try again.");
    if (typeof event.delta === "string") output += event.delta;
    if (event.done === true) complete = true;
    if (output.length > 16000) throw new Error("The AI reply exceeded the review limit.");
  };
  try {
    while (true) {
      const chunk = await reader.read();
      pending += decoder.decode(chunk.value, { stream: !chunk.done });
      if (pending.length > 32000) throw new Error("The AI response exceeded the stream limit.");
      const lines = pending.split("\n"); pending = lines.pop() ?? "";
      lines.forEach(readLine);
      if (chunk.done) break;
    }
    readLine(pending);
    if (!complete) throw new Error("Muse Spark stopped before finishing. Your splits are unchanged.");
    return output;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
