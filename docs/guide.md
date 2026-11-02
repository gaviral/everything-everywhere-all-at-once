# Guide: pointing and captions

Another participant on the map, such as an AI that joined with a name ("Claude"), can show you one exact part of the screen with a big arrow and a one-line caption, and say what it says as a caption in the corner instead of adding cards to your map. One at a time, of the moment: nothing is kept, and no model is asked.

## Messages

A window sends these over the WebSocket (`core/src/guide.rs` checks and relays them):
- `{"type":"point","target":"<name>","caption":"<140 characters at most>"}`: an arrow at that part, the caption beside it. `{"type":"point","target":null}` takes your point down.
- `{"type":"caption","text":"<400 characters at most>"}`: a line in the corner.

Every other window gets `{"type":"guide","kind":"point"|"caption","target":…,"text":…,"by":"<sender's name>","at_ms":…}`; the window that sent it doesn't. Nothing is journaled. One window may send 4 a second at most; past that, past a cap, or with a target that isn't a name, only the sender hears why, in a notice.

## What the window shows

- **A point:** the part scrolled into view, a big arrow at it with its caption, and a soft spotlight; the arrow follows the part as it moves. A new point replaces it; Esc or a click takes it down.
- **A part not on screen:** never guessed at. The arrow shows what reveals it (Show on the card a thought is in, the Map button, Apps, search, Focus) and the caption says where it is; a click there moves the arrow on to the part itself. With no such way, there's no arrow, and the caption says it isn't on screen.
- **A caption:** bottom-left, never on the composer, with who said it. The next replaces it; it goes once read: a slow reader's time for its words, 4 s at least, which also outlasts it being spoken, counted only while the page shows. The pointer on it holds it.
- Both draw over an open sheet and keep still under Reduce Motion. `ui/src/Guide.tsx` draws them; the rules are in `ui/src/guide-core.ts`, held by `scripts/guide-check.mjs`.

## Names

Each part carries its name as `data-guide`.

| Name | The part | On screen |
|---|---|---|
| `composer` | the box where you type or talk | always |
| `mic` | the mic | always |
| `help` | the ? list of what you can say | always |
| `recap` | Recap | always |
| `import` | Import chats | on the laptop running the map |
| `export` | Export | once the map has a thought |
| `status` | the status line | always |
| `room` | the room menu | in a room |
| `apps` | the Apps panel | always |
| `make-app` | the field that asks for an app | while Apps is open |
| `catalog` | the Catalog button | while Apps is open |
| `notice` | the notice under the header | while one is up |
| `undo` | Undo on a notice | while a notice can be taken back |
| `views` | the view switch | once the map has a thread |
| `view:map` | the switch's Map button | once the map has a thread |
| `view:palace` | the switch's Palace button | once the map has a thread |
| `search` | search | on the Map |
| `focus` | Focus | on the Map, with two threads |
| `back-to-active` | Back to active | on the Map, with two threads |
| `map` | the map | on the Map |
| `palace` | the Palace | in the Palace |
| `unfinished` | the unfinished card | while it's up |
| `away` | While you were away | while it's up |
| `pending` | the thoughts finding their place | while any is |
| `send-card` | the message about to send | while it counts down |
| `thread:<id>` | a thread: its card on the Map, its picture in the Palace | when its card or picture is |
| `point:<id>` | a thought: its point in its card (while it finds its place, `pending` is shown instead) | while its card is open |
| `view:<id>` | a view brick's button in the view switch | while that brick is on |
