import { useEffect, useId, useRef, useState } from "react";
import type { BrickProps } from "../contract";
import { finishedJobs, isReviewed, pruneMarks, toggleReview, type ReviewMark } from "./rules";
import "./result-review.css";

export default function ResultReview({ map }: BrickProps) {
  const [marks, setMarks] = useState<readonly ReviewMark[]>([]);
  const [open, setOpen] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const currentMarks = map.connected ? pruneMarks(marks, map.jobs) : [];
  useEffect(() => {
    setMarks((old) => map.connected ? pruneMarks(old, map.jobs) : []);
  }, [map.jobs, map.connected]);
  const jobs = finishedJobs(map.jobs);
  const count = jobs.filter((job) => isReviewed(job, currentMarks)).length;
  const rows = jobs.filter((job) => isReviewed(job, currentMarks) === reviewed);
  const close = () => { setOpen(false); opener.current?.focus(); };

  return <section className="result-review" aria-label="Result review" onKeyDown={(event) => {
    if (event.key === "Escape" && open) { event.stopPropagation(); close(); }
  }}>
    <button type="button" className="result-review-opener" ref={opener} aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen(!open)}>
      Result review · {jobs.length - count} need review
    </button>
    {open && <div id={`${id}-body`} className="result-review-body">
      <div className="result-review-top"><p>Reviewed marks last for this visit.</p><button type="button" onClick={close}>Close</button></div>
      <p className="result-review-explanation">Mark reviewed means “This tab reviewed this version.” It does not accept work or confirm understanding.</p>
      <div className="result-review-tabs" role="tablist" aria-label="Result status">
        {[false, true].map((value, i) => <button type="button" key={String(value)} ref={(el) => { tabs.current[i] = el; }}
          id={`${id}-tab-${i}`} role="tab" aria-selected={reviewed === value} aria-controls={`${id}-rows`} tabIndex={reviewed === value ? 0 : -1}
          onClick={() => setReviewed(value)} onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - i;
            setReviewed(next === 1); tabs.current[next]?.focus();
          }}>{value ? `Reviewed (${count})` : `Needs review (${jobs.length - count})`}</button>)}
      </div>
      <div className="result-review-rows" id={`${id}-rows`} role="tabpanel" aria-labelledby={`${id}-tab-${reviewed ? 1 : 0}`} tabIndex={0}>
        {!jobs.length ? <p>No finished helper results here yet.</p> : !rows.length ? <p>{reviewed ? "No results marked reviewed this visit." : "No results need review this visit."}</p> : rows.map((job) => <article className="result-review-row" key={JSON.stringify([job.by, job.id])} data-result-id={job.id}>
          <p className="result-review-meta"><span>{job.by}</span>{job.demo && <strong>Simulated</strong>}<time dateTime={new Date(job.at_ms).toISOString()}>{new Date(job.at_ms).toLocaleString()}</time></p>
          <h3>{job.title}</h3>
          <details><summary>Result</summary><p className="result-review-result">{job.result || "No result supplied"}</p></details>
          <button type="button" disabled={!map.connected} onClick={() => {
            setMarks((old) => toggleReview(pruneMarks(old, map.jobs), job));
            tabs.current[reviewed ? 1 : 0]?.focus();
          }}>{reviewed ? "Mark unreviewed" : "Mark reviewed"}</button>
        </article>)}
      </div>
    </div>}
  </section>;
}
