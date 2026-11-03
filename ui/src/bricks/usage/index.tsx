import type { BrickProps, UsageRow } from "../contract";
import "./usage.css";

const money = (amount: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(amount);
const number = (amount: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(amount);

function remaining(row: UsageRow): string {
  if (row.used_pct !== undefined) return `${number(Math.max(0, 100 - row.used_pct))}% left`;
  if (row.left !== undefined) return row.left;
  if (row.spent_usd !== undefined && row.cap_usd !== undefined) return `${money(Math.max(0, row.cap_usd - row.spent_usd))} left`;
  return "Unknown";
}

function AsOf({ at }: { at: string | number }) {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return <small className="usage-asof">As of unknown</small>;
  return <time className="usage-asof" dateTime={date.toISOString()} title={date.toLocaleString()}>
    As of {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
  </time>;
}

export default function Usage({ map, brick }: BrickProps) {
  const data = map.usage;
  if (!data) return null;
  const { calls } = data;
  return <aside className="usage" aria-label={brick.name} data-guide="usage" tabIndex={0}>
    <strong className="usage-title">{brick.name}</strong>
    <ul className="usage-rows">
      {data.rows.map((row, i) => <li className="usage-row" key={`${row.label}-${i}`}>
        <span className="usage-label">{row.label}</span>
        <span className="usage-left">{remaining(row)}</span>
        <AsOf at={data.updated} />
      </li>)}
      <li className="usage-row">
        <span className="usage-label">Meta API · core (1h)</span>
        <span className="usage-left">{calls.limit > 0
          ? `${number(Math.max(0, calls.limit - calls.used))} of ${number(calls.limit)} calls left · ${number(calls.used)} used`
          : `${number(calls.used)} calls used · no cap`}</span>
        <AsOf at={calls.at_ms} />
      </li>
    </ul>
  </aside>;
}
