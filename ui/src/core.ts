import { useCallback, useEffect, useRef, useState } from "react";

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
  complete: boolean;
  at_ms: number;
  place_ms: number | null;
}

export type ItemStatus = "new" | "kept" | "dismissed" | "done";

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

export interface World {
  threads: Thread[];
  thoughts: Thought[];
  active: string | null;
  suggestions: Suggestion[];
  actions: Action[];
  merged: Record<string, string>;
}

type Change =
  | { type: "thought_added"; thought: Thought }
  | { type: "thread_added"; thread: Thread }
  | {
      type: "thought_placed";
      thought_id: string;
      thread_id: string;
      point: string;
      unclear: string;
      guess?: string;
      complete: boolean;
      place_ms: number;
    }
  | { type: "thought_corrected"; thought_id: string; accept: boolean }
  | { type: "thread_touched"; thread_id: string; last_point: string; at_ms: number }
  | { type: "thread_status"; thread_id: string; status: ThreadStatus }
  | { type: "active_changed"; thread_id: string }
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
  | { type: "snapshot"; world: World }
  | { type: "change"; change: Change }
  | { type: "partial"; text: string }
  | { type: "status"; listening: boolean; note: string }
  | { type: "error"; message: string }
  | { type: "notice"; message: string }
  | { type: "explanation"; id: string; text: string };

const EMPTY: World = { threads: [], thoughts: [], active: null, suggestions: [], actions: [], merged: {} };

// Follows merges, as the core does, so late changes land on the surviving thread.
function resolve(world: World, id: string): string {
  let current = id;
  // At most one hop per merge, so a corrupt snapshot with a cycle can't freeze the tab.
  for (let hops = Object.keys(world.merged).length; hops > 0 && world.merged[current]; hops--) current = world.merged[current];
  return current;
}

function apply(world: World, raw: Change): World {
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
      const move = (id: string | null) => (id === c.from ? c.into : id);
      return {
        ...world,
        threads: world.threads.filter((t) => t.id !== c.from).map((t) => ({ ...t, parent_id: move(t.parent_id) })),
        thoughts: world.thoughts.map((t) => ({ ...t, thread_id: move(t.thread_id) })),
        suggestions: world.suggestions.map((s) => ({ ...s, thread_id: move(s.thread_id)! })),
        actions: world.actions.map((a) => ({ ...a, thread_id: move(a.thread_id)! })),
        active: move(world.active),
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
          t.id === c.thread_id ? { ...t, last_point: c.last_point, touched_ms: c.at_ms, status: "open" } : t,
        ),
      };
    case "thread_status":
      return { ...world, threads: world.threads.map((t) => (t.id === c.thread_id ? { ...t, status: c.status } : t)) };
    case "active_changed":
      return { ...world, active: c.thread_id };
    case "thought_corrected": {
      // Mirrors the core: yes swaps the unclear words for the guess, no keeps them.
      const t = world.thoughts.find((x) => x.id === c.thought_id);
      if (!t) return world;
      const swap = (text: string) => {
        if (!c.accept || !t.unclear || !t.guess) return text;
        // Ignore case only when lowercasing keeps the length, so the cut lines up (as in the core).
        const even = text.toLowerCase().length === text.length && t.unclear.toLowerCase().length === t.unclear.length;
        const i = even ? text.toLowerCase().indexOf(t.unclear.toLowerCase()) : text.indexOf(t.unclear);
        return i < 0 ? text : text.slice(0, i) + t.guess + text.slice(i + t.unclear.length);
      };
      const fixed = { ...t, text: swap(t.text), point: swap(t.point), unclear: "", guess: "" };
      return {
        ...world,
        thoughts: world.thoughts.map((x) => (x.id === t.id ? fixed : x)),
        threads: world.threads.map((th) =>
          th.id === t.thread_id && th.last_point === t.point ? { ...th, last_point: fixed.point } : th,
        ),
      };
    }
  }
}

export function useCore() {
  const [world, setWorld] = useState<World>(EMPTY);
  const [snapshotRevision, setSnapshotRevision] = useState(0);
  const [mapChange, setMapChange] = useState<{ id: number; text: string } | null>(null);
  const [partial, setPartial] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceStatusRevision, setVoiceStatusRevision] = useState(0);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState("");
  const [queuedCount, setQueuedCount] = useState(0);
  const [explanations, setExplanations] = useState<Record<string, string>>({});
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
      const ws = new WebSocket(`${scheme}://${location.host}/ws`);
      ws.binaryType = "arraybuffer";
      socket.current = ws;
      ws.onopen = () => {
        setConnected(true);
        retry = 500;
        // Thoughts typed while the connection was down go out now.
        for (const message of outbox.current.splice(0)) ws.send(message);
        setQueuedCount(0);
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string) as ServerMsg;
        switch (msg.type) {
          case "snapshot":
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
          case "explanation":
            setExplanations((e) => ({ ...e, [msg.id]: msg.text }));
            break;
        }
      };
      ws.onclose = () => {
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
  }, []);

  const send = useCallback((data: string | ArrayBuffer) => {
    if (socket.current?.readyState !== WebSocket.OPEN) return false;
    socket.current.send(data);
    return true;
  }, []);

  return {
    world,
    snapshotRevision,
    mapChange,
    partial,
    listening,
    voiceStatusRevision,
    connected,
    notice,
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
    sendAudio: (frame: ArrayBuffer) => send(frame),
    listen: (on: boolean) => send(JSON.stringify({ type: "listen", on })),
    focus: (thread_id: string) => send(JSON.stringify({ type: "focus", thread_id })),
    setItem: (id: string, status: ItemStatus) => send(JSON.stringify({ type: "item", id, status })),
    approve: (id: string) => send(JSON.stringify({ type: "approve", id })),
    correct: (thought_id: string, accept: boolean) => send(JSON.stringify({ type: "correct", thought_id, accept })),
    tag: (thread_id: string, tag: string, keep: boolean) => send(JSON.stringify({ type: "tag", thread_id, tag, keep })),
    visible: () => send(JSON.stringify({ type: "visible" })),
    explanations,
    explain: (id: string, text: string, context: string) =>
      send(JSON.stringify({ type: "explain", id, text, context })),
  };
}
