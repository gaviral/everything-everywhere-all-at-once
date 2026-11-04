# Showroom

Enable Showroom in Features or open `?showroom`. Four large cards show live registry metadata and switches. Try enables the feature, opens its host-owned view when it has one, and leaves a return chip. Returning asks Keep on or Turn off. Left/right and already-active voice words next/back move the selected card; this feature never starts listening.

`baseline-folders.json` is the complete folder list from `git ls-tree -d --name-only 1af6ef13 ui/src/bricks/`. Vite expands the current manifest folders at build time; subtracting this recorded baseline defines New today. Demo candidates is the brief's eight-feature shortlist, also available under New today when newly added. Everything else excludes both groups. Showroom itself is omitted to avoid turning off its own return control.

Parts: catalog discovery/grouping/switches, host view navigation, input navigation, reusable dialog/cards/decision, and the top-level visit controller. No model calls. A bounded MutationObserver waits for the host's Show control because the brick contract has no open-view action; there are no changes to the host. Keyboard focus is contained by native dialogs. Group and selection use the host's plugin visit state.

Focused proof: `node ui/src/bricks/showroom/checks/check.mjs`.
