import type { Connection, Freshness, StatusSource } from "./contracts";

export type SourceStatus = Readonly<{ state: Freshness; epoch: number; lastReceived?: number }>;

/** Owns one observer and its connection epoch. Late callbacks after off are inert. */
export class SourceSubscription<T> {
  private cleanup?: () => void;
  private generation = 0;
  private connection: Connection | "waiting" = "unavailable";
  private epoch = 0;
  private lastReceived?: number;
  constructor(private source: StatusSource<T> | undefined, private receive: (event: T, epoch: number) => boolean,
    private changed: () => void, private now: () => number) {}
  start() {
    this.stop();
    if (!this.source) return;
    const generation = ++this.generation;
    this.connection = "waiting";
    try {
      this.cleanup = this.source.subscribe({
        connection: state => {
          if (generation !== this.generation || !["connected", "disconnected", "unavailable"].includes(state)) return;
          if (state === "connected" && this.connection !== "connected") { this.epoch++; this.lastReceived = undefined; }
          this.connection = state;
          this.changed();
        },
        event: event => {
          if (generation !== this.generation || this.connection !== "connected") return;
          if (this.receive(event, this.epoch)) { this.lastReceived = this.now(); this.changed(); }
        },
      });
    } catch { this.generation++; this.connection = "unavailable"; }
  }
  stop() {
    ++this.generation;
    const cleanup = this.cleanup;
    this.cleanup = undefined;
    this.connection = this.source ? "disconnected" : "unavailable";
    this.lastReceived = undefined;
    try { cleanup?.(); } catch { /* Continue releasing the other independent subscriptions. */ }
  }
  status(staleAfterMs: number): SourceStatus {
    const state = this.connection === "connected"
      ? this.lastReceived === undefined ? "waiting" : this.now() - this.lastReceived >= staleAfterMs ? "stale" : "connected"
      : this.connection;
    return { state, epoch: this.epoch, lastReceived: this.lastReceived };
  }
}
