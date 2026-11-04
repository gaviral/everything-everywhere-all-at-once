import { useCallback, useState } from "react";
import { exampleCards, initialSchema, type RecordCard, type Workspace } from "./model";

type Visit = { workspace: Workspace; examples: RecordCard[] };
// Browser memory only. A map/speaker visit owns its cards even when the view unmounts.
// No source words go into localStorage, and a reload starts a new visit.
const visits = new Map<string, Visit>();

function remember(key: string, value: Visit) {
  visits.delete(key);
  visits.set(key, value);
  if (visits.size > 8) visits.delete(visits.keys().next().value!);
}

export function useBoardVisit(key: string) {
  const [visit, update] = useState<Visit>(() => visits.get(key) ?? {
    workspace: { schema: initialSchema, records: [], view: "board", example: true }, examples: exampleCards,
  });
  const setWorkspace = useCallback((next: Workspace | ((old: Workspace) => Workspace)) => {
    const old = visits.get(key) ?? visit;
    const value = { ...old, workspace: typeof next === "function" ? next(old.workspace) : next };
    remember(key, value); update(value);
  }, [key, visit]);
  const setExamples = useCallback((next: (old: RecordCard[]) => RecordCard[]) => {
    const old = visits.get(key) ?? visit;
    const value = { ...old, examples: next(old.examples) };
    remember(key, value); update(value);
  }, [key, visit]);
  return { ...visit, setWorkspace, setExamples };
}
