// One read position for Talk and the canvas, persisted in this browser and shared with the call.
import { useEffect, useMemo, useRef, useState } from "react";
import type { MapSnapshot } from "../bricks/contract";
import { sendToCore } from "../room";
import { useCall } from "./call-core";
import { newerMark, turnIndex, turnsOf } from "./turns";

export function useReadPosition(map: MapSnapshot) {
  const call = useCall();
  const turns = useMemo(() => turnsOf(map.thoughts, map.threads), [map.thoughts, map.threads]);
  const key = "e2a2o.talk.read." + map.me;
  const stored = () => { try { return localStorage.getItem(key); } catch { return null; } };
  const [local, setLocal] = useState(stored);
  useEffect(() => { setLocal(stored()); }, [key]);
  const core = call?.people.find((person) => person.name === map.me)?.read;
  const mark = newerMark(turns, local, core);
  const latest = useRef(mark);
  latest.current = mark;
  // Also tell a restarted core, without needing to open Talk again.
  useEffect(() => {
    if (map.connected && mark) sendToCore({ type: "read", thought_id: mark });
  }, [map.connected, mark]);
  return {
    mark,
    read: (thoughtId: string) => {
      const next = turnIndex(turns, thoughtId);
      if (next < 0 || next <= turnIndex(turns, latest.current)) return;
      const id = turns[next].key;
      latest.current = id;
      try { localStorage.setItem(key, id); } catch { /* Keep the position for this visit. */ }
      setLocal(id);
    },
  };
}
