// No extra dependencies: run with `node scripts/pulls-card-check.mjs`.
// The GitHub card (ui/src/pulls-card.ts, fed the core's `pulls_card` messages, core/src/github.rs): each pull request's
// state, checks and when it changed in a few words, only web links open, a late answer never replaces a newer ask,
// and the card stays long enough to read every row and reach for one. The window never reaches GitHub itself: the
// core reads gh (its tests stand in for gh), and nothing in the card writes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { uiServer } from "./ui-server.mjs";

const src = (name) => readFileSync(new URL(`../ui/src/${name}`, import.meta.url), "utf8");

globalThis.location = new URL("http://localhost:4321/");
const server = await uiServer();
try {
  const { received, gone, NO_PULLS, checksWords, ago, safeUrl, allUrl, statusLine, rowWords, lingerMs, announcement } = await server.ssrLoadModule("/src/pulls-card.ts");
  const { upFor, REACH_MS } = await server.ssrLoadModule("/src/notice-rules.ts");
  const now = Date.parse("2026-11-02T12:00:00Z");
  const pull = (extra = {}) => ({ number: 42, title: "Water the raised beds on a schedule", state: "open", checks: "passing", failing: 0, total: 2, updated: "2026-11-02T09:00:00Z", url: "https://github.com/acme/garden-planner/pull/42", ...extra });
  const msg = (extra = {}) => ({ type: "pulls_card", id: 1, title: "Open pull requests", repo: "acme/garden-planner", state: "ready", pulls: [pull()], more: false, message: "", ...extra });

  // A row in a few words: state, then checks (a failure says how many), then when it changed.
  assert.deepEqual(rowWords(pull(), now), {
    state: "Open", checks: "Checks pass", when: "updated 3 h ago", meta: "Open · Checks pass · updated 3 h ago",
    label: "#42 Water the raised beds on a schedule. Open, Checks pass, updated 3 h ago. Opens on GitHub.",
  });
  assert.equal(checksWords(pull({ checks: "failing", failing: 1, total: 3 })), "1 of 3 checks fail");
  assert.equal(checksWords(pull({ checks: "failing", failing: 1, total: 1 })), "1 of 1 check fails");
  assert.equal(checksWords(pull({ checks: "running" })), "Checks running");
  assert.equal(rowWords(pull({ checks: "none", total: 0, state: "draft" }), now).meta, "Draft · updated 3 h ago", "no checks: nothing said");
  assert.equal(rowWords(pull({ state: "merged" }), now).state, "Merged");

  // When, as a glance reads it.
  assert.equal(ago("2026-11-02T11:59:40Z", now), "just now");
  assert.equal(ago("2026-11-02T11:48:00Z", now), "12 min ago");
  assert.equal(ago("2026-10-31T12:00:00Z", now), "2 d ago");
  assert.equal(ago("2026-10-12T12:00:00Z", now), "Oct 12");
  assert.equal(ago("2025-10-12T12:00:00Z", now), "Oct 12, 2025");
  assert.equal(ago("not a date", now), "");

  // Only a web link opens; "See all" goes to the same repo's list on the same host.
  assert.equal(safeUrl("https://github.com/acme/garden-planner/pull/42"), "https://github.com/acme/garden-planner/pull/42");
  for (const bad of ["javascript:alert(1)", "http://github.com/x", "file:///etc/hosts", ""]) assert.equal(safeUrl(bad), null, bad);
  assert.equal(allUrl({ ...msg(), more: true }), "https://github.com/acme/garden-planner/pulls");
  assert.equal(allUrl({ ...msg(), pulls: [] }), null);

  // A newer ask replaces the card; a late answer to an older one never does.
  const first = received(NO_PULLS, msg({ state: "loading", pulls: [] }));
  assert.equal(first.card.state, "loading");
  const second = received(first, msg({ id: 2, state: "loading", pulls: [], title: "Pull request #7" }));
  assert.equal(received(second, msg({ id: 1 })), second, "the older answer is dropped");
  assert.equal(received(second, msg({ id: 2, title: "Pull request #7" })).card.state, "ready");
  // Closed while it waits: its answer doesn't bring it back, and neither does an older ask's.
  const closed = gone(second, 2);
  assert.equal(closed.card, null);
  assert.equal(received(closed, msg({ id: 2 })), closed, "a closed ask's answer stays away");
  assert.equal(received(closed, msg({ id: 1 })), closed, "an older ask's answer stays away after the newer one closed");
  assert.equal(received(closed, msg({ id: 3, state: "loading", pulls: [] })).card.id, 3, "a new ask still shows");
  assert.equal(gone(second, 1).card, second.card, "closing an older ask leaves the newer card up");
  // A new connection starts over: a restarted core numbers its asks from 1, and they show.
  assert.equal(received(NO_PULLS, msg({ id: 1, state: "loading", pulls: [] })).card.id, 1);
  assert.match(src("core.ts"), /ws\.onclose = \(\) => \{[\s\S]*?setPulls\(NO_PULLS\)[\s\S]*?\n      \};/, "the card and its order reset when the connection ends");

  // Held by the pointer and by focus apart: moving the pointer off leaves a focused card up.
  const view = src("PullsCard.tsx");
  assert.match(view, /const held = hovered \|\| focused;/);
  assert.match(view, /onMouseLeave=\{\(\) => setHovered\(false\)\}/);
  // Long titles wrap, so the card scrolls inside itself rather than running under the composer.
  assert.match(src("pulls-card.css"), /\.pulls-card \{[^}]*max-height:[^}]*overflow-y: auto;/);

  // Its lines: waiting, nothing there, and a calm failure.
  assert.equal(statusLine(msg({ state: "loading", pulls: [] })), "Asking GitHub…");
  assert.equal(statusLine(msg({ pulls: [] })), "No open pull requests in acme/garden-planner.");
  assert.equal(statusLine(msg({ pulls: [], repo: "" })), "No open pull requests.");
  const signedOut = "gh isn't signed in to GitHub: run gh auth login in Terminal, then ask again.";
  assert.equal(statusLine(msg({ state: "failed", pulls: [], message: signedOut })), signedOut);
  assert.equal(statusLine(msg()), "", "rows say it all");

  // How long it stays: while waiting, until the answer; then long enough to read every row and reach for one.
  assert.equal(lingerMs(msg({ state: "loading", pulls: [] }), now), 0);
  const ten = msg({ pulls: Array.from({ length: 10 }, (_, i) => pull({ number: 50 - i })) });
  assert.ok(lingerMs(ten, now) > lingerMs(msg(), now), "ten rows stay longer than one");
  assert.equal(lingerMs(msg({ state: "failed", pulls: [], message: signedOut }), now), upFor(`Open pull requests acme/garden-planner ${signedOut}`), "a failure is read, not acted on");
  assert.ok(lingerMs(msg(), now) >= upFor("x") + REACH_MS);
  assert.equal(announcement(ten), "Open pull requests in acme/garden-planner: 10.");
  assert.match(announcement(msg({ title: "Pull request #42" })), /^Pull request #42 in acme\/garden-planner: Open · Checks pass · updated /);
  assert.equal(announcement({ ...ten, more: true }), "Open pull requests in acme/garden-planner: 10 shown, more on GitHub.");

  // Read-only: the card's only actions are links and closing; it sends the core nothing.
  const card = src("PullsCard.tsx");
  assert.ok(!/send\(|JSON\.stringify|fetch\(/.test(card), "the card never sends anything");
  assert.match(card, /rel="noopener noreferrer"/);
  assert.match(src("core.ts"), /case "pulls_card":/);
  console.log("pulls-card-check: ok");
} finally {
  await server.close();
}
