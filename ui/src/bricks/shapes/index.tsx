import { useContext, useRef, useState } from "react";
import { ShapesContext, type ShapeSize } from "../contract";
import "./shapes.css";

export default function ShapesPalette() {
  const shapes = useContext(ShapesContext);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<ShapeSize>({ width: 200, height: 120, radius: 24 });
  const [status, setStatus] = useState("");
  const placeButton = useRef<HTMLButtonElement>(null);
  if (!shapes?.enabled) return null;
  const definition = shapes.definitions[0];
  const instance = shapes.instances.find((shape) => shape.id === selected);
  const size = instance ?? draft;
  return <section className="shapes-palette" aria-label="Shapes palette">
    <strong className="shapes-title">Shapes</strong>
    <p className="shapes-note">This visit only · reload clears rectangles.</p>
    <div className="shapes-definition" data-definition={definition.id}>
      <strong>{definition.name}</strong>
      <figure className="shapes-preview" aria-label="Definition preview">
        <svg className="shapes-preview-svg" viewBox={`-4 -4 ${size.width + 8} ${size.height + 8}`} aria-hidden="true">
          <rect className="shapes-preview-rect" width={size.width} height={size.height} rx={Math.min(size.radius, size.width / 2, size.height / 2)} />
        </svg>
        <figcaption>Definition preview</figcaption>
      </figure>
      <button className="shapes-button" ref={placeButton} type="button" disabled={!shapes.canvasReady} onClick={() => {
        const id = shapes.place(definition.id, size);
        if (id) { setSelected(id); setStatus("Rectangle placed."); }
      }}>Place rectangle</button>
      {!shapes.canvasReady && <p className="shapes-note">Open Canvas to place a rectangle.</p>}
    </div>
    {shapes.instances.length > 1 && <label className="shapes-field">Rectangle
      <select className="shapes-select" value={instance?.id ?? ""} onChange={(event) => setSelected(event.target.value)}>
        <option value="">Next rectangle</option>
        {shapes.instances.map((shape) => <option key={shape.id} value={shape.id}>{shape.id}</option>)}
      </select>
    </label>}
    <fieldset className="shapes-controls">
      <legend>{instance ? `Adjust ${instance.id}` : "Next rectangle"}</legend>
      {([ ["width", "Width", 64, 480], ["height", "Height", 48, 360], ["radius", "Corner radius", 0, Math.floor(Math.min(size.width, size.height) / 2)] ] as const).map(([field, label, min, max]) => <label className="shapes-field" key={field}>
        <span>{label} <output>{size[field]} px</output></span>
        <input className="shapes-range" type="range" min={min} max={max} value={size[field]} onChange={(event) => {
          const next = { ...size, [field]: Number(event.target.value) };
          next.radius = Math.min(next.radius, next.width / 2, next.height / 2);
          if (instance) shapes.update(instance.id, next); else setDraft(next);
        }} />
      </label>)}
    </fieldset>
    {instance && <button className="shapes-button" type="button" onClick={() => {
      shapes.remove(instance.id); setSelected(null); setStatus("Rectangle removed. Definition still available.");
      placeButton.current?.focus();
    }}>Remove rectangle</button>}
    <p className="shapes-note">Drag its Move handle or use arrow keys. No actions or AI.</p>
    <span className="shapes-status" role="status">{status}</span>
  </section>;
}
