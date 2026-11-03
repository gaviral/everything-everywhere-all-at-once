import { useEffect, useMemo, useState, useSyncExternalStore, type FocusEvent } from "react";
import type { NoteCard } from "./note-card";
import type { Card as SendCard } from "./send-card";
import type { Card as PullsCard } from "./pulls-card";
import type { TidyNote } from "./tidy-core";
import { readingTime } from "./notice-rules";
import type { Thread } from "./core";

type Values = {
  card: { data: unknown; text: string; waiting: boolean; done: () => void };
  notice: { text: string; undo: number | null };
  map: TidyNote & { id: number };
  note: NoteCard;
  send: SendCard;
  pulls: PullsCard;
  unfinished: Thread;
};
type Kind = keyof Values;
type Entry = { [K in Kind]: { kind: K; key: string; value: Values[K]; group: string } }[Kind];
const STORAGE = "e2a2o.hiddenNotices";

/** One arrival order. Updating an in-flight card keeps its place; read cards never return. */
export function noticeQueue() {
  let items: Entry[] = [];
  const read = new Set<string>();
  let hidden: string[] = [];
  try { hidden = JSON.parse(localStorage.getItem(STORAGE) || "[]").filter((x: unknown) => typeof x === "string"); } catch { /* storage unavailable */ }
  const listeners = new Set<() => void>();
  const publish = () => listeners.forEach((f) => f());
  const save = () => { try { localStorage.setItem(STORAGE, JSON.stringify(hidden)); } catch { /* private mode */ } };
  return {
    subscribe: (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; },
    snapshot: () => items[0] ?? null,
    find: (kind: Kind, key: string) => items.find((e) => e.kind === kind && e.key === key),
    push<K extends Kind>(kind: K, key: string, value: Values[K], group: string = kind) {
      const id = `${kind}:${key}`;
      if (read.has(id) || hidden.includes(group)) return;
      const entry = { kind, key, value, group } as Entry;
      const at = items.findIndex((e) => e.kind === kind && e.key === key);
      if (at >= 0 && (items[at].value === value || kind === "unfinished")) return;
      items = at < 0 ? [...items, entry] : items.map((e, i) => i === at ? entry : e);
      publish();
    },
    drop(kind: Kind, key?: string, remember = true) {
      const gone = items.filter((e) => e.kind === kind && (key === undefined || e.key === key));
      if (remember) gone.forEach((e) => read.add(`${e.kind}:${e.key}`));
      items = items.filter((e) => !gone.includes(e));
      if (gone.length) publish();
    },
    reset(kind: Kind) {
      for (const id of read) if (id.startsWith(`${kind}:`)) read.delete(id);
      items = items.filter((e) => e.kind !== kind);
      publish();
    },
    control(show: boolean) {
      if (show) { hidden = []; save(); return; }
      const current = items[0];
      if (!current) return;
      hidden = [...new Set([...hidden, current.group])];
      save();
      items.filter((e) => e.group === current.group).forEach((e) => read.add(`${e.kind}:${e.key}`));
      items = items.filter((e) => e.group !== current.group);
      publish();
    },
    updateUndo(undo: number | null) {
      // Undo belongs to the latest answer, even when that answer is still waiting its turn.
      if (undo === null) {
        items = items.map((e) => e.kind === "notice" && e.value.undo !== null ? { ...e, value: { ...e.value, undo: null } } : e);
        publish();
        return;
      }
      const latest = [...items].reverse().find((e) => e.kind === "notice");
      if (!latest || latest.kind !== "notice") return;
      items = items.map((e) => e === latest ? { ...latest, value: { ...latest.value, undo } } : e);
      publish();
    },
  };
}

export function useNoticeQueue() {
  const queue = useMemo(noticeQueue, []);
  const current = useSyncExternalStore(queue.subscribe, queue.snapshot, queue.snapshot);
  return { queue, current };
}

/** Whole-turn commands only: mentioning these words in a thought doesn't switch anything off. */
export function noticeCommand(text: string): boolean | null {
  const words = text.toLowerCase().replace(/[.!?,]/g, "").trim().replace(/\s+/g, " ")
    .replace(/^(?:okay |ok )?(?:can you |could you |please )?/, "").replace(/ please$/, "");
  return words === "stop showing this" ? false : words === "show those again" ? true : null;
}

export type NoticeQueue = ReturnType<typeof noticeQueue>;

/** Other dock cards take the same turn and start reading time only when visible. */
export function useCardNotice<T>(queue: NoticeQueue, kind: string, id: string | null, text: string, done: () => void, waiting = false, data?: T) {
  const current = useSyncExternalStore(queue.subscribe, queue.snapshot, queue.snapshot);
  const key = id === null ? null : `${kind}:${id}`;
  const shown = current?.kind === "card" && current.group === kind ? current : null;
  const [hovered, hover] = useState(false), [focused, focus] = useState(false);
  useEffect(() => {
    if (key !== null) queue.push("card", key, { text, waiting, done, data }, kind);
  }, [queue, key, kind, text, waiting]);
  // Source removal and unmount retire the card. A StrictMode effect replay may register it again.
  useEffect(() => () => { if (key !== null) queue.drop("card", key, false); }, [queue, key]);
  useEffect(() => { hover(false); focus(false); }, [shown?.key]);
  const close = () => { if (shown) { queue.drop("card", shown.key); shown.value.done(); } };
  useEffect(() => {
    if (!shown || hovered || focused || shown.value.waiting) return;
    const timer = window.setTimeout(close, readingTime(shown.value.text));
    return () => window.clearTimeout(timer);
  }, [queue, shown, hovered, focused]);
  return { visible: !!shown, data: shown?.value.data as T | undefined, close, hold: {
    onMouseEnter: () => hover(true), onMouseLeave: () => hover(false), onFocus: () => focus(true),
    onBlur: (e: FocusEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focus(false); },
  } };
}
