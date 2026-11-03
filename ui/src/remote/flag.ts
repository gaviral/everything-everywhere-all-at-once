// The Remote (`?remote`): a phone's page for the AI helpers' work, apart from the map. Read once, before the first render
// (main.tsx), as the shell's flag is.
const params = typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);

export const REMOTE = params.has("remote");

/** How much faster than real time the page's own demo feed plays: `?speed=4` is four times, so a take needn't wait the
 *  half minute the feed takes to ask its question. One by default; at most 60. */
export const SPEED = (() => {
  const asked = Number(params.get("speed"));
  return Number.isFinite(asked) && asked > 0 ? Math.min(asked, 60) : 1;
})();
