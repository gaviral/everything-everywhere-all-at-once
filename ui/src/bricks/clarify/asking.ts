// Asking: one sentence to Spark, one word back, or none.
export type Ask = { thoughtId: string; term: string; question: string };

export async function askAbout(text: string, context: readonly string[]) {
  const url = new URL("/clarify", location.origin);
  const room = new URLSearchParams(location.search).get("room");
  if (room) url.searchParams.set("room", room);
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, context }) });
  if (!response.ok) return null;
  const answer = await response.json() as { term: string | null; question?: string };
  return answer.term && answer.question ? { term: answer.term, question: answer.question } : null;
}
