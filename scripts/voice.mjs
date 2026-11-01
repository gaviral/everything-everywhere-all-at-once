#!/usr/bin/env node
// Voice mode: speaks a prepared talk into a running core through the microphone's own path, so the real
// speech-to-text, and the rules that depend on how it writes (filler set aside, "…, okay, where was I?",
// a "yeah" kept after a question), are tested without anyone talking. macOS only: it uses say and afconvert.
//   ./run.sh demo
//   node scripts/voice.mjs scripts/demo-talk-v3.jsonl [--port N] [--room CODE] [--speed N] [--pause S]
//                          [--voice NAME] [--decide keep|discard] [--out FILE]
// Each line is synthesized with `say` (a different voice for each speaker; --voice sets the host's),
// converted to what the browser sends (24 kHz mono 16-bit PCM in 80 ms frames, ui/public/pcm-worklet.js)
// and streamed over /ws at real-time pace, as the mic does: listen on, frames, listen off. Between lines
// the stream carries silence, as a live mic does. A line starts at its "at" (divided by --speed) or
// --pause seconds after the line before ends (default 1.5), whichever is later.
// --decide keeps or discards each app the talk asks for once it's ready, as a person would click,
// so the next "make an app" isn't refused. A line may also say what should happen, checked at the end:
// "expect": "thought", "filler", "back", "next", "find", "recap" or "app", or several joined by "+"
// ("thought+back" for "…, okay, where was I?"). At the end it prints each line as said and as heard,
// its word error rate, what the core did with it, and how long the transcript and the placement took.
// --out FILE also saves all of it, with every message the core sent, as JSON.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RATE = 24000;
const FRAME = 1920; // 80 ms, as the browser sends
const HOST_VOICE = "Samantha";
const OTHER_VOICES = ["Daniel", "Karen", "Moira", "Tessa", "Rishi"];
// Speech at normal speech's level as the browser sends it (NORMAL_VOICE in core/src/apps.rs; a core test keeps them
// equal), so a loud synthetic voice can't set off the volume watcher.
const LEVEL = 0.075;
// A person waits for "Listening…" before speaking.
const LEAD_S = 1;
// After the last line, the longest to wait for the map to settle.
const TAIL_MAX_S = 60;

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error("usage: node scripts/voice.mjs TALK.jsonl [--port N] [--room CODE] [--speed N] [--pause S] [--voice NAME] [--decide keep|discard] [--out FILE]");
  process.exit(2);
}
const option = (name, fallback) => {
  const i = flags.indexOf(`--${name}`);
  return i >= 0 ? flags[i + 1] : fallback;
};
const port = Number(option("port", 4321));
const room = option("room", "");
const speed = Number(option("speed", 1));
const pause = Number(option("pause", 1.5));
const decide = option("decide", "");
const out = option("out", "");
if (!(speed > 0) || !(pause >= 0) || !["", "keep", "discard"].includes(decide)) {
  console.error("--speed needs a number above 0, --pause a number of seconds, --decide keep or discard");
  process.exit(2);
}
const talk = readFileSync(file, "utf8")
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line));
if (talk.some((line) => line.speaker) && !room) {
  console.error("A line with a speaker needs --room CODE");
  process.exit(2);
}

// ---- Speech: one clip per line, in the browser's format.

const voices = new Map([["", option("voice", HOST_VOICE)]]);
for (const line of talk) {
  if (!voices.has(line.speaker || "")) voices.set(line.speaker, OTHER_VOICES[(voices.size - 1) % OTHER_VOICES.length]);
}

function synthesize(text, voice, dir, n) {
  const [words, aiff, wav] = ["txt", "aiff", "wav"].map((ext) => join(dir, `${n}.${ext}`));
  writeFileSync(words, text);
  execFileSync("say", ["-v", voice, "-o", aiff, "-f", words]);
  execFileSync("afconvert", ["-f", "WAVE", "-d", `LEI16@${RATE}`, "-c", "1", aiff, wav]);
  return leveled(trimmed(samples(readFileSync(wav))));
}

// The PCM in a WAVE file, checked to be what the browser sends.
function samples(wav) {
  let format;
  for (let at = 12; at + 8 <= wav.length; ) {
    const id = wav.toString("ascii", at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    if (id === "fmt ") format = [wav.readUInt16LE(at + 8), wav.readUInt16LE(at + 10), wav.readUInt32LE(at + 12), wav.readUInt16LE(at + 22)];
    if (id === "data") {
      if (format?.join() !== `1,1,${RATE},16`) throw new Error(`afconvert wrote ${format}, not 16-bit mono PCM at ${RATE} Hz`);
      return new Int16Array(wav.buffer.slice(wav.byteOffset + at + 8, wav.byteOffset + at + 8 + size));
    }
    at += 8 + size + (size & 1);
  }
  throw new Error("afconvert wrote no audio");
}

// Without the silence `say` leaves around the words, so a line ends where its speech ends.
function trimmed(clip) {
  const loud = (s) => Math.abs(s) > 64;
  const first = clip.findIndex(loud);
  const last = clip.findLastIndex(loud);
  return first < 0 ? clip.subarray(0, 0) : clip.subarray(first, last + 1);
}

function leveled(clip) {
  let sum = 0;
  for (const s of clip) sum += (s / 32768) ** 2;
  const gain = clip.length ? LEVEL / Math.sqrt(sum / clip.length || 1) : 1;
  return clip.map((s) => Math.max(-32768, Math.min(32767, Math.round(s * gain))));
}

const scratch = mkdtempSync(join(tmpdir(), "e2a2o-voice-"));
let lines;
try {
  console.log(`Synthesizing ${talk.length} lines…`);
  let end = 0;
  lines = talk.map((line, n) => {
    const speaker = line.speaker || "";
    const clip = synthesize(line.text, voices.get(speaker), scratch, n);
    const start = Math.max(LEAD_S + line.at / speed, n ? end + pause : 0);
    end = start + clip.length / RATE;
    return { n: n + 1, at: line.at, speaker, voice: voices.get(speaker), text: line.text, expect: line.expect || "", start, end, clip };
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

// ---- The core: one socket, and one mic, per speaker; the host's also follows the shared map.

let epoch = 0; // when the frame clock started: line times count from here
const now = () => (epoch ? (performance.now() - epoch) / 1000 : 0);
const events = [];
const turns = [];
const thoughts = new Map();
const threads = new Map();
const builds = new Map();
let lastEvent = 0;
let stopped = "";

function connect(speaker) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams();
    if (speaker) {
      params.set("room", room);
      params.set("name", speaker);
    }
    const query = params.toString();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query ? `?${query}` : ""}`);
    // The core's name for this window: "you" alone or for the host, else the name joined with.
    const peer = { speaker, name: speaker ? speaker.trim().split(/\s+/).join(" ").slice(0, 24) : "you", ws, lines: [], turn: null, last: null, listening: false, frames: 0, sum: 0, count: 0 };
    ws.onerror = () => reject(new Error(`Couldn't reach the core on port ${port} as ${speaker || "the host"}. Start it with ./run.sh demo`));
    ws.onopen = () => resolve(peer);
    ws.onmessage = (event) => receive(peer, JSON.parse(event.data));
    ws.onclose = () => {
      if (!stopped) stopped = `The core closed ${speaker || "the host"}'s connection.`;
    };
  });
}

function send(peer, message) {
  if (peer.ws.readyState === WebSocket.OPEN) peer.ws.send(message instanceof ArrayBuffer ? message : JSON.stringify(message));
}

let host;
const peers = new Map();

function receive(peer, msg) {
  const t = now();
  events.push({ t, speaker: peer.speaker, msg });
  if (msg.type !== "snapshot" && msg.type !== "partial") lastEvent = t;
  switch (msg.type) {
    case "status":
      peer.listening = msg.listening;
      if (!msg.listening && epoch && !stopping) stopped = `Listening stopped for ${peer.speaker || "the host"}: ${msg.note}`;
      break;
    case "partial":
      if (msg.text) {
        lastEvent = t;
        if (!peer.turn) turns.push((peer.turn = { speaker: peer.speaker, opened: t, closed: null, draft: "", thoughts: [], outcomes: [] }));
        peer.turn.draft = msg.text;
      } else {
        // The turn is finished; a clear with no draft before it may still bring a thought.
        if (!peer.turn) turns.push((peer.turn = { speaker: peer.speaker, opened: t, closed: null, draft: "", thoughts: [], outcomes: [] }));
        peer.turn.closed = t;
        peer.last = peer.turn;
        peer.turn = null;
        if (peer.last.draft) console.log(`${t.toFixed(1).padStart(6)} s  ${label(peer.speaker)} heard  ${peer.last.draft}`);
      }
      break;
    case "change":
      change(peer, msg.change, t);
      break;
    case "apps_build":
      if (peer === host) build(msg.build, t);
      break;
    case "notice":
      if (msg.message.startsWith("You joined as ")) peer.name = msg.message.slice(14).split(":")[0];
      outcome(peer.last, notice(msg.message), t);
      break;
    case "found":
      outcome(peer.last, { kind: "find", text: msg.message }, t);
      break;
    case "recap_state":
      outcome(peer.last, { kind: "recap", text: msg.loading ? "loading" : msg.message || (msg.recap ? "shown" : "none") }, t);
      break;
    case "error":
      if (!epoch) stopped = msg.message; // e.g. no key: listening won't start
      outcome(peer.last, { kind: "error", text: msg.message }, t);
      console.log(`${t.toFixed(1).padStart(6)} s  ${label(peer.speaker)} error  ${msg.message}`);
      break;
  }
}

function notice(message) {
  if (message.startsWith("Back to ")) return { kind: "back", text: message };
  if (message.startsWith("On to ")) return { kind: "next", text: message };
  if (/^(Looking through your threads|I couldn't find)/.test(message)) return { kind: "find", text: message };
  if (/^(Keep or discard the current app|Describe the app|Couldn't make this app)/.test(message)) return { kind: "app", text: message };
  return { kind: "notice", text: message };
}

function outcome(turn, what, t) {
  if (turn) turn.outcomes.push({ ...what, t });
}

// Thoughts are followed on their speaker's own socket, which also carries the end of their turn, so a
// thought always finds the turn it came from; the rest of the map, on the host's.
function change(peer, c, t) {
  if (c.type === "thought_added") {
    if (c.thought.speaker !== peer.name) return;
    const turn = peer.last;
    const thought = { id: c.thought.id, text: c.thought.text, added: t, turn };
    thoughts.set(thought.id, thought);
    turn?.thoughts.push(thought);
    return;
  }
  if (peer !== host) return;
  const thought = thoughts.get(c.thought_id);
  switch (c.type) {
    case "thread_added":
      threads.set(c.thread.id, { title: c.thread.title, added: t });
      break;
    case "thread_renamed":
      if (threads.has(c.thread_id)) threads.get(c.thread_id).title = c.title;
      break;
    case "thought_split":
      if (thought) {
        const rest = { id: c.rest.id, text: c.rest.text, added: t, turn: thought.turn, rest: true };
        thoughts.set(rest.id, rest);
        thought.turn?.thoughts.push(rest);
        outcome(thought.turn, { kind: "split", text: `cut before “${c.rest.text}”` }, t);
      }
      break;
    case "thought_placed":
      if (thought) {
        const thread = threads.get(c.thread_id);
        const fresh = thread && t - thread.added < 0.5;
        Object.assign(thought, { placed: t, place_ms: c.place_ms, thread: c.thread_id, point: c.point, complete: c.complete });
        let text = `${fresh ? "new" : "into"} ${c.thread_id} “${thread?.title ?? "?"}”`;
        if (c.unclear && c.guess) text += `, asks “Did you mean ${c.guess}?” for “${c.unclear}”`;
        if (c.heard && c.fixed) text += `, fixed “${c.heard}” to “${c.fixed}”`;
        if (!c.complete) text += ", trailed off";
        outcome(thought.turn, { kind: "thought", text }, t);
        host.placedTurn = thought.turn;
      }
      break;
    case "thought_skipped":
      if (thought) {
        thought.skipped = t;
        outcome(thought.turn, { kind: "skipped", text: "set aside by the placer" }, t);
      }
      break;
    case "thread_status":
      if (c.status === "dropped") outcome(host.placedTurn, { kind: "dropped", text: `left ${c.thread_id} unfinished` }, t);
      break;
  }
}

// An app the talk asked for: tied to the latest finished turn, and kept or discarded with --decide.
function build(b, t) {
  const turn = [...peers.values()].map((p) => p.last).filter(Boolean).sort((a, b) => b.closed - a.closed)[0];
  if (!builds.has(b.id)) {
    builds.set(b.id, { stage: b.stage, decided: false });
    outcome(turn, { kind: "app", text: `builds “${b.request}”` }, t);
  }
  const known = builds.get(b.id);
  known.stage = b.stage;
  if (decide && !known.decided && ["ready", "matched"].includes(b.stage)) {
    known.decided = true;
    send(host, { type: "decide_app", build_id: b.id, keep: decide === "keep" });
  }
  if (["ready", "matched", "kept", "discarded", "failed"].includes(b.stage) && known.reported !== b.stage) {
    known.reported = b.stage;
    outcome(known.turn ?? turn, { kind: "app", text: b.stage === "failed" ? `failed: ${b.message}` : b.stage }, t);
  }
  known.turn ??= turn;
}

// Nothing still on its way: no words being heard, no thought waiting for a thread, no app, find or recap running.
function settled() {
  if ([...peers.values()].some((p) => p.turn)) return false;
  if ([...thoughts.values()].some((th) => !th.placed && !th.skipped)) return false;
  const waiting = decide ? ["kept", "discarded", "failed"] : ["ready", "matched", "kept", "discarded", "failed"];
  if ([...builds.values()].some((b) => !waiting.includes(b.stage))) return false;
  const lastOf = (kind) => turns.flatMap((turn) => turn.outcomes).filter((o) => o.kind === kind).at(-1);
  if (lastOf("recap")?.text === "loading" || lastOf("find")?.text.startsWith("Looking")) return false;
  return true;
}

const label = (speaker) => (speaker ? `[${speaker}]` : "").padEnd(8);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One frame of a speaker's mic: their lines where they fall, silence elsewhere.
function frame(peer, k) {
  const samples = new Int16Array(FRAME);
  const from = k * FRAME;
  for (const line of peer.lines) {
    const begin = Math.round(line.start * RATE);
    const a = Math.max(from, begin);
    const b = Math.min(from + FRAME, begin + line.clip.length);
    if (a < b) samples.set(line.clip.subarray(a - begin, b - begin), a - from);
  }
  return samples;
}

// As ui/src/apps-audio.ts: the RMS of every four frames (320 ms), for the volume watcher.
function volume(peer, samples) {
  for (const s of samples) peer.sum += (s / 32768) ** 2;
  peer.count += samples.length;
  if (++peer.frames >= 4) {
    send(peer, { type: "app_volume", level: Math.sqrt(peer.sum / peer.count) });
    peer.frames = peer.sum = peer.count = 0;
  }
}

let stopping = false;
async function listen(on, within) {
  for (const peer of peers.values()) if (peer.lines.length || !on) send(peer, { type: "listen", on });
  const until = performance.now() + within * 1000;
  while ([...peers.values()].some((p) => (p.lines.length || !on) && p.listening !== on) && performance.now() < until && (!on || !stopped)) await sleep(50);
  return [...peers.values()].filter((p) => (p.lines.length || !on) && p.listening !== on).map((p) => p.speaker || "the host");
}

try {
  host = await connect("");
  peers.set("", host);
  for (const line of lines) {
    if (!peers.has(line.speaker)) peers.set(line.speaker, await connect(line.speaker));
    peers.get(line.speaker).lines.push(line);
  }
  const deaf = await listen(true, 15);
  if (deaf.length || stopped) throw new Error(`Listening didn't start for ${deaf.join(", ") || "a speaker"}. ${stopped || "Is MODEL_API_KEY set for the core?"}`);
  process.on("SIGINT", () => (stopped = "Interrupted."));

  epoch = performance.now();
  const lastEnd = Math.max(...lines.map((line) => line.end));
  let said = 0;
  for (let k = 0; ; k++) {
    // A frame goes out once its 80 ms have been "spoken", as the browser's worklet sends it.
    const wait = epoch + (k + 1) * 80 - performance.now();
    if (wait > 0) await sleep(wait);
    for (const peer of peers.values()) {
      if (!peer.lines.length) continue;
      const samples = frame(peer, k);
      send(peer, samples.buffer);
      volume(peer, samples);
    }
    while (said < lines.length && lines[said].start <= ((k + 1) * FRAME) / RATE) {
      const line = lines[said++];
      console.log(`${line.start.toFixed(1).padStart(6)} s  ${label(line.speaker)} said   ${line.text}`);
    }
    const t = now();
    if (stopped) break;
    if (t > lastEnd + 2 && t - lastEvent > 1.5 && settled()) break;
    if (t > lastEnd + TAIL_MAX_S) {
      stopped = `Still waiting ${TAIL_MAX_S} s after the last line; stopped.`;
      break;
    }
  }
  stopping = true;
  const still = await listen(false, 10);
  if (still.length) console.log(`Listening didn't stop for ${still.join(", ")} within 10 s.`);
  if (stopped) console.log(stopped);
} catch (e) {
  console.error(e.message);
  for (const peer of peers.values()) peer.ws.close();
  process.exit(1);
}
for (const peer of peers.values()) peer.ws.close();

// ---- What was heard, line by line.

// Words to compare: lowercase, no punctuation, numbers spelled out ("9 PM" is "nine pm"), "OK" is "okay".
const ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split(" ");
const spell = (n) =>
  n < 20 ? ONES[n]
  : n < 100 ? TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : "")
  : n < 1000 ? `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${spell(n % 100)}` : ""}`
  : n < 1e6 ? `${spell(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${spell(n % 1000)}` : ""}`
  : String(n);
const IRREGULAR = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };
const ordinal = (n) => spell(n).replace(/(\w+)$/, (w) => IRREGULAR[w] ?? (w.endsWith("y") ? `${w.slice(0, -1)}ieth` : `${w}th`));
function words(text) {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\b([ap])\.m\./g, "$1m")
    .replace(/(\d+):00\b/g, "$1")
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/\b(\d+)(st|nd|rd|th)\b/g, (_, n) => ordinal(Number(n)))
    .replace(/\d+/g, (n) => spell(Number(n)))
    .replace(/\bok\b/g, "okay")
    .replace(/[^a-z0-9']+/g, " ")
    .split(" ")
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

function errors(said, heard) {
  let row = Array.from({ length: heard.length + 1 }, (_, j) => j);
  for (let i = 1; i <= said.length; i++) {
    const next = [i];
    for (let j = 1; j <= heard.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (said[i - 1] === heard[j - 1] ? 0 : 1));
    row = next;
  }
  return row[heard.length];
}

// A turn's final words: its thought as the core got them, unless a command took some (then the last draft).
const COMMANDS = ["back", "next", "find", "recap", "app"];
function heardIn(turn) {
  const own = turn.thoughts.filter((th) => !th.rest);
  if (own.length && !turn.outcomes.some((o) => COMMANDS.includes(o.kind))) return { text: own.map((th) => th.text).join(" "), final: true };
  return { text: turn.draft, final: false };
}

const kept = turns.filter((turn) => turn.draft || turn.thoughts.length || turn.outcomes.length);
for (const turn of kept) {
  const mine = lines.filter((line) => line.speaker === turn.speaker);
  turn.line = (mine.findLast((line) => line.start <= turn.opened) ?? mine[0])?.n;
}
const seconds = (s) => (s == null ? "–" : `${s.toFixed(1)} s`);
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)] : null);
const percent = (wrong, total) => `${Math.round((100 * wrong) / Math.max(1, total))}%`;

// Lines heard as one turn (the pause between them too short for the transcriber to end the first)
// are reported together.
const groups = [];
for (const line of lines) {
  const its = kept.filter((turn) => turn.line === line.n);
  const before = groups.findLast((group) => group.speaker === line.speaker);
  const closed = before?.turns.filter((turn) => turn.closed != null).at(-1)?.closed;
  if (!its.length && closed > line.start) before.lines.push(line);
  else groups.push({ speaker: line.speaker, lines: [line], turns: its });
}

const report = groups.map((group) => {
  const its = group.turns;
  const [first, last] = [group.lines[0], group.lines.at(-1)];
  const heard = its.map(heardIn);
  const text = heard.map((h) => h.text).join(" ");
  const said = group.lines.map((line) => line.text).join(" ");
  const closed = its.filter((turn) => turn.closed != null).at(-1)?.closed;
  const placed = its.flatMap((turn) => turn.thoughts).filter((th) => th.place_ms != null);
  const outcomes = its.flatMap((turn) => turn.outcomes).sort((a, b) => a.t - b.t);
  const acted = outcomes.find((o) => COMMANDS.includes(o.kind));
  const kinds = new Set(outcomes.map((o) => o.kind));
  const meets = (want) => (want === "thought" ? placed.length > 0 : want === "filler" ? !placed.length && !acted : kinds.has(want));
  const final = heard.length > 0 && heard.every((h) => h.final);
  const asked = group.lines.filter((line) => line.text.trim().endsWith("?")).length;
  return {
    lines: group.lines.map((line) => line.n),
    start: first.start,
    end: last.end,
    speaker: group.speaker,
    voice: first.voice,
    said,
    heard: text,
    final,
    turns: its.length,
    words: words(said).length,
    errors: errors(words(said), words(text)),
    // Questions said, and how many came back with their "?" (only countable in a thought's final words).
    questions: asked && final ? [asked, Math.min(asked, (text.match(/\?/g) ?? []).length)] : null,
    toText: closed != null ? closed - last.end : null,
    toMap: placed.length ? Math.max(...placed.map((th) => th.place_ms)) / 1000 : null,
    toAct: acted ? acted.t - last.end : null,
    did: outcomes.map((o) => `${o.kind}: ${o.text}`),
    expect: group.lines.filter((line) => line.expect).map((line) => ({ line: line.n, expect: line.expect, met: line.expect.split("+").every(meets) })),
  };
});

console.log(`\n${file} · ${lines.length} lines · ${[...voices.values()].join(", ")} · pause ${pause} s\n`);
for (const r of report) {
  const times = [`speech end → text ${seconds(r.toText)}`];
  if (r.toMap != null) times.push(`text → map ${seconds(r.toMap)}`);
  if (r.toAct != null) times.push(`speech end → acted ${seconds(r.toAct)}`);
  const checks = r.expect.map((e) => (e.met ? `  ✓ ${e.expect}` : `  ✗ expected ${e.expect}`)).join("");
  console.log(`${r.lines.join("+").padStart(2)}  ${r.start.toFixed(1).padStart(5)} s  ${label(r.speaker)}WER ${percent(r.errors, r.words)}  ${times.join(" · ")}${checks}`);
  console.log(`    said   ${r.said}`);
  const notes = [r.turns > 1 && `${r.turns} turns`, r.lines.length > 1 && `${r.lines.length} lines in one turn`, r.heard && !r.final && "last draft"].filter(Boolean);
  console.log(`    heard  ${r.heard || "(nothing)"}${notes.map((note) => `  [${note}]`).join("")}`);
  for (const d of r.did) console.log(`    did    ${d}`);
}

const allSaid = lines.flatMap((line) => words(line.text));
const allHeard = kept.flatMap((turn) => words(heardIn(turn).text));
const wrong = errors(allSaid, allHeard);
const questions = report.map((r) => r.questions).filter(Boolean);
const checks = report.flatMap((r) => r.expect);
const split = report.filter((r) => r.turns > 1).map((r) => r.lines.join("+"));
const merged = report.filter((r) => r.lines.length > 1).map((r) => r.lines.join("+"));
const none = report.filter((r) => r.turns === 0).map((r) => r.lines.join("+"));
const stat = (name, xs) => `${name.padEnd(20)} ${xs.length ? `median ${seconds(median(xs))}, max ${seconds(Math.max(...xs))} (n=${xs.length})` : "–"}`;
console.log("\nSummary");
console.log(`  words                ${allSaid.length}, word error rate ${((100 * wrong) / Math.max(1, allSaid.length)).toFixed(1)}% (${wrong} errors; numbers and "OK" compared spelled out)`);
const shape = [split.length && `split: line ${split.join(", ")}`, merged.length && `one turn: lines ${merged.join(", ")}`, none.length && `nothing heard: line ${none.join(", ")}`];
console.log(`  turns                ${kept.length} for ${lines.length} lines${shape.filter(Boolean).map((part) => `; ${part}`).join("")}`);
if (questions.length) console.log(`  questions            ${questions.reduce((sum, [, kept]) => sum + kept, 0)} of ${questions.reduce((sum, [asked]) => sum + asked, 0)} heard with their "?"`);
if (checks.length) {
  const missed = checks.filter((e) => !e.met).map((e) => `line ${e.line} (${e.expect})`);
  console.log(`  as expected          ${checks.length - missed.length} of ${checks.length}${missed.length ? `; not: ${missed.join(", ")}` : ""}`);
}
console.log(`  ${stat("speech end → text", report.map((r) => r.toText).filter((x) => x != null))}`);
console.log(`  ${stat("text → map", report.map((r) => r.toMap).filter((x) => x != null))}`);
console.log(`  ${stat("speech end → acted", report.map((r) => r.toAct).filter((x) => x != null))}`);
if (out) {
  writeFileSync(out, JSON.stringify({ file, port, pause, speed, voices: Object.fromEntries(voices), lines: report, events }, null, 1));
  console.log(`\nSaved to ${out}`);
}
process.exit(0);
