import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BrickProps } from "../contract";
import { ReplayControls, ReplayStop } from "./parts";
import { usePlayback } from "./playback";
import { exampleByTopic, exampleTrail, readingDelay, trailOf, type Order, type Stop } from "./trail";
import "./thought-replay.css";

type Selection = { order: Order; speed: number; example: boolean; stop: Stop | null; index: number };
// One map/participant visit in this window. A source jump unmounts this view; returning keeps its place.
let remembered: { visit: unknown; selection: Selection } | null = null;

export default function ThoughtReplay(props: BrickProps) {
  const [open, setOpen] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useLayoutEffect(() => {
    if (!open && returnFocus.current) { launcher.current?.focus({ preventScroll: true }); returnFocus.current = false; }
  }, [open]);
  return <>
    <button ref={launcher} type="button" className="thought-replay-launcher" hidden={open} aria-expanded={open}
      onClick={() => setOpen(true)}>Replay thoughts <span aria-hidden="true">↗</span></button>
    {open && <ReplayVisit key={props.map.visitKey ?? "local"} {...props}
      dismiss={() => { returnFocus.current = true; setOpen(false); }}
      jumped={() => setOpen(false)} />}
  </>;
}

function ReplayVisit({ map, actions, dismiss, jumped }: BrickProps & { dismiss: () => void; jumped: () => void }) {
  const visit = map.visitKey ?? actions;
  const [selection, setSelection] = useState<Selection>(() => remembered?.visit === visit ? remembered.selection : {
    order: "time", speed: 1, example: !trailOf(map, "time").length, stop: null, index: 0,
  });
  const [playing, setPlaying] = useState(false);
  const root = useRef<HTMLElement>(null);
  const live = useMemo(() => trailOf(map, selection.order), [map.thoughts, map.threads, selection.order]);
  const stops = selection.example ? (selection.order === "time" ? exampleTrail : exampleByTopic) : live;
  const index = selection.stop ? stops.findIndex(stop => stop.id === selection.stop!.id) : 0;
  const current = selection.stop ? (stops[index] ?? selection.stop) : stops[0];
  const missing = !!selection.stop && index < 0;
  const canPlay = !!current && !missing && (selection.example || map.connected);
  const pause = () => setPlaying(false);
  const choose = (index: number) => {
    if (stops[index]) setSelection(previous => ({ ...previous, stop: stops[index], index }));
  };
  const move = (direction: number) => { pause(); choose(index < 0 ? Math.min(selection.index + (direction < 0 ? -1 : 0), stops.length - 1) : index + direction); };
  const patch = (change: Partial<Selection>) => { pause(); setSelection(previous => ({ ...previous, ...change })); };
  useLayoutEffect(() => { root.current?.focus({ preventScroll: true }); }, []);
  useLayoutEffect(() => {
    const retained = { ...selection, stop: current ?? null, index: index >= 0 ? index : selection.index };
    remembered = { visit, selection: retained };
    // Pin the displayed identity before live changes can remove or reorder it.
    if (current && (selection.stop !== current || selection.index !== retained.index)) setSelection(retained);
  }, [visit, selection, current, index]);
  useLayoutEffect(() => { if (!canPlay) pause(); }, [canPlay]);
  usePlayback(root, playing && canPlay, JSON.stringify(current), current ? readingDelay(current, selection.speed) : 6000,
    () => { if (index < stops.length - 1) choose(index + 1); else pause(); }, pause);
  return <section ref={root} tabIndex={-1} className="thought-replay" data-guide="thought-replay" aria-label="Thought replay" onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); pause(); dismiss(); }
  }}>
    <div className="thought-replay-top"><div><p className="thought-replay-eyebrow">FOLLOW THE THREAD</p><h1>How we got here.</h1></div><button type="button" onClick={() => { pause(); dismiss(); }}>Close replay</button></div>
    <p className="thought-replay-intro">One thought at a time. Room to read. A way back to the source.</p>
    <div className="thought-replay-context"><p role="status">{selection.example ? "Example replay · not live AI" : "Your map · current placed thoughts"}</p>
      <button type="button" onClick={() => patch({ example: !selection.example, stop: null, index: 0 })}>{selection.example ? "Use your map" : "Try example"}</button></div>
    <ReplayControls order={selection.order} speed={selection.speed} playing={playing} playable={canPlay}
      previous={index > 0 || (missing && !!stops.length && selection.index > 0)} next={missing ? !!stops.length : index < stops.length - 1}
      changeOrder={order => patch({ order })} changeSpeed={speed => patch({ speed })} move={move} toggle={() => setPlaying(value => !value)} />
    <p className="thought-replay-progress" role="status" aria-live="polite">{missing ? "Source unavailable" : current ? `Stop ${index + 1} of ${stops.length}${index === stops.length - 1 ? " · End of trail" : ""}` : "No placed thoughts yet"}{playing ? " · Playing" : " · Paused"}{!selection.example && !map.connected ? " · Map disconnected" : ""}</p>
    {current ? <ReplayStop key={current.id} stop={current} number={missing ? selection.index + 1 : index + 1} example={selection.example} missing={missing}
      ai={!selection.example && !!map.speakers.get(current.speaker)?.ai} open={() => { pause(); if (actions.openThought(current)) jumped(); }} />
      : <p className="thought-replay-empty">Placed thoughts will appear here. Try the example to see the trail in motion.</p>}
    <details className="thought-replay-about"><summary>What’s in this trail?</summary><p>Each current placed thought is a separate stop, including comments and replies. Waiting and removed thoughts are excluded. By time follows when they were said; By topic follows topics in map order, then time within each. Earlier edits are not reconstructed. Playback pauses when you leave, start typing, or lose the live map connection.</p></details>
  </section>;
}
