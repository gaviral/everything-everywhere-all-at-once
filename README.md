# E2A2O

<!-- pitch: draft, User to approve -->
For people who think out loud and lose their threads. You talk (or type), and E2A2O puts each thought on the right thread of a live map a few seconds later: a topic, or a tangent branching off one. When you jump to something new halfway through a sentence, it marks the thread you left, and at the next pause it offers to take you back. While you're quiet, it tidies titles, suggests a next step, gives each thread with a few thoughts a picture, and proposes reminders and calendar events from what you decided; nothing reaches your Reminders or Calendar until you approve it. It can also start from your past AI chats.

Built during the Meta Global AI Developer Hackathon with Cerebral Valley (Oct 26 to Nov 4, 2026), on Meta's Muse Voice Transcribe, Muse Spark and Muse Image.

## Try it

Tested on macOS. Needs Rust 1.89 or newer ([rustup.rs](https://rustup.rs); run `rustup update` if yours is older) and Node.js 22.12 or newer. On a Mac with no developer tools, run `xcode-select --install` first.

Get the code and step into its folder:

```sh
git clone https://github.com/gaviral/e2a2o-app.git && cd e2a2o-app
```

The first run compiles the Rust core, which takes a few minutes. When the terminal says `E2A2O core on`, open the URL printed on that line. Without a key, it also prints a `WARN ... MODEL_API_KEY is not set`; the sample does not need one. Press Ctrl+C to stop it. If first-time `npm install` warns about `fsevents` install scripts, that warning is harmless.

If port 4321 is busy, use another one: `PORT=4400 ./run.sh sample`. Open http://localhost:4400. For the talk script below, also pass `--port 4400`.

**No key, no mic: a sample map.**

```sh
./run.sh sample
```

- A prepared map of a student's week, dated Nov 3, 2026: 8 threads with branches, 30 thoughts, tags, two suggestions, two reminders, one thread left unfinished, and a picture for every thread (drawn once by the app's own picture pipeline and kept in `samples/images/`, so the Palace is full without a key). It starts fresh from `samples/` on each run and includes a real “Did you mean BC Hydro?” question for “BC Hydra.”
- Try: show and hide threads (`j`/`k`, Enter, Esc), search with `/`, keep a ✦ tag, wait for the "You didn't finish …" card and press Finish it, open the Palace and the Apps panel.
- Without a key, the header says “No AI key”; you can still browse the map and use search and navigation. New typed thoughts stay marked “Needs the AI key,” and the mic and model features are off. “Add to Reminders” still works and really adds to your Reminders (macOS asks first).
- A second map, a founder's day: `./run.sh sample founder`.

**With a key: watch a map build itself.**

```sh
cp .env.example .env                           # then open .env and paste your Meta Model API key after MODEL_API_KEY= (dev.meta.ai)
./run.sh demo                                  # its own map in data/demo; the three seed apps start on
node scripts/demo.mjs scripts/demo-talk.jsonl  # in a second terminal, same folder; --speed 2 goes faster
```

- Open the URL printed by `./run.sh demo` as soon as it says `E2A2O core on`, then start the talk: the map builds while you watch. The key is read once, at start. After editing `.env`, press Ctrl+C and run it again.
- `demo.mjs` types a prepared talk into the core at real speed, as a person typing would. Every placement, tidy-up, picture and app run is a real model call.
- `scripts/demo-talk-v3.jsonl` also has a misheard model name ("Muse Bark") and an app request, and ends on "what did I decide today".
- `data/demo` keeps growing across runs; move it aside for an empty map.
- To talk: `./run.sh` (its map is in `data/`), press the mic and allow it, then speak; or type and press Enter.
- To start from your past chats: Import chats (top right), then choose `conversations.json` from a ChatGPT or Claude export, or press Try with a sample (`ui/public/sample-chats.json`: five made-up ChatGPT chats). You see what goes to which model, and a rough cost, before anything is sent.

**Two laptops, one map.**

```sh
./run.sh room
```

- Needs a key, like everything that calls a model. There's no sample room.
- The core prints a link with a fresh room code, `http://<this laptop's address>:4321/?room=<code>`. Open it on a second laptop on the same network; the host uses http://localhost:4321. Each person joins with a name.
- One map for both; each thought carries its speaker's name, and each person has their own place, unfinished card and "where was I?".
- One laptop is enough to see it: with a key, `node scripts/demo.mjs scripts/room-talk.jsonl --room <code>` adds a second speaker, Sam.
- The second laptop loads the page over plain http from a network address, which browsers don't treat as secure: its mic doesn't work, but typing and Explain do. To use its mic in Chrome, open `chrome://flags/#unsafely-treat-insecure-origin-as-secure` on that laptop, add the link's address (for example `http://192.168.1.20:4321`), set the flag to Enabled and relaunch Chrome. If macOS asks whether the host may accept incoming connections, choose Allow.

## What you'll see

- The first time, a three-step tour (Skip tour ends it).
- Your words appear live at the bottom; each finished thought waits there (“Finding a thread,” or “Needs the AI key” without a key), then moves onto the map when placement is available. Hover a point for its original words and how long placing took.
- Threads and their branches; the active one is marked; a thread you left mid-sentence says "left off".
- After a short pause: "You didn't finish *Rent is due*", your last words, Finish it and Later.
- If your thoughts land while you are away for at least 30 seconds, “While you were away” lists the threads and proposals they added; each row opens its thread.
- ✦ marks what the AI added or proposes: tags (faint until kept), one suggestion per thread, actions with "Add to Reminders" or "Add to Calendar", "Did you mean …?", a "fixed" tag, pictures, app cards, Recap, and notes such as "AI renamed … to …".
- Header: "This session · 12 thoughts · 4 threads", Recap, a ? for keys and spoken commands, Import chats, and in a room, who has added thoughts.
- Map tools: Map or Palace, search, Focus, Recent first; `?` lists keyboard and spoken commands.
- Select a few words on the map, then Explain: one plain sentence on what they mean in that thread, using what other threads say about the same name or term.
- The Apps panel: your apps with on and off switches, and a box to make one.

## How it works

The core (`core/`, Rust with axum and tokio) holds the map in memory, journals every change, calls the models and pushes each change to every open window over a WebSocket. The UI (`ui/`, React, TypeScript, Motion) draws the map and streams the mic as 24 kHz PCM. The API key stays in the core. More detail, with the life of a thought and every model call: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**Placing.** Each finished turn of speech (Voice Transcribe's endpointing) or typed line is checked before it reaches the model: filler such as “um, so” is set aside, as are acknowledgements such as “yeah, okay” unless the last turn was a question. A turn that moves to another topic is split at the change; the joining words at the cut are left out, and the rest is placed next. The model can also set aside a short acknowledgement as filler, but a turn over 8 words is always placed. A queue sends thoughts to Muse Spark one at a time, with every thread's id, title and last point and your active thread, so each placement sees the map the last one left. The answer follows a JSON schema: continue the active thread, return to an earlier one, or start a new one (a branch when it names a parent), plus a point of at most 12 words, whether the thought trailed off, and words that look misheard. Only thread ids that exist are trusted. Each placement gets up to three tries; if all fail, the thought goes back in the queue 15 s later (doubling to 4 min). To see how long placing takes for you: `node scripts/latency.mjs data/journal.jsonl` (median, 90th percentile, slowest).

**The unfinished-thought card and voice commands.** Leave a thread whose last thought trailed off ("I need to pay rent before…") and it's marked dropped, for you only. After 2.5 s without new words, the card offers the one you dropped last. “Where was I?” and “next one” work as a whole turn or at its end after a pause; words before the command are placed first, and the command waits for them. “Go back to the drawing board” stays a thought. “Where was I?” or “go back” returns to where your last line trailed off (even on the thread you're on), else your latest dropped thread, else the last other thread you spoke on; “next one” moves to the next thread in creation order, then wraps to the first; “where did I talk about …?” or “take me to …” (Take me there) jumps to the thread and highlights the point.

**Did you mean, and confident auto-fix.** With each placement the model names words that look misheard, its guess, and whether the context leaves no doubt (say, the right name is already on the map). If it's sure, and those words are really in what was said, the core swaps them and marks the point "✦ fixed": hover shows what was heard, and one click puts it back. Anything less is asked: "Did you mean "Muse Spark"? Yes / No".

**The refiner.** At a pause (4 s quiet) after two new thoughts or a new thread, or when you come back to the window, with at least 10 s between passes (longer after failed ones), Muse Spark 1.3 reads the map: quiet threads as one line, recent ones with their last 8 thoughts, and each thread's tags. It renames threads and merges duplicates (the app says so), adds at most one suggestion per thread, proposes actions (a reminder, or an event when a date is stated) and suggests up to three tags per thread. If you start talking while it works, it drops the pass and redoes it at the next pause. Approving an action runs AppleScript on the host laptop: reminders go to their own "E2A2O" list, dated events become all-day events in their own "E2A2O" calendar, and the app shows how long Apple took.

**Pictures and the Palace.** During pauses, once a thread has settled for 12 s, Muse Image draws one picture for it (up to three at a time): one concrete, slightly absurd object in a fixed clay style, on the thread's own background color, with image search, web search and shell off. Up to three tries per thread. The core keeps the full WebP and serves a 128 px copy that keeps Muse Image's note that AI made it. The Palace shows threads as picture tiles grouped into rooms (a thread and its branches); arrow keys move, Enter opens the thread on the map.

**The composer and its apps.** An app is a watcher (a new thought, a phrase, a topic, loud voices for some seconds, a time), an optional single model prompt, and one to three publishers (a card on the map, a short tune, a proposed reminder). Say “make an app that…” or “Can you make me an app to …”, or use the Apps panel. The composer first looks for an app that already does it; otherwise Muse Spark 1.3 picks blocks under a JSON schema, and the core rejects unknown blocks or fields and out-of-range values. A draft that fails validation is retried once with the error explained; a valid draft can then be kept or discarded. Apps can't run code, open URLs or act on their own; a proposed reminder waits for your approval. Three seed apps, on by default only in demo mode: Argument resolver (gently names a repeated point or a common fallacy), Volume watcher (suggests a pause when voices stay loud), Search-first (offers an existing app before making another).

**Recap.** Say "recap", "what did I decide today?" or "recap this session", or press Recap. Today runs from local midnight; a session, from the last 30-minute gap. Only that period's thoughts go to the model, in the speakers' own words, capped at 24 threads, 16 thoughts each and 64 actions. It returns a summary that names your threads, what you worked on, plans (intentions such as "I want to…"), decisions (explicit choices only) and open questions; the core adds the unfinished threads and their actions, drops any thread the model invents, and if none are named, links the three threads with the most points. Each line links to its thread. The recap is saved in the journal; asking again with nothing new makes no call.

**Importing your chats.** The core reads a ChatGPT or Claude export (`conversations.json`), or a JSON or JSON Lines list of messages with a role and content, up to 100 MB, and shows what it found before sending anything. Only your own messages are read: the latest ones, up to 300,000 characters, each cut at 2,000, with the first 240 characters of the AI's reply as context; messages already on the map are skipped. Muse Spark 1.2 reads them in parts, six at a time, and pulls out each idea as a short point with your own words and its date. Muse Spark 1.3 then sees only those ideas, never your messages, and groups them into threads (one level of branches, or onto threads already on the map), at most one open question per thread, and dated tasks. Threads land one at a time, each point keeping the time you first wrote it; if grouping fails, each topic becomes its own thread. Neither step uses Contributor mode unless you set it. In a room, only the host can import. The file isn't kept.

**Rooms.** `./run.sh room` sets a fresh 8-character code and puts the core on the local network; without a room it answers only this laptop. A laptop without the code gets only the page, to type the code in, not the map or the pictures. Every window streams its mic through the host's core, one Voice Transcribe session per window, under that person's name. Only the host's own window can approve actions, since they land in the host's apps.

**The journal.** Every change is appended as one JSON line to `data/<map>/journal.jsonl`, then sent to every window; on start the core replays it, so the map opens where you left it. `./run.sh NAME` uses `data/NAME`; plain `./run.sh` uses `data/`.

## Models and endpoints

| Model | Endpoint | Used for |
|---|---|---|
| `muse-voice-transcribe-1.0` | `wss://api.meta.ai/v1/asr/realtime` | Live speech to text: endpointing, English, a keyword bias for "E2A2O" and the Muse names |
| `muse-spark-1.2-contributor` (`PLACER_MODEL`), minimal reasoning | `https://api.meta.ai/v1/chat/completions` | Placing, Did you mean, auto-fix, Explain |
| `muse-spark-1.3` (`REFINER_MODEL`), low reasoning | same | Refiner, composer, app prompts, Recap (`RECAP_MODEL` overrides) |
| `muse-spark-1.2`, then `muse-spark-1.3` (`IMPORT_EXTRACT_MODEL`, `IMPORT_MERGE_MODEL`) | same | Importing chats: pulling out ideas, then grouping them |
| `muse-image-1.0` | `https://api.meta.ai/v1/images/generations` | Thread pictures |

Every model request has a time limit: 20 s for placing and Explain, 4 s before Take me there falls back to plain search, and 40 s to 4 minutes for the rest; the speech stream has no read timeout yet. Settings go in `.env`; see `.env.example`.

## Privacy and data

- The core runs on your laptop. The browser talks only to it and loads nothing from elsewhere; the key never reaches the browser.
- Sent to `api.meta.ai`, and nowhere else: mic audio while the mic is on; for placing, each new thought with every thread's title and last point; for the refiner, those plus each thread's tags, the last 8 thoughts of recently active threads (with who said them, in a room) and the suggestions and actions already there; for Take me there, only when no thread has all the words you asked about, your request and up to 48 likely threads' titles and latest 3 points; for Explain, the phrase, the words around it, its thread's points, the other thread titles and up to 8 thoughts from other threads that name it; for Recap, the period's thoughts and their threads' actions; for a picture, the thread's title and first 6 points; for apps, your request and app list, and the recent thoughts an app reads when it runs; for an import, the messages and ideas described above.
- Contributor mode: placing and Explain default to `muse-spark-1.2-contributor`, the cheaper and fastest-measured Spark, whose data Meta may keep to improve its products. That includes the titles and last points of imported threads, once they're on the map. For private talk, set `PLACER_MODEL=muse-spark-1.2`.
- On disk: `data/<map>/journal.jsonl` (each thought's full text and speaker, and every change since) and `data/<map>/images/`. `data/` and `.env` are git-ignored. Delete a map's folder to forget it.
- In a room, everyone with the code sees the whole map, and the other laptops' audio goes through the host's core and key.
- No accounts, analytics or telemetry.

## Security

- Alone, the core listens on 127.0.0.1 only. A gate checks every request: the Host must name this machine (stops DNS rebinding), and an Origin, when sent, must be the app's own page, so another site open in your browser can't use the WebSocket (browsers always send Origin on one). Responses carry `Cross-Origin-Resource-Policy: same-origin`.
- In a room, the Host must be this laptop's own address, and the map and pictures need the code (a query on the WebSocket, a `SameSite=Strict` cookie for pictures), compared in constant time. `./run.sh room` makes 8 characters from 31 letters and digits; a shorter `ROOM_CODE` starts with a warning. Approving actions and importing work only from the host's own window.
- Model output is data: the placer trusts only existing thread ids; app specs must match a closed set of blocks (`deny_unknown_fields`, range and template checks); app prompts are told the conversation is data and that they can't act. The UI renders text only, never raw HTML.
- `scripts/precheck.sh` runs before anything goes public, and on every merge (below). It fails on: `.env` or data files in git, key-like strings, home-directory paths, paths from the author's other projects, a core not limited to 127.0.0.1 when alone, a missing Origin and Host gate or room test, a model client without a timeout, `dangerouslySetInnerHTML`, or a failing `cargo test`. With the app running, it also probes it: another site's WebSocket and a rebinding Host must get 403, and so must the map without the code in a room. It warns about open decisions: the Contributor default, `run.sh`'s Keychain lookup, and the speech stream's missing read timeout.

## How it was built

- One person, User, directed AI coding agents, mostly overnight; he set the scope and made the keep-or-cut calls. Claude Code (Claude Opus 5.5) led: the architecture and first version, reviews and merges. Claude subagents built rooms, chat import, the confident auto-fix and later picture and Explain work; Codex agents built the composer and Recap (Sol), and the Palace and the UI passes (Terra); a Cursor agent (Claude Opus 4.6) reviewed code and drafted docs.
- The merge gate: each agent worked in its own git worktree. A script merged a branch into a scratch copy of main and ran `cargo test`, the UI build and `scripts/precheck.sh`; main moved only if all three passed.
- The lesson: an agent's review sounds just as sure when it's wrong. About half the bugs the Cursor reviewer flagged weren't real (it said Reminders has no all-day due date; Apple's scripting dictionary has one), and of its 28 claims about the UI, 4 held up. So every claim was checked against the code before anything changed.

## What existed before the event

- Before the event: the idea and design notes. No code.
- Written during the event (Oct 26 to Nov 4, 2026): everything in this repository; the first commit is from Oct 31. No code from the author's other projects; `scripts/precheck.sh` fails on their paths.
- One link to an older project: with no `.env`, `run.sh` looks for the key in a macOS Keychain entry saved by the author's earlier app, Canvas. It's a key lookup only; on other Macs it finds nothing.

## Known limits

- Every model feature needs `api.meta.ai` and a key; there's no local or offline model.
- Reminders and Calendar need macOS. Tested on macOS only; on Linux the build also needs OpenSSL headers.
- Set up for English: Voice Transcribe is biased to English. Its words also vary between identical runs (a builder measured about 11%); Did you mean catches some of it.
- Placing is a model's judgment, and there are no manual edits: you can't move a thought or rename, merge or split threads yourself, or undo the refiner's renames and merges.
- A Voice Transcribe session ends after 60 minutes; press the mic again. A stalled speech stream leaves the mic looking on.
- While the model is unreachable, a new thought waits at "Finding a thread" and is tried again 15 s later, then less often, up to every 4 min.
- Pictures come only during pauses, so a busy session gets them late.
- Rooms work on one local network only. The room code is the only check: anyone on the network who has it can join.
- One map per data folder, shared by every window on it; no accounts. The journal only grows (no compaction), and there's no export beyond it.
- The sample maps were written by hand, timings included, and are dated the week of Nov 3, 2026. They include a real “Did you mean” suggestion; Recap's Today is empty for those dates unless today's date overlaps, and This session needs a key.
