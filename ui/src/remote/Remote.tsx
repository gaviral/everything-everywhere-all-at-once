// The Remote (`?remote`, main.tsx): a phone's page for the AI helpers' work, beside nothing else. The Work spine fills the
// screen, and at its foot the question a helper holds for you, with a box to answer it and a Send that tells the helper
// (`answer`, core/src/guide.rs). In a room it joins as any other window does, by its name (room.tsx), and shows what the
// core relays; with no room it plays a demo feed in the page (demo.ts) and says so, and nothing it sends goes anywhere.
import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { useCore } from "../core";
import { dropHeld, useGuide } from "../guide-core";
import { sendToCore, useLeave, useMe } from "../room";
import { useCall } from "../talk/call-core";
import { useJobs } from "../work-jobs";
import { Counts, DemoLabel, isDemo, JobList, useFresh, useNow } from "../bricks/work-spine/list";
import "../bricks/work-spine/work-spine.css";
import { asksOf, options, type Ask } from "./ask";
import { playFeed } from "./demo";
import { SPEED } from "./flag";
import "./remote.css";

/** The longest an answer runs (core/src/guide.rs `answer`). */
const ANSWER_MAX = 280;
/** How long "Sent" stays up. */
const SENT_MS = 5000;
/** How long a question must stand before it's shown: a job's tree arrives a message at a time, the parent first, and a
 *  parent's words ("…waiting on your answer") are no question until the side job that asks has come to say so. */
const SETTLE_MS = 300;

export default function Remote() {
  useEffect(() => { document.title = "E2A2O Remote"; }, []);
  // In a room this window is one of its people; alone it's no one's, and the page's own feed stands in.
  return useLeave() ? <Live /> : <Demo />;
}

/** In a room: the core's jobs and held questions, and answers sent back to whoever asked. */
function Live() {
  const me = useMe();
  const core = useCore(me);
  const call = useCall();
  const ai = useCallback((name: string) => !!call?.people.find((person) => person.name === name)?.ai, [call]);
  const send = useCallback((ask: Ask, text: string) => sendToCore({ type: "answer", to: ask.by, text }), []);
  return <Page status={core.connected ? `On the shared map as ${me}` : "Connecting…"} ai={ai} send={send} />;
}

/** With no room: the page's own feed, from the start, and answers that stay here. */
function Demo() {
  useEffect(() => playFeed(SPEED), []);
  const ai = useCallback(() => true, []);
  const send = useCallback(() => true, []);
  return <Page simulated ai={ai} send={send} />;
}

interface PageProps {
  /** One line about the connection, top right; none when there isn't one. */
  status?: string;
  /** The page itself is simulated (the demo): its label heads the page and its question. */
  simulated?: boolean;
  ai: (name: string) => boolean;
  /** Sends an answer; false when it couldn't go (the connection is down). */
  send: (ask: Ask, text: string) => boolean;
}

/** The height that's really in view: a phone's keyboard takes the foot of the screen, and the box must stay above it. */
function useSeen(): string {
  const [height, setHeight] = useState("100dvh");
  useEffect(() => {
    const view = window.visualViewport;
    if (!view) return;
    const update = () => setHeight(`${Math.round(view.height)}px`);
    update();
    view.addEventListener("resize", update);
    return () => view.removeEventListener("resize", update);
  }, []);
  return height;
}

/** The questions that have stood for SETTLE_MS (by who and what, so one whose asking changes but whose words don't is
 *  the same one); one that's gone, answered or withdrawn, goes at once. */
function useSettled(asks: readonly Ask[]): Ask[] {
  const [settled, setSettled] = useState<ReadonlySet<string>>(new Set());
  const signature = asks.map((ask) => `${ask.by}|${ask.text}`).join(" ‖ ");
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(new Set(asks.map((ask) => `${ask.by}|${ask.text}`))), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [signature]);
  return useMemo(() => asks.filter((ask) => settled.has(`${ask.by}|${ask.text}`)), [asks, settled]);
}

function Page({ status, simulated = false, ai, send }: PageProps) {
  const jobs = useJobs();
  const held = useGuide().held;
  const now = useNow(jobs);
  const fresh = useFresh(jobs);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback((id: string) => setOpen((was) => { const next = new Set(was); if (!next.delete(id)) next.add(id); return next; }), []);

  // What was answered stays answered while the helper still says it waits (a reconnect replays it as it was); asked again, it's a new asking.
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const waiting = useMemo(() => asksOf(jobs, held, answered), [jobs, held, answered]);
  const asks = useSettled(waiting);

  const [sent, setSent] = useState<{ to: string; text: string; demo: boolean } | null>(null);
  useEffect(() => {
    if (!sent) return;
    const timer = window.setTimeout(() => setSent(null), SENT_MS);
    return () => window.clearTimeout(timer);
  }, [sent]);
  const answer = useCallback((ask: Ask, text: string): boolean => {
    if (!send(ask, text)) return false;
    setAnswered((was) => new Set(was).add(ask.id));
    for (const n of ask.held) dropHeld(n);
    setSent({ to: ask.by, text, demo: simulated || ask.demo });
    return true;
  }, [send, simulated]);

  const ask = asks[0];
  const seen = useSeen();
  return <main className="remote" style={{ height: seen }}>
    <div className="remote-bar">
      <span className="remote-pill"><span className="remote-wordmark">E2A2O</span><span className="remote-sep" aria-hidden="true" /><h1 className="remote-name">Remote</h1></span>
      {status && <span className="remote-status" role="status">{status}</span>}
    </div>
    <section className="remote-spine" aria-label="Work spine">
      <div className="work-spine-head">
        <span className="work-spine-badge ai-mark" aria-hidden="true">✦</span>
        <div className="work-spine-head-text">
          <div className="work-spine-top"><h2 className="work-spine-title">Work spine</h2>{(simulated || isDemo(jobs)) && <DemoLabel />}</div>
          <p className="work-spine-counts"><Counts jobs={jobs} /></p>
        </div>
      </div>
      <JobList jobs={jobs} now={now} open={open} toggle={toggle} fresh={fresh} ai={ai} />
    </section>
    <section className="remote-dock" aria-label="Waiting for you">
      {sent && <p className="remote-sent" role="status">Sent to {sent.to}: “{sent.text}”{sent.demo ? " (simulated)" : ""}</p>}
      {ask ? <AskCard key={`${ask.by}|${ask.text}`} ask={ask} more={asks.length - 1} simulated={simulated || ask.demo} ai={ai(ask.by)} answer={answer} />
        : !waiting.length && <p className="remote-quiet">Nothing is waiting for you.</p>}
    </section>
  </main>;
}

/** The first question waiting: who asks, the words, a tap for each answer it offers, and a box for any other. */
function AskCard({ ask, more, simulated, ai, answer }: { ask: Ask; more: number; simulated: boolean; ai: boolean; answer: (ask: Ask, text: string) => boolean }) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState("");
  const asked = useId();
  const quick = useMemo(() => options(ask.text), [ask.text]);
  const go = (words: string) => {
    const said = words.trim().replace(/\s+/g, " ");
    if (!said) return;
    setProblem(answer(ask, said) ? "" : "Not sent: the connection is down. Try again in a moment.");
  };
  const submit = (event: FormEvent) => { event.preventDefault(); go(text); };
  return <form className="remote-ask" onSubmit={submit}>
    <p className="remote-ask-head">
      <span className="remote-ask-state">Waiting for you</span>
      <span className="remote-ask-by">{ai && <span className="ai-mark" aria-hidden="true">✦ </span>}{ask.by}</span>
    </p>
    <p id={asked} className="remote-ask-text">{ask.text}</p>
    {simulated && <DemoLabel />}
    {quick.length > 0 && <div className="remote-quick" role="group" aria-label="Quick answers">
      {quick.map((words) => <button key={words} type="button" className="remote-quick-button" onClick={() => go(words)}>{words}</button>)}
    </div>}
    <div className="remote-answer">
      <input className="remote-field" value={text} onChange={(event) => { setText(event.target.value); setProblem(""); }} maxLength={ANSWER_MAX}
        placeholder="Your answer" aria-label={`Your answer to ${ask.by}`} aria-describedby={asked} enterKeyHint="send" autoComplete="off" autoCorrect="on" />
      <button type="submit" className="remote-send" disabled={!text.trim()}>Send</button>
    </div>
    {problem && <p className="remote-problem" role="alert">{problem}</p>}
    {more > 0 && <p className="remote-more">{more} more waiting</p>}
  </form>;
}
