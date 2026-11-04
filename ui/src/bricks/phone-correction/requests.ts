import { useEffect, useRef, useState } from 'react';
import { correctionChannel, type CorrectionRequest } from './protocol';

/** One visit's explicit requests; neither reconnect nor mounting replays a mutation. */
export function useCorrectionRequests() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState<CorrectionRequest | null>(null);
  const [undo, setUndo] = useState<CorrectionRequest | null>(null);
  const mounted = useRef(true);
  const waiting = useRef(false);
  useEffect(() => {
    mounted.current = true;
    correctionChannel.enable(true);
    return () => { mounted.current = false; correctionChannel.enable(false); };
  }, []);

  const submit = async (request: CorrectionRequest) => {
    if (waiting.current) return;
    waiting.current = true; setBusy(true); setRetry(null); setMessage('Waiting for confirmation…');
    const result = await correctionChannel.request(request);
    if (!mounted.current) return;
    waiting.current = false; setBusy(false); setMessage(result.message);
    if (!result.ok) { setRetry(request); return; }
    setUndo(request.undo_of ? null : request);
  };
  const undoMove = () => {
    if (!undo) return;
    void submit({ ...undo, request_id: crypto.randomUUID(), from: undo.to, to: undo.from, undo_of: undo.request_id });
  };
  const review = () => { setRetry(null); setMessage('Review the current landing before making a new correction.'); };
  return { busy, message, retry, undo, submit, undoMove, review };
}
