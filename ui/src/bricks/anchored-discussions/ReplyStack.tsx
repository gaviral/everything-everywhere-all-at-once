import { useId } from 'react';
import { usePluginState } from '../contract';
import type { Exchange } from './model';

export function ReplyStack({ item, scope }: { item: Exchange; scope: string }) {
  const [expanded, expand] = usePluginState(`${scope}:${item.id}:replies`, false);
  const id = useId();
  const resolved = item.status?.status === 'resolved';
  const shown = !resolved || expanded;
  return <>
    {resolved && <button type="button" aria-expanded={shown} aria-controls={id} onClick={() => expand(!expanded)}>{shown ? 'Hide replies' : `Read ${item.replies.length} ${item.replies.length === 1 ? 'reply' : 'replies'}`}</button>}
    <ol id={id} className="anchored-discussions-replies" hidden={!shown}>{item.replies.map(reply => <li key={reply.id}>
      <strong>{reply.speaker}</strong><p>{reply.point || reply.text}</p>
    </li>)}</ol>
    {!item.replies.length && <p>No replies yet.</p>}
  </>;
}
