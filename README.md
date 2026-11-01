# E2A2O

Think out loud. Every thought finds its thread, and nothing you start gets lost.

Talk (or type). Muse Voice Transcribe turns speech into thoughts as you go; Muse Spark places each one on the right branch of a live map in about two seconds. When you leave a thought unfinished and wander off, E2A2O notices, and at the next pause it offers to take you back.

## Run it

Needs Rust (stable) and Node.js 20 or newer.

```sh
cp .env.example .env   # add your Meta Model API key from dev.meta.ai
./run.sh               # builds the UI and serves everything on http://localhost:4321
```

## Import your chats

**Import chats** (top right) turns an export of your past AI chats into threads, open questions and deadlines on the map. It reads a ChatGPT or Claude data export (`conversations.json`) or a plain JSON list of messages; only your own messages become points, each keeping the time you wrote it. Before anything is sent, it shows which model gets what and a rough cost. **Try with a sample** imports `ui/public/sample-chats.json`, a small synthetic ChatGPT export, in about 20 seconds.

## How it's built

- `core/` (Rust): the world in memory, journaled to `data/journal.jsonl` on every change; the realtime relay to Muse Voice Transcribe (the key never reaches the browser); the placer, which asks Muse Spark where each thought belongs; WebSocket updates to every open window.
- `ui/` (TypeScript, React, Motion): the live map, the microphone (24 kHz PCM through an AudioWorklet), and the pull-back card.
- Import (`core/src/import.rs`, `ui/src/Import.tsx`): Muse Spark 1.2 reads your messages in parts and pulls out each idea; Muse Spark 1.3 groups the ideas into threads, open questions and tasks; they land as ordinary changes, so search, focus, pictures and the refiner treat them like spoken thoughts.
