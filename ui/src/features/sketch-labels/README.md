# Sketch labels

An isolated annotation feature over injected drawing/session and annotation-storage adapters. `index.ts` exports the descriptor, controller, React surface and adapter types. The switch is `intake1411-sketch-labels`, off by default. Construction performs no adapter work. Disabling unsubscribes, ignores queued callbacks and blocks edits while retaining the drawing, saved annotations and in-memory undo history.

## Parts

`StrokeIdentity` copies and validates stable mark identities and ordered point timestamps. `LassoSelection` selects only fully enclosed whole marks, with exact-ID checkboxes as the keyboard alternative. `HighlightRegion` creates a separate rectangular target. `ReferenceAnchor` retains stroke and supplied reference spans independently, including unknown reference time. `LabelEditor` atomically saves reversible add, revise and remove operations. `AnnotationView` projects each canonical annotation identity into the drawing markers and the label list.

The React surface composes selection tools, drawing display, an inline annotation editor and the saved-label list. Changing labels and references preserves the annotation ID. Undo restores previous wording and reference times; undoing all additions leaves the original drawing intact. An empty lasso remains unresolved. Missing saved mark IDs are displayed as unresolved and are never reassigned.

## Host integration contract

Create one controller per workspace lifetime with `sketchLabelsFeature.create(adapters)`. Render `<SketchLabels controller={controller} />`, call `setEnabled` from the host's feature preference, and call `dispose()` when closing the workspace. The local enable control uses the same controller. The host must synchronize its preference if it also provides a switch.

The stroke adapter supplies stable session IDs, stable mark IDs, finite coordinates and non-negative millisecond point timestamps. It supplies a new snapshot through its subscription when the drawing or session changes; current selection is then cleared. Selection never writes to this adapter. The current surface uses a 640 × 340 drawing coordinate space; the host adapter must provide the matching display coordinate mapping. Original point order and source data remain untouched.

The annotation adapter supplies synchronous reads and atomic full replacements scoped to session ID. It must throw without changing saved data on a failed write. The host owns durable storage, schema validation at its boundary and serialization against other writers. Controller snapshots and outgoing storage payloads are independent immutable copies. A session switch reads that session's annotations rather than carrying labels to another drawing. Undo history is local to the controller and resets on external annotation changes or session changes.

References are explicitly supplied, typed or prerecorded. No inference chooses a target or reconciles the two clocks. The interpretation of the relationship between stroke time and utterance time remains open. Highlights have region identity and no invented stroke time.

## Synthetic preview and check

With the existing UI dependencies available, open `src/features/sketch-labels/preview.html` through the UI's Vite server. The preview is isolated and starts disabled; enable it and choose **Draw three sample strokes**. It keeps synthetic drawing/annotations in memory for the current visit. Reload starts a fresh preview; host durability must come from the injected store.

Run `node scripts/feature-checks/sketch-labels-check.mjs` from the app root. The check typechecks the namespace, bundles only its pure parts and preview, and uses a separate headless Chrome profile with an ephemeral loopback server. It retains all temporary artifacts, including screenshots, outside the repository. No core process or audio capture is involved. The check exits nonzero on failed acceptance, or 3 if Chrome is unavailable.
