# Keep my place

Enable **Keep my place** in Features, then choose its view. Read an existing topic or helper result, select source words, fold a source, or leave an unsent draft. **Open original** uses the host's exact-thought navigation. Choose this view again to continue. Refreshing the tab restores the same reading, source scroll anchor, folds, source selection and native draft range.

Topic and thought IDs own reading identity; changing a heading or inserting earlier words does not create a new reading. Each reading has its own draft. Missing sources retain their drafts with a reachable **Draft · source unavailable** entry. Helper results are labelled as history. Restoring a checkpoint never sends a thought, approves a result, or advances the shared read mark.

Incoming source snapshots wait while this view has focus, a pointer interaction or a source selection. Finish the interaction, or use **Updates waiting · show when ready**. This is local presentation deferral; the host continues receiving live map data. The host's existing build-reload policy still owns whole-page refreshes.

Checkpoints use session storage, isolated by confirmed map identity and person. They last through refresh in this tab. An unconfirmed map shows a separate fictional example; an identified empty map supports a draft before its first topic. Unavailable storage shows a warning and keeps changes in memory through navigation. This feature retains its own reader and draft editor; it does not add recovery to other features' forms or the host composer.

Parts: `documents.ts` adapts current sources, `checkpoint.ts` retains local state, `use-reading-updates.ts` holds presentation updates, `SourceReader.tsx` retains source place/selection, and `DraftEditor.tsx` retains native text/range/scroll. `index.tsx` composes them. No shared files or model calls.

Focused check: `node ui/src/bricks/place-drafts/check.mjs`. Passed scoped TypeScript, production bundling and browser assertions for navigation, reload, stable heading identity, folds, native and source selections, scroll anchors after insertion, update deferral, independent helper drafts, missing sources, map/person isolation, empty maps, denied storage and 390/320px layouts. The check uses synthetic content, preserves its temporary browser profile and writes screenshots outside the repo.
