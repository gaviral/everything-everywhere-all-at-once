# Populated variants

Isolated synthetic candidate reading and comparison for the existing director. This module supplies no candidate selection, final-story decision, action execution, model call, microphone access or app-shell wiring.

## Host boundary

Exports: `PopulatedVariants`, `populatedVariantsFeature`, and the typed `PopulatedVariantsAdapter`. The switch ID is `intake1417-populated-variants`, switchable and **off by default**. The host owns switch persistence; preserve the descriptor's fresh-profile default.

Pass a stable adapter and `enabled` to the component. While off it does not read candidates/preferences or subscribe. Enabling reads the current snapshot and owns at most one injected subscription; disabling unmounts it and invokes only its returned cleanup. Do not create subscriptions outside this boundary. Scope the injected preference store to the relevant profile/project. The browser store helper is optional; the host may supply its existing synchronous store.

Map the existing demo-parts owner's candidates into `Candidate`: stable part ID, title/meaning, ordered step descriptors, supplied proof, review priority, film selection and support. No cross-lane imports or canonical schema changes are required. Provide the full inventory. Priority changes order only; it never discards later candidates. Duplicate/empty IDs produce visible input feedback rather than ambiguous selections. Adapter changes should remount the enabled boundary; keep the same preferences store when retaining choices.

CandidateInput validates stable identity and prioritizes the full input. ExamplePopulation turns descriptors into a small labeled illustrative sample. PresentationVariant renders one of two local layouts from identical content. VariantComparison keeps both alternatives, opens detail and restores focus on return. ReviewCoverage separately renders review, film selection, support/not-shown and proof. Saved choices and iteration history are keyed by part ID; choosing a version does not mark a candidate reviewed or create demonstration evidence. Review is an explicit reversible action.

Storage failures show a visit-only warning; failed storage cannot promise persistence beyond that visit. Empty input and invalid IDs have visible states. No supplied proof is inferred from visual polish or review status.

## Scoped preview and check

With the existing UI dependencies available, serve the UI with Vite on an allocated non-reserved loopback port and open `/src/intake1417/populated-variants/preview.html`. This standalone entry starts off, uses only invented garden/repair-café content and injects an in-memory candidate adapter plus local preferences. Its instrumentation is preview-only.

Run `node scripts/intake1417-populated-variants-check.mjs` from the worktree. It starts its own ephemeral Vite server and headless browser, checks the visible journey and retains temporary screenshots/profile/cache for inspection. It stops only its own recorded browser PID and closes its own server. It does not require a core process or runtime model.

## Delivery and evidence

Branch: `intake1417-populated-variants`. Starting revision: `8460e58ba9cc539682e21e07ba8f282b2346d34c` (dev). That commit has type `commit`; its ancestry check against main exited 1. It is refused as main-delivery evidence.

Pinned main snapshot: tree `5d077daca802c43913a2fc1ee10895d8aa8a2da0`. Separately verified main commit: `1af6ef1351f6225e20faf39983d9cdecfd157591`, type `commit`, ancestry exit 0. The package manifest evidence confirms existing React/Vite/TypeScript dependencies. `ui/src/intake1411/demo-parts/index.tsx` is MISSING from the pinned main snapshot: the real demo-parts contract remains an evidence gap. No current worktree content substitutes for that missing committed evidence.

Owned submission paths are this directory and `scripts/intake1417-populated-variants-check.mjs`. Shared source, manifests, lockfiles, schemas, catalog and global styles are untouched. The temporary dependency link is verification setup only.

[private build note removed]

Validation: initial branch preflight passed all 10 checks. Final-source `tsc --noEmit` passed. The prescribed lane-worktree recheck completed with `PASS intake1417-populated-variants-check` (exit 0), including its UI/core build prerequisites. Its UI build preceded the behavior-preserving part split; the final-source TypeScript and source-served browser checks cover the final modules. No full app gate was run by this lane.

The first focused attempt and its diagnostic replay stayed off: no browser errors, candidate reads or subscriptions. Classified STALE test input: Enter lacked its carriage-return character. The input helper was corrected without weakening assertions. The recheck then passed shared visible content, both candidates, stable-ID choices/reordering, choice history, detail/Escape/return focus, natural Tab order and focus outline, explicit reversible review, independent film/support/proof states, off/on and reload persistence, 390/320px layouts, 200% root text, denied-save feedback, empty/duplicate input and recovery. No final browser exceptions were reported.

Inspected the four retained screenshots: desktop, 390px, 320px and 320px with enlarged text. Content wraps, alternatives remain readable, coverage labels remain distinct and controls stay reachable without horizontal overflow. Enlarged text uses a long scrolling layout. Temporary artifacts are retained outside submission files; no check-owned browser/server processes remain. Owned-file privacy and whitespace inspection passed.

Handoff recorded: 2026-11-04 14:50 BC

## Interaction decisions

Two plausible layouts were considered: replacing one presentation at a time, or showing both together. The comparison uses both at once on wide screens and stacks them on narrow screens, so the content is directly comparable and neither alternative disappears after a choice. Detail is a separate reading state with an explicit return action and Escape support.

Separate structure, restraint, control and interaction review passes kept stable part identity across visits/reordering, explicit text for proof and coverage, one reversible review action, visible keyboard focus and wrapping local layouts. These are implementation-lane review passes, not independent model or human reviews. Rendered-browser results and screenshot inspection remain the deciding evidence for the synthetic preview.
