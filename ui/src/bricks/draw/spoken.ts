// Spoken commands: which whole sentences this sheet answers. Each is one trigger, kept here where a person can read them.
const BUILD_ALL = /\b(build|make|do) (it |that |this )?all( of)?( that| this| it)?\b|\bbuild everything\b/i;
export const buildAllIn = (sentence: string) => BUILD_ALL.test(sentence);

export type Command = "open" | "read" | "back" | "build" | "undo" | "clear" | "close";

const TRIGGERS: readonly [Command, RegExp][] = [
  ["open", /\b(let me draw|i'?ll draw (it|this|that)|give me (a|the) pen|open (the )?(sheet|drawing))\b/i],
  ["read", /\b(what do you see|what is this|read (this|that|it|the drawing)|look at (this|that|it)|can you see (this|that|it))\b/i],
  ["back", /\bdraw (it|this|that) back\b|\bdraw (it|this|that) (properly|cleanly|for me|better)\b|\byour turn\b/i],
  ["build", BUILD_ALL],
  ["build", /\b(build|make) (this|that|it)\b|\bturn (this|that|it) into (boxes|a flow)\b/i],
  ["undo", /\b(undo (that|this|it)|take (that|this|it) back)\b/i],
  ["clear", /\b(clear (the|this) (sheet|drawing)|start over|wipe (it|this))\b/i],
  ["close", /\b(put the pen down|close the (sheet|drawing)|done drawing)\b/i],
];

/** The last command in a finished sentence wins: "undo that, then read it" reads. */
export function commandIn(sentence: string): Command | null {
  let found: Command | null = null, latest = -1;
  for (const [command, pattern] of TRIGGERS) {
    const match = sentence.match(pattern);
    if (match && (match.index ?? 0) >= latest) { found = command; latest = match.index ?? 0; }
  }
  return found;
}
