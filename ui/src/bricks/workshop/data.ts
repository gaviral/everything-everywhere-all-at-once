export type ModelRow = { model: string; step: string };
export type Part = { id: string; name: string; model: string; modes: string[]; prompt?: string };
export type Flow = { id: string; name: string; steps: { id: string; name: string; prompt: string }[] };
export type EventData = { unavailable?: boolean; updated?: string; sections: { title: string; items: string[] }[] };
export function endpoint(path: string) {
  const url = new URL(path, location.origin);
  const room = new URLSearchParams(location.search).get("room");
  if (room) url.searchParams.set("room", room);
  return url;
}
export async function request(path: string, signal?: AbortSignal, body?: unknown) {
  const response = await fetch(endpoint(path), { signal, ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  if (!response.ok) throw Error(`Core returned ${response.status}. Try again.`);
  const value = await response.json();
  if (value.error) throw Error(value.error);
  return value;
}
export function modelParts(rows: ModelRow[]): Part[] {
  const parts = new Map<string, Part>();
  for (const row of rows) {
    if (!row.model.startsWith("muse-")) continue;
    const part = parts.get(row.model) ?? { id: row.model, name: row.model.replace(/^muse-/, "Muse ").replaceAll("-", " "), model: row.model, modes: [] };
    if (!part.modes.includes(row.step)) part.modes.push(row.step);
    parts.set(row.model, part);
  }
  return [...parts.values()];
}
export function flowParts(flows: Flow[], model: string): Part[] {
  return flows.flatMap(flow => flow.steps.map(step => ({ id: `flow:${flow.id}:${step.id}`, name: step.name, model, modes: [flow.name], prompt: step.prompt })));
}
export type Command = { kind: "bring" | "remove"; name: string };
export function commandOf(raw: string): Command | null {
  const text = raw.trim().replace(/[.!?]+$/, "");
  const bring = text.match(/^bring (.+?)(?: here| to (?:the )?(?:desk|workshop))$/i);
  if (bring) return { kind: "bring", name: bring[1] };
  const remove = text.match(/^(?:take|send) (.+?) (?:away|back)$/i);
  return remove ? { kind: "remove", name: remove[1] } : null;
}
export function matches(parts: Part[], name: string) {
  const normal = (s: string) => s.toLowerCase().replace(/^muse[ -]/, "").replaceAll("-", " ");
  const exact = parts.filter(p => normal(p.name) === normal(name) || p.id === name);
  return exact.length ? exact : parts.filter(p => normal(p.name).includes(normal(name)));
}
