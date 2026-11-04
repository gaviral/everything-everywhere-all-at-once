import { useContext, useState, type ContextType } from 'react';
import { DiscussionContext, usePluginState, type BrickProps } from '../contract';
import { DiscussionCard } from './DiscussionCard';
import { exchanges, example, type Exchange, type Filter } from './model';
import { useDiscussionChange } from './useDiscussionChange';
import './discussions.css';

function LiveExchange({ item, host, scope, map, actions }: { item: Exchange; host: ContextType<typeof DiscussionContext>; scope: string } & Pick<BrickProps, 'map' | 'actions'>) {
  const { busy, message, change } = useDiscussionChange(host, item, map.connected);
  return <DiscussionCard item={item} scope={scope} openSource={() => { actions.openThought(item.anchor.thought_id); }} controls={<>
    {host?.enabled ? <button type="button" disabled={busy || !map.connected} onClick={() => void change()}>{busy ? 'Saving…' : item.status?.status === 'resolved' ? 'Reopen discussion' : 'Resolve discussion'}</button>
      : <button type="button" onClick={() => actions.openCatalog('discussion-status')}>Enable Discussion status</button>}
    {!map.connected && <p>Connection lost. Reconnect to change discussion status.</p>}
    <p role="status">{message}</p>
  </>} />;
}

function ExampleExchange() {
  const [resolved, resolve] = useState(false);
  const item = { ...example, status: resolved ? { thread_id: example.id, status: 'resolved' as const, actor: 'you (example)', revision: 1, reply_count: example.replies.length } : undefined };
  return <section aria-label="Example discussion"><p className="anchored-discussions-example">Interactive example · changes stay in this preview</p>
    <DiscussionCard item={item} scope="anchored-discussions:example" controls={<button type="button" onClick={() => resolve(!resolved)}>{resolved ? 'Reopen example' : 'Resolve example'}</button>} />
  </section>;
}

export default function AnchoredDiscussions({ map, actions }: BrickProps) {
  const host = useContext(DiscussionContext);
  const scope = `anchored-discussions:${map.visitKey ?? map.mapIdentity ?? 'visit'}:${map.me}`;
  const [filter, choose] = usePluginState<Filter>(`${scope}:filter`, 'all');
  const items = exchanges(map, host?.world.discussions);
  const resolved = items.filter(item => item.status?.status === 'resolved').length;
  const shown = items.filter(item => filter === 'all' || (item.status?.status ?? 'open') === filter);
  return <section className="anchored-discussions" aria-label="Anchored discussions">
    <header className="anchored-discussions-heading"><div><p className="anchored-discussions-kicker">Keep the context</p><h1>A little closure.<br />Every word kept.</h1>
      <p>Resolve the exchange. Return to the words whenever you need.</p></div><div className="anchored-discussions-total"><strong>{resolved}</strong><span>resolved · {items.length} total</span></div></header>
    {items.length ? <>
      <nav className="anchored-discussions-filters" aria-label="Discussion filter">{(['all', 'open', 'resolved'] as const).map(value => <button type="button" key={value} aria-pressed={filter === value} onClick={() => choose(value)}>{value === 'all' ? 'All discussions' : value === 'open' ? `Open (${items.length - resolved})` : `Resolved (${resolved})`}</button>)}</nav>
      {!shown.length && <p className="anchored-discussions-empty">No {filter} discussions. All discussions keeps every exchange in reach.</p>}
      {shown.map(item => <LiveExchange key={`${scope}:${item.id}`} item={item} host={host} scope={scope} map={map} actions={actions} />)}
    </> : <><p className="anchored-discussions-empty">Select words on the Canvas and reply to start a real discussion. Try closing and reopening this example.</p><ExampleExchange /></>}
  </section>;
}
