import { useEffect, useState } from 'react';
import { messageKey, readBatch, type Batch, type Message } from './topology';

export type Flight = Message & { id: number };
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => setReduced(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  return reduced;
}

/** A bounded queue per observed route and label. No clock manufactures activity. */
function flightQueue(publish: (flights: Flight[]) => void) {
  const pending = new Map<string, Message>();
  let timer: ReturnType<typeof setTimeout> | undefined, serial = 0;
  const advance = () => {
    timer = undefined;
    const flights = [...pending.values()].map(message => ({ ...message, id: ++serial }));
    pending.clear(); publish(flights);
    if (flights.length) timer = setTimeout(advance, 2800);
  };
  return {
    add(messages: Message[]) {
      for (const message of messages) {
        const key = messageKey(message), old = pending.get(key);
        pending.set(key, { ...message, count: (old?.count ?? 0) + message.count });
      }
      if (!timer) advance();
    },
    clear() { clearTimeout(timer); timer = undefined; pending.clear(); publish([]); },
  };
}

/** Opening this observer never opens a map WebSocket or starts work. */
export function useMessages(paused: boolean, reduced: boolean) {
  const [status, setStatus] = useState('Connecting to the core…');
  const [flights, setFlights] = useState<Flight[]>([]);
  const [history, setHistory] = useState<Batch[]>([]);
  const [missed, setMissed] = useState(0);
  useEffect(() => {
    const queue = flightQueue(setFlights);
    let source: EventSource | undefined, sequence = 0;
    const close = () => { source?.close(); source = undefined; queue.clear(); };
    const connect = () => {
      close();
      if (paused || document.hidden) { setStatus(paused ? 'Paused · observer disconnected' : 'Hidden · observer disconnected'); return; }
      setStatus('Connecting to the core…');
      source = new EventSource('/code-canvas/events');
      source.onopen = () => { sequence = 0; setStatus('Live · waiting for real messages'); };
      source.onerror = () => { queue.clear(); setStatus('Disconnected · reconnecting · no replay'); };
      source.onmessage = event => {
        const batch = readBatch(event.data);
        if (!batch) { queue.clear(); setStatus('Unsupported event · waiting for valid metadata'); return; }
        if (batch.sequence <= sequence) return;
        sequence = batch.sequence;
        setStatus('Live · core events');
        setHistory(old => [batch, ...old].slice(0, 5));
        setMissed(old => old + batch.missed);
        if (!reduced) queue.add(batch.messages);
      };
    };
    connect(); document.addEventListener('visibilitychange', connect);
    return () => { document.removeEventListener('visibilitychange', connect); close(); };
  }, [paused, reduced]);
  return { status, flights, history, missed };
}
