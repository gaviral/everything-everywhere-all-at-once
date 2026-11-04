import type { Annotation, Selection, SketchSession, TimeSpan } from './contracts';

export function timeText(time: TimeSpan | null): string {
  return time ? `${time.startMs}–${time.endMs} ms` : 'Not supplied';
}
export function targetText(target: Selection): string {
  return target.kind === 'strokes' ? `Marks: ${target.strokeIds.join(', ')}` : `Region: ${target.region.id}`;
}
export function annotationView(annotation: Annotation, session: SketchSession) {
  const { target, strokeTime, reference } = annotation.anchor;
  const missing = target.kind === 'strokes' ? target.strokeIds.filter(id => !session.strokes.some(stroke => stroke.id === id)) : [];
  return {
    id: annotation.id,
    label: annotation.label,
    target,
    targetText: targetText(target),
    strokeTimeText: target.kind === 'region' ? 'No stroke time (region)' : timeText(strokeTime),
    referenceText: reference.text,
    referenceTimeText: timeText(reference.utteranceTime),
    status: missing.length ? `Unresolved: missing marks ${missing.join(', ')}`
      : reference.utteranceTime ? 'Stroke time and reference time are separate.' : 'Reference time is unknown.',
  };
}
