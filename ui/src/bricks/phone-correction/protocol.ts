export type CorrectionRequest = {
  request_id: string;
  thought_id: string;
  observed_text: string;
  from: string;
  to: string;
  undo_of?: string;
};
export type CorrectionResult = { type: "correction_result"; request_id: string; thought_id: string; ok: boolean; message: string };
type Pending = { request: CorrectionRequest; finish: (result: CorrectionResult) => void };

/** Uses the host's existing socket; this feature never opens a second connection. */
export class CorrectionChannel {
  private socket: WebSocket | null = null;
  private enabled = false;
  private pending = new Map<string, Pending>();

  enable(on: boolean) {
    this.enabled = on;
    this.send({ type: "corrections", on });
    if (!on) this.end("Correction switched off. Save unconfirmed; review before retrying.");
  }

  bind(socket: WebSocket) {
    this.end("Connection changed. Save unconfirmed; retry the same request.");
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.socket === socket) this.send({ type: "corrections", on: this.enabled });
    });
    socket.addEventListener("message", event => {
      if (this.socket !== socket || typeof event.data !== "string") return;
      let result: CorrectionResult;
      try { result = JSON.parse(event.data); } catch { return; }
      if (result.type !== "correction_result" || typeof result.ok !== "boolean" || typeof result.message !== "string") return;
      const pending = this.pending.get(result.request_id);
      if (!pending || pending.request.thought_id !== result.thought_id) return;
      this.pending.delete(result.request_id);
      pending.finish(result);
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.end("Connection lost. Save unconfirmed; retry the same request.");
    });
  }

  request(request: CorrectionRequest): Promise<CorrectionResult> {
    const refused = (message: string): CorrectionResult => ({ type: "correction_result", request_id: request.request_id, thought_id: request.thought_id, ok: false, message });
    if (!this.enabled) return Promise.resolve(refused("Correction is off."));
    if (this.pending.has(request.request_id)) return Promise.resolve(refused("Already waiting for this correction."));
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(request.request_id);
        resolve(refused("No acknowledgement yet. Retry the same request to check it."));
      }, 12000);
      const finish = (result: CorrectionResult) => { clearTimeout(timer); resolve(result); };
      this.pending.set(request.request_id, { request, finish });
      if (!this.send({ type: "correction", ...request })) {
        this.pending.delete(request.request_id);
        finish(refused("Not connected. Nothing sent; retry when connected."));
      }
    });
  }

  private send(message: object) {
    if (this.socket?.readyState !== 1) return false;
    try { this.socket.send(JSON.stringify(message)); return true; } catch { return false; }
  }
  private end(message: string) {
    for (const { request, finish } of this.pending.values()) finish({ type: "correction_result", request_id: request.request_id, thought_id: request.thought_id, ok: false, message });
    this.pending.clear();
  }
}

export const correctionChannel = new CorrectionChannel();
export const bindCorrectionSocket = (socket: WebSocket) => correctionChannel.bind(socket);
