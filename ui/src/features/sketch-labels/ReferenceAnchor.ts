import type { Anchor, Selection, SketchSession, SuppliedReference } from './contracts';
import { strokeTime } from './StrokeIdentity';

export function suppliedReference(reference: SuppliedReference): SuppliedReference {
  if (!reference.id.trim() || !reference.text.trim()) throw new Error('Enter the supplied reference.');
  if (reference.source !== 'typed' && reference.source !== 'prerecorded') throw new Error('Use a supplied reference.');
  const time = reference.utteranceTime;
  if (time && (![time.startMs, time.endMs].every(Number.isFinite) || time.startMs < 0 || time.endMs < time.startMs))
    throw new Error('Reference times must be ordered, non-negative milliseconds.');
  return Object.freeze({ ...reference, text: reference.text.trim(), utteranceTime: time ? Object.freeze({ ...time }) : null });
}

export function referenceAnchor(session: SketchSession, target: Selection | null, reference: SuppliedReference): Anchor {
  if (!target) throw new Error('Unresolved target: explicitly select marks or a region.');
  const supplied = suppliedReference(reference);
  return Object.freeze({
    target,
    strokeTime: target.kind === 'strokes' ? strokeTime(session.strokes, target.strokeIds) : null,
    reference: supplied,
    uncertainty: supplied.utteranceTime ? 'separate-times' : 'reference-time-missing',
  });
}
