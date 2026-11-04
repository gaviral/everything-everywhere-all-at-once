# Discussions

Enable **Discussions** in Features, then open its view. Enable the existing
**Discussion status** switch to resolve and reopen live exchanges; the view links
to that switch when it is off. Both features start off.

Every anchored thread appears beside its captured source words. All discussions
is the initial filter. Resolved exchanges retain their reply count, a Read replies
button, and Reopen discussion. New replies leave an exchange resolved and show a
notice. Filters and expanded replies survive a source jump and return within the
same map and participant visit. Missing or changed sources keep the captured
quote and an explanation.

The host owns status persistence, revisions, and acknowledgements. The view makes
no optimistic status changes and never retries automatically. An empty map shows
an interactive example whose status changes stay in the preview.

Run `node ui/src/bricks/anchored-discussions/check.mjs` from the repository root.
It checks scoped TypeScript and an isolated production bundle in a browser with
a synthetic host, including acknowledged close/reopen, reply discovery, source
jump and return, late replies, refusal, offline controls, source changes, keyboard
access, and desktop/phone reflow. This is not a live core or physical TV check.
