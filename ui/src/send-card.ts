// The ready-to-send message card (core/src/messages.rs), as the window shows it: who it's to, the words, a countdown
// you can see, and Stop (or Esc, or saying "stop"). The core owns the countdown and is the only one that sends; the
// window shows the time it was told is left, and asks the core to stop. Plain functions, so scripts/send-card-check.mjs
// checks them without a page.
import { upFor } from "./notice-rules";

export const STOP_WAITS = "Not connected: your Stop goes as soon as this window reconnects.";

export type SendState = "counting" | "running" | "stopped" | "sent" | "dry_run" | "failed";

/** The core's `send_card` message. */
export type SendCardMsg = { type: "send_card"; purpose?: "helpers"; id: number; to: string; text: string; state: SendState; in_ms: number; live: boolean; message: string };

/** The card shown: `until` is when the count ends on this window's clock, `total` how long the whole count was. */
export type Card = { purpose?: "helpers"; id: number; to: string; text: string; state: SendState; live: boolean; message: string; until: number; total: number; stopPending?: boolean };

/** The card after the core's message at `now`: a new message's card replaces the one up; an end (stopped, sent…)
 *  changes only the card it's about, so a late word on an older one never takes down the newer, and the end a
 *  reconnect's catch-up repeats (core/src/messages.rs `card_for`) shows only on a window that was counting it down,
 *  never as something old on a fresh one. The same count again (a reconnect says the time left) keeps the count's
 *  length, so the bar runs on from where it was; the same end again leaves the card as it is, its time up included. */
export function received(shown: Card | null, msg: SendCardMsg, now: number): Card | null {
  const same = shown?.id === msg.id;
  if (msg.state !== "counting" && msg.state !== "running" && (!same || shown!.state === msg.state)) return shown;
  const total = msg.state !== "counting" ? (shown?.total ?? 0) : same && shown!.state === "counting" ? shown!.total : msg.in_ms;
  return { ...(msg.purpose ? { purpose: msg.purpose } : {}), id: msg.id, to: msg.to, text: msg.text, state: msg.state, live: msg.live, message: msg.message, until: now + msg.in_ms, total };
}

/** The card once a (re)connection's snapshot came: the core sends the speaker's card before it (`card_for`), so a card
 *  still counting that it didn't name (`told`: the id it sent a card for, if any) is one the core no longer has (it
 *  restarted, or another window stopped it and a newer one ended since): it goes, never stuck on "Sending…". An end
 *  still up for its reading time stays. */
export function caughtUp(shown: Card | null, told: number | null): Card | null {
  return (shown?.state === "counting" || shown?.state === "running") && shown.id !== told ? null : shown;
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
export const STATE_CLASS: Record<SendState, string> = { counting: "is-counting", running: "is-counting", stopped: "is-stopped", sent: "is-sent", dry_run: "is-dry-run", failed: "is-failed" };

/** The card's words: its heading, the line under the message, and whether Stop is offered. */
export function cardWords(card: Card, now: number): { heading: string; status: string; stop: boolean } {
  if (card.purpose === "helpers") {
    const heading = card.to;
    if (card.state === "counting") {
      const s = secondsLeft(card, now);
      return { heading, status: card.stopPending ? STOP_WAITS : s > 0 ? `Starts in ${s}` : "Starting…", stop: !card.stopPending && s > 0 };
    }
    return { heading, status: card.stopPending ? STOP_WAITS : card.message, stop: card.state === "running" && !card.stopPending };
  }
  const heading = card.live ? `Message to ${card.to}` : `Message to ${card.to} · dry run`;
  switch (card.state) {
    case "running": return { heading, status: card.message, stop: false };
    case "counting": {
      if (card.stopPending) return { heading, status: STOP_WAITS, stop: false };
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
  if (card.state !== "counting" || card.stopPending) return cardWords(card, card.until).status;
  const seconds = Math.round(card.total / 1000);
  if (card.purpose === "helpers") return `${card.to} start in ${seconds} seconds. ${card.text}. Say stop or press Escape to stop them.`;
  const what = card.live ? "Sends" : "Dry run: would send";
  return `${what} “${card.text}” to ${card.to} in ${seconds} seconds. Say stop or press Escape to stop it.`;
}

/** Esc stops the message while it counts, wherever focus is: the one key that is always in reach. */
export function stopsOnKey(card: Card | null, key: string, now: number): card is Card {
  return !!card && !card.stopPending && key === "Escape" && (card.state === "running" || (card.state === "counting" && card.until > now));
}

/** A message that starts counting comes first: a modal sheet (Recap, Import) makes the rest of the window inert and
 *  covers it, so the countdown and its Stop would be out of view and out of reach while the message can be stopped.
 *  The window closes them for it; the card's end leaves a sheet opened since alone. */
export function comesFirst(card: { state: SendState } | null): boolean {
  return card?.state === "counting" || card?.state === "running";
}

/** How long an ended card stays up: its line's reading time (notice-rules.ts `upFor`), as any answer gets. */
export function lingerMs(card: Card): number {
  return card.state === "counting" || card.state === "running" ? 0 : upFor(`${cardWords(card, card.until).heading} ${card.text} ${cardWords(card, card.until).status}`);
}
