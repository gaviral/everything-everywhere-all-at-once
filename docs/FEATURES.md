# E2A2O in full

Every feature, setting and detail, moved here from the [README](../README.md) so the README can stay short; nothing was dropped. Spoken commands with every variant are in [COMMANDS.md](COMMANDS.md), the parts and the life of a thought in [ARCHITECTURE.md](ARCHITECTURE.md), and every model call in one real run in [trace.md](trace.md).

Evidence status: model timings here are dated earlier measurements, not a final-build or human reliability result. Fresh hosted guest verification and the final video are pending. The local sample is a preloaded public fixture; its saved pictures and proposed actions are examples. Remote's in-page demo uses simulated jobs, not live remote work.

## Every model call, with its setting

Every model the app calls at runtime is Meta's, through the Meta Model API; `scripts/precheck.sh` fails on any other model SDK, endpoint or model name in the app's code.

| Model | Feature and when it runs | Reasoning effort | Measured number in the README or repo |
|---|---|---|---|
| Muse Spark 1.2 (`PARTNER_MODEL`) | Conversation partner: off by default in Features; answers explicit questions or “Partner, …”. Context is at most four completed question/reply pairs and four recent thoughts from that speaker. | minimal; 20 s timeout; 1,200 output tokens including reasoning; speech capped at 60 words, three sentences and 400 characters | Fake-model and browser checks: `cargo test conversation`, `node scripts/partner-check.mjs`; real microphone quality unmeasured |
| Muse Voice Transcribe 1.0 | Live speech to text while the mic is on; one session per window | — | — |
| Muse Spark 1.3 + 1.2 (`PLACER_MODELS`) | Place each finished thought: two calls race, one to each model, and the first good answer wins; the model line and the landing's tooltip name the model that won. `PLACER_RACE` sets how many calls (lane i asks the list's (i mod n)th model); `PLACER_MODEL` puts one model in every lane. | minimal | Slow spells mostly hit one model at a time: on the app's own placer requests, one round a minute for 37 minutes (n = 38 rounds, 2026-11-02), two Spark 1.2 calls racing took a median 3.6 s, 90% within 5.6 s, 5 s or more in 7 rounds; one Spark 1.3 and one Spark 1.2 call: 3.4 s, 4.6 s, 3 rounds. Both placed the routing and chunk cases alike (69 of 69 each, alone); with 14 cases for thinking out loud added, their Contributor variants placed 108 and 109 of 111 runs, every case right in most of its 3 runs |
| Muse Spark 1.2 (`PLACER_MODEL`) | Did you mean and auto-fix use the placement result. Explain runs when you select words and press Explain. Reads a spoken correction (“No, the bills”) that no rule reads. Contributor mode is opt-in (`PLACER_MODEL=muse-spark-1.2-contributor`). | minimal | Measured with Contributor mode: end of speech to map median 3.6 s, slowest 5.1 s (n = 9, one take through the real speech path, 2026-11-01); placing alone, in the default mode: median 2.5 s, slowest 4.4 s (n = 62, the repo's demo talks replayed with `scripts/demo.mjs` and read with `scripts/trace-summary.mjs`, 2026-11-01). Contributor mode against the default: median 3.0 s vs 3.3 s (n ≈ 42 each, 2026-11-01); again with both running side by side, placing calls median 2.6 s vs 2.8 s, 90% within 3.9 s vs 4.2 s (n = 77 each: the demo talks typed, plus one spoken take; end of speech to text 0.4 s either way, 2026-11-02) |
| Muse Spark 1.3 (`REFINER_MODEL`, default) | Refiner at a pause or when you return; app builder when you ask to make an app; Search-first when enabled; app prompts when a watcher fires. | low | — |
| Muse Spark 1.3 (`REFINER_MODEL`) | Take me there, with minimal effort, only when local word search finds no match | minimal | 62 paraphrases that share no word with their target: median 1.1 s, p90 1.7 s, slowest 2.8 s; 51 found it (2026-11-01, core/src/find.rs `PATIENCE`) |
| Muse Spark 1.3 (`RECAP_MODEL`, else `REFINER_MODEL`, else default) | Keeps a Recap draft current as thoughts land (only while the hour has calls to spare), and when you ask for Recap with something newer | minimal | One call alone on the demo map: 2.5–3.0 s with minimal vs 5.2–9.5 s with low (n = 3 each, 2026-11-01); asking shows the kept draft in 5–11 ms (n = 3). Contributor mode (`RECAP_MODEL=muse-spark-1.3-contributor`) was slower: drafts median 13.3 s vs 3.0 s (n = 32 vs 54, side by side, 2026-11-02) |
| Muse Spark 1.2 (`IMPORT_EXTRACT_MODEL`, default) | Chat import: extracts ideas from message parts | minimal | — |
| Muse Spark 1.3 (`IMPORT_MERGE_MODEL`, default) | Chat import: groups the extracted ideas into topics | low | — |
| Muse Image 1.0 | Draws a topic picture after it has settled | — | — |

Chat models use `https://api.meta.ai/v1/chat/completions`; speech uses `wss://api.meta.ai/v1/asr/realtime`; pictures use `https://api.meta.ai/v1/images/generations`. Settings go in `.env`; see `.env.example`.

Every model request has a time limit: 12 s for placing's first try and 20 s for later ones (more for a long turn), 20 s for Explain, 12 s for reading a correction, 8 s for Take me there's model check (about twice the slowest answer measured; “Looking through your topics…” stays up until then), and 40 s to 4 minutes for the rest; the speech stream ends once it has been quiet for 3.8 s (no word and no progress report).

## Try it

Tested on macOS. Needs Rust 1.89 or newer ([rustup.rs](https://rustup.rs); run `rustup update` if yours is older) and Node.js 22.12 or newer. On a Mac with no developer tools, run `xcode-select --install` first.

**Linux:** the build also needs a C compiler, pkg-config and OpenSSL's headers (Ubuntu: `sudo apt install build-essential pkg-config libssl-dev`). `run.sh` checks all of these before building and prints the command for whatever is missing. Not tested on Linux.

**Windows:** use the hosted version if you were given its link; otherwise WSL2 (Ubuntu): clone inside WSL, follow the Linux line, and open the printed link in Chrome on Windows. Not tested on Windows.

Get the code and step into its folder:

```sh
git clone https://github.com/gaviral/e2a2o-app.git && cd e2a2o-app
```

The first run downloads and compiles the Rust core: about 4 minutes with nothing cached (10-core Apple-silicon Mac, measured 2026-11-01). The launcher prints UI and core build stages. When the terminal says `E2A2O core on`, open the launcher's sample URL (`http://localhost:4321/?sample` by default) to retain the SAMPLE label. Without a key, it also prints a `WARN ... MODEL_API_KEY is not set`; the sample does not need one. Press Ctrl+C to stop it.

To keep it in your Dock: in Chrome, the install icon at the end of the address bar; in Safari, File › Add to Dock.

If port 4321 is busy, `run.sh` says so before building; use another one: `PORT=4400 ./run.sh sample`. Open http://localhost:4400/?sample. For the talk scripts below, also pass `--port 4400`.

**No key, no mic: a sample map.**

```sh
./run.sh sample
```

- A prepared map of a student's week, dated Nov 3, 2026: 8 topics with tangents, 30 thoughts, tags, two suggestions, two reminders, one unfinished topic and a picture per topic. The app's picture pipeline drew them once and saved them in `samples/images/`, so Pictures is full without a key. It starts fresh from `samples/` each run and includes a working “Did you mean BC Hydro?” question for “BC Hydra” (written into the sample; Yes and No work as on a live map). Recap needs a key; with one, a bare "recap" covers the sample's last session (once its Nov 3, 2026 date has passed).
- Try: move between topics (`j`/`k`), search with `/`, keep a ✦ tag, try the Unfinished thought card (see [How it works](#how-it-works); Enter finishes it), and open Pictures, Cards and the Apps from Features (`C`): Pictures and Cards start off, so switch one on and choose Show.
- Without a key, the status line at the bottom says “No AI key”; you can still browse the map and use search and navigation. New typed thoughts stay marked “Needs the AI key,” and the mic and model features are off. “Add to Reminders” still works and really adds to your Reminders (macOS asks first).
- With a wrong or expired key, the first model call is refused and the app stops calling: the status line says “AI key refused” and new thoughts wait, saved, until you fix `MODEL_API_KEY` and restart. If the service is busy (rate limited), it backs off and says so once.
- The core makes at most 400 model calls in any hour (`MODEL_CALLS_PER_HOUR` in `.env`; 0 turns it off), about twice what the busiest hour on a real map needed (≈ 200 calls, counted from its journal), so an app or loop nobody is watching can't run up the bill. Past it, it says once “AI paused up to N min”: placing, the refiner, pictures, apps, Explain, Recap and search by meaning rest until the oldest call is an hour old, while the mic keeps listening and new thoughts wait, saved, to be placed then.
- A second map, a founder's day: `./run.sh sample founder`.

**With a key: watch a map build itself.**

```sh
cp .env.example .env                           # then open .env and paste your Meta Model API key after MODEL_API_KEY= (dev.meta.ai)
./run.sh demo                                  # its own map in data/demo; seed apps that fire on their own start off
node scripts/demo.mjs scripts/demo-talk.jsonl  # in a second terminal, same folder; --speed 2 goes faster
```

- Forgot the key? `./run.sh demo` (and `room`) stops before building and says how to add it; `demo.mjs` stops if the core has no key or the key was refused.
- On a Mac, the key can live in the login Keychain instead of `.env`: `security add-generic-password -s e2a2o -a e2a2o -w` asks for it once, and `run.sh` reads it when there's no `.env`.
- Open the URL printed by `./run.sh demo` as soon as it says `E2A2O core on`, then start the talk: the map builds while you watch. The key is read once, at start. After editing `.env`, press Ctrl+C and run it again.
- `demo.mjs` types a prepared talk into the core at real speed, as a person typing would. Every placement, tidy-up and picture, and every app run with a prompt, is a real model call.
- `scripts/demo-talk-v3.jsonl` also has a misheard model name ("Muse Bark") and an app request, and ends on "what did I decide today".
- `scripts/demo-talk-v4.jsonl` adds what came later: filler that doesn't land (“Um, so, yeah.”), a turn that splits into two topics, and “…okay, where was I?” at the end of a turn. `node scripts/voice.mjs <talk>` speaks any of these through the real speech path instead of typing them. `scripts/burst-talk.jsonl` is twelve quick lines on six topics, ending on “…okay, where was I?”.
- `data/demo` keeps growing across runs; move it aside for an empty map.
- To talk: `./run.sh` (its map is in `data/`), press the mic and allow it, then speak; or type and press Enter.
- To start from your past chats, see [How it works](#how-it-works).

**Things to try (with a key):** With `./run.sh demo` running and its page open, say or type each line. Allow about 4 s after speech for a thought to land.

1. `I need to plan the hackathon demo, the deadline is tomorrow at nine PM.` → a thought lands about 3 to 4 s after you finish speaking.
2. `Oh wait, Mom's birthday is Friday. I should book that cooking class she mentioned.` → a new subject gets a topic of its own, next to the first (an aside that belongs to a topic becomes a tangent of it instead); allow about 4 s.
3. `I'll order the cookbook tonight. And the electric bill, I should set up autopay before the due date.` → a turn can split across two topics; allow about 4 s per part.
4. `Um, so, anyway.` → filler is set aside; nothing lands.
5. `Where did I talk about the electric bill?` → the map jumps to a matching topic; an exact word match is immediate.
6. Select a phrase on the map and press **Explain** → one sentence of context after the model call.
7. `What did I decide today?` → the recap shows at once, decisions first (kept current in the background as thoughts land; anything newer is added in place a few seconds later); it covers today's thoughts. Say `pictures` (or `cards`) and it closes on that view.
8. In Apps, ask `Make an app that shows a card when I mention the demo.` Keep it, then say `demo` in a new thought → the app may take several seconds to build; the card appears when its phrase watcher fires.
9. Switch away for 30 seconds after adding a thought, then return (see [What you'll see](#what-youll-see)).
10. Click **Pictures** → the topic pictures appear in a grid.
11. `What can I say?` → Help, the list of what you can say, opens; your next turn closes it.
12. `Add oat milk to the shopping list.` → a Shopping list topic appears with “Oat milk” at once, with no model call; `Expand everything` opens every topic and its tangents, and `Stop listening` turns the mic off until you tap it.

**Two laptops, one map.**

```sh
./run.sh room
```

- Needs a key, like everything that calls a model. There's no sample shared map.
- The core prints a link with a fresh join code, `https://<this laptop's address>:4321/?room=<code>`. Open it on a second laptop on the same network; the host uses http://localhost:4321. Each person joins with a name.
- One map for both; each thought carries its speaker's name, and each person has their own place, Unfinished thought card and "where was I?".
- One laptop is enough to see it: with a key, `node scripts/demo.mjs scripts/room-talk.jsonl --room <code>` plays two speakers, Ana and Sam, next to your own window.
- The guest sees a self-signed certificate warning: verify the address with the host, accept the exception, then allow microphone access. The certificate is saved in `data/room/tls/identity.json` and reused across restarts. Exceptions depend on the browser; some need the certificate imported and trusted before microphone access works. An IP/hostname change or yearly certificate renewal needs a new exception.
- `./run.sh room` opts into HTTPS. `ROOM_HTTPS=0 ./run.sh room` keeps the old HTTP mode for a shared map (guest typing works, mic unavailable). When starting the core directly, set both `ROOM_CODE` and `ROOM_HTTPS=1` for HTTPS. Alone mode stays on loopback HTTP and creates no certificate.

**Try it with a friend.** A friend anywhere opens a link in Chrome or Safari, allows the mic and talks into a fresh map of their own; nothing to install on their side.

```sh
brew install cloudflared        # once; quick tunnels need no account
sh scripts/trial.sh sam         # one per friend; Ctrl-C ends it
```

- Needs a key. Each run makes a new folder, `data/trials/sam-<time>/`, a core on its own port (from 4410) and a new HTTPS link with a 12-character join code: send that link. Two friends at once get two of everything.
- The core listens on `127.0.0.1` only and lets in just the tunnel, with the code. No one is the host: nothing reaches this laptop's Reminders, Calendar or imports, and this laptop's own localhost is refused too. To watch along, open the same link under another name.
- What they say goes to Meta's models through your key, under the hourly call cap; placing uses the private model, not Contributor mode. Tell them before they start.
- A new link can take a minute to answer on this Mac; `scripts/trial.sh` waits for it. `--no-key` opens the link without a key, to check the page and the mic prompt.

## What you'll see

The page that opens is the shell: the wordmark and the map's name top left; Find (`/`) and Features (`C`) top right; the map in the middle, as the Canvas; the input box at the bottom center with a status line beneath it (the mic's state and time, what is waiting, Saved); and a rail at the right that stays closed until you open it: Talk (`T`), History (`Y`), Features (`C`) and Settings (`,`). History lists what happened, newest first, with Undo on what the AI did. `?shell=1` opens the classic page it replaced, with a header across the top and a bottom bar.

### Conversation partner (off by default)

Open Features (`C`) and switch on **Conversation partner**. Ask an explicit question, or say “Partner, make that shorter” to continue. Ordinary thoughts still go to the map; existing commands such as “where was I?” take precedence. E2A2O appears as an AI participant, shows **Thinking…**, and replies through the existing captions and browser speech voice. **Cancel reply** stops thinking or speech; a new question replaces a pending reply. Switching off the last enabled window or closing it cancels pending work and forgets its conversation context. Spoken replies begin when the feature is enabled.

With the same switch on, “where was I?” speaks a short topic anchor and the unfinished or latest relevant original words, and moves the canvas to that thought. These recovery replies need no key or model. Completed requested recaps speak only their summary; next/previous topic and new-topic outcomes give a short acknowledgement. Routine notifications and background recap drafts stay silent. Command speech is private to the requesting speaker, limited to 60 words and 400 characters. Its completed captions are saved for that speaker's Talk history; catch-up never replays their audio. Switching the feature off stops playback and rejects late command replies in that browser. Verify the keyless recovery path with `node scripts/recovery-speech-check.mjs` (after building the UI).

Questions use the existing saved-thought path. Completed reply captions are journaled with speaker, identity, time and order, and restored in Talk after reload or restart without replaying audio. The partner's model context keeps at most four recent completed question/reply pairs in memory per speaker. The partner reads those exchanges, up to four recent thoughts from the same speaker (600 characters each), and the current question (at most 1,200 characters); other speakers’ thoughts are excluded. Requests use the existing Meta client, key refusal handling and hourly call cap. Replies time out after 20 seconds and are bounded to 60 words, three sentences and 400 characters. Cancel discards the local request and any late result; a request already sent may still be billed.

With **Conversation partner** on and the mic already listening, sustained local speech can stop a spoken reply and continue into transcription. Browser echo cancellation and noise suppression stay enabled. Capture sends silence during playback; only an accepted interruption releases its short local onset buffer. Switching the feature off restores the hard mute. If the browser explicitly reports echo cancellation disabled, local interruption stays disabled. See [local speech verification](local-speech.md) for the synthetic checks and the speaker/microphone trials still needed.

The screenshots below are real, from one run of the demo talk (`scripts/demo-talk-v4.jsonl`, typed in; the Unfinished thought card needed two extra typed lines), taken on the classic page. They are only cropped and resized.

![The map a few thoughts in: topics and tangents, a proposed reminder, and a thought waiting in the placing pill](screens/map.webp)

A few thoughts in: topics and tangents, a proposed reminder, and the newest thought waiting in the placing pill.

![A point where “Muse Bark” was fixed to “Muse Spark”, with the hover text “heard Muse Bark, undo”](screens/did-you-mean.webp)

A misheard word is fixed when the context is clear; hover the “fixed” tag to see what was heard, or undo it.

![A topic marked “left off”, and the card “You didn't finish Electric Bill Autopay” with Finish it and Later](screens/unfinished.webp)

Leave a topic mid-sentence and it is marked “left off”; at the next pause a card offers to take you back.

![Pictures: six topics under one heading (a topic and its tangents), then four topics on their own, each picture with its title and last thought](screens/palace.webp)

Pictures: one picture per topic, drawn by Muse Image during pauses.

![A Recap sheet with a summary, then the decisions made and plans, with what you worked on below](screens/recap.webp)

Recap: what you decided and planned, then what you worked on, each line linking back to its topic.

- The first time, a three-step tour (Skip tour ends it).
- Your words appear live at the bottom; each finished thought waits there in the placing pill (“Waiting” while it's in line, “Finding a place” while its own call runs, “Still working on it · retrying” after a failed try, or “Needs the AI key” without a key), then moves onto the map when placement is available. After 5 seconds the pill counts the seconds since you said it. Hover a point for how long placing took; click or tap a point (or Tab to it and press Enter) to open the words you actually said under it, and again to close them.
- Topics and their tangents; the active one is marked; a topic you left mid-sentence says "left off".
- Nothing is cut short: titles, points, the live words (the last two lines, newest at the bottom, like captions), the Unfinished thought card's half-sentence and Pictures captions wrap. In a window 1100 px or wider the Cards view shows two columns, topics alternating left and right in the map's order. While you talk, every topic but the one you're in (and any left off) goes quiet in gray; at the pause after your last thought lands, everything reads at full strength again.
- Where to look: a thought that lands is highlighted for about as long as it takes to read it (238 words a minute, plus a look over), then keeps a quiet bar beside it until your next one lands. With Reduce Motion on it fades in where it lands instead of moving. If you had scrolled away, the map holds still and the bottom bar says “New in Rent ↓”; tap it to go there. A dot by a topic's title marks a change you haven't seen (someone else's thought, a proposal, a new title, a merge); it clears once it has been on screen long enough to read, or when you touch that topic. While you say a command that opens, folds or focuses “this” (“collapse this”, “open everything under it”, “focus on this”, also after “No, I meant …”), the card it will act on shows “this” and the live words end “· this: Rent”. After “No, I meant …” the mark counts from where undoing your last turn puts you, as the redo does, and shows only while there's a turn of yours from the last 2 minutes to correct. “Add this to Reminders” shows no mark: it adds a waiting action, and its notice names it. Take me there, Recap links and Finish it use the same highlight.
- The Unfinished thought card: see [How it works](#how-it-works).
- “Since you left” appears when your own thoughts land while the window is hidden or in the background for at least 30 seconds. It lists only the topics they landed in, newest first, each followed by the AI's new proposals there; topics you didn't talk in, and other people's, stay out, and the card says so. Each row ends in a chevron and takes you to its topic or proposal; it keeps, adds or dismisses nothing.
- ✦ (the AI mark) marks what the AI added or proposes: tags (faint until kept), one suggestion per topic, actions with "Add to Reminders" or "Add to Calendar", "Did you mean …?", a "fixed" tag, pictures, app cards, Recap, and notes such as "AI renamed … to …". Point at or tap a ✦ and it says what the AI did and how to undo or answer it (Keep, ×, Add to …, Yes or No), or that there is no undo yet.
- The mic shows its state by shape and color, says it on hover or keyboard focus, and the input box's placeholder says it too: off (a soft disc), starting (a dashed ring), listening (a filled disc whose ring swells with your voice, from each 320 ms loudness reading), hearing you (the ring darkens as words come back), paused by “stop listening” (a pause badge), no AI key or a refused one (an amber mic struck through), and connecting (faded).
- Classic page header (`?shell=1`): "This session · 12 thoughts · 4 topics", Recap, Help (the ? button) for keys, spoken commands and Symbols (what each mark, chip, due shade, topic color and mic state means), Import chats, and on a shared map, who has added thoughts.
- Classic page map tools: Cards or Pictures and search; from the second topic, Focus (it stays pressed while on) and Back to active; `?` opens Help, which lists keyboard and spoken commands (the ? key opens it too, outside a text field).
- Keyboard: the first Tab stop is “Skip to Type a thought”; press Enter and you're typing. In a short window (200% zoom and up, or a phone on its side) the shell keeps its corners, input box and status line in place; the classic page's header and tools scroll away and only its input box stays pinned.
- Select a few words on the map, then Explain: one plain sentence on what they mean in that topic, using what other topics say about the same name or term. If an answer (or a Recap) misses the point, press “Off?”: the journal keeps every Explain answer (the phrase, its context, the model, how long it took) and these marks, so a change to the prompt can be checked on real answers. Press it again to take the mark back.
- The Apps panel: your apps with on and off switches, and a box to make one.

## How it works

The core (`core/`, Rust with axum and tokio) holds the map in memory, journals every change, calls the models and pushes each change to every open window over a WebSocket. The UI (`ui/`, React, TypeScript, Motion) draws the map and streams the mic as 24 kHz PCM. The API key stays in the core. More detail, with the life of a thought and every model call: [docs/ARCHITECTURE.md](ARCHITECTURE.md).

### Placing

Each finished speech turn (Voice Transcribe's endpointing) or typed line is checked before the model sees it. Filler such as “um, so” is set aside, as are acknowledgements such as “yeah, okay” unless the last turn was a question. A turn that changes topic is split there; joining words at the cut are left out and the rest is placed next. The model may also set aside short acknowledgements and remarks about pasting the next part, but turns over 8 words are always placed, and so is a short turn right after a question (“The blue.”), as its answer.

The queue sends one thought at a time with every topic's id, title and latest points (the last 3 on the 20 topics touched last, else the last one), plus your active topic and, if you said it in the last 2 minutes, your previous turn word for word with the topic it went to, even with someone else's question in between (so "the cursor thing" right after a word on a subscription isn't read as the on-screen cursor). The selected card is only a hint: the words decide where they land. The JSON answer says to continue the active topic, return to an earlier one or start a new one (a tangent if it names a parent): a topic takes the words only when its title already covers their main subject, read to the end, so an idea that would need a wider title starts its own, even on the same project; words that announce a move (“another idea”, “anyway”) usually start one or cut the turn there, and the rest of a cut turn is told it moved on. It also gives a point of at most 12 words saying what was meant (not a clipped copy of the words; “not” and “maybe” kept), whether the thought trailed off and any words that look misheard (a new topic's title uses the guess). Only existing topic ids are trusted. Each thought gets three tries; after three failures it returns to the queue in 15 s, then at doubling intervals up to 4 min. Measure placing time with `node scripts/latency.mjs data/journal.jsonl` (median, 90th percentile, slowest). To see where each thought went and why, start the core with `E2A2O_TRACE=1` (it appends every model call and placement to `data/<map>/trace.jsonl`; off by default) and run `node scripts/where.mjs data/<map>`; `node scripts/trace-summary.mjs data/<map>/trace.jsonl` counts every model call by feature and model ([one run's, shortened](trace.md)). Routing cases (`scripts/routing-cases.jsonl`) run against the real model with `cd core && cargo test --release -- --ignored routing_cases --nocapture` and `MODEL_API_KEY` set.

A thought said in two parts across a pause lands as one point. The prompt also quotes your latest turn that trailed off when it's still the last word on its topic and you said it in the last 2 minutes or went back to it ("where was I?"); the answer says whether the new words carry on the turn before or those unfinished words. Then they land on that topic whatever else the answer says, linked, and the card shows both parts as one point (its words said open as “first part” … “second part”) with a quiet ✦ joined: a tap on it keeps them apart, and the second part then says only its own words. Each part keeps its own "Did you mean …?" and undo of a fix, and a yes there fixes the joined point too (a yes on the joined point about words said in its first part fixes them there, so its words said match); a search for a part lands on the point it shows in; "scratch that" and Undo bring a part back joined. A sentence that stands on its own, or a decision, is never joined. When a reading your words left open (what "it" means) took a thought away from the topic you were on, the point says so under it (“✦ Assumed 'it' is the pottery class”); one that kept it where you were isn't shown, since it changed nothing. Opening a point's words said also shows why it went there in 10 words or fewer (“Why here: finishes 'never finish my'”), except for a thought that starts a new topic, whose own topic is the answer, and a reason that names a topic by id. Where none was kept, "Why here?" asks on request: a move of yours or a topic's first thought answers from the map, anything else from one fast model call kept on the thought ("Likely why: …"); each "Since you left" row says the same on its "Why?". Asking for it cost no measurable time: 30 turns placed by two cores in turn, one asking and one not, median 2.90 s with it and 2.98 s without (the same turns paired: +0.1 s). Join cases for the real model are in `scripts/chunk-cases.jsonl` (`ROUTING_CASES=../scripts/chunk-cases.jsonl` with the routing-cases command).

### The unfinished-thought card and voice commands

Leave a topic whose last thought trailed off (“I need to pay rent before…”) and it's marked dropped, for you only. After 2.5 s without new words, the card offers the one you dropped last with your last words and Finish it and Later. The first Later hides it until at least 5 minutes have passed and you pause; it then returns once. A second Later hides it until that topic changes.

Spoken commands are recognized by rule, with no model call, and only as a whole turn, except that “where was I?”, “next one” and “last one” also work at a turn's start or end (“The rent is due Friday. Well, where was I?” places the thought, then goes back), and “stop listening” at its end (“…the flight. Stop listening.”), while “I bought a boat. What was I thinking?” stays a thought:

- **Getting back:** “where was I?”, “next one”, “last one”, “Finish it”, “Later”, “forget it”.
- **Finding:** “where did I talk about …?”, “take me back to …”, “go to the one about …”.
- **Views:** “pictures”, “cards”, “focus on this”, “show all”, “expand everything”, “collapse this”, “what can I say?”.
- **Filing:** “add milk to the shopping list”, “new topic about …”, “move that to the pottery topic”, “rename this to …”, “delete this”.
- **Actions:** “add it to Reminders”, “keep it” or “discard it” for an app, “stop listening”.
- **GitHub (Full preset only):** “show me the open pull requests”, “what's happening with PR 42”, “any PRs in owner/name?” shows a read-only card; a click opens a pull request on GitHub. See [Presets](#presets-and-messages).
- **Messages (Full preset only):** “ask Mia to confirm what to bring” shows the message on a card with a 5-second countdown; “stop”, Esc or the card's Stop takes it down unsent. See [Presets](#presets-and-messages).
- **Notes (Full preset only):** “save this topic as a note” or “put this in Notes” shows the note on a card, then writes it into Apple Notes. See [Presets](#presets-and-messages).
- **Fixing:** “no, I meant …” redoes your last turn as the request you name; “scratch that” (also after “no”, “sorry” or “oops”) undoes it. Deleting, scratching or moving a point takes the waiting cards made from its words alone with it, with Undo; a card sharing any meaning word with what stays on the topic (its title or other points) is left where it is. Only when no rule reads a correction does one model call read it, and its answer runs only if the same rules accept it.

Getting back, finding, views, filing and fixing in full, with variants and what each never does: [docs/COMMANDS.md](COMMANDS.md). Recap, making an app and answering “Did you mean …?” are in their own sections below; “what can I say?” opens Help, which lists them all.

The earlier spoken words still work: “palace” for “pictures”, “map” for “cards”, and “thread” where a command says “topic” (“new thread about …”, “move that to the pottery thread”, “save this thread as a note”). <!-- names-ok: spoken alias -->

### Presets and Messages

A preset picks which connectors a run has. **Demo** (the default) is the core alone: the map, and Reminders and Calendar after you approve. **Full** adds every connector: Messages, GitHub and Notes. Set `PRESET=full` in `.env` to switch.

In Full, a whole turn like “ask Mia to confirm what to bring” (or “text Sam that I'm running late”) puts a card up with who it's to, the message (“Hi Mia, could you confirm what to bring?”) and a countdown. The count is 5 seconds for a short message: enough for a slow reader to read about 8 words, decide, and say “stop”. A longer message gets longer. “Stop” (also “cancel”, “wait”, “no”, “don't send it”), Esc or the card's Stop takes it down unsent; a spoken “stop” counts as soon as it's heard, before your turn ends, and a stop still counts for a second after the card's count ends, so one made as it says “Sends in 1” is never late. “No, I meant text Sam …” takes the first one down before the new one counts. A reload brings the card back with its time left. Only when the count ends does it go, and only:

- to someone on your list (`MESSAGES_TO=Mia=+15551234567, Sam=sam@example.com`); any other name stays a thought, and the app says why. The phone number or email never leaves the core.
- from the host's laptop: on a shared map, a guest's words never send from the host's Messages.
- one at a time, until Messages has answered for the one before.
- for real only with `MESSAGES_SEND=on`, on a Mac, through Messages (macOS asks first). Without it, it's a dry run: the card counts down the same and then says what it would have sent.

In Full, “show me the open pull requests” (or “what's happening with PR 42”, “any merged PRs in owner/name?”) puts a card up with each pull request's number, title, state, checks and when it last changed, the most recently changed first, up to 10; a click opens one on GitHub. It reads through `gh` on the host's laptop and only reads: it never comments, reviews, merges or closes. The repo is the one you name (owner/name, a name on `GITHUB_REPOS`, or a bare name, taken as your account's), else `GITHUB_REPO`, else the repo the app runs from. Only the host sees it; it's off in Demo and on a hosted map. If `gh` is missing, signed out or slow, the card says so in one line.
Also in Full, “save this topic as a note” (or “put this in Notes”, “save the picnic topic to Apple Notes”) shows a card with the note it makes: the topic's title, its points in the order said, a decision marked “Decided”, words left unfinished marked “unfinished”, and each tangent under its own heading. Then it writes that as a new note in Apple Notes, only from the host's laptop, and only with `NOTES_WRITE=on` on a Mac (macOS asks first); without it, the card says it's a dry run and nothing is written. Open in Notes shows the note there. Each save is a new note, and the app never changes or deletes one. With a topic called Notes on your map, “put this in Notes” still means that topic. Notes is off in Demo and on a hosted core.

### Did you mean, and confident auto-fix

With each placement the model names words that look misheard, its guess, and whether the context leaves no doubt (say, the right name is already on the map). If it's sure, and those words are really in what was said, the core swaps them and marks the point "✦ fixed": hover shows what was heard, and one click puts it back. Anything less is asked: "Did you mean "Muse Spark"? Yes / No". While that question is on your latest thought, a spoken “yes”, “no” or a short fix (“No, Muse Lark”, “It's Muse Lark”) answers it as the buttons do; once you've said or asked anything else, it waits for the buttons. A spoken yes only ever answers that question: it never adds anything to Reminders or Calendar, which take “add it to Reminders” or the Add button.

### The refiner

At a pause (4 s quiet) after two new thoughts or a new topic, after 8 s quiet for a single new thought, or when you come back to the window, with at least 10 s between passes (longer after failed ones), Muse Spark 1.3 reads the map: quiet topics as one line, recent ones with their last 8 thoughts, and each topic's tags. It renames a topic on its own only when the new title is your own words (said on that topic, from at least two of its points when it has two or more, or a name you gave it), and says so with Undo. Any other rename, and every merge, waits on the card as a proposal: Rename or Merge applies it (a merge comes with Undo too) and × keeps things as they are; neither is asked again. A title you chose (one you set, an AI rename you undid, a rename you turned down) is left alone. A point that flags something without saying what (“the intro still bugs me”) gets one question asking what. It adds at most one suggestion per topic, proposes actions (a reminder, or an event when a date is stated) and suggests up to three tags per topic. If you start talking while it works, its result waits for the next pause and is checked against the map as it is then. Approving an action runs AppleScript on the host laptop: reminders go to their own "E2A2O" list, dated events become all-day events in their own "E2A2O" calendar. The row says “Adding to Reminders…” until Apple answers, then “Added to Reminders · 1.2 s” with how long Apple took; if Apple refuses (say, macOS hasn't allowed control of Reminders yet), the row says why and offers Try again.

### Pictures

During pauses, once a topic has settled for 12 s, Muse Image draws one picture for it (up to three at a time): the one object you'd name for the topic (a key for rent, a cake for a birthday), different from the map's other topics, in clay of its color, with image search, web search and shell off. Up to three tries per topic. Each topic and its tangents share one color (green, pink, teal, red and lime in turn), used for their pictures, the rail that holds the tangents and their heading in Pictures; none is near the blue, amber or purple that mean where you are, what needs you and what the AI added. The core keeps the full WebP and serves a 128 px copy for Cards and a 512 px copy for Pictures, both keeping Muse Image's note that AI made it. Until a topic's picture comes, its first letter holds the place in Cards and in Pictures, so the picture fades in without moving anything. The picture shows only once it has decoded; one that fails to load keeps the letter (never a broken-image glyph) and is fetched again a few times and when the core comes back, which never asks Muse Image for a new drawing. Pictures shows topics as picture tiles, each topic with its tangents under one heading, then the topics on their own under one heading; each tile shows the topic's last thought under its title. Each topic with its tangents sits beside the next one when both fit, as wide as its pictures, so a session fits one screen (7 topics under 2 headings and 3 on their own, at 1440×900). Left and right arrows go in reading order, up and down to the nearest picture; Enter opens the topic in Cards.
The sample pictures and topic pictures were generated by Muse Image 1.0; each carries an XMP metadata note that AI made it.

### The app builder and its apps

An app is a watcher (a new thought, a phrase, a topic, loud voices for some seconds, a time), an optional single model prompt, and one to three publishers (a card on the map, a short tune, a proposed reminder). Say “make an app that…” (or “build an app which…”, “make a new app to…”, “make an app for when…”, “make an app: if…”) or “Can you make me an app to …”, or use the Apps panel. The app builder first looks for an app that already does it (Search-first looks while the builder starts, so a build takes about 3 s, not 5; a search that fails or takes over 6 s is skipped, since the builder checks existing apps too); otherwise Muse Spark 1.3 picks blocks under a JSON schema, and the core rejects unknown blocks or fields and out-of-range values. A draft that fails validation is retried once with the error explained; a valid draft can then be kept or discarded. When the blocks can't do the main thing asked (book a flight, send an email, search the web), or the request has no likely reading ("hi"), the builder says why in one sentence and offers the closest app it can make, one click away, instead of building a look-alike. Phrases and topics match whole words (a plural counts), so "AI" doesn't fire on "said". A volume app hears one reading every 320 ms, the RMS of that stretch of mic audio after the browser's processing, and fires once readings stay at its level for its seconds, riding out one low reading (a breath between sentences). The builder is given what normal speech, a raised voice and a shout read, so “when we get loud” lands between normal speech and a raised voice, held at least 3 seconds, since normal speech's louder words can clear that level for a second or two (the core holds it there if the builder picks less). The Volume watcher uses the same level and hold; one seeded by an earlier build moves to them on start, still on or off and playing what it did. Add `?level` to the address to see each reading as the core receives it, with the typical reading of each stretch of talk; a stretch ends where readings fall to half the voice or back to the room, for a second. When an app plays its tune, the bottom bar names the app and what set it off (“♪ Loud Silly Tune: voices stayed loud for 3 s”) for about 3 s. Apps can't run code, open URLs or act on their own; a proposed reminder waits for your approval. Three seed apps. Nothing acts unasked, so the two that fire on their own start off until you switch them on in Apps: Argument resolver (gently names a repeated point or a common fallacy), Volume watcher (plays a short, silly tune and suggests a pause when voices stay loud; its row can switch to the card alone). Search-first (offers an existing app before making another) runs only inside a build you asked for, and starts on in demo mode. To check the app builder against 36 sample requests: `node scripts/composer-check.mjs --runs 2` with a core running (real model calls; it discards every draft). Beat 5's sentence, 11 paraphrases and 6 requests near it that must be refused: `--requests scripts/beat5-requests.jsonl --runs 5`, on a demo core with the Volume watcher removed (Apps › Steps › Remove app). <!-- names-ok: ordinary word -->

### Features

Parts of the app can be features: a view, a card, an input or a panel, each in a folder of its own under `ui/src/bricks/`, found by reading the folders, so adding one is adding a folder. The Features page lists them, each with its line and an on/off switch kept in this browser. The Level meter is one optional feature (also `?level`). Each feature sees the map read-only and acts only as the app's own buttons do; `ui/bricks.html` runs one on a sample map, without the core. How to build one: [`docs/bricks.md`](bricks.md).

### Recap

Say "recap" (or "let's recap", "what did I decide?"), "what did I decide today?" or "recap this session", or press Recap. Today runs from local midnight; a session, from the last 30-minute gap. Only that period's thoughts go to the model, in the speakers' own words, capped at 24 topics, 16 thoughts each and 64 actions. It returns a summary that leads with your decisions when there are any (“You decided to …”; when the model's line doesn't, the core writes it from the first two) and otherwise names your topics, what you worked on, plans (intentions such as "I want to…"), decisions (explicit choices only) and open questions; the core adds the unfinished topics and their actions, drops any topic the model invents, and if none are named, links the three topics with the most points. Each line links to its topic. The sheet opens on decisions ("None yet" when there are none), plans and open questions, then what you worked on. Saying "cards" or "pictures", a search that jumps, "where was I?", "next one" or "last one" closes it, so the result shows; a thought said while it's open lands behind it. The recap is saved in the journal; asking again with nothing new makes no call.

### Importing your chats

Choose Import chats (top right), then a ChatGPT or Claude `conversations.json` export, or Try with a sample of five made-up chats. Before sending, the app previews what it found, which models will receive it, and a rough cost. The core also reads a JSON or JSON Lines list of messages with a role and content, up to 100 MB. Only your own messages are read: the latest ones, up to 300,000 characters, each cut at 2,000, with the first 240 characters of the AI's reply as context; messages an earlier import already read are skipped, so importing the same file twice adds nothing. Muse Spark 1.2 reads them in parts, six at a time, and pulls out each idea as a short point with your own words and its date. Muse Spark 1.3 then sees only those ideas, never your messages, and groups them into topics (one level of tangents, or onto topics already on the map), at most one open question per topic, and dated tasks. Topics land one at a time, each point keeping the time you first wrote it; if grouping fails, each theme becomes its own topic. Neither step uses Contributor mode unless you set it. On a shared map, only the host can import. The file isn't kept.

### Shared maps

`./run.sh room` sets a fresh 8-character code and puts the core on the local network; without a shared map it answers only this laptop. A laptop without the code gets only the page, to type the code in, not the map or the pictures. Every window streams its mic through the host's core, one Voice Transcribe session per window, under that person's name. Only the host's own window can approve actions, since they land in the host's apps.

In a call, the Talk tab (in the shell, not on the classic page) shows who's here and what each is doing: speaking, mic on, here or left. What was said appears as messages; whoever has the floor shows "Speaking now…", never their live words. A read line moves as you read, with marks for where each other person has read. Catch up takes you to what you missed; a late joiner might see "Joined 7:36 · 9 turns before you". Replies on picked words become comments. With the AI helper here, its interruption level is Mark · Ask · Comment · Speak · Interrupt (Speak by default). The Share panel has the Join code, Copy link and Leave; Talk has the code to copy and Leave, on a phone too.

On a phone, `?remote` (add `&remote` to the invite link) opens the Remote instead of the map: the Work spine full height, and at its foot the question an AI helper holds for you, with a box to answer it and a tap for each half of one that reads "A, or B?". Send relays your words to the helper that asked (the core delivers an `answer` to every window of that name). It joins the shared map as any phone does, by a name; with no shared map it plays the page's own demo feed under "Demo mode · simulated" (`&speed=4` plays it four times faster) and what it sends goes nowhere. The Share menu's “Open Remote on your phone” copies the link that opens it (the invite with `&remote=` and the name “<your name>'s phone”, which the phone's name form already holds). A Remote joins by the shared map's join code and a name of its own, like any phone, and says it is a Remote: it is no second person to the laptop, which opens no Talk for it and keeps the Work spine's lane, and the Share menu lists it as “<name> · remote”.

### Places on the canvas

Any window, a person's or an AI participant's, can put a topic's card or a thought's point anywhere on the canvas, and every window gets it; no place calls a model. Over the WebSocket:

- **Put it:** `{"type":"position","id":"T3","x":120.5,"y":-40}`, with a topic's or thought's id and the canvas coordinates of its top-left, each within ±1,000,000. **Back to the automatic layout:** `"x":null,"y":null`.
- **Every window gets** `{"type":"change","change":{"type":"positioned","id":"T3","x":120.5,"y":-40.0,"by":"Ana","at_ms":…}}`, `by` naming who put it there (two nulls: back in the layout); the snapshot a window opens with holds them all as `positions`, each id's `{x, y, by, at_ms}`.
- **Refused,** with a note to the sender alone: an id not on the map (a topic merged away too), or one number without the other.
- **A place goes** when what it placed leaves the map (deleted, merged away); Undo brings that back in the layout.
- **A drag** sends a step every frame, and each reaches every window at once; the journal keeps at most one line per item every 250 ms, the latest, so a restart opens where the drag ended.

### The journal

Every change is appended as one JSON line to `data/<map>/journal.jsonl`, then sent to every window; on start the core replays it, so the map opens where you left it. `./run.sh NAME` uses `data/NAME`; plain `./run.sh` uses `data/`.

### Hosting it

A deploy that runs one core per signed-in person sets `E2A2O_HOSTED=1` for each core (off by default, so a laptop and `scripts/trial.sh` read as before). The window then says thoughts are saved on the site's server, never points at `.env` or the host's computer, and saves a dated item as a calendar file (`.ics`) instead of adding it to Reminders or Calendar; so does any core not on a Mac. An empty map offers Try a sample map, which fills it with the student's week from `samples/`, and under it three shorter maps (a team meeting, a bug left for a call, a walk through a house, each with its pictures) (the core reads `E2A2O_SAMPLES`, else `../samples` beside its working folder; without it the button stays hidden). The first screen names the Meta models the core asks, by step.

## Privacy and data

- The core runs on your laptop (hosted, on the site's server: one core and map folder per person). The browser talks only to it and loads nothing from elsewhere; the key never reaches the browser.
- Model inputs go to `api.meta.ai`:
  - **Speech:** while the mic is on, raw 24 kHz audio and setup data (session id, model, audio format, endpointing mode, English bias and keywords). The client sends no transcript as input.
  - **Placing:** the full new thought; every topic's id, title, status and last point (the last 3 points on the 20 topics touched last); the active topic id; and up to 30 names found in placed thoughts. If the most recent thought by anyone ended in `?` and this thought has at most 8 words, it also sends that previous thought's full text. It also sends your own previous thought's full text and its topic id, if you said it in the last 2 minutes and it isn't that question.
  - **Refiner:** today's date; each topic's id, title, parent, tags and last point; the latest 8 full thoughts from recently active topics; the latest 30 suggestions and actions. On a shared map with multiple speakers, each recent thought includes its speaker name.
  - **Take me there:** only if local word search finds no topic containing every query word, the query (up to 400 characters) and up to 48 topic titles (100 characters each) with their latest 3 points (320 characters each).
  - **Fixing a turn:** only when no rule reads a correction, your previous turn's words, what it did, the correction, up to 40 topic titles and the list of actions the app can take.
  - **Explain:** the selected phrase (up to 160 characters), up to 600 characters around it, up to 12 points from its topic, its parent's title, up to 40 other topic titles, and up to 8 thoughts from other topics that name the selected words.
  - **Recap:** up to 24 topics, with up to 16 thoughts per topic (each includes the speaker and up to 700 characters of text), plus up to 64 actions.
  - **Pictures:** the topic's title, its first point, and up to 18 other topic titles (so two topics don't get the same object); nothing with `PICTURES=off` in `.env`.
  - **App creation:** the request, local time and the list of existing apps. If the Search-first app is enabled, it may first receive the request and that list to look for an existing app.
  - **When an app runs:** its prompt, newest thought, up to 8 earlier points, topic and time. On a shared map with multiple speakers, those thoughts include speaker names.
  - **Chat import:** each selected message (up to 2,000 characters) with its date and conversation title, plus up to 240 characters of the next AI reply. A separate grouping call receives today's date, up to 80 existing topic ids and titles, theme counts and date ranges, up to 4 latest ideas per theme, and up to 150 dated open questions and 150 dated tasks. It does not receive the original messages.
- Placing races `muse-spark-1.3` and `muse-spark-1.2` (`PLACER_MODELS`); Explain uses `muse-spark-1.2`. Neither is in Contributor mode. `PLACER_MODEL=muse-spark-1.2-contributor` turns it on, for Explain and every placing call: a little faster and cheaper (median 3.0 s vs 3.3 s in our test), but Meta may keep what it reads to improve its products, including imported words once they become thoughts on the map. A `PLACER_MODEL` you set is used as is, with no fallback: if the key can't use it (401 or 403), the key counts as refused and every model feature stops until a restart. A Contributor model listed in `PLACER_MODELS` gives way to the same model without it when the key can't use it, for its own lanes only. A listed model the key can't use at all (401, 403 or 404) leaves the race until a restart, said once, and the others place; the key counts as refused only when every listed model refuses it.
- On disk: `data/<map>/journal.jsonl` (each thought's full text and speaker, and every change since) and `data/<map>/images/`; with `E2A2O_TRACE=1`, also `data/<map>/trace.jsonl` (every model request and answer, never the key). `data/` and `.env` are git-ignored. Delete a map's folder to forget it.
- On a shared map, everyone with the code sees the whole map, and the other laptops' audio goes through the host's core and key.
- No accounts, analytics or telemetry.

## Security

- Alone, the core listens on 127.0.0.1 only. A gate checks every request: the Host must name this machine (stops DNS rebinding), and an Origin, when sent, must be the app's own page (from this machine, only the core's own port: another local server's page is another site), so another site open in your browser can't use the WebSocket (browsers always send Origin on one). What a window sends is bounded: a typed thought at 6,000 characters (the window sends a longer one in parts), a title at 100, a tag at 40, one WebSocket message at 64 KiB; past them nothing is kept, and the window says why. Responses carry `Cross-Origin-Resource-Policy: same-origin`.
- On a shared map, the Host must be this laptop's own address, and the map and pictures need the code (a query on the WebSocket, a `SameSite=Strict` cookie for pictures), compared in constant time. `./run.sh room` makes 8 characters from 31 letters and digits; a shorter `ROOM_CODE` starts with a warning. Approving actions and importing work only from the host's own window.
- Model output is data: the placer trusts only existing topic ids; app specs must match a closed set of blocks (`deny_unknown_fields`, range and template checks); app prompts are told the conversation is data and that they can't act. The UI renders text only, never raw HTML.
- `scripts/precheck.sh` runs before anything goes public, and before every merge to main, with `cargo test` and the UI build. It fails on: `.env` or data files in git, key-like strings, home-directory paths, a core not limited to 127.0.0.1 when alone, a missing Origin and Host gate or shared-map test, a model client without a timeout, `dangerouslySetInnerHTML`, a non-Meta model SDK, endpoint or model name in the app's code (the hackathon requires every model called at runtime to be Meta's) or any outside host but `api.meta.ai` in the core or UI, a model call that bypasses the hourly cap, health claims in the README, docs or UI copy, a link inside the repo that lands nowhere, a date before the first commit in the README or docs or on a measurement in the code (`scripts/dates-check.mjs`), or a failing `cargo test`. `scripts/model-guards.py` holds the model checks (Meta only, `api.meta.ai` only, the hourly cap) and `scripts/health-words.pl` the health-claims check, each with a self-test that plants each kind of breach. With the app running, it also probes it: another site's WebSocket and a rebinding Host must get 403, and so must the map without the code on a shared map. It warns about numbers in the code marked `stand-in:` until a measurement replaces them, and about any placeholder left in the README; `scripts/release.sh`, the gate before the repo goes public, fails on both.
- Run the tests yourself, no key needed: `sh scripts/test.sh` (the core's Rust tests, the UI build and every offline UI check); [CI](../.github/workflows/ci.yml) runs it and `scripts/precheck.sh` on pushes to main and on pull requests once the repo is public; while it is private, only when started by hand (`gh workflow run ci.yml`).
- `python3 scripts/secret-scan.py` scans tracked working and staged files and all Git objects reachable from local refs and HEAD, including deleted and binary blobs, commit messages and annotated tags. It blocks private `.env` variants in current files and historical trees; `.env.example`, `.env.sample` and `.env.template` are allowed names whose contents still get scanned. Credential patterns cover common provider tokens, credential assignments, private keys, authorization headers and URLs with passwords. Findings show only rule names, object IDs and line or tree-entry numbers, never values or source snippets. Unreadable objects and shallow history fail the scan. Pattern matching can flag test fixtures and cannot recognize every possible secret; review findings locally. `python3 scripts/release-safety-test.py` exercises the guards with offline fixtures and runs in precheck.
- `scripts/release.sh` forces the full precheck even if `PRECHECK_PAGES=0` or `only` is inherited. Missing UI dependencies and skipped browser checks block release. Both `VIDEO_FILE` (readable by ffprobe, at most 180 seconds) and `VIDEO_URL` (opens logged out) are required.

## What existed before the event

- Before the event: the idea and design notes. No code.
- Written during the event (Oct 26 to Nov 4, 2026): everything in this repository; the first commit is from Oct 31.
- Built by one person working with AI coding agents.

## Known limits

- Every model feature needs `api.meta.ai` and a key; there's no local or offline model.
- Reminders and Calendar need macOS; elsewhere, and hosted, a dated item downloads as an `.ics` file for any calendar app, and one without a day can only be dismissed. Tested on macOS only (Linux and Windows: [Try it](#try-it)).
- Set up for English: Voice Transcribe is biased to English. It can spell names and uncommon words differently; “Did you mean” catches some misheard words.
- From the end of speech to the map: median 3.3 s, slowest 4.0 s with the default model (n = 9 thoughts, one synthesized-voice take through the real speech path, 2026-11-01); across 5 earlier takes, before two placing calls raced, 4 of 40 took 5 s or more. The live words show about 1 s after you start.
- Placing is a model's judgment. You can move or delete a thought and rename a topic yourself, by voice or click, with Undo; you can't merge or split topics yourself, except by applying the refiner's proposals, nor move a whole topic under another.
- A Voice Transcribe session can end after 60 minutes. When the speech service stops, the app says “The mic stopped. Tap it to keep talking.” A stream that goes quiet without closing (no word and no progress report for 3.8 s, longer than any finished turn takes to come back) ends the same way, saying the voice service stopped answering.
- Placing is one model call at a time, in the order things were said, so each sees the map the one before left. A long turn that moves across several topics is placed one part after another, so in a burst the last part can land long after you stop (27 s in one measured run: three speakers at once on a shared map, with `scripts/voice.mjs`); talking alone at a normal pace keeps up (3 to 4 s). A failed or stalled try (12 s for the first) sends the thought back in line, so the rest keep landing; after three failures the app says so, and it retries after 15 seconds, then less often, up to every 4 minutes.
- Only one app can be built at a time. A new request while a build is waiting or running is refused; keep or discard the current app first.
- Pictures come only during pauses, so a busy session gets them late.
- The loudness scale for volume apps comes from synthesized speech played through Chrome's processing, not yet from a real microphone. There, the browser's automatic gain lifted normal speech and left a raised voice only about 1.3 times as loud, so a raised voice can take a few seconds to set off a volume app.
- `./run.sh room` works on one local network only; `scripts/trial.sh` reaches the internet through a tunnel link. The join code is the only check: anyone who can reach the core and has it can join.
- On a shared map, a name belongs to one laptop at a time, ignoring case; the host keeps theirs until the core stops.
- If both microphones on a shared map pick up both people, the same speech can be transcribed twice.
- One map per data folder, shared by every window on it; no accounts. The journal only grows (no compaction). Export (or “export my map”) saves the map as Markdown, made in the window: topics as headings, points with their times, decisions marked; the words behind each point stay in the journal.
- The sample maps were written by hand, timings included, and are dated the week of Nov 3, 2026. They include a hand-written “Did you mean” question that works as a live one; Recap needs a key; with one, "recap" opens the sample's last session once Nov 3, 2026 has passed (before then the sample is dated ahead and Recap finds nothing).
