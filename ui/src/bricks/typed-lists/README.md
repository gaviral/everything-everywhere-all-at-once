# Thought board

Enable **Thought board** on Features, then choose its view. It is off by default.
The feature opens with a labelled example board. **Use my thoughts** offers
placed thoughts from the current map. Choose one, give it a title and typed
fields, and keep its card. Stage is a choice, Owner is short text, and Due is a
calendar date. **Shape list** renames the list and fields or adds stage options.
Existing field types and options remain so cards retain their meaning.

Board moves and list edits change local card fields. **Source words** retains
the complete captured text and links to that exact thought on the map. A changed
source is labelled and can be opened in its current form; a missing source keeps
the captured words with navigation disabled.

Cards, example edits and the selected view stay in browser memory for the current
map and participant, including a source jump and return. Reloading clears them.
The eight most recently edited map/participant visits are retained in memory;
nothing is sent, journalled or written to browser storage. Up to 100 real cards
per visit. No model calls or microphone access.

Run the focused check from the repository root:

```sh
node ui/src/bricks/typed-lists/check.mjs
```

It exercises discovery in the actual playground and interaction in a synthetic
host, including source jump/unmount/return without the Plugins switch. It retains
screenshots and its Vite cache under ignored `.check-artifacts/`, and preserves
its isolated Chrome profile. It uses an OS-assigned port and closes only the
server and browser it starts. No core or credentials are needed.
