#!/usr/bin/env node
// Demo mode: replays a prepared talk into a running core as typed thoughts, at real speed, so the map
// builds itself on camera. The core can't tell it from a person typing: every placement, refiner pass
// and picture is a real model call; nothing is faked.
//   mv data/demo data/demo.$(date +%s)   # optional: start from an empty map (keeps the old one)
//   ./run.sh demo                         # the core, with the demo journal (data/demo)
//   node scripts/demo.mjs scripts/demo-talk.jsonl [--speed 2] [--port 4321]
// Each line of the talk: {"at": seconds from the start, "text": "what is said"}.
import { readFileSync } from "node:fs";

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error("usage: node scripts/demo.mjs TALK.jsonl [--speed N] [--port N]");
  process.exit(2);
}
const flag = (name, fallback) => {
  const i = flags.indexOf(`--${name}`);
  return i >= 0 ? Number(flags[i + 1]) : fallback;
};
const speed = flag("speed", 1);
const port = flag("port", 4321);
const talk = readFileSync(file, "utf8")
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line));

const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
let opened = false;
ws.onerror = () => {
  if (opened) return;
  console.error(`Couldn't reach the core on port ${port}. Start it with ./run.sh demo`);
  process.exit(1);
};
ws.onopen = async () => {
  opened = true;
  const start = Date.now();
  for (const line of talk) {
    const wait = (line.at * 1000) / speed - (Date.now() - start);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    ws.send(JSON.stringify({ type: "text", text: line.text }));
    console.log(`${line.at.toFixed(1).padStart(6)} s  ${line.text}`);
  }
  // Give the last thought time to be sent before closing.
  setTimeout(() => process.exit(0), 1000);
};
