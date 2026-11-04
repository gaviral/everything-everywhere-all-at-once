# <img src="ui/public/icons/icon-192.png" width="48" alt="E2A2O logo"> E2A2O

E2A2O turns your words and sketches into a usable board, with Muse building reusable parts and bringing them together. Your ideas stay in view.

**Think out loud. Build what you mean.**

## Try it

- **Local sample:** `./run.sh sample` → `http://localhost:4321/?sample` (no key or mic).
- **Hosted preview, verification pending:** https://e2a2o.aviralgarg.com

Say it. **Ask about words** questions a word right where it was used. Draw it: Muse Spark reads the sketch; Muse Image draws it back. **Crew** splits the work into parts on real Git branches, checks and merges what works, repairs or turns off what breaks, and reuses finished parts. **Parts** follows the work into the code.

![Earlier scripted demo of thoughts landing on the board.](docs/screens/hero.gif)

*Historical synthetic demo; edited zoom, labels and captions.*

## Meta models

| You… | Model | Code | Historical synthetic report |
|---|---|---|---|
| Speak | Muse Voice Transcribe 1.0 | [asr.rs](core/src/asr.rs) | [heard](docs/trace.md#heard) |
| Finish a thought | Muse Spark 1.3 + 1.2 | [placer.rs](core/src/placer.rs) | [placer](docs/trace.md#placer) |
| Pause | Muse Spark 1.3 | [refiner.rs](core/src/refiner.rs) | [refiner](docs/trace.md#refiner) |
| Request an app | Muse Spark 1.3 | [apps.rs](core/src/apps.rs) | [composer](docs/trace.md#composer) |
| Ask for a recap | Muse Spark 1.3 | [recap.rs](core/src/recap.rs) | [recap](docs/trace.md#recap) |
| Let a topic settle | Muse Image 1.0 | [pictures.rs](core/src/pictures.rs) | [pictures](docs/trace.md#pictures) |
| Ask “where was I?” | no model | [spoken.rs](core/src/spoken.rs) | [rules](docs/trace.md#rules) |

<!-- end of the first screen -->

## Run it

From this repository, use Node.js 22.12 or newer, npm, and Rust 1.89 or newer. A source build on macOS also needs Apple's command-line tools. Linux needs a C compiler, pkg-config and OpenSSL headers. Linux and Windows are not validated here.

```sh
./run.sh sample
```

The launcher installs missing UI dependencies, builds the UI and starts the Rust core. Wait for `E2A2O core on`, then open the printed URL. The sample is labelled SAMPLE. Its thoughts, saved pictures and deadlines are examples. Try “where was I?” or search with `/`.

For another port:

```sh
PORT=4400 ./run.sh sample
```

Open http://localhost:4400/?sample. `./run.sh sample founder` selects the other sample. Each sample start restores its fixture and keeps a backup of its prior contents.

For live model calls, create `.env` from the blank template:

```sh
cp .env.example .env
```

Open `.env` in an editor. Add a `MODEL_API_KEY` assignment with your Meta key, save, then start:

```sh
./run.sh demo
```

Open the printed URL. Type and press Enter, or start the mic yourself. In **Features** (`C`), enable **Ask about words**, **Draw** and **Crew** to try them. Open **Features**, switch on **Pictures**, then choose **Show** for topic images.

To replay prepared typed input, use a second terminal in the repository:

```sh
node scripts/demo.mjs scripts/story-talk.jsonl
```

This makes live model calls from scripted text. Add `--port 4400` if the app uses that port. Stop the app with Ctrl+C in its terminal. Restart after changing the key. `./run.sh` opens your regular map; [storage](docs/storage.md) describes where maps are kept.

## From words to parts

- **Say it.** Spoken or typed thoughts become topics on the board. Placement aims to preserve commitments, conditions, negations and uncertainty. You can revisit the original words.
- **Ask about words.** Spark picks an unclear word or phrase from the actual sentence. A question points to it at your pause. Your answer stays attached to that occurrence.
- **Draw it.** Sketch and label the parts. Spark reads the drawing and its links. Ask Muse Image to draw it back, or hand the sketch to Crew.
- **Build it.** Crew plans small parts and their dependencies. Independent parts build together. Each part gets a Git branch in a separate generated repository. The app checks its block format, requests a repair if needed, then merges accepted parts through `dev`, `staging` and `main`. Finished parts enter a library for reuse.
- **Follow it.** Parts exposes source files, functions and file history. The Git branch view shows work in the local repository. A feature that throws is isolated; its recovery notice lets you review it.

The Features page lists **122 features**. That is an entry count, not a count of proven successes. [Feature details and source links](docs/FEATURES.md) describe the boundaries.

## Model calls in the code

The app calls Meta models only, with no GPT runtime dependency. The Rust core holds the key and sends model requests through [model.rs](core/src/model.rs).

| Work | Meta model | Implementation |
|---|---|---|
| Ask about a word | Muse Spark 1.3 | [clarify.rs](core/src/clarify.rs) |
| Read a sketch | Muse Spark 1.3 | [draw.rs](core/src/draw.rs) |
| Draw it back | Muse Image 1.0 | [draw.rs](core/src/draw.rs) |
| Plan, build and repair Crew parts | Muse Spark 1.3 | [crew.rs](core/src/crew.rs) |
| Plan and run text transformations | Muse Spark 1.3 | [flow.rs](core/src/flow.rs) |

## Typed-input measurements

These are recorded observations from typed input. They are not speed or reliability promises, or measurements of someone speaking into a microphone.

| Recorded task | Result | Input |
|---|---|---|
| Spark reads a sketch | 4 to 6 s | typed input |
| Muse Image draws back | about 9 s | typed input |
| Crew builds parts | 6 of 6 in 11.3 s, with 1 repaired | typed input |

## New work for the hackathon

The implementation in this repository was built for the Meta x Cerebral Valley hackathon. The idea and design preceded the event; no application code did. New work includes the board, speech and sketch paths, questions attached to words, Crew's part workflow, reuse, recovery and source inspection. Dependencies are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Samples, simulation and limits

The local samples contain prepared thoughts, pictures and prompts. They let you explore without a key. Live placement, sketch reading, image generation and Crew need a working Meta key and network access.

Work spine and Remote include simulated helper feeds. Those examples do not perform external work. Crew uses real model calls and Git operations, but generates board parts from a fixed set of blocks. Its checks do not establish arbitrary program correctness. The optional `?crewfault` demo deliberately damages a part to show repair.

The demo film's narration is a third-party synthetic voice (Deepgram Aura), used for the film only; the app itself calls Meta models only.

Models can misread words, sketches or intent. Speech is configured for English. Human microphone and interruption behavior still need validation. Hosted guest entry and the served build remain unverified for this handoff. The journal grows without compaction.

Reply playback uses a browser/OS voice only when the voice reports `localService === true`; remote and unknown-locality voices are excluded. Without a usable local voice, replies remain text. This browser flag is not proof of network isolation.

Optional connectors need separate setup. The seeded apps that act on their own start off until you switch them on in Apps: Argument resolver and Volume watcher. Review proposed external actions before approving them.

[Features](docs/FEATURES.md) · [Commands](docs/COMMANDS.md) · [Architecture and parts](docs/ARCHITECTURE.md) · [Configuration](docs/configuration.md) · [MIT license](LICENSE)
