# Decision history

Enable **Decision history** in Features and open its view. It starts off.
An empty map opens a clearly labelled, interactive fictional example. **Your map**
uses placed source words from the connected map.

**Record a decision** captures the question, chosen outcome, explicit condition,
reason, source words, speaker, source time and the topic's current source turns.
The person confirms that this is a chosen outcome. Discussion, suggestions and
review never automatically become decisions. **Review a question** saves the
question and review notes separately, with the same source context. Recording a
decision from a review leaves the review intact and links to the decision.

**Supersede with a new decision** creates a new record with a new source and reason.
The previous record keeps all its fields and gains a visible “Superseded by” link.
Current decisions show the latest choice; Decision history shows both sides of a
reversal, with links that reveal and focus the related record. Source jumps return
to the selected section within the same map/participant visit. Switching maps
starts a fresh selection.

This is a browser notebook, scoped to the confirmed map identity and participant.
It survives reloads in that browser and is separate from the shared Recap; it does
not claim to update the core's Recap or sync decisions to another device. No model,
microphone or map mutation is needed. Each saved record captures its source context
once. Changed/missing source words retain the captured excerpt and disable the
exact-source jump. A source changed during editing must be selected again before
saving. Unknown saved formats and storage failures pause saving, with a visible
explanation. Cross-tab updates refresh the notebook; stale writes are refused.

Run `node ui/src/bricks/decision-history/check.mjs` from the repository root.
The focused check compiles this feature's TypeScript, builds its isolated production
preview and exercises it in headless Chrome. It uses a synthetic host and keeps
screenshots and its temporary browser profile. It does not exercise the live core
or measure readability on a physical TV.
