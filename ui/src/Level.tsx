import { useEffect, useRef, useState, type CSSProperties } from "react";
import { onReading } from "./apps-audio";
import type { MiniApp } from "./apps-core";
import "./level.css";

// `?level` in the address (App.tsx): every loudness reading the core receives, big, so a minute of talk on the
// recording mic (normal, raised, shout) gives the three voices in apps.rs. Loaded only with the flag.

// A reading arrives every 320 ms while the mic is on (apps-audio.ts).
const READING_MS = 320;
// 10 s on the chart: a 3 s loud stretch (the Volume watcher's) with room around it, and long enough to see the
// browser's auto gain pull a raised voice back down.
const SHOWN = Math.ceil(10_000 / READING_MS);
// Under the lowest level an app can use (0.01, composition_schema in apps.rs) is quiet.
const QUIET = 0.01;
// About a second: quiet this long ends a stretch (longer than a breath between sentences, shorter than the pause
// between voices the test asks for), and a stretch shorter than this (a cough) isn't a voice to measure.
const SECOND = Math.round(1000 / READING_MS);
// The test's three voices.
const KEPT = 3;

type Stretch = { typical: number; seconds: number };

function stretchOf(readings: number[]): Stretch {
  const sorted = [...readings].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  // The median, as apps.rs's voices were measured: a reading at the voice's usual level, short dips included.
  const typical = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return { typical, seconds: (readings.length * READING_MS) / 1000 };
}

// Log scale from 0.01 to 1, as audio meters show loudness, so normal speech, a raised voice and a shout each get room.
const height = (level: number) => `${Math.min(1, Math.max(0, (Math.log10(level) + 2) / 2)) * 100}%`;
const shown = (level: number) => level.toFixed(3);

export default function LevelMeter({ apps }: { apps: MiniApp[] }) {
  const [readings, setReadings] = useState<{ n: number; level: number }[]>([]);
  const [current, setCurrent] = useState<Stretch | null>(null);
  const [stretches, setStretches] = useState<Stretch[]>([]);
  const [live, setLive] = useState(false);
  const voice = useRef<number[]>([]);
  useEffect(() => {
    let n = 0;
    let quiet = 0;
    let stale: number | undefined;
    const close = () => {
      const spoken = voice.current.slice(0, voice.current.length - quiet);
      if (spoken.length >= SECOND) setStretches((kept) => [stretchOf(spoken), ...kept].slice(0, KEPT));
      voice.current = [];
      quiet = 0;
      setCurrent(null);
    };
    const stop = onReading((level) => {
      setLive(true);
      window.clearTimeout(stale);
      // A second of missed readings: the mic is off or the connection dropped, so the stretch is over.
      stale = window.setTimeout(() => { setLive(false); close(); }, READING_MS * (SECOND + 1));
      setReadings((chart) => [...chart.slice(1 - SHOWN), { n: n++, level }]);
      quiet = level < QUIET ? quiet + 1 : 0;
      if (level >= QUIET || voice.current.length) voice.current.push(level);
      if (quiet >= SECOND && voice.current.length) close();
      else if (voice.current.length > quiet) setCurrent(stretchOf(voice.current.slice(0, voice.current.length - quiet)));
    });
    return () => { stop(); window.clearTimeout(stale); };
  }, []);

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
    <p className="level-help">Typical reading of each stretch of talk. Talk normally, pause, raise your voice, pause, then shout.</p>
  </aside>;
}
