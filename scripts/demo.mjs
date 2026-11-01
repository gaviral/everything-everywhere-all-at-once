#!/usr/bin/env node
// Demo mode: replays a prepared talk into a running core as typed thoughts, at real speed, so the map
// builds itself on camera. The core can't tell it from a person typing: every placement, refiner pass
// and picture is a real model call; nothing is faked.
//   mv data/demo data/demo.$(date +%s)   # optional: start from an empty map (keeps the old one)
//   ./run.sh demo                         # the core, with the demo journal (data/demo)
//   node scripts/demo.mjs scripts/demo-talk.jsonl [--speed 2] [--port 4321] [--room CODE]
// Each line of the talk: {"at": seconds from the start, "text": "what is said"}.
// In a room (--room CODE), a line may add "speaker": "Name": a second socket joins as that person. Give the
// host's lines the name the host's window joined with too: a line without one is typed as "you", which no
// window in a room is, so it shows with no name and the host's window follows the other person's moves.
import { readFileSync } from "node:fs";

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error("usage: node scripts/demo.mjs TALK.jsonl [--speed N] [--port N] [--room CODE]");
  process.exit(2);
}
const flag = (name, fallback) => {
  const i = flags.indexOf(`--${name}`);
  return i >= 0 ? Number(flags[i + 1]) : fallback;
};
const speed = flag("speed", 1);
const port = flag("port", 4321);
const room = flags.includes("--room") ? flags[flags.indexOf("--room") + 1] : "";
const talk = readFileSync(file, "utf8")
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line));

// One socket per speaker: the host (no "speaker") connects as this machine; others join with the code.
const sockets = new Map();
function socketFor(speaker) {
  if (sockets.has(speaker)) return Promise.resolve(sockets.get(speaker));
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams();
    if (speaker) {
      if (!room) {
        console.error("A line with a speaker needs --room CODE");
        process.exit(2);
      }
      params.set("room", room);
      params.set("name", speaker);
    }
    const query = params.toString();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query ? `?${query}` : ""}`);
    ws.onerror = () => reject(new Error(`Couldn't reach the core on port ${port} as ${speaker || "the host"}. Start it with ${port === 4321 ? "" : `PORT=${port} `}./run.sh ${room ? "room" : "demo"}`));
    ws.onopen = () => {
      sockets.set(speaker, ws);
      resolve(ws);
    };
  });
}

try {
  await socketFor("");
  const start = Date.now();
  for (const line of talk) {
    const wait = (line.at * 1000) / speed - (Date.now() - start);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const ws = await socketFor(line.speaker || "");
    ws.send(JSON.stringify({ type: "text", text: line.text }));
    console.log(`${line.at.toFixed(1).padStart(6)} s  ${(line.speaker ? `[${line.speaker}]` : "").padEnd(8)} ${line.text}`);
  }
  // Give the last thought time to be sent before closing.
  setTimeout(() => process.exit(0), 1000);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
