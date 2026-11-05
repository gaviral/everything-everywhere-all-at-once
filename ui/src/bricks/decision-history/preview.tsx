import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { BrickProps, Thought, Thread } from "../contract";
import DecisionHistory, { styles } from "./index";

const thought = (id: string, text: string, at: number): Thought => ({ id, text, point: text, speaker: "Visitor", thread_id: "launch", placed: true, unclear: "", complete: true, at_ms: at, place_ms: 0 });
const thread: Thread = { id: "launch", title: "Launch gathering", parent_id: null, status: "open", last_point: "", touched_ms: 1, tags: [], picture: null, dropped_by: "" };

function Preview() {
  const [fixture, choose] = useState("live");
  const [mounted, mount] = useState(true);
  const [jump, setJump] = useState("");
  const thoughts = [thought("garden-source", fixture === "changed" ? "The source wording was corrected." : "We chose the garden if the forecast stays dry, because it has room for everyone.", 1793808000000), thought("rain-source", "Rain is now likely. We chose the studio if capacity is confirmed, so everyone stays dry.", 1793811600000), thought("review-source", "Should we offer a remote way to join? We need to review the options.", 1793815200000)];
  const map = { mapIdentity: fixture === "unidentified" ? null : fixture === "other" ? "other-map" : "preview-map", visitKey: fixture === "other" ? "other:Visitor" : "first:Visitor", me: "Visitor", threads: fixture === "empty" ? [] : [thread], thoughts: fixture === "empty" ? [] : fixture === "missing" ? thoughts.slice(1) : thoughts, connected: true } as unknown as BrickProps["map"];
  const actions = { openThought: (id: string) => { setJump(id); mount(false); return true; } } as BrickProps["actions"];
  return <><style>{styles}</style>{mounted && <DecisionHistory map={map} actions={actions} on={() => () => {}} brick={{ id: "decision-history", name: "Decision history", does: "", kind: "view", defaultOn: false, demoSafe: true }} />}
    <fieldset style={{ margin: 24 }}><legend>Isolated preview controls</legend><label>Fixture <select id="fixture" value={fixture} onChange={event => choose(event.target.value)}>{["live", "empty", "changed", "missing", "other", "unidentified"].map(value => <option key={value}>{value}</option>)}</select></label><button type="button" id="mount" onClick={() => mount(!mounted)}>{mounted ? "Hide view" : "Return to view"}</button><output id="jump">{jump}</output></fieldset>
  </>;
}

createRoot(document.getElementById("root")!).render(<Preview />);
