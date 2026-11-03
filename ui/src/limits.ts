// Bounds on what this window sends: the core's numbers (core/src/protocol.rs, which says why each is what it is),
// checked here first, with long thoughts split before sending. scripts/limits-check.mjs keeps them equal.

/** A typed thought, in characters. */
export const THOUGHT_MAX = 6_000;
/** A typed title, in characters. */
export const TITLE_MAX = 100;
/** A topic's name as a person types it, in characters. */
export const TOPIC_MAX = 40;
/** One message to the core, in bytes. */
export const FRAME_MAX = 64 << 10;
/** How far from the canvas's origin a place may be, on either axis, in canvas pixels; past it the core refuses it. */
export const POSITION_MAX = 1_000_000;

export const THOUGHT_TOO_LONG = "Too long for one thought: 6,000 characters at most. Send it in parts.";
export const TOO_BIG = "Too long to send. Try a shorter one.";

/** What to say instead of sending a typed thought, or null when it fits: counted as the core counts, trimmed, by
 * character (an emoji is one, not two UTF-16 units). */
export function tooLongThought(text: string): string | null {
  return [...text.trim()].length > THOUGHT_MAX ? THOUGHT_TOO_LONG : null;
}

/** Split by Unicode character, preferring paragraph breaks, then sentence ends, then whitespace.
 * An unbroken word still has to fit. Only whitespace at a part's edges is removed. */
export function splitThought(text: string): string[] {
  const chars = [...text.trim()];
  const parts: string[] = [];
  let start = 0;
  while (start < chars.length) {
    let end = Math.min(start + THOUGHT_MAX, chars.length);
    if (end < chars.length) {
      let paragraph = 0, sentence = 0, word = 0;
      let sentenceEnd = false;
      for (let i = start; i < end; i++) {
        const char = chars[i];
        if (/\s/u.test(char)) {
          if (char === "\n" || char === "\r") paragraph = i + 1;
          if (sentenceEnd) sentence = i;
          word = i + 1;
        } else if (/[.!?。！？]/u.test(char)) sentenceEnd = true;
        else if (!/["'”’）)\]]/u.test(char)) sentenceEnd = false;
      }
      // A paragraph, sentence or word ending exactly at the cap belongs in this part.
      if (/\s/u.test(chars[end])) {
        word = end;
        if (sentenceEnd) sentence = end;
        if (chars[end] === "\n" || chars[end] === "\r") paragraph = end;
      }
      end = paragraph || sentence || word || end;
    }
    const part = chars.slice(start, end).join("").trim();
    if (part) parts.push(part);
    start = end;
    while (start < chars.length && /\s/u.test(chars[start])) start++;
  }
  return parts;
}

/** A title as the box holds it: at most `TITLE_MAX` characters, counted as the core counts (by character, not
 * UTF-16 unit, so 60 "𠮷" fit where a native `maxLength` would cut them to 50). */
export function clipTitle(text: string): string {
  const chars = [...text];
  return chars.length > TITLE_MAX ? chars.slice(0, TITLE_MAX).join("") : text;
}

/** What to say instead of sending a message, or null when it fits: bytes on the wire. */
export function tooBig(data: string | ArrayBuffer): string | null {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data).length : data.byteLength;
  return bytes > FRAME_MAX ? TOO_BIG : null;
}
