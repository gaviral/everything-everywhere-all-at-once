import { useState } from 'react';
import { SketchCapture, DrawingView } from './SketchCapture';
import type { Drawing } from './contract';
import type { Exchange } from './SketchTransport';
export function VisualReply({ exchange, enabled, onReply }: { exchange: Exchange; enabled: boolean; onReply: (drawing: Drawing) => void }) {
  const [drawing, setDrawing] = useState<Drawing>([]);
  if (exchange.reply) return <><DrawingView drawing={exchange.reply} label="Visual reply" /><p>{exchange.replyReceived ? 'Source received reply' : 'Reply sent · awaiting source receipt'}</p></>;
  return <><SketchCapture label="Reply diagram" drawing={drawing} onChange={setDrawing} disabled={!enabled} />
    <button disabled={!enabled || !drawing.length} onClick={() => onReply(drawing)}>Return visual reply</button></>;
}
