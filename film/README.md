# Film stage

An offline, shot-driven film renderer. Requires Node 22+, Chrome, FFmpeg and
FFprobe on PATH. Set `CHROME_PATH` if Chrome is outside its usual installation.
No packages, network services, microphone, or model runtime are involved.

```sh
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
| `end` | `word` (default E2A2O), `seconds`; original geometric mark and name |

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
shot layouts are not included. The sample end mark is a placeholder original
graphic; replace it in the stage when final identity art is ready.

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
and video seeking are evaluated at frame time. `wall-field-check.mjs` checks
complete square coverage and writes eight actual review frames; review those
at film size before accepting a take.
