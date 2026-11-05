export type Stats = {
  enabled: boolean;
  thoughts_indexed: number;
  lookup_us: number;
  bytes_saved: number;
  last_bytes_saved: number;
  context_calls: number;
  cache_hits: number;
  prefetch_hits: number;
};

/** Always labelled Example until the core confirms its own numbers. */
export const EXAMPLE: Stats = {
  enabled: true, thoughts_indexed: 10000, lookup_us: 180,
  bytes_saved: 98304, last_bytes_saved: 8192, context_calls: 12,
  cache_hits: 4, prefetch_hits: 7,
};

export function readStats(value: unknown): Stats {
  if (!value || typeof value !== "object") throw new Error("Unreadable memory stats");
  const row = value as Record<string, unknown>;
  if (typeof row.enabled !== "boolean" || Object.keys(EXAMPLE).filter(key => key !== "enabled")
    .some(key => typeof row[key] !== "number" || !Number.isSafeInteger(row[key]) || (row[key] as number) < 0)) {
    throw new Error("Unreadable memory stats");
  }
  return row as Stats;
}

export const count = (value: number) => value.toLocaleString("en-US");
export function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/** One request at a time. Unmount aborts the read and cancels future polling. */
export function pollStats(receive: (stats: Stats | null) => void, request: typeof fetch = fetch,
  schedule: typeof setTimeout = setTimeout, unschedule: typeof clearTimeout = clearTimeout) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = async () => {
    try {
      const response = await request("/memory/stats", { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("Memory stats unavailable");
      const stats = readStats(await response.json());
      if (!controller.signal.aborted) receive(stats);
    } catch {
      if (!controller.signal.aborted) receive(null);
    }
    if (!controller.signal.aborted) timer = schedule(read, 2000);
  };
  void read();
  return () => { controller.abort(); if (timer !== undefined) unschedule(timer); };
}
