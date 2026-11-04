# Names

The screen, the help list and the docs use the names in the first column. Code, saved files and URLs keep the old words, so nothing stored had to be rewritten. This table is the lookup between them.

- **Legend:**
  - New: what a person reads.
  - AKA: another name for the same thing, shown beside the new one where a feature is listed.
  - Old: the word the screen used before.
  - Where the old survives: names a person never reads (code, saved maps, URLs, the wire) and the spoken words that still work.

| New | AKA | Old | Where the old survives |
|---|---|---|---|
| **Topic** | thread | thread | `thread_id`, `thread_added`, `Thread`; saved maps (`samples/*.jsonl`) and journals; CSS `.thread`, element ids `thread-<id>`, `data-thread`; guide names `thread:<id>`; spoken “new thread”, “the garden thread”, “this thread” |
| **Tangent** | branch | branch | `parent_id` in saved maps; CSS `.branches`; spoken “every branch” |
| **Comment** | margin note | margin note | the annotate code (`annotate.rs`, `annotate-core.ts`); saved maps |
| **Since you left** | | While you were away | `Away.tsx`, CSS `.away`, ids `away-*`; guide name `away` |
| **Cards** | list | Map (the view) | view value `"map"`, `View::Map`, `data-guide="view:map"`; spoken “map” still opens the map's home view |
| **Pictures** | gallery | Palace | view value `"palace"`, `View::Palace`, `Palace.tsx`, CSS `.palace-*`, `data-guide="view:palace"`; spoken “palace” |
| *(no name: a heading)* | | room (a cluster in the Palace) | CSS `.palace-room*`, the colour variables `--room-N`, `rooms.ts` |
| **Canvas** | one big board, infinite canvas | Spine | feature id `spine`, folder `ui/src/bricks/spine/`, CSS `.spine-*`; saved switches in `localStorage` |
| **Off-screen indicator** | edge chip | edge chips | `cues.tsx`, CSS `.spine-cue*`; `edge-cues-check`, `edge-chips-clear-check` |
| **Bottom bar** | | dock | CSS `.dock*`, `--dock-height`, `data-dock-card`; (the macOS Dock keeps its name: “Add to Dock”) |
| **Input box** | composer | composer | `data-guide="composer"`, CSS `.composer`, `COMPOSER_ID`; the trace step `composer` (the app builder's model call) |
| **Fly-in** | words fly to their place | Bubble flight | feature id `bubble-flight`, its folder |
| **Features** | | brick, Apps bar | `brick.json`, `ui/src/bricks/`, `BrickSlot`, the file `docs/bricks.md`; saved switches in `localStorage` |
| **Features page** | | Catalog | `Catalog.tsx`, `openCatalog`, `data-guide="catalog"`; `core/src/catalog.rs` is the command list |
| **Notification history** | recent notices | Notice timeline | feature id `notice-timeline` |
| **Mark replies as read** | remember replies you've viewed; a dot means unread and a line shows where you stopped | Read marker, Read progress | feature id `read-progress` |
| **Keyboard shortcuts** | keyboard controls | Keys | feature id `keys` |
| **Source attribution** | source tag, added by | Brick chip | feature id `brick-chip` |
| **AI helper** | | Friend | the participant name `Friend` in saved maps and on the wire; shown as AI helper |
| **Interruption level**: Mark, Ask, Comment, Speak, Interrupt | | levels: Glance, Hand, Note, Speak, Stop | wire values `glance`, `hand`, `note`, `speak`, `stop` (`Level` in `call.rs`, `LEVELS` in `talk/call-core.ts`) |
| **Shared map** (the button says **Share**; **Join code**, **Leave**) | | room | `./run.sh room`, `?room=`, the `room=` cookie, `/room`, `ROOM_CODE`, `room.tsx`, CSS `.room-*` |
| **Help** | | the “?” list | `data-guide="help"`, `Act::Help`; saying “What can I say?” still opens it |
| **Stay here** | | | `stay_here`, `stay_changed`, `Stay`; the pinned topic shows **Staying here**, released with × or “let go” |
| **Deadlines** | countdown | Countdown | feature id `countdown`; **Send countdown** keeps its name |

## Names only the docs use

- **Unfinished thought:** the card offered after a sentence trailed off. The tag on the topic still says “left off”.
- **AI mark:** the ✦ on everything the AI added.
- **Placing pill:** the pill for a sentence that is still finding its place.
- **Theme:** the AI's grouping of topics (the screen already said theme).

## Spoken words

The new word is added and the old one keeps working. “What can I say?” shows the new ones; [COMMANDS.md](COMMANDS.md) lists both.

| Say | Still works |
|---|---|
| “Pictures”, “show the pictures” | “Palace”, “go to the palace” |
| “Cards”, “show the cards” | “Map” still goes to the map's home view |
| “New topic”, “expand the garden topic”, “every tangent” | “new thread”, “the garden thread”, “every branch” |

## Not renamed

Kept as they were: map (the whole), thought, point, Bubbles, Shelf, Why here, Model line, Notice, Guide, Held questions, Send countdown, Status, Recap, Import chats, Export, Listening, Live words, Tiny transcript, Level meter, Apps (the small apps you ask for), and the feature **Work spine**, which is another feature's own name.

## The check

`node scripts/names-check.mjs` (part of `scripts/precheck.sh`) fails when a retired word shows up in text a person reads: a string in the UI, a feature's `brick.json`, or a public doc. It skips code, saved maps, CHANGELOG, `docs/trace.md` and this file, and a line that ends with a `names-ok: reason` marker.
