# Canvas buddy

Default off. Enable **Canvas buddy** in Features or add `?canvas-buddy`.
The opening launch map is labelled example content; its replies stay local.
**Read my map** makes one request through the existing `/flow/run` route,
which uses Meta's Muse Spark 1.3. No shared routing change, key in the browser,
background model requests or microphone access.

The bounded request contains up to twelve placed points, their topic titles and
source IDs. A validated note anchors to its rendered source; panning and zooming
move the bead with it. Offscreen sources have an **Open source** link. Tap or type
to send a comment on the exact source quote through the host's annotation action.
The receipt says sent, not saved. Changed sources disable replies. A new map visit
resets the feature, and unmount aborts the pending request. Reduced motion skips
gliding and pulsing.

Focused synthetic browser check (no live model or microphone):

```sh
node ui/src/bricks/canvas-buddy/check.mjs
```

The check builds its own in-memory fixture and serves on an OS-assigned loopback
port. Its isolated Chrome profile is preserved. Live Muse Spark service validation
remains separate from this synthetic check.
