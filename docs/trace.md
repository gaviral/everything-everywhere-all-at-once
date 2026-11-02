# The trace: which Meta model did what

Every model call from one run of the demo talk, as the core traced it. Nothing here was written by hand except the headings and the sentences between them; the lines are shortened by `scripts/trace-summary.mjs`, never edited.

- **The run:** 2026-11-01, app commit 5c64c94, `./run.sh demo` with `E2A2O_TRACE=1`. The talk (13 lines, about 2.5 minutes) was spoken by a synthesized voice (macOS `say`) into headless Chrome's mic, so every line went through the real speech path: the page streams the mic to the core, the core to Muse Voice Transcribe.
- **Shortened:** what was sent becomes its size and the last message's first 240 characters, and an answer keeps its first 240. The full prompts carry the whole map, so they stay out. The trace never holds the key or any request header (core/src/trace.rs).
- **Make your own:** with a key, `E2A2O_TRACE=1 ./run.sh demo`, talk or play `node scripts/demo.mjs scripts/demo-talk-v4.jsonl`, then `node scripts/trace-summary.mjs data/demo/trace.jsonl --excerpt`. `node scripts/where.mjs data/demo` shows where each thought went and why.

## Every call in the run

| Feature | Model | Calls | Median | Slowest |
|---|---|---|---|---|
| placer | muse-spark-1.2-contributor | 9 | 2.6 s | 3.4 s |
| picture | muse-image-1.0 | 7 | 20.6 s | 22.9 s |
| refiner | muse-spark-1.3 | 2 | 16.6 s | 16.7 s |
| app prompt | muse-spark-1.3 | 2 | 4.8 s | 5.7 s |
| search-first | muse-spark-1.3 | 1 | 2.1 s | 2.1 s |
| composer | muse-spark-1.3 | 1 | 4.7 s | 4.7 s |
| recap | muse-spark-1.3 | 1 | 5.2 s | 5.2 s |

Voice turns heard: 13. Placements: 9. Pictures saved: 7.

One run (n = 1 per feature row); the times are for this run, not a benchmark. A refiner pass reads the whole map, and Muse Image draws at about 20 s a picture; both run only while you're quiet, so neither holds up a thought.

## Heard

Muse Voice Transcribe 1.0 (`muse-voice-transcribe-1.0`, core/src/asr.rs) turns the mic's audio into words live, and ends a turn where you stop. Each finished turn is one `heard` line: the words as heard (`raw`) and as kept.

```json
{"kept":"Okay, rent is due Friday and I still haven't sent it.","kind":"heard","raw":"okay, rent is due Friday and I still haven't sent it.","speaker":"you"}
```

## Placer

Muse Spark 1.2 puts each finished turn on a thread (this run opted into Contributor mode; the default is without it). This run predates placing's race of Spark 1.3 and 1.2, so it shows Spark 1.2 only; Spark 1.3's placing calls wait for a new run. Here “My biggest problem is that I never finish my” starts a thread and is marked unfinished (`"complete":false`):

```json
{"feature":"placer","model":"muse-spark-1.2-contributor","ms":2580,"sent":{"messages":2,"characters":3292,"last":"Threads:\nT1: Rent Due Friday [open] last: Rent is due Friday and I haven't sent it\nT2: Mom's Birthday Pottery Class [open] last: Mom's birthday is Saturday wants pottery class\nT3: Pottery Class Cost [open] last: If under $80, I'm booking it…"},"answer":"{\"action\":\"new\",\"assumed\":\"\",\"complete\":false,\"dropped\":[],\"guess\":\"\",\"joins\":\"none\",\"parent_id\":\"\",\"point\":\"My biggest problem is that I never finish my\",\"split\":\"\",\"sure\":true,\"thread_id\":\"T6\",\"title\":\"Not Finishing Things\",\"unclear\":\"\",\"…","usage":{"completion_tokens":359,"completion_tokens_details":{"reasoning_tokens":282},"prompt_tokens":813,"prompt_tokens_details":{"cached_tokens":625},"total_tokens":1172}}
```

After “Wait, where was I?”, the next turn finishes it: the answer joins it to the unfinished words (`"joins":"unfinished"`) on the same thread.

```json
{"feature":"placer","model":"muse-spark-1.2-contributor","ms":3259,"sent":{"messages":2,"characters":3529,"last":"Threads:\nT1: Rent Due Friday [open] last: Rent is due Friday and I haven't sent it\nT2: Mom's Birthday Pottery Class [open] last: Mom's birthday is Saturday wants pottery class\nT3: Pottery Class Cost [open] last: If under $80, I'm booking it…"},"answer":"{\"action\":\"continue\",\"assumed\":\"\",\"complete\":true,\"dropped\":[],\"guess\":\"\",\"joins\":\"unfinished\",\"parent_id\":\"\",\"point\":\"My biggest problem is I never finish my sentences\",\"split\":\"\",\"sure\":true,\"thread_id\":\"T6\",\"title\":\"\",\"unclear\":\"\",\"why\":…","usage":{"completion_tokens":603,"completion_tokens_details":{"reasoning_tokens":525},"prompt_tokens":873,"prompt_tokens_details":{"cached_tokens":753},"total_tokens":1476}}
```

## Refiner

Muse Spark 1.3 reads the map at a pause: it proposes reminders and events with their dates, a next step per thread, tags, and renames or merges (the sure ones land with Undo; the rest wait on the card).

```json
{"feature":"refiner","model":"muse-spark-1.3","ms":16481,"sent":{"messages":2,"characters":2238,"last":"Today is 2026-11-01 (Sunday).\nQuiet threads (title, parent, last point):\n\nRecently active threads, with their latest points:\nT1: Rent Due Friday (parent: none)\n  - Okay, rent is due Friday and I still haven't sent it.\nT2: Mom's Birthday Pot…"},"answer":"{\"actions\": [{\"kind\": \"reminder\", \"thread_id\": \"T1\", \"title\": \"Send rent\", \"when\": \"2026-11-06\"}, {\"kind\": \"event\", \"thread_id\": \"T2\", \"title\": \"Mom's birthday\", \"when\": \"2026-11-07\"}, {\"kind\": \"reminder\", \"thread_id\": \"T3\", \"title\": \"Book …","usage":{"completion_tokens":2987,"completion_tokens_details":{"reasoning_tokens":2589},"prompt_tokens":902,"prompt_tokens_details":{"cached_tokens":0},"total_tokens":3889}}
```

## Composer

“Make an app that plays a silly tune if we get loud.” Muse Spark 1.3 first looks for an app that already does it (Search-first), then composes one from the registered blocks: a volume watcher and a sound. The kept app's watcher, not a model, decides when the tune plays (see [Rules](#rules)). The Argument resolver, a seeded app, starts off; once switched on in Apps, it runs its own prompt on new thoughts and stays quiet unless it notices something.

```json
{"feature":"search-first","model":"muse-spark-1.3","ms":2140,"sent":{"messages":2,"characters":758,"last":"Request: plays a silly tune if we get loud.\nExisting apps: [{\"id\":\"app-argument\",\"name\":\"Argument resolver\",\"publishers\":[{\"kind\":\"card\",\"text\":\"{text}\"}],\"purpose\":\"Gently notice a repeated point or a common reasoning fallacy.\",\"watcher\":{…"},"answer":"{\"match_id\":\"\",\"text\":\"No existing app plays a silly tune in response to loudness.\"}","usage":{"completion_tokens":320,"completion_tokens_details":{"reasoning_tokens":291},"prompt_tokens":232,"prompt_tokens_details":{"cached_tokens":0},"total_tokens":552}}
```

```json
{"feature":"composer","model":"muse-spark-1.3","ms":4650,"sent":{"messages":2,"characters":3554,"last":"Local time is 2026-11-01 19:18:40 -0800 (Sunday) PST. Existing apps: [{\"id\":\"app-argument\",\"name\":\"Argument resolver\",\"publishers\":[{\"kind\":\"card\",\"text\":\"{text}\"}],\"purpose\":\"Gently notice a repeated point or a common reasoning fallacy.\",\"…"},"answer":"{\"app\": {\"cooldown_secs\": 60, \"name\": \"Loud silly tune\", \"prompt\": null, \"publishers\": [{\"kind\": \"sound\"}], \"purpose\": \"Play a silly tune when voices get loud.\", \"watcher\": {\"kind\": \"volume\", \"level\": 0.087, \"seconds\": 3}}, \"cannot\": \"\", \"i…","usage":{"completion_tokens":871,"completion_tokens_details":{"reasoning_tokens":776},"prompt_tokens":1323,"prompt_tokens_details":{"cached_tokens":0},"total_tokens":2194}}
```

```json
{"feature":"app prompt","model":"muse-spark-1.3","ms":5655,"sent":{"messages":2,"characters":729,"last":"Topic: Not Finishing Things\nRecent thoughts (oldest first):\nMy biggest problem is that I never finish my\nNewest: Sentences, I never finish my sentences."},"answer":"{\"publish\": false, \"text\": \"No issues noticed, just following your thoughts along.\", \"when\": \"\"}","usage":{"completion_tokens":1011,"completion_tokens_details":{"reasoning_tokens":978},"prompt_tokens":215,"prompt_tokens_details":{"cached_tokens":0},"total_tokens":1226}}
```

## Recap

“What did I decide today?” Muse Spark 1.3 gets today's thoughts in the speaker's words and answers decisions, plans, open questions and what you worked on, each linked to its thread.

```json
{"feature":"recap","model":"muse-spark-1.3","ms":5232,"sent":{"messages":2,"characters":3540,"last":"{\"period\":\"today\",\"since_ms\":1793516400000,\"threads\":[{\"thread_id\":\"T2\",\"title\":\"Mom's Birthday Pottery Class\",\"touched_ms\":1793589533359,\"unfinished\":false,\"clipped\":false,\"points\":[\"you: Mom's birthday is Saturday she keeps talking about …"},"answer":"{\"decisions\": [{\"text\": \"Study with Priya on Wednesday night\", \"thread_id\": \"T5\"}, {\"text\": \"Book pottery class tonight if under $80\", \"thread_id\": \"T3\"}], \"plans\": [], \"questions\": [], \"summary\": \"You touched on Mom's Birthday Pottery Clas…","usage":{"completion_tokens":1362,"completion_tokens_details":{"reasoning_tokens":1126},"prompt_tokens":1195,"prompt_tokens_details":{"cached_tokens":0},"total_tokens":2557}}
```

## Pictures

Muse Image 1.0 draws one picture per thread once it has settled; the core saves it and serves a small copy for the map.

```json
{"feature":"picture","model":"muse-image-1.0","ms":20646,"sent":{"messages":1,"characters":1238,"last":"A picture that stands for the topic at a glance: the single most recognizable everyday object for it (for example an umbrella for a worry about the weather, a passport for a trip), alone. A twist only in material or scale, never one that hi…"},"answer":{"images":1},"usage":{"input_tokens":28566,"output_tokens":2267,"total_tokens":30833}}
```

```json
{"kind":"picture","saved":"T1-cf3b91db53924a1ea63c3b1aba2bf036.webp","shown":"/images/T1-cf3b91db53924a1ea63c3b1aba2bf036-small.webp","thread":"T1"}
```

## Rules

Some things the app does look smart but are rules, with no model call:

- “Wait, where was I?” acted 0.4 s after the speech ended (the take's timings), and no `call` line in the trace belongs to it: the next line written is the following turn's `heard`, 6.6 s later.
- “Palace.” is the last line of the trace: the view switched with no call.
- The tune: the app's volume watcher compares each 320 ms loudness reading with its level (core/src/apps.rs); the tune played 3.3 s after the loud line began, with no call.
- Commands such as “new thread about …”, “add milk to the shopping list” and “stop listening” are rules too (core/src/spoken.rs, core/src/catalog.rs).

```json
{"kept":"Wait, where was I?","kind":"heard","raw":"Wait, where was I?","speaker":"you"}
```
