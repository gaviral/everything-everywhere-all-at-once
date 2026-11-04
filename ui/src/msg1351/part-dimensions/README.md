# Part dimensions

Read-only React export: `PartDimensions`, `PartDimensionsControl`, and
`partDimensionsFeature` (`defaultEnabled: false`). No host imports or registry edits.

Supply the existing code-canvas `Snapshot.parts` as `graph`. The host supplies a
`Presentation`: ordered steps with UI, functionality and data trees containing
only `{ id, version }` references and children. This is presentation topology,
not a second catalog. Names, locations and version scopes resolve exclusively
against the supplied canonical snapshot. Missing, duplicate or mismatched
identities show an unavailable contributor; no fallback identities are invented.
The canonical version counts file history; it is not a unique Git revision.

The host owns the controlled `enabled` boolean and `onEnabledChange(boolean)`.
Omitting `enabled` renders `fallback` unchanged. Keep the component mounted when
switching it off to retain step, dimension, selected part and subtree expansion
on return. Place the optional control in the host's settings surface. No browser
storage, network requests, mutations, model calls, microphone or audio are used.
Scope retained choices to this mounted presentation visit; a reload starts fresh.

`presentation.version` versions order/topology separately from part identity.
Step IDs must be unique and stable within a presentation. Expansion belongs to
the presentation version, step, dimension and node position; bump the presentation
version when topology changes. Selection matches both canonical ID and version.
Selecting a contributor highlights every visible occurrence and every demo step
using that same reference. Dimension buttons filter trees without clearing choices.

The host has no demo-step-to-part annotation contract yet. Bind real steps and
canonical references in the later host integration; this lane exports the view
and a synthetic scoped preview, not a live demo mapping. Do not infer dimensions
from tags or infer contributor relationships from source call order.

Run `node scripts/msg1351-part-dimensions-check.mjs` for the scoped browser check.
Run it with `--preview` for an ephemeral loopback preview URL (Ctrl-C stops its
owned server). Preview data is synthetic and isolated from production exports.
