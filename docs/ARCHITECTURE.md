# Architecture

One Rust process, the core, holds the map and talks to Meta's models; one web page per window draws it. They share a WebSocket. Paths below are under `core/src` and `ui/src`.

## Parts

```
Browser, one page per window (ui/src)
  App.tsx        map, dock, header, unfinished-thought card
  core.ts        the WebSocket; applies each Change to its own copy of the world (mirrors world.rs)
  mic.ts         the mic as 24 kHz 16-bit PCM in 80 ms frames (worklet in ui/public)
  pictures.ts    the one picture-slot rule (map, unfinished card, Palace): letter until decoded, capped refetches
  MicButton.tsx  the mic's states (off, starting, listening, hearing you, paused, no key, refused, connecting)
  Tips.tsx       one shared tip for every element with `data-tip` (each ✦ says what the AI did and its undo)
  Symbols.tsx    the ? list's legend, drawn with the map's own classes
  Attention.tsx  the one "look here" highlight, the "latest" bar, "New in X ↓", unseen dots, "this" (rules in attention-core.ts)
  this-card.ts   what "this" means: the card selected or under the pointer, told to the core when it changes
  Undo.tsx       Undo on a notice that answers a request you can take back
  notice-rules.ts which notices stay until dismissed (they ask you to act); the rest are up for their reading time
  revert.ts      what the window showed before a voice view or fold, put back on the core's Revert
  Explain.tsx  Palace.tsx  Recap.tsx  Apps.tsx  Import.tsx  Tour.tsx  Away.tsx  room.tsx  find.ts
  legible.ts     the talking state (what the map quiets), two map columns, which points open their words (legible.css)
      |  /ws: JSON both ways, audio frames up      POST /import: an export file (host only)
Core, one process (core/src: axum, tokio)
  main.rs        Core state, the gate, one session per window, voice commands, "where was I?"
  world.rs       World, Change, the journal
  protocol.rs    ServerMsg, ClientMsg
  asr.rs         relay to Muse Voice Transcribe
  placer.rs      places one thought at a time
  trace.rs       E2A2O_TRACE=1: every model request (a contributor model's turned-away try too), placement and saved picture to data/<map>/trace.jsonl
  refiner.rs     tidies the map at pauses
  pictures.rs    one picture per thread
  explain.rs     one sentence on a selected phrase
  recap.rs       a recap of today or this session
  find.rs        "where did I talk about …?": Take me there
  spoken.rs      the command pack: "add … to X", "new thread about …", "expand …", "forget it", "stop listening"
  catalog.rs     the action catalog (one definition per request); "No, I meant …", "scratch that", "this", a spoken yes or no
  apps.rs        watchers, prompts, publishers; the composer
  clock.rs       local wall-clock time from the system's date, so timers keep their hour
  model.rs       a refused or busy key; a default Contributor model gives way when the key can't use it; the hourly call cap
  import.rs      past AI chats into threads
  apple.rs       AppleScript into Reminders and Calendar
```

## State and the journal

- `World`: threads, thoughts, `active` (where the talk is), `active_by` (each speaker's thread), suggestions, actions, `merged` (old thread id to its successor), apps, recaps.
- Every change goes through `Core::commit`: under the world and journal locks, each `Change` is applied to the `World` and appended to `data/<map>/journal.jsonl` as one JSON line (`#[serde(tag = "type")]`); then each is broadcast as `ServerMsg::Change`. Nothing else changes the `World`.
- `Core::record` appends a change that only the journal keeps (`ExplainAnswered`, `AnswerMarked`): the `World` ignores it and no window is sent it. These are labels for judging Explain and Recap prompts later.
- On start, `Journal::open` replays the file. A line it can't parse is skipped with a warning; a missing final newline (a crash mid-write) is added, so the next change starts on its own line. Fields added later carry `#[serde(default)]`, so old journals keep loading.
- A merge moves thoughts, branches, suggestions, actions and each speaker's place, and records `from → into`; later changes aimed at `from` follow it, with a hop limit so a cycle can't loop.
- Each window keeps its own copy: a snapshot on connect, then every `Change`. If a window falls too far behind the broadcast queue, it gets a fresh snapshot plus the current app build and its own import status, so it catches up with the current world.
- Thread ids: `T1`, `T2`… from the placer (never reused: threads plus merges plus one); `I1`, `I2`… from imports; app cards with no thread land in `apps-output` ("Apps").

## Life of a spoken thought

1. `mic.ts` sends each 80 ms frame up the WebSocket as binary. It also sends a loudness reading every 320 ms, the RMS of those four frames (`apps-audio.ts`), for volume watchers; `?level` in the address shows each reading.
2. `asr.rs`: when a window turns its mic on, the core opens `wss://api.meta.ai/v1/asr/realtime` for it (the key in the handshake; endpointing, English bias, keywords) and forwards frames. `transcript` events go back as live words to that speaker's windows; `speechComplete` calls `Core::add_thought`; a spoken "stop listening" ends the stream there, so nothing the service still sends after it is kept.
3. `add_thought` first lets a spoken yes, no or short fix answer the AI's open question on the speaker's latest thought (`catalog::answer`; a yes only ever answers that, never an outside action). Then it checks whole-turn commands (`Core::request`, which says what each did and how to undo it, `catalog::Done`; every act has one definition in `catalog::CATALOG`, held to the rules by a test) (recap, "make an app…", a view such as "palace" or "let's focus", or the `?` list ("what can I say?", "help"), sent only to the speaker's windows, "new thread", which marks the speaker's next thought to start a thread whatever the placer answers, the command pack in `spoken.rs` (each only as the whole turn: "add … to X" commits the thought already placed, with what to add as its point, when X is a thread's title or a kind of place no thread has yet, else it's a thought; "new thread about …" commits a thread titled from the words after it with those words as its first thought, already placed; a thread either starts gets an `S<n>` id, apart from the placer's `T<n>` (a placement still waiting on the model counts from an older map) and imports' `I<n>`, and leaving a thread whose last words trailed off marks it dropped, as `decide` does; "what was I thinking?" is "where was I?"; "forget it", "later", "finish it" and "stop listening" are `View`s the window acts on, since it knows which unfinished card it shows; "expand …" sends `Unfold`; "add it to Reminders" approves as a click does, host only; "keep it" decides a waiting build), and "where did I talk about …?" or "go to the one about …"; "find", "take me to" and "go to" only when they point at the map, since they also start to-dos). Every request skips the same words before it (`lead_in`: what `filler` sets aside, "now", "hey", "please" and "can/could/would/will you"; "I see", "I mean", "you know" and "like" only before a pause mark, since without one they make a sentence of what follows: "I see the palace"); partway through a turn "would you go back?" asks someone, so those four don't lead in there, and the unpunctuated end-of-turn scan for "where was I" skips nothing, so the word before it stays in the thought. A search's question is the turn's first sentence (the dot of a title or initials, "Dr." or "U.S.", doesn't end it; that of "example.com." or "v2.1." does): a jump or a notice that says why not (empty map, no key, nothing found, the call failed) answers it, never a thought; the words said after the question are then handled as a turn of their own, and a "take me back to …" with nothing pointing at the map (no "the thread about …", no #tag) is kept as a thought when nothing matches, since it may be a saying. While the model looks, "Looking through your threads…" stays up; newer words or a move stop the search, keep its words first and send an empty notice that takes it down; a search those words ask stops as it's asked, since it was asked before the newer words or move and its answer would undo them. "Where was I?", "next one" and "last one" can also appear at the end after a pause; words before them are kept as a thought, and the command waits in the placer's line behind them. A command acts at once when none of the speaker's own words are waiting for their first try: it never waits for another speaker's words or for a retry. "Where was I?" goes to the thread where the speaker's last line trailed off, even the one they're on, else the one they dropped last, else the last other one they spoke on; with none of those it sends a jump to the speaker's latest point ("You're on …") or a notice saying why there's nowhere to go, and "next one" and "last one" say so on an empty map or the only thread. Before creating a thought, it sets aside filler such as "um, so" and acknowledgements such as "yeah, okay" unless the latest thought ended with a question mark. A turn no request reads may correct the speaker's previous one, said within `JUST_BEFORE_MS` (`catalog::correct`): “scratch that” runs that turn's undo, or takes its words off (`ThoughtSkipped`; Undo re-adds them); “No, I meant …” undoes a previous request, then runs the request named, read by rule, else by one model call (the placer's model, minimal reasoning, 12 s) that sees the previous turn, what the app did, the thread titles and the catalog's acts it may pick, and answers one act and a phrase, which runs only if `catalog::classify` reads the phrase as that act; words kept from the previous turn come off once the request acts (a search: once it jumps, `catalog::searched`), and a thread they alone started goes with them (merged where the speaker was, else `ThreadRemoved`), with the thread's `last_point` recomputed. A view or fold is undone by `ServerMsg::Revert`: the window keeps what it showed before each voice view or fold. A model answer that arrives after a newer turn of the speaker's is dropped. Words put back that weren't placed are queued again, and a placement whose words were taken off while the model thought commits nothing (`Core::commit_if`). Each turn is remembered per speaker as a request (with its undo) or kept words. Otherwise it commits a `Thought` (`th-<uuid>`, the speaker's active thread, `placed: false`) and queues its id.
4. `placer.rs` takes one id at a time. The prompt puts the fixed instructions first (for the prompt cache), then each thread as `id: title [open|dropped] last: point`, the speaker's active thread, their previous turn as said with its thread when it came within 2 minutes (`JUST_BEFORE_MS`; not when it's the question just asked) and the thought. If a turn moves to another topic, the answer quotes where it starts; the core cuts there, removes joining words at the cut, and queues the rest after the first part. The model can skip short filler turns (up to 8 words); longer turns are placed. JSON schema answer, minimal reasoning, room for 2,000 tokens (two a character for a turn over 1,000 characters, at most 12,000), 20 s timeout (4 s and 8 ms a token of room); an answer cut off at its room is asked once more with twice the room. The first try gets 6 ms a token of room (12 s for a short turn: 1.2 times filling the room, above every placement measured, n=1,015, slowest 11.0 s), later tries the full time. A failed try sends the thought to the back of the line 0.5 s, then 1 s, later, so a stall never holds up what was said after it; the third failure is said once, and it goes back 15 s later (doubling to 4 min), so an outage doesn't leave it unplaced until a restart; a busy service (429) holds the whole line for that wait, and a try refused by the hourly call cap skips the quick retries and waits for the next round. A command waiting in the line acts as soon as none of its speaker's words ahead of it are on their first try. A thought that lands after its speaker moved on (newer words of theirs landed, or they moved while it retried) goes on the map without moving them or marking threads they left. The core sends `placing` (the thought in flight, and each retry with its wait) on every change and on connect, for the pills.
5. `decide` trusts only ids that exist. It builds `ThreadAdded` (for a new thread, with its parent if that exists), `ThoughtPlaced` (with a sure fix applied, or the question to ask), `ThreadTouched`, drops and `ActiveChanged`, and commits them together. Drops are the speaker's own: a thread they left whose last thought trailed off, or one the model names that they spoke on.
6. In the UI the pending pill and the placed point share a Motion `layoutId`, so the thought moves from the dock to its thread. An `ActiveChanged` in the commit that placed the speaker's own words (after its `ThoughtPlaced`, `ThreadTouched` and drops) is their words moving them, even to where they'd already clicked, since `decide` sees the map from before the model answered; so is an import opening them on its newest thread when they had no place yet. Any other one for them, a `Found`, an `Unfold` or a `View` (but Later, Forget and Pause, which leave the map as it is), answers a request, and the window closes an open Recap so the result shows (`movesAsked` in `core.ts`).
   The map's follow tells `Attention.tsx` what it showed (the point gets the one highlight, `look`, once it holds still, for its reading time: 200 ms to look over plus 238 words a minute) or held back (the dock's "New in X ↓"). Every other jump (Take me there, Away rows, Recap links, Finish it) calls the same `look`. Under Reduce Motion the point fades in for 200 ms where the slide would jump. Threads changed out of sight (not by your own words landing) get an unseen dot until the change has been readable on screen for its reading time, or you touch the thread.
7. `apps.rs` sees the `ThoughtPlaced` broadcast and runs matching watchers; the refiner and pictures pick the thought up at the next pause.
8. When a window returns after at least 30 seconds hidden or blurred, `Away.tsx` compares the map before and after the absence. It shows the speaker's newly placed thoughts grouped by thread, and new proposals on those threads; rows link to the point or proposal, and the card states this rule. It does not make a model call.

## Background work

| Task | When | Bounds |
|---|---|---|
| Refiner | checked every 2 s, or at once when a window regains focus; runs with a key, a new placed thought, 10 s since the last pass (doubling with each failed pass in a row, to about 5 min), and either 4 s of quiet after two new thoughts or a new thread, or the window coming back | Quiet threads as one line each; recent ones with their last 8 thoughts (with who said each, in a room); each thread's tags; the latest 30 suggestions and 30 actions. The answer is checked against the map as it is when it arrives: at most one suggestion per thread (an app's card counts) and three tags. If talk resumed (under 2 s quiet) by then, the answer is held and applied at the next pause, against the map as it is then (renames of threads that got new thoughts in the meantime are dropped); a failed pass is redone |
| Pictures | every second, once 2 s are quiet and every thought is placed: threads without a picture, 12 s after they were last touched, the longest settled first | 3 at a time; 3 tries per thread, 10 s apart, until the core restarts; a 128 px lossless WebP copy that keeps the image's XMP note; older pictures get copies on start |
| Apps | each `ThoughtPlaced` (new thought, phrase, topic watchers); a 1 s tick (time watchers, waiting runs); each loudness reading (volume) | Cooldown per app (10 to 3,600 s); one run per app at a time, keeping the latest matching thought for later; a timer with a prompt runs only when a thought was placed since its last run; a timer repeating whole days keeps its start's local time of day (`clock.rs`); `AppRan` is journaled before the call, so a restart can't loop a timer; a volume app fires once readings from one mic stay at its level for its seconds, riding out one low reading (a breath between sentences); a draft between normal speech and a raised voice is held at least 3 s (`LOUD_SECONDS`), and `seed` moves an earlier build's Volume watcher to this build's level |

## Model calls

All go from the core to `api.meta.ai/v1`. Every chat call except Explain asks for a JSON schema answer.

| Call | Model (setting) | Reasoning | Timeout | Tries | Cache key |
|---|---|---|---|---|---|
| Speech | `muse-voice-transcribe-1.0` | | none on reads | none; press the mic again | |
| Placing | `PLACER_MODEL`, default `muse-spark-1.2-contributor`, or `muse-spark-1.2` once the key can't use it (401, 403 or 404 on the default only) | minimal | 12 s first, then 20 s; more for a long turn | back in line after each failure; after 3, again 15 s later, doubling to 4 min | `e2a2o-placer` |
| Explain | the placer's model | minimal | 20 s | 1; the UI offers Try again | `e2a2o-explain` |
| Refiner | `REFINER_MODEL`, default `muse-spark-1.3` | low | 52 s | at the next pause, at least 10 s apart, doubling after each failure to about 5 min | `e2a2o-refiner` |
| Recap | `RECAP_MODEL`, else `REFINER_MODEL`, else `muse-spark-1.3` | low | 40 s | 1 | `e2a2o-recap` |
| Composer, Search-first, app prompts | `REFINER_MODEL` | low | 45 s | 1, and 1 more when a reply has no answer in it; a composer draft that doesn't check out gets one more, told what was wrong | |
| Take me there | `REFINER_MODEL` | minimal | 8 s (twice the slowest of 68 measured) | 1, only when the words match weakly | `e2a2o-find` |
| Safety net (a correction no rule reads) | the placer's model | minimal | 12 s (twice the slowest of 10 measured) | 1; on failure the words are kept as a thought | `e2a2o-safety-net` |
| Import: ideas | `IMPORT_EXTRACT_MODEL`, default `muse-spark-1.2` | minimal | 120 s | 3 | `e2a2o-import-ideas` |
| Import: grouping | `IMPORT_MERGE_MODEL`, default `muse-spark-1.3` | low | 240 s | 2 | `e2a2o-import-map` |
| Pictures | `muse-image-1.0` | | 55 s | 3 per thread | |

## The gate

`gate` in `main.rs` runs before every route and gives each request one of three levels: refused (403), the page only, or the map.
- Host: must be `localhost`, `127.0.0.1` or `[::1]` when the connection comes from this machine, or, in a room, the exact address and port the connection reached. A name a site could point at this laptop never passes, which stops DNS rebinding.
- Origin, when present: a page on this machine for a local connection, or `http://` plus the Host in a room. Browsers always send it on a WebSocket handshake, so another site can't open `/ws`.
- In a room, a connection from another machine without the code gets only the page's own files (`/`, `/index.html`, `/room`, `/pcm-worklet.js`, `/assets/*`); with it, everything else (`/ws`, `/images`, …). The code comes from `?room=` or a `room` cookie, is compared as lowercase letters and digits, in constant time.
- Every response that passes carries `Cross-Origin-Resource-Policy: same-origin`. Approving actions and importing also need a connection from this machine.
- Hashed files under `/assets/` and images get `Cache-Control: public, max-age=31536000, immutable`; pages and other responses get `no-cache`. A missing file that falls back to the page also gets `no-cache`, so an update is checked before the old page can be reused.
- With no model key, the core sends a notice when a window connects. The header says "No AI key"; the map remains browseable, and typed thoughts are labeled "Needs the AI key" without placement retries.

## Rooms

- `ROOM_CODE` binds the core to `0.0.0.0`; without it, to `127.0.0.1`.
- Each outgoing message goes to every window or to one speaker's windows: live words, mic status, "Back to …" notes, Recap progress and import progress go only to their speaker.
- Per speaker: the active thread (`active_by`), who dropped a thread (`dropped_by`), the way back, and what the placer sees as "active".
- Another laptop that asks for no name, or for "you" (the host's own name), joins as "Guest" and is told so.
- A name is the host's or a guest's, never both: another laptop can't take a name this machine's windows joined with (until the core stops), and this machine can't take one another laptop's window is using. `/room?name=` says so (`taken`), the WebSocket is refused (409), and the page asks for another name. Only the host stops an import.

## Import

1. `POST /import` (host only, needs a key, one at a time, up to 100 MB) parses a ChatGPT export (in each chat, the branch the person saw last), a Claude export, or a plain list or JSON Lines of messages. It keeps the person's latest messages up to 300,000 characters (each cut at 2,000, with 240 characters of the AI's reply as context), skips messages whose time is already on the map or in `MessagesRead` (what an import finished reading, including messages that gave no point, so the same file twice adds nothing), packs them into parts of up to 8,000 characters and 12 messages (bigger parts lose messages: see `PART_MESSAGES`), and returns a preview with the models and a cost estimate. Nothing is sent yet.
2. `import_start`: the ideas model reads six parts at a time; each idea is a topic, a point, the person's own words, a kind and maybe a date. Ideas are grouped by topic name.
3. The grouping model sees the topics with their latest points, the open questions, the tasks and the map's thread titles, never the messages. It returns threads (one level of branches, or an existing thread), at most one question per thread, and tasks. Only topics and threads that exist are trusted; a topic it leaves out becomes its own thread; if grouping fails, every topic does.
4. Threads land one at a time as `ThreadAdded`, `ThoughtAdded` (already placed, with the message's own time), `SuggestionAdded` and `ActionProposed`, then `MessagesRead`. `import_cancel` stops it; what landed stays.

## Adding an app block

- Watcher: a variant in `Watcher` (`apps.rs`); fire it in `on_thought` (thought watchers), the 1 s tick in `run` (timers) or `volume` (audio); bounds in `validate`; the schema in `composition_schema` and a line in the composer prompt (`COMPOSE`; `compose_prompt` fills in the volume scale); in the UI, the `Watcher` type in `apps-core.ts` and its label in `watching` (`Apps.tsx`).
- Publisher: a variant in `Publisher`; publish it in `execute`; template checks in `validate`; schema and prompt as above; its label in `Blocks` (`Apps.tsx`).
- Apps are journaled as `AppRegistered`, and app types use `deny_unknown_fields`. An older build can't parse a line with a block or field it doesn't know, and skips it with a warning.

## Tests and checks

- Unit tests sit beside the code (`cd core && cargo test`): every kind of change through a journal and back, old formats, the gate and room access, per-speaker navigation, placement and auto-fix, Recap slicing and caching, app validation and runs, import parsing and landing.
- `node scripts/away-check.mjs`, `node scripts/recap-check.mjs`, `node scripts/placing-check.mjs`, `node scripts/picture-check.mjs`, `node scripts/marks-check.mjs`, `node scripts/legible-check.mjs`, `node scripts/attention-check.mjs` and `node scripts/catalog-check.mjs` check UI rules through Vite, with no browser or extra dependencies: what the away card lists, which messages close an open Recap, what a pending thought's pill says and when a landing moves the map, the picture-slot rule (letter until decoded, next copy, capped refetches, one more when the core is back), the mic's states and that every ✦ has a tip, legibility (which points open their words, the two columns, numbers shared between files, and that no CSS cuts text with an ellipsis or clamp unless listed with its reason), the attention rules (reading times, what counts as unseen, where a mark goes after a merge, which words point at "this"), and which card "this" is and when the core is told, with a spoken fix of "Did you mean …?" mirrored.
- `node scripts/notice-check.mjs`: which notices stay until dismissed, how long the rest are up; on the real useCore hook with a stand-in socket, that a notice made in the window drops an older Undo, that the same answer again restarts its time, and that a correction's answer and Undo outlast the window's answer to the view it asked for.
- Routing cases against the real model (`scripts/routing-cases.jsonl`, or `ROUTING_CASES`; `ROUTING_RUNS` runs each): `cd core && cargo test --release -- --ignored routing_cases --nocapture` with `MODEL_API_KEY` set. A case is a small map, the card selected, the turn said before, someone else's turn in between, the words and where they may land; or a journal up to a thought, for a real miss kept outside the repo. `node scripts/where.mjs data/<map>` prints each thought's thread, with the model's answer when a trace exists.
- `scripts/precheck.sh`: static checks, the tests, and live probes of a running core. It runs `scripts/model-guards.py`: only Meta's models and API in the app's code (`meta-only`), and every model call counted by the hourly cap (`counted`: only `call_model_noting`, which `call_model` wraps, and `ask_model` send the key, and both spend first). The merge gate runs the tests, the UI build and precheck on a scratch merge before main moves.
