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
- `map`, the map as it is now, read-only: `threads`, `thoughts`, `active` (your thread), `suggestions`, `reminders` (proposed reminders and events), `apps`, `notes` (why a thought went where it went), `points` (each thread's point count, as its card shows it), `rooms` (each thread's room color), `positions` (what someone placed by hand on a canvas, by thread or thought id: absolute canvas coordinates of its top-left, by whom, when; nothing for the rest), `me`, `partial` (your words as they're heard, not yet final: what the dock's live line shows while you talk, "" between turns; only yours, and only in the tab whose mic is on), `connected`. The types are the app's own, from `core.ts` and `positions-core.ts`. A new snapshot comes with every change, and with every word heard: the arrays in it stay the same objects, so work kept on them (`useMemo` on `map.thoughts`) isn't redone per word.
- `actions`: `addThought(text)` (as if typed in the composer), `openThread(id)` (as a Palace picture does: back to the Map at that thread, highlighted; your place moves there), `select(id)` (that thread is "this" for what's said next, as pointing at its card makes it), `notify(text)` (one line in the notice lane), `position(id, x, y)` (a thread's card or a thought's point placed there for every window, kept within ±1,000,000; both null: back to the view's own layout; call it on every step of a drag: steps go at most once a frame, and your own come back in `positions` with `by` you), `listen(on?)` (a tap on the mic: `true` on, `false` off, nothing switches it; it starts the mic only inside a click or key press in this tab, so a brick never turns it on by itself). Each answers on screen as its button does.
- `on(name, listener)`, or `useBrickEvent(on, name, listener)` in a component: `landed` (a thought just placed: `{ thoughtId, threadId, mine }`), `loudness` (the mic's level, 0 to 1, every 320 ms while it's on) and `notice` (a notice or map update as this window shows it, a repeat too: `{ text, kind, time }`, `kind` being `notice`, `error` or `map-change`).
- `brick`: its own `brick.json`.

Two conventions come with the page:
- An element marked `data-thread={id}` is "this" while pointed at or focused (`this-card.ts`), so "rename this to …" works on it without calling `select`.
- A brick styles only its own classes, each starting with its id (`.template`, `.template-open`), with the app's tokens (`--bg`, `--card`, `--ink`, `--muted`, `--line`, `--accent`, `--amber`, `--ai`, `--room-<color>`, `--shadow`), so it reads right in light and dark. It never draws a `<header>`: the app's is the page's only one.

The contract grows by a line: a new field or action is added to `contract.ts`, and its source to `bricks-core.ts` and `App.tsx`. Every brick depends on that file, so that's the hub's change, not a builder's.

## On and off

The Catalog lists every brick by kind, each with its name, its line and its switch; bricks that aren't `demoSafe` fold under "Not for the demo". A switch acts at once and only in this browser: what was switched is kept in `localStorage` (`e2a2o.bricks`), every other brick follows its `defaultOn`, and other windows of the same browser follow along. A view switched off while it's shown hands the window back to the map.

## The playground

`ui/bricks.html?brick=<id>&sample=<name>` mounts one brick as the app does, against a map from `samples/` replayed through the window's own reducer (`sample=empty` for none). Every brick is there, the template too. What the brick asks for is answered as the app would (a thought it adds lands on the thread you're on 1.2 s later; `openThread` moves your place) and logged on the right. "Add a thought", "Talk, then shout" and "Show a notice" fire `landed`, `loudness` and `notice`; "Say a thought" says one: its words come in `map.partial` one at a time (a word every 250 ms), then, at the turn's end, the thought lands; "Core away" sets `map.connected` to false.
- While building: `cd ui && npm run dev`, then open `http://localhost:5173/bricks.html?brick=<id>`; it reloads on every save.
- Built: `npm run build` builds it after the app, into `ui/dist`, and the core serves it at `/bricks.html` on this laptop.

## A builder's rules

1. Copy the template: `cp -R ui/src/bricks/_template ui/src/bricks/<id>`, then put your id where "template" is, in `brick.json`, `index.tsx` and the CSS (its file name and every class).
2. Stay in your folder. Import only `../contract`, React, Motion and, for a canvas (pan, zoom, drag), React Flow (`@xyflow/react`, MIT, and its `dist/base.css`). A new package, a model or a field in the contract is the hub's call: ask. Runtime models must be Meta's (the hackathon's rule).
3. Start off: `defaultOn: false`. Set `demoSafe: true` only once it works on an empty map and a full one, at a phone's width, and asks for nothing before a click.
4. Work in the playground: a full map, the empty one, a phone's width and dark mode (DevTools emulates both).
5. Done when `node scripts/bricks-check.mjs <id>` passes, after `cd ui && npm run build`.

`scripts/bricks-check.mjs` holds: every folder's `brick.json` (the app's own rule) and default export; imports (only `../contract`, React, Motion, React Flow and the folder's own files; no `<header>`); CSS (every selector names one of the brick's classes, keyframes too, and every class styled is used); `contract.ts` takes only types from the app; each brick mounts in the built playground on a full map, an empty one and at a phone's width, with no error and nothing running off the side. Run for all bricks, it also checks the app: at their defaults bricks add nothing to the first screen; the Catalog lists every brick; each view brick, switched on, joins Map and Palace, shows in the map's place and hands back to the map; a switch survives a reload; `?level` still shows the Level meter. A planted breach of each folder rule is caught, so the check can't pass by missing one.

## The bricks so far

- `level` (panel, off): the `?level` meter of the loudness readings the core hears, for setting a volume app's level. Moved here from `Level.tsx` unchanged: `?level` shows it, and without it nothing loads.
- `brick-chip` (panel, off): a small chip naming a brick on each point that lands while it's on, anyone's, first in the point's own tools (left of Delete and Move), so it shows when they do: pointed at, or tapped on a phone. It's meant to name the brick that acted on a thought, but `landed` doesn't say which, so for now it names only itself. Kept for the visit; switched off, every chip goes.
- `bubbles` (view, off, demo-safe): every thread as a bubble in a place of its own, sized by its points, floating gently; a landing ripples its bubble. A bubble opens its thread on the map.
- `notice-timeline` (panel, off, demo-safe): what just happened. Every notice and map update this window shows while it's on, the newest 50, newest first, behind a clock above the dock at the left that's there once the first comes; typing or saying "what just happened?" opens the list too. Esc, × or a click outside closes it.
- `spine` (view, off, demo-safe): the map as one canvas without end (React Flow). Each topic is a spine of its points, oldest at the top; a tangent hangs beside the point it came from, as a card with its latest point and a recap line, alternating right and left, a tangent's tangents further out; topics stand apart in six columns. It follows where you are and lets go when you move it ("Follow" brings it back; so does your next thought after a quiet moment). Far out, words become bars and titles keep their size. Anything can be dragged anywhere and stays there for everyone (`positions`); its pin puts it back. The shelf, bottom right, keeps things at hand for this viewer (in this browser); something new out of view shows as an arrow at the edge.
- `keys` (input, off, demo-safe): the map from the keyboard: j/↓ and k/↑ walk a thread's points (focused on the map), l/→ and h/← the threads in the order they were made; Enter shows a point's details, Esc lets go, ? shows the keys (also on first use), ⌘D (Ctrl+D off a Mac) starts or stops listening. Keys typed in a field stay the field's; the Palace and view bricks keep their arrows.
- `tiny-transcript` (panel, off, demo-safe): your words as you say them (`map.partial`), 11 px on one line just above the dock, the newest words in view; while it's on, the dock's big live line stays out (`showsLiveWords`). The first time, a hint says it's small on purpose, with a size slider (9 to 16 px, kept), until a click outside or Esc.
- `_template` (card): the brick to copy.
