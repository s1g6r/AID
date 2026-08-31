# AID

Free browser software that works out how someone who cannot speak or use their
hands might control a computer, with their head, their eyes, or a single facial
gesture, measures how well each method actually works for them, and gives them
a working communication board to use during the months they spend waiting for
funding approval on a dedicated device.

**Status: scaffolding.** The sensing layer runs and records. None of the access
methods are implemented yet.

Live at **https://aid-blond.vercel.app**, with the debug page at
[/debug](https://aid-blond.vercel.app/debug). Camera access needs https, which
that URL provides, so it works from a phone.

## What this is not

This is a trial and a bridge aid, meant to be used under the supervision of a
speech and language professional. It makes no medical claims, and it should
never be anyone's sole means of communication.

## Privacy

Everything runs in the browser tab. There is no backend, no upload, no
analytics, and no third-party request at runtime. The camera stream is read by
a WASM model running on the same page and never leaves the machine. Both the
model and the WASM runtime are served from this app's own origin rather than a
CDN, so opening the camera does not cause a request to anyone else.

## Running it

Node 20 or newer.

```bash
npm install
npm run dev
```

Then open http://localhost:3000/debug, allow the camera, and put a face in
frame. You should see fifty-two blendshape coefficients updating live.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server. Syncs the WASM runtime first. |
| `npm run build` | Production build. Syncs the WASM runtime first. |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run sync:assets` | Copies the MediaPipe WASM runtime into `public/` by hand |

Camera access needs a secure context. `http://localhost` counts; a bare IP
address on your LAN does not, so testing on a tablet means an https tunnel.

## Layout

```
app/
  page.tsx              Landing page
  debug/page.tsx        Live camera and all 52 blendshapes
  viewer/
    page.tsx            Plots a saved recording. Drawing only.
    DetailChart.tsx     The big chart: axes, crosshair, drag to zoom
    Sparkline.tsx       One channel at thumbnail size
    TraceCanvas.tsx     Device-pixel canvas that redraws on resize
    plot.ts             Series colours, decimation, the line drawing
lib/
  camera/useCamera.ts   getUserMedia with named, recoverable failure states
  vision/
    faceLandmarker.ts   Loads the WASM runtime and the model bundle
    useFaceLandmarker.ts  requestAnimationFrame detection loop
    blendshapes.ts      The 52 names, typed
    assetPaths.generated.ts  Content-hashed asset paths, generated
  recording/
    types.ts            On-disk shape of a recording
    useBlendshapeRecorder.ts  Captures the stream, builds the JSON
    loadRecording.ts    Reads a file back. Descriptive only.
  access/
    types.ts            Shared AccessMethod contract
    GestureSwitch.ts    STUB. One blendshape becomes one switch.
    HeadPointer.ts      STUB. Cursor from head orientation.
    GazePointer.ts      STUB. Cursor from gaze, with visible error bars.
  scanning/
    ScanEngine.ts       STUB. Linear and row-column scanning.
scripts/
  sync-mediapipe-assets.mjs
public/
  models/               Face Landmarker bundle, committed
  mediapipe/wasm/       WASM runtime, generated, gitignored
```

The four files marked STUB contain types and signatures only. Every method
throws. That is deliberate: threshold, dwell, hysteresis, refractory period and
scan rate are the settings that decide whether any of this is usable by a
particular person, and they get written against a real person rather than
guessed at.

## MediaPipe assets

Two things have to be present for the model to load:

1. `public/models/face_landmarker.<hash>.task`, the float16 model bundle.
   Committed to the repo, 3.6 MB, so no build step depends on a download.
2. `public/mediapipe/wasm-<hash>/`, the WASM runtime. About 36 MB, so it is
   gitignored and copied out of `node_modules` by
   `scripts/sync-mediapipe-assets.mjs`, which runs automatically before `dev`
   and `build`.

Copying from `node_modules` rather than pinning a CDN URL means the runtime can
never drift away from the installed `@mediapipe/tasks-vision` version, and the
whole thing keeps working on an offline clinic or school network.

Both paths carry a hash of their own contents, and both are served with a one
year `immutable` cache. That combination is only safe because the path changes
when the bytes change. The sync script enforces it: it names the WASM directory
after the hash of the runtime, refuses to run if the committed model's filename
no longer matches its contents, and writes both paths into
`lib/vision/assetPaths.generated.ts`, which is committed. Upgrading MediaPipe
produces a lockfile diff and a path diff in the same commit.

## Recording sessions

`/debug` can capture the blendshape stream to a JSON file, so thresholds can be
chosen from real data rather than guessed. Label the recording, press start, do
the gesture, press stop, download. The file is built in the tab and saved
locally; nothing is uploaded.

The format is built to load straight into pandas without reshaping:

```jsonc
{
  "format": "aid-blendshape-recording",
  "version": 1,
  "label": "jawOpen x10 slow",
  "recordedAt": "2026-08-31T12:20:21.000Z",
  "sampleRateHz": 15,
  "durationMs": 30000,
  "sampleCount": 450,
  "blendshapeNames": ["_neutral", "browDownLeft", "..."],
  "device": { "userAgent": "...", "capture": {}, "delegate": "GPU" },
  "samples": [
    { "t": 0, "faceDetected": true, "v": [0.0, 0.12, 0.03] }
  ]
}
```

`v` is positional against `blendshapeNames`. A measured ten minute session at
15 Hz is 9,028 samples and 9.6 MB, about 1.1 KB per sample; the same data as 52
key/value pairs per sample would be several times that. It is `null`, not zeros, when no face was
detected: zeros would claim a reading of a neutral face, which is a different
thing from the absence of a reading. Note that `blendshapeNames` is read off the
model the first time a face appears, so a recording with no face in it has an
empty name list.

`sampleRateHz` is the target. Trust each sample's `t` instead, which is
milliseconds since the recording started. Measured spacing is 14.9 to 15.0 Hz
from both 15 and 30 fps cameras, and holds there for at least ten minutes; a
camera running near 20 fps comes out slightly fast, at about 17 Hz, because the
resampler is allowed to take a frame half an interval early.

Loading one:

```python
import json, pandas as pd
rec = json.load(open("aid-jawopen-x10-slow-2026-08-31T12-20-21.json"))
df = pd.DataFrame(
    [s["v"] for s in rec["samples"] if s["faceDetected"]],
    columns=rec["blendshapeNames"],
    index=[s["t"] for s in rec["samples"] if s["faceDetected"]],
)
df.index.name = "t_ms"
```

## Viewing a recording

`/viewer` opens an exported file and plots it. Drop the JSON on the page, or
pick it with the file button; it is read in the tab and not uploaded.

- Every channel gets a thumbnail, so it is possible to scan all 52 at once and
  see which ones moved.
- Up to eight can be plotted together on the big chart. Drag across it to zoom
  into a stretch of time, double click to zoom back out, hover to read values
  off the traces.
- Stretches where the model found no face are shaded, and the line breaks
  across them rather than being drawn through a value nobody measured.

It draws lines and nothing else. There is no peak finding, no thresholding and
no notion of a gesture anywhere in it, deliberately: the point is to look at the
shape of a real signal before choosing any numbers from it, and a tool that has
already decided where the interesting parts are is no use for that.

Opening the 9.6 MB ten minute recording takes about 110 ms and costs about
9 MB of heap.

## Deploying

Vercel, no configuration needed. `npm run build` triggers the asset sync through
its `prebuild` hook, so a clean clone deploys correctly.

Deploys are currently manual, from this directory:

```bash
npx vercel deploy --prod
```

Push-to-deploy is not connected yet. `vercel git connect` fails with "You need
to add a Login Connection to your GitHub account first", which needs a GitHub
login method added to the Vercel account in the browser. Once that is done,
`npx vercel git connect` links the repo and every push to `main` deploys.

The site is currently set to `noindex`. An unfinished AAC tool turning up in
search results and being found by a family who needs one is a worse failure
than being hard to find. That is one line in `app/layout.tsx` when there is
something real to show.

## Prior art

This is not a new category, and it should not be described as one.

- **Google Project Gameface**, open source, MediaPipe Face Landmarker driving a
  head and gesture cursor, built with disabled gamer Lance Carr
- **Camera Mouse**, Boston College, free head tracking with roughly twenty years
  of real users
- **OptiKey**, open-source eye-gaze keyboard, Windows, needs a hardware tracker
- **Cboard**, open-source web AAC with switch support
- **WebGazer**, browser gaze estimation

On accuracy: WebGazer reports around 4.17 degrees of visual angle of average
error, roughly 1.6 inches on screen. Research-grade Tobii trackers run 0.4 to
0.9 degrees. Browser gaze can separate a handful of large targets. It cannot
drive a sixty-cell symbol board, and this project will not claim it can.

## License

MIT, see [LICENSE](LICENSE). `@mediapipe/tasks-vision` and the Face Landmarker
model bundle are Apache-2.0, from Google.
