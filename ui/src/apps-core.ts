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
  stage: "searching" | "composing" | "validating" | "ready" | "matched" | "kept" | "discarded" | "failed";
  steps: string[];
  draft: MiniApp | null;
  match_id: string | null;
  message: string;
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
      const publishers: Publisher[] = c.sound ? [{ kind: "sound" }]
        : [{ kind: "card", text: "Voices have been loud for a little while. A small pause might help." }];
      return { ...a, publishers };
    }) };
  }
}

export type AppsServerMsg = { type: "apps_build"; build: AppBuild } | { type: "apps_sound"; name: string };

export function useApps() {
  const [build, setBuild] = useState<AppBuild | null>(null);
  const [soundPending, setSoundPending] = useState("");
  const reset = useCallback(() => setBuild(null), []);
  useEffect(() => {
    window.addEventListener("pointerdown", unlockTune);
    window.addEventListener("keydown", unlockTune);
    return () => {
      window.removeEventListener("pointerdown", unlockTune);
      window.removeEventListener("keydown", unlockTune);
    };
  }, []);
  const receive = useCallback((message: { type: string }) => {
    const msg = message as AppsServerMsg;
    if (msg.type === "apps_build") { setBuild(msg.build); return true; }
    if (msg.type === "apps_sound") {
      if (!playTune()) setSoundPending(msg.name);
      return true;
    }
    return false;
  }, []);
  return { build, soundPending, receive, reset, clearSound: () => setSoundPending("") };
}
