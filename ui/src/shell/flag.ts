// The revamped shell (docs/bricks.md "Slots"): four corners and no header bar, the stage at the bottom center, a
// status line flush at the bottom, the rail at the right. Behind `?shell=2` until three clean takes switch it on for
// everyone; without the flag the page is today's. Read once, before the first render: the page never switches shells
// while it runs. The class on <html> scopes the shell's tokens and layout (styles.css, shell/shell.css).

const params = typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);

export const SHELL2 = params.get("shell") === "2";

/** Features the shell is built around: on, with no switch (the Catalog lists them as built in). The Canvas (the Spine)
 *  is the view it opens in (User, 19:1x: "spine thingy should be made as the default view"); the flight, the tiny
 *  transcript and the Notice timeline join it (its list is the History tab's). Today's page: none yet (the card's spec). */
export const CORE_BRICKS: readonly string[] = SHELL2 ? ["spine", "bubble-flight", "tiny-transcript", "notice-timeline"] : [];

/** A scripted demo (`?demo`): the DEMO stamp says so, top left, so a take never passes for real talk. */
export const DEMO = params.has("demo");

/** The sample map asked for in the address (`?sample`): stamped SAMPLE, as one loaded from the first screen is. */
export const SAMPLE_FLAG = params.has("sample");

if (SHELL2 && typeof document !== "undefined") document.documentElement.classList.add("shell2");
