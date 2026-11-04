# Take checklist

Enable **Take checklist** in Features, then show its view. All eight checks are visible on a TV; small screens scroll. It starts off, uses no model, and never activates a microphone, plays audio, changes feature switches or sends content.

The live empty-map check requires a connection and no topics, thoughts, live words or other saved map content. A disconnected empty snapshot cannot pass. A commit-shaped `VITE_BUILD_ID` identifies the loaded page; the checklist never fetches the server's latest build and claims it is the page's build. Without a baked commit, enter the commit you checked by hand and tick it. Editing that entry clears its tick.

Sends, microphone choice, optional parts, private parts, machine-only parts and music always say **Check by hand** until tapped. The public brick contract cannot verify these settings. A tick records a person's check; it never changes a setting. Ticks clear on New take, disconnect, leaving the view, or changing map/person. The summary says **Checks complete**, not that recording has started.

Focused verification (synthetic playground only; never uses a real microphone):

```
npm --prefix ui run build
node ui/src/bricks/take-checklist/check.mjs
```

The check exercises empty/populated/disconnected maps, build entry invalidation, manual toggles, keyboard interaction, per-take reset, TV/phone layout and light/dark rendering. Screenshots and the check's isolated Chrome profile remain in ignored `.check-artifacts/`; cleanup never deletes them.
