# Film stage

An offline, shot-driven film renderer. Requires Node 22+, Chrome, FFmpeg and
FFprobe on PATH. Set `CHROME_PATH` if Chrome is outside its usual installation.
No packages, network services, microphone, or model runtime are involved.

```sh
node film/cut.mjs /path/to/shots.json --preview --out /path/to/preview.mp4
node film/cut.mjs /path/to/shots.json --final --out /path/to/final.mp4
node film/render.mjs film/shots.example.json --preview
node film/render.mjs film/shots.example.json --clips-dir film/clips --out film/renders/final.mp4
node film/render.mjs film/shots.example.json --preview --from 2 --to 5
node film/mux.mjs film/renders/final.mp4 voice.wav music.wav film/renders/scored.mp4 0.12
node film/check.mjs
```

The default is 1920×1080 at 30 fps; preview is 960×540 at 15 fps with faster
encoding. Frames are evaluated at exact `frame / fps` times, videos are paused
and sought before every screenshot, and no wall-clock animation drives the film.
PNG frames and `render.json` stay beside each take. Existing takes are never
overwritten. `--from` is inclusive and `--to` exclusive, in seconds on the whole
film timeline. Both round up to the next frame boundary. Audio muxing preserves
picture duration, pads short audio with silence, and lowers music to 12% by
default. It does not record audio.

All direction lives in the JSON `shots` array:

| Kind | Fields |
| --- | --- |
| `title` | `words` string or array; `seconds` is total time, evenly divided into word beats |
| `plane` | `clip`, `start` in source seconds, `seconds`, `tilt: [x,y,z]` in degrees |
| `planes` | `seconds`, two or three `clips`, each with plane fields |
| `wall` | `seconds` (usually 8), `tiles` array of `{image}` or `{clip, start?, loopSeconds?}`; first tile is a clip |
| `card` | `word`, `seconds`, `colour` (default black) |
| `list` | `names`, `seconds` **per name**, `colour`; finish with `and much more` |
| `end` | `word` (default E2A2O), `seconds`; current app icon and name |

Camera controls on any shot: `drift: {from: [x,y], to: [x,y]}` and
`zoom: [from,to]`, with smooth interpolation. Coordinates refer to the
1920×1080 composition, including preview. A plane's optional `position: [x,y]`
is its offset from centre; `width` is in composition pixels. Use a large zoom
and drift to isolate a detail after a wider view. `background` accepts CSS
colours or the one-off `muse` gradient. Typography uses the local system font.
Use the same machine, browser and fonts for pixel-identical rerenders.

Clip filenames resolve relative to the shots file. `@clip:0`, `@clip:1`, etc.
select alphabetically sorted MP4s in `--clips-dir` (wrapping if fewer exist).
With no MP4s supplied, these aliases generate clearly reported solid-colour
test footage. Explicit missing files and clips shorter than their shot fail.
Replace test footage with reviewed app captures for the final film. Capture
preparation is separate from this renderer. Do not place private captures or
unlicensed material in the submission.

The original compositions use sparse typography, drifting UI planes, rapid
feature cards, and a quiet brand hold. Reference artwork, music, wording and
shot layouts are not included. The end card uses the current app identity icon.

Decision: Chrome DevTools runs over an inherited pipe, so rendering opens no
listening ports. Scratch Chrome profiles remain in the system temporary
directory; takes remain under the ignored `renders/` folder. No shared app
files or dependencies change.

## Feature wall

Capture from an isolated core with a fresh sample map. Set `FILM_URL` to that
core and `FILM_OUT` to an external media directory, then run
`node scripts/film-wall-capture.mjs`. It reads the same brick folders used by
`BRICKS`, plus `BUILT_INS`, enables one feature per visit, opens view features
through their real Show controls, waits for fonts, images and stable layout,
and writes 1920×1080 PNGs and `capture.json`. The browser denies microphone
permission. No live microphone or generated feature result is used. Features
without a distinct visible state on that sample are listed as skipped.

Build the shot beside that media with
`node film/wall-manifest.mjs WALL_DIR CLIPS_DIR OUTPUT.json`, then pass the
JSON to `film/render.mjs`. This uses every accepted still and every MP4 from
the supplied clips directory. The first clip is `think.mp4`; nothing is
replaced with placeholder footage. Set an individual clip's `start` and
`loopSeconds` to select a shorter excerpt. Missing or short media fails before
rendering. Paths in generated shot files are relative to those files.

The camera reveals nested groups of 1, 4, 16, 64, then every tile. Square cells
keep complete frames inside them, with thin gaps on a dark ground. Small light
changes, camera motion and all looping video seeks use only frame time. The
last frames are black; put the identity's `end` shot after the wall, never in
the zoom. `node film/wall-check.mjs` checks the reveal, backward seeking,
looping media, black ending and exact exported frame count. This is an offline
film tool; it adds no app runtime dependency.

### Detailed square field

`FILM_WALL_STATES=1` enables Paper capture and records actual input, selection,
and result states. `FILM_SELECT_STATES=1` visits the feature's selectors;
`FILM_DEEP_STATES=1` also visits connected topics and part dimensions, pins
source thoughts, and saves fictional repair-night questions on the scratch map.
Read-only fields and microphone controls are excluded. Use a fresh scratch
core and external output folder for these captures.

`film/square-crops.py` finds high-detail square regions, follows changed regions
in subsequent states, and rejects sparse or visually repeated crops. It needs
Pillow and NumPy, only as offline tooling. `film/wall-2-media.py MEDIA_ROOT`
combines these state folders with real clip excerpts, writes the crop/rejection
audit, enforces at least 200 unique tiles and at most one-third dark tiles, and
creates `wall-2-shots.json`. It never pads the count with repeated frames.

The `wall` shot's `layout: "field"` fills a 16×9 base grid with square tiles.
Some cells contain four smaller squares, so a field of hundreds fits exactly,
without partial rows. Related activity states remain together. Its opening
retains the original finished Repair Night frame, then crops naturally into
the first square during a single smooth pull-back. The field holds for one
second and lifts to white, retaining “Recorded demonstrations”. All movement
and video seeking are evaluated at frame time. A fixed-resolution software
canvas with fixed bilinear sampling keeps image resampling independent of earlier camera frames.
Stills are decoded and frozen at native resolution before zooming; field frames
export directly from that canvas. Checks compare decoded pixels, including a
second fresh renderer, rather than PNG compression bytes.
`wall-field-check.mjs` checks
complete square coverage and writes eight actual review frames; review those
at film size before accepting a take.

## Incremental cut

`cut.mjs` is the working-film entrypoint. By default its shots, `cuts/`, and
`renders/` live in the external film media folder. Use `--cuts-dir` and
`--out` to select another media root. Preview is 960×540 at 15 fps; final is 1920×1080 at
30 fps. Three independent shots render at a time, directly into encoders.

Each cut is named by SHA-256 of the shot, rendering code, logo, profile, and
source clip bytes. Moving a shot in the sequence does not invalidate it.
Changing a clip invalidates only shots using that clip; changing shared stage
code invalidates all affected compositions. Complete cuts are checked before
reuse. A failed shot is reported while the other workers continue. Rerun the
same command to resume. The full film joins only when every shot succeeds,
using FFmpeg stream copy. Prior full-film versions and interrupted partials
are retained. The adjacent JSON reports cached/rendered shots and failures.

Planes accept `crop: [x,y,width,height]` in normalized source coordinates and
`playSeconds` to hold the last real frame after that much source playback.
No disclosure or fine-print line is displayed; per-shot `label` and
`caption` metadata are not displayed. Never use a hold or a crop to invent a result. The end card uses the current app icon.

Focused verification: `node film/cut-check.mjs`. It checks cache reuse, isolated
shot and clip changes, recovery after one missing clip, concatenation, captions,
cropping, and the preview/final profiles without rendering the whole film.

## Directed shots

A plane can enter with `tilt: [x,y,z]` and settle to `tiltTo: [x,y,z]` over
`settleSeconds` (default 0.7). Rotation uses smooth interpolation independently
of the slow `drift` and `zoom` camera. `background: "meta"` selects the quiet white-to-mist
stage gradient. `fullFrame: true` removes the plane edge for an already-rendered
wall movie. The end card has a centered icon/name, a `tagline`, and plain
`credits` beneath it.

An optional `frames: {preview: integer, final: integer}` pins each shot's frame
allocation. This lets fractional-second chapter cards share rounding within a
chapter while the complete cut ends at exactly the intended time. Cache keys
include that allocation. Every assembled cut writes a `.times.txt` sidecar
with actual frame-aligned start times, stable shot ids, and durations.

`node film/direction-check.mjs /path/to/shots.json` checks the directed 150-second
edit's chapter clocks, frame allocations, readable settling, repeatable camera,
and end-card wording. Its screenshots stay with the external media.

## Investor edit

`pulse` uses `words`, `delay`, and `beat` for the black opening. `feature`
uses `word` for a compressed, blurred entrance on the blue field, with optional
`shrink` for the final abundance card. `laptop` uses a real `clip` inside an
unbranded device; `phase` selects `rise` or `push`. `brand` selects `opening`,
`assembly`, or `hold` and builds from the canonical icon SVG before crossing
to the glass PNG. Only the quiet model credit remains beneath the final hold.

A plane may use an `image` instead of a `clip`. Optional `rate` changes source
playback speed without changing the shot allocation. Each input and source
window stays with its stable shot id. A fractional final-frame display interval
lets the stream-copy join hit the specified millisecond endpoint exactly.

`node film/film3-check.mjs /path/to/shots.json` exercises the word timing,
canonical-shape assembly, matching final hold, laptop motion, clean overlays,
and fractional endpoint. It uses external media and never starts a microphone.

## Final pass

The stage uses a 68-degree gradient from white to mist, with neutral soft
shadows and no bright plane edge. Chapter and feature-name cards use black.
Per-shot headings and disclosure fields are ignored. The only final credit is
“Muse Spark · Muse Image · Muse Voice Transcribe”. Title exports can be used as
full-frame planes, split at existing shot boundaries with their final frame held.

`node film/final-check.mjs /path/to/shots.json` checks the final palette,
credit-only ending, latest source ranges and 1080p/30 export format.
