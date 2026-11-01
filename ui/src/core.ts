import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyAppChange, isAppChange, useApps, type AppChange, type AppsServerMsg, type AppsWorld } from "./apps-core";
import { volumeReporter } from "./apps-audio";
import { useRecap, type RecapData, type RecapPeriod, type RecapServerMsg } from "./Recap";
import { openSocket } from "./room";
import type { Found } from "./find";

// Mirrors core/src/world.rs and core/src/protocol.rs.
export type ThreadStatus = "open" | "dropped";

export interface Thread {
  id: string;
  title: string;
  parent_id: string | null;
  status: ThreadStatus;
  last_point: string;
  touched_ms: number;
  tags: { name: string; kept: boolean }[];
  picture: string | null;
  /** While dropped: who left it unfinished. */
  dropped_by: string;
}

export interface Thought {
  id: string;
  speaker: string;
  text: string;
  point: string;
  thread_id: string | null;
  placed: boolean;
  unclear: string;
  guess?: string;
  heard?: string;
  fixed?: string;
  complete: boolean;
  at_ms: number;
  place_ms: number | null;
}

export type ItemStatus = "new" | "kept" | "dismissed" | "done";

// An answer to "Explain"; failed when there's none, with a short reason.
export type Explanation = { text: string; failed: boolean };

export interface Suggestion {
  id: string;
  thread_id: string;
  text: string;
  status: ItemStatus;
}

export interface Action {
  id: string;
  thread_id: string;
  kind: "reminder" | "event";
  title: string;
  when: string;
  status: ItemStatus;
  done_ms: number | null;
}

// How an import of past chats is going (core/src/import.rs).
export interface ImportStatus {
  id: string;
  file: string;
  state: "reading" | "grouping" | "adding" | "done" | "stopped" | "failed";
  parts: number;
  parts_done: number;
  ideas: number;
  threads: number;
  extended: number;
  points: number;
  questions: number;
  actions: number;
  note: string;
}

export interface World extends AppsWorld {
  recaps: RecapData[];
  threads: Thread[];
  thoughts: Thought[];
  /** Where the talk is now; `active_by` has each speaker's own thread. */
  active: string | null;
  active_by: Record<string, string>;
  suggestions: Suggestion[];
  actions: Action[];
  merged: Record<string, string>;
}

type Change =
  | { type: "recap_saved"; recap: RecapData }
  | AppChange
  | { type: "thought_added"; thought: Thought }
  | { type: "thread_added"; thread: Thread }
  | {
      type: "thought_placed";
      thought_id: string;
      thread_id: string;
      point: string;
      unclear: string;
      guess?: string;
      heard?: string;
      fixed?: string;
      complete: boolean;
      place_ms: number;
    }
  | { type: "thought_corrected"; thought_id: string; accept: boolean }
  | { type: "thread_touched"; thread_id: string; last_point: string; at_ms: number }
  | { type: "thread_status"; thread_id: string; status: ThreadStatus; speaker: string }
  | { type: "active_changed"; thread_id: string; speaker: string }
  | { type: "thread_renamed"; thread_id: string; title: string }
  | { type: "thread_merged"; from: string; into: string }
  | { type: "suggestion_added"; suggestion: Suggestion }
  | { type: "action_proposed"; action: Action }
  | { type: "item_status"; id: string; status: ItemStatus; done_ms: number | null }
  | { type: "tag_suggested"; thread_id: string; tag: string }
  | { type: "tag_kept"; thread_id: string; tag: string }
  | { type: "tag_removed"; thread_id: string; tag: string }
  | { type: "thread_picture"; thread_id: string; path: string };

type ServerMsg =
  | RecapServerMsg
  | AppsServerMsg
  | { type: "snapshot"; world: World }
  | { type: "change"; change: Change }
  | { type: "partial"; text: string }
  | { type: "status"; listening: boolean; note: string }
  | { type: "error"; message: string }
  | { type: "notice"; message: string }
  | { type: "found"; thread_id: string; thought_id: string | null; message: string }
  | { type: "explanation"; id: string; text: string; failed: boolean }
  | { type: "import"; status: ImportStatus };

const EMPTY: World = { recaps: [], threads: [], thoughts: [], active: null, active_by: {}, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: false };

// Follows merges, as the core does, so late changes land on the surviving thread.
function resolve(world: World, id: string): string {
  let current = id;
  // At most one hop per merge, so a corrupt snapshot with a cycle can't freeze the tab.
  for (let hops = Object.keys(world.merged).length; hops > 0 && world.merged[current]; hops--) current = world.merged[current];
  return current;
}

// Replaces the first whole-word match of `from` in `text` with `to`, as the core does. Ignores case only
// when lowercasing keeps the length, so the cut lines up.
function swap(text: string, from: string, to: string): string {
  const even = text.toLowerCase().length === text.length && from.toLowerCase().length === from.length;
  const [hay, needle] = even ? [text.toLowerCase(), from.toLowerCase()] : [text, from];
  const word = /[A-Za-z0-9]/;
  for (let i = needle ? hay.indexOf(needle) : -1; i >= 0; i = hay.indexOf(needle, i + needle.length)) {
    const end = i + from.length;
    if (!word.test(text[i - 1] ?? "") && !word.test(text[end] ?? "")) return text.slice(0, i) + to + text.slice(end);
  }
  return text;
}

function apply(world: World, raw: Change): World {
  if (isAppChange(raw)) return applyAppChange(world, raw);
  const r = (id: string) => resolve(world, id);
  const c: Change =
    raw.type === "suggestion_added"
      ? { ...raw, suggestion: { ...raw.suggestion, thread_id: r(raw.suggestion.thread_id) } }
      : raw.type === "action_proposed"
        ? { ...raw, action: { ...raw.action, thread_id: r(raw.action.thread_id) } }
        : "thread_id" in raw
          ? { ...raw, thread_id: r(raw.thread_id) }
          : raw;
  const onThread = (id: string, edit: (t: Thread) => Thread): World => ({
    ...world,
    threads: world.threads.map((t) => (t.id === id ? edit({ ...t, tags: t.tags ?? [] }) : t)),
  });
  switch (c.type) {
    case "recap_saved":
      return { ...world, recaps: [...world.recaps.filter((r) => r.period !== c.recap.period), c.recap] };
    case "tag_suggested":
      return onThread(c.thread_id, (t) =>
        t.tags.some((x) => x.name === c.tag) ? t : { ...t, tags: [...t.tags, { name: c.tag, kept: false }] },
      );
    case "tag_kept":
      return onThread(c.thread_id, (t) => ({ ...t, tags: t.tags.map((x) => (x.name === c.tag ? { ...x, kept: true } : x)) }));
    case "tag_removed":
      return onThread(c.thread_id, (t) => ({ ...t, tags: t.tags.filter((x) => x.name !== c.tag) }));
    case "thread_picture":
      return onThread(c.thread_id, (t) => ({ ...t, picture: c.path }));
    case "thread_renamed":
      return { ...world, threads: world.threads.map((t) => (t.id === c.thread_id ? { ...t, title: c.title } : t)) };
    case "thread_merged": {
      // As the core: never into itself, or into a thread that isn't there (its thoughts would vanish).
      if (c.from === c.into || !world.threads.some((t) => t.id === c.into)) return world;
      const move = (id: string | null) => (id === c.from ? c.into : id);
      return {
        ...world,
        threads: world.threads.filter((t) => t.id !== c.from).map((t) => ({ ...t, parent_id: move(t.parent_id) })),
        thoughts: world.thoughts.map((t) => ({ ...t, thread_id: move(t.thread_id) })),
        suggestions: world.suggestions.map((s) => ({ ...s, thread_id: move(s.thread_id)! })),
        actions: world.actions.map((a) => ({ ...a, thread_id: move(a.thread_id)! })),
        active: move(world.active),
        active_by: Object.fromEntries(Object.entries(world.active_by).map(([who, id]) => [who, move(id)!])),
        merged: { ...world.merged, [c.from]: c.into },
      };
    }
    case "suggestion_added":
      return world.suggestions.some((s) => s.id === c.suggestion.id)
        ? world
        : { ...world, suggestions: [...world.suggestions, c.suggestion] };
    case "action_proposed":
      return world.actions.some((a) => a.id === c.action.id) ? world : { ...world, actions: [...world.actions, c.action] };
    case "item_status":
      return {
        ...world,
        suggestions: world.suggestions.map((s) => (s.id === c.id ? { ...s, status: c.status } : s)),
        actions: world.actions.map((a) => (a.id === c.id ? { ...a, status: c.status, done_ms: c.done_ms } : a)),
      };
    case "thought_added":
      return world.thoughts.some((t) => t.id === c.thought.id)
        ? world
        : { ...world, thoughts: [...world.thoughts, c.thought] };
    case "thread_added":
      return world.threads.some((t) => t.id === c.thread.id)
        ? world
        : { ...world, threads: [...world.threads, c.thread] };
    case "thought_placed":
      return {
        ...world,
        thoughts: world.thoughts.map((t) =>
          t.id === c.thought_id
            ? {
                ...t,
                thread_id: c.thread_id,
                point: c.point,
                unclear: c.unclear,
                guess: c.guess ?? "",
                // A sure fix is already in the point; the text takes it too, only on first placing.
                text: !t.placed && c.heard && c.fixed ? swap(t.text, c.heard, c.fixed) : t.text,
                heard: c.heard ?? "",
                fixed: c.fixed ?? "",
                complete: c.complete,
                placed: true,
                place_ms: c.place_ms,
              }
            : t,
        ),
      };
    case "thread_touched":
      return {
        ...world,
        threads: world.threads.map((t) =>
          t.id === c.thread_id ? { ...t, last_point: c.last_point, touched_ms: c.at_ms, status: "open", dropped_by: "" } : t,
        ),
      };
    case "thread_status": {
      const dropped_by = c.status === "dropped" ? c.speaker : "";
      return { ...world, threads: world.threads.map((t) => (t.id === c.thread_id ? { ...t, status: c.status, dropped_by } : t)) };
    }
    case "active_changed":
      return { ...world, active: c.thread_id, active_by: { ...world.active_by, [c.speaker]: c.thread_id } };
    case "thought_corrected": {
      // Mirrors the core: yes swaps the unclear words for the guess, no keeps them;
      // no to a fix made without asking puts the words back as heard.
      const t = world.thoughts.find((x) => x.id === c.thought_id);
      if (!t) return world;
      const undo = !c.accept && !!t.heard && !!t.fixed;
      const correct = (text: string) => {
        if (c.accept && t.unclear && t.guess) return swap(text, t.unclear, t.guess);
        if (!c.accept && t.heard && t.fixed) return swap(text, t.fixed, t.heard);
        return text;
      };
      const next = {
        ...t,
        text: correct(t.text),
        point: correct(t.point),
        unclear: "",
        guess: "",
        heard: undo ? "" : t.heard,
        fixed: undo ? "" : t.fixed,
      };
      return {
        ...world,
        thoughts: world.thoughts.map((x) => (x.id === t.id ? next : x)),
        threads: world.threads.map((th) =>
          th.id === t.thread_id && th.last_point === t.point ? { ...th, last_point: next.point } : th,
        ),
      };
    }
  }
}

export function useCore() {
  const recap = useRecap();
  const receiveRecap = recap.receive;
  const recapDisconnected = recap.disconnected;
  const apps = useApps();
  const receiveApps = apps.receive;
  const resetApps = apps.reset;
  const [world, setWorld] = useState<World>(EMPTY);
  const [snapshotRevision, setSnapshotRevision] = useState(0);
  const [mapChange, setMapChange] = useState<{ id: number; text: string } | null>(null);
  const [partial, setPartial] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceStatusRevision, setVoiceStatusRevision] = useState(0);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);
  const [explanations, setExplanations] = useState<Record<string, Explanation>>({});
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const outbox = useRef<string[]>([]);

  useEffect(() => {
    let closed = false;
    let retry = 500;
    let timer: number | undefined;
    let currentWorld = EMPTY;
    let changeId = 0;

    const open = () => {
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      const ws = openSocket(`${scheme}://${location.host}/ws`);
      ws.binaryType = "arraybuffer";
      socket.current = ws;
      ws.onopen = () => {
        resetApps();
        setConnected(true);
        retry = 500;
        // Thoughts typed while the connection was down go out now.
        for (const message of outbox.current.splice(0)) ws.send(message);
        setQueuedCount(0);
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string) as ServerMsg;
        if (receiveRecap(msg)) return;
        if (receiveApps(msg)) return;
        switch (msg.type) {
          case "snapshot":
            setFound(null);
            currentWorld = { ...EMPTY, ...msg.world };
            setWorld(currentWorld);
            setSnapshotRevision((revision) => revision + 1);
            break;
          case "change": {
            const change = msg.change;
            if (change.type === "thread_renamed") {
              const old = currentWorld.threads.find((thread) => thread.id === resolve(currentWorld, change.thread_id));
              if (old && old.title !== change.title) setMapChange({ id: ++changeId, text: `AI renamed “${old.title}” to “${change.title}”` });
            } else if (change.type === "thread_merged") {
              const from = currentWorld.threads.find((thread) => thread.id === change.from);
              const into = currentWorld.threads.find((thread) => thread.id === change.into);
              if (from && into) setMapChange({ id: ++changeId, text: `AI merged “${from.title}” into “${into.title}”` });
            }
            currentWorld = apply(currentWorld, change);
            setWorld(currentWorld);
            break;
          }
          case "partial":
            setPartial(msg.text);
            break;
          case "status":
            setListening(msg.listening);
            setVoiceStatusRevision((revision) => revision + 1);
            break;
          case "error":
          case "notice":
            setNotice(msg.message);
            break;
          case "found":
            setFound((previous) => ({ thread_id: msg.thread_id, thought_id: msg.thought_id, revision: (previous?.revision ?? 0) + 1 }));
            setNotice(msg.message);
            break;
          case "explanation":
            setExplanations((e) => ({ ...e, [msg.id]: { text: msg.text, failed: msg.failed } }));
            break;
          case "import":
            setImportStatus(msg.status);
            break;
        }
      };
      ws.onclose = () => {
        recapDisconnected();
        setConnected(false);
        setListening(false);
        setVoiceStatusRevision((revision) => revision + 1);
        if (!closed) timer = window.setTimeout(open, (retry = Math.min(retry * 2, 8000)));
      };
    };
    open();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      socket.current?.close();
    };
  }, [receiveApps, resetApps, receiveRecap, recapDisconnected]);

  const send = useCallback((data: string | ArrayBuffer) => {
    if (socket.current?.readyState !== WebSocket.OPEN) return false;
    socket.current.send(data);
    return true;
  }, []);
  const sendOrWarn = useCallback((data: string) => {
    if (send(data)) return true;
    setNotice("Not connected — try again when connected.");
    return false;
  }, [send]);
  const setItem = useCallback((id: string, status: ItemStatus) => sendOrWarn(JSON.stringify({ type: "item", id, status })), [sendOrWarn]);
  const approve = useCallback((id: string) => sendOrWarn(JSON.stringify({ type: "approve", id })), [sendOrWarn]);
  const correct = useCallback((thought_id: string, accept: boolean) => sendOrWarn(JSON.stringify({ type: "correct", thought_id, accept })), [sendOrWarn]);
  const tag = useCallback((thread_id: string, tag: string, keep: boolean) => sendOrWarn(JSON.stringify({ type: "tag", thread_id, tag, keep })), [sendOrWarn]);
  const volume = useMemo(() => volumeReporter((level) => send(JSON.stringify({ type: "app_volume", level }))), [send]);

  return {
    recap,
    requestRecap: (period: RecapPeriod) => {
      const sent = send(JSON.stringify({ type: "recap", period }));
      recap.open(period, world.recaps.find((r) => r.period === period) ?? null, sent);
    },
    apps,
    composeApp: (request: string) => send(JSON.stringify({ type: "compose_app", request })),
    decideApp: (build_id: string, keep: boolean) => send(JSON.stringify({ type: "decide_app", build_id, keep })),
    toggleApp: (id: string, enabled: boolean) => send(JSON.stringify({ type: "toggle_app", id, enabled })),
    removeApp: (id: string) => send(JSON.stringify({ type: "remove_app", id })),
    appOutput: (id: string, sound: boolean) => send(JSON.stringify({ type: "app_output", id, sound })),
    world,
    snapshotRevision,
    mapChange,
    partial,
    listening,
    voiceStatusRevision,
    connected,
    notice,
    found,
    queuedCount,
    clearNotice: useCallback(() => setNotice(""), []),
    showNotice: (message: string) => setNotice(message),
    sendText: (text: string) => {
      const message = JSON.stringify({ type: "text", text });
      if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(message);
      else if (outbox.current.length < 50) { outbox.current.push(message); setQueuedCount(outbox.current.length); }
      else { setNotice("Too many thoughts are waiting to send. Keep this one here until you reconnect."); return false; }
      return true;
    },
    sendAudio: (frame: ArrayBuffer) => { volume.feed(frame); send(frame); },
    listen: (on: boolean) => { volume.reset(); return send(JSON.stringify({ type: "listen", on })); },
    focus: (thread_id: string) => sendOrWarn(JSON.stringify({ type: "focus", thread_id })),
    setItem, approve, correct, tag,
    visible: () => send(JSON.stringify({ type: "visible" })),
    explanations,
    explain: (id: string, text: string, context: string, thread_id: string | null) =>
      send(JSON.stringify({ type: "explain", id, text, context, thread_id })),
    importStatus,
    startImport: (id: string) => send(JSON.stringify({ type: "import_start", id })),
    cancelImport: () => send(JSON.stringify({ type: "import_cancel" })),
  };
}
