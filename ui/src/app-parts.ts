import type { MiniApp, Watcher } from "./apps-core";

/** Availability of the implementation here, separate from an app's on/off switch. */
export interface PartsState {
  connected: boolean;
  noKey: boolean;
  keyRefused: boolean;
  resting: boolean;
  callsCapped: boolean;
  microphone: boolean;
  sound: boolean;
}

export interface AppPart {
  id: string;
  name: string;
  source: string;
  configuration: string;
  unavailable: string;
  children: AppPart[];
}

function watcherConfiguration(w: Watcher): string {
  switch (w.kind) {
    case "new_thought": return `After ${w.min_points ?? 1} points in a topic`;
    case "phrase": return `Phrase: ${w.phrase}`;
    case "topic": return `Topic: ${w.topic}`;
    case "volume": return `Level ${w.level}, sustained for ${w.seconds} seconds`;
    case "time": return `${new Date(w.at_ms).toLocaleString()}; repeat every ${w.every_secs} seconds (0 = once)`;
    case "app_request": return "Search saved apps before composing a new one";
  }
}

const WATCHERS: Record<Watcher["kind"], string> = {
  new_thought: "New thought watcher", phrase: "Phrase watcher", topic: "Topic watcher",
  volume: "Volume watcher", time: "Time watcher", app_request: "App request watcher",
};

/** Uses the saved composition, not a second list of sample apps. Definitions are shared by kind;
 * settings belong to each placement. Sources follow the actual Rust/browser execution paths. */
export function appParts(app: MiniApp, state: PartsState): AppPart[] {
  const offline = state.connected ? "" : "Core disconnected";
  const model = offline || (state.keyRefused ? "AI key refused" : state.resting ? "AI allowance exhausted"
    : state.noKey ? "No AI key" : state.callsCapped ? "Hourly model call limit reached" : "");
  const part = (id: string, name: string, source: string, configuration: string, unavailable = offline, children: AppPart[] = []): AppPart =>
    ({ id, name, source, configuration, unavailable, children });
  const w = app.watcher;
  const input = w.kind === "volume"
    ? part("input:volume", "Microphone levels", "ui/src/apps-audio.ts · volumeReporter", "Local microphone readings, sent to the core",
      offline || (state.microphone ? "" : "Microphone is off in this window"))
    : w.kind === "app_request"
      ? part("input:apps", "Saved apps", "core/src/apps.rs · search", "Apps on the current map")
      : w.kind === "time"
        ? part("input:clock", "Core clock", "core/src/apps.rs · run / timer_due", "Checked every second")
        : part("input:thoughts", "Placed thoughts", "core/src/apps.rs · run / on_thought", "New thoughts after placement", model);
  const parts = [part(`watcher:${w.kind}`, WATCHERS[w.kind], `core/src/apps.rs · ${w.kind === "volume" ? "volume" : w.kind === "time" ? "timer_due" : w.kind === "app_request" ? "search" : "on_thought"}`,
    watcherConfiguration(w), input.unavailable, [input])];
  if (app.prompt) parts.push(part("prompt:model", "Model prompt", "core/src/apps.rs · search / execute → model",
    `${app.prompt.system}\n\nTemplate\n${app.prompt.template}`, model));
  for (const p of app.publishers) {
    const publisher = p.kind === "sound"
      ? part("publisher:sound", "Play a tune", "core/src/apps.rs · execute → ui/src/apps-audio.ts · playTune",
        w.kind === "volume" ? "Silly tune" : "Light tune", offline || (state.sound ? "" : "Browser audio is not running"))
      : p.kind === "card"
        ? part("publisher:card", "Show a card", "core/src/apps.rs · execute → SuggestionAdded", p.text)
        : p.kind === "app_block"
          ? part("publisher:app-block", "Propose connection steps", "core/src/apps.rs → core/src/app_blocks/mod.rs",
            `Match: ${p.block.query}\nCalendar date: ${p.block.when}\nReminders → Calendar → tune; each step requires local confirmation`)
        : part("publisher:reminder", "Propose a reminder", "core/src/apps.rs · execute → ActionProposed",
          `${p.title}\nWhen: ${p.when || "No date"}\nApproval is required before adding to Reminders`);
    // App-request watchers use search/offer, not execute. The stored publisher is part of
    // the saved schema but is not called by that path; don't present it as a live output.
    if (w.kind === "app_request") {
      publisher.unavailable = offline || "Search returns an app match; this saved publisher is not executed";
      publisher.source = "core/src/apps.rs · search → offer (publisher bypassed)";
    }
    parts.push(publisher);
  }
  return parts;
}

export function partUses(apps: readonly MiniApp[]) {
  const uses = new Map<string, { places: number; apps: { id: string; name: string }[] }>();
  const visit = (part: AppPart, app: MiniApp) => {
    const use = uses.get(part.id) ?? { places: 0, apps: [] };
    use.places++;
    if (!use.apps.some((a) => a.id === app.id)) use.apps.push({ id: app.id, name: app.name });
    uses.set(part.id, use);
    part.children.forEach((child) => visit(child, app));
  };
  const state: PartsState = { connected: true, noKey: false, keyRefused: false, resting: false, callsCapped: false, microphone: true, sound: true };
  apps.forEach((app) => appParts(app, state).forEach((part) => visit(part, app)));
  return uses;
}
