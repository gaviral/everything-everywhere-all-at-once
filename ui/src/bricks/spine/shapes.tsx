import { useContext, useEffect, useRef } from "react";
import { ViewportPortal, useReactFlow, useStoreApi } from "@xyflow/react";
import { ShapesContext, type ShapeInstance, type Shapes } from "../contract";

/** Presentation objects share the existing camera, but never enter the thought node list or its drag actions. */
export function CanvasShapes() {
  const shapes = useContext(ShapesContext);
  const flow = useReactFlow();
  const store = useStoreApi();
  const attach = shapes?.attachCanvas;
  const enabled = shapes?.enabled;
  useEffect(() => {
    if (!enabled || !attach) return;
    return attach({ placementPoint: () => {
      const box = store.getState().domNode!.getBoundingClientRect();
      return flow.screenToFlowPosition({ x: box.left + box.width * .18, y: box.top + box.height * .65 });
    } });
  }, [enabled, attach, flow, store]);
  if (!shapes?.enabled) return null;
  return <ViewportPortal>{shapes.instances.map((shape) => <Rectangle key={shape.id} shape={shape} shapes={shapes} />)}</ViewportPortal>;
}

function Rectangle({ shape, shapes }: { shape: ShapeInstance; shapes: Shapes }) {
  const flow = useReactFlow();
  const grip = useRef<{ pointer: number; dx: number; dy: number } | null>(null);
  return <div data-shape-id={shape.id} data-definition-id={shape.definitionId} data-x={shape.x} data-y={shape.y}
    style={{ position: "absolute", transform: `translate(${shape.x}px, ${shape.y}px)`, width: shape.width, height: shape.height,
      borderRadius: shape.radius, border: "2px solid var(--accent)", background: "var(--accent-soft)", pointerEvents: "none", zIndex: 15 }}>
    <button type="button" className="nodrag nopan" aria-label={`Move ${shape.id}`} title="Drag to move; arrow keys move 10 px"
      style={{ position: "absolute", top: 8, left: 8, minHeight: 36, padding: "4px 10px", border: "1px solid var(--accent)", borderRadius: 6,
        background: "var(--card)", color: "var(--ink)", font: "inherit", fontSize: 12, pointerEvents: "auto", touchAction: "none", cursor: "grab" }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
        grip.current = { pointer: event.pointerId, dx: point.x - shape.x, dy: point.y - shape.y };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const held = grip.current;
        if (!held || held.pointer !== event.pointerId) return;
        event.stopPropagation();
        const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
        shapes.update(shape.id, { x: point.x - held.dx, y: point.y - held.dy });
      }}
      onPointerUp={() => { grip.current = null; }} onPointerCancel={() => { grip.current = null; }}
      onKeyDown={(event) => {
        const delta: Record<string, [number, number]> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
        const step = delta[event.key];
        if (!step) return;
        event.preventDefault(); event.stopPropagation();
        shapes.update(shape.id, { x: shape.x + step[0], y: shape.y + step[1] });
      }}>Move</button>
  </div>;
}
