// No extra dependencies: run with `node scripts/dates-check.mjs` (precheck runs it with the other checks).
// Nothing here may read as work from before this repository: the README says everything was written during the
// event and the first commit is from Oct 31. So:
// - README, CHANGELOG and docs/: no date before the first commit, except the event's own span ("Oct 26 to Nov 4").
// - Code and scripts: no measurement (median, slowest, n = …, journals, 1,015 turns, 5 runs, measured, took) dated before the
//   first commit. Dates in tests and examples ("2026-10-13T09:12:00Z", an imported chat's day) are input, not claims.
// `node scripts/dates-check.mjs --self-test` plants each kind of breach and checks it's caught.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
/** The first commit's day (README: "the first commit is from Oct 31"). */
export const FIRST = "2026-10-31";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const EVENT_SPAN = /Oct 26 to Nov 4, 2026/g;
const MEASURE = /\b(measured|median|percentile|p(50|90|95|99)|slowest|fastest|journals?|took|n ?[=≈] ?\d)\b|\d[\d,]* (turns|runs|placements|calls)\b/i;

/** ISO days (2026-10-27) and short month names with a day (Oct 27, or Nov 1, 2025), as YYYY-MM-DD; a month name
 *  without a year takes the event's. */
export function days(line) {
  const iso = [...line.matchAll(/\b(20\d\d)-(\d\d)-(\d\d)/g)].map((m) => `${m[1]}-${m[2]}-${m[3]}`);
  const named = [...line.replace(EVENT_SPAN, "").matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? (\d{1,2})\b(?:,? (20\d\d)\b)?/g)]
    .map((m) => `${m[3] ?? "2026"}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`);
  return [...iso, ...named];
}

const COMMENT = /^\s*(\/\/|\/\*|\*|#(?![!\[]))/;

/** Each line's context for the measurement test: a comment line is read with its whole comment block (a measurement's
 *  keyword and its date often sit on different lines of one comment); any other line alone. */
function contexts(lines) {
  const out = lines.slice();
  for (let i = 0; i < lines.length; ) {
    if (!COMMENT.test(lines[i])) { i++; continue; }
    let j = i;
    while (j < lines.length && COMMENT.test(lines[j])) j++;
    const block = lines.slice(i, j).join(" ");
    for (let k = i; k < j; k++) out[k] = block;
    i = j;
  }
  return out;
}

/** The lines of one file that date something before the first commit; prose: any date, code: a measurement's date. */
export function early(text, prose) {
  const lines = text.split("\n");
  const context = contexts(lines);
  return lines.flatMap((line, i) => {
    const before = days(line).filter((d) => d < FIRST);
    if (!before.length || (!prose && !MEASURE.test(context[i]))) return [];
    return [`${i + 1}: ${before.join(", ")}: ${line.trim().slice(0, 140)}`];
  });
}

function selfTest() {
  // Each was in the repo or is its sibling: the README's placement line, the placer's comment, a word date in a doc.
  assert.equal(early("placing alone median 2.8 s over 1,015 turns (2026-10-27 to 11-01, core/src/placer.rs)", true).length, 1);
  assert.equal(early("/// journals (2026-10-27 to 11-01), median 2.8 s, 99th percentile 6.5 s, slowest 11.0 s.", false).length, 1);
  assert.equal(early("Measured on Oct 28: median 3 s.", true).length, 1);
  assert.equal(early("// took 9.7 s (2026-10-30)", false).length, 1);
  // A measurement whose keyword and date sit on different lines of one comment; a named date's own year.
  assert.equal(early("/// The 2,000 tokens that ran out took 9.7 s\n/// (2026-10-30), so 4 s and 8 ms a token of room.", false).length, 1);
  assert.equal(early("Measured on Nov 1, 2025: median 3 s.", true).length, 1);
  // Allowed: the event span, dates from this week, and dates that are a test's or an example's input.
  assert.equal(early("Built during the hackathon (Oct 26 to Nov 4, 2026); measured 2026-11-01, n = 9.", true).length, 0);
  assert.equal(early('assert_eq!(parse_time("2026-10-13"), parse_time("2026-10-13T00:00:00Z"));', false).length, 0);
  assert.equal(early("/// \"2026-10-13 (Tue)\" in local time.", false).length, 0);
  assert.equal(early("// took the chat's own day\nlet day = parse(\"2026-10-13\");", false).length, 0);
  assert.equal(early("Planned for Oct 28, 2027.", true).length, 0);
  assert.equal(early("at 10:30 on Oct 29:", true).length, 1);
}

if (process.argv.includes("--self-test")) {
  selfTest();
  console.log("dates-check self-test: OK");
} else {
  selfTest();
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root }).toString().split("\0").filter(Boolean);
  const prose = (f) => /^(README|CHANGELOG)\.md$|^docs\/.*\.md$/.test(f);
  const code = (f) => /^(core\/src|ui\/src|scripts)\/.*\.(rs|ts|tsx|css|mjs|js|sh|py|pl)$|^run\.sh$/.test(f) && f !== "scripts/dates-check.mjs";
  const found = files.filter((f) => prose(f) || code(f))
    .flatMap((f) => early(readFileSync(root + f, "utf8"), prose(f)).map((hit) => `${f}:${hit}`));
  assert.ok(!found.length, `dated before the first commit (${FIRST}), which reads as earlier work:\n  ${found.join("\n  ")}`);
  console.log("dates-check: OK");
}
