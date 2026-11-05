/** Labelled example content and inert service substitutes for the chrome-only review. */
export function chromeFixture() {
  localStorage.setItem("e2a2o.toured", "1");
  localStorage.setItem("e2a2o.bricks", JSON.stringify({ "intro-parts": true }));
  window.iconMediaRequests = 0;
  navigator.mediaDevices.getUserMedia = async () => { window.iconMediaRequests++; throw new Error("Microphone disabled in icon check"); };
  const now = Date.now();
  const text = "Example: bring the sketchbook to the workshop.";
  const world = {
    threads: [{ id: "T1", title: "Example · Workshop", parent_id: null, status: "open", last_point: text, touched_ms: now, tags: [], picture: null, dropped_by: "" }],
    thoughts: [{ id: "p1", speaker: "you", text, point: text, thread_id: "T1", placed: true, unclear: "", guess: "", heard: "", fixed: "", complete: true, at_ms: now, place_ms: 2000, decided: false }],
    active: "T1", active_by: { you: "T1" }, suggestions: [], actions: [], merged: {}, apps: [], apps_seeded: true, recaps: [], notes: {}, proposals: [], questions: [], ai: [],
  };
  class FixtureSocket extends EventTarget {
    static OPEN = 1; static CLOSED = 3; static CONNECTING = 0;
    readyState = 0;
    constructor() {
      super();
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.(new Event("open"));
        this.dispatchEvent(new Event("open"));
        this.receive({ type: "map_identity", id: "icon-example" });
        this.receive({ type: "snapshot", world });
      }, 0);
    }
    receive(message) { const event = new MessageEvent("message", { data: JSON.stringify(message) }); this.onmessage?.(event); this.dispatchEvent(event); }
    send(data) { if (typeof data === "string") { const message = JSON.parse(data); if (message.type === "heartbeat") this.receive(message); } }
    close() { this.readyState = 3; this.onclose?.(new Event("close")); this.dispatchEvent(new Event("close")); }
  }
  window.WebSocket = FixtureSocket;
}
