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
