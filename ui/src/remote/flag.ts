// The Remote (`?remote`): a phone's page for the AI helpers' work, apart from the map. Read once, before the first render
// (main.tsx), as the shell's flag is.
const params = typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);

export const REMOTE = params.has("remote");

/** The name the room's menu suggests this phone joins under, from `?remote=NAME` (`remoteLink`): none for a bare `?remote`.
 *  Kept to the length the room allows (room.tsx). */
export const REMOTE_NAME = (params.get("remote") ?? "").trim().replace(/\s+/g, " ").slice(0, 24);

/** The link that opens a Remote on a phone, from the room's invite (`invite`, which carries the code): the same address,
 *  so it comes in by the same code and no other way, and `remote=` with the name it joins under, "<your name>'s phone". The
 *  laptop's own name is taken in the room (a name carries a person's private words), so a phone asked for it would meet
 *  an error; and the name says whose phone is listed in the room. A name too long to fit becomes "My phone". */
export function remoteLink(invite: string, me: string): string {
  const name = `${me}'s phone`;
  return `${invite}${invite.includes("?") ? "&" : "?"}remote=${encodeURIComponent(name.length <= 24 ? name : "My phone")}`;
}

/** How much faster than real time the page's own demo feed plays: `?speed=4` is four times, so a take needn't wait the
 *  half minute the feed takes to ask its question. One by default; at most 60. */
export const SPEED = (() => {
  const asked = Number(params.get("speed"));
  return Number.isFinite(asked) && asked > 0 ? Math.min(asked, 60) : 1;
})();
