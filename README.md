# <img src="ui/public/icons/icon-192.png" width="48" alt="E2A2O logo"> E2A2O

E2A2O turns your words and sketches into a board of reusable parts. Capture a thought, question a word, draw an idea and ask Muse to build it. Your ideas stay in view.

**Think out loud. Build what you mean.**

## Try it

**Local sample:** `./run.sh sample` → `http://localhost:4321/?sample` (no key or mic).

<!-- Film link goes here. -->

## Meta models

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

## From words to parts

- **Say it.** Speak or type. Thoughts become topics on the board, with the original words available beside them.
- **Ask about words.** A question points to a word in your sentence. Your answer stays attached to that occurrence.
- **Draw it.** Sketch and label an idea. Spark reads its parts and connections; Muse Image draws it back.
- **Build it.** Crew plans board components from text, checklists, counters and other blocks. Each part gets a Git branch. Crew checks the structure, requests repairs and merges accepted parts through `dev`, `staging` and `main`. Finished parts enter a library for reuse.
- **Follow it.** Parts opens source files, functions and Git history. The recovery panel lets you retry a feature after a rendering error.

[Explore the features](docs/FEATURES.md).

## Run it

Needs Rust 1.89 or newer, Node.js 22.12 or newer, and npm. The launcher detects macOS (Intel or Apple silicon) and Linux. Source builds need Apple's command-line tools on macOS (`xcode-select --install`), or a C compiler, pkg-config and OpenSSL headers on Linux (`sudo apt install build-essential pkg-config libssl-dev` on Debian/Ubuntu). Crew and the optional coding helpers also need Git. The first build needs internet access to download dependencies. Linux and Apple silicon have not been validated here. **Windows:** use WSL2 with the Linux prerequisites.

```sh
./run.sh sample
```

The launcher installs missing UI dependencies, builds the UI and starts the Rust core. Wait for `E2A2O core on`, then open the printed URL. The map is labelled SAMPLE: its thoughts, saved pictures and deadlines are examples. Try “where was I?” or search with `/`.

`./run.sh sample founder` opens the founder sample. Each sample start restores its fixture and keeps a backup. To choose another port, run `PORT=4400 ./run.sh sample` and open http://localhost:4400/?sample.

In the keyless sample, type a thought and press Enter to save it, or use **Where was I?** and **Pictures**. Open **Features** (`C`), enable **Draw**, close Features, then click **Draw** to sketch and label an idea. Drawing works locally; **Read it**, **Draw back**, automatic thought placement and **Crew** builds need a Meta key. Crew has no keyless sample build.

**Docker:** from the repository root, run `docker compose up --build --wait`, then open http://localhost:8080/?sample. Requires Docker Engine/Desktop with Compose v2. This path has been reviewed by inspection, not run on this Mac; see [Docker setup and limits](docs/docker.md).

For live model calls, copy the blank configuration template:

```sh
cp .env.example .env
```

Add your Meta key as `MODEL_API_KEY` in `.env`, then run:

```sh
./run.sh demo
```

Open the printed URL. Type and press Enter, or start the mic yourself. Open **Features** (`C`) to enable **Ask about words**, **Draw** and **Crew**. For topic images, switch on **Pictures**, then choose **Show**. In **Apps**, switch on **Argument resolver** or **Volume watcher** to use them; both start off.

For **Crew**, start locally with `E2A2O_DEV_TOOLS=1 ./run.sh demo` and your Meta key configured. Enable **Crew** in Features, close Features, then click **Crew**. It creates Git repositories beside your map; Git must be installed. Crew is unavailable in hosted/Docker mode.

Stop with Ctrl+C. Restart after changing the key. `./run.sh` opens your regular map; see [storage](docs/storage.md).

## How it's built

A React and TypeScript board connects to a Rust core. The core holds the key and calls Meta models through [model.rs](core/src/model.rs). Features are composed from named parts, with separate rendering error boundaries. Crew keeps generated board specifications in their own Git repositories.

The app calls Meta models only, with no GPT runtime dependency. ChatGPT and Claude are supported import formats: imports send selected content to Meta without calling either service. Optional coding helpers use the built-in Meta runner; leave `HELPERS_CMD` unset for this runtime.

[Fresh-clone check](docs/stranger-test.md) · [Prototype evidence and limits](docs/release-evidence.md) · [Architecture and parts](docs/ARCHITECTURE.md) · [Commands](docs/COMMANDS.md) · [Configuration](docs/configuration.md) · [Dependencies](THIRD_PARTY_NOTICES.md) · [MIT license](LICENSE)
