# Gaze focus

An optional, default-off panel. Enable **Gaze focus** in Features. Its first look is a clearly labelled simulated path, with an example map when there are no topics. The soft ring follows visible topic bounds; it never changes the selected topic or moves the map. Pause clears the estimate.

**Use camera** is the only camera entry point. Video-only permission is requested in that click. Small frames stay in a detached canvas in this browser; there is no recording, serialization, storage or upload. Stop camera, hiding/leaving the page, changing the map/person and unmounting release tracks. A permission request that resolves after stopping is released too. Returning never restarts the camera.

Version one is a region proxy, not calibrated eye tracking. Native `FaceDetector`, when available and working, supplies face/eye positions. These indicate coarse head position, not pupil direction. Otherwise a brightness centroid supplies a much rougher estimate. The first readable frame establishes the center; **Center estimate** resets it. Smoothing and a half-second dwell soften target changes; missing camera input clears the estimate. [Browser API support and landmark availability vary.](https://developer.chrome.com/docs/capabilities/shape-detection)

The contract has no pre-send metadata hook for the shared composer. **Next thought** in this panel therefore sends through the existing `addThought` action, with the visible focus snapshot appended as text. Demo/example context is explicitly marked as simulated. The snapshot freezes at the first typed character; later gaze movement does not change that draft's context. The normal composer is untouched. No model call is added by this feature.

Parts: `estimate.ts` handles geometry; `camera.ts` owns local capture; `targets.ts` finds visible topics; `use-tracking.ts` handles modes and dwell; `Thought.tsx` owns the contextual draft; `index.tsx` composes the panel.

Focused check (synthetic canvas video, no camera or microphone hardware):

```sh
node ui/src/bricks/gaze-focus/check.mjs
```

It covers the default demo, example/live topic highlighting, labelled contextual submission, native detection/fallback, track cleanup including a late permission response, and phone layout. Browser profiles, screenshots and Vite cache are preserved in the check's temporary artifacts folder. This does not establish real-camera tracking accuracy.
