// The shell (docs/bricks.md "Slots"): four corners and no header bar, the stage at the bottom center, a status line
// flush at the bottom, the rail at the right. It is the page: without a flag the shell opens. `?shell=1` opens the
// classic page (the header and bottom bar it replaced) for one more release, and so does `?cards`, the classic page
// opened on Cards, as it always did. `?shell=2`, the shell's old address, still opens the shell, even beside `?cards`.
// The features playground (bricks.html) is not the app's page: it keeps the classic look unless `?shell=2` asks.
// Read once, before the first render: the page never switches shells while it runs. The class on <html> scopes the
// shell's tokens and layout (styles.css, shell/shell.css).

const params = typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);
const playground = typeof location !== "undefined" && /\/bricks\.html$/.test(location.pathname ?? "");
const asked = params.get("shell");

/** Whether this visit is the shell. (The name is the flag's old value, `?shell=2`; the class on <html> is `shell2` too.) */
export const SHELL2 = asked === "2" || (asked !== "1" && !params.has("cards") && !playground);

/** Open the classic page on Cards instead of the Canvas for this visit (the shell has no such start: it opens on the Canvas). */
export const CARDS_FLAG = params.has("cards");

/** Features the shell is built around: on, with no switch (the Features page lists them as built in). The Canvas (the
 *  Spine) is the view it opens in; the fly-in (bubble-flight), the tiny transcript and the Notification history
 *  (notice-timeline) join it (its list is the History tab's). The classic page opens on the Canvas too. */
export const CORE_BRICKS: readonly string[] = SHELL2 ? ["spine", "bubble-flight", "tiny-transcript", "notice-timeline"] : ["spine"];

/** A scripted demo (`?demo`): the DEMO stamp says so, top left, so a take never passes for real talk. */
export const DEMO = params.has("demo");

/** The sample map asked for in the address (`?sample`): stamped SAMPLE, as one loaded from the first screen is. */
export const SAMPLE_FLAG = params.has("sample");

if (typeof document !== "undefined") {
  // index.html ships the class, so the shell's paper is there from the first paint; the classic page drops it.
  const classes = document.documentElement?.classList;
  if (SHELL2) classes?.add("shell2"); else classes?.remove("shell2");
}
