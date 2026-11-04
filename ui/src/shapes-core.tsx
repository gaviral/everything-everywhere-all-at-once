import { useCallback, useMemo, useRef, useState } from "react";
import type { ShapeDefinition, ShapeHost, ShapeInstance, ShapeSize, Shapes } from "./bricks/contract";

// One reusable definition; a visit starts with no instances. Nothing is serialized or sent to the core.
const DEFINITIONS: readonly ShapeDefinition[] = Object.freeze([
  Object.freeze({ id: "rounded-rectangle", name: "Rounded rectangle", width: 200, height: 120, radius: 24 }),
]);

export function useShapes(enabled: boolean): Shapes {
  const [instances, setInstances] = useState<readonly ShapeInstance[]>([]);
  const [canvasReady, setCanvasReady] = useState(false);
  const host = useRef<ShapeHost | null>(null);
  const serial = useRef(0);
  const attachCanvas = useCallback((canvas: ShapeHost) => {
    host.current = canvas;
    setCanvasReady(true);
    return () => {
      if (host.current === canvas) { host.current = null; setCanvasReady(false); }
    };
  }, []);
  const place = useCallback((definitionId: ShapeDefinition["id"], size: ShapeSize) => {
    if (!enabled || !host.current || !DEFINITIONS.some((definition) => definition.id === definitionId)) return null;
    const id = `rectangle-${++serial.current}`;
    const point = host.current.placementPoint();
    setInstances((was) => [...was, { id, definitionId, ...size, ...point }]);
    return id;
  }, [enabled]);
  const update = useCallback((id: string, patch: Partial<ShapeSize & { x: number; y: number }>) => {
    setInstances((was) => was.map((shape) => shape.id === id ? { ...shape, ...patch } : shape));
  }, []);
  const remove = useCallback((id: string) => setInstances((was) => was.filter((shape) => shape.id !== id)), []);
  return useMemo(() => ({ enabled, definitions: DEFINITIONS, instances, canvasReady, attachCanvas, place, update, remove }),
    [enabled, instances, canvasReady, attachCanvas, place, update, remove]);
}
