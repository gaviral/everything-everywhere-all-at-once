# E2A2O

<!-- cover: stand-in, User to pick (three options in the design repo, docs/drafts/cover) -->
![A microphone whose cable branches into colored tiles: speech in, a map of threads out](docs/cover.webp)

<!-- pitch: draft, User to approve -->
For people who think out loud and lose their threads. You talk (or type), and E2A2O puts each thought on the right thread of a live map a few seconds later: a topic, or a tangent branching off one. When you jump to something new halfway through a sentence, it marks the thread you left, and at the next pause it offers to take you back. While you're quiet, it tidies titles, suggests a next step, gives each thread with a few thoughts a picture, and proposes reminders and calendar events from what you decided; nothing reaches your Reminders or Calendar until you approve it. It can also start from your past AI chats.

Built during the Meta Global AI Developer Hackathon with Cerebral Valley (Oct 26 to Nov 4, 2026), on Meta's Muse Voice Transcribe, Muse Spark and Muse Image.

## Try it

Tested on macOS. Needs Rust 1.89 or newer ([rustup.rs](https://rustup.rs); run `rustup update` if yours is older) and Node.js 22.12 or newer. On a Mac with no developer tools, run `xcode-select --install` first.

Get the code and step into its folder:

```sh
git clone https://github.com/gaviral/e2a2o-app.git && cd e2a2o-app
```

The first run compiles the Rust core, which takes a few minutes. When the terminal says `E2A2O core on`, open the URL printed on that line. Without a key, it also prints a `WARN ... MODEL_API_KEY is not set`; the sample does not need one. Press Ctrl+C to stop it.

If port 4321 is busy, use another one: `PORT=4400 ./run.sh sample`. Open http://localhost:4400. For the talk scripts below, also pass `--port 4400`.

**No key, no mic: a sample map.**

```sh
./run.sh sample
```

- A prepared map of a student's week, dated Nov 3, 2026: 8 branched threads, 30 thoughts, tags, two suggestions, two reminders, one unfinished thread and a picture per thread. The app's picture pipeline drew them once and saved them in `samples/images/`, so the Palace is full without a key. It starts fresh from `samples/` each run and includes a real “Did you mean BC Hydro?” question for “BC Hydra.” Recap needs a key; with one, a bare "recap" covers the sample's last session (once its Nov 3, 2026 date has passed).
- Try: show and hide threads (`j`/`k`, Enter, Esc), search with `/`, keep a ✦ tag, try the unfinished card (see [How it works](#how-it-works)), open the Palace and the Apps panel.
- Without a key, the header says “No AI key”; you can still browse the map and use search and navigation. New typed thoughts stay marked “Needs the AI key,” and the mic and model features are off. “Add to Reminders” still works and really adds to your Reminders (macOS asks first).
- With a wrong or expired key, the first model call is refused and the app stops calling: the header says “AI key refused” and new thoughts wait, saved, until you fix `MODEL_API_KEY` and restart. If the service is busy (rate limited), it backs off and says so once.
- The core makes at most 400 model calls in any hour (`MODEL_CALLS_PER_HOUR` in `.env`; 0 turns it off), twice the busiest hour on a real map, so an app or loop nobody is watching can't run up the bill. Past it, it says once “AI paused up to N min”: placing, the refiner, pictures, apps, Explain, Recap and search by meaning rest until the oldest call is an hour old, while the mic keeps listening and new thoughts wait, saved, to be placed then.
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
- `scripts/demo-talk-v4.jsonl` adds what came later: filler that doesn't land (“Um, so, yeah.”), a turn that splits into two topics, and “…okay, where was I?” at the end of a turn. `node scripts/voice.mjs <talk>` speaks any of these through the real speech path instead of typing them. `scripts/burst-talk.jsonl` is twelve quick lines on six topics, ending on “…okay, where was I?”.
- `data/demo` keeps growing across runs; move it aside for an empty map.
- To talk: `./run.sh` (its map is in `data/`), press the mic and allow it, then speak; or type and press Enter.
- To start from your past chats, see [How it works](#how-it-works).

**Things to try (with a key):** With `./run.sh demo` running and its page open, say or type each line. Allow about 3 s after speech for a thought to land.

1. `I need to plan the hackathon demo, the deadline is tomorrow at nine PM.` → a thought lands in about 3 s after you finish speaking.
2. `Oh wait, Mom's birthday is Friday. I should book that cooking class she mentioned.` → a new topic gets a thread of its own, next to the first (an aside that belongs to a thread branches off it instead); allow about 3 s.
3. `I'll order the cookbook tonight. And the electric bill, I should set up autopay before the due date.` → a turn can split across two threads; allow about 3 s per part.
4. `Um, so, anyway.` → filler is set aside; nothing lands.
5. `Where did I talk about the electric bill?` → the map jumps to a matching thread; an exact word match is immediate.
6. Select a phrase on the map and press **Explain** → one sentence of context after the model call.
7. `What did I decide today?` → a recap after the model call, decisions first; it covers today's thoughts. Say `palace` (or `map`) and it closes on that view.
8. In Apps, ask `Make an app that shows a card when I mention the demo.` Keep it, then say `demo` in a new thought → the app may take several seconds to build; the card appears when its phrase watcher fires.
9. Switch away for 30 seconds after adding a thought, then return (see [What you'll see](#what-youll-see)).
10. Click **Palace** → the thread pictures appear in a grid.
11. `What can I say?` → the list of what you can say opens; your next turn closes it.
12. `Add oat milk to the shopping list.` → a Shopping list thread appears with “Oat milk” at once, with no model call; `Expand everything` opens every thread and its branches, and `Stop listening` turns the mic off until you tap it.

**Two laptops, one map.**

```sh
./run.sh room
```

- Needs a key, like everything that calls a model. There's no sample room.
- The core prints a link with a fresh room code, `http://<this laptop's address>:4321/?room=<code>`. Open it on a second laptop on the same network; the host uses http://localhost:4321. Each person joins with a name.
- One map for both; each thought carries its speaker's name, and each person has their own place, unfinished card and "where was I?".
- One laptop is enough to see it: with a key, `node scripts/demo.mjs scripts/room-talk.jsonl --room <code>` plays two speakers, User and Sam, next to your own window.
- The second laptop loads the page over plain http from a network address, which browsers don't treat as secure: its mic doesn't work, but typing and Explain do. To use its mic in Chrome, open `chrome://flags/#unsafely-treat-insecure-origin-as-secure` on that laptop, add the link's address (for example `http://192.168.1.20:4321`), set the flag to Enabled and relaunch Chrome. If macOS asks whether the host may accept incoming connections, choose Allow.

## What you'll see

Real screenshots from one run of the demo talk (`scripts/demo-talk-v4.jsonl`, typed in; the unfinished-thread card needed two extra typed lines). They are only cropped and resized.

![The map a few thoughts in: threads and branches, a proposed reminder, and a thought waiting at “Finding a thread”](docs/screens/map.webp)

A few thoughts in: threads and branches, a proposed reminder, and the newest thought waiting at “Finding a thread.”

![A point where “Muse Bark” was fixed to “Muse Spark”, with the hover text “heard Muse Bark, undo”](docs/screens/did-you-mean.webp)

A misheard word is fixed when the context is clear; hover the “fixed” tag to see what was heard, or undo it.

![A thread marked “left off”, and the card “You didn't finish Electric Bill Autopay” with Finish it and Later](docs/screens/unfinished.webp)

Leave a thread mid-sentence and it is marked “left off”; at the next pause a card offers to take you back.

![The Palace: a room of six threads under its heading, then four threads on their own, each picture with its title and last thought](docs/screens/palace.webp)

The Palace: one picture per thread, drawn by Muse Image during pauses.

![A Recap sheet with a summary, then the decisions made and plans, with what you worked on below](docs/screens/recap.webp)

Recap: what you decided and planned, then what you worked on, each line linking back to its thread.

- The first time, a three-step tour (Skip tour ends it).
- Your words appear live at the bottom; each finished thought waits there (“Waiting” while it's in line, “Finding a thread” while its own call runs, “Couldn't place yet · retrying” after a failed try, or “Needs the AI key” without a key), then moves onto the map when placement is available. After 5 seconds the pill counts the seconds since you said it. Hover a point for how long placing took; click or tap a point (or Tab to it and press Enter) to open the words you actually said under it, and again to close them.
- Threads and their branches; the active one is marked; a thread you left mid-sentence says "left off".
- Nothing is cut short: titles, points, the live words (the last two lines, newest at the bottom, like captions), the unfinished card's half-sentence and Palace captions wrap. In a window 1100 px or wider the map shows two columns, threads alternating left and right in the map's order. While you talk, every thread but the one you're in (and any left off) goes quiet in gray; at the pause after your last thought lands, everything reads at full strength again.
- The unfinished card: see [How it works](#how-it-works).
- “While you were away” appears when your own thoughts land while the window is hidden or in the background for at least 30 seconds. It lists only the threads they landed in, newest first, each followed by the AI's new proposals there; threads you didn't talk in, and other people's, stay out, and the card says so. Each row ends in a chevron and takes you to its thread or proposal; it keeps, adds or dismisses nothing.
- ✦ marks what the AI added or proposes: tags (faint until kept), one suggestion per thread, actions with "Add to Reminders" or "Add to Calendar", "Did you mean …?", a "fixed" tag, pictures, app cards, Recap, and notes such as "AI renamed … to …". Point at or tap a ✦ and it says what the AI did and how to undo or answer it (Keep, ×, Add to …, Yes or No), or that there is no undo yet.
- The mic shows its state by shape and color, says it on hover or keyboard focus, and the composer's placeholder says it too: off (a soft disc), starting (a dashed ring), listening (a filled disc whose ring swells with your voice, from each 320 ms loudness reading), hearing you (the ring darkens as words come back), paused by “stop listening” (a pause badge), no AI key or a refused one (an amber mic struck through), and connecting (faded).
- Header: "This session · 12 thoughts · 4 threads", Recap, a ? for keys, spoken commands and Symbols (what each mark, chip, due shade, room color and mic state means), Import chats, and in a room, who has added thoughts.
- Map tools: Map or Palace and search; from the second thread, Focus (it stays pressed while on) and Back to active; `?` lists keyboard and spoken commands.
- Select a few words on the map, then Explain: one plain sentence on what they mean in that thread, using what other threads say about the same name or term. If an answer (or a Recap) misses the point, press “Off?”: the journal keeps every Explain answer (the phrase, its context, the model, how long it took) and these marks, so a change to the prompt can be checked on real answers. Press it again to take the mark back.
- The Apps panel: your apps with on and off switches, and a box to make one.

## How it works

The core (`core/`, Rust with axum and tokio) holds the map in memory, journals every change, calls the models and pushes each change to every open window over a WebSocket. The UI (`ui/`, React, TypeScript, Motion) draws the map and streams the mic as 24 kHz PCM. The API key stays in the core. More detail, with the life of a thought and every model call: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Placing

Each finished speech turn (Voice Transcribe's endpointing) or typed line is checked before the model sees it. Filler such as “um, so” is set aside, as are acknowledgements such as “yeah, okay” unless the last turn was a question. A turn that changes topic is split there; joining words at the cut are left out and the rest is placed next. The model may also set aside short acknowledgements, but turns over 8 words are always placed.

The queue sends one thought at a time with every thread's id, title and last point, plus your active thread and, if you said it in the last 2 minutes, your previous turn word for word with the thread it went to, even with someone else's question in between (so "the cursor thing" right after a word on a subscription isn't read as the on-screen cursor). The selected card is only a hint: the words decide where they land. If the key can't use Contributor mode, placing and Explain use Muse Spark 1.2 until restart. The JSON answer says to continue the active thread, return to an earlier one or start a new one (a branch if it names a parent); it also gives a point of at most 12 words, whether the thought trailed off and any words that look misheard. Only existing thread ids are trusted. Each thought gets three tries; after three failures it returns to the queue in 15 s, then at doubling intervals up to 4 min. Measure placing time with `node scripts/latency.mjs data/journal.jsonl` (median, 90th percentile, slowest). To see where each thought went and why, start the core with `E2A2O_TRACE=1` (it appends every model call and placement to `data/<map>/trace.jsonl`; off by default) and run `node scripts/where.mjs data/<map>`. Routing cases (`scripts/routing-cases.jsonl`) run against the real model with `cd core && cargo test --release -- --ignored routing_cases --nocapture` and `MODEL_API_KEY` set.

### The unfinished-thought card and voice commands

Leave a thread whose last thought trailed off (“I need to pay rent before…”) and it's marked dropped, for you only. After 2.5 s without new words, the card offers the one you dropped last with your last words and Finish it and Later. The first Later hides it until at least 5 minutes have passed and you pause; it then returns once. A second Later hides it until that thread changes. “Where was I?”, “next one” and “last one” work as a whole turn or at its end after a pause; words before the command are placed first, and the command waits for them. “Go back to the drawing board” stays a thought. “Where was I?” or “go back” returns to where your last line trailed off (even on the thread you're on), else your latest dropped thread, else the last other thread you spoke on; with nowhere else to go it shows where you are, or says “Nothing on the map yet: say a thought first”. “Next one” moves to the next thread in creation order, then wraps to the first, and “last one” (or “previous one”, “go back one”) moves the other way. “Where did I talk about …?”, “take me back to …” or “go to the one about …” (Take me there) jumps to the thread and highlights the point; if nothing matches, it says so (“I couldn't find “the lease”. Try a few words you used.”) and files nothing, except the words you said after the question, and a “take me back to …” that may be a saying (“Take me back to Paris”). “Find …”, “take me to …” and “go to …” search only when they point at the map (“find where I said …”, “go to the one about …”); “Find a dentist near the office” is a thought. “New thread” (or “create a new one”, “new topic”) places nothing, and your next thought starts a thread of its own. “Palace”, “map”, “focus” and “show all” (or “go to the palace”, “let's focus”) switch your own window's view, as the buttons do. “What can I say?” (or “help”, “what can you do?”) opens the `?` list of these, on an empty map too; your next turn, Esc or a click outside closes it. “Add milk to the shopping list” (or “put … in …”, “jot down … on …”, “add to the shopping list: …”) files the words at once in the thread whose title has those words, with what to add as the point and the whole turn kept as said; said as a kind of place no thread has yet (“the packing list”, “the Japan thread”) it starts that thread, and anything less sure (“Put the kids in the car”) is a thought the placer reads. “New thread about the garden shed” (or “New thread. …”, “Different topic, …”) starts a thread at once with every word after it, titled from them (“Garden shed”) until the AI finds a better title. “What was I thinking?” or “let me finish my thought” is “where was I?”; “Finish it” and “Later” are the unfinished card's buttons while you have one, and “forget it” (or “never mind”) sets it aside as a second Later does, keeping its words on the map; each acts on the card you see. “Expand the garden” (or “show me everything under …”, “expand all the sub cards inside …”) opens a thread and every branch under it until you fold it, “collapse this” folds yours, and “expand everything” or “collapse everything” does all of them; Option-click on Show or Hide does the same for one thread. “Add it to Reminders” adds the proposed action, as its button does, and “keep it” or “discard it” answers an app that's waiting. “Stop listening” (or “pause listening”, “mic off”) closes the mic: nothing after it is heard, sent or kept, and the header says Paused until you tap the mic. All of these are recognized by rule, without a model call, and only the whole command counts: “go to the last one of the meetings”, “let's go to the palace of Versailles”, “create a new one for the kitchen”, “put this in perspective”, “I bought a boat. What was I thinking?” and “stop listening to him” are thoughts. Every request takes the same words before it (“Okay,” “Well,” “Hey,” “Please,” “Can you …”), so “Can you recap?” and “Hey, where was I?” act; asked of someone partway through a turn (“I loved Japan. Would you go back?”), it stays a thought.

### Did you mean, and confident auto-fix

With each placement the model names words that look misheard, its guess, and whether the context leaves no doubt (say, the right name is already on the map). If it's sure, and those words are really in what was said, the core swaps them and marks the point "✦ fixed": hover shows what was heard, and one click puts it back. Anything less is asked: "Did you mean "Muse Spark"? Yes / No".

### The refiner

At a pause (4 s quiet) after two new thoughts or a new thread, or when you come back to the window, with at least 10 s between passes (longer after failed ones), Muse Spark 1.3 reads the map: quiet threads as one line, recent ones with their last 8 thoughts, and each thread's tags. It renames threads and merges duplicates (the app says so), adds at most one suggestion per thread, proposes actions (a reminder, or an event when a date is stated) and suggests up to three tags per thread. If you start talking while it works, it drops the pass and redoes it at the next pause. Approving an action runs AppleScript on the host laptop: reminders go to their own "E2A2O" list, dated events become all-day events in their own "E2A2O" calendar, and the app shows how long Apple took.

### Pictures and the Palace

During pauses, once a thread has settled for 12 s, Muse Image draws one picture for it (up to three at a time): the one object you'd name for the topic (a key for rent, a cake for a birthday), different from the map's other topics, in clay of its room's color, with image search, web search and shell off. Up to three tries per thread. Each room has one color (green, pink, teal, red and lime in turn), shared by its pictures, the rail that holds its branches and its Palace heading; none is near the blue, amber or purple that mean where you are, what needs you and what the AI added. The core keeps the full WebP and serves a 128 px copy for the map and a 512 px copy for the Palace, both keeping Muse Image's note that AI made it. Until a thread's picture comes, its first letter holds the place on the map and in the Palace, so the picture fades in without moving anything. The picture shows only once it has decoded; one that fails to load keeps the letter (never a broken-image glyph) and is fetched again a few times and when the core comes back, which never asks Muse Image for a new drawing. The Palace shows threads as picture tiles grouped into rooms (a thread and its branches), then the threads on their own under one heading; each tile shows the thread's last thought under its title. Rooms sit side by side when they fit, each as wide as its pictures, so a session's rooms fit one screen (7 threads in 2 rooms and 3 on their own, at 1440×900). Left and right arrows go in reading order, up and down to the nearest picture; Enter opens the thread on the map.
The sample pictures and thread pictures were generated by Muse Image 1.0; each carries an XMP metadata note that AI made it.

### The composer and its apps

An app is a watcher (a new thought, a phrase, a topic, loud voices for some seconds, a time), an optional single model prompt, and one to three publishers (a card on the map, a short tune, a proposed reminder). Say “make an app that…” (or “build an app that…”, “make a new app that…”) or “Can you make me an app to …”, or use the Apps panel. The composer first looks for an app that already does it; otherwise Muse Spark 1.3 picks blocks under a JSON schema, and the core rejects unknown blocks or fields and out-of-range values. A draft that fails validation is retried once with the error explained; a valid draft can then be kept or discarded. When the blocks can't do the main thing asked (book a flight, send an email, search the web), or the request has no likely reading ("hi"), the composer says why in one sentence and offers the closest app it can make, one click away, instead of building a look-alike. Phrases and topics match whole words (a plural counts), so "AI" doesn't fire on "said". A volume app hears one reading every 320 ms, the RMS of that stretch of mic audio after the browser's processing, and fires once readings stay at its level for its seconds, riding out one low reading (a breath between sentences). The composer is given what normal speech, a raised voice and a shout read, so “when we get loud” lands between normal speech and a raised voice, held at least 3 seconds, since normal speech's louder words can clear that level for a second or two (the core holds it there if the composer picks less). The Volume watcher uses the same level and hold; one seeded by an earlier build moves to them on start, still on or off and playing what it did. Add `?level` to the address to see each reading as the core receives it, with the typical reading of each stretch of talk; a stretch ends where readings fall to half the voice or back to the room, for a second. Apps can't run code, open URLs or act on their own; a proposed reminder waits for your approval. Three seed apps, on by default only in demo mode: Argument resolver (gently names a repeated point or a common fallacy), Volume watcher (plays a short, silly tune and suggests a pause when voices stay loud; its row can switch to the card alone), Search-first (offers an existing app before making another). To check the composer against 36 sample requests: `node scripts/composer-check.mjs --runs 2` with a core running (real model calls; it discards every draft).

### Recap

Say "recap" (or "let's recap", "what did I decide?"), "what did I decide today?" or "recap this session", or press Recap. Today runs from local midnight; a session, from the last 30-minute gap. Only that period's thoughts go to the model, in the speakers' own words, capped at 24 threads, 16 thoughts each and 64 actions. It returns a summary that names your threads, what you worked on, plans (intentions such as "I want to…"), decisions (explicit choices only) and open questions; the core adds the unfinished threads and their actions, drops any thread the model invents, and if none are named, links the three threads with the most points. Each line links to its thread. The sheet opens on decisions ("None yet" when there are none), plans and open questions, then what you worked on. Saying "map" or "palace", a search that jumps, "where was I?", "next one" or "last one" closes it, so the result shows; a thought said while it's open lands behind it. The recap is saved in the journal; asking again with nothing new makes no call.

### Importing your chats

Choose Import chats (top right), then a ChatGPT or Claude `conversations.json` export, or Try with a sample of five made-up chats. Before sending, the app previews what it found, which models will receive it, and a rough cost. The core also reads a JSON or JSON Lines list of messages with a role and content, up to 100 MB. Only your own messages are read: the latest ones, up to 300,000 characters, each cut at 2,000, with the first 240 characters of the AI's reply as context; messages an earlier import already read are skipped, so importing the same file twice adds nothing. Muse Spark 1.2 reads them in parts, six at a time, and pulls out each idea as a short point with your own words and its date. Muse Spark 1.3 then sees only those ideas, never your messages, and groups them into threads (one level of branches, or onto threads already on the map), at most one open question per thread, and dated tasks. Threads land one at a time, each point keeping the time you first wrote it; if grouping fails, each topic becomes its own thread. Neither step uses Contributor mode unless you set it. In a room, only the host can import. The file isn't kept.

### Rooms

`./run.sh room` sets a fresh 8-character code and puts the core on the local network; without a room it answers only this laptop. A laptop without the code gets only the page, to type the code in, not the map or the pictures. Every window streams its mic through the host's core, one Voice Transcribe session per window, under that person's name. Only the host's own window can approve actions, since they land in the host's apps.

### The journal

Every change is appended as one JSON line to `data/<map>/journal.jsonl`, then sent to every window; on start the core replays it, so the map opens where you left it. `./run.sh NAME` uses `data/NAME`; plain `./run.sh` uses `data/`.

## Models and endpoints

| Model | Feature and when it runs | Reasoning effort | Measured number in the README or repo |
|---|---|---|---|
| Muse Voice Transcribe 1.0 | Live speech to text while the mic is on; one session per window | — | — |
| Muse Spark 1.2 Contributor (`PLACER_MODEL`) | Place each finished thought; Did you mean and auto-fix use its placement result. Explain runs when you select words and press Explain. Falls back to Muse Spark 1.2 if the key cannot use Contributor mode. | minimal | About 3 s from speech to map (README; includes transcription and placement) |
| Muse Spark 1.3 (`REFINER_MODEL`, default) | Refiner at a pause or when you return; composer when you ask to make an app; Search-first when enabled; app prompts when a watcher fires. | low | — |
| Muse Spark 1.3 (`REFINER_MODEL`) | Take me there, with minimal effort, only when local word search finds no match | minimal | 62 paraphrases that share no word with their target: median 1.1 s, p90 1.7 s, slowest 2.8 s; 51 found it (2026-11-01, core/src/find.rs `PATIENCE`) |
| Muse Spark 1.3 (`RECAP_MODEL`, else `REFINER_MODEL`, else default) | When you ask for Recap or press Recap | low | — |
| Muse Spark 1.2 (`IMPORT_EXTRACT_MODEL`, default) | Chat import: extracts ideas from message parts | minimal | — |
| Muse Spark 1.3 (`IMPORT_MERGE_MODEL`, default) | Chat import: groups the extracted ideas into threads | low | — |
| Muse Image 1.0 | Draws a thread picture after it has settled | — | — |

Chat models use `https://api.meta.ai/v1/chat/completions`; speech uses `wss://api.meta.ai/v1/asr/realtime`; pictures use `https://api.meta.ai/v1/images/generations`. Settings go in `.env`; see `.env.example`.

Every model request has a time limit: 20 s for placing (more for a turn over 1,000 characters) and Explain, 8 s for Take me there's model check (about twice the slowest answer measured; “Looking through your threads…” stays up until then), and 30 s to 4 minutes for the rest; the speech stream has no read timeout yet.

## Privacy and data

- The core runs on your laptop. The browser talks only to it and loads nothing from elsewhere; the key never reaches the browser.
- Model inputs go to `api.meta.ai`:
  - **Speech:** while the mic is on, raw 24 kHz audio and setup data (session id, model, audio format, endpointing mode, English bias and keywords). The client sends no transcript as input.
  - **Placing:** the full new thought; every thread's id, title, status and last point; the active thread id; and up to 30 names found in placed thoughts. If the most recent thought by anyone ended in `?` and this thought has at most 8 words, it also sends that previous thought's full text. It also sends your own previous thought's full text and its thread id, if you said it in the last 2 minutes and it isn't that question.
  - **Refiner:** today's date; each thread's id, title, parent, tags and last point; the latest 8 full thoughts from recently active threads; the latest 30 suggestions and actions. In a room with multiple speakers, each recent thought includes its speaker name.
  - **Take me there:** only if local word search finds no thread containing every query word, the query (up to 400 characters) and up to 48 thread titles (100 characters each) with their latest 3 points (320 characters each).
  - **Explain:** the selected phrase (up to 160 characters), up to 600 characters around it, up to 12 points from its thread, its parent's title, up to 40 other thread titles, and up to 8 thoughts from other threads that name the selected words.
  - **Recap:** up to 24 threads, with up to 16 thoughts per thread (each includes the speaker and up to 700 characters of text), plus up to 64 actions.
  - **Pictures:** the thread's title, its first point, and up to 18 other thread titles (so two threads don't get the same object); nothing with `PICTURES=off` in `.env`.
  - **App creation:** the request, local time and app catalog. If the Search-first app is enabled, it may first receive the request and catalog to look for an existing app.
  - **When an app runs:** its prompt, newest thought, up to 8 earlier points, topic and time. In a room with multiple speakers, those thoughts include speaker names.
  - **Chat import:** each selected message (up to 2,000 characters) with its date and conversation title, plus up to 240 characters of the next AI reply. A separate grouping call receives today's date, up to 80 existing thread ids and titles, topic counts and date ranges, up to 4 latest ideas per topic, and up to 150 dated open questions and 150 dated tasks. It does not receive the original messages.
- Placing and Explain default to `muse-spark-1.2-contributor`, the cheaper Spark. Meta may keep Contributor data to improve its products. This can include imported words after they become thoughts on the map. For private talk, set `PLACER_MODEL=muse-spark-1.2`. If your key can't use Contributor mode, the core switches to `muse-spark-1.2` until a restart and says so; a `PLACER_MODEL` you set is never switched.
- On disk: `data/<map>/journal.jsonl` (each thought's full text and speaker, and every change since) and `data/<map>/images/`; with `E2A2O_TRACE=1`, also `data/<map>/trace.jsonl` (every model request and answer, never the key). `data/` and `.env` are git-ignored. Delete a map's folder to forget it.
- In a room, everyone with the code sees the whole map, and the other laptops' audio goes through the host's core and key.
- No accounts, analytics or telemetry.

## Security

- Alone, the core listens on 127.0.0.1 only. A gate checks every request: the Host must name this machine (stops DNS rebinding), and an Origin, when sent, must be the app's own page, so another site open in your browser can't use the WebSocket (browsers always send Origin on one). Responses carry `Cross-Origin-Resource-Policy: same-origin`.
- In a room, the Host must be this laptop's own address, and the map and pictures need the code (a query on the WebSocket, a `SameSite=Strict` cookie for pictures), compared in constant time. `./run.sh room` makes 8 characters from 31 letters and digits; a shorter `ROOM_CODE` starts with a warning. Approving actions and importing work only from the host's own window.
- Model output is data: the placer trusts only existing thread ids; app specs must match a closed set of blocks (`deny_unknown_fields`, range and template checks); app prompts are told the conversation is data and that they can't act. The UI renders text only, never raw HTML.
- `scripts/precheck.sh` runs before anything goes public, and on every merge (below). It fails on: `.env` or data files in git, key-like strings, home-directory paths, paths from the author's other projects, a core not limited to 127.0.0.1 when alone, a missing Origin and Host gate or room test, a model client without a timeout, `dangerouslySetInnerHTML`, a non-Meta model SDK, endpoint or model name in the app's code (the hackathon requires every model called at runtime to be Meta's) or any outside host but `api.meta.ai` in the core or UI, a model call that bypasses the hourly cap, or a failing `cargo test`. `scripts/model-guards.py` holds the last three, with a self-test that plants each kind of breach. With the app running, it also probes it: another site's WebSocket and a rebinding Host must get 403, and so must the map without the code in a room. It warns about open decisions: the Contributor default, `run.sh`'s Keychain lookup, the speech stream's missing read timeout, and numbers in the code marked `stand-in:` until a measurement replaces them.

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
- Set up for English: Voice Transcribe is biased to English. It can spell names and uncommon words differently; “Did you mean” catches some misheard words.
- From speech to the map is about 3 seconds, measured with `scripts/voice.mjs`.
- Placing is a model's judgment, and there are no manual edits: you can't move a thought or rename, merge or split threads yourself, or undo the refiner's renames and merges.
- A Voice Transcribe session can end after 60 minutes. When the speech service stops, the app says “The mic stopped. Tap it to keep talking.” A stream that stalls without closing may still look on.
- Placing is one model call at a time, in the order things were said, so each sees the map the one before left. A long turn that moves across several topics is placed one part after another, so in a burst the last part can land 20 to 30 seconds after you stop (three speakers at once in a room, measured with `scripts/voice.mjs`); talking alone at a normal pace keeps up (about 3 s). A failed or stalled try (12 s for the first) sends the thought back in line, so the rest keep landing; after three failures the app says so, and it retries after 15 seconds, then less often, up to every 4 minutes.
- Only one app can be built at a time. A new request while a build is waiting or running is refused; keep or discard the current app first.
- Pictures come only during pauses, so a busy session gets them late.
- The loudness scale for volume apps comes from synthesized speech played through Chrome's processing, not yet from a real microphone. There, the browser's automatic gain lifted normal speech and left a raised voice only about 1.3 times as loud, so a raised voice can take a few seconds to set off a volume app.
- Rooms work on one local network only. The room code is the only check: anyone on the network who has it can join.
- In a room, a name belongs to one laptop at a time, ignoring case; the host keeps theirs until the core stops.
- If both room microphones pick up both people, the same speech can be transcribed twice.
- One map per data folder, shared by every window on it; no accounts. The journal only grows (no compaction), and there's no export beyond it.
- The sample maps were written by hand, timings included, and are dated the week of Nov 3, 2026. They include a real “Did you mean” suggestion; Recap needs a key; with one, "recap" opens the sample's last session once Nov 3, 2026 has passed (before then the sample is dated ahead and Recap finds nothing).
