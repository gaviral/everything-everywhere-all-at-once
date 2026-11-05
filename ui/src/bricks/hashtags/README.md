# Hashtags

Off by default. Enable **Hashtags** in Features, then select its view, or open
`?bricks=hashtags`. The standalone playground is
`bricks.html?brick=hashtags&sample=debug-break`.

Original thought text supplies tags: `#rollback` and `hashtag rollback` both
become `#rollback`. Case variants and repeated occurrences count once per
thought. Tags may contain Unicode letters, numbers, underscores and internal
dashes. Model summaries and suggested topic tags are not indexed.

The strip filters across every topic, including tangents. Open original uses
the host's exact-thought navigation. Returning preserves the selected tag for
this map visit and participant. All tags or Escape clears the filter; Back to
map leaves the view. No microphone, model or map mutation is requested.

Without tagged thoughts, a labeled preview uses sentences from the developer's
`debug-break` sample with illustrative tags added. Preview cards cannot open
sources or add thoughts. The first real tagged thought replaces the preview.

Focused check: `node ui/src/bricks/hashtags/check.mjs`. It compiles this brick,
builds an isolated browser fixture, and checks parsing, counts, filtering,
source return, updates, keyboard navigation, phone layout and denied storage.
It retains screenshots and its temporary browser profile. It does not test a
live transcription service or start capture.
