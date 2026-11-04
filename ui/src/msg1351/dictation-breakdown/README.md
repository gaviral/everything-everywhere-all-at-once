# Dictation breakdown

An isolated transcript review feature. The descriptor in `feature.ts` starts off.
Host imports, registry, catalog, aggregate CSS and Rust registration are intentionally not wired here.

From the repository root, run `ui/node_modules/.bin/vite ui --host 127.0.0.1 --port 4478 --strictPort`.
Open `/src/msg1351/dictation-breakdown/preview.html`, enable the feature, then choose **Propose items**.
This page uses invented text and demo queue homes. It never captures audio.
Run focused acceptance with `node scripts/msg1351-dictation-breakdown-check.mjs`.
The check retains its screenshots, Rust test executable and private browser profile in a temporary directory.

## Integration contract

Mount `DictationBreakdown` with controlled `enabled` / `onEnabledChange`, optional `initialSource`
and caller-supplied `queueHomes`. Keep it mounted when off to retain session work. The host owns
switch persistence. The component imports only its own scoped stylesheet. Source edits or cue
changes take effect on explicit rebuild; Undo restores the prior review. Leaving/reloading loses
session work unless the user copies the workflow export. No local storage is used.

The public engine API is `engine.ts`. `exportWorkflow(review, homes)` returns a deeply frozen
`dictation-breakdown/v1` record. JSON serialization preserves the interface in `contract.ts`:
`schema`, `offsetUnit`, `source`, and `items`. Each item carries `id`, `what`, `why`, `reasonOrigin`,
`kind`, `source`, `reviewedBy`, and `queueProposals`. Source ranges use Unicode scalar offsets,
zero-based with exclusive ends, rather than UTF-16 or byte offsets. All item sources form one
ordered, exact partition of the original source. IDs are source-range identities for this review,
not permanent workflow IDs. Summaries are editable; changing content clears reviewer status.
Split/rejoin rebuild affected summaries from immutable source; Undo restores old corrections.

Rust's `validate_source_spans` checks the same scalar-range invariant without dependencies.
It is not a registered endpoint, JSON decoder, extractor or persistence layer. The host must map
the exported source records into these structs if it adopts this admission validator.

## Honest bounds

Word, phrase, regex and one-edit fuzzy cue parts are independent strategies. Profiles choose
their combinations; manual mode forces no boundaries. Quotes shield cue words, with a small
straight/curly quote parser; unmatched opening quotes conservatively suppress later candidates.
This is a deterministic proposal tool, not a linguistic parser. It can miss ideas and split
related thoughts. Use the source cursor to split missed ideas, rejoin false splits, and edit
what/why/kind. Reasons are explicitly stated, inferred, unspecified or corrected. Manual human
and red-team review labels record user action; no AI reviewer is available or implied.

Queue matching uses a small semantic vocabulary plus caller-provided concepts. Repeated concept
matches are flagged as possible duplicate homes. No design queue is read or written by the feature;
unknown matches stay unresolved for human review. No runtime service, model, microphone,
dependency addition or shared host file is needed.
