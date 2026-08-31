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

---

## 2026-08-31

**Worked on:** Verification, deployment and recording plumbing. No access-method
logic; the four stubs are untouched.

- Deployed to Vercel. Live at https://aid-blond.vercel.app, `/debug` included.
- MIT license added.
- Both MediaPipe assets are now content-addressed and served immutable.
- Session recording on `/debug`: start, stop, discard, label, download as JSON.
- Provoked the camera error branches, with mixed success. Details below.
- Ran the whole pipeline in Firefox 153.

**What broke:**

- **The recorder was sampling at half the rate it claimed, and I only found it
  by measuring.** A plain `now - lastSample < minGap` gate silently halves the
  rate whenever the camera runs near the target: at 15 fps every frame lands a
  fraction of a millisecond short of the 66.67 ms gate, gets rejected, and the
  one after is taken instead. Measured 127 ms median gap, 7.9 Hz, against a
  nominal 15 Hz. If I had shipped this and then tuned thresholds tomorrow, the
  data would have looked fine and been half as dense as labelled.
- **Then the fix had its own bug.** Measuring the gap from the last sample
  taken rather than from a fixed grid lets early frames drag the schedule
  forward, so a 20 fps source got taken in full at 20 Hz. Now decimates against
  an absolute grid with a half-frame-interval tolerance. Measured after: 14.9 Hz
  from both 15 and 30 fps sources. A ~20 fps source still comes out slightly
  fast at about 17 Hz, which I am accepting and have documented rather than
  chasing, since every sample carries its own timestamp.
- **Headless Chromium cannot tell permission failures apart.** Trying to
  provoke `denied` for real, getUserMedia rejected with `NotSupportedError`, not
  `NotAllowedError`. Probed it four ways (fake device or not, permission granted
  or not) and got `NotSupportedError` every time, even with the permission
  granted and a device present. Its media stack refuses outright unless
  `--use-fake-ui-for-media-stream` is passed. So neither `denied` nor
  `not-found` is reachable in this environment.
- `vercel git connect` failed: "You need to add a Login Connection to your
  GitHub account first". Needs a GitHub login method added to the Vercel account
  in a browser. Deploys are manual until then.

**What I learned:**

- `NotSupportedError` is not in the getUserMedia spec's list of rejections, but
  Chromium emits it from builds that cannot capture at all. It now maps to the
  `unsupported` state instead of falling through to the generic message.
- Firefox 153 is dramatically faster at this than headless Chromium: 58 fps
  detection and 6 ms inference, against 15 fps and 31 ms. Not a fair comparison
  (Chromium was on software WebGL and being fed a video file) but worth
  remembering that the headless numbers are a floor, not an estimate.
- Playwright's Firefox does not accept `"camera"` as a context permission. Use
  the `media.navigator.streams.fake` and `media.navigator.permission.disabled`
  prefs instead. With permission prompts left enabled it just hangs.
- A recording with no face in it has an empty `blendshapeNames`, because the
  names are read off the model the first time a face appears rather than
  hardcoded. Honest, slightly awkward, documented in the README.

**Decisions:**

- **Content-address both assets rather than add cache headers alone.** The WASM
  runtime goes to `public/mediapipe/wasm-<hash>/` and the model is committed as
  `face_landmarker.<hash>.task`. Immutable caching is only safe if the path
  changes when the bytes do, so the sync script enforces it: it refuses to run
  if the model's filename no longer matches its contents, and writes both paths
  into `lib/vision/assetPaths.generated.ts`, which is committed. Upgrading
  MediaPipe now produces a lockfile diff and a path diff in one commit.
- **Recording values are `null` when no face is detected, not zeros.** Zeros
  would be a reading of a neutral face, which is a different claim from there
  being nothing to read.
- **Values are stored positionally against `blendshapeNames`**, not as 52
  key/value pairs per sample. A ten minute session is about nine thousand
  samples; flat keeps that to a few MB and loads into pandas without reshaping.
- **Added a free-text label** that goes into the filename. Not asked for, but
  the alternative is a folder of indistinguishable timestamps tomorrow.
- **Samples never enter React state.** Nine thousand of them would re-render
  the page every frame and starve the detector being recorded.
- `RECORD_HZ` in `app/debug/page.tsx` is one constant. If 15 Hz turns out too
  coarse for dwell tuning, raising it to 60 records every frame the detector
  produces.

**Verified this session:**

- Live deployment serves the real app publicly, not a login wall, on
  https://aid-blond.vercel.app. The team-scoped `*-s1g6rs-projects.vercel.app`
  URLs are behind Vercel SSO and 302; the production alias is not.
- Full pipeline against the live https URL, headless Chromium fed a portrait
  through `--use-file-for-fake-video-capture`: 52 uniquely-named blendshapes,
  recording downloaded, 46 samples at 14.9 Hz, all values in 0..1, no page
  errors.
- Deployed assets return `cache-control: public, max-age=31536000, immutable`
  with `content-type: application/wasm`, and the old unhashed paths 404.
- Firefox 153: camera ready, model ready on the GPU delegate, 58 fps, recorder
  produced 46 samples at 14.9 Hz, no page errors.
- Sample rate at three source frame rates: 15 fps to 14.9 Hz, 30 fps to 14.9 Hz,
  ~20 fps to 17.5 Hz.

**Camera error branches, exactly how each was reached:**

| Branch | How | Result |
| --- | --- | --- |
| `insecure-context` | **REAL.** Served over plain http on the LAN IP, `http://192.168.4.28:3111/debug` | Correct state, `SecurityError`, right message and hint |
| `in-use` | **FAULT-INJECTED.** `getUserMedia` overridden to reject with `NotReadableError` | Correct state and copy. Proves the mapping, not the browser |
| `unsupported` | **FAULT-INJECTED.** `navigator.mediaDevices` removed via an init script | Correct state and copy. Also now reached for real by `NotSupportedError` |
| `denied` | **NOT REACHED.** Headless Chromium returns `NotSupportedError` for everything | UNVERIFIED |
| `not-found` | **NOT REACHED.** Same reason | UNVERIFIED |

**Unverified:**

- **UNVERIFIED, needs human test: a real webcam.** Still the big one. Everything
  so far has been a video file or synthetic color bars. Open
  https://aid-blond.vercel.app/debug on the laptop and on a phone.
- **UNVERIFIED, needs human test: `denied`.** Open `/debug`, click Start camera,
  click Block in the browser prompt. Expect "The browser is blocking camera
  access for this page." To reset afterwards, use the camera icon in the address
  bar. On macOS also check System Settings, Privacy and Security, Camera.
- **UNVERIFIED, needs human test: `not-found`.** Easiest on a desktop with only
  an external webcam: unplug it, then load `/debug` and click Start camera.
  Expect "No camera was found that matches what this page asked for."
- **UNVERIFIED, needs human test: `in-use`.** Open Photo Booth or a Zoom test
  call first, then `/debug`. Expect "A camera exists but another program is
  already using it." Fair warning: macOS can share a camera between
  applications, so this may simply work instead of failing, in which case try it
  on Windows or skip it.
- **UNVERIFIED: Safari.** Not tested at all. Safari is the one most likely to
  behave differently on getUserMedia and on autoplay, and it is what an iPhone
  will use. Test it before showing this to anyone.
- **UNVERIFIED: whether 15 Hz is dense enough** to tune a 300 ms dwell against.
  Four or five samples inside a dwell may turn out too coarse.
- **UNVERIFIED: recording sessions longer than about three seconds.** Every
  recording tested was a three second smoke test. A ten minute session at 15 Hz
  is roughly nine thousand samples and has never been run, so memory growth and
  the download size are untested.

**Open questions, still deliberately not decided:**

- No marker or event track in a recording, so knowing which segment is which
  means one gesture per file. If that gets tedious, a "mark" button is the
  obvious addition, but it edges toward interpreting the data so it is yours to
  design.
- `lib/access/types.ts` is still a first sketch. Nothing depends on it.
- Push-to-deploy still needs the GitHub login connection on the Vercel account.

**Next:**

- Record yourself doing candidate gestures and look at the traces before
  choosing any numbers.
- Then `GestureSwitch`: threshold, dwell, hysteresis, refractory period.
