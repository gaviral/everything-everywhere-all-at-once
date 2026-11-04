import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import PlaceDrafts, { styles } from "../index";

const topic = (id, title) => ({ id, title, parent_id: null, status: "open", last_point: "", touched_ms: 1, tags: [], picture: null, dropped_by: "" });
const point = (id, thread, text) => ({ id, speaker: "Synthetic speaker", text, point: text, thread_id: thread,
  placed: true, unclear: "", complete: true, at_ms: 1, place_ms: 1 });
const original = Array.from({ length: 12 }, (_, i) => point(`alpha-${i}`, "alpha",
  `Reading passage ${i + 1}. Give a thought a little room to grow. Follow the original words, then return to finish the sentence you were writing. This is synthetic check content.`));
function fixture(version, identity, person) {
  return { mapIdentity: identity === "pending" ? null : identity, me: person, connected: true,
    threads: version === "empty" ? [] : version === "missing" ? [topic("beta", "Another reading")] : version === "renamed"
      ? [topic("beta", "Another reading"), topic("alpha", "A renamed heading")]
      : [topic("alpha", "An interrupted thought"), topic("beta", "Another reading")],
    thoughts: version === "empty" ? [] : version === "missing" ? [point("beta-0", "beta", "An independent second source.")]
      : [...(version === "renamed" ? [point("alpha-new", "alpha", "A late passage inserted before the old reading place.")] : []), ...original, point("beta-0", "beta", "An independent second source.")],
    jobs: version === "empty" ? [] : [{ id: "helper-1", by: "Helper", title: "A finished helper result", status: "done", demo: true, result: "A synthetic helper result, retained as history. Nothing was approved.", at_ms: 1 }],
    questions: [], active: null, suggestions: [], reminders: [], apps: [], notes: {}, points: new Map(), rooms: new Map(), topics: [], positions: {}, speakers: new Map(), partial: "", usage: null };
}
function Preview() {
  const [version, setVersion] = useState("initial");
  const [identity, setIdentity] = useState("synthetic-map-A");
  const [person, setPerson] = useState("reader-A");
  const [visible, setVisible] = useState(true);
  const [source, setSource] = useState("");
  const map = useMemo(() => fixture(version, identity, person), [version, identity, person]);
  const actions = useMemo(() => new Proxy({}, { get: (_target, name) => name === "openThought" ? id => {
    setSource(id); setVisible(false); return true;
  } : () => { throw new Error(`Unexpected action: ${String(name)}`); } }), []);
  useEffect(() => { window.readingFixture = { setVersion, setIdentity, setPerson, setVisible }; }, []);
  return <><style>{styles}</style>
    {visible ? <PlaceDrafts map={map} actions={actions} /> : <div style={{ padding: 40 }}>
      <h1>Original source: {source}</h1><button id="return" onClick={() => setVisible(true)}>Return to reader</button></div>}
  </>;
}
createRoot(document.getElementById("root")).render(<Preview />);
