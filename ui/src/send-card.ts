// The ready-to-send message card (core/src/messages.rs), as the window shows it: who it's to, the words, a countdown
// you can see, and Stop (or Esc, or saying "stop"). The core owns the countdown and is the only one that sends; the
// window shows the time it was told is left, and asks the core to stop. Plain functions, so scripts/send-card-check.mjs
// checks them without a page.
import { upFor } from "./notice-rules";

export type SendState = "counting" | "stopped" | "sent" | "dry_run" | "failed";

/** The core's `send_card` message. */
export type SendCardMsg = { type: "send_card"; id: number; to: string; text: string; state: SendState; in_ms: number; live: boolean; message: string };

/** The card shown: `until` is when the count ends on this window's clock, `total` how long the whole count was. */
export type Card = { id: number; to: string; text: string; state: SendState; live: boolean; message: string; until: number; total: number };

/** The card after the core's message at `now`: a new message's card replaces the one up; an end (stopped, sent…) only
 *  changes the card it's about, so a late word on an older one never takes down the newer. */
export function received(shown: Card | null, msg: SendCardMsg, now: number): Card | null {
  if (msg.state !== "counting" && shown?.id !== msg.id) return shown;
  const total = msg.state === "counting" ? msg.in_ms : shown?.total ?? 0;
  return { id: msg.id, to: msg.to, text: msg.text, state: msg.state, live: msg.live, message: msg.message, until: now + msg.in_ms, total };
}

/** Whole seconds left, as the count shows them: 5 at the start, 1 in its last second, never below 0. */
export function secondsLeft(card: Card, now: number): number {
  return Math.max(0, Math.ceil((card.until - now) / 1000));
}

/** How far through the count it is, 0 to 1, for the bar. */
export function elapsed(card: Card, now: number): number {
  if (card.total <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - (card.until - now) / card.total));
}

/** When the shown digit changes next, in ms from `now`: the next whole second left. */
export function nextTick(card: Card, now: number): number {
  const left = card.until - now;
  if (left <= 0) return 0;
  return left % 1000 || 1000;
}

/** The card's class for its state: whole words, so the stylesheet check can see each one used. */
export const STATE_CLASS: Record<SendState, string> = { counting: "is-counting", stopped: "is-stopped", sent: "is-sent", dry_run: "is-dry-run", failed: "is-failed" };

/** The card's words: its heading, the line under the message, and whether Stop is offered. */
export function cardWords(card: Card, now: number): { heading: string; status: string; stop: boolean } {
  const heading = card.live ? `Message to ${card.to}` : `Message to ${card.to} · dry run`;
  switch (card.state) {
    case "counting": {
      const s = secondsLeft(card, now);
      return { heading, status: s > 0 ? `Sends in ${s}` : "Sending…", stop: s > 0 };
    }
    case "stopped": return { heading, status: card.message || "Stopped: not sent", stop: false };
    case "sent": return { heading, status: card.message || `Sent to ${card.to}`, stop: false };
    case "dry_run": return { heading, status: card.message || "Dry run: nothing sent", stop: false };
    case "failed": return { heading, status: card.message || "Not sent", stop: false };
  }
}

/** What a screen reader hears, once per state (never each second): the start says how to stop it. */
export function announcement(card: Card): string {
  if (card.state !== "counting") return cardWords(card, card.until).status;
  const seconds = Math.round(card.total / 1000);
  const what = card.live ? "Sends" : "Dry run: would send";
  return `${what} “${card.text}” to ${card.to} in ${seconds} seconds. Say stop or press Escape to stop it.`;
}

/** Esc stops the message while it counts, wherever focus is: the one key that is always in reach. */
export function stopsOnKey(card: Card | null, key: string, now: number): card is Card {
  return !!card && key === "Escape" && card.state === "counting" && card.until > now;
}

/** How long an ended card stays up: its line's reading time (notice-rules.ts `upFor`), as any answer gets. */
export function lingerMs(card: Card): number {
  return card.state === "counting" ? 0 : upFor(cardWords(card, card.until).status);
}
