#!/usr/bin/env node
// Composer check: sends app requests to running cores the way the Apps panel does (compose_app), waits for each
// build to settle, discards it so nothing changes, and says whether the result does what was asked. Every
// search and composition is a real model call.
//   PORT=4490 ./run.sh demo                  # a core with a key; Search-first is on in demo mode
//   node scripts/composer-check.mjs [--ports 4490,4491] [--runs 2] [--only 1,5] [--requests FILE] [--out results.json]
// Each line of the requests file: {"id", "request", "expect": any of "build", "match:APP_ID", "refuse", "notice"},
// and checks on a draft: "watcher" (kinds), "words" (a phrase or topic holds one; a thought watcher's prompt names
// one), "every" (seconds), "hour" (local hours a timer may start at, within a day), "prompt" (true: needs one that
// reads {thought} or {points}), "publishers" (at least one of these kinds), "repeats" (a timer that must keep
// showing something), "level" ([low, high] a volume watcher's level must sit in), "prompt" (false: none, so the
// app answers at once and can't decide to stay quiet), "all" (every one of these kinds); on a refusal, "words" (the
// reason names one) and "instead" (true: it offers the closest app).
// beat5-requests.jsonl holds the demo sentence (beat 5), its paraphrases and requests near it that must be refused:
// run it on a demo core with the Volume watcher removed (Apps › Steps › Remove app), as the take does.
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const file = option("requests", new URL("composer-requests.jsonl", import.meta.url).pathname);
const runs = Number(option("runs", 1));
const ports = String(option("ports", process.env.PORT ?? 4321)).split(",").map(Number);
const only = option("only") ? new Set(option("only").split(",").map(Number)) : null;
const out = option("out");
const SETTLED = ["ready", "matched", "declined", "failed"];
const OUTCOME = { ready: "built", matched: "matched", declined: "refused", failed: "failed" };
// A build can make up to three model calls of up to 45 s each.
const TIMEOUT_MS = 150_000;

const requests = readFileSync(file, "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line))
  .filter((r) => !only || only.has(r.id));

function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const listeners = new Set();
    let latest = null;
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "apps_build") latest = message.build;
      for (const listener of [...listeners]) listener(message);
    };
    ws.onerror = () => reject(new Error(`Couldn't reach a core on port ${port}. Start one with PORT=${port} ./run.sh demo`));
    ws.onopen = () => resolve({
      port,
      latest: () => latest,
      send: (message) => ws.send(JSON.stringify(message)),
      listen: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
      close: () => ws.close(),
    });
  });
}

// Resolves with the first message `pick` maps to something, or null after `ms`.
function wait(conn, pick, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { stop(); resolve(null); }, ms);
    const stop = conn.listen((message) => {
      const value = pick(message);
      if (value !== undefined) { clearTimeout(timer); stop(); resolve(value); }
    });
  });
}

async function discard(conn, build) {
  if (!build || !["ready", "matched"].includes(build.stage)) return;
  const done = wait(conn, (m) => m.type === "apps_build" && m.build.id === build.id && m.build.stage === "discarded" ? true : undefined, 5000);
  conn.send({ type: "decide_app", build_id: build.id, keep: false });
  await done;
}

async function compose(conn, request) {
  // A build left open by an earlier run would block this one.
  const open = conn.latest();
  if (open && !["kept", "discarded", ...SETTLED].includes(open.stage)) {
    await wait(conn, (m) => m.type === "apps_build" && SETTLED.includes(m.build.stage) ? true : undefined, TIMEOUT_MS);
  }
  await discard(conn, conn.latest());
  const started = Date.now();
  let id = null;
  const settled = wait(conn, (m) => {
    // The core keeps what follows "make an app that …", so the build's request ends what was sent.
    if (m.type === "apps_build" && !id && m.build.stage === "searching" && request.trim().endsWith(m.build.request.trim())) id = m.build.id;
    if (m.type === "apps_build" && m.build.id === id && SETTLED.includes(m.build.stage)) return { build: m.build };
    if (m.type === "notice" && !id) return { notice: m.message };
    return undefined;
  }, TIMEOUT_MS);
  conn.send({ type: "compose_app", request });
  const result = (await settled) ?? { timeout: true };
  const ms = Date.now() - started;
  // A failed build also sends a notice; take it here, or the next request would read it as its own answer.
  if (result.build?.stage === "failed") await wait(conn, (m) => m.type === "notice" ? true : undefined, 2000);
  await discard(conn, result.build);
  if (result.notice) return { outcome: "notice", message: result.notice, ms };
  if (result.timeout) return { outcome: "timeout", message: "", ms };
  const b = result.build;
  return { outcome: OUTCOME[b.stage], message: b.message, steps: b.steps, draft: b.draft, match_id: b.match_id,
    instead: b.instead ?? "", retried: b.steps.includes("Fixing one detail"), ms };
}

function blocks(app) {
  const w = app.watcher;
  const when = {
    new_thought: `new_thought${w.min_points > 1 ? ` ≥${w.min_points}` : ""}`,
    phrase: `phrase "${w.phrase}"`,
    topic: `topic "${w.topic}"`,
    volume: `volume ${w.level} for ${w.seconds}s`,
    time: `time ${new Date(w.at_ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${w.every_secs ? ` every ${w.every_secs}s` : ""}`,
  }[w.kind] ?? w.kind;
  return `${when}${app.prompt ? " + prompt" : ""} → ${app.publishers.map((p) => p.kind).join(", ")}`;
}

const has = (text, words) => words.some((word) => text.toLowerCase().includes(word.toLowerCase()));

// What keeps a result from doing what was asked; empty when it does.
function problems(req, r) {
  const expect = req.expect;
  const wanted = r.outcome === "built" ? "build" : r.outcome === "matched" ? `match:${r.match_id}` : r.outcome === "refused" ? "refuse" : r.outcome;
  if (!expect.includes(wanted)) return [`${wanted}, expected ${expect.join(" or ")}`];
  if (r.outcome === "refused" || r.outcome === "notice") {
    const p = [];
    if (r.message.length > 240) p.push("reason too long");
    if (req.words && r.outcome === "refused" && !has(r.message, req.words)) p.push(`reason doesn't name ${req.words[0]}`);
    if (req.instead && r.outcome === "refused" && !r.instead) p.push("no closest app");
    return p;
  }
  if (r.outcome !== "built") return [];
  const app = r.draft;
  const w = app.watcher;
  const p = [];
  const kinds = app.publishers.map((x) => x.kind);
  if (req.watcher && !req.watcher.includes(w.kind)) p.push(`watcher ${w.kind}`);
  if (req.words && ["phrase", "topic"].includes(w.kind) && !has(w.phrase ?? w.topic, req.words)) p.push(`listens for "${w.phrase ?? w.topic}"`);
  if (req.words && w.kind === "new_thought" && !has(app.prompt?.system ?? "", req.words)) p.push(`prompt doesn't name ${req.words[0]}`);
  if (req.every && w.kind === "time" && !req.every.includes(w.every_secs)) p.push(`every ${w.every_secs}s`);
  if (req.hour !== undefined && w.kind === "time") {
    const at = new Date(w.at_ms);
    const soon = w.at_ms > Date.now() - 60_000 && w.at_ms <= Date.now() + 86_400_000;
    if (![req.hour].flat().includes(at.getHours()) || at.getMinutes() !== 0 || !soon) p.push(`starts ${at.toLocaleString()}`);
  }
  if (req.level && w.kind === "volume" && !(req.level[0] <= w.level && w.level <= req.level[1])) p.push(`level ${w.level}`);
  if (req.prompt === false && app.prompt) p.push("asks the model each time");
  if (req.all && !req.all.every((k) => kinds.includes(k))) p.push(`publishes ${kinds.join(", ")}`);
  if (req.prompt && !app.prompt) p.push("no prompt");
  if (req.prompt && app.prompt && !/\{(thought|points)\}/.test(app.prompt.template)) p.push("its prompt never sees what was said");
  if (req.publishers && !kinds.some((k) => req.publishers.includes(k))) p.push(`publishes ${kinds.join(", ")}`);
  // The same reminder title is proposed once, ever: a repeating nudge that only proposes reminders goes quiet.
  if (req.repeats && kinds.every((k) => k === "reminder") && !(app.prompt && app.publishers.some((x) => x.title.includes("{text}")))) {
    p.push("repeats as one reminder, proposed once");
  }
  return p;
}

const jobs = [];
for (let run = 1; run <= runs; run++) for (const req of requests) jobs.push({ req, run });
const results = [];
const conns = await Promise.all(ports.map(connect)).catch((e) => { console.error(e.message); process.exit(1); });
await Promise.all(conns.map(async (conn) => {
  for (let job = jobs.shift(); job; job = jobs.shift()) {
    const r = await compose(conn, job.req.request);
    const row = { id: job.req.id, run: job.run, request: job.req.request, ...r, problems: problems(job.req, r) };
    row.ok = row.problems.length === 0;
    results.push(row);
    const what = r.outcome === "built" ? blocks(r.draft) : r.outcome === "matched" ? r.match_id : `${r.message}${r.instead ? ` → “${r.instead}”` : ""}`;
    console.log(`${row.ok ? "ok  " : "MISS"} #${String(row.id).padEnd(2)} run ${row.run} ${(r.ms / 1000).toFixed(1).padStart(5)} s  ${r.outcome.padEnd(8)} ${what}${r.retried ? " (retried)" : ""}${row.ok ? "" : `  ✗ ${row.problems.join("; ")}`}`);
  }
}));
conns.forEach((c) => c.close());

results.sort((a, b) => a.id - b.id || a.run - b.run);
const count = (outcome) => results.filter((r) => r.outcome === outcome).length;
const ok = results.filter((r) => r.ok).length;
const times = results.map((r) => r.ms).sort((a, b) => a - b);
console.log(`\n${results.length} builds: ${count("built")} built, ${count("matched")} matched, ${count("refused") + count("notice")} refused, ${count("failed")} failed, ${count("timeout")} timed out`);
console.log(`Does what was asked: ${ok} of ${results.length}; median ${(times[times.length >> 1] / 1000).toFixed(1)} s, slowest ${(times.at(-1) / 1000).toFixed(1)} s`);
// With more than one run: how often each request did what was asked.
if (runs > 1) {
  for (const id of [...new Set(results.map((r) => r.id))]) {
    const rows = results.filter((r) => r.id === id);
    console.log(`#${String(id).padEnd(3)} ${rows.filter((r) => r.ok).length}/${rows.length}  ${rows[0].request}`);
  }
}
if (out) writeFileSync(out, JSON.stringify(results, null, 2));
