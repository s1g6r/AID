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

---

## 2026-08-31 (evening)

**Worked on:** Verification and one tool. No access-method logic; the four
stubs are still untouched.

- Ten minute soak of the recorder, with real heap measurements rather than
  reassurance.
- `/viewer`: opens an exported recording and plots it. Drawing only.

**The soak, and the actual numbers:**

Ten minutes, headless Chromium, production build served by `next start`, fed a
30 second 640x480 30 fps looping y4m of a face with a slow pan so the values
move rather than repeat a single frame. Heap read through CDP
`HeapProfiler.collectGarbage` followed by `Runtime.getHeapUsage`, so every
figure is what survived a forced full GC, not what happened to be uncollected.

Rate, per minute, computed from the sample timestamps in the exported file and
not from wall clock:

| minute | samples | Hz |
| --- | --- | --- |
| 0 | 901 | 15.00 |
| 1 | 899 | 15.01 |
| 2 | 899 | 14.98 |
| 3 | 900 | 15.00 |
| 4 | 901 | 15.01 |
| 5 | 899 | 14.99 |
| 6 | 900 | 15.00 |
| 7 | 900 | 15.00 |
| 8 | 900 | 15.00 |
| 9 | 900 | 15.00 |

Overall 9,028 samples across 601,869 ms, 14.998 Hz. No drift, no decay, no
dropped stretch. Gaps between samples: min 31 ms, median 67 ms, p99 96 ms, max
131 ms, and zero gaps over 200 ms in ten minutes. Timestamps strictly
increasing throughout. Detection ran at 26 to 31 fps the whole time (mean 29.2)
with inference at 26.9 to 42.5 ms (mean 32.2), so the detector never became the
bottleneck the recorder was decimating from.

Heap, after a forced GC each time:

| when | heap used | heap total | DOM nodes | listeners | samples held |
| --- | --- | --- | --- | --- | --- |
| before recording | 6.81 MB | 7.83 MB | 756 | 358 | n/a |
| 0 min | 7.04 MB | 7.83 MB | 779 | 357 | 0 |
| 2 min | 8.76 MB | 9.94 MB | 779 | 361 | 1,805 |
| 5 min | 10.31 MB | 11.89 MB | 779 | 357 | 4,512 |
| 10 min | 13.90 MB | 15.53 MB | 779 | 353 | 9,021 |
| after stop | 14.01 MB | 15.53 MB | 776 | 358 | 9,028 |
| after download | 13.97 MB | 15.53 MB | 782 | 363 | 9,028 |

Growth is 6.86 MB over ten minutes, about 797 bytes per sample, and linear:
999, 760 and 797 bytes per sample measured over the first two, five and ten
minutes. DOM node count was 779 at two, five and ten minutes, identical to
three significant figures, so the 15 Hz re-render of 52 rows for ten minutes
leaks no nodes. Listener count wandered between 353 and 363 with no trend. Zero
page errors for the whole run; the only console output was three MediaPipe
startup lines and four WebGL driver performance warnings.

The exported file: 10,082,258 bytes, 9.62 MB. Parses. `sampleCount` 9,028
matches `samples.length` 9,028. All 9,028 samples carry all 52 values, every
value in 0..1, no NaN, no nulls, last timestamp 601,869 ms, and the last bytes
of the file close the JSON. Nothing truncated, nothing degraded. 415 ms from
clicking Download to the browser receiving the file.

**The growing array, since it was asked about directly:**

Yes, it is one array that grows for the length of the session, each entry
holding a fresh 52-element array. At ten minutes that is 6.86 MB of retained
heap, measured, and it is not a problem. Extrapolating the linear growth, thirty
minutes is roughly 21 MB retained and a 29 MB file. Also not a problem for
memory.

What actually scales badly is the export, not the recording. Measured separately
by building a structure of the same shape and size in a bare page and taking a
GC'd reading while holding each stage alive:

| held | heap |
| --- | --- |
| the samples array alone | 4.06 MB |
| plus the JSON string | 13.02 MB |

So `JSON.stringify` roughly triples peak heap for the moment it runs, because
the whole session has to exist twice at once. The synthetic string came out at
9,397,829 characters against the real file's 10,082,258 bytes, close enough to
use: on the app's own measured 13.90 MB that puts the export peak around 23 MB
for a ten minute recording and, extrapolated, around 55 MB for a thirty minute
one. Still fine on a laptop, worth knowing before anyone tries an hour.
`JSON.stringify` itself took 11 ms.

One thing worth watching: `Runtime.getHeapUsage` drops from 13.02 MB back to
4.07 MB the instant `new Blob([json])` is constructed, while the string is still
referenced and still readable (`length` 9,397,829, `charCodeAt` works). The
bytes did not go away, they left the V8 heap for blob storage. So heap readings
taken after the Blob exists understate what the process is holding.

**What broke:** nothing in the app. The two things that broke were mine:

- The first fake video source cropped the head off. A centre crop of a portrait
  is a crop of a necktie, and the soak ran a clean full minute at exactly 15 Hz
  with `faceDetected: false` on all 901 samples. The rate numbers were real, the
  test was worthless. Framed the crop on the face and re-ran. Worth remembering
  as a way this rig lies: every metric can look right while nothing is being
  measured.
- The recorder's `estimatedBytes` is wrong by 2.8x. It assumes 404 bytes per
  sample (52 x 7 + 40); the real file is 1,116.8 bytes per sample. The UI said
  "approx size 3560 KB" for a file that turned out to be 9.62 MB. It is a
  display estimate and no data is affected, so it is written up rather than
  quietly patched.

**The viewer:**

`/viewer`, client-only, reads the file in the tab and uploads nothing.

- All 52 channels as thumbnails, so which channels moved is one glance rather
  than 52 clicks. Sortable by range in the file or by model order.
- Up to eight plotted together on a big chart, drag to zoom, double click to
  reset, hover for a crosshair and a value readout per series.
- Stretches with no face are shaded and the line breaks across them. Drawing a
  line through a null would draw a value nobody measured.
- Canvas, not SVG: 9,000 points times 52 channels is not something to hand a
  DOM.

**Decisions:**

- **The viewer draws and nothing else.** No peak finding, no thresholds, no
  gesture anything, on purpose. It is for looking at a signal before choosing
  numbers from it, and a tool that has already decided where the interesting
  parts are is no use for that.
- **Sort by range is in, and it is a judgement call.** It puts the channels that
  travelled furthest at the top, which is the difference between a usable tool
  and 52 checkboxes. It is descriptive, it is labelled in the UI as a sort order
  and nothing more, and model order is one click away. If it feels like the tool
  pointing at an answer, delete it, the code is four lines.
- **Colour belongs to a channel, not to a position.** Selections are held in
  eight fixed colour slots, so unpicking one series never repaints the others.
- **Eight series maximum**, because that is how many colours are distinguishable
  and a ninth would have to be a repeat.
- **Series colours were validated, not chosen by eye**, for colour-vision
  separation and contrast against this project's own light and dark surfaces.
  Three of the light steps fall below 3:1 on white, which is why every series
  also carries its name in the legend and, at four or fewer, at the end of its
  own line. Colour is never the only thing telling two lines apart.
- **The y axis defaults to 0..1**, the range the model actually reports, with
  fit-to-range as an option. A chart that autoscales by default makes a channel
  that never left 0.02 look like a gesture.

**Verified this session:**

- Ten minute recording holds 14.98 to 15.01 Hz in every one of ten one-minute
  windows, with the numbers above.
- Heap growth over ten minutes is 6.86 MB, linear, and DOM node count is flat.
  No page errors.
- The 9.62 MB export is well formed, complete and not truncated.
- The viewer opens that same 9.62 MB file in 114 ms for 9.3 MB of heap, renders
  52 thumbnails and the detail chart with non-blank pixels, plots four channels,
  zooms by drag to a 64 second window, reads values off the trace under the
  cursor, and resets. Zero page errors.
- Viewer failure paths, each with a real file: a truncated/invalid JSON, a valid
  JSON with the wrong `format`, and a real recording that contains no face at
  all (all values null, no channel names). Each gives its own message instead of
  a blank page or a stack trace.
- Face-gap rendering, against a recording doctored to contain three no-face
  runs: shaded bands appear and the line breaks across them.
- Dark mode rendered and looked at, not assumed.
- `npm run lint`, `npx tsc --noEmit` and `npm run build` all clean.

**Unverified:**

- **UNVERIFIED: everything about a real webcam, still.** Every number in this
  entry came from a video file played into Chrome's fake capture device. The
  soak proves the recorder holds its rate against a source that never stutters,
  never changes exposure and never loses the face. A real camera in a real room
  does all three. Re-run something like this once there is a real recording.
- **UNVERIFIED: 30 minutes.** The 21 MB and 55 MB figures above are linear
  extrapolation from four measured points, not measurements. Linear is the right
  model for an array that grows by a fixed amount per sample, but nobody has run
  it.
- **UNVERIFIED: the export peak as one observed reading.** 23 MB is the app's
  measured 13.90 MB plus the separately measured 8.96 MB the JSON string costs.
  The transient itself was never captured in a single reading: `JSON.stringify`
  blocks the main thread, so nothing on that thread can observe the peak while
  it exists.
- **UNVERIFIED: the viewer on a phone.** Only ever opened at 1400px wide. The
  layout is responsive but drag-to-zoom on a touch screen has not been tried.
- **UNVERIFIED: the viewer in Firefox or Safari.** Chromium only.
- Everything still open from this morning: `denied` and `not-found` still need a
  human, Safari is still untested, and whether 15 Hz is dense enough to tune a
  300 ms dwell against is still an open question, though the traces in the
  viewer should now answer it by eye.

**Open questions, still deliberately not decided:**

- `estimatedBytes` is 2.8x low. Easy to fix by measuring one serialised sample
  and multiplying, but it is a cosmetic number and the fix is a decision about
  how much cost to put on the hot path.
- Still no marker or event track in a recording, so it is still one gesture per
  file. The viewer makes this more noticeable, not less: the obvious next thing
  when looking at a ten minute trace is wanting to label a stretch of it.
- `lib/access/types.ts` is still a first sketch. Nothing depends on it.

**Next:**

- Record real gestures on a real face and look at them in the viewer.
- Then `GestureSwitch`, with numbers read off those traces.
