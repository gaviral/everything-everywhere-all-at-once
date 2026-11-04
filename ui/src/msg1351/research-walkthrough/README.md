# Research walkthrough

Optional research context for the Canvas, off by default. Static evidence was checked against the authors' publication page on 2026-11-04. The claim concerns Data Mountain, not measured results for this app. No remote content, model, credential, media capture or storage is used. Source links open only on explicit activation. No paper image is copied; `asset: null` deliberately avoids an unlicensed asset.

Import `researchWalkthrough` from `index.tsx`. It exports `id: "research-walkthrough"`, `defaultEnabled: false`, `createController(host)` and `Component`. The component includes its own namespaced style and explicit on/off switch. The host may also call `controller.setEnabled(boolean)`; switching off first restores any active return point, and stays on with a recoverable error if restoration fails. Nothing enables the module implicitly.

The host owns `captureReturnPoint()` and `showFeature("Canvas")`. Capture must save the map/participant visit, view, filter, selection, viewport and focus. Restoration must report false when the saved visit cannot be restored. Feature navigation resolves true only once visible. These callbacks must never activate a microphone. Keep one controller per visit above mount-scoped action wrappers; remounting the panel uses that same controller. Await `resume()` before discarding a visit or controller. No DOM bridge or canonical schema change is required.

With no verified evidence, use `createWalkthrough(host, null)`. Enabling then displays an unavailable state with no Open or feature-navigation action. Film eligibility requires both verified evidence and a working host adapter; a scoped preview alone is insufficient.

The scoped preview uses synthetic Cards and Canvas states to exercise navigation and restoration. Run `node scripts/msg1351-research-walkthrough-check.mjs --serve` and open the printed local URL. Run without arguments for automated browser acceptance and retained screenshots. Shared host imports, catalog, CSS aggregation, routes and manifests are intentionally left to their integration owner.
