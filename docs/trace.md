# The trace: which Meta model did what

Every model call from one run of the demo talk, as the core traced it. Nothing here was written by hand except the headings and the sentences between them; the lines are shortened by `scripts/trace-summary.mjs`, never edited.

- **The run:** 2026-11-02, app commit bd04356, one recorded take of the demo talk with `E2A2O_TRACE=1` on the core. The talk (spine A: 12 lines, about 2 minutes) was spoken by a synthesized voice (macOS `say`) into headless Chrome's mic, so every line went through the real speech path: the page streams the mic to the core, the core to Muse Voice Transcribe. The take passed its checks: 14 of 14 beats, words to map median 2.8 s, slowest 3.4 s (n = 8).
- **Shortened:** what was sent becomes its size and the last message's first 240 characters, and an answer keeps its first 240. The full prompts carry the whole map, so they stay out. The trace never holds the key or any request header (core/src/trace.rs).
- **Make your own:** with a key, `E2A2O_TRACE=1 ./run.sh demo`, talk or play `node scripts/demo.mjs scripts/demo-talk-v4.jsonl`, then `node scripts/trace-summary.mjs data/demo/trace.jsonl --excerpt`. `node scripts/where.mjs data/demo` shows where each thought went and why.

## Every call in the run

| Feature | Model | Calls | Median | Slowest |
|---|---|---|---|---|
| placer | muse-spark-1.2 | 8 (5 dropped) | 2.6 s | 3.0 s |
| placer | muse-spark-1.3 | 8 (3 dropped) | 3.0 s | 3.4 s |
| recap draft | muse-spark-1.3 | 10 | 2.3 s | 3.6 s |
| refiner | muse-spark-1.3 | 3 | 10.5 s | 11.9 s |
| picture | muse-image-1.0 | 4 | 17.4 s | 19.9 s |
| app search | muse-spark-1.3 | 1 | 2.3 s | 2.3 s |
| app | muse-spark-1.3 | 1 | 4.2 s | 4.2 s |

Voice turns heard: 12. Placements: 8. Pictures saved: 4.

One run (n = 1 per feature row); the times are for this run, not a benchmark. Placing races two calls, one to Spark 1.3 and one to Spark 1.2; the first good answer wins and the other is dropped unanswered (counted as dropped, kept out of the times). A refiner pass reads the whole map, and Muse Image draws in 10–20 s a picture; both run only while you're quiet, so neither holds up a thought.

## Heard

Muse Voice Transcribe 1.0 (`muse-voice-transcribe-1.0`, core/src/asr.rs) turns the mic's audio into words live, and ends a turn where you stop. Each finished turn is one `heard` line: the words as heard (`raw`) and as kept.

```json
{"at":1793625486953,"kept":"My biggest problem is that I never finish my","kind":"heard","raw":"my biggest problem is that I never finish my","speaker":"you"}
```

## Placer

Muse Spark 1.3 and Muse Spark 1.2 race to put each finished turn on a thread (the default mode, without Contributor). Here Spark 1.2 answered first for “My biggest problem is that I never finish my”: it starts a thread and is marked unfinished (`"complete":false`):

```json
{"feature":"placer","model":"muse-spark-1.2","ms":2616,"sent":{"messages":2,"characters":3087,"last":"Threads:\n(none yet)\nActive thread: (none)\nNEW THOUGHT: \"My biggest problem is that I never finish my\""},"answer":"{\"action\":\"new\",\"assumed\":\"\",\"complete\":false,\"dropped\":[],\"guess\":\"\",\"joins\":\"none\",\"parent_id\":\"\",\"point\":\"I never finish my...\",\"split\":\"\",\"sure\":false,\"thread_id\":\"t1\",\"title\":\"Never Finishing Tasks\",\"unclear\":\"\",\"why\":\"states never fin…","usage":{"completion_tokens":293,"completion_tokens_details":{"reasoning_tokens":220},"prompt_tokens":748,"prompt_tokens_details":{"cached_tokens":0},"total_tokens":1041}}
```

Spark 1.3 answered first for the next turn, about rent: a new thread, and the one left half-said is named in `"dropped"`, so the map marks it.

```json
{"feature":"placer","model":"muse-spark-1.3","ms":3361,"sent":{"messages":2,"characters":3222,"last":"Threads:\nT1: Never Finishing Tasks [open] last: I never finish my...\nActive thread: T1\nSaid just before (placed in T1): \"My biggest problem is that I never finish my\"\nNEW THOUGHT: \"Oh, and rent is due Friday and I still haven't sent it\""},"answer":"{\"action\":\"new\",\"assumed\":\"\",\"complete\":true,\"dropped\":[\"T1\"],\"guess\":\"\",\"joins\":\"none\",\"parent_id\":\"\",\"point\":\"rent is due Friday and I still haven't sent it\",\"split\":\"\",\"sure\":false,\"thread_id\":\"T2\",\"title\":\"Rent Due Friday\",\"unclear\":\"\",…","usage":{"completion_tokens":706,"completion_tokens_details":{"reasoning_tokens":627},"prompt_tokens":962,"prompt_tokens_details":{"cached_tokens":881},"total_tokens":1668}}
```

After “Wait, where was I?”, the next turn finishes it: Spark 1.3's answer joins it to the unfinished words (`"joins":"unfinished"`) on the same thread.

```json
{"feature":"placer","model":"muse-spark-1.3","ms":3153,"sent":{"messages":2,"characters":3394,"last":"Threads:\nT1: Never Finishing Tasks [open] last: I never finish my...\nT2: Rent Due Friday [open] last: rent is due Friday and I still haven't sent it\nActive thread: T1\nNames said: Friday\nSaid just before (placed in T2): \"Oh, and rent is due …"},"answer":"{\"action\":\"continue\",\"assumed\":\"\",\"complete\":true,\"dropped\":[],\"guess\":\"\",\"joins\":\"unfinished\",\"parent_id\":\"\",\"point\":\"My biggest problem is that I never finish my sentences\",\"split\":\"\",\"sure\":true,\"thread_id\":\"T1\",\"title\":\"\",\"unclear\":\"\",\"…","usage":{"completion_tokens":568,"completion_tokens_details":{"reasoning_tokens":492},"prompt_tokens":1007,"prompt_tokens_details":{"cached_tokens":881},"total_tokens":1575}}
```

## Refiner

Muse Spark 1.3 reads the map at a pause: it proposes reminders and events with their dates, a next step per thread, tags, and renames or merges (the sure ones land with Undo; the rest wait on the card).

```json
{"feature":"refiner","model":"muse-spark-1.3","ms":10516,"sent":{"messages":2,"characters":1763,"last":"Today is 2026-11-02 (Monday).\nQuiet threads (title, parent, last point):\n\nRecently active threads, with their latest points:\nT2: Rent Due Friday (parent: none)\n  - Oh, and rent is due Friday and I still haven't sent it\nT1: Never Finishing T…"},"answer":"{\"actions\": [{\"kind\": \"reminder\", \"thread_id\": \"T2\", \"title\": \"Pay rent\", \"when\": \"2026-11-06\"}], \"merges\": [], \"questions\": [], \"retire\": [], \"revise\": [], \"suggestions\": [{\"text\": \"Schedule the payment now to avoid a late fee\", \"thread_id…","usage":{"completion_tokens":1356,"completion_tokens_details":{"reasoning_tokens":1228},"prompt_tokens":1033,"prompt_tokens_details":{"cached_tokens":0},"total_tokens":2389}}
```

## Composer

“Make an app that plays a silly tune if we get loud.” Muse Spark 1.3 first looks for an app that already does it (Search-first, traced as `app search`), then composes one from the registered blocks (traced as `app`): a volume watcher and a sound. The kept app's watcher, not a model, decides when the tune plays (see [Rules](#rules)). The Argument resolver, a seeded app, starts off; once switched on in Apps, it runs its own prompt on new thoughts and stays quiet unless it notices something (it stayed off in this run).

```json
{"feature":"app search","model":"muse-spark-1.3","ms":2321,"sent":{"messages":2,"characters":758,"last":"Request: plays a silly tune if we get loud.\nExisting apps: [{\"id\":\"app-argument\",\"name\":\"Argument resolver\",\"publishers\":[{\"kind\":\"card\",\"text\":\"{text}\"}],\"purpose\":\"Gently notice a repeated point or a common reasoning fallacy.\",\"watcher\":{…"},"answer":"{\"match_id\":\"\",\"text\":\"Neither existing app plays a silly tune when things get loud.\"}","usage":{"completion_tokens":507,"completion_tokens_details":{"reasoning_tokens":479},"prompt_tokens":232,"prompt_tokens_details":{"cached_tokens":0},"total_tokens":739}}
```

```json
{"feature":"app","model":"muse-spark-1.3","ms":4191,"sent":{"messages":2,"characters":3554,"last":"Local time is 2026-11-02 06:19:13 -0700 (Monday) MST. Existing apps: [{\"id\":\"app-argument\",\"name\":\"Argument resolver\",\"publishers\":[{\"kind\":\"card\",\"text\":\"{text}\"}],\"purpose\":\"Gently notice a repeated point or a common reasoning fallacy.\",\"…"},"answer":"{\"app\": {\"cooldown_secs\": 60, \"name\": \"Loud Silly Tune\", \"prompt\": null, \"publishers\": [{\"kind\": \"sound\"}], \"purpose\": \"Play a silly tune when voices get loud.\", \"watcher\": {\"kind\": \"volume\", \"level\": 0.087, \"seconds\": 3}}, \"cannot\": \"\", \"i…","usage":{"completion_tokens":693,"completion_tokens_details":{"reasoning_tokens":597},"prompt_tokens":1323,"prompt_tokens_details":{"cached_tokens":0},"total_tokens":2016}}
```

## Recap

“What did I decide today?” Muse Spark 1.3 gets today's thoughts in the speaker's words and answers decisions, plans, open questions and what you worked on, each linked to its thread. It keeps a draft current as thoughts land (traced as `recap draft`), so asking shows it at once: the Recap was on screen 0.4 s after the question (the take's timings). This is the run's first draft, made after one thought:

```json
{"feature":"recap draft","model":"muse-spark-1.3","ms":2565,"sent":{"messages":2,"characters":1676,"last":"{\"period\":\"today\",\"since_ms\":1793602800000,\"threads\":[{\"thread_id\":\"T1\",\"title\":\"Never Finishing Tasks\",\"touched_ms\":1793625486953,\"unfinished\":true,\"clipped\":false,\"points\":[\"you: My biggest problem is that I never finish my\"]}],\"actions\":…"},"answer":"{\"decisions\": [], \"plans\": [], \"questions\": [], \"summary\": \"You spent today on Never Finishing Tasks.\", \"worked_on\": [{\"text\": \"You mentioned never finishing your tasks.\", \"thread_id\": \"T1\"}]}","usage":{"completion_tokens":394,"completion_tokens_details":{"reasoning_tokens":335},"prompt_tokens":582,"prompt_tokens_details":{"cached_tokens":0},"total_tokens":976}}
```

## Pictures

Muse Image 1.0 draws one picture per thread once it has settled; the core saves it and serves a small copy for the map.

```json
{"feature":"picture","model":"muse-image-1.0","ms":18130,"sent":{"messages":1,"characters":1127,"last":"A picture that stands for the topic at a glance: the single most recognizable everyday object for it (for example an umbrella for a worry about the weather, a passport for a trip), alone. A twist only in material or scale, never one that hi…"},"answer":{"images":1},"usage":{"input_tokens":19564,"output_tokens":2095,"total_tokens":21659}}
```

```json
{"at":1793625520677,"kind":"picture","saved":"T1-d5fe35112ad04575b6ee7c301bdddf80.webp","shown":"/images/T1-d5fe35112ad04575b6ee7c301bdddf80-small.webp","thread":"T1"}
```

## Rules

Some things the app does look smart but are rules, with no model call:

- “Wait, where was I?” acted 0.3 s after the speech ended (the take's timings), and no `call` line in the trace belongs to it: the next line written is a refiner pass that began 5.0 s before the turn was heard (at the pause before it), then the following turn's `heard`, 6.5 s later.
- “Palace.” is the last line of the trace: the view switched with no call.
- The tune: the app's volume watcher compares each 320 ms loudness reading with its level (core/src/apps.rs); the tune played 3.4 s after the loud line began, with no call.
- Commands such as “new thread about …”, “add milk to the shopping list” and “stop listening” are rules too (core/src/spoken.rs, core/src/catalog.rs).

```json
{"at":1793625503314,"kept":"Wait, where was I?","kind":"heard","raw":"wait, where was I?","speaker":"you"}
```
