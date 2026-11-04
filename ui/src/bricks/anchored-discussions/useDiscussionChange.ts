import { useEffect, useRef, useState, type ContextType } from 'react';
import { DiscussionContext } from '../contract';
import type { Exchange } from './model';

/** The host owns persistence and revisions. This part owns only the pending acknowledgement. */
export function useDiscussionChange(host: ContextType<typeof DiscussionContext>, item: Exchange, connected: boolean) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pending = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++; pending.current = false; setBusy(false); setMessage('');
    return () => { generation.current++; };
  }, [host?.enabled, item.id]);
  const change = async () => {
    if (!host?.enabled || !connected || pending.current) return;
    const token = generation.current;
    pending.current = true; setBusy(true); setMessage('Saving…');
    try {
      const result = await host.set(item.id, item.status?.status === 'resolved' ? 'open' : 'resolved', item.status?.revision ?? 0);
      if (token === generation.current) setMessage(result.message);
    } catch {
      if (token === generation.current) setMessage('Save unconfirmed. Review the current state before trying again.');
    } finally {
      if (token === generation.current) { pending.current = false; setBusy(false); }
    }
  };
  return { busy, message, change };
}
