import type { MapSnapshot } from '../contract';

export type Topic = Readonly<{ id: string; title: string; parent: string | null }>;
export type Point = Readonly<{ id: string; topic: string; text: string }>;
export type Copy = Readonly<{ topics: readonly Topic[]; points: readonly Point[]; example: boolean }>;
export type Kind = 'split' | 'merge' | 'parent';
export type Draft = { source: string; kind: Kind; title: string; points: string[]; target: string };
export type Plan = { before: Copy; after: Copy; label: string; details: string[]; affected: string[] };
export type Planning = { plan: Plan; error?: never } | { error: string; plan?: never };

export const example: Copy = {
  example: true,
  topics: [
    { id: 'launch', title: 'A launch worth sharing', parent: null },
    { id: 'story', title: 'Tell the story', parent: 'launch' },
    { id: 'audience', title: 'Find our first people', parent: null },
  ],
  points: [
    { id: 'p1', topic: 'launch', text: 'Make the first minute feel effortless.' },
    { id: 'p2', topic: 'launch', text: 'Show one transformation people can remember.' },
    { id: 'p3', topic: 'launch', text: 'Invite five teams to try it this week.' },
    { id: 'p4', topic: 'story', text: 'Open with the moment a tangled idea becomes clear.' },
    { id: 'p5', topic: 'audience', text: 'Start with people who think out loud together.' },
  ],
};

/** Copy only what this rehearsal displays; never mutate the host snapshot. */
export function copyMap(map: MapSnapshot): Copy {
  if (!map.threads.length) return example;
  const ids = new Set(map.threads.map(topic => topic.id));
  return {
    example: false,
    topics: map.threads.map(topic => ({ id: topic.id, title: topic.title, parent: topic.parent_id && ids.has(topic.parent_id) ? topic.parent_id : null })),
    points: map.thoughts.filter(point => point.placed && point.thread_id && ids.has(point.thread_id))
      .map(point => ({ id: point.id, topic: point.thread_id!, text: point.text || point.point })),
  };
}

export function draftFor(source: string): Draft {
  return { source, kind: 'split', title: '', points: [], target: '' };
}

export function descendants(copy: Copy, source: string): Set<string> {
  const found = new Set([source]);
  let size = 0;
  while (size !== found.size) {
    size = found.size;
    for (const topic of copy.topics) if (topic.parent && found.has(topic.parent)) found.add(topic.id);
  }
  return found;
}

export function destinations(copy: Copy, draft: Draft): readonly Topic[] {
  const excluded = descendants(copy, draft.source);
  return copy.topics.filter(topic => !excluded.has(topic.id));
}

function splitPlan(before: Copy, draft: Draft, source: Topic): Planning {
  const title = draft.title.trim().replace(/\s+/g, ' ');
  if (!title) return { error: 'Give the new topic a name.' };
  if ([...title].length > 80) return { error: 'Use a name of 80 characters or fewer.' };
  const points = before.points.filter(point => point.topic === source.id);
  const selected = new Set(draft.points);
  if (!selected.size || draft.points.some(id => !points.some(point => point.id === id))) return { error: 'Choose the exact points to move.' };
  if (selected.size >= points.length) return { error: 'Keep at least one point in the original topic. To move everything, use Merge.' };
  let id = 'reshape-copy-1';
  for (let n = 2; before.topics.some(topic => topic.id === id); n++) id = `reshape-copy-${n}`;
  const after: Copy = { ...before,
    topics: [...before.topics, { id, title, parent: source.parent }],
    points: before.points.map(point => selected.has(point.id) ? { ...point, topic: id } : point),
  };
  return { plan: { before, after, label: `Split “${source.title}”`, affected: [source.id, id], details: [
    `${selected.size} ${selected.size === 1 ? 'point moves' : 'points move'} into “${title}”.`,
    `${points.length - selected.size} stay in “${source.title}”. The new topic shares its parent.`,
    'Existing child topics stay with the original topic. Original words stay intact.',
  ] } };
}

function mergePlan(before: Copy, draft: Draft, source: Topic): Planning {
  const target = destinations(before, draft).find(topic => topic.id === draft.target);
  if (!target) return { error: 'Choose a destination outside this topic’s children.' };
  const count = before.points.filter(point => point.topic === source.id).length;
  const children = before.topics.filter(topic => topic.parent === source.id);
  return { plan: { before,
    after: { ...before,
      topics: before.topics.filter(topic => topic.id !== source.id).map(topic => topic.parent === source.id ? { ...topic, parent: target.id } : topic),
      points: before.points.map(point => point.topic === source.id ? { ...point, topic: target.id } : point),
    },
    label: `Merge “${source.title}” into “${target.title}”`, affected: [source.id, target.id, ...children.map(topic => topic.id)],
    details: [`${count} ${count === 1 ? 'point joins' : 'points join'} “${target.title}”, keeping every original word.`,
      `${children.length} child ${children.length === 1 ? 'topic moves' : 'topics move'} under the destination.`,
      `“${source.title}” leaves this copy. Undo restores it exactly.`],
  } };
}

function parentPlan(before: Copy, draft: Draft, source: Topic): Planning {
  const target = draft.target ? destinations(before, draft).find(topic => topic.id === draft.target) : null;
  if (draft.target && !target) return { error: 'Choose a parent outside this topic’s children.' };
  const parent = target?.id ?? null;
  if (parent === source.parent) return { error: 'This topic already has that parent. Choose a different one.' };
  return { plan: { before,
    after: { ...before, topics: before.topics.map(topic => topic.id === source.id ? { ...topic, parent } : topic) },
    label: `Move “${source.title}” ${target ? `under “${target.title}”` : 'to the top level'}`,
    affected: [source.id, ...(target ? [target.id] : []), ...before.topics.filter(topic => topic.parent === source.id).map(topic => topic.id)],
    details: [`“${source.title}” ${target ? `will sit under “${target.title}”.` : 'will stand at the top level.'}`,
      'Its points and entire child branch stay together. No words move between topics.'],
  } };
}

export function planReshape(before: Copy, draft: Draft): Planning {
  const source = before.topics.find(topic => topic.id === draft.source);
  if (!source) return { error: 'Choose a topic first.' };
  if (draft.kind === 'split') return splitPlan(before, draft, source);
  if (draft.kind === 'merge') return mergePlan(before, draft, source);
  return parentPlan(before, draft, source);
}
