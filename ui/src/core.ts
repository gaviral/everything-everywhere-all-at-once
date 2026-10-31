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
}

export interface Thought {
  id: string;
  speaker: string;
  text: string;
  point: string;
  thread_id: string | null;
  placed: boolean;
  unclear: string;
  complete: boolean;
  at_ms: number;
  place_ms: number | null;
}

export interface World {
  threads: Thread[];
  thoughts: Thought[];
  active: string | null;
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
      complete: boolean;
      place_ms: number;
    }
  | { type: "thread_touched"; thread_id: string; last_point: string; at_ms: number }
  | { type: "thread_status"; thread_id: string; status: ThreadStatus }
  | { type: "active_changed"; thread_id: string };

type ServerMsg =
  | { type: "snapshot"; world: World }
  | { type: "change"; change: Change }
  | { type: "partial"; text: string }
  | { type: "status"; listening: boolean; note: string }
  | { type: "error"; message: string }
  | { type: "notice"; message: string }
  | { type: "explanation"; id: string; text: string };

const EMPTY: World = { threads: [], thoughts: [], active: null };

function apply(world: World, c: Change): World {
  switch (c.type) {
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
  }
}

export function useCore() {
  const [world, setWorld] = useState<World>(EMPTY);
  const [partial, setPartial] = useState("");
  const [listening, setListening] = useState(false);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState("");
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let retry = 500;
    let timer: number | undefined;

    const open = () => {
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${scheme}://${location.host}/ws`);
      ws.binaryType = "arraybuffer";
      socket.current = ws;
      ws.onopen = () => {
        setConnected(true);
        retry = 500;
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string) as ServerMsg;
        switch (msg.type) {
          case "snapshot":
            setWorld(msg.world);
            break;
          case "change":
            setWorld((w) => apply(w, msg.change));
            break;
          case "partial":
            setPartial(msg.text);
            break;
          case "status":
            setListening(msg.listening);
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
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(data);
  }, []);

  return {
    world,
    partial,
    listening,
    connected,
    notice,
    clearNotice: () => setNotice(""),
    sendText: (text: string) => send(JSON.stringify({ type: "text", text })),
    sendAudio: (frame: ArrayBuffer) => send(frame),
    listen: (on: boolean) => send(JSON.stringify({ type: "listen", on })),
    focus: (thread_id: string) => send(JSON.stringify({ type: "focus", thread_id })),
    explanations,
    explain: (id: string, text: string, context: string) =>
      send(JSON.stringify({ type: "explain", id, text, context })),
  };
}
