// The kit: the only things a part can be made of. Spark picks the blocks and the words; every look lives here.
import { useEffect, useState } from "react";

export type Block =
  | { kind: "big"; text: string }
  | { kind: "line"; text: string }
  | { kind: "time"; to: string; label?: string }
  | { kind: "list"; items: string[] }
  | { kind: "count"; label?: string; goal: number }
  | { kind: "note"; prompt: string }
  | { kind: "done"; label: string }
  | { kind: "ask"; question: string };
export type Spec = { title: string; blocks: Block[] };

function left(to: string, now: number) {
  const [hours, minutes] = to.split(":").map(Number);
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);
  const seconds = Math.max(0, Math.round((target.getTime() - now) / 1000));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}

function TimeLeft({ to, label }: { to: string; label?: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  return <div className="kit-time"><strong>{left(to, now)}</strong>{label && <span>{label}</span>}</div>;
}

function Tally({ label, goal }: { label?: string; goal: number }) {
  const [count, setCount] = useState(0);
  return <button className="kit-count" onClick={() => setCount(value => value + 1)}>
    <strong>{count}</strong><span>of {goal}{label ? ` ${label}` : ""}</span>
  </button>;
}

function TickList({ items, ticked, onTick }: { items: string[]; ticked: ReadonlySet<number>; onTick: (index: number) => void }) {
  return <ul className="kit-list">{items.map((item, index) => <li key={index}>
    <button aria-pressed={ticked.has(index)} onClick={() => onTick(index)}>{item}</button>
  </li>)}</ul>;
}

function Done({ label, share }: { label: string; share: number }) {
  return <div className="kit-done">
    <div className="kit-bar"><i style={{ width: `${share * 100}%` }} /></div>
    <span>{Math.round(share * 100)}% {label}</span>
  </div>;
}

/** One part, drawn. Ticks live here, so a Done block in the same part follows its list. */
export function PartView({ spec }: { spec: Spec }) {
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set());
  const total = spec.blocks.reduce((sum, block) => sum + (block.kind === "list" ? block.items.length : 0), 0);
  const tick = (index: number) => setTicked(old => { const next = new Set(old); if (!next.delete(index)) next.add(index); return next; });
  return <article className="kit-part">
    <h3>{spec.title}</h3>
    {spec.blocks.map((block, index) => {
      switch (block.kind) {
        case "big": return <p key={index} className="kit-big">{block.text}</p>;
        case "line": return <p key={index} className="kit-line">{block.text}</p>;
        case "time": return <TimeLeft key={index} to={block.to} label={block.label} />;
        case "list": return <TickList key={index} items={block.items} ticked={ticked} onTick={tick} />;
        case "count": return <Tally key={index} label={block.label} goal={block.goal} />;
        case "note": return <textarea key={index} className="kit-note" placeholder={block.prompt} aria-label={block.prompt} />;
        case "done": return <Done key={index} label={block.label} share={total ? ticked.size / total : 0} />;
        case "ask": return <p key={index} className="kit-ask"><span>{block.question}</span></p>;
      }
    })}
  </article>;
}
