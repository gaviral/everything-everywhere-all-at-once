import type { DemoPart, Evidence, MachineAdapter } from "./contracts";

const observedAt = "2026-11-04T18:00:00Z";
const syntheticEvidence: Evidence = { source: "Synthetic profile fixture", observedAt, kind: "synthetic" };
const setupEvidence: Evidence = { source: "Local Reminders connector permission guide",
  observedAt: "2026-11-04T18:59:53Z", kind: "platform-research" };
export const syntheticParts: readonly DemoPart[] = [
  { id: "portable-map", title: "Portable example", description: "Inspect a synthetic topic map. No live model or native connector is used.", requirements: [] },
  { id: "native-reminders", title: "Native Reminders", description: "Inspect readiness for the local Mac Reminders connector. No reminder is created here.", requirements: [
    { id: "local", label: "Local host", fact: "host", accepts: ["local"], missing: "The native connector needs a local host; a hosted browser cannot control your Mac apps." },
    { id: "mac", label: "Mac operating system", fact: "os", accepts: ["macos"], missing: "The native connector needs macOS. Use the portable example on other systems." },
    { id: "ready", label: "Verified installation", fact: "installation", accepts: ["ready"], missing: "Supply evidence that the local installation is ready. Version and hardware requirements remain unverified." },
    { id: "app", label: "Reminders installed", fact: "reminders", accepts: ["installed"], missing: "Supply dated evidence that Reminders is installed on the host." },
    { id: "permission", label: "Automation permission", fact: "automation", accepts: ["granted"], missing: "The app that starts the local host needs permission to control Reminders.",
      setup: { instruction: "On the Mac host, open System Settings › Privacy & Security › Automation. Allow the app that starts the host to control Reminders, then supply updated permission evidence. This view never changes that setting.", evidence: setupEvidence } },
  ] },
];

const profile = (label: string, values: Record<string, string>, kind: Evidence["kind"] | "user-agent" = "synthetic") => ({ label,
  facts: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value, evidence: { ...syntheticEvidence, kind } }])) });
export const syntheticProfiles = {
  "Mac · permission denied": profile("Synthetic Mac · permission denied", { host: "local", os: "macos", installation: "ready", reminders: "installed", automation: "denied" }),
  "Mac · verified": profile("Synthetic Mac · supplied prerequisites verified", { host: "local", os: "macos", installation: "ready", reminders: "installed", automation: "granted" }),
  "Non-Mac": profile("Synthetic Linux host", { host: "local", os: "linux", installation: "ready", reminders: "missing", automation: "denied" }),
  "Unknown evidence": profile("Synthetic machine · no evidence", {}),
  "Browser claims Mac": profile("Synthetic browser claim · unverified", { host: "local", os: "macos", installation: "ready", reminders: "installed", automation: "granted" }, "user-agent"),
  "Hosted Mac": profile("Synthetic hosted Mac", { host: "hosted", os: "macos", installation: "ready", reminders: "installed", automation: "granted" }),
};
export type SyntheticProfileName = keyof typeof syntheticProfiles;

/** In-memory supplier only. The counter makes off-state adapter activity inspectable. */
export function createSyntheticAdapter() {
  let current: unknown = syntheticProfiles["Mac · permission denied"];
  let reads = 0;
  const listeners = new Set<() => void>();
  const adapter: MachineAdapter = {
    now: () => "2026-11-04T22:00:00Z",
    read() { reads++; return current; },
    subscribe(changed) { listeners.add(changed); return () => { listeners.delete(changed); }; },
  };
  return { adapter,
    supply(input: unknown) { current = input; listeners.forEach(listener => listener()); },
    activity: () => ({ reads, subscriptions: listeners.size }),
  };
}
