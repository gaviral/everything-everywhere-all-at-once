// No extra dependencies: run with `node scripts/limits-check.mjs`.
// Bounded inputs in the window (ui/src/limits.ts): the same numbers as the core's (core/src/protocol.rs), counted
// the way the core counts; long thoughts split at natural breaks and oversized frames are refused.
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
  const split = limits.splitThought, max = limits.THOUGHT_MAX;
  assert.deepEqual(split("  \n \t"), []);
  assert.deepEqual(split(`  ${at}  `), [at], "exact Unicode cap");
  assert.deepEqual(split(`${at}🙂`), [at, "🙂"], "never cuts a surrogate pair");
  const para = "p".repeat(1000), sentence = "s".repeat(2000) + ".", tail = "w ".repeat(2000);
  assert.equal(split(`${para}\r\n\r\n${sentence} ${tail}`)[0], para, "paragraph wins over later sentences and words");
  assert.equal(split(`${sentence} ${tail}`.repeat(2))[0], sentence, "sentence wins over later words");
  const words = "word ".repeat(1600);
  assert.deepEqual(split(words), ["word ".repeat(1200).trim(), "word ".repeat(400).trim()]);
  assert.deepEqual(split("x".repeat(max * 2 + 1)), ["x".repeat(max), "x".repeat(max), "x"], "unbroken text");
  assert.equal(split(`${"x".repeat(max - 1)}. rest`)[0].length, max, "sentence ends exactly at cap");
  assert.deepEqual(split(`${"p".repeat(10)}\n${"q".repeat(max - 11)}\n\nrest`), [`${"p".repeat(10)}\n${"q".repeat(max - 11)}`, "rest"], "a paragraph ending exactly at the cap stays whole");
  for (const input of [words, `${para}\n\n${sentence} ${tail}`, "🙂".repeat(max * 3), "a" + " ".repeat(max * 2) + "b"]) {
    const parts = split(input);
    assert.ok(parts.every((part) => part.trim() && [...part].length <= max), "nonempty bounded parts");
    assert.equal(parts.join("").replace(/\s/gu, ""), input.replace(/\s/gu, ""), "content and order preserved");
  }
  // Bytes on the wire for a frame: 3-byte characters count three times.
  assert.equal(limits.tooBig("€".repeat(Math.floor(limits.FRAME_MAX / 3))), null);
  assert.equal(limits.tooBig("€".repeat(Math.floor(limits.FRAME_MAX / 3) + 1)), limits.TOO_BIG);
  assert.equal(limits.tooBig(new ArrayBuffer(3840)), null, "a mic frame");
  assert.equal(limits.tooBig(new ArrayBuffer(limits.FRAME_MAX + 1)), limits.TOO_BIG);
  // The largest real message fits: Explain on a thought at the cap, with that thought as its context.
  const widest = "𝄞".repeat(limits.THOUGHT_MAX); // 4 bytes each
  assert.equal(limits.tooBig(JSON.stringify({ type: "explain", id: "x", text: widest, context: widest, thread_id: "T1" })), null);
  // A title clips by character, as the core counts: 60 "𠮷" (120 UTF-16 units) all fit; one past the cap is cut.
  assert.equal(limits.clipTitle("𠮷".repeat(60)), "𠮷".repeat(60));
  assert.equal(limits.clipTitle("𠮷".repeat(limits.TITLE_MAX + 1)), "𠮷".repeat(limits.TITLE_MAX));
  assert.equal(limits.clipTitle("a".repeat(limits.TITLE_MAX)), "a".repeat(limits.TITLE_MAX));
  // Calm: no blame, no jargon, says what to do.
  for (const words of [limits.THOUGHT_TOO_LONG, limits.TOO_BIG]) assert.doesNotMatch(words, /error|invalid|frame|byte|exceed/i);

  // The window uses them: every message passes `tooBig`, a typed thought is split before sending,
  // and the title box clips at the cap by character.
  const core = read("ui/src/core.ts");
  assert.match(core, /const send = useCallback\(\(data: string \| ArrayBuffer\) => \{\s*const big = tooBig\(data\);/);
  assert.match(core, /const parts = splitThought\(text\);/);
  // (not a native maxLength: it counts UTF-16 units, so it would cut a title the core accepts)
  const moves = read("ui/src/Moves.tsx");
  assert.doesNotMatch(moves, /maxLength/);
  assert.match(moves, /className="title-input"[\s\S]*?onInput=\{\(event\) => \{\s*const box = event\.currentTarget;\s*const clipped = clipTitle\(box\.value\);/);
} finally {
  await server.close();
}
console.log("limits-check: ok");
