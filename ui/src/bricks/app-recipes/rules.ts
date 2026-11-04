import type { AppRecipe, MiniApp } from "../contract";

export const RECIPE_MAX = 32 * 1024;
const bytes = (s: string) => new TextEncoder().encode(s).length;
function object(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))
    || keys.some(k => !(k in value))) throw Error("Invalid recipe fields.");
}
function text(value: unknown, max: number, empty = false): asserts value is string {
  if (typeof value !== "string" || bytes(value) > max || (!empty && !value.trim())) throw Error("Recipe text is empty or too long.");
}
function number(value: unknown, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw Error("Invalid recipe number.");
}
function integer(value: unknown, min: number, max: number) { number(value, min, max); if (!Number.isInteger(value)) throw Error("Recipe number must be whole."); }
function template(value: unknown, fields: string[], empty = false) {
  text(value, 2000, empty);
  let rest = value;
  while (rest.includes("{")) {
    rest = rest.slice(rest.indexOf("{") + 1);
    const end = rest.indexOf("}");
    if (end < 0 || !fields.includes(rest.slice(0, end))) throw Error("Unknown or unfinished recipe template field.");
    rest = rest.slice(end + 1);
  }
}
/** Closed, versioned, byte bounded; the core repeats validation with its authoritative app validator. */
export function parseRecipe(raw: string): AppRecipe {
  if (bytes(raw) > RECIPE_MAX) throw Error("Recipe must be at most 32 KiB.");
  const r: unknown = JSON.parse(raw);
  object(r, ["version", "name", "purpose", "watcher", "prompt", "publishers", "cooldown_secs"]);
  if (r.version !== 1) throw Error("Unsupported recipe version.");
  const lower = JSON.stringify(r).toLowerCase();
  if (["://", "javascript:", "data:", "eval(", "require(", "#!/", "onerror=", "onclick=", "<script", "</", "=>", "function(", "function (", "-----begin", "bearer ", "api_key", "api-key", "password", "access_token", "sk-proj-"].some(s => lower.includes(s))) throw Error("Recipe cannot contain code, URLs or credentials.");
  text(r.name, 80); text(r.purpose, 240); integer(r.cooldown_secs, 10, 3600);
  const w = r.watcher as Record<string, unknown>;
  if (!w || typeof w !== "object") throw Error("Invalid watcher.");
  switch (w.kind) {
    case "phrase": object(w, ["kind", "phrase"]); text(w.phrase, 160); break;
    case "topic": object(w, ["kind", "topic"]); text(w.topic, 160); break;
    case "new_thought": object(w, "min_points" in w ? ["kind", "min_points"] : ["kind"]); if ("min_points" in w) integer(w.min_points, 0, 8); break;
    case "volume": object(w, ["kind", "level", "seconds"]); number(w.level, .01, 1); integer(w.seconds, 1, 30); break;
    default: throw Error("Not portable yet: this watcher.");
  }
  const inputs = ["thought", "points", "topic", "time"];
  if (r.prompt !== null) {
    object(r.prompt, ["system", "template"]); text(r.prompt.system, 4000); template(r.prompt.template, inputs, true);
  }
  if (!Array.isArray(r.publishers) || r.publishers.length < 1 || r.publishers.length > 3) throw Error("Recipe needs one to three publishers.");
  for (const p of r.publishers) {
    if (!p || typeof p !== "object") throw Error("Invalid publisher.");
    const fields = [...inputs, "text", "when"];
    switch (p.kind) {
      case "card": object(p, ["kind", "text"]); template(p.text, fields); break;
      case "sound": object(p, ["kind"]); break;
      case "reminder": object(p, "when" in p ? ["kind", "title", "when"] : ["kind", "title"]); template(p.title, fields); if ("when" in p) template(p.when, fields, true); break;
      default: throw Error("Not portable yet: this publisher.");
    }
  }
  return r as unknown as AppRecipe;
}
export function recipeOf(app: MiniApp): AppRecipe {
  return parseRecipe(JSON.stringify({ version: 1, name: app.name, purpose: app.purpose, watcher: app.watcher,
    prompt: app.prompt, publishers: app.publishers, cooldown_secs: app.cooldown_secs }));
}
export function previewRecipe(r: AppRecipe): string[] {
  const w = r.watcher;
  const watch = w.kind === "phrase" ? `Watch for the phrase “${w.phrase}”.` : w.kind === "topic" ? `Watch for the topic “${w.topic}”.`
    : w.kind === "volume" ? `Watch for volume above ${w.level} for ${w.seconds} seconds.` : `Watch each new thought after ${w.min_points ?? 0} points.`;
  return [`${r.name}: ${r.purpose}`, watch, r.prompt ? `When enabled, ask the model using the quoted prompt “${r.prompt.system}” and template “${r.prompt.template}”.` : "Use no model prompt.",
    ...r.publishers.map(p => p.kind === "card" ? `Show a card: “${p.text}”.` : p.kind === "sound" ? "Play a short local tune." : `Propose a reminder for approval: “${p.title}”, when “${p.when ?? ""}”.`), `Wait at least ${r.cooldown_secs} seconds between runs.`];
}
