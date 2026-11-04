// Synthetic component host: no core connection, accounts, or microphone.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import Clarify from "../../clarify";
import Crew from "../../crew";
import Draw from "../index";
import { switchBrick } from "../../../bricks-core";
import type { BrickProps } from "../../contract";

const listeners = new Map<string, Set<(value: any) => void>>();
const on: BrickProps["on"] = (name, hear) => {
  const set = listeners.get(name) ?? new Set(); listeners.set(name, set); set.add(hear);
  return () => { set.delete(hear); };
};
const emit = (name: string, value: unknown) => { for (const hear of [...listeners.get(name) ?? []]) hear(value); };
let change: (next: any) => void;
let mode: (next: string) => void;
let mount: () => void;
const base = { thoughts: [], threads: [], visitKey: "film-check", me: "Example speaker" };
let current: any = base;
const actions = { notify: (text: string) => { throw new Error(text); }, annotate: (id: string, term: string, text: string) => {
  current = { ...current, threads: [...current.threads, { id: "answer-thread", anchor: { thought_id: id, quote: term } }],
    thoughts: [...current.thoughts, { id: "saved-answer", thread_id: "answer-thread", text }] };
  change(current); return true;
} } as unknown as BrickProps["actions"];
const stroke = { id: "lower-box", at: 1, end: 2, points: [[.05,.05],[.95,.05],[.95,.99],[.05,.99],[.05,.05]].map(([x,y]) => ({x,y,p:.5})) };
localStorage.setItem("e2a2o-draw-strokes", JSON.stringify([stroke]));
switchBrick("crew", true);
function Host() {
  const [map, setMap] = useState(current), [which, setWhich] = useState("clarify"), [key, setKey] = useState(0);
  change = setMap; mode = setWhich; mount = () => setKey(old => old + 1);
  const props = { map, actions, on } as BrickProps;
  return <><div data-thought="thought">the holon lane</div><div key={key}>
    {which === "clarify" && <Clarify {...props} />}
    {which === "crew" && <Crew {...props} />}
    {which === "draw" && <><Crew {...props} /><Draw {...props} /></>}
  </div></>;
}
createRoot(document.getElementById("root")!).render(<Host />);
(window as any).film = {
  mode: (which: string) => flushSync(() => mode(which)),
  remount: () => flushSync(() => mount()),
  land: (id: string, text: string) => {
    current = { ...current, thoughts: [...current.thoughts.filter((t: any) => t.id !== id), { id, text }] };
    flushSync(() => change(current));
    emit("landed", { thoughtId: id, mine: true });
  },
  words: (text: string) => emit("words", text),
};
