/** The core owns proposals and receipts; the browser never retries a confirmation. */
export interface ConnectionBlock { query: string; when: string }
export interface ConnectionPlan { id: string; source: string; block: ConnectionBlock; title: string | null; steps: { name: string; state: "proposed" | "running" | "done" | "failed"; detail: string }[] }
export type ConnectionRequest = { operation: "list" } | { operation: "plan"; block: ConnectionBlock } | { operation: "confirm"; plan_id: string; step: number } | { operation: "dismiss"; plan_id: string };
export interface ConnectionReply { request_id: string; message: string; plans: ConnectionPlan[]; play: boolean }
