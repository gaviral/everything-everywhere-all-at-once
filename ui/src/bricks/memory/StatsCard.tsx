import { bytes, count, EXAMPLE, type Stats } from "./stats";

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="memory-metric"><dt>{label}</dt><dd>{value}</dd></div>;
}

export function StatsCard({ stats, live }: { stats: Stats | null; live: boolean }) {
  const data = stats ?? EXAMPLE;
  const status = !stats ? "Example · waiting for core" : !live ? "Last reading · disconnected" : data.enabled ? "Live · in this core" : "Memory is off";
  return <aside className="memory-card" aria-label="Memory statistics">
    <header><span className="memory-mark" aria-hidden="true">✦</span><strong>Memory</strong></header>
    <p className="memory-status" role="status">{status}</p>
    <dl className="memory-metrics">
      <Metric label="Thoughts indexed" value={count(data.thoughts_indexed)} />
      <Metric label="Context lookup" value={`${count(data.lookup_us)} µs`} />
      <Metric label="Context saved" value={bytes(data.bytes_saved)} />
      <Metric label="Answers reused" value={count(data.cache_hits)} />
    </dl>
    <p className="memory-detail">{bytes(data.last_bytes_saved)} saved on last call · {count(data.prefetch_hits)} prefetched</p>
  </aside>;
}
