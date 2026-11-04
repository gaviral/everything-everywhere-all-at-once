// Draw: the pen on the screen. Draw; say what each thing is; Spark reads it; Muse Image draws back; Flow builds it.
// This file only orders those parts: ink.ts, InkSheet.tsx, labels.ts, lasso.ts, spoken.ts, reading.ts, marks.ts, Notes.tsx.
import { useCallback, useEffect, useRef, useState } from "react";
import { isOn, switchBrick } from "../../bricks-core";
import { useBrickEvent, type BrickProps } from "../contract";
import { InkSheet, type Tool } from "./InkSheet";
import type { Stroke } from "./ink";
import { useKept } from "./kept";
import { clausesIn, namedIn, strokesMeant, type Label } from "./labels";
import { pickedBy } from "./lasso";
import { Answers, Notes, type Reply } from "./Notes";
import { drawBack, onTheInk, pictureOf, readSketch, type Reading } from "./reading";
import { commandIn } from "./spoken";
import "./draw.css";

const SAID_MAX = 1800;
/** Keeps up: a pause this long in drawing is the moment to look, as a person beside you would. */
const FOLLOW_PAUSE_MS = 1400;
const FOLLOW_MIN_STROKES = 3;
const THOUGHTS_FOR_BRIEF = 4;
const FLOW_RETRY_MS = 150;
const FLOW_TRIES = 30;
const plainWords = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const flagged = () => new URLSearchParams(location.search).has("draw");

/** Keeps the bottom bar, with the mic and the live words, in view below the sheet. */
function useBarHeight(open: boolean) {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const stage = document.querySelector('[data-slot="stage"]');
      setHeight(stage ? Math.max(0, Math.min(240, innerHeight - stage.getBoundingClientRect().top)) : 0);
    };
    measure();
    addEventListener("resize", measure);
    return () => removeEventListener("resize", measure);
  }, [open]);
  return height;
}

type Source = { id: string; text: string } | null;

/** Hands the boxes to Flow, and keeps offering until Flow, which may still be loading, takes them. */
function openFlow(reading: Reading, source: Source) {
  const pipeline = {
    id: crypto.randomUUID(), name: reading.flow.name,
    steps: reading.flow.steps.map((step, index) => ({ id: `step-${index + 1}`, name: step.name, prompt: step.prompt })),
  };
  location.hash = `flow=${btoa(unescape(encodeURIComponent(JSON.stringify(pipeline))))}`;
  switchBrick("flow-canvas", true);
  let tries = 0;
  const offer = () => {
    const taken = !dispatchEvent(new CustomEvent("e2a2o:flow-load", { detail: { pipeline, source }, cancelable: true }));
    if (!taken && ++tries < FLOW_TRIES) setTimeout(offer, FLOW_RETRY_MS);
  };
  offer();
}

export default function Draw({ on, actions, map }: BrickProps) {
  const [open, setOpen] = useState(flagged);
  const [strokes, setStrokes] = useKept<Stroke[]>("strokes", []);
  const [labels, setLabels] = useKept<Label[]>("labels", []);
  const [tool, setTool] = useState<Tool>("pen");
  const [picked, setPicked] = useState<string[]>([]);
  const [reading, setReading] = useState<{ value: Reading; ms: number } | null>(null);
  const [reply, setReply] = useState<Reply | null>(null);
  const [busy, setBusy] = useState<"" | "reading">("");
  const [typed, setTyped] = useState("");
  const [following, setFollowing] = useState(true);
  const [seeThrough, setSeeThrough] = useState(false);
  const said = useRef("");
  // What the person was on when they picked up the pen: the boxes they draw run on that.
  const thoughtBefore = useRef<Source>(null);
  const known = map.thoughts[map.thoughts.length - 1];
  useEffect(() => { if (!open) thoughtBefore.current = known ? { id: known.id, text: known.text } : null; }, [open, known]);
  const barHeight = useBarHeight(open);
  const sheet = useRef<HTMLDivElement>(null);
  const now = useRef({ strokes, labels, picked, reading });
  now.current = { strokes, labels, picked, reading };

  const failed = useCallback((error: unknown) => actions.notify(error instanceof Error ? error.message : "Draw didn't work."), [actions]);

  /** One name for what's picked, or else for what was drawn around `at`. Later words of the same name replace it. */
  const nameDrawing = useCallback((id: string, text: string, at: number) => {
    setLabels(old => {
      if (old.some(label => label.id === id)) return old.map(label => label.id === id ? { ...label, text } : label);
      const marks = now.current.picked.length ? now.current.picked : strokesMeant(now.current.strokes, namedIn(old), at);
      if (now.current.picked.length) setPicked([]);
      return [...old.filter(label => !label.strokes.some(mark => marks.includes(mark))), { id, text, strokes: marks }];
    });
  }, [setLabels]);

  const inRead = useRef(false);
  const readCount = useRef(0);
  const read = useCallback(async (quietly = false) => {
    const { strokes: ink, labels: names } = now.current;
    if (!ink.length || inRead.current) return now.current.reading?.value ?? null;
    inRead.current = true;
    readCount.current = ink.length;
    if (!quietly) setBusy("reading");
    try {
      const box = sheet.current?.getBoundingClientRect();
      const answer = await readSketch(pictureOf(ink, names, box ? box.width / box.height : 16 / 9), names, said.current);
      const placed = onTheInk(answer.reading, now.current.strokes, now.current.labels);
      setReading({ value: placed, ms: answer.ms });
      return placed;
    } catch (error) { if (!quietly) failed(error); return null; } finally { inRead.current = false; setBusy(""); }
  }, [failed]);

  // Keeps up: it reads along at each pause in the drawing, and waits while the pen is moving.
  const pause = useRef(0);
  const followNext = useCallback(() => {
    clearTimeout(pause.current);
    pause.current = window.setTimeout(() => {
      const count = now.current.strokes.length;
      if (count >= FOLLOW_MIN_STROKES && count !== readCount.current) void read(true);
    }, FOLLOW_PAUSE_MS);
  }, [read]);
  useEffect(() => () => clearTimeout(pause.current), []);

  const answerInInk = useCallback(async () => {
    const known = now.current.reading?.value ?? await read();
    if (!known) return;
    setReply({ waiting: true });
    try {
      const names = now.current.labels.map(label => label.text);
      const answer = await drawBack(names.length ? `${known.draw_back} Label it with exactly these words: ${names.join(", ")}.` : known.draw_back);
      setReply({ image: answer.image, ms: answer.ms, waiting: false });
    } catch (error) { setReply(null); failed(error); }
  }, [failed, read]);

  const build = useCallback(async () => {
    const known = now.current.reading?.value ?? await read();
    if (!known) return;
    // With Crew on, the sketch becomes parts built side by side; otherwise boxes that run in order.
    if (isOn("crew")) {
      const names = now.current.labels.map(label => label.text).join(", ");
      const recent = map.thoughts.slice(-THOUGHTS_FOR_BRIEF).map(thought => thought.text).join(" ");
      const brief = [recent, names ? `The parts I drew: ${names}.` : known.said].join(" ");
      dispatchEvent(new CustomEvent("e2a2o:crew-build", { detail: brief }));
      setOpen(false);
    } else if (known.flow?.steps?.length) { openFlow(known, thoughtBefore.current); setOpen(false); }
  }, [map.thoughts, read]);

  const undo = useCallback(() => {
    const newest = now.current.strokes[now.current.strokes.length - 1];
    if (!newest) return;
    setStrokes(old => old.slice(0, -1));
    setLabels(old => old.flatMap(label => {
      const left = label.strokes.filter(id => id !== newest.id);
      return left.length ? [{ ...label, strokes: left }] : [];
    }));
  }, [setLabels, setStrokes]);

  const clear = useCallback(() => {
    setStrokes([]); setLabels([]); setPicked([]); setReading(null); setReply(null);
    said.current = "";
  }, [setLabels, setStrokes]);

  const obey = useCallback((sentence: string) => {
    const command = commandIn(sentence);
    if (command === "open") setOpen(true);
    if (!open) return;
    if (command === "read") { clearTimeout(pause.current); void read(); }
    if (command === "back") void answerInInk();
    if (command === "build") void build();
    if (command === "undo") undo();
    if (command === "clear") clear();
    if (command === "close") setOpen(false);
  }, [answerInInk, build, clear, open, read, undo]);

  const lastSentence = useRef("");
  const finished = (sentence: string) => {
    lastSentence.current = sentence;
    said.current = `${said.current} ${sentence}`.trim().slice(-SAID_MAX);
    if (open && now.current.picked.length && !clausesIn(sentence).length && !commandIn(sentence)) {
      nameDrawing(crypto.randomUUID(), sentence.replace(/[.!?]+$/, ""), Date.now());
    }
    obey(sentence);
  };

  // Words as they're heard: each "this is ..." names the drawing around that moment, growing as the person talks.
  const heard = useRef({ words: "", names: [] as { id: string; at: number }[] });
  useBrickEvent(on, "words", words => {
    if (words) {
      heard.current.words = words;
      if (!open) return;
      clausesIn(words).forEach((text, index) => {
        const names = heard.current.names;
        names[index] ??= { id: crypto.randomUUID(), at: Date.now() };
        if (text) nameDrawing(names[index].id, text, names[index].at);
      });
      return;
    }
    const sentence = heard.current.words;
    heard.current = { words: "", names: [] };
    if (sentence) finished(sentence);
  });
  // A typed sentence, or one the mic didn't give word by word here, counts the same.
  useBrickEvent(on, "landed", event => {
    const text = event.mine ? map.thoughts.find(thought => thought.id === event.thoughtId)?.text : null;
    if (!text || plainWords(text) === plainWords(lastSentence.current)) return;
    if (open) clausesIn(text).forEach(name => { if (name) nameDrawing(crypto.randomUUID(), name, Date.now()); });
    finished(text);
  });

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    addEventListener("keydown", closeOnEscape);
    return () => removeEventListener("keydown", closeOnEscape);
  }, [open]);

  if (!open) return <button className="draw-open" onClick={() => setOpen(true)} aria-label="Open the drawing sheet">Draw</button>;
  return <div className={seeThrough ? "draw-sheet draw-see-through" : "draw-sheet"} ref={sheet} style={{ bottom: barHeight }}>
    <div className={reply ? "draw-page draw-page-shared" : "draw-page"}>
    <InkSheet
      strokes={strokes} tool={tool}
      onStroke={stroke => {
        setStrokes(old => [...old, stroke]);
        // A name said just before drawing waits for the drawing.
        setLabels(old => old.map(label => label.strokes.length ? label : { ...label, strokes: [stroke.id] }));
        if (following) followNext();
      }}
      onLoop={loop => { setPicked(pickedBy(loop, now.current.strokes)); setTool("pen"); }}
    />
    <Notes strokes={strokes} labels={labels} picked={picked} reading={reading} onForget={id => setLabels(old => old.filter(label => label.id !== id))} />
    </div>
    <Answers reading={reading} reply={reply} looking={busy === "reading"} />
    <div className="draw-tools" role="toolbar" aria-label="Drawing">
      <button aria-pressed={tool === "pen"} onClick={() => setTool("pen")}>Pen</button>
      <button aria-pressed={tool === "lasso"} onClick={() => setTool("lasso")}>Lasso</button>
      <button aria-pressed={seeThrough} onClick={() => setSeeThrough(value => !value)}>See through</button>
      <button aria-pressed={following} onClick={() => setFollowing(value => !value)}>Read along</button>
      <button onClick={undo} disabled={!strokes.length}>Undo</button>
      <button onClick={clear} disabled={!strokes.length}>Clear</button>
      <form onSubmit={event => {
        event.preventDefault();
        const text = typed.trim();
        if (text) { nameDrawing(crypto.randomUUID(), text, Date.now()); setTyped(""); }
      }}>
        <input value={typed} onChange={event => setTyped(event.target.value)} placeholder="Name what you drew" aria-label="Name what you drew" />
      </form>
      <button className="draw-ask-spark" onClick={() => void read()} disabled={!strokes.length || busy !== ""}>{busy === "reading" ? "Reading…" : "Read it"}</button>
      <button className="draw-ask-spark" onClick={() => void answerInInk()} disabled={!strokes.length || !!reply?.waiting}>Draw back</button>
      <button className="draw-ask-spark" onClick={() => void build()} disabled={!strokes.length}>Build it</button>
      <button onClick={() => setOpen(false)}>Close</button>
    </div>
  </div>;
}
