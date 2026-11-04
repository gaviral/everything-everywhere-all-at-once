Thought replay is an optional panel. In Features, switch on **Thought replay**, then choose **Replay thoughts** beneath the map name. It starts off and does not change the map or call a model. Its own scrolling surface works over both empty and populated maps without changing the host layout.

Each current placed thought is one stop, including replies. **By time** follows when thoughts were said, with map arrival order breaking ties. **By topic** follows the map’s topic order, then time within each topic. Waiting thoughts and sources without a live topic stay out. This is a trail of current records, not a reconstruction of past edits.

**Previous**, **Next** and **Play** leave time to read the point and original words. Playback starts only on a click, uses a minimum six-second reading interval at normal pace, and pauses for editing, a hidden tab, an offscreen view, disconnect or a removed source. Pace and order changes pause it too. Long text extends the reading interval. Reduced motion needs no special animation mode: stops change without animation.

**Exact original words** discloses the stored text unchanged. **Open original** uses the host’s guarded exact-source navigation and closes replay only when that succeeds. Opening replay again keeps its stop, order and pace for the same map and participant in this window; it returns paused. A removed selected source stays visible with an unavailable message instead of silently selecting another thought. Close replay or Escape returns focus to its launcher.

An empty map opens a clearly labelled example. The example is local, never saved, and its sources cannot be opened on the real map. **Use your map** returns to live records.

Parts: `trail.ts` selects and orders sources and calculates reading time; `playback.ts` owns the cancellable reading clock; `parts.tsx` renders controls and the readable stop; `index.tsx` coordinates the view and visit selection. All styles belong to this folder.

Focused check (synthetic map, isolated headless browser, microphone blocked):

```sh
npm --prefix ui run build
node ui/src/bricks/thought-replay/check.mjs
```

The check retains its screenshots under `.check-artifacts/`. It uses ports 4587 and 4588, and closes only its own server and browser.
