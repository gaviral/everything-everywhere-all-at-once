# Topic views

Enable **Topic views** in Features, then choose it in the view switch.
An empty map opens a labelled community-garden example. A populated map uses its
canonical topic IDs and thought IDs, without creating another topic hierarchy.

**Topic tree** shows parent/child topics and each topic’s directly linked points.
**Conversation** shows original words in chronological order, filtered to the
chosen topic unless **Show whole conversation** is checked. A point links to its
exact original thought; **Open on map** delegates to the host’s source navigation.
**Notes** is independent writing for the selected topic, with optional captured
source references. Editing notes never changes accepted speech or topic points.
Changed or missing sources retain their captured words and explain their state.

View, topic, conversation filter, source selection and notes survive hiding the
feature or visiting a source and returning. Memory is scoped to the map and
participant visit, holds the 16 most recently used scopes, and clears on reload.
Example state is separate from live state. This is one usable projection; it
does not provide workspace management or folder-derived topics.

Focused check: `node ui/src/bricks/topic-views/check.mjs`. It builds only this
feature’s preview, type-checks its dependency graph, and exercises the rendered
behavior in an isolated browser on port 4388 without starting a microphone or
calling a model. Screenshots and the temporary browser profile are retained.
