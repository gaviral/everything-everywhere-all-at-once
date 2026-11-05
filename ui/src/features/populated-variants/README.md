# Populated variants

Isolated synthetic candidate reading and comparison for the existing director. This module supplies no candidate selection, final-story decision, action execution, model call, microphone access or app-shell wiring.

## Host boundary

Exports: `PopulatedVariants`, `populatedVariantsFeature`, and the typed `PopulatedVariantsAdapter`. The switch ID is `intake1417-populated-variants`, switchable and **off by default**. The host owns switch persistence; preserve the descriptor's fresh-profile default.

Pass a stable adapter and `enabled` to the component. While off it does not read candidates/preferences or subscribe. Enabling reads the current snapshot and owns at most one injected subscription; disabling unmounts it and invokes only its returned cleanup. Do not create subscriptions outside this boundary. Scope the injected preference store to the relevant profile/project. The browser store helper is optional; the host may supply its existing synchronous store.

Map the existing demo-parts owner's candidates into `Candidate`: stable part ID, title/meaning, ordered step descriptors, supplied proof, review priority, film selection and support. No cross-feature imports or canonical schema changes are required. Provide the full inventory. Priority changes order only; it never discards later candidates. Duplicate/empty IDs produce visible input feedback rather than ambiguous selections. Adapter changes should remount the enabled boundary; keep the same preferences store when retaining choices.

CandidateInput validates stable identity and prioritizes the full input. ExamplePopulation turns descriptors into a small labeled illustrative sample. PresentationVariant renders one of two local layouts from identical content. VariantComparison keeps both alternatives, opens detail and restores focus on return. ReviewCoverage separately renders review, film selection, support/not-shown and proof. Saved choices and iteration history are keyed by part ID; choosing a version does not mark a candidate reviewed or create demonstration evidence. Review is an explicit reversible action.

Storage failures show a visit-only warning; failed storage cannot promise persistence beyond that visit. Empty input and invalid IDs have visible states. No supplied proof is inferred from visual polish or review status.

## Scoped preview and check

With the existing UI dependencies available, serve the UI with Vite on an allocated non-reserved loopback port and open `/src/features/populated-variants/preview.html`. This standalone entry starts off, uses only invented garden/repair-café content and injects an in-memory candidate adapter plus local preferences. Its instrumentation is preview-only.

Run `node scripts/populated-variants-check.mjs` from the worktree. It starts its own ephemeral Vite server and headless browser, checks the visible journey and retains temporary screenshots/profile/cache for inspection. It stops only its own recorded browser PID and closes its own server. It does not require a core process or runtime model.

## Delivery and evidence

Owned submission paths are this directory and `scripts/populated-variants-check.mjs`. Shared source, manifests, lockfiles, schemas, catalog and global styles are untouched. The temporary dependency link is verification setup only.

Inspected the four retained screenshots: desktop, 390px, 320px and 320px with enlarged text. Content wraps, alternatives remain readable, coverage labels remain distinct and controls stay reachable without horizontal overflow. Enlarged text uses a long scrolling layout. Temporary artifacts are retained outside submission files; no check-owned browser/server processes remain. Owned-file privacy and whitespace inspection passed.

## Interaction decisions

Two plausible layouts were considered: replacing one presentation at a time, or showing both together. The comparison uses both at once on wide screens and stacks them on narrow screens, so the content is directly comparable and neither alternative disappears after a choice. Detail is a separate reading state with an explicit return action and Escape support.

Separate structure, restraint, control and interaction review passes kept stable part identity across visits/reordering, explicit text for proof and coverage, one reversible review action, visible keyboard focus and wrapping local layouts. These are implementation-lane review passes, not independent model or human reviews. Rendered-browser results and screenshot inspection remain the deciding evidence for the synthetic preview.
