// Notes: everything written on top of the ink: the person's names, and what Spark and Muse Image answer.
import { useState } from "react";
import { boundsOf, type Stroke } from "./ink";
import type { Label } from "./labels";
import { arrowHead, curve, wobblyBox } from "./marks";
import type { Reading } from "./reading";

/** Places in the notes run 0 to 1000 each way, as Spark's do. */
const toSheet = (fraction: number) => fraction * 1000;
const centre = (box: readonly [number, number, number, number]) => [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] as [number, number];
/** Where a line from `from` leaves a box's edge, so arrows meet boxes instead of crossing them. */
function edgeOf(box: readonly [number, number, number, number], from: [number, number]): [number, number] {
  const [x, y] = centre(box), dx = from[0] - x, dy = from[1] - y;
  const scale = Math.min(Math.abs((box[2] - box[0]) / 2 / (dx || 1)), Math.abs((box[3] - box[1]) / 2 / (dy || 1)), 1);
  return [x + dx * scale, y + dy * scale];
}

export type Reply = { image?: string; ms?: number; waiting: boolean };
type Props = {
  strokes: readonly Stroke[]; labels: readonly Label[]; picked: readonly string[];
  reading: { value: Reading; ms: number } | null;
  onForget: (id: string) => void;
};

function NameMark({ label, strokes, onForget }: { label: Label; strokes: readonly Stroke[]; onForget: () => void }) {
  const box = boundsOf(strokes.filter(stroke => label.strokes.includes(stroke.id)));
  if (!box || !label.text) return null;
  const above = box.top > 0.09;
  const x = Math.min(box.left, 0.82), y = above ? box.top - 0.075 : box.bottom + 0.03;
  return <button className="draw-name" style={{ left: `${x * 100}%`, top: `${y * 100}%` }} onClick={onForget} title="Remove this name">{label.text}</button>;
}

function NameLine({ label, strokes }: { label: Label; strokes: readonly Stroke[] }) {
  const box = boundsOf(strokes.filter(stroke => label.strokes.includes(stroke.id)));
  if (!box || !label.text) return null;
  const above = box.top > 0.09;
  const line = curve([toSheet(Math.min(box.left, 0.82) + 0.02), toSheet(above ? box.top - 0.02 : box.bottom + 0.03)], [toSheet((box.left + box.right) / 2), toSheet(above ? box.top : box.bottom)], 0.3);
  return <path className="draw-leader" d={line.path} />;
}

function PartMarks({ reading }: { reading: Reading }) {
  const boxes = new Map(reading.parts.map(part => [part.name, part.box]));
  return <>
    {reading.parts.map((part, index) => <path key={index} className="draw-part" d={wobblyBox(part.name + index, part.box)} />)}
    {reading.links.map(link => {
      const from = boxes.get(link.from), to = boxes.get(link.to);
      if (!from || !to) return null;
      const start = edgeOf(from, centre(to)), end = edgeOf(to, centre(from));
      const line = curve(start, end);
      return <g key={link.from + link.to}><path className="draw-link" d={line.path} /><path className="draw-link" d={arrowHead(line.control, end)} /></g>;
    })}
  </>;
}

/** Where a question sits: the corner with the least ink, so it never covers what the person drew. */
const CORNERS: readonly (readonly [number, number])[] = [[64, 18], [4, 18], [64, 62], [4, 62]];
function emptiestCorner(strokes: readonly Stroke[]) {
  const inkIn = ([left, top]: readonly [number, number]) => strokes.reduce((sum, stroke) => sum + stroke.points.filter(point =>
    point.x * 100 >= left && point.x * 100 <= left + 34 && point.y * 100 >= top && point.y * 100 <= top + 24).length, 0);
  return [...CORNERS].sort((one, other) => inkIn(one) - inkIn(other))[0];
}

function Question({ item, corner, onDone }: { item: Reading["unsure"][number]; corner: readonly [number, number]; onDone: () => void }) {
  return <button className="draw-question" style={{ left: `${corner[0]}%`, top: `${corner[1]}%` }} onClick={onDone}>
    <span>{item.question}</span>
  </button>;
}

export function Notes({ strokes, labels, picked, reading, onForget }: Props) {
  const [answered, setAnswered] = useState<string[]>([]);
  const open = (reading?.value.unsure ?? []).filter(item => !answered.includes(item.question)).slice(0, 1);
  const corner = emptiestCorner(strokes);
  const pickedBox = boundsOf(strokes.filter(stroke => picked.includes(stroke.id)));
  return <div className="draw-notes">
    <svg className="draw-lines" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
      {labels.map(label => <NameLine key={label.id} label={label} strokes={strokes} />)}
      {pickedBox && <path className="draw-picked" d={wobblyBox("picked", [toSheet(pickedBox.left) - 14, toSheet(pickedBox.top) - 18, toSheet(pickedBox.right) + 14, toSheet(pickedBox.bottom) + 18])} />}
      {reading && <PartMarks reading={reading.value} />}
      {open.map(item => {
        const start: [number, number] = [corner[0] * 10 + 40, corner[1] * 10 + (corner[1] < 40 ? 110 : -14)];
        const line = curve(start, item.at, 0.22);
        return <g key={item.question}><path className="draw-ask" d={line.path} /><path className="draw-ask" d={arrowHead(line.control, item.at)} /></g>;
      })}
    </svg>
    {labels.map(label => <NameMark key={label.id} label={label} strokes={strokes} onForget={() => onForget(label.id)} />)}
    {reading?.value.parts.filter(part => part.name && !labels.some(label => sameName(label.text, part.name))).map(part =>
      <span key={part.name} className="draw-part-name" style={{ left: `${part.box[0] / 10}%`, top: `${Math.max(0, part.box[1] / 10 - 5)}%` }}>{part.name}</span>)}
    {open.map(item => <Question key={item.question} item={item} corner={corner} onDone={() => setAnswered(done => [...done, item.question])} />)}
  </div>;
}

/** What the AI says beside the page: its sentence below, its drawing to the right. */
export function Answers({ reading, reply, looking }: { reading: Props["reading"]; reply: Reply | null; looking: boolean }) {
  return <>
    {looking && <p className="draw-said draw-looking">Muse Spark is looking…</p>}
    {reading && !looking && <p className="draw-said">{reading.value.said}<small>Muse Spark · {(reading.ms / 1000).toFixed(2)} s</small></p>}
    {reply && <svg className="draw-lines draw-handover" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
      <path className="draw-link" d={curve([520, 400], [560, 400], 0.5).path} />
      <path className="draw-link" d={arrowHead(curve([520, 400], [560, 400], 0.5).control, [560, 400], 12)} />
    </svg>}
    {reply && <figure className={reply.waiting ? "draw-reply draw-reply-waiting" : "draw-reply"}>
      {reply.image ? <img src={reply.image} alt="Muse Image's drawing of the same idea" /> : <span>drawing back…</span>}
      {reply.ms !== undefined && <figcaption>Muse Image · {(reply.ms / 1000).toFixed(1)} s</figcaption>}
    </figure>}
  </>;
}

const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const sameName = (one: string, other: string) => plain(one) === plain(other);
