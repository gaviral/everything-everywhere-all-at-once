Reshape topics starts off in Features. Show it to work with a snapshot of the current map, or a clearly labelled example when there are no topics.

This is a local rehearsal, kept in memory only while the view is open. Split selected points into a named sibling, merge a topic into another (moving its children too), or move a whole branch under a parent or to the top level. Preview shows the affected topics and original words before and after. Confirm changes only this working copy. Undo restores the exact previous snapshot, including point order, topic order and parents; repeated Undo walks back consecutive changes. Escape cancels a preview and returns focus to Preview reshape.

The current brick contract has no shared structure mutation action. This feature does not claim to save to the map or invoke typed/voice commands as a substitute. Applying a rehearsal to the shared map needs a future host-owned preview/confirm/undo action. Switching views, switching off, reloading or changing map/person clears the rehearsal. It makes no model calls and never accesses the microphone.

Focused check: `node ui/src/bricks/topic-reshape/check.mjs`. It builds only the isolated fixture, checks the UI in its own headless browser, and retains screenshots and its temporary profile. No full gate or shared build is needed for this check.
