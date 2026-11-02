import { useCallback, useEffect, useRef, useState } from "react";
import { playTune, unlockTune } from "./apps-audio";
import { siteText, useSite } from "./site";

export type Watcher =
  | { kind: "new_thought"; min_points?: number }
  | { kind: "phrase"; phrase: string }
  | { kind: "topic"; topic: string }
  | { kind: "volume"; level: number; seconds: number }
  | { kind: "time"; at_ms: number; every_secs: number }
  | { kind: "app_request" };

export type Publisher = { kind: "card"; text: string } | { kind: "sound" } | { kind: "reminder"; title: string; when: string };

export interface MiniApp {
  id: string;
  name: string;
  purpose: string;
  watcher: Watcher;
  prompt: { system: string; template: string } | null;
  publishers: Publisher[];
  enabled: boolean;
  request: string;
  cooldown_secs: number;
  created_ms: number;
  last_run_ms: number;
}

export interface AppBuild {
  id: string;
  request: string;
  stage: "searching" | "composing" | "validating" | "ready" | "matched" | "kept" | "discarded" | "declined" | "failed";
  steps: string[];
  draft: MiniApp | null;
  match_id: string | null;
  message: string;
  /** When declined: the closest app the blocks can make, as a request to send instead ("" when none). */
  instead: string;
}

// The Volume watcher's two choices, as the core sets them (`volume_choice` in apps.rs).
const VOLUME_CARD: Publisher = { kind: "card", text: "Voices have been loud for a little while. A small pause might help." };
export function volumeChoice(sound: boolean): { purpose: string; publishers: Publisher[] } {
  return sound
    ? { purpose: "Play a short, silly tune and suggest a pause when voices stay loud, to ease the tension.", publishers: [{ kind: "sound" }, VOLUME_CARD] }
    : { purpose: "Offer a quiet pause when voices stay loud for a few seconds.", publishers: [VOLUME_CARD] };
}

export interface AppsWorld { apps: MiniApp[]; apps_seeded: boolean }

export type AppChange =
  | { type: "app_registered"; app: MiniApp }
  | { type: "app_enabled"; id: string; enabled: boolean }
  | { type: "app_removed"; id: string }
  | { type: "app_ran"; id: string; at_ms: number }
  | { type: "app_output"; id: string; sound: boolean }
  | { type: "apps_seeded" };

export function isAppChange(c: { type: string }): c is AppChange {
  return ["app_registered", "app_enabled", "app_removed", "app_ran", "app_output", "apps_seeded"].includes(c.type);
}

export function applyAppChange<T extends AppsWorld>(world: T, c: AppChange): T {
  switch (c.type) {
    case "app_registered":
      return world.apps.some((a) => a.id === c.app.id) ? world : { ...world, apps: [...world.apps, c.app] };
    case "app_removed": return { ...world, apps: world.apps.filter((a) => a.id !== c.id) };
    case "apps_seeded": return { ...world, apps_seeded: true };
    default: return { ...world, apps: world.apps.map((a) => {
      if (a.id !== c.id) return a;
      if (c.type === "app_enabled") return { ...a, enabled: c.enabled };
      if (c.type === "app_ran") return { ...a, last_run_ms: c.at_ms };
      if (a.watcher.kind !== "volume") return a;
      return { ...a, ...volumeChoice(c.sound) };
    }) };
  }
}

export type AppsServerMsg = { type: "apps_build"; build: AppBuild } | { type: "apps_sound"; name: string; playful?: boolean; why?: string };

/** What the core says when it won't start a build (core/src/apps.rs `compose`): an empty request or one over its
 *  2,000 bytes, or another app still waiting. No build answers the request then. */
export const DESCRIBE_APP = "Describe the app in one short sentence.";
const REFUSALS = [DESCRIBE_APP, "Keep or discard the current app first."];

/** Over the core's limit: it counts UTF-8 bytes, so 1,000 "é" are 2,000 of them, though an input counts 1,000. The
 *  core counts after dropping a leading "make an app that"; this counts it too, so only a request within a few bytes
 *  of the limit that starts that way is held back here and not there. */
export function tooLongForApp(request: string): boolean {
  return new TextEncoder().encode(request.trim()).length > 2000;
}

/** Where a build shows, as it arrives: the id it keeps in the Apps panel, or null for the dock. Asked for in the panel's
 *  own form (or its "Make that instead"), there; said, typed in the composer, or still waiting when this window
 *  connected, in the dock. `askedInPanel` is what the panel last sent. */
export function panelBuildFor(build: AppBuild, askedInPanel: string | null, previous: string | null): string | null {
  // The core drops a leading "Make an app that…", so what was typed in the panel ends with the build's request.
  const asked = !!askedInPanel?.trimEnd().endsWith(build.request);
  // The same build sent again after a reconnect stays where it was.
  return asked || previous === build.id ? build.id : null;
}

/** A tune the browser wouldn't play yet: which app, which tune, and what set it off ("voices stayed loud for 3 s"). */
export interface PendingTune { name: string; playful: boolean; why: string }

/** A tune that just played: which app and why, said under the Apps pill for a moment, since a sound out of nowhere
 *  reads as a glitch. `id` tells two tunes in a row apart, so the second keeps its full time on screen. */
export interface PlayedTune { name: string; why: string; id: number }

/** The line for a tune that played: "♪ Loud Silly Tune: voices stayed loud for 3 s" (the ♪ is drawn, not read). */
export const playedLine = (tune: { name: string; why: string }) => tune.why ? `${tune.name}: ${tune.why}` : `${tune.name} played its tune`;

// The first click, tap or key press lets the page play sound. Taps count only when they end (pointerup).
const UNLOCK_EVENTS = ["pointerdown", "pointerup", "keydown"] as const;

export function useApps() {
  const [build, setBuild] = useState<AppBuild | null>(null);
  // Hosted, a build that failed for the key says so in the site's words (site.ts).
  const hosted = useRef(false);
  hosted.current = useSite().hosted;
  // A build asked for in the Apps panel's own form (or by its "Make that instead") shows there, where it was asked.
  // Any other (said, typed in the composer, or still waiting when this window connected) shows in the dock.
  const [panelBuild, setPanelBuild] = useState<string | null>(null);
  const panelRequest = useRef<string | null>(null);
  const latest = useRef<string | null>(null);
  const [soundPending, setSoundPending] = useState<PendingTune | null>(null);
  const [played, setPlayed] = useState<PlayedTune | null>(null);
  // A new connection: a request sent on the old one gets no answer.
  const reset = useCallback(() => { latest.current = null; panelRequest.current = null; setBuild(null); }, []);
  useEffect(() => {
    for (const event of UNLOCK_EVENTS) window.addEventListener(event, unlockTune);
    return () => { for (const event of UNLOCK_EVENTS) window.removeEventListener(event, unlockTune); };
  }, []);
  const receive = useCallback((message: { type: string }) => {
    // A panel request the core refused claims no build: left waiting, it took the next one that ended the same way
    // (a composer build, then shown in the panel). The notice itself is the core's to show (core.ts).
    if (message.type === "notice" && REFUSALS.includes((message as { message?: string }).message ?? "")) panelRequest.current = null;
    const msg = message as AppsServerMsg;
    if (msg.type === "apps_build") {
      if (msg.build.id !== latest.current) {
        latest.current = msg.build.id;
        const asked = panelRequest.current;
        panelRequest.current = null;
        setPanelBuild((previous) => panelBuildFor(msg.build, asked, previous));
      }
      setBuild(hosted.current ? { ...msg.build, message: siteText(msg.build.message, true) } : msg.build);
      return true;
    }
    if (msg.type === "apps_sound") {
      const playful = !!msg.playful;
      const why = msg.why ?? "";
      if (playTune(playful)) setPlayed((last) => ({ name: msg.name, why, id: (last?.id ?? 0) + 1 }));
      else setSoundPending({ name: msg.name, playful, why });
      return true;
    }
    return false;
  }, []);
  return {
    build,
    /** Whether the current build was asked for in the Apps panel, so it shows there and not in the dock. */
    inPanel: !!build && build.id === panelBuild,
    /** Marks the next build as the panel's, before its request goes out (null takes that back if it couldn't go). */
    askedInPanel: useCallback((text: string | null) => { panelRequest.current = text; }, []),
    soundPending, receive, reset, clearSound: () => setSoundPending(null),
    played, setPlayed,
  };
}
