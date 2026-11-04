# Recording-mic volume calibration (pending)

The constants in `core/src/apps.rs` are **stand-ins from synthesized speech**:
normal 0.075, raised 0.1, shout 0.15. Neither this tool nor its synthetic tests
establishes reliable acoustic thresholds. The derived loud/shouting levels remain
0.087/0.122; the loud seed holds for 3 seconds. Compose instructions, seed creation
and the known legacy seed migration use the same scale. Custom saved levels,
durations, enabled state, cooldown and publisher choices are preserved.

Until a real final recording-mic receipt has been reviewed, the final README and
selected film must omit the tune-reliability claim and unmeasured tune beat.
This work does not change the selected film or mark calibration passed.

## Collect privately

1. Use the final recording machine, microphone and browser. Append `?level` to the
   app URL (or enable the existing Level brick). The normal app UI is unchanged.
2. Enable the microphone using its existing user gesture. Opening Level or starting
   calibration never starts microphone capture. Calibration listens only to the
   existing numeric loudness events; it does not access audio or transcripts.
3. Open **Recording-mic calibration**. Enter the build identity (commit plus local
   changes, if any), mic model/input, browser/version, distance in cm, and each
   processing setting. `unknown` declares an unknown setting; it is not a measured
   value. The recording timestamp is UTC. Select actual recording mic or synthetic
   test input honestly; a provenance label cannot authenticate hardware.
4. Click **Start calibration**. Deliberately choose **Normal**, then **Start sample**;
   speak normally for at least 10 seconds and click **Finish sample**. Pause, then
   repeat with **Raised** and **Loud**. Collect several runs per label if practical.
   The current level, chart and five inferred stretches remain available as guides.
   Labelled runs retain every numeric reading, including low syllables and pauses.
5. **Cancel sample** discards the active sample. Lost readings cancel it too. Repeat
   after reconnecting. Changing input, browser processing or distance requires
   **Reset calibration** and a separate receipt, never pooling microphone sources.
6. Click **Finish calibration**. All three labels, at least 10 seconds each, valid
   readings/coverage are required. Separation is assessed by the offline analyzer;
   overlapping voices can still be exported as diagnostic evidence. If validation fails,
   reset and recollect. Then click **Export private JSON** to download locally.
   Save outside the app repository. Export is the only file write; no receipt is
   uploaded, put in browser storage, or added to the journal. Reset/unmount discards
   in-memory data. The existing app microphone path is otherwise unchanged.

Do not put credentials, names, transcripts or private paths in setup fields. Only
share a receipt deliberately and privately. Synthetic input must stay labelled
synthetic even if delivered through a browser fake microphone.

## Version 1 receipt and offline comparison

`schema: "e2a2o.volume-calibration"`, `version: 1`, `origin`, `createdAtUtc`,
`completedAtUtc`, `cadenceMs: 320`, `metadata`, `thresholds`, `runs` form the receipt.
Metadata is `build`, `microphone`, `browser`, `distanceCm`, and `processing` with
`echoCancellation`, `noiseSuppression`, `autoGainControl` (`on`/`off`/`unknown`).
Each run has `label` (`normal`/`raised`/`loud`), `startedAtUtc`, `durationMs`,
`readings: [{atMs, level}]`, median `typical`, and `aboveThresholdStretches` entries
(`threshold`, `startMs`, `durationMs`). Times are relative to that run. Above-threshold
spans run from first to last qualifying reading; they break at any low reading or
missing feed over 1200 ms. They are descriptive, distinct from watcher triggers.

From the app checkout, on Node with native TypeScript stripping:

```
node scripts/volume-calibration-check.mjs
node scripts/volume-calibration-check.mjs /outside-repo/private-receipt.json
node scripts/volume-calibration-check.mjs /outside-repo/private-receipt.json --candidate=0.087,3,30
```

The first command runs labelled synthetic fixtures. File arguments require actual
recording-mic provenance and reject known synthetic/fake-mic metadata. Each file is
analyzed independently; microphones are never pooled. Additional candidate flags
compare level, held seconds and cooldown seconds. Output includes numeric aggregate
summaries and trigger counts, without raw readings or mic/build strings.

Validation rejects missing/extra fields, bad UTC times, overlapping samples,
non-finite or out-of-range levels (valid: 0–1), missing coverage, runs under ten
seconds, labels whose middle halves overlap, and inconsistent derived summaries.
The collection cadence is nominally 320 ms; receipt timestamps retain actual
arrival jitter. A gap over 1200 ms invalidates a continuous calibration sample.

Replay follows the current `feed_volume`/`volume`/`launch` behavior for a prompt-free,
idle app: first loud reading starts a source-local streak; one low reading can be
ridden out, two reset it, and a loud reading more than 1200 ms after the previous
loud one restarts it. At the held duration, reset the streak even if app-wide
cooldown suppresses publication. Separate sources share cooldown, not streaks.
Each labelled run starts a fresh replay; cooldown is tested within runs. This
comparison does not simulate model latency or busy prompt apps.

Passing schema and separation checks only makes a receipt reviewable. A reviewer
must confirm the declared setup is the final recording setup, inspect normal
non-triggers and raised/loud sustained triggers across repeated runs, and assess
false positives and misses. Unknown processing settings limit reproducibility.
No algorithm can establish genuine microphone provenance from numeric JSON alone.

Only after that actual receipt is supplied and reviewed may thresholds change.
Keep the raw receipt private outside the app repo; record aggregate sample count,
date, build and mic evidence, rerun watcher tests, and only then remove the stand-in
marker. Run `node scripts/loud-app-check.mjs`, targeted `cargo test apps::tests` with
isolated temporary data, and `cd ui && npm run build` after any scale change.
