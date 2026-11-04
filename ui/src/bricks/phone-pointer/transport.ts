export type Input = { kind: "move"; dx: number; dy: number }
  | { kind: "click"; button: "left" | "right" }
  | { kind: "key"; key: string; modifiers: string[] }
  | { kind: "text"; text: string };
export type Permissions = { input: boolean; preview: boolean };

// The pairing key belongs only to this mount, never to storage or the query string.
let pairingKey = "";
export function takePairingKey() {
  const bootstrap = window as Window & { __phonePointerPair?: string };
  if (bootstrap.__phonePointerPair) {
    pairingKey = bootstrap.__phonePointerPair;
    delete bootstrap.__phonePointerPair;
  }
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has("pair")) {
    pairingKey = params.get("pair") ?? "";
    history.replaceState(null, "", location.pathname + location.search);
  }
  return pairingKey;
}

export class PointerLink {
  private tail: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private generation = 0;
  constructor(private key: string) {}
  stop() { this.stopped = true; this.generation++; }
  cancelPending() { this.generation++; }
  async request(path: string, body?: unknown, signal?: AbortSignal) {
    if (this.stopped) throw Error("Remote closed. Reopen the pairing link.");
    const response = await fetch(`/pointer/${path}`, {
      method: body === undefined ? "GET" : "POST", cache: "no-store", signal,
      headers: { Authorization: `Bearer ${this.key}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => null);
      throw Error(problem?.error ?? "Mac helper unavailable. Reopen its pairing link.");
    }
    return response;
  }
  async status(): Promise<Permissions> { return (await this.request("status")).json(); }
  input(event: Input) {
    const generation = this.generation;
    const next = this.tail.catch(() => {}).then(async () => {
      if (generation !== this.generation || this.stopped) return false;
      await this.request("input", event, AbortSignal.timeout(2500));
      return true;
    });
    this.tail = next;
    return next;
  }
}
