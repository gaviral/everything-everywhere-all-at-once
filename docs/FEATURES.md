# Features

E2A2O turns words and sketches into a board of reusable parts. This page describes what you can try, where it lives in the code, and what remains limited. Start with the [README](../README.md#run-it).

The **122 features** shown on the Features page are entries, not proven successes. Some are optional views, experiments or prepared demonstrations. Enable features in **Features** (`C`). A switch does not establish that a feature has passed an end-to-end trial.

## Say it

Type a thought and press Enter, or start the mic yourself. Spoken words arrive through Muse Voice Transcribe. Muse Spark places a completed thought under a topic or creates one. A thought can split across topics. The original words remain available beside the placed point.

“Where was I?” returns to the unfinished topic by rule. Search can find words already on the board. Decisions, reminders and recap give you other ways to revisit the conversation. Model placement can be wrong; inspect the original, move the point or undo a change.

Code: [asr.rs](../core/src/asr.rs), [placer.rs](../core/src/placer.rs), [spoken.rs](../core/src/spoken.rs), [recap.rs](../core/src/recap.rs).

## Ask about words

Enable **Ask about words**. Spark reads a new thought and its recent context. It picks a word or phrase copied from that sentence and asks a short question. The app underlines the occurrence and points the question to it when you pause.

Answer with your next thought while the question is shown. The answer becomes an annotation on those words. **Got it** dismisses the question. This feature can miss an ambiguity or ask about something already clear.

Code: [clarify.rs](../core/src/clarify.rs), [question and answer flow](../ui/src/bricks/clarify/index.tsx), [word anchor](../ui/src/bricks/clarify/marking.ts).

## Draw

Enable **Draw**. Sketch on the sheet, add labels and explain what the marks mean. Muse Spark reads the image alongside those labels and words. It returns named parts, links and a question where it is unsure. Muse Image can draw the idea back. The sheet can pass the idea to Crew.

The page holds the sketch. Recognition is a model interpretation, so review the labels and connections before using them. Generated pictures may change or omit details.

Code: [draw.rs](../core/src/draw.rs), [Draw sheet](../ui/src/bricks/draw/index.tsx), [image requests](../ui/src/bricks/draw/reading.ts).

## Crew

Enable **Crew**, open its panel and describe what to build. You can type directly into the panel or say “build all that” after describing the work on the board.

Crew uses Muse Spark to plan small parts with dependencies. Independent parts build together; dependent parts wait. Each run creates a separate Git repository. Each part has a real branch and commits containing its board specification.

The specification uses a fixed set of blocks: text, a time-left display, a checklist, a counter, a note, a completion label or a question. The app checks the title and block fields. If that check fails, Crew asks Spark to repair the part. If repair fails, the part turns off and the remaining work continues.

Accepted parts merge into `dev`, then `staging`, then `main`. The page shows the Git branches and results. Finished specifications enter a library that later plans can reuse. These are board components; Crew does not generate and validate arbitrary application source code.

The optional `?crewfault` mode removes a title on purpose. The page labels the injected fault. A subsequent repair is a live model call; the initial fault is staged.

Code: [crew.rs](../core/src/crew.rs), [workflow](../ui/src/bricks/crew/index.tsx), [dependency order](../ui/src/bricks/crew/run.ts), [blocks](../ui/src/bricks/crew/kit.tsx).

## Parts and recovery

Parts follows the work into source files and functions. The source view reads the local checkout and Git history. Versions describe file history, not independent releases of every function. Repository access is limited to the local host; shared map guests cannot read the host's source through this view.

Features mount behind individual error boundaries. A feature that throws stops rendering while the rest of the page remains available. The recovery panel records the problem and offers a way to try the feature again. Retrying a render is separate from Crew asking Spark to repair a generated specification.

Code: [code_canvas.rs](../core/src/code_canvas.rs), [source parts](../core/src/code_canvas/parts.rs), [feature boundary](../ui/src/bricks/self-heal/Boundary.tsx), [recovery log](../ui/src/bricks/self-heal/RecoveryLog.tsx).

## Pictures, recap and small apps

Open **Features**, switch on **Pictures**, then choose **Show**. Muse Image draws topic pictures when a topic settles. The keyless samples use saved images. Pictures can arrive after the text and may not match every detail.

Ask “what did I decide?” for a recap linked to topics. Ask to make an app for a small rule built from a watcher, an optional prompt and an output such as a card. The app checks the allowed blocks before keeping it.

The seeded apps that act on their own start off: **Argument resolver** and **Volume watcher**. Switch them on in Apps if wanted. External reminders, calendar entries and connectors need their own approvals and setup. See [configuration](configuration.md).

Code: [pictures.rs](../core/src/pictures.rs), [recap.rs](../core/src/recap.rs), [apps.rs](../core/src/apps.rs), [app blocks](../core/src/app_blocks/mod.rs).

## Every model call, with its setting

All application model calls go to Meta. The core holds the key. Shared request handling in [model.rs](../core/src/model.rs) applies timeouts, key-refusal handling and the configured call cap. Calls can fail or wait when the key, service or budget is unavailable.

| Work | Model and setting | Code |
|---|---|---|
| Live speech transcription | Muse Voice Transcribe 1.0 | [asr.rs](../core/src/asr.rs) |
| Thought placement | Muse Spark 1.3 + 1.2; minimal reasoning; `PLACER_MODELS`, `PLACER_MODEL`, `PLACER_RACE` | [main.rs](../core/src/main.rs), [placer.rs](../core/src/placer.rs) |
| Word questions | Muse Spark 1.3; minimal reasoning | [clarify.rs](../core/src/clarify.rs) |
| Sketch reading | Muse Spark 1.3; minimal reasoning | [draw.rs](../core/src/draw.rs) |
| Sketch drawing | Muse Image 1.0; low reasoning strength | [draw.rs](../core/src/draw.rs) |
| Crew planning, building and repair | Muse Spark 1.3; minimal reasoning | [crew.rs](../core/src/crew.rs) |
| Flow planning and text transformations | Muse Spark 1.3; minimal reasoning | [flow.rs](../core/src/flow.rs) |
| Refiner, app composition and app prompts | Muse Spark 1.3 default; `REFINER_MODEL` | [refiner.rs](../core/src/refiner.rs), [apps.rs](../core/src/apps.rs) |
| Recap | Muse Spark 1.3 default; `RECAP_MODEL`, falling back to `REFINER_MODEL` | [recap.rs](../core/src/recap.rs) |
| Explain and interpretation of corrections | Configured placer model; Muse Spark 1.2 by default | [explain.rs](../core/src/explain.rs), [catalog.rs](../core/src/catalog.rs) |
| Search by meaning | Configured refiner model; Muse Spark 1.3 by default | [find.rs](../core/src/find.rs) |
| Conversation partner | Muse Spark 1.2 default; `PARTNER_MODEL` | [conversation.rs](../core/src/conversation.rs) |
| Import extraction and grouping | Muse Spark 1.2 then 1.3; `IMPORT_EXTRACT_MODEL`, `IMPORT_MERGE_MODEL` | [import.rs](../core/src/import.rs) |
| Topic pictures | Muse Image 1.0 | [pictures.rs](../core/src/pictures.rs) |
| Bounded coding-helper proposals | Muse Spark 1.3; off by default | [provider.rs](../core/src/helpers/coding/provider.rs) |

Text and image interpretation use `https://api.meta.ai/v1/chat/completions`. Image generation uses `https://api.meta.ai/v1/images/generations`. Speech uses `wss://api.meta.ai/v1/asr/realtime`.

Navigation, Git operations, block checks and feature recovery do not need model judgment. Reply playback uses a browser/OS voice only when the voice reports `localService === true`; remote and unknown-locality voices are excluded. Without a usable local voice, replies remain text. This browser flag is not proof of network isolation.

## Typed-input measurements

These recorded results used **typed input**. They do not measure human speech or establish speed or reliability for another run.

| Task | Recorded result | Input |
|---|---|---|
| Spark reads a sketch | 4 to 6 s | typed input |
| Muse Image draws back | about 9 s | typed input |
| Crew builds parts | 6 of 6 in 11.3 s, with 1 repaired | typed input |

## Samples and simulated work

`./run.sh sample` opens prepared thoughts with saved images and example deadlines. It needs no key or mic. `./run.sh sample founder` opens another prepared map. Each start restores the fixture and retains a backup. See the [run instructions](../README.md#run-it).

`node scripts/demo.mjs scripts/story-talk.jsonl` sends scripted typed input to a running app and makes live model calls. It is not a human microphone test.

Work spine and Remote can show simulated jobs. `node scripts/demo-jobs.mjs` supplies that demo feed to a running app. It makes no bookings or payments. Separate coding helpers default to dry-run proposals and need explicit configuration before generating edits. They do not automatically merge those edits into the application repository.

Code: [sample.rs](../core/src/sample.rs), [sample launcher](../scripts/start.mjs), [demo feed](../scripts/demo-jobs.mjs), [coding helpers](../core/src/helpers/coding.rs).

## New work and known limits

The idea and design preceded the Meta x Cerebral Valley hackathon. The application code in this repository was written for the event. It includes the board, speech, sketch exchange, word questions, Crew, reuse, feature recovery and source inspection. Third-party dependencies are listed in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

- Live model features need a working Meta key and network access. The keyless sample cannot demonstrate live generation.
- Model answers can be wrong. Crew's block checks cover structure, not whether the result fulfills the person's intent.
- Speech is configured for English. Names and unusual words may be misheard. Human microphone, interruption and shared-room behavior still need validation.
- Hosted guest entry and the served build remain unverified.
- Source builds require the tools listed in the README. Linux and Windows are not validated here.
- Local maps use an append-only journal. The journal has no compaction. A shared microphone setup can capture the same speaker more than once.
- Some connectors depend on macOS and explicit configuration. Review external actions before approving them.

[Commands](COMMANDS.md) · [Architecture and parts](ARCHITECTURE.md) · [Configuration](configuration.md) · [Storage](storage.md)
