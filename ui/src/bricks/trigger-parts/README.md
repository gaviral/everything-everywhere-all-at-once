# Trigger parts

An optional view: enable **Trigger parts** in Features. It opens with labelled example dictation and six parts. Nothing starts recording or calls a model on entry.

Each matcher is a separate part: literal phrases ignoring case, a fixed regex for numbered/next-up cues, bounded fuzzy spelling, and AI judgement. Candidates start at punctuation or line boundaries outside quoted speech. The visible trail connects the actual phrase to its matcher and the part it started. Switches recompute the preview immediately. The opening part needs no trigger.

The initial AI judgement is a labelled example tied to the exact example source. **Ask Muse Spark** explicitly requests live judgement from the existing `/flow/run` endpoint (server-pinned to Meta Muse Spark). Editing the source drops prior judgements; in-flight responses cannot replace newer edits. Invalid, partial or failed responses leave the review intact. The AI selects only supplied source candidates.

Use **Dispute this split** to record your reason, or ask Muse Spark to challenge the proposed cuts. Reviews never join automatically. **Join with previous part** preserves the words and **Restore this split** reverses it. This preview stores its draft, switches and review through the host's scoped feature state; it does not execute the spoken actions or publish the parts to the map.

The data parts import the existing dictation-breakdown `Item`, `Review` and Unicode-scalar `SourceSpan` contracts, source coverage check and extraction function. Those shared files are unchanged. `index.tsx` composes the dictation, matcher, started-part and red-team views; styles attach only for this feature's mount.

Focused check, from the repo root:

```sh
node ui/src/bricks/trigger-parts/check/check.mjs
```

It typechecks this entry and imports, builds into a temporary folder, and runs synthetic model responses in its own headless Chrome profile through a debugging pipe. It checks visible switches, review/join/restore, failure and stale replies, original-word coverage, Unicode, quoted cues, phone overflow and zero microphone requests. Screenshots remain in the printed temporary folder. No ports, live models or shared build output are used.
