import type { Order, Stop } from "./trail";
import { stopTime } from "./trail";

export function ReplayControls({ order, speed, playing, previous, next, playable, changeOrder, changeSpeed, move, toggle }: {
  order: Order; speed: number; playing: boolean; previous: boolean; next: boolean; playable: boolean;
  changeOrder: (order: Order) => void; changeSpeed: (speed: number) => void; move: (direction: number) => void; toggle: () => void;
}) {
  return <div className="thought-replay-controls" aria-label="Replay controls">
    <button type="button" onClick={() => move(-1)} disabled={!previous}>Previous</button>
    <button type="button" className="thought-replay-play" aria-pressed={playing} onClick={toggle} disabled={!playable}>{playing ? "Pause" : "Play"}</button>
    <button type="button" onClick={() => move(1)} disabled={!next}>Next</button>
    <label>Order<select value={order} onChange={event => changeOrder(event.target.value as Order)}><option value="time">By time</option><option value="topic">By topic</option></select></label>
    <label>Pace<select value={speed} onChange={event => changeSpeed(Number(event.target.value))}><option value="0.5">Unhurried · ½×</option><option value="1">Reading · 1×</option><option value="1.5">Brisk · 1½×</option></select></label>
  </div>;
}

export function ReplayStop({ stop, number, example, missing, ai, open }: {
  stop: Stop; number: number; example: boolean; missing: boolean; ai: boolean; open: () => void;
}) {
  return <article className="thought-replay-stop" data-replay-id={stop.id} aria-label={`Replay stop ${number}`}>
    <span className="thought-replay-number" aria-hidden="true">{String(number).padStart(2, "0")}</span>
    <p className="thought-replay-topic">{stop.topic}</p>
    <h2>{stop.point || stop.text}</h2>
    <p className="thought-replay-meta">{stop.speaker || "Speaker not recorded"}{ai ? " · AI" : ""} · {example ? "Example conversation" : stopTime(stop.at)}</p>
    <details className="thought-replay-original"><summary>Exact original words</summary><p>{stop.text || "No original words retained."}</p></details>
    {missing && <p className="thought-replay-warning" role="status">This source is no longer on the map. These are the words retained at this stop.</p>}
    <button type="button" className="thought-replay-source" disabled={example || missing} onClick={open}>Open original <span aria-hidden="true">↗</span></button>
    {example && <p className="thought-replay-footnote">Example sources are not on your map.</p>}
  </article>;
}
