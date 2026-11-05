import { useState } from "react";
import { Reply } from "./Reply";

const MOMENTS = [
  { line: "This rollback has no owner yet.", answers: ["I'll own the rollback", "Let's choose together"], target: "rollback", x: 58, y: 42 },
  { line: "What would make this ready to launch?", answers: ["A passing smoke check", "A team review"], target: "launch", x: 67, y: 19 },
];

export function Example({ onRead, canRead, busy }: { onRead: () => void; canRead: boolean; busy: boolean }) {
  const [moment, setMoment] = useState(0);
  const [reply, setReply] = useState("");
  const note = MOMENTS[moment];
  return <section className="canvas-buddy-example" aria-label="Canvas buddy example">
    <div className="canvas-buddy-heading"><span>CANVAS BUDDY</span><span className="canvas-buddy-label">Example · not your map</span></div>
    <div className="canvas-buddy-sketch" aria-label="Example launch map">
      <svg className="canvas-buddy-paths" viewBox="0 0 500 160" preserveAspectRatio="none" aria-hidden="true">
        <path d="M104 92 C160 145 210 108 300 105 S340 28 403 42" />
      </svg>
      <div className="canvas-buddy-seed">A calmer launch<span>one small plan</span></div>
      <div className="canvas-buddy-rollback" data-active={note.target === "rollback"}>Rollback<span>owner still open</span></div>
      <div className="canvas-buddy-launch" data-active={note.target === "launch"}>Go live<span>Friday, if ready</span></div>
      <span className="canvas-buddy-demo-bead" style={{ left: `${note.x}%`, top: `${note.y}%` }} aria-hidden="true"><i /></span>
    </div>
    <div className="canvas-buddy-paper" key={moment}>
      <p className="canvas-buddy-line" role="status">{reply ? "A little clearer already." : note.line}</p>
      {reply ? <div className="canvas-buddy-receipt"><q>{reply}</q><small>Example reply only · nothing added to your map</small></div>
        : <Reply answers={note.answers} onReply={setReply} />}
    </div>
    <div className="canvas-buddy-footer">
      <button type="button" onClick={() => { setMoment((moment + 1) % MOMENTS.length); setReply(""); }}>Follow the bead ↗</button>
      <button type="button" disabled={!canRead || busy} onClick={onRead}>{busy ? "Reading your map…" : "Read my map"}</button>
    </div>
    {!canRead && <small className="canvas-buddy-hint">Add a thought to your map to invite Muse Spark in.</small>}
  </section>;
}
