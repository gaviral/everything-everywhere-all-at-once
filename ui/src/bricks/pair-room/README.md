# Pair room

An opt-in view with two speaker lanes and shared topics. Open Features → Pair room → Show,
or the isolated playground at `/bricks.html?brick=pair-room&sample=empty`.

The opening scene is a labelled example of Maya and Leo shipping a payments API. Four
completed turns make the first screen useful. Play conversation continues it word by
word; Replay from start plays all eight turns. Pause preserves the current words.
There is no audio, microphone start, model request, external send or execution.
The two Spark cards show explicitly labelled example questions and code drafts.

Connected room reads completed human turns from the existing brick contract. Select
two developers when there are more than two. Stable speaker identities keep words in
their own lanes. A topic becomes shared only when both selected speakers have contributed
to its exact topic ID; similar wording does not imply a shared topic. Inspect context
shows each developer's own turns plus those shared turns, excluding other people and
the other developer's separate topics. Unsorted turns stay in their speaker's lane.

The present contract has neither diarized partial turns nor a per-speaker Spark request.
Consequently the connected view provides inspectable context packets, not live Spark
calls. The example outputs are scripted, not results from a runtime model. Core capture
and model integration remain with the host; this feature never starts either.

Parts: `context.ts` selects and isolates context; `example.ts` owns the example content;
`use-playback.ts` advances one speaker at a time; `parts.tsx` renders the lanes and shared
column; `index.tsx` composes the view. Styles and the manifest remain in this folder.

Checks (from the repository root):

```sh
npm --prefix ui run build
node scripts/bricks-check.mjs pair-room
node ui/src/bricks/pair-room/check.mjs
```

The focused check exercises source isolation, shared topic identity, completed human
turns, visible example outputs, playback controls, an empty connected room, phone widths
and the absence of microphone requests. It uses a separate headless browser and keeps
its disposable profile. No `preflight.sh` is present in this checkout.
