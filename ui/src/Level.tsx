import { useEffect, useState, type CSSProperties } from "react";
import { onReading } from "./apps-audio";
import type { MiniApp } from "./apps-core";
import { READING_MS, SECOND, splitTalk, type Stretch } from "./level-stretches";
import "./level.css";

// `?level` in the address (App.tsx): every loudness reading the core receives, big, so a minute of talk on the
// recording mic (normal, raised, shout) gives the three voices in apps.rs. Loaded only with the flag.

// 10 s on the chart: a 3 s loud stretch (the Volume watcher's) with room around it, and long enough to see the
// browser's auto gain pull a raised voice back down.
const SHOWN = Math.ceil(10_000 / READING_MS);
// The test's three voices, and two more: in a room with talk in it, that talk can make a stretch of its own (after
// the shout, say), which would otherwise push the first voice off.
const KEPT = 5;

// Log scale from 0.01 to 1, as audio meters show loudness, so normal speech, a raised voice and a shout each get room.
const height = (level: number) => `${Math.min(1, Math.max(0, (Math.log10(level) + 2) / 2)) * 100}%`;
const shown = (level: number) => level.toFixed(3);

export default function LevelMeter({ apps }: { apps: MiniApp[] }) {
  const [readings, setReadings] = useState<{ n: number; level: number }[]>([]);
  const [current, setCurrent] = useState<Stretch | null>(null);
  const [stretches, setStretches] = useState<Stretch[]>([]);
  const [live, setLive] = useState(false);
  useEffect(() => {
    let n = 0;
    let stale: number | undefined;
    const split = splitTalk((stretch) => setStretches((kept) => [stretch, ...kept].slice(0, KEPT)));
    const stop = onReading((level) => {
      setLive(true);
      window.clearTimeout(stale);
      // A second of missed readings: the mic is off or the connection dropped, so the stretch is over.
      stale = window.setTimeout(() => { setLive(false); split.end(); setCurrent(null); }, READING_MS * (SECOND + 1));
      setReadings((chart) => [...chart.slice(1 - SHOWN), { n: n++, level }]);
      split.feed(level);
      setCurrent(split.current());
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
    <p className="level-help">Typical reading of each stretch of talk. Talk normally, pause two seconds, raise your voice, pause, then shout.</p>
  </aside>;
}
