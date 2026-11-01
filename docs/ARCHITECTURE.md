# Architecture

One Rust process, the core, holds the map and talks to Meta's models; one web page per window draws it. They share a WebSocket. Paths below are under `core/src` and `ui/src`.

## Parts

```
Browser, one page per window (ui/src)
  App.tsx        map, dock, header, unfinished-thought card
  core.ts        the WebSocket; applies each Change to its own copy of the world (mirrors world.rs)
  mic.ts         the mic as 24 kHz 16-bit PCM in 80 ms frames (worklet in ui/public)
  Explain.tsx  Palace.tsx  Recap.tsx  Apps.tsx  Import.tsx  Tour.tsx  room.tsx
      |  /ws: JSON both ways, audio frames up      POST /import: an export file (host only)
Core, one process (core/src: axum, tokio)
  main.rs        Core state, the gate, one session per window, voice commands, "where was I?"
  world.rs       World, Change, the journal
  protocol.rs    ServerMsg, ClientMsg
  asr.rs         relay to Muse Voice Transcribe
  placer.rs      places one thought at a time
  refiner.rs     tidies the map at pauses
  pictures.rs    one picture per thread
  explain.rs     one sentence on a selected phrase
  recap.rs       a recap of today or this session
  apps.rs        watchers, prompts, publishers; the composer
  import.rs      past AI chats into threads
  apple.rs       AppleScript into Reminders and Calendar
```

## State and the journal

- `World`: threads, thoughts, `active` (where the talk is), `active_by` (each speaker's thread), suggestions, actions, `merged` (old thread id to its successor), apps, recaps.
- Every change goes through `Core::commit`: under the world and journal locks, each `Change` is applied to the `World` and appended to `data/<map>/journal.jsonl` as one JSON line (`#[serde(tag = "type")]`); then each is broadcast as `ServerMsg::Change`. Nothing else changes the `World`.
- On start, `Journal::open` replays the file. A line it can't parse is skipped with a warning; a missing final newline (a crash mid-write) is added, so the next change starts on its own line. Fields added later carry `#[serde(default)]`, so old journals keep loading.
- A merge moves thoughts, branches, suggestions, actions and each speaker's place, and records `from → into`; later changes aimed at `from` follow it, with a hop limit so a cycle can't loop.
- Each window keeps its own copy: a snapshot on connect, then every `Change`. A window that falls more than 1,024 messages behind gets a fresh snapshot.
- Thread ids: `T1`, `T2`… from the placer (never reused: threads plus merges plus one); `I1`, `I2`… from imports; app cards with no thread land in `apps-output` ("Apps").

## Life of a spoken thought

1. `mic.ts` sends each 80 ms frame up the WebSocket as binary. It also sends a loudness reading about every 320 ms, for volume watchers.
2. `asr.rs`: when a window turns its mic on, the core opens `wss://api.meta.ai/v1/asr/realtime` for it (the key in the handshake; endpointing, English bias, keywords) and forwards frames. `transcript` events go back as live words to that speaker's windows; `speechComplete` calls `Core::add_thought`.
3. `add_thought` checks whole-utterance commands first (recap, "make an app…", "where was I?", "next one"). Otherwise it commits a `Thought` (`th-<uuid>`, the speaker's active thread, `placed: false`) and queues its id.
4. `placer.rs` takes one id at a time. The prompt puts the fixed instructions first (for the prompt cache), then each thread as `id: title [open|dropped] last: point`, the speaker's active thread and the thought. JSON schema answer, minimal reasoning, 20 s timeout, three tries.
5. `decide` trusts only ids that exist. It builds `ThreadAdded` (for a new thread, with its parent if that exists), `ThoughtPlaced` (with a sure fix applied, or the question to ask), `ThreadTouched`, drops and `ActiveChanged`, and commits them together. Drops are the speaker's own: a thread they left whose last thought trailed off, or one the model names that they spoke on.
6. In the UI the pending pill and the placed point share a Motion `layoutId`, so the thought moves from the dock to its thread.
7. `apps.rs` sees the `ThoughtPlaced` broadcast and runs matching watchers; the refiner and pictures pick the thought up at the next pause.

## Background work

| Task | When | Bounds |
|---|---|---|
| Refiner | checked every 2 s, or at once when a window regains focus; runs with a key, a new placed thought, 10 s since the last pass, and either 4 s of quiet after two new thoughts or a new thread, or the window coming back | Quiet threads as one line each; recent ones with their last 8 thoughts. If talk resumed (under 2 s quiet) when the answer arrives, nothing is applied and the pass is redone at the next pause; a failed pass too |
| Pictures | every 10 s, after 4 s of quiet; the first thread without a picture that has 3 thoughts, or 2 and 30 s since it was touched while not active | 3 tries per thread until the core restarts; a 128 px lossless WebP copy that keeps the image's XMP note; older pictures get copies on start |
| Apps | each `ThoughtPlaced` (new thought, phrase, topic watchers); a 1 s tick (time watchers, waiting runs); each loudness reading (volume) | Cooldown per app (10 to 3,600 s); one run per app at a time, keeping the latest matching thought for later; `AppRan` is journaled before the call, so a restart can't loop a timer |

## Model calls

All go from the core to `api.meta.ai/v1`. Every chat call except Explain asks for a JSON schema answer.

| Call | Model (setting) | Reasoning | Timeout | Tries | Cache key |
|---|---|---|---|---|---|
| Speech | `muse-voice-transcribe-1.0` | | none on reads | none; press the mic again | |
| Placing | `PLACER_MODEL`, default `muse-spark-1.2-contributor` | minimal | 20 s | 3 | `e2a2o-placer` |
| Explain | the placer's model | minimal | 20 s | 1; the UI offers Try again | `e2a2o-explain` |
| Refiner | `REFINER_MODEL`, default `muse-spark-1.3` | low | 120 s | at the next pause | `e2a2o-refiner` |
| Recap | `RECAP_MODEL`, else `REFINER_MODEL`, else `muse-spark-1.3` | low | 40 s | 1 | `e2a2o-recap` |
| Composer, Search-first, app prompts | `REFINER_MODEL` | low | 45 s | 1 | |
| Import: ideas | `IMPORT_EXTRACT_MODEL`, default `muse-spark-1.2` | minimal | 120 s | 3 | `e2a2o-import-ideas` |
| Import: grouping | `IMPORT_MERGE_MODEL`, default `muse-spark-1.3` | low | 240 s | 2 | `e2a2o-import-map` |
| Pictures | `muse-image-1.0` | | 120 s | 3 per thread | |

## The gate

`gate` in `main.rs` runs before every route and gives each request one of three levels: refused (403), the page only, or the map.
- Host: must be `localhost`, `127.0.0.1` or `[::1]` when the connection comes from this machine, or, in a room, the exact address and port the connection reached. A name a site could point at this laptop never passes, which stops DNS rebinding.
- Origin, when present: a page on this machine for a local connection, or `http://` plus the Host in a room. Browsers always send it on a WebSocket handshake, so another site can't open `/ws`.
- In a room, a connection from another machine without the code gets only the page's own files (`/`, `/index.html`, `/room`, `/pcm-worklet.js`, `/assets/*`); with it, everything else (`/ws`, `/images`, …). The code comes from `?room=` or a `room` cookie, is compared as lowercase letters and digits, in constant time.
- Every response that passes carries `Cross-Origin-Resource-Policy: same-origin`. Approving actions and importing also need a connection from this machine.

## Rooms

- `ROOM_CODE` binds the core to `0.0.0.0`; without it, to `127.0.0.1`.
- Each outgoing message goes to every window or to one speaker's windows: live words, mic status, "Back to …" notes, Recap progress and import progress go only to their speaker.
- Per speaker: the active thread (`active_by`), who dropped a thread (`dropped_by`), the way back, and what the placer sees as "active".

## Import

1. `POST /import` (host only, needs a key, one at a time, up to 100 MB) parses a ChatGPT export (in each chat, the branch the person saw last), a Claude export, or a plain list or JSON Lines of messages. It keeps the person's latest messages up to 300,000 characters (each cut at 2,000, with 240 characters of the AI's reply as context), skips messages whose time is already on the map, packs them into parts of up to 8,000 characters, and returns a preview with the models and a cost estimate. Nothing is sent yet.
2. `import_start`: the ideas model reads six parts at a time; each idea is a topic, a point, the person's own words, a kind and maybe a date. Ideas are grouped by topic name.
3. The grouping model sees the topics with their latest points, the open questions, the tasks and the map's thread titles, never the messages. It returns threads (one level of branches, or an existing thread), at most one question per thread, and tasks. Only topics and threads that exist are trusted; a topic it leaves out becomes its own thread; if grouping fails, every topic does.
4. Threads land one at a time as `ThreadAdded`, `ThoughtAdded` (already placed, with the message's own time), `SuggestionAdded` and `ActionProposed`. `import_cancel` stops it; what landed stays.

## Adding an app block

- Watcher: a variant in `Watcher` (`apps.rs`); fire it in `on_thought` (thought watchers), the 1 s tick in `run` (timers) or `volume` (audio); bounds in `validate`; the schema in `composition_schema` and a line in the composer prompt in `compose_inner`; in the UI, the `Watcher` type in `apps-core.ts` and its label in `watching` (`Apps.tsx`).
- Publisher: a variant in `Publisher`; publish it in `execute`; template checks in `validate`; schema and prompt as above; its label in `Blocks` (`Apps.tsx`).
- Apps are journaled as `AppRegistered`, and app types use `deny_unknown_fields`. An older build can't parse a line with a block or field it doesn't know, and skips it with a warning.

## Tests and checks

- Unit tests sit beside the code (`cd core && cargo test`): journal replay and old formats, the gate and room access, per-speaker navigation, placement and auto-fix, Recap slicing and caching, app validation and runs, import parsing and landing.
- `scripts/precheck.sh`: static checks, the tests, and live probes of a running core. The merge gate runs the tests, the UI build and precheck on a scratch merge before main moves.
