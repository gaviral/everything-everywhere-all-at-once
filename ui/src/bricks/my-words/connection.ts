import { useEffect, useRef, useState } from "react";
import { isRecord, type Record, type Term } from "./rules";

/** Owned by the enabled brick. Closing it releases recognition opt-in, never starts capture. */
export function useVocabulary(name: string, map: string | null, receive: (record: Record, saved: boolean) => void) {
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("Connecting to this map…");
  const current = useRef(receive); current.current = receive;
  const socket = useRef<WebSocket | null>(null);
  const saving = useRef(false);
  useEffect(() => {
    setReady(false); setPending(false); saving.current = false;
    if (!map) { setStatus("Waiting for this map. Your draft stays here."); return; }
    setStatus("Connecting to this map…");
    const url = new URL("/ws/my-words", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("name", name); url.searchParams.set("map", map);
    const room = new URLSearchParams(location.search).get("room");
    if (room) url.searchParams.set("room", room);
    const ws = new WebSocket(url); socket.current = ws;
    let live = true;
    ws.onopen = () => ws.send(JSON.stringify({ type: "enable" }));
    ws.onmessage = event => {
      if (!live) return;
      try {
        const result = JSON.parse(event.data);
        saving.current = false; setPending(false);
        if (result.ok && isRecord(result.record)) {
          setReady(true);
          current.current(result.record, result.saved === true);
          setStatus(result.saved ? "Saved · applies next time you start listening." : "Ready for your next listening session.");
        } else { setStatus(typeof result.message === "string" ? result.message : "Vocabulary could not be read."); }
      } catch { setStatus("Vocabulary response was unreadable. Reconnect to review."); setReady(false); }
    };
    ws.onerror = () => { if (live) setStatus("Vocabulary connection unavailable. Reconnect to try again."); };
    ws.onclose = () => {
      if (!live) return;
      setReady(false); setPending(false);
      setStatus(saving.current ? "Save not confirmed. Reconnect to review the saved list; your draft stays here." : "Disconnected. Reconnect before saving; your draft stays here.");
      saving.current = false;
    };
    return () => { live = false; socket.current = null; ws.close(); };
  }, [name, map, attempt]);
  return { ready, pending, status, reconnect: () => setAttempt(n => n + 1), save: (revision: number, terms: Term[]) => {
    const ws = socket.current;
    if (!ready || saving.current || ws?.readyState !== WebSocket.OPEN) { setStatus("Reconnect before saving. Your draft stays here."); return; }
    saving.current = true; setPending(true); setStatus("Saving your vocabulary…");
    ws.send(JSON.stringify({ type: "save", revision, terms }));
  } };
}
