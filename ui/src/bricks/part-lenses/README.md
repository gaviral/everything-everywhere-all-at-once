# Part lenses

An optional **view**, off by default. Enable **Part lenses** in Features and choose
it in the view switch. Opens with **Example · a conversation map**; the example's
descriptions and class model are illustrative, not extracted source declarations.
Choose a part in the tree or a smaller-part card, then switch between plain
language, a developer diagram and a founder pitch. Breadcrumbs return to larger
parts. The host's plugin state retains the part and lens during a map visit.

`PartLenses({ data })` also accepts a supplied `PartTree`: `graph`, `tree`, `label`
and optional `explanations`. The graph and contribution types, plus canonical
identity resolution, are imported from `msg1351/part-dimensions`. Nothing in that
module is edited. Explanation keys are `id@version`; topology comes only from
the supplied contribution tree. Missing, ambiguous or changed revisions have no
invented explanation. Without authored prose, only known composition is described;
without an authored class model, no inheritance is inferred. Cycles stop visibly.

The default brick uses an example because the current host contract supplies no
canonical part tree. There is no live source binding, fetch, model call, microphone
access or map mutation. All styles are scoped and supplied through the brick's
`styles` export. Everything lives in this feature folder.

Focused check (builds only this preview, never the app):

```sh
node ui/src/bricks/part-lenses/check.mjs
```

Uses an isolated headless browser on port 4381, then closes its own page and server.
Includes scoped TypeScript, production bundling, visible interactions, supplied
data edge cases and narrow layouts. Screenshots remain in the printed temporary
artifact directory. `preview.html` / `preview.tsx` are a standalone synthetic
harness, not a runtime dependency.
