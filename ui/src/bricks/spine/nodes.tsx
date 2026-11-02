// What each thing on the Spine looks like (layout.ts places them; index.tsx puts them on the canvas). Far out, words
// that couldn't be read become soft bars the length of their lines ("greeking"), and a topic's title grows to stay
// readable; close in, every word shows.
import { createContext, memo, useContext, useState, type CSSProperties, type ReactNode } from "react";
import { useStore, type Node, type NodeProps } from "@xyflow/react";
import { G, type Item } from "./layout";

/** Below this zoom a point's 15 px words are under 11 px on screen, the smallest the app sets: they turn to bars. */
export const READ = 0.75;

export type ItemData = { item: Item; here: boolean; pulse: number; fresh: boolean; picked: boolean };
export type ItemNode = Node<ItemData, "item">;

/** What a thing on the canvas can ask of the view. */
export interface Acts {
  toggle(thread: string): void;
  pick(item: Item): void;
  focus(item: Item): void;
  openOnMap(thread: string): void;
  shelve(item: Item): void;
  unpin(item: Item): void;
}
export const ActsContext = createContext<Acts | null>(null);

const cls = (...names: (string | false | undefined | null)[]) => names.filter(Boolean).join(" ");
export const roomStyle = (room: string | undefined): CSSProperties | undefined =>
  room ? ({ "--spine-room": `var(--room-${room})`, "--spine-room-soft": `var(--room-${room}-soft)` } as CSSProperties) : undefined;
const far = (zoom: number) => zoom < READ;

/** "3 points · 12 min ago": what a closed tangent holds and how fresh it is. */
export function recap(item: Item, now: number) {
  const n = item.count ?? 0;
  const parts = [n ? `${n} ${n === 1 ? "point" : "points"}` : "Nothing yet"];
  if (item.dropped) parts.push("left off");
  if (item.since) parts.push(ago(now - item.since));
  return parts.join(" · ");
}
export function ago(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** Words too small to read, as bars the length of their lines. */
function Bars({ lines, line, x, y = 0, thick }: { lines: number[]; line: number; x: number; y?: number; thick?: boolean }) {
  return <span className={cls("spine-bars", thick && "spine-bars-thick")} aria-hidden="true">
    {lines.map((w, i) => <span key={i} style={{ left: x, top: y + i * line + line / 2, width: Math.max(12, w) }} />)}
  </span>;
}

/** The small controls a thing shows while pointed at or focused: open its thread on the map, keep it on the shelf, and
 *  (placed by hand) put it back where the layout would. */
function Tools({ item }: { item: Item }) {
  const acts = useContext(ActsContext)!;
  const thread = item.kind === "head" || item.kind === "card";
  return <span className="spine-tools">
    {thread && <button type="button" className="spine-tool nodrag" aria-label={`Open ${item.title} on the map`} title="Open on the map" onClick={() => acts.openOnMap(item.thread)}>↗</button>}
    <button type="button" className="spine-tool nodrag" aria-label="Keep on the shelf" title="Keep on the shelf" onClick={() => acts.shelve(item)}>⤓</button>
    {item.pinned && <button type="button" className="spine-tool spine-tool-pin nodrag" aria-label="Unpin: back to its place in the layout"
      title={item.by && item.by !== "you" ? `Placed by ${item.by} · unpin` : "Unpin: back to its place"} onClick={() => acts.unpin(item)}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M5 1.5h6l-1 4.5 2.5 2.5h-9L6 6z M8 8.5v6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></svg>
    </button>}
  </span>;
}

function Tile({ item }: { item: Item }) {
  const [shown, setShown] = useState(false);
  const letter = Array.from((item.title ?? "").trim())[0]?.toLocaleUpperCase() ?? "?";
  return <span className="spine-tile" aria-hidden="true">
    <span className="spine-letter">{letter}</span>
    {item.picture && <img className={cls("spine-picture", shown && "spine-picture-shown")} src={item.picture} alt="" draggable={false}
      onLoad={() => setShown(true)} onError={() => setShown(false)} />}
  </span>;
}

/** Far out, a title's lines: as many as fit (13/16 on screen, 3 at most) before the topic under it starts. */
const LABEL_LINE = 16;
const LABEL_PAD = 6;

function Head({ data }: { data: ItemData }) {
  const { item, here, picked } = data;
  const acts = useContext(ActsContext)!;
  const zoomedOut = useStore((s) => far(s.transform[2]));
  const labelLines = useStore((s) => Math.max(1, Math.min(3, Math.floor(((item.reach ?? Infinity) * s.transform[2] - LABEL_PAD) / LABEL_LINE))));
  return <div className={cls("spine-head", item.pinned && "spine-pinned", item.dropped && "spine-left", here && "spine-on", picked && "spine-picked", data.fresh && "spine-fresh")}
    style={roomStyle(item.room)} data-thread={item.thread}>
    <Tile item={item} />
    <button type="button" className="spine-title" style={{ left: G.titleX, width: G.titleW, WebkitLineClamp: G.titleMax }}
      title={item.title} onClick={() => acts.pick(item)} onFocus={() => acts.focus(item)} onDoubleClick={() => acts.openOnMap(item.thread)}
      aria-label={`${item.title}: ${item.count ?? 0} ${item.count === 1 ? "point" : "points"}${item.dropped ? ", left off" : ""}${here ? ", where you are" : ""}`}>
      {item.title}
    </button>
    {zoomedOut && <span className="spine-label" style={{ WebkitLineClamp: labelLines }} aria-hidden="true">{item.title}</span>}
    <Tools item={item} />
  </div>;
}

function Point({ data }: { data: ItemData }) {
  const { item, here, pulse, picked } = data;
  const acts = useContext(ActsContext)!;
  const zoomedOut = useStore((s) => far(s.transform[2]));
  const look = item.look!;
  const lines = item.lines ?? [0];
  return <div className={cls("spine-point", look.variant === "mini" && "spine-point-mini", item.pinned && "spine-pinned", here && "spine-on",
    picked && "spine-picked", data.fresh && "spine-fresh")} style={roomStyle(item.room)} data-thread={item.thread}>
    <span className={cls("spine-dot", item.decided && "spine-dot-decided")} style={{ left: look.lineX, top: look.line / 2 }} aria-hidden="true">
      {pulse > 0 && <span key={pulse} className="spine-ring" />}
    </span>
    {zoomedOut ? <Bars lines={lines} line={look.line} x={look.textX} />
      : <button type="button" className="spine-text" style={{ left: look.textX, width: look.textW, WebkitLineClamp: lines.length, lineHeight: `${look.line}px` }}
        title={item.text} onClick={() => acts.pick(item)} onFocus={() => acts.focus(item)} aria-label={`${item.text}${item.decided ? " (decided)" : ""}${here ? ", your latest point" : ""}`}>
        {item.decided && <span className="spine-decided" aria-hidden="true">✓ </span>}{item.text}
      </button>}
    <Tools item={item} />
  </div>;
}

function Card({ data, now }: { data: ItemData; now: number }) {
  const { item, here, pulse, picked } = data;
  const acts = useContext(ActsContext)!;
  const zoomedOut = useStore((s) => far(s.transform[2]));
  const titleLines = item.titleLines ?? [0];
  const inner = G.cardW - 2 * G.pad;
  return <div className={cls("spine-card", item.open && "spine-card-open", item.pinned && "spine-pinned", item.dropped && "spine-left", here && "spine-on",
    picked && "spine-picked", data.fresh && "spine-fresh")} style={roomStyle(item.room)} data-thread={item.thread}>
    {pulse > 0 && <span key={pulse} className="spine-card-ring" aria-hidden="true" />}
    {item.open && item.line && <span className="spine-card-line" style={{ left: item.line.x, top: item.line.y1, height: Math.max(0, item.line.y2 - item.line.y1) }} aria-hidden="true" />}
    <button type="button" className="spine-card-face" onClick={() => acts.toggle(item.thread)} onFocus={() => acts.focus(item)} onDoubleClick={() => acts.openOnMap(item.thread)}
      aria-expanded={!!item.open} title={item.title}
      aria-label={`${item.title}: ${recap(item, now)}${here ? ", where you are" : ""}${item.open ? "" : `. Latest: ${item.latest || "nothing yet"}`}`}>
      {zoomedOut ? <Bars lines={titleLines} line={G.cardTitleLine} x={G.pad} y={G.pad} thick />
        : <span className="spine-card-title" style={{ WebkitLineClamp: G.cardTitleMax, width: inner }}>{item.title}</span>}
      {!item.open && (item.latestLines?.length ? (zoomedOut
        ? <Bars lines={item.latestLines} line={G.smallLine} x={G.pad} y={G.pad + titleLines.length * G.cardTitleLine + 4} />
        : <span key={item.latest} className="spine-card-latest" style={{ WebkitLineClamp: G.cardPointMax, width: inner }}>{item.latest}</span>) : null)}
      {!item.open && !zoomedOut && <span className="spine-card-recap">{recap(item, now)}</span>}
    </button>
    <Tools item={item} />
  </div>;
}

function Notch({ data }: { data: ItemData }) {
  const look = data.item.look!;
  return <span className="spine-notch" style={{ ...roomStyle(data.item.room), left: look.lineX }} aria-hidden="true" />;
}

/** The clock for "12 min ago", from the view (a minute's tick), so a card's recap stays true without a new map. */
export const NowContext = createContext(Date.now());

export const ItemView = memo(function ItemView({ data }: NodeProps<ItemNode>) {
  const now = useContext(NowContext);
  let body: ReactNode;
  switch (data.item.kind) {
    case "head": body = <Head data={data} />; break;
    case "card": body = <Card data={data} now={now} />; break;
    case "point": body = <Point data={data} />; break;
    default: body = <Notch data={data} />;
  }
  return body;
});
