import { useEffect, useMemo, useRef, useState } from "react";
import type { BrickProps } from "../contract";
import { useAnchor } from "./anchor";
import { Example } from "./Example";
import { Reply } from "./Reply";
import { mapSources, readMap, type Reading } from "./reading";
import style from "./canvas-buddy.css?inline";

export default function CanvasBuddy(props: BrickProps) {
  return <BuddyVisit key={`${props.map.visitKey ?? props.map.mapIdentity ?? "visit"}:${props.map.me}`} {...props} />;
}

function BuddyVisit({ map, actions }: BrickProps) {
  const sources = useMemo(() => mapSources(map), [map.thoughts, map.threads]);
  const current = useRef(sources);
  current.current = sources;
  const request = useRef<AbortController | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [replied, setReplied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const fresh = !!reading && sources.some(source => source.id === reading.source.id && source.quote === reading.source.quote);
  const anchor = useAnchor(!collapsed && fresh ? reading?.source.id : undefined);
  useEffect(() => () => {
    const pending = request.current;
    request.current = null;
    pending?.abort();
  }, []);

  async function read() {
    if (!sources.length || busy) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setMessage("");
    const timeout = window.setTimeout(() => controller.abort(), 45000);
    try {
      const result = await readMap(sources, controller.signal);
      if (controller.signal.aborted) return;
      if (!current.current.some(source => source.id === result.source.id && source.quote === result.source.quote)) {
        setMessage("The map changed while I was reading. Read it again when ready."); return;
      }
      setReading(result); setReplied(false);
    } catch (error) {
      if (request.current === controller) setMessage(controller.signal.aborted ? "The reading timed out. You can try again." : error instanceof Error ? error.message : "Couldn't read the map.");
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  }

  function reply(text: string) {
    if (!reading || !fresh || replied) return;
    if (actions.annotate(reading.source.id, reading.source.quote, text)) {
      setReplied(true); setMessage("Reply sent to this thought. Waiting for the map to receive it.");
    } else setMessage("Your reply wasn't sent. Keep it here and try when connected.");
  }

  if (collapsed) return <button className="canvas-buddy-wake" type="button" onClick={() => setCollapsed(false)}>● Canvas buddy</button>;
  return <aside className="canvas-buddy" aria-label="Canvas buddy">
    <button className="canvas-buddy-hide" type="button" aria-label="Tuck canvas buddy away" onClick={() => setCollapsed(true)}>−</button>
    {reading ? <>
      <span ref={anchor.bead} className="canvas-buddy-live-bead" data-visible={anchor.visible} aria-hidden="true"><i /></span>
      <div ref={anchor.note} className="canvas-buddy-note" data-anchored={anchor.visible}>
        <div className="canvas-buddy-heading"><span>CANVAS BUDDY</span><span className="canvas-buddy-label">Muse Spark · your map</span></div>
        <p className="canvas-buddy-line" role="status">{fresh ? reading.line : "This thought changed. Let's read again."}</p>
        <button className="canvas-buddy-source" type="button" disabled={!fresh} onClick={() => actions.openThought(reading.source.id)}>
          {anchor.visible ? "↗" : "Open source ↗"} {reading.source.title}
        </button>
        {!replied && <Reply key={reading.source.id + reading.line} answers={reading.answers} onReply={reply} disabled={!fresh} />}
        <div className="canvas-buddy-footer"><button type="button" onClick={() => { setReading(null); setMessage(""); }}>Example</button>
          <button type="button" disabled={busy || !sources.length} onClick={() => void read()}>{busy ? "Reading…" : "Notice another thing ↗"}</button></div>
        {message && <p className="canvas-buddy-message" role="status">{message}</p>}
      </div>
    </> : <div className="canvas-buddy-home">
      <Example onRead={() => void read()} canRead={!!sources.length} busy={busy} />
      {message && <p className="canvas-buddy-message" role="status">{message}</p>}
    </div>}
  </aside>;
}

export const styles = style;
