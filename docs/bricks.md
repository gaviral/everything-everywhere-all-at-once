# Bricks

A brick is a feature in a folder of its own: a view, a card, an input or a panel. The app finds every folder under `ui/src/bricks/`, so adding a brick is adding a folder: no list, registry or app file to edit. Each can be switched on or off while the app runs, in the Catalog (Apps › Catalog). A builder makes one against one file, `ui/src/bricks/contract.ts`, in the playground (`ui/bricks.html`), without the core, a key or the rest of the app.

## A brick's folder

```
ui/src/bricks/<id>/
  brick.json   what the Catalog shows, and how the brick starts
  index.tsx    the brick: a React component, its default export
  …            anything else it needs (its CSS, helpers), inside the folder
```

| `brick.json` | |
|---|---|
| `id` | The folder's name: lowercase letters, digits and dashes. |
| `name` | What the Catalog calls it: a word or two (24 characters at most). |
| `does` | One line for a person: what it does (90 characters at most). |
| `kind` | `view`, `card`, `input` or `panel` (below). |
| `defaultOn` | On in every browser until someone switches it off. A new brick starts `false`. |
| `demoSafe` | `true` when it's fine to switch on live in front of people: it works on an empty map and a full one, needs no setup, and asks for nothing (the camera, the mic) before a click. The Catalog folds the rest under "Not for the demo". |
| `flag` | Optional. `?<flag>` in the address switches it on for that visit (`?level`). |
| `showsLiveWords` | Optional. `true` when it shows `map.partial` (your words as you say them) itself: while it's on, the dock leaves out its big live line, so the words never show twice. Tiny transcript does. |

Where each kind shows:
- **view**: another way to see the map. Its name joins the Map and Palace switch, and it shows in the map's place, padded clear of the dock as the Palace is. Bubbles is one.
- **card**: a small card in the dock, above the composer, where the unfinished card shows. Its height counts with the dock's cards, so a thought just shown moves clear of it. The template is one.
- **input**: a new way in (gestures, a pedal). It mounts with the page, draws at most a small mark of its own, and acts through `actions`.
- **panel**: floats over the page and places itself. The Level meter is one.

## How the app finds them

`ui/src/bricks-core.ts` reads every `./bricks/*/brick.json` (at once: they're small) and every `./bricks/*/index.tsx` (lazily) with Vite's `import.meta.glob`. Folders whose name starts with `_` are skipped: the template is copied, not run. A brick's code loads only once it's on, so a brick that's off costs the page its `brick.json` and nothing else. A brick whose `brick.json` is wrong is left out with a warning in the console; `scripts/bricks-check.mjs` says the same, in the same words, before a merge.

`ui/src/BrickSlot.tsx` mounts each kind in its place, every brick behind a boundary of its own: one that throws shows "… stopped working" with a Switch it off button, and the rest of the page carries on.

## The contract

`ui/src/bricks/contract.ts` is the only app file a brick imports. Its default export gets `{ map, actions, on, brick }`:
- `map`, the map as it is now, read-only: `threads` (a margin note's carries `anchor`, below), `thoughts`, `active` (your thread), `suggestions`, `reminders` (proposed reminders and events), `apps`, `notes` (why a thought went where it went), `points` (each thread's point count, as its card shows it), `rooms` (each thread's room color), `positions` (what someone placed by hand on a canvas, by thread or thought id: absolute canvas coordinates of its top-left, by whom, when; nothing for the rest), `speakers` (everyone on the map by the name their thoughts carry, each `{ ai }`: true for an AI participant, the Friend), `me`, `partial` (your words as they're heard, not yet final: what the dock's live line shows while you talk, "" between turns; only yours, and only in the tab whose mic is on), `connected`. The types are the app's own, from `core.ts`, `positions-core.ts` and `annotate-core.ts`. A new snapshot comes with every change, and with every word heard: the arrays in it stay the same objects, so work kept on them (`useMemo` on `map.thoughts`) isn't redone per word.
  - **Margin notes:** a note is a tangent anchored to words: a thread under the point's thread whose thoughts are the note and its replies, with `anchor: { thought_id, quote }`, the words it's tied to. A view shows it beside those words; the Map shows it as a branch.
  - **✓ Agreed:** a thought the room agreed on will list who in `agreed_by`; the core doesn't say who yet, so none has it.
- `actions`: `addThought(text)` (as if typed in the composer), `openThread(id)` (as a Palace picture does: back to the Map at that thread, highlighted; your place moves there), `select(id)` (that thread is "this" for what's said next, as pointing at its card makes it), `notify(text)` (one line in the notice lane), `position(id, x, y)` (a thread's card or a thought's point placed there for every window, kept within ±1,000,000; both null: back to the view's own layout; call it on every step of a drag: steps go at most once a frame, and your own come back in `positions` with `by` you), `listen(on?)` (a tap on the mic: `true` on, `false` off, nothing switches it; it starts the mic only inside a click or key press in this tab, so a brick never turns it on by itself). Each answers on screen as its button does.
  - `annotate(thoughtId, quote, text)`: a margin note by you on `quote`, words picked in that thought's point, for every window. The first on those words starts their note, a later one answers in it; both come back in `threads` and `thoughts` as placed (no model reads a note). False when it can't go (no words, over 6,000 characters, the core away); the core refuses one whose point left the map, and says so.
  - `openCatalog(id?)`: the Catalog, as Apps' button opens it; with a brick's id, at its row, marked, its switch focused.
  - `hint(text, target?)`: one line (140 characters at most) beside the part named `target` with an arrow at it, as another participant's point shows, or in the corner without one; your brick's name on it, in this window only. `target` is a `data-guide` name: the app's (docs/guide.md) or one the brick gives its own part. False when nothing showed.
- `on(name, listener)`, or `useBrickEvent(on, name, listener)` in a component:
  - `landed`: a thought just placed, `{ thoughtId, threadId, mine, model, ms, by }`: `model` the model that placed it ("Muse Spark 1.3"; null when a rule did, or this window didn't hear which), `ms` how long placing took, from said to landed (the point's own time), `by` who acted: `{ kind: "brick", id, name }` when a brick's `addThought` added it in this window, else `{ kind: "person", name }`.
  - `words`: your words as they're heard, each time they change (as `map.partial` then); "" once the turn ends or the mic stops.
  - `loudness`: the mic's level, 0 to 1, every 320 ms while it's on.
  - `notice`: a notice or map update as this window shows it, a repeat too: `{ text, kind, time }`, `kind` being `notice`, `error` or `map-change`.
  - `pointing`: what the guide's arrow points at (another participant's point, or a brick's hint), `{ target, by, thoughtId?, threadId? }` (a point's thread too), or null once it's down: a view dims the rest once, never twice.
  - `asked`: something you asked for by voice or typing that a brick answers, only in your windows: `{ what: "notices" }` is "what just happened?". It never lands on the map.
- `brick`: its own `brick.json`.

Three conventions come with the page:
- An element marked `data-thread={id}` is "this" while pointed at or focused (`this-card.ts`), so "rename this to …" works on it without calling `select`.
- A brick styles only its own classes, each starting with its id (`.template`, `.template-open`), with the app's tokens (`--bg`, `--card`, `--ink`, `--muted`, `--line`, `--accent`, `--amber`, `--ai`, `--room-<color>`, `--shadow`), so it reads right in light and dark. It never draws a `<header>`: the app's is the page's only one.
- A brick names a part of its own for a hint, or the guide, with `data-guide`, starting with its id (`data-guide="tiny-transcript"`, `"tiny-transcript:size"`); a view marks the map's threads and points with theirs (`thread:<id>`, `point:<id>`), as the Spine does.

The contract grows by a line: a new field or action is added to `contract.ts`, and its source to `bricks-core.ts`, `BrickSlot.tsx` and `App.tsx` (and the playground). Every brick depends on that file, so that's the hub's change, not a builder's.

## Slots

The page's regions, each an element marked `data-slot="<name>"` while it's on screen (`SlotName` and `SLOTS` in `contract.ts`). A brick finds one by name (`document.querySelector('[data-slot="stage"]')`), to draw beside or in it, or keep clear of it. The layout may move a region, or bring one that isn't there yet; the names stay.

| Slot | The region | Today |
|---|---|---|
| `top-left` | the wordmark and the map's name | the header's left (`.brand`) |
| `top-right` | Find, Catalog, people | the header's buttons (`.header-actions`) |
| `bottom-left` | the camera: following, zoom stops | not yet: the Notice timeline's clock and the corner caption place themselves there |
| `bottom-right` | the shelf, and the held stack above it | not yet |
| `stage` | bottom center, with room beside it: the composer, captions, one notice | not yet: today's dock spans the window's width, so a view's corners stay clear of it, at the right (the Spine's) |
| `status` | the status line: the mic, its time, live words, what's waiting | the header's status (`.status`) |
| `rail` | the panel at the right: Talk, History, Catalog, Settings | not yet |
| `shelf` | what you keep at hand | the Spine's shelf, while the Spine is the view |
| `held` | questions waiting for your pause | not yet |
| `slot:<thought id>` | where a thought on its way will land | marked by the view that shows it (the Spine's dashed slot); a flight aims there |

A flight in the air marks its bubble `data-flight="<thought id>"` (Bubble flight), so a view can wait for it to arrive.

## On and off

The Catalog lists every brick by kind, each with its name, its line and its switch; bricks that aren't `demoSafe` fold under "Not for the demo". A switch acts at once and only in this browser: what was switched is kept in `localStorage` (`e2a2o.bricks`), every other brick follows its `defaultOn`, and other windows of the same browser follow along. A view switched off while it's shown hands the window back to the map.

## The playground

`ui/bricks.html?brick=<id>&sample=<name>` mounts one brick as the app does, against a map from `samples/` replayed through the window's own reducer (`sample=empty` for none). Every brick is there, the template too. What the brick asks for is answered as the app would (a thought it adds lands on the thread you're on 1.2 s later, placed by Muse Spark 1.3 as its route says; `openThread` moves your place; a margin note comes back as the core's changes would) and logged on the right, with what it heard under it. "Add a thought", "Talk, then shout" and "Show a notice" fire `landed`, `loudness` and `notice`; "Say a thought" says one: its words come in `map.partial` and `words` one at a time (a word every 250 ms), then, at the turn's end, the thought lands; "The Friend says one" has an AI participant join and say a thought; "Point at a thread" fires `pointing` (again: null); "Ask what just happened" fires `asked`; "Core away" sets `map.connected` to false. In the console, `brickActions` is the shown brick's own actions, to try one by hand.
- While building: `cd ui && npm run dev`, then open `http://localhost:5173/bricks.html?brick=<id>`; it reloads on every save.
- Built: `npm run build` builds it after the app, into `ui/dist`, and the core serves it at `/bricks.html` on this laptop.

## A builder's rules

1. Copy the template: `cp -R ui/src/bricks/_template ui/src/bricks/<id>`, then put your id where "template" is, in `brick.json`, `index.tsx` and the CSS (its file name and every class).
2. Stay in your folder. Import only `../contract`, React, Motion and, for a canvas (pan, zoom, drag), React Flow (`@xyflow/react`, MIT, and its `dist/base.css`). A new package, a model or a field in the contract is the hub's call: ask. Runtime models must be Meta's (the hackathon's rule).
3. Start off: `defaultOn: false`. Set `demoSafe: true` only once it works on an empty map and a full one, at a phone's width, and asks for nothing before a click.
4. Work in the playground: a full map, the empty one, a phone's width and dark mode (DevTools emulates both).
5. Done when `node scripts/bricks-check.mjs <id>` passes, after `cd ui && npm run build`.

`scripts/bricks-check.mjs` holds: every folder's `brick.json` (the app's own rule) and default export; imports (only `../contract`, React, Motion, React Flow and the folder's own files; no `<header>`; a `data-guide` name of its own starts with its id); CSS (every selector names one of the brick's classes, keyframes too, and every class styled is used); `contract.ts` takes only types from the app, and its slot names are this page's; each brick mounts in the built playground on a full map, an empty one and at a phone's width, with no error and nothing running off the side. The contract itself, in the playground: `landed` with its model, time and who (a person, or the brick that added it), `words` as they grow, `pointing`, `asked`, a margin note and its reply, `openCatalog`, a hint and one refused; in the app: the slots on today's layout (no stage on today's dock), a margin note from the core tied to its words in the Spine, "what just happened?" opening the Notice timeline (off: a notice says where to switch it on, and the view stays), and the Notice timeline's clock clear of Tiny transcript's line on a phone. Run for all bricks, it also checks the app: at their defaults bricks add nothing to the first screen; the Catalog lists every brick; each view brick, switched on, joins Map and Palace, shows in the map's place and hands back to the map; a switch survives a reload; `?level` still shows the Level meter. A planted breach of each folder rule is caught, so the check can't pass by missing one.

## The bricks so far

- `level` (panel, off): the `?level` meter of the loudness readings the core hears, for setting a volume app's level. Moved here from `Level.tsx` unchanged: `?level` shows it, and without it nothing loads.
- `brick-chip` (panel, off): a small chip naming a brick on each point that lands while it's on, anyone's, first in the point's own tools (left of Delete and Move), so it shows when they do: pointed at, or tapped on a phone. It's meant to name the brick that acted on a thought; `landed`'s `by` now says which, and for now it still names only itself. Kept for the visit; switched off, every chip goes.
- `bubbles` (view, off, demo-safe): every thread as a bubble in a place of its own, sized by its points, floating gently; a landing ripples its bubble. A bubble opens its thread on the map.
- `notice-timeline` (panel, off, demo-safe): what just happened. Every notice and map update this window shows while it's on, the newest 50, newest first, behind a clock above the dock at the left that's there once the first comes (16 px higher below 576 px wide, clear of Tiny transcript's line); typing or saying "what just happened?" opens the list too (the core's command: `asked`, never a point). Esc, × or a click outside closes it.
- `spine` (view, off, demo-safe): the map as one canvas without end (React Flow). Each topic is a spine of its points, oldest at the top; a tangent hangs beside the point it came from, as a card with its latest point and a recap line, alternating right and left, a tangent's tangents further out; topics stand apart in six columns. It follows where you are and lets go when you move it ("Follow" brings it back; so does your next thought after a quiet moment). Far out, words become bars and titles keep their size. Anything can be dragged anywhere and stays there for everyone (`positions`); its pin puts it back. The shelf, bottom right, keeps things at hand for this viewer (in this browser); something new out of view shows as an arrow at the edge.
- `keys` (input, off, demo-safe): the map from the keyboard: j/↓ and k/↑ walk a thread's points (focused on the map), l/→ and h/← the threads in the order they were made; Enter shows a point's details, Esc lets go, ? shows the keys (also on first use), ⌘D (Ctrl+D off a Mac) starts or stops listening. Keys typed in a field stay the field's; the Palace and view bricks keep their arrows.
- `tiny-transcript` (panel, off, demo-safe): your words as you say them (`map.partial`), 11 px on one line just above the dock, the newest words in view; while it's on, the dock's big live line stays out (`showsLiveWords`). The first time, a hint says it's small on purpose, with a size slider (9 to 16 px, kept), until a click outside or Esc.
- `_template` (card): the brick to copy.
