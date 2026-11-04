import { useEffect, useState } from "react";
import { content, timeRemaining } from "./model";

export default function Deadline() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = window.setInterval(refresh, 1000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const time = timeRemaining(content.deadline, now);
  return <section className="hackathon-deadline" aria-label="Submission deadline">
    <span className="hackathon-eyebrow">{time.closed ? "Submission cutoff reached" : "Time to hand it in"}</span>
    <div className="hackathon-clock" role="timer" aria-label={time.closed ? "Deadline reached" : `${time.hours} hours ${time.minutes} minutes ${time.seconds} seconds remaining`}>
      {time.closed ? <strong className="hackathon-closed">Deadline reached</strong> : <>
        <span><strong>{time.hours}</strong><small>hours</small></span><b>:</b>
        <span><strong>{time.minutes}</strong><small>minutes</small></span><b>:</b>
        <span><strong>{time.seconds}</strong><small>seconds</small></span>
      </>}
    </div>
    <time dateTime={content.deadline}>{content.deadlineLabel}</time>
  </section>;
}
