// No extra dependencies: run with `node scripts/notice-check.mjs`.
// Which notices stay until dismissed and how long the rest are up (ui/src/notice-rules.ts), and that a notice the
// window makes itself drops an older Undo (ui/src/core.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "../ui/node_modules/vite/dist/node/index.js";

const server = await createServer({ root: new URL("../ui", import.meta.url).pathname,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
try {
  const { staysUp, upFor, SHORTEST_MS } = await server.ssrLoadModule("/src/notice-rules.ts");
  const { readMs } = await server.ssrLoadModule("/src/attention-core.ts");

  // Each of these asks for something only the person can do, or says the core is gone: up until dismissed.
  for (const notice of [
    "The mic stopped. Tap it to keep talking.",
    "Microphone access is off. Allow it in your browser settings, or type below.",
    "Couldn't start the mic. Try again. You can type below.",
    "Connection lost. Reconnect to use the microphone; you can still type below.",
    "The AI key was refused. Check MODEL_API_KEY in .env, then restart.",
  ]) assert.ok(staysUp(notice), notice);

  // Answers go after their reading time. A missing key is said by the header, the composer and the tour: kept up, the
  // notice covered the Apps bar and the tour's last step on a keyless first run. "Already off" asks nothing.
  for (const notice of [
    "MODEL_API_KEY is not set: listening and placement are off.",
    "The mic is already off.",
    "Back to Rent is due",
    "Kept as a thought: it didn't read as a request",
  ]) assert.ok(!staysUp(notice), notice);

  // Up for at least as long as before, longer when the words take longer to read.
  assert.equal(upFor("Back to Rent"), SHORTEST_MS);
  const keyless = "No AI key: you can browse the map, but new thoughts and listening need MODEL_API_KEY in .env (see .env.example).";
  assert.equal(upFor(keyless), Math.max(SHORTEST_MS, readMs(keyless)));
  const long = "Did “Expand the garden” instead. Your earlier words are off the map, and the journal keeps them if you want them back later.";
  assert.equal(upFor(long), readMs(long));
  assert.ok(upFor(long) > SHORTEST_MS);

  // A notice made in the window is a newer answer: it clears the Undo an earlier one offered.
  const core = readFileSync(new URL("../ui/src/core.ts", import.meta.url), "utf8");
  assert.match(core, /showNotice: \(message: string\) => \{ setNotice\(message\); setUndoId\(null\); \}/);
  console.log("notice-check: ok");
} finally {
  await server.close();
}
