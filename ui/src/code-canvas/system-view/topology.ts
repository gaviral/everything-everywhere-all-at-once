export const nodes = [
  { id: 'speech', name: 'Speech', detail: 'Transcription sessions', x: 150, y: 90 },
  { id: 'placer', name: 'Placer', detail: 'Route each thought', x: 450, y: 90 },
  { id: 'refiner', name: 'Refiner', detail: 'Refine the map', x: 750, y: 90 },
  { id: 'flow', name: 'Flow', detail: 'Run prompt boxes', x: 1050, y: 90 },
  { id: 'journal', name: 'Journal', detail: 'Durable transactions', x: 150, y: 300 },
  { id: 'core', name: 'Rust core', detail: 'World · queues · event stream', x: 600, y: 300 },
  { id: 'helpers', name: 'Helpers', detail: 'Plan and coordinate jobs', x: 1050, y: 300 },
  { id: 'git', name: 'Git lanes', detail: 'Local version relationships', x: 150, y: 530 },
  { id: 'browser', name: 'Browser', detail: 'TypeScript · map · controls', x: 600, y: 530 },
  { id: 'agents', name: 'Agents', detail: 'Live jobs · coding calls', x: 1050, y: 530 },
] as const;
export type NodeId = typeof nodes[number]['id'];
export type Message = { from: NodeId; to: NodeId; label: string; count: number };
export type Batch = { sequence: number; observed_at: number; messages: Message[]; missed: number };
export const nodeName = (id: NodeId) => nodes.find(node => node.id === id)!.name;
const phases = ['started', 'completed', 'cancelled', 'failed'];
const jobs = ['preparing', 'queued', 'running', 'waiting', 'done', 'failed', 'stopped'].map(state => `job ${state}`);
export function allowed(message: Message): boolean {
  const { from, to, label } = message;
  if (from === 'browser' && to === 'core') return ['text frame', 'audio frame'].includes(label);
  if (from === 'core' && to === 'browser') return ['map change', 'speech draft'].includes(label);
  if (from === 'core' && to === 'journal') return label === 'transaction saved';
  if (from === 'agents' && to === 'core' && jobs.includes(label)) return true;
  const part = from === 'core' ? to : to === 'core' ? from : '';
  return ['speech', 'placer', 'refiner', 'flow', 'helpers', 'agents'].includes(part)
    && phases.includes(label) && (from === 'core' ? label === 'started' : label !== 'started');
}
export function readBatch(raw: string): Batch | null {
  try {
    const batch = JSON.parse(raw) as Batch;
    if (!Number.isSafeInteger(batch.sequence) || batch.sequence < 1 || !Number.isFinite(batch.observed_at)
      || !Number.isSafeInteger(batch.missed) || batch.missed < 0 || !Array.isArray(batch.messages) || batch.messages.length > 64) return null;
    if (!batch.messages.every(message => message && allowed(message) && Number.isSafeInteger(message.count) && message.count > 0)) return null;
    // Copy only the display contract; extra producer fields never reach the screen.
    return { sequence: batch.sequence, observed_at: batch.observed_at, missed: batch.missed,
      messages: batch.messages.map(({ from, to, label, count }) => ({ from, to, label, count })) };
  } catch { return null; }
}
export const messageKey = (message: Message) => `${message.from}:${message.to}:${message.label}`;
export const messageText = (message: Message) => `${message.label}${message.count > 1 ? ` ×${message.count}` : ''}`;
export function connectionPath(from: NodeId, to: NodeId): string {
  const a = nodes.find(node => node.id === from)!, b = nodes.find(node => node.id === to)!;
  const dx = b.x - a.x, dy = b.y - a.y;
  if (dy === 0) {
    const sx = a.x + Math.sign(dx) * 124, tx = b.x - Math.sign(dx) * 124;
    const bend = from === 'core' ? -16 : 16;
    return `M${sx},${a.y} C${(sx + tx) / 2},${a.y + bend} ${(sx + tx) / 2},${b.y + bend} ${tx},${b.y}`;
  }
  const sy = a.y + Math.sign(dy) * 44, ty = b.y - Math.sign(dy) * 44;
  const bend = from === 'core' ? -18 : 18;
  return `M${a.x},${sy} C${a.x + bend},${(sy + ty) / 2} ${b.x + bend},${(sy + ty) / 2} ${b.x},${ty}`;
}
