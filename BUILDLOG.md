# Build log

One entry per session. Date, what was tried, what broke, what was learned.
Write it for yourself, not for a reader. Specifics beat summaries: the exact
error message, the number that was wrong, the thing that turned out to be
false.

Copy this template for each new entry.

```markdown
## YYYY-MM-DD

**Worked on:**

**What broke:**

**What I learned:**

**Decisions:**

**Unverified:**

**Next:**
```

---

## 2026-08-30

**Worked on:** Scaffolding only, no access-method logic.

- Next.js 16.3.3, React 19.2.8, TypeScript, Tailwind v4, App Router, no `src/`.
- `@mediapipe/tasks-vision` 1.0.1. Face Landmarker in VIDEO running mode,
  blendshapes and transformation matrix both on, GPU delegate with CPU
  fallback.
- `lib/camera/useCamera.ts`: getUserMedia mapped onto named states.
- `lib/vision/useFaceLandmarker.ts`: the rAF detection loop.
- `/debug`: live camera and all 52 blendshapes, sorted descending.
- Stubs with types and signatures only, every method throws: `GestureSwitch`,
  `HeadPointer`, `GazePointer`, `ScanEngine`.

**What broke:**

- The React 19 compiler lint in `eslint-config-next` is stricter than expected
  and rejected two patterns that are conventional in older React:
  - `onResultRef.current = onResult` written during render. Fix: assign it in
    an effect. Being one commit stale does not matter for a callback that a rAF
    loop reads.
  - `useCamera` returning `{ videoRef, status, ... }`. The compiler treats the
    entire returned object as a ref once a ref is inside it, so every read of
    `camera.status` in JSX became a "cannot access refs during render" error.
    Fix: the caller creates the ref and passes it in. Both hooks now take
    `videoRef` as a parameter, which is more consistent anyway.
- ESLint was linting the 36 MB of vendored MediaPipe WASM glue in `public/` and
  producing thousands of warnings. Added a global ignore.

**What I learned:**

- MediaPipe throws if `detectForVideo` gets a timestamp that is not strictly
  increasing. rAF fires faster than the camera produces frames, so any tick
  where `video.currentTime` has not advanced has to be skipped. Without that
  guard the loop throws constantly. Detection is capped by camera frame rate,
  not by rAF.
- A throwing detector throws every single frame. The loop cancels itself on the
  first throw instead of filling the console.
- The blendshape list really is 52 including `_neutral` at index 0, confirmed
  against the model rather than assumed.
- Inference measured 31 to 40 ms per frame in headless Chromium with software
  WebGL. On real hardware it should be well under that, but this is worth
  measuring on the oldest machine anyone will actually use, because a slow
  detector directly degrades dwell timing later.

**Decisions:**

- **Self-host the WASM and the model, no CDN.** No third-party request happens
  while a camera is open, the runtime cannot drift from the installed package
  version, and it works offline. Cost: 36 MB of WASM, gitignored and copied out
  of `node_modules` by a prebuild script, plus a 3.6 MB model committed to the
  repo.
- **No `autoStart` on the camera.** It is only ever opened by an explicit call
  from a user gesture, so nobody lands on a page and gets a permission prompt
  they did not ask for. It also keeps Safari happy.
- **Results leave the detection loop through a callback, not React state.** A
  setState per frame at 60 Hz would starve the detector whose numbers are being
  measured. `/debug` renders at 15 Hz off a ref.
- **`noindex` for now**, one line in `app/layout.tsx`. An unfinished AAC tool
  being found in search by a family who needs one is worse than being hard to
  find.
- **The debug list has a "model order" toggle** as well as sort-by-value. A list
  that re-sorts fifteen times a second is impossible to read a single value off,
  which is exactly what you need to do when binding a switch to a blendshape.

**Unverified:**

- **UNVERIFIED, needs human test: a real webcam.** Everything below was verified
  against Chrome's fake capture device fed a still portrait through
  `--use-file-for-fake-video-capture`, in headless Chromium. What that did
  confirm, end to end: camera reached `ready` at 640x480, model reached `ready`
  on the GPU delegate, the rAF loop ran at 15 fps with no page errors, a face
  was detected, and exactly 52 uniquely-named blendshapes rendered sorted
  descending with model indices matching `lib/vision/blendshapes.ts`, no drift
  warning. What it did not exercise: a real permission prompt, real device
  enumeration, real lighting, motion, or frame rate.
- **UNVERIFIED, needs human test: every camera failure branch.** The five error
  states in `useCamera` (denied, not-found, in-use, insecure-context,
  unsupported) are mapped from the documented DOMException names. None have been
  triggered for real. Worth deliberately provoking each one: deny the prompt,
  unplug the webcam, open Photo Booth first, load over plain http on a LAN IP.
- **UNVERIFIED: Safari and Firefox.** Only Chromium has been run.
- **UNVERIFIED: deployment.** Not pushed to Vercel yet. The build passes locally
  and `prebuild` syncs the WASM, but nobody has watched it run on Vercel.

**Open questions, deliberately not decided:**

- No license chosen. MediaPipe is Apache-2.0.
- No cache headers on the WASM or the model. Long-lived immutable caching would
  help a lot on a slow clinic connection, but the paths are not content-hashed,
  so a model swap would serve stale bytes. Needs a hashed path before it is safe.
- `lib/access/types.ts` is a first sketch of the shared contract, written so the
  stubs could reference each other. Nothing depends on it yet. Replace it freely
  once the first real method works.
- The gaze error figure is currently only in prose. At some point it needs to be
  a number the UI renders, not a claim in a README.

**Next:**

- Turn one blendshape into a switch. `jawOpen` or `browInnerUp`, threshold,
  dwell, hysteresis, refractory period. This is the single most important
  component in the project.
