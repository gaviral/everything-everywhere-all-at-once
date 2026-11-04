// The crew's four calls to the core.
import type { Part } from "./run";

async function post<T>(path: string, body: unknown): Promise<T> {
  const url = new URL(path, location.origin);
  const room = new URLSearchParams(location.search).get("room");
  if (room) url.searchParams.set("room", room);
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Core returned ${response.status}`);
  const value = await response.json();
  if (value.error) throw new Error(value.error);
  return value;
}

export const planParts = (said: string) => post<{ run: string; name: string; parts: Part[]; ms: number }>("/crew/plan", { said });
export type Built = { html: string; commit: string; reused: boolean; ms: number };
export const buildPart = (run: string, part: Part, made: string[], repair?: { broke: string; before: string }) =>
  post<Built>("/crew/build", { run, part, made, ...repair });
export const mergePart = (run: string, id: string) => post<{ commit: string }>("/crew/merge", { run, id });
export const promote = (run: string, to: "staging" | "main", keep: unknown[] = []) =>
  post<{ commit: string; commits: string; catalog: number }>("/crew/promote", { run, to, keep });
