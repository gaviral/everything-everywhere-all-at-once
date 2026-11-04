import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { BrickActions, MapSnapshot, ResearchKept, Thought } from "../contract";
import QuestionResearch from "./index";
import brick from "./brick.json";
import "./preview.css";

const original = "When does the blue venue open?";
const first: Thought = { id: "question-one", text: original, point: original, speaker: "you", thread_id: "venue", placed: true, unclear: "", complete: true, at_ms: 1, place_ms: 0 };
const second: Thought = { ...first, id: "question-two", text: "Is there a step-free entrance?", point: "Is there a step-free entrance?", at_ms: 2 };
const empty: MapSnapshot = { visitKey: "synthetic-preview", mapIdentity: "synthetic-preview", thoughts: [], threads: [], questions: [], active: "venue", suggestions: [], reminders: [], apps: [], notes: {}, points: new Map(), rooms: new Map(), topics: [], positions: {}, speakers: new Map(), me: "you", partial: "", connected: true, usage: null, jobs: [] };
const storage = "question-research.synthetic-preview";

function Preview() {
  const [on, setOn] = useState(false);
  const [thoughts, setThoughts] = useState([first, second]);
  const [records, setRecords] = useState<ResearchKept[]>(() => JSON.parse(localStorage.getItem(storage) ?? "[]"));
  const [candidate, setCandidate] = useState<ResearchKept | null>(null);
  const [openedThought, setOpenedThought] = useState("");
  const [connected, setConnected] = useState(true);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [requestCount, setRequestCount] = useState(0);
  const map: MapSnapshot = { ...empty, thoughts, connected, research: records,
    threads: thoughts.length ? [{ id: "venue", title: "Venue", parent_id: null, status: "open", last_point: "", touched_ms: 1, tags: [], picture: null, dropped_by: "" }] : [] };
  const save = (next: ResearchKept[]) => { setRecords(next); localStorage.setItem(storage, JSON.stringify(next)); };
  const actions = {
    research: async request => {
      setRequestCount(n => n + 1);
      const fail = { request_id: request.request_id, ok: false, message: "Synthetic request unavailable.", answer: null };
      if (!connected) return fail;
      if (request.op === "run") {
        const thought = thoughts.find(t => t.id === request.thought_id);
        if (!thought) return fail;
        const answer: ResearchKept = { id: request.request_id, request_id: request.request_id, thought_id: thought.id, quote: thought.text, source_point: thought.point,
          topic_id: "venue", topic_title: "Venue", owner: "you", query: request.query!, answer: "The venue opens at nine.",
          citations: [{ title: "Example venue guide", url: "https://venue.test/hours", start: 0, end: 23 }],
          at_ms: 1793808000000, model: "Synthetic provider fixture", simulated: true, revision: 0, removed: false };
        return new Promise(resolve => setPending(() => () => { setCandidate(answer); setPending(null); resolve({ request_id: request.request_id, ok: true, message: "Synthetic answer ready.", answer }); }));
      }
      const previous = request.op === "keep" ? candidate : records.find(r => r.id === request.answer_id);
      if (!previous) return fail;
      const answer = { ...previous, revision: previous.revision + 1, removed: request.op === "remove" };
      save([...records.filter(r => r.id !== answer.id), answer]);
      return { request_id: request.request_id, ok: true, message: request.op === "keep" ? "Answer attached to your question." : "Synthetic change saved.", answer };
    },
    cancelResearch: () => {},
    openThought: source => {
      const id = typeof source === "string" ? source : source.id;
      const thought = thoughts.find(t => t.id === id && t.placed);
      if (!thought) return false;
      setOpenedThought(thought.text); return true;
    },
  } satisfies Pick<BrickActions, "research" | "cancelResearch" | "openThought">;
  return <main className="question-research-preview-host">
    <h1>Question → answer → original thought</h1><p>Scoped preview · synthetic host · no live provider</p>
    <div className="question-research-preview-controls">
      <button role="switch" aria-label="Research this question" aria-checked={on} onClick={() => setOn(!on)}>{on ? "Switch off" : "Switch on"}</button>
      <button onClick={() => setConnected(!connected)}>{connected ? "Go offline" : "Reconnect"}</button>
      <button onClick={() => setThoughts(list => list.map(t => t.id === first.id ? { ...t, text: "What are the revised opening hours?" } : t))}>Change original</button>
      <button onClick={() => setThoughts(list => list.filter(t => t.id !== first.id))}>Remove original from preview</button>
      <button onClick={() => { save([]); setThoughts([]); }}>Empty example map</button>
      {pending && <button onClick={pending}>Complete pending request</button>}
    </div>
    <p aria-label="Synthetic request count">Requests: {requestCount}</p>
    {on && <QuestionResearch map={map} actions={actions as BrickActions} brick={{ ...brick, kind: "card" }} on={() => () => {}} />}
    <p aria-label="Opened map thought">On the map: {openedThought || "No jump yet"}</p>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Preview />);
