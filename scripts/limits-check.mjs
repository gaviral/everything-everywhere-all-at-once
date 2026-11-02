// No extra dependencies: run with `node scripts/limits-check.mjs`.
// Bounded inputs in the window (ui/src/limits.ts): the same numbers as the core's (core/src/protocol.rs), counted
// the way the core counts; a thought past the cap and a message past the frame cap get a calm notice instead of
// being sent, and the window's senders and title box use them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { uiServer } from "./ui-server.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const server = await uiServer();
try {
  const limits = await server.ssrLoadModule("/src/limits.ts");

  // The core's numbers and words, one source each side.
  const protocol = read("core/src/protocol.rs");
  const rust = (name) => {
    const m = protocol.match(new RegExp(`pub const ${name}: usize = ([0-9_]+)(?: << ([0-9]+))?;`));
    assert.ok(m, `${name} in protocol.rs`);
    return Number(m[1].replaceAll("_", "")) * 2 ** Number(m[2] ?? 0);
  };
  for (const name of ["THOUGHT_MAX", "TITLE_MAX", "FRAME_MAX"]) assert.equal(limits[name], rust(name), name);
  assert.ok(protocol.includes(`pub const THOUGHT_TOO_LONG: &str = "${limits.THOUGHT_TOO_LONG}";`), "the same words as the core");

  // Characters as the core counts them: an emoji is one, not two UTF-16 units.
  const at = "🙂".repeat(limits.THOUGHT_MAX);
  assert.equal(limits.tooLongThought(at), null);
  assert.equal(limits.tooLongThought(`  ${"a".repeat(limits.THOUGHT_MAX)}  `), null, "trimmed first, as the core does");
  assert.equal(limits.tooLongThought(`${at}a`), limits.THOUGHT_TOO_LONG);
  // Bytes on the wire for a frame: 3-byte characters count three times.
  assert.equal(limits.tooBig("€".repeat(Math.floor(limits.FRAME_MAX / 3))), null);
  assert.equal(limits.tooBig("€".repeat(Math.floor(limits.FRAME_MAX / 3) + 1)), limits.TOO_BIG);
  assert.equal(limits.tooBig(new ArrayBuffer(3840)), null, "a mic frame");
  assert.equal(limits.tooBig(new ArrayBuffer(limits.FRAME_MAX + 1)), limits.TOO_BIG);
  // The largest real message fits: Explain on a thought at the cap, with that thought as its context.
  const widest = "𝄞".repeat(limits.THOUGHT_MAX); // 4 bytes each
  assert.equal(limits.tooBig(JSON.stringify({ type: "explain", id: "x", text: widest, context: widest, thread_id: "T1" })), null);
  // Calm: no blame, no jargon, says what to do.
  for (const words of [limits.THOUGHT_TOO_LONG, limits.TOO_BIG]) assert.doesNotMatch(words, /error|invalid|frame|byte|exceed/i);

  // The window uses them: every message passes `tooBig`, a typed thought `tooLongThought` (keeping the draft),
  // and the title box stops at the cap.
  const core = read("ui/src/core.ts");
  assert.match(core, /const send = useCallback\(\(data: string \| ArrayBuffer\) => \{\s*const big = tooBig\(data\);/);
  assert.match(core, /sendText: \(text: string\) => \{\n(?:.*\n){0,3}.*tooLongThought\(text\)/);
  assert.match(read("ui/src/Moves.tsx"), /className="title-input"[^>]*maxLength=\{TITLE_MAX\}/);
} finally {
  await server.close();
}
console.log("limits-check: ok");
