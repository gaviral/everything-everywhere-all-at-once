import { useEffect, useState, useSyncExternalStore } from "react";

/** Total is today's glass count; time is the reading's Unix time in milliseconds.
 * A future phone adapter must supply browser-local data, with no network work here. */
export type WaterReading = { total: number; time: number; stale?: boolean };
export type WaterProvider = { getWater(): WaterReading | null | Promise<WaterReading | null> };
let provider: WaterProvider | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Connect only an explicitly authorized local source. Detaching makes it unavailable immediately. */
export function attachWaterProvider(next: WaterProvider) {
  provider = next;
  listeners.forEach(listener => listener());
  return () => {
    if (provider !== next) return;
    provider = null;
    listeners.forEach(listener => listener());
  };
}

export function validReading(value: WaterReading | null, now: number): WaterReading | null {
  if (!value || !Number.isFinite(value.total) || value.total < 0 || !Number.isFinite(value.time) || value.time <= 0 || value.time > now) return null;
  return { ...value, stale: !!value.stale || now - value.time > 30 * 60_000 };
}

export function useWaterReading(active: boolean) {
  const source = useSyncExternalStore(subscribe, () => provider, () => null);
  const [reading, setReading] = useState<{ source: WaterProvider; value: WaterReading | null } | null>(null);
  useEffect(() => {
    if (!active || !source) return;
    let cancelled = false;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const value = validReading(await source.getWater(), Date.now());
        if (!cancelled) setReading({ source, value });
      } catch { if (!cancelled) setReading({ source, value: null }); }
      finally { pending = false; }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [active, source]);
  return active && source && reading?.source === source ? validReading(reading.value, Date.now()) : null;
}
