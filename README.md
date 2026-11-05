# E2A2O
The IDE from the future, for developers and AI to follow each other.
Speak, type and sketch; build reusable board parts with Muse Spark; inspect the work across real Git branches.

<img src="ui/public/icons/icon-192.png" width="48" alt="E2A2O logo">

**Think out loud. Build what you mean.**

## Why

AI is racing ahead of the person directing it. Here, you keep up with your agents, and they keep up with you.

![Crew's board: seven parts merged through real Git branches](docs/looks/crew-look.png)

<!-- Film link goes here. -->

## What sets it apart

- **The canvas is the project.** Not a file tree: your thinking, organized by what it's about, with your original words one step away.
- **Composition you can see.** Every piece is a named part made of smaller parts, and finished parts get reused.
- **You see the agents.** Muse Spark builds parts in parallel on real Git branches; checked work merges through dev, staging and main, and what breaks gets repaired.
- **Talk and draw.** Speak a thought, sketch how it fits, and Muse Spark reads the sketch while Muse Image draws it back.

## Try the IDE

```sh
./run.sh sample
```

Opens a fictional payments API team at `http://localhost:4321/?sample`, with no key and no mic. The first run installs dependencies and compiles Rust, about four minutes, and needs network access. Live model features need a Meta key; see [Run it](#run-it).

## Built during the hackathon

Before the event there were only ideas and design notes, no app code. All application code in this repository was written during the Meta x Cerebral Valley hackathon, by the author with AI coding agents. Third-party dependencies keep their licences.

## Powered by Meta models

| You… | Model | Code |
|---|---|---|
| Speak | Muse Voice Transcribe 1.0 | [asr.rs](core/src/asr.rs) |
| Finish a thought | Muse Spark 1.3 + 1.2 | [placer.rs](core/src/placer.rs) |
| Pause | Muse Spark 1.3 | [refiner.rs](core/src/refiner.rs) |
| Request an app | Muse Spark 1.3 | [apps.rs](core/src/apps.rs) |
| Ask for a recap | Muse Spark 1.3 | [recap.rs](core/src/recap.rs) |
| Let a topic settle | Muse Image 1.0 | [pictures.rs](core/src/pictures.rs) |
| Ask about a word | Muse Spark 1.3 | [clarify.rs](core/src/clarify.rs) |
| Sketch an idea | Muse Spark 1.3 reads it; Muse Image 1.0 draws it back | [draw.rs](core/src/draw.rs) |
| Build board parts with Crew | Muse Spark 1.3 | [crew.rs](core/src/crew.rs) |
| Transform text with Flow | Muse Spark 1.3 | [flow.rs](core/src/flow.rs) |
| Ask “where was I?” | no model | [spoken.rs](core/src/spoken.rs) |

<!-- end of the first screen -->

## Speak, type, sketch and build

- **Say it.** Speak or type. Thoughts become topics on the board, with the original words available beside them.
- **Ask about words.** A question points to a word in your sentence. Your answer stays attached to that occurrence.
- **Draw it.** Sketch and label an idea. Spark reads its parts and connections; Muse Image draws it back.
- **Build it.** Crew plans board components from text, checklists, counters and other blocks. Each part gets a Git branch. Crew checks the structure, requests repairs and merges accepted parts through `dev`, `staging` and `main`. Finished parts enter a library for reuse.
- **Follow it.** Parts opens source files, functions and Git history. The recovery panel lets you retry a feature after a rendering error.

[Explore the features](docs/FEATURES.md).

## Run it

Needs Rust 1.89 or newer, Node.js 22.12 or newer, and npm. Source builds need Apple's command-line tools on macOS, or a C compiler, pkg-config and OpenSSL headers on Linux. Crew and the optional coding helpers also need Git. Linux and Windows are not validated here.

```sh
./run.sh sample             # developer sample (default)
./run.sh sample developer   # payments API release
./run.sh sample student     # student week
./run.sh sample founder     # founder day
```

The launcher installs missing UI dependencies, builds the UI and starts the Rust core. Wait for `E2A2O core on`, then open the printed URL. The map is labelled SAMPLE: its thoughts, saved pictures and deadlines are examples. Try “where was I?” or search with `/`.

The developer sample follows a fictional small team through rollout stages, rollback, on-call, smoke tests and a release note, with a decision and an unfinished thought. Each sample start restores its fixture and keeps a backup. To choose another port, run `PORT=4400 ./run.sh sample` and open http://localhost:4400/?sample.

For live model calls, copy the blank configuration template:

```sh
cp .env.example .env
```

Add your Meta key as `MODEL_API_KEY` in `.env`, then run:

```sh
./run.sh demo
```

Open the printed URL. Type and press Enter, or start the mic yourself. Open **Features** (`C`) to enable **Ask about words**, **Draw** and **Crew**. For topic images, switch on **Pictures**, then choose **Show**. In **Apps**, switch on **Argument resolver** or **Volume watcher** to use them; both start off.

Stop with Ctrl+C. Restart after changing the key. `./run.sh` opens your regular map; see [storage](docs/storage.md).

## How it's built

A React and TypeScript board connects to a Rust core. The core holds the key and calls Meta models through [model.rs](core/src/model.rs). Features are composed from named parts, with separate rendering error boundaries. Crew keeps generated board specifications in their own Git repositories.

The app calls Meta models only, with no GPT runtime dependency. ChatGPT and Claude are supported import formats: imports send selected content to Meta without calling either service. Optional coding helpers use the built-in Meta runner; leave `HELPERS_CMD` unset for this runtime.

[Prototype scope](docs/ARCHITECTURE.md#prototype-scope) · [Architecture and parts](docs/ARCHITECTURE.md) · [Commands](docs/COMMANDS.md) · [Configuration](docs/configuration.md) · [Dependencies](THIRD_PARTY_NOTICES.md) · [MIT license](LICENSE)
