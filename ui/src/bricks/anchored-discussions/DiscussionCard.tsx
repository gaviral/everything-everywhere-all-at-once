import type { ReactNode } from 'react';
import { SourceWords } from './SourceWords';
import { ReplyStack } from './ReplyStack';
import type { Exchange } from './model';

export function DiscussionCard({ item, scope, openSource, controls }: { item: Exchange; scope: string; openSource?: () => void; controls: ReactNode }) {
  const resolved = item.status?.status === 'resolved';
  const newReply = resolved && item.replies.length > item.status!.reply_count;
  return <article className="anchored-discussions-card" data-state={resolved ? 'resolved' : 'open'}>
    <SourceWords item={item} open={openSource} />
    <section className="anchored-discussions-exchange" aria-label="Replies">
      <div className="anchored-discussions-state"><span>{resolved ? '✓ Resolved' : '● Open discussion'}</span><span>{item.replies.length} replies</span></div>
      {resolved && <p className="anchored-discussions-by">Resolved by {item.status!.actor}. Replies stay here.</p>}
      {newReply && <p className="anchored-discussions-warning">New reply on resolved discussion</p>}
      <ReplyStack item={item} scope={scope} />
      <div className="anchored-discussions-controls">{controls}</div>
    </section>
  </article>;
}
