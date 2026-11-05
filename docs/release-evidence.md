# Prototype evidence scope

This page bounds README claims for the hackathon prototype. It is not release or film approval.

## Project provenance

The implementation in this repository was built for the Meta x Cerebral Valley hackathon. The idea and design preceded the event; no application code did. New work includes the board, speech and sketch paths, questions attached to words, Crew's part workflow, reuse, recovery and source inspection.

Author: gaviral. The project's [MIT licence](../LICENSE) covers its own code; dependencies retain their original licences and notices in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

The demo film's narration is a third-party synthetic voice (Deepgram Aura), used for the film only; the app itself calls Meta models only.

## Source snapshot

Reviewed main commit `0e8c0241cc8b02eabe9b8c5417f4f4d526adba77`, tree `1d4ed7f9c2bb2fb58aea155680cb0533b0e7b937`: README, feature documentation and historical trace report. The commit was type-checked and its main ancestry check returned 0. The historical run revision `bd04356` failed that ancestry predicate (exit 1); its documentation aggregate remains explicitly historical and unvalidated. No off-main implementation is described as landed.

This documentation repair starts from train candidate `c529d4ae43b538aaf3a4ce19425a6f24048819cd`. The candidate is not on verified main (ancestry exit 1); its external-storage and setup instructions remain candidate behavior pending landing.

## Focused checks

On 2026-11-04 the focused checks passed on this candidate: README coverage and stale-claim rejection (193 first-screen words, 1 image, 130 source files), local links (22 pages), date claims, static Meta-only integration and staged whitespace. In-memory copies of the pinned main README and train-base README were rejected by the revised guard for their stale sample label and word cap, respectively. The privacy/conflict pattern check found no added home paths, credential values or conflict markers. No live Meta, hosted account, send, microphone or model-spend action is part of this repair.

## Demo boundaries

- The first route is the labelled local keyless SAMPLE fixture. Hosted entry stays explicitly pending until a fresh logged-out guest flow and served-build match are recorded. The [hosted preview](https://e2a2o.aviralgarg.com) returned HTTP 401 at the last recorded link check.
- Work spine and Remote show simulated helper work; there is no claim of real bookings, payments or external helper execution.
- Crew uses real model calls and Git operations, but generates board parts from a fixed set of blocks. Its checks do not establish arbitrary program correctness. The optional `?crewfault` demo deliberately damages a part to show repair.
- The placement summary preserves commitments, conditions, negations and uncertainty, with no fixed 12-word cap.
- The runtime model integration is Meta-only with no GPT dependency. Browser/OS speech, enabled connectors and optional tunnels have separate network behavior. Reply playback uses a browser/OS voice only when it reports `localService === true`; remote and unknown-locality voices are excluded. Without a usable local voice, replies remain text. This browser flag is not proof of network isolation.
- Live placement, sketch reading, image generation and Crew need a working Meta key and network access. Models can misread words, sketches or intent. Speech is configured for English; human microphone and interruption behavior still need validation. The journal grows without compaction.
- Optional connectors need separate setup. The seeded apps Argument resolver and Volume watcher start off until switched on in Apps. Review proposed external actions before approving them.
- The loud-voice/tune beat is omitted from the README story pending human microphone calibration, audible recording evidence and owner choice.
- Final selected build, current live Meta demonstration, final cut/link, media rights and owner approvals remain pending. Historical synthesized input does not establish human performance.
- Sample pictures are public generated fixtures; raw journals, prompts, answers, private paths and owner words do not belong in the submission.

## Recorded typed-input measurements

These observations are retained from the earlier prototype documentation. They are not speed or reliability promises, measurements of someone speaking into a microphone, or validation of the merged build.

| Recorded task | Result | Input |
|---|---|---|
| Spark reads a sketch | 4 to 6 s | typed input |
| Muse Image draws back | about 9 s | typed input |
| Crew builds parts | 6 of 6 in 11.3 s, with 1 repaired | typed input |

## Checks to reproduce

`node scripts/readme-check.mjs`, `node scripts/links-check.mjs`, `node scripts/dates-check.mjs`, and `python3 scripts/model-guards.py meta-only` require no service credentials. They check documentation/model-integration scope, not a full build, browser flow, release or all historical merges.
