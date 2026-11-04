import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { BrickProps } from "../contract";
import { READING_MS, SECOND, splitTalk, calibrationSession, exportCalibration, type CalibrationReceipt, type MicMetadata, type VoiceLabel, type Stretch } from "./stretches";
import "./level.css";

// `?level` in the address (brick.json's flag), or its switch in the Catalog: every loudness reading the core receives,
// big, with explicit local calibration capture. No mic is opened here. Its code loads only once it is on.

// 10 s on the chart: a 3 s loud stretch (the Volume watcher's) with room around it, and long enough to see the
// browser's auto gain pull a raised voice back down.
const SHOWN = Math.ceil(10_000 / READING_MS);
// The test's three voices, and two more: in a room with talk in it, that talk can make a stretch of its own (after
// the shout, say), which would otherwise push the first voice off.
const KEPT = 5;

// Log scale from 0.01 to 1, as audio meters show loudness, so normal speech, a raised voice and a shout each get room.
const height = (level: number) => `${Math.min(1, Math.max(0, (Math.log10(level) + 2) / 2)) * 100}%`;
const shown = (level: number) => level.toFixed(3);

export default function LevelMeter({ map, on }: BrickProps) {
  const apps = map.apps;
  const [readings, setReadings] = useState<{ n: number; level: number }[]>([]);
  const [current, setCurrent] = useState<Stretch | null>(null);
  const [stretches, setStretches] = useState<Stretch[]>([]);
  const [live, setLive] = useState(false);
  const session = useRef<ReturnType<typeof calibrationSession> | null>(null);
  const [metadata, setMetadata] = useState<MicMetadata>({ build: "", microphone: "", browser: "", distanceCm: 30,
    processing: { echoCancellation: "unknown", noiseSuppression: "unknown", autoGainControl: "unknown" } });
  const [origin, setOrigin] = useState<CalibrationReceipt["origin"]>("recording-mic");
  const [collecting, setCollecting] = useState(false);
  const [active, setActive] = useState<VoiceLabel | null>(null);
  const [label, setLabel] = useState<VoiceLabel>("normal");
  const [runs, setRuns] = useState<{ label: VoiceLabel; typical: number; durationMs: number }[]>([]);
  const [receipt, setReceipt] = useState<CalibrationReceipt | null>(null);
  const [message, setMessage] = useState("");
  const attempt = (work: () => void) => { try { work(); setMessage(""); } catch (error) { setMessage(String(error)); } };
  const cancelSample = () => { session.current?.cancelRun(); setActive(null); };
  const reset = () => { session.current?.reset(); session.current = null; setCollecting(false); setActive(null); setRuns([]); setReceipt(null); setMessage(""); };
  useEffect(() => {
    let n = 0;
    let stale: number | undefined;
    const split = splitTalk((stretch) => setStretches((kept) => [stretch, ...kept].slice(0, KEPT)));
    const stop = on("loudness", (level) => {
      setLive(true);
      window.clearTimeout(stale);
      // A second of missed readings: the mic is off or the connection dropped, so the stretch is over.
      stale = window.setTimeout(() => {
        setLive(false); split.end(); setCurrent(null);
        session.current?.cancelRun(); setActive(null);
        setMessage("Readings stopped. Any active sample was cancelled; restart it after reconnecting.");
      }, READING_MS * (SECOND + 1));
      setReadings((chart) => [...chart.slice(1 - SHOWN), { n: n++, level }]);
      try { session.current?.feed(level, Date.now()); }
      catch (error) { session.current?.cancelRun(); setActive(null); setMessage(String(error)); }
      split.feed(level);
      setCurrent(split.current());
    });
    return () => { stop(); window.clearTimeout(stale); session.current?.cancelRun(); };
  }, [on]);

  const volumeApps = apps.flatMap((app) => app.watcher.kind === "volume" ? [{ id: app.id, name: app.name, level: app.watcher.level, on: app.enabled }] : []);
  // Readings at or above the lowest level of a volume app that's on show in the accent color: loud enough to count.
  const loud = Math.min(...volumeApps.filter((app) => app.on).map((app) => app.level));
  const latest = live ? readings.at(-1)?.level : undefined;
  return <aside className="level-meter" aria-label="Level meter">
    <div className="level-head"><strong>Level</strong><span>{live ? "what the core hears" : "no readings: mic off or not connected"}</span></div>
    <div className={latest !== undefined && latest >= loud ? "level-now loud" : "level-now"}>{latest === undefined ? "–" : shown(latest)}</div>
    <div className="level-chart" aria-hidden="true" style={{ "--shown": SHOWN } as CSSProperties}>
      {readings.map(({ n, level }) => <i key={n} className={level >= loud ? "loud" : undefined} style={{ height: height(level) }} />)}
      {volumeApps.map((app) => <div key={app.id} className={app.on ? "level-line" : "level-line off"} style={{ bottom: height(app.level) }}>
        <span>{app.name} {app.level}{app.on ? "" : " (off)"}</span>
      </div>)}
    </div>
    {(current || stretches.length > 0) && <ol className="level-stretches">
      {current && <li className="current"><span>{shown(current.typical)}</span><small>now · {Math.round(current.seconds)} s</small></li>}
      {stretches.map((stretch, i) => <li key={i}><span>{shown(stretch.typical)}</span><small>{Math.round(stretch.seconds)} s</small></li>)}
    </ol>}
    <p className="level-help">Inferred talk stretches above are a guide, not calibration evidence.</p>
    <details className="level-calibration">
      <summary>Recording-mic calibration · pending</summary>
      <p>Use the existing mic button first. This tool only collects numeric readings already arriving here.
        Keep the same mic, distance and settings throughout. No audio or transcripts are exported.</p>
      <fieldset disabled={collecting || receipt !== null}>
        <legend>Recording setup</legend>
        <label>Input provenance<select value={origin} onChange={event => setOrigin(event.target.value as CalibrationReceipt["origin"])}>
          <option value="recording-mic">Actual recording microphone</option><option value="synthetic">Synthetic / test input (not calibration proof)</option>
        </select></label>
        {(["build", "microphone", "browser"] as const).map(key => <label key={key}>
          {key === "build" ? "Build identity (commit + local changes, if any)" : key === "microphone" ? "Mic model / input" : "Browser + version"}
          <input value={metadata[key]} onChange={event => setMetadata({ ...metadata, [key]: event.target.value })} />
        </label>)}
        <label>Distance (cm)<input type="number" min="1" max="1000" value={metadata.distanceCm}
          onChange={event => setMetadata({ ...metadata, distanceCm: Number(event.target.value) })} /></label>
        {(["echoCancellation", "noiseSuppression", "autoGainControl"] as const).map(key => <label key={key}>
          {{ echoCancellation: "Echo cancellation", noiseSuppression: "Noise suppression", autoGainControl: "Auto gain control" }[key]}
          <select value={metadata.processing[key]} onChange={event => setMetadata({ ...metadata,
            processing: { ...metadata.processing, [key]: event.target.value } })}>
            <option value="unknown">Unknown</option><option value="on">On</option><option value="off">Off</option>
          </select>
        </label>)}
      </fieldset>
      {!collecting && !receipt && <button disabled={!live} onClick={() => attempt(() => {
        session.current = calibrationSession(metadata, Date.now(), origin); setCollecting(true); setRuns([]);
      })}>Start calibration</button>}
      {collecting && <>
        <p>Collect at least 10 seconds each of normal, raised and loud speech. Choose the label yourself;
          pause between samples. Calibration remains pending after export.</p>
        <label>Next sample<select value={label} disabled={active !== null} onChange={event => setLabel(event.target.value as VoiceLabel)}>
          <option value="normal">Normal</option><option value="raised">Raised</option><option value="loud">Loud</option>
        </select></label>
        {active ? <>
          <p role="status">Collecting {active} · numeric readings only</p>
          <button onClick={() => attempt(() => {
            const run = session.current!.finishRun(Date.now()); setRuns(previous => [...previous, run]); setActive(null);
          })}>Finish sample</button>
          <button onClick={cancelSample}>Cancel sample</button>
        </> : <button disabled={!live} onClick={() => attempt(() => { session.current!.startRun(label, Date.now()); setActive(label); })}>Start sample</button>}
        <button disabled={active !== null} onClick={() => attempt(() => {
          setReceipt(session.current!.finish(Date.now())); setCollecting(false);
        })}>Finish calibration</button>
      </>}
      {runs.length > 0 && <ul>{runs.map((run, i) => <li key={i}>{run.label}: {(run.durationMs / 1000).toFixed(1)} s · typical {shown(run.typical)}</li>)}</ul>}
      {receipt && <>
        <p>Finished locally. Save outside the app repository; review setup labels before sharing privately.</p>
        <button onClick={() => attempt(() => exportCalibration(receipt, json => {
          const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
          const link = document.createElement("a"); link.href = url; link.download = "volume-calibration-private.json";
          link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
        }))}>Export private JSON</button>
      </>}
      {(collecting || receipt) && <button onClick={reset}>Reset calibration</button>}
      <p role="status">{message}</p>
      <p>Only Export saves a file. Reset or closing this tool discards its in-memory receipt. No upload or journal persistence.</p>
    </details>
  </aside>;
}
