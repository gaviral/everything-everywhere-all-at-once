// Bounds on what this window sends: the core's numbers (core/src/protocol.rs, which says why each is what it is),
// checked here first so a long paste gets a calm word and keeps its draft. scripts/limits-check.mjs keeps them equal.

/** A typed thought, in characters. */
export const THOUGHT_MAX = 6_000;
/** A typed title, in characters. */
export const TITLE_MAX = 100;
/** One message to the core, in bytes. */
export const FRAME_MAX = 64 << 10;

export const THOUGHT_TOO_LONG = "Too long for one thought: 6,000 characters at most. Send it in parts.";
export const TOO_BIG = "Too long to send. Try a shorter one.";

/** What to say instead of sending a typed thought, or null when it fits: counted as the core counts, trimmed, by
 * character (an emoji is one, not two UTF-16 units). */
export function tooLongThought(text: string): string | null {
  return [...text.trim()].length > THOUGHT_MAX ? THOUGHT_TOO_LONG : null;
}

/** What to say instead of sending a message, or null when it fits: bytes on the wire. */
export function tooBig(data: string | ArrayBuffer): string | null {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data).length : data.byteLength;
  return bytes > FRAME_MAX ? TOO_BIG : null;
}
