import { validDrawing, validEnvelope, type Drawing, type Envelope, type HostAdapter } from './contract';
export interface Exchange {
  id: string; source: string; target: string; original: Drawing;
  received: boolean; reply?: Drawing; replyReceived?: boolean;
}
const copy = (drawing: Drawing): Drawing => drawing.map(s => s.map(p => [p[0], p[1]] as const));
/** One session owns routing, immutable snapshots, acknowledgment and switch policy. */
export class SketchTransport {
  enabled = false;
  exchanges: Exchange[] = [];
  notice = 'Sketch exchange is off.';
  private listeners = new Set<() => void>();
  private unsubscribe: (() => void) | undefined;
  constructor(readonly adapter: HostAdapter) {}
  watch(hear: () => void) { this.listeners.add(hear); return () => { this.listeners.delete(hear); }; }
  private changed() { for (const hear of this.listeners) hear(); }
  setEnabled(enabled: boolean) {
    this.unsubscribe?.(); this.unsubscribe = undefined; this.enabled = enabled;
    if (enabled) this.unsubscribe = this.adapter.subscribe(m => this.receive(m));
    this.notice = enabled ? 'Ready to exchange sketches with selected sessions.' : 'Sketch exchange is off. Saved sketches remain in this view.';
    this.changed();
  }
  private deliver(message: Envelope) {
    try { this.adapter.send(message); }
    catch { this.notice = 'Connection unavailable. Your sketch is kept here; nothing was retried.'; this.changed(); return false; }
    return true;
  }
  send(target: string, drawing: Drawing) {
    if (!this.enabled || !validDrawing(drawing) || target === this.adapter.self.id ||
        !this.adapter.targets.some(s => s.id === target)) throw new Error('Enable exchange, draw a sketch and choose a destination.');
    if (this.exchanges.length >= 32) throw new Error('This view holds 32 exchanges. Open a new session to send more.');
    const exchange: Exchange = { id: crypto.randomUUID(), source: this.adapter.self.id, target, original: copy(drawing), received: false };
    this.exchanges = [...this.exchanges, exchange];
    this.notice = 'Sent. Waiting for the selected display to confirm receipt.';
    this.changed();
    this.deliver({ kind: 'sketch', exchangeId: exchange.id, from: exchange.source, to: target, drawing: copy(exchange.original) });
    return exchange.id;
  }
  reply(id: string, drawing: Drawing) {
    const exchange = this.exchanges.find(e => e.id === id);
    if (!this.enabled || !exchange || exchange.target !== this.adapter.self.id || exchange.reply || !validDrawing(drawing)) throw new Error('Choose a received sketch and draw a reply.');
    exchange.reply = copy(drawing);
    this.notice = 'Visual reply sent. Waiting for source receipt.'; this.changed();
    this.deliver({ kind: 'reply', exchangeId: id, from: exchange.target, to: exchange.source, drawing: copy(drawing) });
  }
  private receive(value: unknown) {
    if (!this.enabled || !validEnvelope(value) || value.to !== this.adapter.self.id || value.from === value.to ||
        !this.adapter.targets.some(s => s.id === value.from)) return;
    const message = value;
    const existing = this.exchanges.find(e => e.id === message.exchangeId);
    if (message.kind === 'sketch') {
      if (existing || this.exchanges.length >= 32) return;
      this.exchanges = [...this.exchanges, { id: message.exchangeId, source: message.from, target: message.to, original: copy(message.drawing), received: true }];
      this.notice = 'Sketch received. The original is preserved below.'; this.changed();
      this.deliver({ kind: 'receipt', exchangeId: message.exchangeId, from: message.to, to: message.from });
      return;
    }
    if (!existing) return;
    if (message.kind === 'receipt') {
      if (existing.source === message.to && existing.target === message.from) {
        existing.received = true; this.notice = 'Selected display confirmed receipt.';
      } else if (existing.target === message.to && existing.source === message.from && existing.reply) {
        existing.replyReceived = true; this.notice = 'Source confirmed visual reply receipt.';
      } else return;
    } else {
      if (existing.source !== message.to || existing.target !== message.from || existing.reply) return;
      existing.reply = copy(message.drawing); existing.received = true;
      this.notice = 'Visual reply received from the selected display.';
      this.deliver({ kind: 'receipt', exchangeId: existing.id, from: existing.source, to: existing.target });
    }
    this.changed();
  }
  dispose() { this.unsubscribe?.(); this.unsubscribe = undefined; this.listeners.clear(); }
}
