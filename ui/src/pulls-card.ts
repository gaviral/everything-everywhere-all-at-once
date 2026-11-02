// The GitHub card (core/src/github.rs), as the window shows it: pull requests with their number, title, state, checks
// and when each last changed, read-only; a click opens one on GitHub. The core reads gh; the window only shows what it
// was sent. Plain functions, so scripts/pulls-card-check.mjs checks them without a page.
import { REACH_MS, upFor } from "./notice-rules";

export type PullState = "open" | "draft" | "merged" | "closed";
export type Checks = "passing" | "failing" | "running" | "none";
export type Pull = { number: number; title: string; state: PullState; checks: Checks; failing: number; total: number; updated: string; url: string };
export type CardState = "loading" | "ready" | "failed";

/** The core's `pulls_card` message. */
export type PullsCardMsg = { type: "pulls_card"; id: number; title: string; repo: string; state: CardState; pulls: Pull[]; more: boolean; message: string };
export type Card = Omit<PullsCardMsg, "type">;

/** The card shown (or none), the newest ask the core has answered or started on, and the newest one closed. Kept apart
 *  from the card, so closing it doesn't forget which ask is newest. */
export type Pulls = { card: Card | null; latest: number; closed: number };
/** A new connection's: the core numbers asks from 1 again after a restart. */
export const NO_PULLS: Pulls = { card: null, latest: 0, closed: 0 };

/** After the core's message: a newer ask replaces the card up; a late answer to an older ask, or to one closed while it
 *  waited, is dropped, so the card never jumps back to what was asked before or comes back once closed. */
export function received(pulls: Pulls, msg: PullsCardMsg): Pulls {
  if (msg.id < pulls.latest || msg.id <= pulls.closed) return pulls;
  const { type: _type, ...card } = msg;
  return { ...pulls, card, latest: msg.id };
}

/** After × , Esc or its time is up: card `id` goes, and its answer, should one still come, stays away. */
export function gone(pulls: Pulls, id: number): Pulls {
  if (id <= pulls.closed) return pulls;
  return { ...pulls, card: pulls.card?.id === id ? null : pulls.card, closed: id };
}

/** Classes as whole words, so the stylesheet check can see each one used. */
export const CARD_CLASS: Record<CardState, string> = { loading: "is-loading", ready: "is-ready", failed: "is-failed" };
export const PULL_CLASS: Record<PullState, string> = { open: "is-open", draft: "is-draft", merged: "is-merged", closed: "is-closed" };
export const CHECKS_CLASS: Record<Checks, string> = { passing: "is-passing", failing: "is-failing", running: "is-running", none: "is-none" };

export const STATE_WORD: Record<PullState, string> = { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" };

/** The checks in a few words: what matters first (a failure), with how many. */
export function checksWords(pull: Pull): string {
  switch (pull.checks) {
    case "passing": return "Checks pass";
    case "failing": return `${pull.failing} of ${pull.total} ${pull.total === 1 ? "check fails" : "checks fail"}`;
    case "running": return "Checks running";
    case "none": return "";
  }
}

/** How long ago `iso` was, as a glance reads it: "just now", "12 min ago", "3 h ago", "2 d ago", then the date. */
export function ago(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  // A week's worth reads as days; past that, a date says it better than "23 d ago".
  if (days < 7) return `${days} d ago`;
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(new Date(at).getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}) });
}

/** Only a web link opens from the card. */
export function safeUrl(url: string): string | null {
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** The repo's list of pull requests on GitHub, for "See all": built from a pull's own link, so it's the same host. */
export function allUrl(card: Card): string | null {
  const first = card.pulls.map((p) => safeUrl(p.url)).find(Boolean);
  if (!first) return null;
  const at = first.lastIndexOf("/pull/");
  return at > 0 ? `${first.slice(0, at)}/pulls` : null;
}

/** The line under the heading while it waits, when nothing came back, or when it fails. */
export function statusLine(card: Card): string {
  if (card.state === "loading") return "Asking GitHub…";
  if (card.state === "failed") return card.message;
  if (card.pulls.length > 0) return "";
  const what = card.title.replace(/^(\w)/, (c) => c.toLowerCase());
  return card.repo ? `No ${what} in ${card.repo}.` : `No ${what}.`;
}

/** One row's words: its state, checks and when it changed (each may be empty but the state), the meta line they
 *  make under the title, and what a screen reader hears for the row. */
export function rowWords(pull: Pull, now: number): { state: string; checks: string; when: string; meta: string; label: string } {
  const when = ago(pull.updated, now);
  const parts = { state: STATE_WORD[pull.state], checks: checksWords(pull), when: when && `updated ${when}` };
  const said = [parts.state, parts.checks, parts.when].filter(Boolean);
  return { ...parts, meta: said.join(" · "), label: `#${pull.number} ${pull.title}. ${said.join(", ")}. Opens on GitHub.` };
}

/** All the card's words, as a slow reader reads them. */
export function cardText(card: Card, now: number): string {
  return [card.title, card.repo, statusLine(card), ...card.pulls.map((p) => `#${p.number} ${p.title} ${rowWords(p, now).meta}`)].filter(Boolean).join(" ");
}

/** How long the card stays once it has its answer, unless the pointer or focus is on it: long enough for a slow reader
 *  to read every row (notice-rules `upFor`) and then reach for one (`REACH_MS`). A failure is read, not acted on. While
 *  it waits for GitHub it stays (the core gives up at 10 s and says so). */
export function lingerMs(card: Card, now: number): number {
  if (card.state === "loading") return 0;
  const read = upFor(cardText(card, now));
  return card.state === "ready" && card.pulls.length > 0 ? read + REACH_MS : read;
}

/** What a screen reader hears once the answer comes. */
export function announcement(card: Card): string {
  if (card.state !== "ready" || card.pulls.length === 0) return statusLine(card);
  const n = card.pulls.length;
  const where = card.repo ? ` in ${card.repo}` : "";
  // One asked by number: its own words, not a count.
  if (/^Pull request #/.test(card.title)) return `${card.title}${where}: ${rowWords(card.pulls[0], Date.now()).meta}.`;
  return `${card.title}${card.repo ? ` in ${card.repo}` : ""}: ${n}${card.more ? " shown, more on GitHub" : ""}.`;
}
