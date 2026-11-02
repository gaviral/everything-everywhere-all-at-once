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

Where each kind shows:
- **view**: another way to see the map. Its name joins the Map and Palace switch, and it shows in the map's place, padded clear of the dock as the Palace is.
- **card**: a small card in the dock, above the composer, where the unfinished card shows. Its height counts with the dock's cards, so a thought just shown moves clear of it. The template is one.
- **input**: a new way in (gestures, a pedal). It mounts with the page, draws at most a small mark of its own, and acts through `actions`.
- **panel**: floats over the page and places itself. The Level meter is one.

## How the app finds them

`ui/src/bricks-core.ts` reads every `./bricks/*/brick.json` (at once: they're small) and every `./bricks/*/index.tsx` (lazily) with Vite's `import.meta.glob`. Folders whose name starts with `_` are skipped: the template is copied, not run. A brick's code loads only once it's on, so a brick that's off costs the page its `brick.json` and nothing else. A brick whose `brick.json` is wrong is left out with a warning in the console; `scripts/bricks-check.mjs` says the same, in the same words, before a merge.

`ui/src/BrickSlot.tsx` mounts each kind in its place, every brick behind a boundary of its own: one that throws shows "… stopped working" with a Switch it off button, and the rest of the page carries on.

## The contract

`ui/src/bricks/contract.ts` is the only app file a brick imports. Its default export gets `{ map, actions, on, brick }`:
- `map`, the map as it is now, read-only: `threads`, `thoughts`, `active` (your thread), `suggestions`, `reminders` (proposed reminders and events), `apps`, `notes` (why a thought went where it went), `points` (each thread's point count, as its card shows it), `rooms` (each thread's room color), `me`, `connected`. The types are the app's own, from `core.ts`. A new snapshot comes with every change.
- `actions`: `addThought(text)` (as if typed in the composer), `openThread(id)` (as a Palace picture does: back to the Map at that thread, highlighted; your place moves there), `select(id)` (that thread is "this" for what's said next, as pointing at its card makes it), `notify(text)` (one line in the notice lane). Each answers on screen as its button does.
- `on(name, listener)`, or `useBrickEvent(on, name, listener)` in a component: `landed` (a thought just placed: `{ thoughtId, threadId, mine }`) and `loudness` (the mic's level, 0 to 1, every 320 ms while it's on).
- `brick`: its own `brick.json`.

Two conventions come with the page:
- An element marked `data-thread={id}` is "this" while pointed at or focused (`this-card.ts`), so "rename this to …" works on it without calling `select`.
- A brick styles only its own classes, each starting with its id (`.template`, `.template-open`), with the app's tokens (`--bg`, `--card`, `--ink`, `--muted`, `--line`, `--accent`, `--amber`, `--ai`, `--room-<color>`, `--shadow`), so it reads right in light and dark. It never draws a `<header>`: the app's is the page's only one.

The contract grows by a line: a new field or action is added to `contract.ts`, and its source to `bricks-core.ts` and `App.tsx`. Every brick depends on that file, so that's the hub's change, not a builder's.

## On and off

The Catalog lists every brick by kind, each with its name, its line and its switch; bricks that aren't `demoSafe` fold under "Not for the demo". A switch acts at once and only in this browser: what was switched is kept in `localStorage` (`e2a2o.bricks`), every other brick follows its `defaultOn`, and other windows of the same browser follow along. A view switched off while it's shown hands the window back to the map.

## The playground

`ui/bricks.html?brick=<id>&sample=<name>` mounts one brick as the app does, against a map from `samples/` replayed through the window's own reducer (`sample=empty` for none). Every brick is there, the template too. What the brick asks for is answered as the app would (a thought it adds lands on the thread you're on 1.2 s later; `openThread` moves your place) and logged on the right. "Add a thought" and "Talk, then shout" fire `landed` and `loudness`; "Core away" sets `map.connected` to false.
- While building: `cd ui && npm run dev`, then open `http://localhost:5173/bricks.html?brick=<id>`; it reloads on every save.
- Built: `npm run build` builds it after the app, into `ui/dist`, and the core serves it at `/bricks.html` on this laptop.

## A builder's rules

1. Copy the template: `cp -R ui/src/bricks/_template ui/src/bricks/<id>`, then put your id where "template" is, in `brick.json`, `index.tsx` and the CSS (its file name and every class).
2. Stay in your folder. Import only `../contract`, React and Motion. A new package, a model or a field in the contract is the hub's call: ask. Runtime models must be Meta's (the hackathon's rule).
3. Start off: `defaultOn: false`. Set `demoSafe: true` only once it works on an empty map and a full one, at a phone's width, and asks for nothing before a click.
4. Work in the playground: a full map, the empty one, a phone's width and dark mode (DevTools emulates both).
5. Done when `node scripts/bricks-check.mjs <id>` passes, after `cd ui && npm run build`.

`scripts/bricks-check.mjs` holds: every folder's `brick.json` (the app's own rule) and default export; imports (only `../contract`, React, Motion and the folder's own files; no `<header>`); CSS (every selector names one of the brick's classes, keyframes too, and every class styled is used); `contract.ts` takes only types from the app; each brick mounts in the built playground on a full map, an empty one and at a phone's width, with no error and nothing running off the side. Run for all bricks, it also checks the app: at their defaults bricks add nothing to the first screen; the Catalog lists every brick; each view brick, switched on, joins Map and Palace, shows in the map's place and hands back to the map; a switch survives a reload; `?level` still shows the Level meter. A planted breach of each folder rule is caught, so the check can't pass by missing one.

## The bricks so far

- `level` (panel, off): the `?level` meter of the loudness readings the core hears, for setting a volume app's level. Moved here from `Level.tsx` unchanged: `?level` shows it, and without it nothing loads.
- `_template` (card): the brick to copy.
