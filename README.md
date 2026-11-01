# E2A2O

Think out loud. Every thought finds its thread, and nothing you start gets lost.

Talk (or type). Muse Voice Transcribe turns speech into thoughts as you go; Muse Spark places each one on the right branch of a live map in about two seconds. When you leave a thought unfinished and wander off, E2A2O notices, and at the next pause it offers to take you back.

## Run it

Needs Rust (stable) and Node.js 20 or newer.

```sh
cp .env.example .env   # add your Meta Model API key from dev.meta.ai
./run.sh               # builds the UI and serves everything on http://localhost:4321
./run.sh room          # think together: prints an address for a second laptop on the same network
```

In a room, each person joins with a short name, each laptop transcribes its own mic, and every thought shows who said it; "where was I?" and the unfinished-thought card follow each person. The room has its own map (`data/room`). Without one, the core only answers this machine.

## How it's built

- `core/` (Rust): the world in memory, journaled to `data/journal.jsonl` on every change; the realtime relay to Muse Voice Transcribe (the key never reaches the browser); the placer, which asks Muse Spark where each thought belongs; WebSocket updates to every open window.
- `ui/` (TypeScript, React, Motion): the live map, the microphone (24 kHz PCM through an AudioWorklet), and the pull-back card.
