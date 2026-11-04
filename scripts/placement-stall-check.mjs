// Real loopback HTTP, the shipped two-lane placer and real elapsed time. No provider or app server required.
// Rust owns the queue/journal/focus assertions; this entry point requires all three cases and reports their timings.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const result = spawnSync("cargo", ["test", "--quiet", "--manifest-path", "core/Cargo.toml", "placement_stall_", "--", "--nocapture", "--test-threads=1"], {
  cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
});
if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stdout + result.stderr);
  process.exit(result.status ?? 1);
}
const rows = [...result.stdout.matchAll(/placement-stall-metrics: (\{[^\n]+\})/g)].map((match) => JSON.parse(match[1]));
assert.deepEqual(rows.map((row) => row.case).sort(), ["6000-character paste", "cut-off then stall", "short"]);
for (const row of rows) {
  assert.equal(row.bound_ms, 5000);
  assert.ok(row.healthy_ms <= row.bound_ms + 1000, `${row.case}: healthy thought exceeded the bound plus 1 s`);
  assert.ok(row.retry_ms > row.healthy_ms, `${row.case}: retry must finish after the healthy thought`);
  if (row.chars === 6000) assert.equal(row.room, 12000, "the long paste keeps its full token room");
  console.log(`${row.case}: healthy ${row.healthy_ms} ms; retry ${row.retry_ms} ms; ${row.requests} calls; ${row.room} token room`);
}
console.log("placement-stall-check: ok (simulated provider stalls; not production latency)");
