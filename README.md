# AID

Free browser software that works out how someone who cannot speak or use their
hands might control a computer, with their head, their eyes, or a single facial
gesture, measures how well each method actually works for them, and gives them
a working communication board to use during the months they spend waiting for
funding approval on a dedicated device.

**Status: scaffolding.** The sensing layer runs. None of the access methods are
implemented yet.

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
lib/
  camera/useCamera.ts   getUserMedia with named, recoverable failure states
  vision/
    faceLandmarker.ts   Loads the WASM runtime and the model bundle
    useFaceLandmarker.ts  requestAnimationFrame detection loop
    blendshapes.ts      The 52 names, typed
    assetPaths.generated.ts  Content-hashed asset paths, generated
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

## Deploying

Vercel, no configuration needed. `npm run build` triggers the WASM sync through
its `prebuild` hook, so a clean clone deploys correctly.

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
