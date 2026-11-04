import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { BrickActions, BrickProps, MapSnapshot } from "../contract";
import FaithfulReading, { styles } from "./index";

const map: MapSnapshot = { threads: [], thoughts: [], active: null, suggestions: [], reminders: [], apps: [], notes: {},
  points: new Map(), rooms: new Map(), speakers: new Map(), topics: [], positions: {}, me: "Example reader",
  partial: "", connected: false, usage: null, jobs: [], questions: [], visitKey: "reading-preview" };
const actions = new Proxy({}, { get: (_object, key) => {
  if (key === "closeView") return () => {};
  if (key === "openThought") return (id: string) => { document.body.dataset.openedSource = id; return true; };
  return () => { throw new Error(`Unexpected host action: ${String(key)}`); };
} }) as BrickActions;
const props: BrickProps = { map, actions, on: () => () => {}, brick: {
  id: "i-compact", name: "Faithful reading", does: "Isolated preview", kind: "view", defaultOn: false, demoSafe: true,
} };
function Preview() {
  const [mounted, mount] = useState(true);
  const [live, setLive] = useState(false);
  const [connected, connect] = useState(true);
  const [changed, change] = useState(false);
  const [removed, remove] = useState(false);
  const [participant, setParticipant] = useState("Example reader");
  const liveMap: MapSnapshot = { ...map, connected, me: participant,
    threads: [{ id: "source-topic", title: changed ? "A renamed topic" : "A live-shaped topic", parent_id: null,
      status: "open", last_point: "", touched_ms: 0, tags: [], picture: null, dropped_by: "" }],
    thoughts: removed ? [] : [{ id: "source-one", speaker: "Example author", thread_id: "source-topic", text: changed ? "Changed original. Only proceed after review." : "Exact original. Only proceed after permission.",
      point: "Proceed only after permission.", unclear: "Permission pending", placed: true, complete: true, at_ms: 0, place_ms: null }],
  };
  return <><style>{styles}</style>
    <div aria-label="Fixture controls">
      <button id="remount" onClick={() => mount(!mounted)}>Toggle mounted</button>
      <button id="live" onClick={() => setLive(true)}>Use map fixture</button>
      <button id="disconnect" onClick={() => connect(!connected)}>Toggle connection</button>
      <button id="change" onClick={() => change(!changed)}>Change original and title</button>
      <button id="remove" onClick={() => remove(!removed)}>Toggle source presence</button>
      <button id="participant" onClick={() => setParticipant(participant === "Example reader" ? "Another reader" : "Example reader")}>Change reader</button>
    </div>
    {mounted && <FaithfulReading {...props} map={live ? liveMap : map} />}
  </>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
