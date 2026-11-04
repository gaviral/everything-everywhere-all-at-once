# Train gate repair — 2026-11-04

Decisions:
- Preserve all feature code and behavior; the only runtime-source edit clarifies a comment.
- Keep Full content's React Flow wrapper styling. The CSS check recognizes the library-owned class only while React Flow is rendered in source.
- Catalog Inspect here and Full content actions, and track Find's capture-phase blur handler without reverting its focus behavior.
- Supply detached tool hosts in the server-render fixture and the sample-seeding helper in the launch fixture.
- Stub the separately tested tree boundary only inside the release-safety fixture that isolates strict UI selection.
- Declare the projection check's browser dependency directly so offline precheck defers it; preserve its pure assertions and successor session checks.
- List the five missing modules in the architecture inventory.

Verification:
- Passed: release-safety-test.py (9 tests), css-check.mjs, feedback-check.mjs, map-render-check.mjs, readme-check.mjs, spine-conversation-projection-check.mjs, start-check.mjs.
- Projection included the real session browser assertions: stable cards and anchor, persistence, reduced motion, phone layout and feature-off restoration.
- Passed: UI build (TypeScript and both Vite outputs); Vite retained its bundle-size warning.
- Passed: exact precheck selection function in offline, page-only and all modes; scoped wording guard; final whitespace diff check.
- Full precheck and the broader merge gate were not rerun. No commit or push.
