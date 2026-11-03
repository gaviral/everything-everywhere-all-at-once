# E2A2O

<!-- pitch: draft, owner to approve -->
**Think out loud. Keep your place.** You start a sentence, a better thought cuts in, and the first is gone. E2A2O files each thought you say on its thread of a live map, about 3 to 4 seconds after you stop. Jump to something new mid-sentence, and at the next pause it quotes your half-sentence back. Say “where was I?” and you're there.

## Try it

<!-- hosted: draft, confirm a real sign-in and the mic on the site before this ships -->
- **In a browser, nothing to install:** https://e2a2o.aviralgarg.com → Create an account (any email) → Try a sample map, or talk.
- **Run it yourself:** `./run.sh sample` (no key or mic; [setup](#run-it), source build ≈ 4 min).

![19 seconds of one recorded take, at normal speed. A synthesized voice says “Mom's birthday is Saturday…”, which becomes a new thread, Mom's Birthday Saturday. “Okay, decided: if it's under eighty dollars, I'm booking it tonight” lands on that thread marked ✓ Decided. “My stats midterm is Thursday” starts a thread of its own, and “Decided: I'll study with Priya on Wednesday night” lands on it, marked ✓ Decided. Dark labels name the model at each step: Muse Voice Transcribe 1.0 hears you, Muse Spark 1.2 placed it in 2.5 to 3.3 s.](docs/screens/hero.gif)

*One take at normal speed, default models; zoom, labels and captions added in editing; synthesized voice.*

## Meta models it runs on

Built during the Meta Global AI Developer Hackathon with Cerebral Valley (Oct 26 to Nov 4, 2026).

| When you… | Meta model | Does | Measured | Proof: [a real run's trace](docs/trace.md) |
|---|---|---|---|---|
| talk | Muse Voice Transcribe 1.0 | hears you, live | 0.4 s after you stop | [heard](docs/trace.md#heard) |
| finish a thought | Muse Spark 1.3 + 1.2 | places it (both race); notices it trailed off | 2.8 s after the words | [placer](docs/trace.md#placer) |
| pause | Muse Spark 1.3 | tidies; proposes reminders | 10.5 s, in pauses | [refiner](docs/trace.md#refiner) |
| say “make an app that…” | Muse Spark 1.3 | builds it from blocks | 5.6 s after you stop | [composer](docs/trace.md#composer) |
| ask “what did I decide?” | Muse Spark 1.3 | writes the Recap | 0.4 s after you ask | [recap](docs/trace.md#recap) |
| let a thread settle | Muse Image 1.0 | draws its picture | 17.4 s each | [pictures](docs/trace.md#pictures) |
| say “where was I?”, get loud | no model | rules: the jump back, the tune | 0.4 s after you stop | [rules](docs/trace.md#rules) |

Sample counts and dates are in [Measured](#measured).

<!-- end of the first screen -->

## The problem

You think out loud: on a walk, at the stove, between classes. It comes out in the wrong order. Rent, then the midterm, then Mom's birthday, then back to what you were saying before rent, except now it's gone.

Stopping to write it down breaks the thought. A recording keeps every word in the order you said it, which is the tangle you wanted out of. And there's a second stream now: ideas spread across your chats with AI.

## The idea

Never make anyone stop to file. File each thought the moment it's said, onto a map of threads, and remember where each one was left, so getting back takes one sentence.

That is two kinds of work, kept apart on purpose:

- **Judgment goes to Meta's models.** Which thread is this? A tangent? Did the sentence trail off? Is a word misheard? Muse Spark answers in a JSON schema, against the map as it stands, for every finished thought.
- **Anything that must be instant and the same every time is a rule.** “Where was I?”, “palace”, “recap”, “stop listening”, “scratch that”, filler like “um, so”, and a decision said in so many words (“decided: …”). A rule acts about half a second after you stop and never guesses.

The AI shows its work: everything it adds is marked ✦ and says what it did and, where it can, how to undo or answer it; a point can say why it landed where it did; and nothing reaches your Reminders or Calendar until you approve it.

## One minute of talk

The story the video tells, line by line. Play it yourself with [scripts/story-talk.jsonl](scripts/story-talk.jsonl) ([Run it](#run-it)); titles and a placement or two may differ in your run.

| You say | What happens |
|---|---|
| “My biggest problem is that I never finish my” | A new thread. Muse Spark (1.3 or 1.2, whichever answers first) notes the thought trailed off. |
| “Oh, and rent is due Friday and I still haven't sent it.” | A new thread, *Rent Due Friday*. The thread you left is marked **left off**, and 2.5 s into the next pause a card quotes your half-sentence. |
| “Wait, where was I?” | Back on the thread you left, by rule, with no model call. |
| “Sentences. I never finish my sentences.” | Joined to the half-sentence as one point, marked ✦ joined; a tap keeps them apart. |
| “Mom's birthday is Saturday. She keeps talking about that pottery class on Main Street.” | A new thread. |
| “Okay, decided: if it's under eighty dollars, I'm booking it tonight.” | Lands on Mom's thread marked **✓ Decided**. A rule reads “decided”: your word, not a guess. |
| “My stats midterm is Thursday, chapters four to six.” Then “Decided: I'll study with Priya on Wednesday night.” | A thread, and a decision on it. |
| *(a pause)* | Muse Spark 1.3 tidies titles and proposes reminders and dated events (in one take: “Pay rent · Fri, Nov 6”). Nothing is added until you press **Add to Reminders** or **Add to Calendar**, or say “add it to Reminders”. |
| “Make an app that plays a silly tune if we get loud.” | Muse Spark 1.3 builds it from checked blocks: a volume watcher and a tune. Keep it, and once voices stay loud for 3 s the tune plays: the watcher decides, no model call. |
| “And Mom is going to love that pottery class, I'm so excited!” (loudly) | The thought lands on Mom's thread, and the tune plays. |
| “What did I decide today?” | The Recap opens at once, decisions first, each linked to its thread: its draft was kept current as you talked. |
| “Palace.” | One picture per thread, drawn by Muse Image 1.0 during the pauses. |

![The map mid-talk: seven threads, two with a branch; “Not Finishing Things” marked “left off”; at the bottom, a card “You didn't finish Not Finishing Things” quoting “My biggest problem is that I never finish my”, with Finish it and Later](docs/screens/left-off.webp)

*A real frame from an earlier run, only cropped: a sentence trailed off, the talk moved on, and the card offers to go back.*

## How it works

```
browser, one page per window               the core: one Rust process on your laptop
mic: 24 kHz audio, 80 ms frames ──/ws──▶   Muse Voice Transcribe 1.0: live words, end of each turn
                                           rules: filler, commands, "decided:"        (no model)
                                           Muse Spark 1.3 + 1.2: which thread? (JSON)  one thought at a time
the map, live ◀── every change ─────────   journal: one JSON line per change, replayed on start
                                           at pauses: Muse Spark 1.3 (tidy, Recap, apps)
                                                      Muse Image 1.0 (a picture per thread)
```

1. **Hear.** The page streams the mic to the core over a WebSocket. The core opens one Muse Voice Transcribe session per window and relays the audio; your words show live, and the service ends a turn when you pause. The key stays in the core.
2. **Rules first.** Before a model sees a turn, the core sets aside filler and acts on spoken commands; a command at the end of a turn (“…the flight. Where was I?”) waits for the words before it to land. A decision said in so many words (“decided:”, “let's go with …”) is marked ✓ Decided by rule, never guessed.
3. **Place.** Muse Spark 1.3 and Muse Spark 1.2, at minimal reasoning, reads each thread's title and latest points, the thread you're on and what you said just before, and answers in a JSON schema: continue, go back to an earlier thread, start a new one, or branch a tangent off one; a point of 12 words or fewer saying what was meant; whether you trailed off; any word that looks misheard. A thread takes a thought only when its title already covers the thought's main subject, so thinking out loud across several ideas for one project gets a thread per idea, not one thread that takes them all; words that announce a move (“another idea”, “anyway”) usually start a topic or cut the turn there. Only thread ids that exist are trusted. A turn that changes topic is cut where the answer says and placed in two parts. Thoughts go one at a time, in the order said, so each sees the map the one before left. Two calls race, one to each model, and the first good answer wins: how long a model reasons varies from call to call, and a slow spell mostly hits one model at a time. The window names the model that won (`PLACER_RACE=1` sends one call).
4. **Show.** Every change is appended to `data/<map>/journal.jsonl` and sent to every open window. While the placing calls run, the threads the prompt singles out light up, each with why (“said just before”, “left unfinished”); then the thought lands. Beside the mic, a line names the model at work and then how long it took (“answered · 2.6 s”), or says “by rule, no model”.
5. **While you pause.** Muse Spark 1.3 tidies: titles, one next step per thread, reminders and dated events from what you said, tags. A rename made of your own words lands with Undo; every other rename, and every merge, waits for your click. Muse Image 1.0 draws one picture per thread that has settled, for the Palace. A Recap draft stays current while the hour has model calls to spare, so asking shows it at once.
6. **Apps from blocks.** “Make an app that …” asks Muse Spark 1.3 to choose from a closed set of blocks: a watcher (a new thought, a phrase, a topic, loud voices, a time), an optional prompt, and a card, a short tune or a proposed reminder. The core rejects any block, field or value outside the schema; apps can't run code, open links or act on their own. Of the three seed apps, the two that fire on their own start off until you switch them on in Apps: Argument resolver, which names a repeated point or a common fallacy, and Volume watcher, which plays a silly tune when voices stay loud. The third, Search-first, only looks for an app you already have while a new one is being built.

### What needs a model, and what doesn't

- **Meta models, all through `api.meta.ai`:** hearing (Voice Transcribe 1.0); placing, Did you mean and Why here (Spark 1.3 and 1.2 race, the first good answer wins); Explain and reading a correction no rule reads (Spark 1.2); tidying, Recap, apps and search by meaning (Spark 1.3); importing past chats (Spark 1.2 pulls out the ideas, Spark 1.3 groups them); pictures (Image 1.0).
- **Rules in the core, no model:** spoken commands, filler, ✓ Decided, the jump back, search by words, the hourly call cap, the journal, and an app's watcher deciding when it fires.
- **The browser:** the mic (`getUserMedia` and an AudioWorklet that sends 24 kHz audio), the app's tune (Web Audio), Export to Markdown, and the calendar file (`.ics`) where Calendar can't be reached.
- **macOS:** Reminders and Calendar, through AppleScript, only when you approve an item. Messages only in the Full preset, after a countdown you can stop, and as a dry run unless you turn sending on ([details](docs/FEATURES.md#presets-and-messages)).
- **Nothing else at runtime.** `scripts/precheck.sh` fails on any non-Meta model SDK, endpoint or model name in the app's code. A friend's trial link (`scripts/trial.sh`) goes through a Cloudflare quick tunnel, which does no AI work.

Every call, its setting, reasoning effort and time limit: [docs/FEATURES.md](docs/FEATURES.md#every-model-call-with-its-setting).

## Run it

**Hosted sample:** follow the browser path above, sign in, and choose **Try a sample map**. After the sample loads, edit the map's URL to open the demonstrated shell: replace any existing `shell` parameter with `shell=2`; otherwise, append `?shell=2` (or `&shell=2` if there are already query parameters). Keep the other parameters and press Enter. Set this after sign-in and sample loading; do not rely on sign-in preserving query parameters. A fresh hosted sign-in and microphone check remain unverified.

Tested on macOS. Every local start needs Node.js 22.12 or newer and npm: `run.sh` installs missing UI dependencies and builds the UI, including when using a bundled core. For the mic, use Chrome or Safari.

If you supply an executable regular file named exactly `e2a2o-core-PLATFORM-ARCH` beside `run.sh`, it uses that core without Rust or native build tools. Replace `PLATFORM` and `ARCH` with Node's `process.platform` and `process.arch` (see `node -p 'process.platform + "-" + process.arch'`); for example, `e2a2o-core-darwin-arm64` on an Apple-silicon Mac. These instructions do not promise a published binary release. Node and the UI build are still required.

Without a matching executable, it builds from source. Needs Rust 1.89 or newer ([rustup.rs](https://rustup.rs)); on a Mac with no developer tools, run `xcode-select --install` first.

**Linux:** the source build also needs a C compiler, pkg-config and OpenSSL's headers; `run.sh` checks them and prints the command for whatever is missing. Not tested on Linux.

**Windows:** use the hosted version above; otherwise WSL2 (Ubuntu): clone inside WSL, follow the Linux line, and open the printed link in Chrome on Windows. Not tested on Windows.

```sh
git clone https://github.com/gaviral/e2a2o-app.git && cd e2a2o-app
./run.sh sample
```

The first source build takes about 4 minutes with nothing cached (10-core Apple-silicon Mac, measured 2026-11-01); later runs start in seconds. When the terminal says `E2A2O core on`, open the URL on that line. Without a key it also logs `MODEL_API_KEY is not set`; the sample doesn't need one. If port 4321 is busy, `run.sh` says so before building: `PORT=4400 ./run.sh sample`.

**No key: a sample map.** A student's week: 8 threads, 30 thoughts, a picture for every thread (drawn once by the app's own picture pipeline and saved in `samples/images/`), two proposed reminders, and one thread left off. Try its left-off card, `j`/`k` and Enter, `/` to search, the Palace, and the “Did you mean BC Hydro?” question, which is written into the sample. Without a key the header says “No AI key”. `./run.sh sample founder` opens a founder's day.

After the local sample loads, edit its URL for the demonstrated shell: replace any existing `shell` parameter with `shell=2`; otherwise, append `?shell=2` (or `&shell=2` if there are already query parameters). Keep the other parameters and press Enter; the flag takes effect when the page loads. The usual URL is `http://localhost:4321/?shell=2`.

**With a key: watch the story build itself.**

```sh
cp .env.example .env                                # paste your Meta Model API key after MODEL_API_KEY=
./run.sh demo                                       # its own map, in data/demo
node scripts/demo.mjs scripts/story-talk.jsonl      # in a second terminal: the minute above, typed at real speed
```

- Open the URL as soon as it says `E2A2O core on`, then start the talk. Every placement, tidy-up, picture and app is a live model call; allow 3 to 4 s a line.
- A wrong or expired key is refused on the first call: the header says “AI key refused”, the app stops calling, and new thoughts wait, saved, until you fix `MODEL_API_KEY` and restart.
- Speak it instead of typing it: `node scripts/voice.mjs scripts/story-talk.jsonl` says each line in a synthesized voice through the real speech path (macOS). The tune needs a loud voice, so say that line yourself.

**Your own voice.** `./run.sh` (your map lives in `data/`), open http://localhost:4321, press the mic and talk, or type and press Enter. Say “what can I say?” for every command; [docs/COMMANDS.md](docs/COMMANDS.md) has them all.

**See every model call.** Start the core with `E2A2O_TRACE=1` and it writes each model request and answer, never the key, to `data/<map>/trace.jsonl`. `node scripts/trace-summary.mjs data/demo/trace.jsonl` counts them by feature and model, and `node scripts/where.mjs data/demo` shows where each thought went and why. [One run's trace](docs/trace.md).

**More ways in:** two laptops on one map (`./run.sh room`), a friend anywhere on a link (`sh scripts/trial.sh NAME`), or a start from your past ChatGPT or Claude chats (Import chats). Each is in [docs/FEATURES.md](docs/FEATURES.md#try-it).

## Measured

<!-- numbers: draft, retake on the freeze tag and replace the take rows with that take set -->
Every voice below was synthesized, not a person's, and spoke through the real speech path into Chrome. “One take” is the take the GIF comes from: 2026-11-01, the default (private) models.

| What | Result | n, date and source |
|---|---|---|
| End of a spoken line to its final words (Voice Transcribe 1.0) | median 0.4 s, slowest 0.6 s | 13 lines, one take, 2026-11-01; 0.4 to 0.5 s in 5 more takes (40 lines) |
| Words to their place on the map (two Spark 1.2 calls racing) | median 2.9 s, slowest 3.6 s | 9 thoughts, one take, 2026-11-01 |
| End of speech to the map | median 3.3 s, slowest 4.0 s | the same 9 thoughts |
| Words to their place on the map (Spark 1.3 and 1.2 racing) | median 2.8 s, slowest 3.4 s | 8 thoughts, [the traced take](docs/trace.md), 2026-11-02 |
| A placing round, Spark 1.3 + 1.2 against two Spark 1.2 calls | median 3.4 s vs 3.6 s; 90% within 4.6 s vs 5.6 s; 5 s or more in 3 vs 7 rounds; both placed 69 of 69 routing and chunk cases | 38 rounds, one a minute for 37 minutes, on the app's own placer requests, 2026-11-02 |
| The same, 5 earlier takes, before two placing calls raced | median 3.15 s (words to map), slowest 6.1 s; 4 of 40 took 5 s or more | 40 thoughts, 2026-11-01 |
| One placing call (Spark 1.2, without Contributor mode) | median 2.8 s, 90% within 4.2 s | 77 calls, 2026-11-02 |
| “Where was I?”, “recap”, “palace”, an app request | acted a median 0.4 s after you stop, no model call | 4 requests, one take, 2026-11-01 |
| An app built from a request (Spark 1.3) | ready 5.6 s after the request ended; 58 of 60 requests did what was asked | 1 in the take; 30 requests, 2 runs each, 2026-11-01 ([CHANGELOG](CHANGELOG.md)) |
| Recap when asked (Spark 1.3) | shown 0.4 s after you stop; from a kept draft in 5 to 11 ms | 1 in the take; 3 timed, 2026-11-01 |
| Refiner pass (Spark 1.3) | median 10.5 s, slowest 11.9 s, while you're quiet | 3 in [one traced run](docs/trace.md#every-call-in-the-run), 2026-11-02 |
| A picture (Image 1.0) | median 17.4 s, slowest 19.9 s | 4 in the same traced run |
| Finding a thread by meaning, no shared words (Spark 1.3) | median 1.1 s; 51 of 62 found | 62 paraphrases, 2026-11-01 ([find.rs](core/src/find.rs), `PATIENCE`) |
| Two parts of one thought across a pause (Spark 1.2) | 12 of 12 joined; 15 of 15 standalone sentences left apart | 3 runs each, 2026-11-01 ([CHANGELOG](CHANGELOG.md)) |
| The tune after a loud line | played 3.3 s after the line began | 1, one take, 2026-11-01 |

Measure your own: `node scripts/voice.mjs scripts/story-talk.jsonl` prints each line's transcript and placing time, and `node scripts/latency.mjs data/demo/journal.jsonl` prints placing times from any map.

## Who it's for

People who think by talking: a student with a midterm, rent and a birthday in one week; a founder between meetings; anyone whose best idea shows up in the middle of another one. The sample maps are a student's week and a founder's day, and an empty map also offers three short ones: a team meeting, a bug left for a call, a walk through a house.

<!-- trials: draft, add the Nov 2 friend trials here as "N friends, unscripted": n, one result, one limit -->

**Isn't it a notes app?** It's closer to a map that draws itself while you talk: you never stop to file, a turn that changes topic is split, and the map brings you back to the sentence you dropped.

## Accessibility

- The first Tab stop is “Skip to Type a thought”; `?` lists every key and spoken command; a focused point opens its words with Enter or Space.
- The mic shows its state by shape as well as color; Reduce Motion is respected; at 200% zoom and up the header scrolls away and only the composer stays pinned.

## Privacy

- The core runs on your laptop. The browser talks only to it and loads nothing from elsewhere; the key never reaches the browser. The app has no accounts, analytics or telemetry; the hosted site adds a sign-in and runs one core per person on its server.
- In the Demo preset, only model calls leave the core, to `api.meta.ai`. While the mic is on, that's the audio, after a 0.5 s synthetic “ah” the core sends so a session's first line comes back fast. Each finished thought goes with every thread's title and last point (the last 3 points on the 20 threads touched last), as two calls at once, one to Spark 1.3 and one to Spark 1.2 (`PLACER_RACE=1` sends one). Every call and exactly what it sends: [docs/FEATURES.md](docs/FEATURES.md#privacy-and-data).
- Placing races `muse-spark-1.3` and `muse-spark-1.2` (`PLACER_MODELS`); Explain uses `muse-spark-1.2`. `PLACER_MODEL=muse-spark-1.2-contributor` turns on Contributor mode, for Explain and every placing call: a little faster, but Meta may keep what it reads to improve its products. A `PLACER_MODEL` you set is used as is, with no fallback: if the key can't use it (401 or 403), every model feature stops until a restart. A listed model the key can't use leaves the race until a restart, and the others place.
- On disk: `data/<map>/journal.jsonl` and `data/<map>/images/`. `data/` and `.env` are git-ignored. Delete a map's folder to forget it.

## Security and checks

- Alone, the core listens on 127.0.0.1 only, and a gate checks every request's Host and Origin, so another site in your browser can't reach it. In a room, the map needs the room code.
- Model output is data: only existing thread ids are trusted, app specs must match a closed set of blocks, and the UI renders text, never raw HTML.
- `sh scripts/test.sh` runs every test that needs no key: the core's Rust tests, the UI build and the offline UI checks. `scripts/precheck.sh` runs before every merge to main and before anything goes public; what it checks is in [docs/FEATURES.md](docs/FEATURES.md#security).

## Built during the event

- Before the event: the idea and design notes. No code.
- Written during the event (Oct 26 to Nov 4, 2026): everything in this repository; the first commit is from Oct 31.
- Built by one person working with AI coding agents; a branch merged only when `cargo test`, the UI build and `scripts/precheck.sh` passed.
- The sample pictures and thread pictures were generated by Muse Image 1.0; each carries an XMP metadata note that AI made it.

## Known limits

- Every model feature needs `api.meta.ai` and a key; there's no offline model.
- Set up for English; Voice Transcribe can spell names and rare words differently, and Did you mean catches some of them.
- Every number above comes from synthesized voices in a quiet setup; a real voice in a noisy room will do worse. No one outside the project has been measured using it yet.
- Placing is a model's judgment. You can move or delete a thought and rename a thread, by voice or click, with Undo; you can't merge or split threads yourself, except by accepting the refiner's proposals.
- One placement at a time, in the order said: in a burst, the last part can land long after you stop (27 s in one run, three speakers in a room); alone at a normal pace it keeps up.
- One app can be built at a time; pictures come only during pauses. The loudness scale for volume apps comes from synthesized speech, not yet a real mic.
- Tested on macOS. Reminders, Calendar and Messages need a Mac; elsewhere, and on the hosted site, a dated item saves as an `.ics` file.
- The hosted site seats 6 people at once and shares one daily model budget; past it, maps stay readable and new thoughts wait until the next day.
- Rooms work on one local network with a self-signed certificate; if both mics hear both people, the same words can be transcribed twice.
- A Voice Transcribe session can end after 60 minutes, and the mic doesn't turn itself off when you stop talking. The journal only grows.
- The sample maps were written by hand and are dated the week of Nov 3, 2026.

## More detail

- [docs/FEATURES.md](docs/FEATURES.md): everything in full: every model call and its setting, what you'll see, placing, the left-off card, Did you mean, the refiner, pictures and the Palace, apps, bricks, Recap, import, rooms, places on the canvas, presets with Messages, GitHub and Notes, hosting, privacy, security.
- [docs/COMMANDS.md](docs/COMMANDS.md): every spoken command, with its variants.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): the parts, the journal, the life of a thought, every model call.
- [docs/trace.md](docs/trace.md): every model call in one real run.
- [CHANGELOG.md](CHANGELOG.md): what changed, with what was measured.

## License

MIT; see [LICENSE](LICENSE).
