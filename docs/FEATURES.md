# From a thought to something you can use

E2A2O brings conversation, sketches and reusable board parts into one place. Start with a [populated sample](../README.md#run-it), then enable the tools you want in **Features** (`C`).

## Say it

Speak or type a thought. Muse Voice Transcribe turns speech into words; Muse Spark places thoughts under topics. To revisit a point's original words, Tab to it and press Enter. Move a point or undo a change. Ask “where was I?” to return to the unfinished topic, search the board, or ask “what did I decide?” for a recap linked to topics.

[Speech](../core/src/asr.rs) · [Placement](../core/src/placer.rs) · [Return to a topic](../core/src/spoken.rs) · [Recap](../core/src/recap.rs)

## Question a word

Enable **Ask about words**. Spark picks a word or phrase from your sentence and asks a question when you pause. The app underlines that occurrence. Answer with your next thought to attach an annotation, or choose **Got it** to dismiss the question.

[Word questions](../core/src/clarify.rs) · [Question and answer flow](../ui/src/bricks/clarify/index.tsx) · [Word anchors](../ui/src/bricks/clarify/marking.ts)

## Draw the idea

Enable **Draw**, sketch on the sheet and label the parts. Spark reads the drawing alongside your words, returning named parts and connections. Ask Muse Image to draw it back, or hand the idea to Crew.

[Sketch interpretation](../core/src/draw.rs) · [Drawing sheet](../ui/src/bricks/draw/index.tsx)

## Build with Crew

Describe what to build in **Crew**, or say “build all that” after describing it on the board. Spark plans small parts and their dependencies. Independent parts build together; dependent parts wait.

Each run creates a Git repository, with a branch for each board component. Components use text, time-left displays, checklists, counters, notes, completion labels and questions. Crew checks the title and block fields, asks Spark to repair rejected parts and turns off parts that still fail. Accepted parts merge through `dev`, `staging` and `main`. Finished specifications enter a library for later plans to reuse.

[Planning and Git workflow](../core/src/crew.rs) · [Crew panel](../ui/src/bricks/crew/index.tsx) · [Board blocks](../ui/src/bricks/crew/kit.tsx)

## Follow the parts

Open **Parts** to explore source files, functions and Git history from the local checkout. Features have individual rendering error boundaries. The recovery panel records rendering errors and lets you retry the affected feature.

[Source view](../core/src/code_canvas.rs) · [Source parts](../core/src/code_canvas/parts.rs) · [Feature boundary](../ui/src/bricks/self-heal/Boundary.tsx) · [Recovery log](../ui/src/bricks/self-heal/RecoveryLog.tsx)

## Pictures and small apps

Open **Features**, switch on **Pictures**, then choose **Show**. Muse Image draws pictures as topics settle. The sample maps include saved pictures.

Ask to make an app from a watcher, an optional prompt and an output such as a card. In **Apps**, switch on **Argument resolver** or **Volume watcher** to use them; both start off. Configure connectors in [configuration](configuration.md).

[Topic pictures](../core/src/pictures.rs) · [App composition](../core/src/apps.rs) · [App blocks](../core/src/app_blocks/mod.rs)

## Built from named parts

The React and TypeScript board connects to a Rust core. The core holds the API key and sends model requests to Meta. Speech uses Muse Voice Transcribe, reasoning uses Muse Spark, and pictures use Muse Image. See the [models table](../README.md#powered-by-meta-models) for the feature-to-model mapping.

[Model requests](../core/src/model.rs) · [Architecture and parts](ARCHITECTURE.md) · [Run it](../README.md#run-it) · [Commands](COMMANDS.md) · [Storage](storage.md)
