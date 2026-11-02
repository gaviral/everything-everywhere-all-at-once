import { MicGlyph } from "./MicButton";
import "./symbols.css";

// The ? list's legend: every mark and state the map can show, drawn with the very classes the map uses, so the
// sample always looks like the real thing. Colors keep one meaning each: blue is where you are, amber what needs you,
// purple what the AI added, and the five room colors only say which room a thread belongs to.
const ROOMS = ["green", "pink", "teal", "red", "lime"];

export function Symbols() {
  return <>
    <strong>Symbols</strong>
    <ul className="symbols">
      <li><span className="symbol"><span className="ai-mark">✦</span></span><span>Added or proposed by AI · point at one to see what it did and how to undo it</span></li>
      <li><span className="symbol"><span className="chip now">active</span></span><span>The thread you're on (blue: where you are)</span></li>
      <li><span className="symbol"><span className="chip dropped">left off</span></span><span>You moved on mid-sentence; the card above the composer offers Finish it</span></li>
      <li><span className="symbol"><span className="chip waiting">2 to review</span></span><span>AI proposals waiting inside a folded thread (amber: needs you)</span></li>
      <li><span className="symbol" aria-hidden="true"><span className="symbol-latest" /></span><span>A bar beside a point: your newest, until your next one lands</span></li>
      <li><span className="symbol" aria-hidden="true"><span className="unseen-dot" /></span><span>A dot by a title: that thread changed since you looked</span></li>
      <li><span className="symbol symbol-due"><span className="when due overdue">Overdue</span><span className="when due today">Today</span><span className="when due tomorrow">Tomorrow</span></span><span>When a proposed reminder is due; the sooner, the stronger; later dates stay grey</span></li>
      <li><span className="symbol"><span className="unclear">?</span></span><span>A word that might be misheard</span></li>
      <li><span className="symbol symbol-rooms" aria-hidden="true">{ROOMS.map((room) => <i key={room} style={{ background: `var(--room-${room})` }} />)}</span><span>Room colors: a thread and its branches share one, on the rail and the letter tile</span></li>
      <li><span className="symbol symbol-mic" aria-hidden="true">
        <span className="mic-sample" data-state="listening"><MicGlyph state="listening" /></span>
        <span className="mic-sample" data-state="paused"><MicGlyph state="paused" /></span>
        <span className="mic-sample" data-state="nokey"><MicGlyph state="nokey" /></span>
      </span><span>Mic: listening, its ring swelling as it hears you · paused · needs an AI key</span></li>
    </ul>
  </>;
}
