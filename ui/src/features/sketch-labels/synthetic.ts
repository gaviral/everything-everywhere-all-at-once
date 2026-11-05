import type { Annotation, SketchLabelsAdapters, SketchSession } from './contracts';

export function syntheticSketch() {
  let session: SketchSession = { id: 'synthetic-sketch', strokes: [] };
  let counter = 0;
  const listeners = new Set<() => void>();
  const labels = new Map<string, readonly Annotation[]>();
  const adapters: SketchLabelsAdapters = {
    strokes: { read: () => session, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; } },
    annotations: { read: id => labels.get(id) ?? [], replace: (id, annotations) => { labels.set(id, structuredClone(annotations)); } },
    newId: () => `sketch-${++counter}`,
  };
  const drawThree = () => {
    if (session.strokes.length) return;
    session = { ...session, strokes: [
      { id: 'mark-1', points: [{ x: 80, y: 110, atMs: 1000 }, { x: 130, y: 75, atMs: 1100 }, { x: 170, y: 120, atMs: 1200 }] },
      { id: 'mark-2', points: [{ x: 195, y: 165, atMs: 2000 }, { x: 235, y: 125, atMs: 2150 }, { x: 270, y: 175, atMs: 2300 }] },
      { id: 'mark-3', points: [{ x: 445, y: 110, atMs: 3000 }, { x: 490, y: 70, atMs: 3150 }, { x: 535, y: 120, atMs: 3300 }] },
    ] };
    listeners.forEach(listener => listener());
  };
  return { adapters, drawThree };
}
