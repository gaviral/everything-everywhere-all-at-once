import type { Person, Turn, ContextPacket } from "./context";

export const EXAMPLE_PEOPLE: Person[] = [
  { id: "speaker-1", name: "Maya", role: "API & idempotency" },
  { id: "speaker-2", name: "Leo", role: "Events & webhooks" },
];

export const EXAMPLE_TURNS: Turn[] = [
  { id: "m1", speaker: "speaker-1", topic: "payments", title: "Payments contract", text: "We're shipping POST /payments. Amounts are integer cents; currency is ISO 4217." },
  { id: "l1", speaker: "speaker-2", topic: "payments", title: "Payments contract", text: "Agreed. POST /payments should return a payment ID and status." },
  { id: "m2", speaker: "speaker-1", topic: "idempotency", title: "Idempotency", text: "I'll own idempotency. The same key and payload must return the original payment." },
  { id: "l2", speaker: "speaker-2", topic: "webhooks", title: "Webhooks", text: "I'll own webhooks. Verify signatures before accepting payment events." },
  { id: "m3", speaker: "speaker-1", topic: "payments", title: "Payments contract", text: "Return 202 while payment is processing; use GET /payments/:id for status." },
  { id: "l3", speaker: "speaker-2", topic: "payments", title: "Payments contract", text: "Yes, 202 and a payment ID. The client can poll GET /payments/:id." },
  { id: "m4", speaker: "speaker-1", topic: "idempotency", title: "Idempotency", text: "If the key is reused with a different payload, return 409." },
  { id: "l4", speaker: "speaker-2", topic: "webhooks", title: "Webhooks", text: "Deduplicate webhook events by event ID before delivery." },
];

/** Scripted outputs for a labelled example, using only the displayed packet. No model is called. */
export function exampleOutput(packet: ContextPacket, kind: "ask" | "build"): string {
  const idempotency = packet.own.some(turn => turn.topic === "idempotency");
  const webhooks = packet.own.some(turn => turn.topic === "webhooks");
  if (!idempotency && !webhooks) return kind === "ask"
    ? "What part of the payments API would you like to work on?"
    : "Waiting for your implementation context before drafting.";
  if (kind === "ask") return idempotency
    ? "How long should an idempotency key stay valid? Your context defines replay behavior, but not its lifetime."
    : "What should happen when a webhook signature fails? Your context requires verification, but doesn't define the response.";
  if (idempotency) return ["// Example draft · storage helpers to implement", "const previous = await findPayment(key);",
    ...(packet.own.some(turn => turn.id === "m4") ? ["if (previous && previous.payload !== payload)", "  return reply.status(409).send();"] : []),
    "if (previous) return reply.send(previous.payment);", "// Create and store the payment atomically."].join("\n");
  return ["// Example draft · verification helper to implement", "if (!verifySignature(event, signature)) {", "  // Decide the rejection response.", "  return;", "}",
    ...(packet.own.some(turn => turn.id === "l4") ? ["if (await seenEvent(event.id)) return;"] : []), "await acceptPaymentEvent(event);"].join("\n");
}
