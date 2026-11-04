import { useCallback, useEffect, useRef, useState } from 'react';
import type { Snapshot } from './types';
export type MergeMoment = { id: string; text: string; lane: string };
function arrivals(before: Snapshot | null, next: Snapshot): MergeMoment[] {
  if (!before) return [];
  return next.branches.flatMap(branch => {
    const old = before.branches.find(b => b.name === branch.name);
    return old && branch.merged_into && (old.merged_into !== branch.merged_into || old.joined_at !== branch.joined_at)
      ? [{ id: `${branch.name}:${branch.merged_into}:${branch.joined_at}`, lane: branch.name, text: `${branch.name} joined ${branch.merged_into}${branch.joined_at ? ` · ${branch.joined_at}` : ''}` }] : [];
  });
}
export function useSnapshot() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState('Reading local source…');
  const [stale, setStale] = useState(false);
  const [moments, setMoments] = useState<MergeMoment[]>([]);
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    let disposed = false, running = false;
    let timer: ReturnType<typeof setTimeout>, controller: AbortController;
    let previous: Snapshot | null = null;
    async function read() {
      if (running || disposed) return;
      running = true; clearTimeout(timer); controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const result = await fetch('/code-canvas/snapshot', { cache: 'no-store', signal: controller.signal });
        if (!result.ok) throw new Error(result.status === 404 ? 'Code canvas is off. Enable the local code canvas to open it.' : 'Local source could not be read.');
        const next: Snapshot = await result.json();
        if (!disposed) {
          const changes = arrivals(previous, next);
          if (changes.length) setMoments(old => [...changes, ...old].slice(0, 5));
          // Keep requests and lane history through feed errors, independently of source freshness.
          if (!next.agents?.available && previous?.agents) next.agents = { ...previous.agents, available: false, notice: next.agents?.notice || 'Agent feed unavailable. Showing its last update.' };
          previous = next; setData(next); setStale(false);
          setStatus(`Live · read ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`);
        }
      } catch (error) { if (!disposed) { setStale(true); setStatus(error instanceof Error && error.name !== 'AbortError' ? error.message : 'Source read timed out. Retrying.'); } }
      finally { clearTimeout(timeout); running = false; if (!disposed) timer = setTimeout(read, 4000); }
    }
    refresh.current = () => { void read(); };
    void read();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, []);
  return { data, status, stale, moments, refresh: useCallback(() => refresh.current(), []) };
}
