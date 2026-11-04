# E2A2O

<!-- pitch: draft, owner to approve -->
**Think out loud. Keep your place.** E2A2O files spoken thoughts by topic on a map. Change topics mid-sentence, then ask “where was I?” to return to the unfinished thought.

## Try it

<!-- hosted: draft, confirm fresh guest entry and the served build before leading with it -->
- **Local SAMPLE example:** `./run.sh sample` → printed `/?sample` URL (no key or mic; [setup](#run-it)).
- **Hosted preview, verification pending:** https://e2a2o.aviralgarg.com → **Try it without an account** → **See an example**.

![Historical synthetic demo: spoken fixture thoughts appear as topics and decisions on the map.](docs/screens/hero.gif)

*Earlier take, synthesized voice; zoom, labels and captions added. Historical timings below.*

## Meta models it runs on

Built during the Meta Global AI Developer Hackathon with Cerebral Valley (Oct 26 to Nov 4, 2026).

| When you… | Meta model | Does | Evidence: [historical report](docs/trace.md) |
|---|---|---|---|
| talk | Muse Voice Transcribe 1.0 | hears you, live | [heard](docs/trace.md#heard) |
| finish a thought | Muse Spark 1.3 + 1.2 | places it (both race); notices it trailed off | [placer](docs/trace.md#placer) |
| pause | Muse Spark 1.3 | tidies; proposes reminders | [refiner](docs/trace.md#refiner) |
| say “make an app that…” | Muse Spark 1.3 | builds it from blocks | [composer](docs/trace.md#composer) |
| ask “what did I decide?” | Muse Spark 1.3 | writes the Recap | [recap](docs/trace.md#recap) |
| let a topic settle | Muse Image 1.0 | draws its picture | [pictures](docs/trace.md#pictures) |
| say “where was I?” | no model | rules: the jump back | [rules](docs/trace.md#rules) |

Historical synthetic measurements: [sample counts, dates and input type](#measured); not current human results.

<!-- end of the first screen -->

## The problem

You think out loud: on a walk, at the stove, between classes. It comes out in the wrong order. Rent, then the midterm, then Mom's birthday, then back to what you were saying before rent, except now it's gone.

Stopping to write it down breaks the thought. A recording keeps every word in the order you said it, which is the tangle you wanted out of. And there's a second stream now: ideas spread across your chats with AI.

## The idea

Never make anyone stop to file. File each thought the moment it's said, onto a map of topics, and remember where each one was left, so getting back takes one sentence.

That is two kinds of work, kept apart on purpose:

- **Judgment goes to Meta's models.** Which topic is this? A tangent? Did the sentence trail off? Is a word misheard? Muse Spark answers in a JSON schema, against the map as it stands, for every finished thought.
- **Anything that must be instant and the same every time is a rule.** “Where was I?”, “pictures”, “recap”, “stop listening”, “scratch that”, filler like “um, so”, and a decision said in so many words (“decided: …”). These commands use deterministic rules; response time depends on speech endpointing and the queued work.

The AI shows its work: everything it adds is marked ✦ and says what it did and, where it can, how to undo or answer it; a point can say why it landed where it did; and nothing reaches your Reminders or Calendar until you approve it.

## One minute of talk

Selected beats from the scripted demo story; optional app requests in the linked script are omitted from the film plan here. The final video link and its build are pending. Play it yourself with [scripts/story-talk.jsonl](scripts/story-talk.jsonl) ([Run it](#run-it)); titles and a placement or two may differ in your run.

| You say | What happens |
|---|---|
| “My biggest problem is that I never finish my” | A new topic. Muse Spark (1.3 or 1.2, whichever answers first) notes the thought trailed off. |
| “Oh, and rent is due Friday and I still haven't sent it.” | A new topic, *Rent Due Friday*. The topic you left is marked **left off**, and a card in the next pause quotes your half-sentence. |
| “Wait, where was I?” | Back on the topic you left, by rule, with no model call. |
| “Sentences. I never finish my sentences.” | Joined to the half-sentence as one point, marked ✦ joined; a tap keeps them apart. |
| “Mom's birthday is Saturday. She keeps talking about that pottery class on Main Street.” | A new topic. |
| “Okay, decided: if it's under eighty dollars, I'm booking it tonight.” | Lands on Mom's topic marked **✓ Decided**. A rule reads “decided”: your word, not a guess. |
| “My stats midterm is Thursday, chapters four to six.” Then “Decided: I'll study with Priya on Wednesday night.” | A topic, and a decision on it. |
| *(a pause)* | Muse Spark 1.3 tidies titles and proposes reminders and dated events (in one take: “Pay rent · Fri, Nov 6”). Nothing is added until you press **Add to Reminders** or **Add to Calendar**, or say “add it to Reminders”. |
| “What did I decide today?” | The Recap shows decisions first, each linked to its topic; a cached draft can open while a refresh runs. |
| “Pictures.” | One picture per topic, drawn by Muse Image 1.0 during the pauses. |

![The map mid-talk: seven topics, two with a tangent; “Not Finishing Things” marked “left off”; at the bottom, a card “You didn't finish Not Finishing Things” quoting “My biggest problem is that I never finish my”, with Finish it and Later](docs/screens/left-off.webp)

*A real frame from an earlier run, only cropped: a sentence trailed off, the talk moved on, and the card offers to go back.*

## How it works

```
browser, one page per window               the core: one Rust process on your laptop
mic: 24 kHz audio, 80 ms frames ──/ws──▶   Muse Voice Transcribe 1.0: live words, end of each turn
                                           rules: filler, commands, "decided:"        (no model)
                                           Muse Spark 1.3 + 1.2: which topic? (JSON)   one thought at a time
the map, live ◀── every change ─────────   journal: one JSON line per change, replayed on start
                                           at pauses: Muse Spark 1.3 (tidy, Recap, apps)
                                                      Muse Image 1.0 (a picture per topic)
```

1. **Hear.** The page streams the mic to the core over a WebSocket. The core opens one Muse Voice Transcribe session per window and relays the audio; your words show live, and the service ends a turn when you pause. The key stays in the core.
2. **Rules first.** Before a model sees a turn, the core sets aside filler and acts on spoken commands; a command at the end of a turn (“…the flight. Where was I?”) waits for the words before it to land. A decision said in so many words (“decided:”, “let's go with …”) is marked ✓ Decided by rule, never guessed.
3. **Place.** Muse Spark 1.3 and Muse Spark 1.2, at minimal reasoning, reads each topic's title and latest points, the topic you're on and what you said just before, and answers in a JSON schema: continue, go back to an earlier topic, start a new one, or start a tangent off one; a brief point that preserves plans, commitments, names, times, conditions, negations and uncertainty, using more words when needed; whether you trailed off; any word that looks misheard. A topic takes a thought only when its title already covers the thought's main subject, so thinking out loud across several ideas for one project gets a topic per idea, not one topic that takes them all; words that announce a move (“another idea”, “anyway”) usually start a topic or cut the turn there. Only topic ids that exist are trusted. A turn that changes topic is cut where the answer says and placed in two parts. Thoughts go one at a time, in the order said, so each sees the map the one before left. Two calls race, one to each model, and the first good answer wins: how long a model reasons varies from call to call, and a slow spell mostly hits one model at a time. The window names the model that won (`PLACER_RACE=1` sends one call).
4. **Show.** Every change is appended to `journal.jsonl` in the [external map directory](docs/storage.md) and sent to every open window. While the placing calls run, the topics the prompt singles out light up, each with why (“said just before”, “left unfinished”); then the thought lands. Beside the mic, a line names the model at work and then how long it took (“answered · 2.6 s”), or says “by rule, no model”.
5. **While you pause.** Muse Spark 1.3 tidies: titles, one next step per topic, reminders and dated events from what you said, tags. A rename made of your own words lands with Undo; every other rename, and every merge, waits for your click. Muse Image 1.0 draws one picture per topic that has settled, for the Pictures view. A Recap draft stays current while the hour has model calls to spare, so asking shows it at once.
6. **Apps from blocks.** “Make an app that …” asks Muse Spark 1.3 to choose from a closed set of blocks: a watcher (a new thought, a phrase, a topic, loud voices, a time), an optional prompt, and a card, a short tune or a proposed reminder. The core rejects any block, field or value outside the schema; apps can't run code, open links or act on their own. Of the three seed apps, the two that fire on their own start off until you switch them on in Apps: Argument resolver, which names a repeated point or a common fallacy, and Volume watcher, which plays a silly tune when voices stay loud. The third, Search-first, only looks for an app you already have while a new one is being built.

### What needs a model, and what doesn't

- **Meta models, all through `api.meta.ai`:** hearing (Voice Transcribe 1.0); placing, Did you mean and Why here (Spark 1.3 and 1.2 race, the first good answer wins); Explain and reading a correction no rule reads (Spark 1.2); tidying, Recap, apps and search by meaning (Spark 1.3); importing past chats (Spark 1.2 pulls out the ideas, Spark 1.3 groups them); pictures (Image 1.0).
- **Rules in the core, no model:** spoken commands, filler, ✓ Decided, the jump back, search by words, the hourly call cap, the journal, and an app's watcher deciding when it fires.
- **The browser:** the mic (`getUserMedia` and an AudioWorklet that sends 24 kHz audio), the app's tune (Web Audio), Export to Markdown, and the calendar file (`.ics`) where Calendar can't be reached.
- **macOS:** Reminders and Calendar, through AppleScript, only when you approve an item. Messages and email only in the Full preset, after a send countdown you can stop, and as a dry run unless you turn sending on ([details](docs/FEATURES.md#presets-and-messages)).
- **Model integration:** the core calls Meta models through `api.meta.ai`; there is no GPT runtime dependency. This scope excludes browser/OS speech synthesis, enabled connectors and the optional Cloudflare quick tunnel (`scripts/trial.sh`). Reply playback uses only browser/OS voices reporting `localService === true`; if none is available, replies remain text. This browser flag is not proof of network isolation.

Every call, its setting, reasoning effort and time limit: [docs/FEATURES.md](docs/FEATURES.md#every-model-call-with-its-setting).

Full preset connectors (Demo remains the default):

| Connector | Words | Gate |
| --- | --- | --- |
| Messages | “Ask Mia to confirm what to bring” | `MESSAGES_TO`; `MESSAGES_SEND=on` for live sending |
| Email | “Email Mia that the cut is ready” | Features → Email, `EMAIL_TO`; `EMAIL_SEND=on` for Mail.app on the host laptop; otherwise a dry run. Hosted stays talk. Subject: first eight body words, immediately. Stop by voice, typing, Esc or button. |
| GitHub | “Show me the open pull requests” | Local `gh`, read only |
| Notes | “Save this topic as a note” | `NOTES_WRITE=on` for a real write |

## Run it

**Hosted preview:** https://e2a2o.aviralgarg.com → **Try it without an account** (under the sign-in form) → **See an example**. Fresh guest entry, example → “where was I?” → Pictures → refresh, and the hosted boot commit comparison remain pending on the final build. This link is not yet a verified judge route. Use the local example below in the meantime. Hosted pictures may be disabled; fixture pictures are pre-generated.

Tested on macOS. Every local start needs Node.js 22.12 or newer and npm: `run.sh` installs missing UI dependencies and builds the UI, including when using a bundled core. For the mic, use Chrome or Safari.

If you supply an executable regular file named exactly `e2a2o-core-PLATFORM-ARCH` beside `run.sh`, it uses that core without Rust or native build tools. Replace `PLATFORM` and `ARCH` with Node's `process.platform` and `process.arch` (see `node -p 'process.platform + "-" + process.arch'`); for example, `e2a2o-core-darwin-arm64` on an Apple-silicon Mac. These instructions do not promise a published binary release. Node and the UI build are still required.

If a release containing your machine's `e2a2o-core-PLATFORM-ARCH` binary and `SHA256SUMS` has been published, you can optionally install it with the commands below from the repository root, replacing `TAG` with that release's actual tag. The installer checks SHA-256 and installs beside `run.sh`; an existing destination is refused rather than replaced.

```sh
node scripts/fetch-core.mjs TAG
./run.sh sample
```

Without a matching executable, it builds from source. Needs Rust 1.89 or newer ([rustup.rs](https://rustup.rs)); on a Mac with no developer tools, run `xcode-select --install` first.

**Linux:** the source build also needs a C compiler, pkg-config and OpenSSL's headers; `run.sh` checks them and prints the command for whatever is missing. Not tested on Linux.

**Windows:** use the hosted version above; otherwise WSL2 (Ubuntu): clone inside WSL, follow the Linux line, and open the printed link in Chrome on Windows. Not tested on Windows.

```sh
git clone https://github.com/gaviral/e2a2o-app.git && cd e2a2o-app
./run.sh sample
```

Build time depends on the machine and cache. The launcher prints the UI and core stages. When the terminal says `E2A2O core on`, open the sample URL printed by the launcher: `http://localhost:4321/?sample` by default. Without a key it also logs `MODEL_API_KEY is not set`; the sample doesn't need one. If port 4321 is busy, `run.sh` says so before building: `PORT=4400 ./run.sh sample` prints `http://localhost:4400/?sample`.

**No key: a sample map, labelled SAMPLE.** A student's week: 8 topics, 30 thoughts, a picture for every topic (drawn once by the app's own picture pipeline and saved in `samples/images/`), two proposed reminders, and one topic left off. These are public fixtures dated for the week of Nov 3, 2026; their deadlines are examples. Type “where was I?” to return to the unfinished topic, then “pictures” to open its saved pictures. You can also try `j`/`k` and Enter, `/` to search, and the “Did you mean BC Hydro?” question written into the sample. Cards and Pictures start off: switch one on in Features (`C`) and choose Show. Without a key the status line at the bottom says “No AI key”; new text needs a working key for automatic placement. `./run.sh sample founder` opens a founder's day, also labelled SAMPLE. Each sample start restores its fixture.

The default page opens the current shell; `/?sample` adds its SAMPLE stamp. The earlier classic page (a header across the top and a bottom bar) stays at `http://localhost:4321/?shell=1`.

**Work spine and Remote (simulated helper work, no key needed).** In **Features** (`C`), switch on **Work spine**. It shows jobs beside the Canvas on a laptop; on a phone, tap its bar above the Input box. With the local app running, open a second terminal in the repository and run `node scripts/demo-jobs.mjs` (add `--port PORT` for a different app port, or `--room CODE` for a Shared map). The feed labels its jobs **Demo mode · simulated**; it makes no bookings or payments. Leave it running to answer its held question. Open `/?remote` on the same app for the phone Remote: in a Shared map it joins as a guest and relays your answer; without a Shared map it plays a simulated feed in the page.

**With a key: watch the story build itself.**

See [Local configuration](docs/configuration.md) for all model, helper, and connector options.

`.env.example` is intentionally blank. Copy it below, then open `.env` and add the full `MODEL_API_KEY=` line with your own Meta key immediately after `=` on the same line. Save the file before starting; after any key change, restart the app. No key is needed for a sample. On macOS, the login Keychain is an optional alternative when `.env` is absent; see [Features](docs/FEATURES.md).

```sh
cp .env.example .env                                # blank template; add the full key line and save before starting
./run.sh demo                                       # its own external demo map
node scripts/demo.mjs scripts/story-talk.jsonl      # in a second terminal: the synthetic story, including optional app requests
```

- Open the URL as soon as it says `E2A2O core on`, then start the talk. Placement, tidy-up, pictures and app creation need live model calls; wait for the current turn to finish.
- A wrong or expired key is refused on the first call: the status line says “AI key refused”, the app stops calling, and new thoughts wait, saved, until you fix `MODEL_API_KEY` and restart.
- Speak it instead of typing it: `node scripts/voice.mjs scripts/story-talk.jsonl` says each line in a synthesized voice through the real speech path (macOS). This does not establish human microphone or audible tune reliability.

**Your own voice.** `./run.sh` (your map lives in [external app storage](docs/storage.md)), open http://localhost:4321, press the mic and talk, or type and press Enter. Say “what can I say?” for every command; [docs/COMMANDS.md](docs/COMMANDS.md) has them all.

**See every model call.** Start the core with `E2A2O_TRACE=1` and it writes each model request and answer, never the key, to `trace.jsonl` in the external map directory. `node scripts/trace-summary.mjs "$MAP/trace.jsonl"` counts them by feature and model, and `node scripts/where.mjs "$MAP"` shows where each thought went and why. Set `MAP` to the path printed by `e2a2o-core --data-path demo`. [One run's trace](docs/trace.md).

**More ways in:** two laptops on one map (`./run.sh room`), a friend anywhere on a link (`sh scripts/trial.sh NAME`), or a start from your past ChatGPT or Claude chats (Import chats). Each is in [docs/FEATURES.md](docs/FEATURES.md#try-it).

## Measured

<!-- numbers: draft, retake on the freeze tag and replace the take rows with that take set -->
Historical synthetic results are preserved as a [sanitized aggregate](docs/trace.md): one reported take (n = 1) dated 2026-11-02, 12 voice turns, 8 placements and 4 saved pictures. The referenced historical revision is not on main ancestry, so this is a carried documentation report, not independently revalidated implementation evidence or current human performance. Model configuration, per-feature counts and reported timings are on that page.

No current human microphone, noisy-room, tune playback or friend-trial result is claimed. The final build, film, rights and owner approvals remain pending in the [prototype evidence scope](docs/release-evidence.md).

To measure your own synthetic run, use `node scripts/voice.mjs scripts/story-talk.jsonl`. Set `MAP` to the external map directory printed by `e2a2o-core --data-path demo`; `node scripts/latency.mjs "$MAP/journal.jsonl"` summarizes placement times.

## Who it's for

People who think by talking: a student with a midterm, rent and a birthday in one week; a founder between meetings; anyone whose best idea shows up in the middle of another one. The sample maps are a student's week and a founder's day, and an empty map also offers three short ones: a team meeting, a bug left for a call, a walk through a house.

<!-- trials: draft, add the Nov 2 friend trials here as "N friends, unscripted": n, one result, one limit -->

**Isn't it a notes app?** It's closer to a map that draws itself while you talk: you never stop to file, a turn that changes topic is split, and the map brings you back to the sentence you dropped.

## Accessibility

- The first Tab stop is “Skip to Type a thought”; `?` opens Help, which lists every keyboard shortcut and spoken command; a focused point opens its words with Enter or Space.
- The mic shows its state by shape as well as color; Reduce Motion is respected; at 200% zoom and up the corners, the input box and the status line stay in place.

## Privacy

- Local mode stores the map in the external directory on your machine; hosted mode stores it on the host server and adds sign-in. The model key stays in the core. Built-in speech is on by default when a browser/OS voice reports `localService === true`; remote and unknown-locality voices are excluded. Without a usable local voice, replies remain text. The browser flag is not proof of network isolation. Enabled connectors and the optional tunnel have their own network paths.
- Model inputs leave the core for `api.meta.ai`. While the mic is on, that's the audio, after a 0.5 s synthetic “ah” the core sends so a session's first line comes back fast. Each finished thought goes with every topic's title and last point (the last 3 points on the 20 topics touched last), as two calls at once, one to Spark 1.3 and one to Spark 1.2 (`PLACER_RACE=1` sends one). Every call and exactly what it sends: [docs/FEATURES.md](docs/FEATURES.md#privacy-and-data).
- Placing races `muse-spark-1.3` and `muse-spark-1.2` (`PLACER_MODELS`); Explain uses `muse-spark-1.2`. `PLACER_MODEL=muse-spark-1.2-contributor` turns on Contributor mode, for Explain and every placing call: Meta may keep what it reads to improve its products. A `PLACER_MODEL` you set is used as is, with no fallback: if the key can't use it (401 or 403), every model feature stops until a restart. A listed model the key can't use leaves the race until a restart, and the others place.
- On disk: `journal.jsonl` and `images/` stay in the [validated external map directory](docs/storage.md), alongside traces and shared-map certificates. `E2A2O_DATA` selects a complete map, including named, sample, demo and shared-map launches. Existing checkout data requires a manual migration; startup never moves it.

## Security and checks

- Alone, the core listens on 127.0.0.1 only, and a gate checks every request's Host and Origin, so another site in your browser can't reach it. A shared map needs its Join code.
- Model output is data: only existing topic ids are trusted, app specs must match a closed set of blocks, and the UI renders text, never raw HTML.
- `sh scripts/test.sh` runs every test that needs no key: the core's Rust tests, the UI build and the offline UI checks. `scripts/precheck.sh` is the intended merge/release gate; its checks are described in [docs/FEATURES.md](docs/FEATURES.md#security). These instructions do not establish a successful check on every merge. See the [bounded prototype checks](docs/release-evidence.md).

## Built during the event

- Before the event: the idea and design notes. No code.
- Written during the event (Oct 26 to Nov 4, 2026): everything in this repository; the first commit is from Oct 31.
- Built by one person working with AI coding agents. The merge checks are `cargo test`, the UI build and `scripts/precheck.sh`; this describes the checks, not a verified result for every historical merge.
- The sample pictures and topic pictures were generated by Muse Image 1.0; each carries an XMP metadata note that AI made it.

## Known limits

- Every model feature needs `api.meta.ai` and a key; there's no offline model.
- Set up for English; Voice Transcribe can spell names and rare words differently, and Did you mean catches some of them.
- The historical voice measurements used synthesized voices in a quiet setup; human performance in noisy places is unmeasured. No one outside the project has been measured using it yet.
- Placing is a model's judgment. You can move or delete a thought and rename a topic, by voice or click, with Undo; you can't merge or split topics yourself, except by accepting the refiner's proposals.
- One placement at a time, in the order said: in a burst, the last part can land long after you stop; this prototype makes no current latency guarantee.
- One app can be built at a time; pictures come only during pauses. Volume/tune behavior needs a human microphone and recording-mic receipt before inclusion in the final film; that beat is omitted here.
- Tested on macOS. Reminders, Calendar, Messages and Mail need a Mac; elsewhere, and on the hosted site, a dated item saves as an `.ics` file.
- The hosted site seats 6 people at once and shares one daily model budget; past it, maps stay readable and new thoughts wait until the next day.
- Shared maps work on one local network with a self-signed certificate; if both mics hear both people, the same words can be transcribed twice.
- A Voice Transcribe session can end after 60 minutes, and the mic doesn't turn itself off when you stop talking. The journal only grows.
- The sample maps were written by hand and are dated the week of Nov 3, 2026.

## More detail

- [docs/FEATURES.md](docs/FEATURES.md): everything in full: every model call and its setting, what you'll see, placing, the Unfinished thought card, Did you mean, the refiner, pictures and the Pictures view, apps, features, Recap, import, shared maps, places on the canvas, presets with Messages, Email, GitHub and Notes, hosting, privacy, security.
- [docs/COMMANDS.md](docs/COMMANDS.md): every spoken command, with its variants.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): the parts, the journal, the life of a thought, every model call.
- [docs/trace.md](docs/trace.md): a sanitized historical synthetic aggregate by model and feature.
- [CHANGELOG.md](CHANGELOG.md): what changed, with what was measured.

## License

MIT; see [LICENSE](LICENSE).
