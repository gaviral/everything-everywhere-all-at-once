import { anchorRange, type Anchor, type MapSnapshot, type Thought } from '../contract';

export type Filter = 'all' | 'open' | 'resolved';
export type Status = { readonly thread_id: string; readonly status: 'open' | 'resolved'; readonly actor: string; readonly revision: number; readonly reply_count: number };
export type Reply = Pick<Thought, 'id' | 'speaker' | 'text' | 'point' | 'at_ms'>;
export type Exchange = {
  id: string; title: string; anchor: Anchor; source?: Reply; sourceLive: boolean;
  replies: readonly Reply[]; status?: Status;
};

/** Each live anchored thread stays discoverable, including one whose source has left. */
export function exchanges(map: Pick<MapSnapshot, 'threads' | 'thoughts'>, statuses: readonly Status[] = []): Exchange[] {
  return map.threads.filter(thread => thread.anchor).map(thread => {
    const anchor = thread.anchor!;
    const source = map.thoughts.find(thought => thought.id === anchor.thought_id);
    return { id: thread.id, title: thread.title, anchor, source,
      sourceLive: !!source?.placed && map.threads.some(home => home.id === source.thread_id),
      replies: map.thoughts.filter(thought => thought.thread_id === thread.id).slice().sort((a, b) => a.at_ms - b.at_ms),
      status: statuses.find(status => status.thread_id === thread.id) };
  });
}

/** Highlight only the captured range or an unambiguous legacy quote. Never retarget changed words. */
export function sourceWords(item: Exchange) {
  const current = item.source?.point || item.source?.text || '';
  const text = item.anchor.context?.source_text ?? current;
  let range = anchorRange(item.anchor.quote, item.anchor.context, text);
  if (!item.anchor.context) {
    const start = text.indexOf(item.anchor.quote);
    if (start >= 0 && text.indexOf(item.anchor.quote, start + 1) < 0) range = { start, end: start + item.anchor.quote.length };
  }
  const warning = !item.sourceLive ? 'Source no longer on map' : current !== text ? 'Source changed · showing captured words' : !range ? 'Exact source words unavailable' : '';
  return { text, range, warning };
}

export const example: Exchange = {
  id: 'example-opening', title: 'Opening moment', sourceLive: true,
  anchor: { thought_id: 'example-source', quote: 'start with the map' },
  source: { id: 'example-source', speaker: 'Visitor', text: 'Let’s start with the map, then show how every voice finds its place.', point: '', at_ms: 1 },
  replies: [
    { id: 'example-question', speaker: 'Coordinator', text: 'Can we show the source words when this is resolved?', point: '', at_ms: 2 },
    { id: 'example-answer', speaker: 'Visitor', text: 'Yes. Keep the exchange right beside the words it belongs to.', point: '', at_ms: 3 },
  ],
};
