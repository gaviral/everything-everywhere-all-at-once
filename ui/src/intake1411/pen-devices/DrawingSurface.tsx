import { useEffect, useRef, useState } from "react";
import type { InputDevice, OriginalStroke } from "./contracts";
import { captureStroke } from "./capture-stroke";

export function StrokeMarks({ strokes }: { strokes: readonly OriginalStroke[] }) {
  return <svg viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true">
    {strokes.map(stroke => <polyline key={stroke.id} data-stroke-id={stroke.id}
      points={stroke.points.map(point => `${point.x * 1000},${point.y * 600}`).join(" ")} />)}
  </svg>;
}

export function DrawingSurface({ device, sessionId, complete }: {
  device: InputDevice; sessionId: string; complete: (stroke: OriginalStroke) => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<OriginalStroke | null>(null);
  const [canceled, setCanceled] = useState(false);
  useEffect(() => captureStroke(surface.current!, { device, sessionId,
    draft: stroke => { setDraft(stroke); if (stroke) setCanceled(false); }, complete,
    cancel: () => setCanceled(true) }), [device, sessionId, complete]);
  return <>
    <div className="pen-drawing" ref={surface} data-capture={device} role="img"
      aria-label={`${device === "pointer" ? "Mouse or pen" : "Touch"} drawing surface`}
      style={{ touchAction: device === "touch" ? "none" : "auto" }}>
      {draft ? <StrokeMarks strokes={[draft]} /> : <span>Draw here → selected session</span>}
    </div>
    {canceled && <p role="status">Unfinished stroke canceled. Draw again when ready.</p>}
  </>;
}
