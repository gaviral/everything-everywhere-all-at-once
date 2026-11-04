# Historical synthetic model report

**Historical synthetic report, not final-build validation.** This page carries the aggregate previously documented for one synthetic take dated 2026-11-02, attributed to historical revision `bd04356`. That revision is not an ancestor of verified main; its run and recorder are not independently revalidated here. Counts and timings below are carried documentation, not current performance, human trials or proof of final-film behavior. Raw prompts, answers and transcript excerpts are omitted.

## Every call in the run

Reported configuration: Muse Voice Transcribe 1.0 for audio; Muse Spark 1.3 and 1.2 racing for placement; Muse Spark 1.3 for refinement, app creation and Recap; Muse Image 1.0 for pictures. The slower placing call was reported as dropped and excluded from timings.

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

## Heard

Reported Voice turns heard: 12 through `muse-voice-transcribe-1.0`, using synthesized speech through Chrome's microphone path. No current human microphone result.

## Placer

Reported `muse-spark-1.2`: 8 calls, 5 dropped; `muse-spark-1.3`: 8 calls, 3 dropped. Placements: 8. The original report gives words-to-map median 2.8 s and slowest 3.4 s (n = 8); neither is a current speed promise.

## Refiner

Reported `muse-spark-1.3`: 3 refiner calls. Current proposals and approvals must be checked on the chosen build.

## Composer

Reported `muse-spark-1.3`: 1 app-search call and 1 app-creation call. This proves no audible tune or real-mic threshold. The Argument resolver, a seeded app, starts off; Volume watcher also starts off until enabled in Apps.

## Recap

Reported `muse-spark-1.3`: 10 recap-draft calls. A cached draft and a newly generated answer have different waiting times; this report does not measure the current ask path.

## Pictures

Reported `muse-image-1.0`: 4 calls. Pictures saved: 4. Public sample pictures are pre-generated fixtures, separate from a live generation receipt.

## Rules

“Where was I?” uses core rules without a model call. The historical aggregate contains no independent timing for that rule. Tune audibility and human microphone calibration remain pending; the README story omits that beat.

## Make a new receipt

With your own Meta key, `E2A2O_TRACE=1 ./run.sh demo` records model inputs and answers in the external map. Set `MAP` to the directory printed by `e2a2o-core --data-path demo`, then use `node scripts/trace-summary.mjs "$MAP/trace.jsonl"` and `node scripts/where.mjs "$MAP"`. Keep raw traces private; publish reviewed aggregates only. This command recipe has not been run as part of this documentation repair.

See [prototype evidence scope](release-evidence.md) for current checks and remaining film/hosted evidence.
