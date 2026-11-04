import type { DependencySnapshot } from "./contracts";

/** Wholly synthetic records. No operational plan or private source material. */
export function syntheticSnapshot(completed = false): DependencySnapshot {
  return { revision: completed ? "sample-2" : "sample-1", parts: [
    { id: "A", name: "Prepare interface", owner: "Interface team", fileScopes: ["example/interface/**"], prerequisites: [], evidence: completed ? "complete" : "pending" },
    { id: "B", name: "Build detail view", owner: "View team", fileScopes: ["example/detail/**"], prerequisites: ["A"], evidence: "pending" },
    { id: "C", name: "Write guide", owner: "Guide team", fileScopes: ["example/guide.md"], prerequisites: [], evidence: "pending" },
    { id: "D", name: "Refine interface", owner: "Craft team", fileScopes: ["example/interface/button.ts"], prerequisites: [], evidence: "pending" },
    { id: "U", name: "Await missing part", owner: "Adapter team", fileScopes: ["example/adapter/**"], prerequisites: ["MISSING"], evidence: "pending" },
    { id: "X", name: "Review first", owner: "Review team", fileScopes: ["example/first.md"], prerequisites: ["Y"], evidence: "pending" },
    { id: "Y", name: "Review second", owner: "Review team", fileScopes: ["example/second.md"], prerequisites: ["X"], evidence: "pending" },
  ] };
}
