import { useCallback, useEffect, useState } from "react";
import { playTune, unlockTune } from "./apps-audio";

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

export type AppsServerMsg = { type: "apps_build"; build: AppBuild } | { type: "apps_sound"; name: string; playful?: boolean };

/** A tune the browser wouldn't play yet: which app, and which tune. */
export interface PendingTune { name: string; playful: boolean }

// The first click, tap or key press lets the page play sound. Taps count only when they end (pointerup).
const UNLOCK_EVENTS = ["pointerdown", "pointerup", "keydown"] as const;

export function useApps() {
  const [build, setBuild] = useState<AppBuild | null>(null);
  const [soundPending, setSoundPending] = useState<PendingTune | null>(null);
  const reset = useCallback(() => setBuild(null), []);
  useEffect(() => {
    for (const event of UNLOCK_EVENTS) window.addEventListener(event, unlockTune);
    return () => { for (const event of UNLOCK_EVENTS) window.removeEventListener(event, unlockTune); };
  }, []);
  const receive = useCallback((message: { type: string }) => {
    const msg = message as AppsServerMsg;
    if (msg.type === "apps_build") { setBuild(msg.build); return true; }
    if (msg.type === "apps_sound") {
      const playful = !!msg.playful;
      if (!playTune(playful)) setSoundPending({ name: msg.name, playful });
      return true;
    }
    return false;
  }, []);
  return { build, soundPending, receive, reset, clearSound: () => setSoundPending(null) };
}
