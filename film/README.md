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
| `card` | `word`, `seconds`, `colour` (default Meta blue) |
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
`label` and `caption` remain fixed and readable outside camera motion. Mark
each shortened wait with `caption: "wait shortened"`. Never use a hold or a
crop to invent a result. The end card uses the current app icon.

Focused verification: `node film/cut-check.mjs`. It checks cache reuse, isolated
shot and clip changes, recovery after one missing clip, concatenation, captions,
cropping, and the preview/final profiles without rendering the whole film.

## Directed shots

A plane can enter with `tilt: [x,y,z]` and settle to `tiltTo: [x,y,z]` over
`settleSeconds` (default 0.7). Rotation uses smooth interpolation independently
of the slow `drift` and `zoom` camera. `background: "meta"` selects the Meta-blue
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
