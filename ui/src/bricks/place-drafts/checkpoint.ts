import { useState } from "react";

export type Draft = { text: string; start: number; end: number; direction: "forward" | "backward" | "none"; scroll: number };
export type Quote = { blockId: string; start: number; end: number; text: string };
export type Place = { blockId: string; offset: number; scroll: number };
export type Checkpoint = {
  version: 1; active: string; folded: Record<string, boolean>; drafts: Record<string, Draft>;
  places: Record<string, Place>; quotes: Record<string, Quote>;
};
const visits = new Map<string, { value: Checkpoint; warning: string; writable: boolean }>();
const empty = (): Checkpoint => ({ version: 1, active: "", folded: {}, drafts: {}, places: {}, quotes: {} });
export const blankDraft: Draft = { text: "", start: 0, end: 0, direction: "none", scroll: 0 };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const index = (value: unknown): value is number => number(value) && Number.isInteger(value) && value >= 0;

function valid(value: unknown): value is Checkpoint {
  if (!object(value) || value.version !== 1 || typeof value.active !== "string") return false;
  if (![value.folded, value.drafts, value.places, value.quotes].every(object)) return false;
  return Object.values(value.folded as object).every(v => typeof v === "boolean")
    && Object.values(value.drafts as object).every(v => object(v) && typeof v.text === "string"
      && index(v.start) && index(v.end) && v.start <= v.end && v.end <= v.text.length
      && ["forward", "backward", "none"].includes(String(v.direction)) && number(v.scroll))
    && Object.values(value.places as object).every(v => object(v) && typeof v.blockId === "string" && number(v.offset) && number(v.scroll))
    && Object.values(value.quotes as object).every(v => object(v) && typeof v.blockId === "string"
      && index(v.start) && index(v.end) && typeof v.text === "string" && v.end - v.start === v.text.length);
}

function load(key: string) {
  const previous = visits.get(key);
  if (previous) return previous;
  const entry = { value: empty(), warning: "", writable: true };
  try {
    const raw = sessionStorage.getItem(key);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (!valid(parsed)) throw new Error("Unreadable checkpoint");
      entry.value = parsed;
    }
  } catch {
    entry.writable = false;
    entry.warning = "Checkpoint unavailable. Changes stay in memory for this visit; keep a copy before refreshing.";
  }
  visits.set(key, entry);
  return entry;
}

/** Per map and person, in this tab. Source content and approvals are never restored as live data. */
export function useCheckpoint(identity: string) {
  const key = `e2a2o.place-drafts.v1:${identity}`;
  const [entry] = useState(() => load(key));
  const [, render] = useState(0);
  const change = (update: (old: Checkpoint) => Checkpoint) => {
    entry.value = update(entry.value);
    if (entry.writable) {
      try { sessionStorage.setItem(key, JSON.stringify(entry.value)); }
      catch { entry.warning = "Storage is full or unavailable. Changes stay in memory; keep a copy before refreshing."; }
    }
    render(n => n + 1);
  };
  return { checkpoint: entry.value, warning: entry.warning, change };
}
