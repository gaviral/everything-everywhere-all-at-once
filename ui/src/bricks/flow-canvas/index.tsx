import { useEffect, useRef, useState } from "react";
import { useBrickEvent, type BrickProps } from "../contract";
import "./flow-canvas.css";

type Step = { id: string; name: string; prompt: string };
type Pipeline = { id: string; name: string; steps: Step[] };
type Result = { text: string; input: string; status: "waiting" | "running" | "done" | "failed"; ms: number; error?: string };
const duration = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
function endpoint(path: string) {
  const url = new URL(path, location.origin);
  const room = new URLSearchParams(location.search).get("room");
  if (room) url.searchParams.set("room", room);
  return url;
}
async function request(path: string, body?: unknown) {
  const response = await fetch(endpoint(path), body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Core returned ${response.status}`);
  const value = await response.json();
  if (value.error) throw new Error(value.error);
  return value;
}
function fromLink(): Pipeline | null {
  try {
    const encoded = new URLSearchParams(location.hash.slice(1)).get("flow");
    if (!encoded) return null;
    const p = JSON.parse(decodeURIComponent(escape(atob(encoded))));
    if (typeof p.id !== "string" || typeof p.name !== "string" || !Array.isArray(p.steps) || !p.steps.length || p.steps.length > 6) return null;
    if (!p.steps.every((s: Step) => typeof s.id === "string" && typeof s.name === "string" && typeof s.prompt === "string")) return null;
    return p;
  } catch { return null; }
}
export default function FlowCanvas({ map, actions, on }: BrickProps) {
  const [open, setOpen] = useState(true);
  const [pipeline, setPipeline] = useState<Pipeline | null>(fromLink);
  const [command, setCommand] = useState("");
  const [input, setInput] = useState("");
  const [results, setResults] = useState<Result[][]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Describe what you want to make.");
  const [error, setError] = useState("");
  const [changed, setChanged] = useState<string[]>([]);
  const [library, setLibrary] = useState<Pipeline[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  useBrickEvent(on, "notice", event => { if (event.kind === "error") { setError(event.text); setListening(false); } });
  const busyRef = useRef(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const actNow = useRef<(text: string) => void>(() => {});
  const commandRef = useRef<HTMLTextAreaElement>(null);
  const active = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; active.current?.abort(); }; }, []);
  const markBusy = (value: boolean) => { busyRef.current = value; setBusy(value); };
  const refreshLibrary = async () => { try { const r = await request("/flow/library"); if (alive.current) setLibrary(r.flows); } catch (e) { if (alive.current) setError(String(e)); } };
  useEffect(() => { void refreshLibrary(); }, []);
  useEffect(() => {
    if (!open) return;
    const url = endpoint("/flow/turns"); url.searchParams.set("name", map.me);
    const source = new EventSource(url);
    source.onopen = () => setVoiceReady(true);
    source.onerror = () => setVoiceReady(false);
    source.onmessage = event => { try { const value = JSON.parse(event.data); if (typeof value.text === "string") actNow.current(value.text); } catch { setError("Couldn't read the incoming turn. Say it again."); } };
    return () => { source.close(); setVoiceReady(false); };
  }, [open, map.me, map.visitKey]);
  useEffect(() => {
    if (!changed.length) return;
    const timeout = window.setTimeout(() => setChanged([]), 6000);
    return () => clearTimeout(timeout);
  }, [changed]);

  async function execute(p: Pipeline, source: string, count = 1) {
    if (!source.trim()) { setTesting(true); setNotice("Ready. Say or type the text to test."); return; }
    markBusy(true); setTesting(false); setError(""); setNotice(count === 2 ? "Two versions. Same input, different takes." : "Your words are moving through the pipeline.");
    const controller = new AbortController(); active.current = controller;
    const rows: Result[][] = Array.from({ length: count }, () => p.steps.map(() => ({ text: "", input: "", status: "waiting", ms: 0 })));
    setResults(rows.map(row => row.map(r => ({ ...r }))));
    const update = () => { if (alive.current) setResults(rows.map(row => row.map(r => ({ ...r })))); };
    let failed = false;
    try {
      await Promise.all(rows.map(async (row, lane) => {
        let previous = source;
        for (let i = 0; i < p.steps.length; i++) {
          const r = row[i]; r.input = previous; r.status = "running"; update();
          const started = performance.now();
          const clock = window.setInterval(() => { r.ms = performance.now() - started; update(); }, 100);
          try {
            const response = await fetch(endpoint("/flow/run"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: p.steps[i].prompt, input: previous, variant: lane + 1 }), signal: controller.signal });
            if (!response.ok || !response.body) throw new Error(`Core returned ${response.status}`);
            if (!response.headers.get("content-type")?.includes("ndjson")) { const v = await response.json(); throw new Error(v.error || "No stream returned"); }
            const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = "", done = false;
            while (true) {
              const chunk = await reader.read();
              pending += decoder.decode(chunk.value, { stream: !chunk.done });
              const lines = pending.split("\n"); pending = lines.pop() || "";
              for (const line of lines.filter(Boolean)) {
                const event = JSON.parse(line);
                if (event.error) throw new Error(event.error);
                if (event.delta) r.text += event.delta;
                r.ms = event.ms ?? performance.now() - started;
                if (event.done) done = true;
                update();
              }
              if (chunk.done) break;
            }
            if (!done) throw new Error("The stream ended early");
            window.clearInterval(clock); r.status = "done"; previous = r.text; update();
          } catch (e) {
            window.clearInterval(clock); r.status = "failed"; r.ms = performance.now() - started; r.error = String(e); failed = true; update(); break;
          }
        }
      }));
      if (alive.current) setNotice(failed ? "A box failed. Its later boxes did not run." : "Run complete. Open any box to see its prompt and exact input.");
    } finally { if (alive.current) markBusy(false); active.current = null; }
  }
  async function build(text: string) {
    markBusy(true); setError(""); setNotice(pipeline ? "Spark is changing the pipeline…" : "Spark is making your pipeline…");
    try {
      const response = await request("/flow/plan", { command: text, current: pipeline, selected });
      if (!alive.current) return;
      const p: Pipeline = response.pipeline;
      setChanged(p.steps.filter(s => !pipeline?.steps.some(old => old.id === s.id && old.name === s.name && old.prompt === s.prompt)).map(s => s.id));
      setPipeline(p); setSaved(false); setResults([]); setNotice(`Pipeline ${pipeline ? "updated" : "ready"} · ${duration(response.ms)} · Muse Spark`);
      markBusy(false);
      if (input.trim() && pipeline) await execute(p, input, results.length || 1);
    } catch (e) { if (alive.current) { setError(String(e)); setNotice("Your pipeline is kept. Try the command again."); } }
    finally { if (alive.current) markBusy(false); }
  }
  async function act(raw: string) {
    const text = raw.trim(); if (!text) return;
    if (busyRef.current) { setError("A run is in progress. Wait for it to finish, then say that again."); return; }
    setCommand(""); setError("");
    const normal = text.toLowerCase().replace(/[.!?,]/g, "").trim();
    if (pipeline && /^(open|show|expand) (the )?.+ box$/.test(normal)) {
      const name = normal.replace(/^(open|show|expand) (the )?/, "").replace(/ box$/, "");
      const box = pipeline.steps.find(s => s.name.toLowerCase().replace(/-/g, " ").includes(name));
      if (box) { setSelected(box.id); setNotice(`${box.name} is open. Change its prompt or tell Spark what to change.`); } else setError("I couldn't find that box.");
    } else if (pipeline && /^(close|collapse)( the)?( box)?$/.test(normal)) { setSelected(null); }
    else if (pipeline && /^(let['’]?s test( it)?|test( it)?|run( it)?)$/.test(normal)) { setTesting(true); setNotice("Ready. Say or type the text to test."); }
    else if (pipeline && /^(show( me)?|make|run)( )?(two|2) (versions|variants)$/.test(normal)) { await execute(pipeline, input, 2); }
    else if (pipeline && /^(save|save it|save (the )?pipeline)$/.test(normal)) { await save(); }
    else if (pipeline && (testing || /^(test|run) (with|on|this)[: ]/.test(normal))) {
      const source = testing ? text : text.replace(/^(test|run) (with|on|this)[: ]+/i, "");
      setInput(source); await execute(pipeline, source);
    } else { await build(text); }
  }
  async function save() {
    if (!pipeline) return;
    try { await request("/flow/library", pipeline); setSaved(true); setNotice("Saved. Reopen it from Saved pipelines."); await refreshLibrary(); }
    catch (e) { setError(String(e)); }
  }
  async function share() {
    if (!pipeline) return;
    const url = new URL(location.href); url.searchParams.set("flow", "");
    url.hash = new URLSearchParams({ flow: btoa(unescape(encodeURIComponent(JSON.stringify(pipeline)))) }).toString();
    try { await navigator.clipboard.writeText(url.href); setNotice("Link copied. It contains the pipeline prompts; test text stays here."); }
    catch { setError("Clipboard unavailable. Save the pipeline and reopen it from this browser."); }
  }
  actNow.current = text => { void act(text); };
  const toggleMic = () => { actions.listen(!listening); setListening(!listening); };
  if (!open) return <button className="flow-canvas-launch" onClick={() => setOpen(true)}>Open Flow</button>;
  return <section className="flow-canvas" aria-label="Flow pipeline builder">
    <div className="flow-canvas-top">
      <div className="flow-canvas-brand">Flow <span>Talk it into being.</span></div>
      <div className="flow-canvas-tools">
        <span className="flow-canvas-model"><i /> Muse Spark</span>
        <button onClick={() => { setLibraryOpen(!libraryOpen); void refreshLibrary(); }}>Saved pipelines</button>
        {pipeline && <><button disabled={busy} onClick={() => void save()}>{saved ? "Saved ✓" : "Save"}</button><button onClick={() => void share()}>Share</button></>}
        <button aria-label="Close Flow" onClick={() => setOpen(false)}>×</button>
      </div>
    </div>
    {libraryOpen && <div className="flow-canvas-library"><strong>Saved pipelines</strong>{library.length ? library.map(p => <button key={p.id} disabled={busy} onClick={() => { setPipeline(p); setResults([]); setSelected(null); setSaved(true); setLibraryOpen(false); setNotice("Pipeline reopened. Ready to test."); }}>{p.name}<span>{p.steps.length} boxes</span></button>) : <p>Save a pipeline to find it here.</p>}<button onClick={() => setLibraryOpen(false)}>Close</button></div>}
    <div className="flow-canvas-body">
      <div className="flow-canvas-title"><p>BUILD BY CONVERSATION</p><h1>{pipeline?.name || "An idea. Then a living pipeline."}</h1><p className="flow-canvas-status" role="status">{notice}</p>{error && <p className="flow-canvas-error" role="alert">{error}</p>}</div>
      {!pipeline ? <div className="flow-canvas-empty"><div className="flow-canvas-sketch" aria-hidden="true"><span>01</span><b>→</b><span>02</span><b>→</b><span>03</span></div><p>Say what each step should do.<br />Watch Spark make the pieces.</p><button disabled={busy} onClick={() => void act("Make a pipeline: fix the grammar, then enrich it, then red-team it.")}>Try grammar → enrich → red team</button></div> : <>
        <div className="flow-canvas-source"><label htmlFor="flow-input">YOUR INPUT</label><textarea id="flow-input" value={input} onChange={e => setInput(e.target.value)} placeholder={testing ? "Listening for your test text… or type it here." : "Say ‘let’s test it’, or type the text to send through."} /><div><button disabled={busy || !input.trim()} onClick={() => void execute(pipeline, input)}>Run pipeline →</button><button disabled={busy || !input.trim()} onClick={() => void execute(pipeline, input, 2)}>Two versions</button></div></div>
        <div className="flow-canvas-grid" style={{ "--flow-count": pipeline.steps.length } as React.CSSProperties}>
          {pipeline.steps.map((step, index) => <article key={step.id} className={`flow-canvas-box ${results.length === 2 ? "flow-canvas-pair" : ""} ${changed.includes(step.id) ? "flow-canvas-changed" : ""} ${selected === step.id ? "flow-canvas-selected" : ""}`}>
            <button className="flow-canvas-box-head" onClick={() => setSelected(selected === step.id ? null : step.id)} aria-expanded={selected === step.id}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step.name}</strong><b>{selected === step.id ? "−" : "+"}</b></button>
            {selected === step.id && <div className="flow-canvas-inspect"><label>Prompt<textarea aria-label={`${step.name} prompt`} disabled={busy} value={step.prompt} onChange={e => { setPipeline({ ...pipeline, steps: pipeline.steps.map(s => s.id === step.id ? { ...s, prompt: e.target.value } : s) }); setSaved(false); }} /></label><p><b>Input</b> {index === 0 ? "Your original text" : `Output of ${pipeline.steps[index - 1].name}`}</p><p><b>Control flow</b> Runs once after its input is ready. A failure stops this version.</p><button disabled={busy || !input.trim()} onClick={() => void execute(pipeline, input, results.length || 1)}>Apply & rerun same input</button></div>}
            {(results.length ? results : [[]]).map((row, lane) => { const r = row[index]; return <div className="flow-canvas-result" key={lane}>
              {results.length === 2 && <p className="flow-canvas-version">VERSION {lane + 1}</p>}
              <div className={`flow-canvas-run-state ${r?.status === "running" ? "flow-canvas-running" : ""}`}><span>{r ? ({ waiting: "Waiting for input", running: "Running…", done: "Complete", failed: "Failed" }[r.status]) : "Ready"}</span>{r && r.status !== "waiting" && <time>{duration(r.ms)}</time>}</div>
              <div className="flow-canvas-output">{r?.text || (!r ? "Its output will appear here." : r.status === "running" ? "Spark is working…" : "")}</div>
              {r?.error && <p className="flow-canvas-error">{r.error}</p>}
              {selected === step.id && r?.input && <details className="flow-canvas-exact-input"><summary>Exact input · version {lane + 1}</summary><p>{r.input}</p></details>}
            </div>; })}
          </article>)}
        </div>
      </>}
    </div>
    <div className="flow-canvas-bottom">
      {map.partial && <p className="flow-canvas-heard" aria-live="polite">{map.partial}</p>}
      <form className="flow-canvas-command" onSubmit={e => { e.preventDefault(); void act(command); }}>
        <button className={`flow-canvas-mic ${listening ? "flow-canvas-listening" : ""}`} type="button" disabled={!voiceReady} onClick={toggleMic} aria-pressed={listening}>{listening ? "Stop mic" : "Use voice"}</button>
        <textarea ref={commandRef} aria-label="Tell Spark what to build or change" value={command} onChange={e => setCommand(e.target.value)} placeholder={pipeline ? "Open the enrich box. Make it shorter. Add a tweet after red team…" : "Make a pipeline: fix the grammar, then enrich it, then red-team it."} rows={1} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void act(command); } }} />
        <button disabled={busy || !command.trim()} type="submit">{busy ? "Working…" : "Send ↑"}</button>
      </form>
      <p className="flow-canvas-hint">{listening ? "Speak a command, then pause." : (voiceReady ? "Type or turn on voice." : "Type while the voice connection opens.")} Every box runs on Muse Spark. Times are measured live.</p>
    </div>
  </section>;
}
