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
  and nothing more, and model order is one click away. Kept after review, with
  the condition that nothing cleverer is ever layered on top of either order.
- **Nothing is plotted until a channel is picked.** The first version auto-
  selected the widest-ranging channel so the chart would not be empty on open.
  That is the page nominating a channel as the interesting one, which is the
  single judgement it exists not to make, so it is gone. The empty chart says
  "pick a channel below" instead.
- **Both sort orders are one keystroke as well as one click.** `s` toggles
  between them, and the key is written next to the buttons, because a shortcut
  nobody can see does not exist. Two orders, both plain, neither ranked above
  the other.
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

**The harness is committed now, in `test-harness/`:**

`soak-test.mjs`, `verify-viewer.mjs` and `serialize-probe.mjs`, with a README
covering how to run each and the exact `ffmpeg` command that builds the fake
camera source. They were throwaway scripts in a temp directory; every number in
this entry came out of them, and none of it would have been reproducible next
week.

Playwright is deliberately **not** a dependency. It resolves at runtime, from
normal resolution or a `PLAYWRIGHT` env var, and prints install instructions if
neither works. A project whose entire build is a static export should not carry
browser downloads for three scripts that run by hand a few times a month.

`soak-test.mjs` is the regression test for what comes next: once `GestureSwitch`
runs on every frame, the question is whether it costs frames, and that shows up
here as a sample rate that no longer holds at 15 Hz under the same ten minute
conditions.

**End of the pure-infrastructure phase.**

Everything up to here is plumbing: camera, model, detection loop, recorder,
deployment, viewer, harness. None of it decides anything about a person. The
next commit that matters is `GestureSwitch`, and it gets written against real
recorded traces rather than guessed at, which is the entire reason the recorder
and the viewer exist.

The four stubs are still untouched, and still throw.

**Next:**

- Record real gestures on a real face and look at them in the viewer.
- Then `GestureSwitch`, with numbers read off those traces.

---

## 2026-09-01 — First GestureSwitch numbers

Analyzed the iPhone recording from 08-31 (aid-recording-2026-08-31T20-42-37_2.json).

jawOpen: rest ~0.001, peak 0.85 — clean separation, near-zero baseline.
browInnerUp: rest ~0.05-0.09 drifting to ~0.33 by end of clip — noisier
baseline, possibly face position drift over the 28s clip. Not using this
one for v0.

Picking jawOpen as the first switch channel.

Provisional numbers from this single clip (NOT validated against
false positives yet):
- onThreshold: 0.4
- offThreshold: 0.25 (hysteresis gap)
- dwellMs: 250
- refractoryMs: 500

Still needed before trusting this: multiple takes of the same gesture,
and a negative-control recording of normal talking/chewing to check
jawOpen doesn't cross 0.4 during ordinary speech.

---

## 2026-09-01 (evening) - GestureSwitch, and a way to run it without a face

**Worked on:** The first access method. `GestureSwitch` is implemented,
`AccessFrame` was reshaped to suit it, and there is now a harness that runs a
switch over a recording so tuning does not need a camera and a build every
time.

**What changed:**

- `lib/access/GestureSwitch.ts`: implemented. No longer throws.
- `lib/access/types.ts`: `AccessFrame` carries blendshape values keyed by
  name, plus `timestampMs` and `faceDetected`, instead of a raw
  `FaceLandmarkerResult`.
- `lib/access/frame.ts`: new. Builds an `AccessFrame` from either a live
  model result or a recorded sample.
- `test-harness/replay-switch.mjs`: new. Runs the switch over a recording.
- `test-harness/ts-hooks.mjs`: new. Lets a plain node script import the app's
  TypeScript, so the harness reads `lib/` source instead of a copy.

**Running it:**

```sh
node test-harness/replay-switch.mjs ~/Downloads/aid-recording-....json
node test-harness/replay-switch.mjs recording.json --dwell 200 --on 0.45
node test-harness/replay-switch.mjs recording.json --json /tmp/fires.json
```

Needs Node 23.6 or newer. No browser, no camera, no build; a run is
milliseconds, so a threshold can be changed and rechecked immediately.

**Why `AccessFrame` changed:**

Two reasons. A switch reading one channel should not walk a 52-entry category
array every frame, which is a cost `soak-test.mjs` exists to catch. And a
frame in this shape can be built out of a recorded sample as easily as out of
a live result, which is the only reason replay is possible at all.

The raw result is still on the frame as an optional field, because
`HeadPointer` and `GazePointer` need the transformation matrix and landmark
geometry, and a blendshape recording contains neither. Those two cannot be
replayed against recordings the way this one can, and will not be able to
until the recorder stores geometry.

**Four decisions, all of them behaviour rather than mechanics:**

1. *Refractory starts at release, not at press.* This is a hold-style switch:
   press fires once when dwell completes, the switch stays held for as long as
   the gesture is held, release fires when it is let go, and only then does the
   dead time start. Starting it at press would let a single long hold re-fire
   partway through itself.

2. *A blendshape missing from a frame is read as zero.* In this machine that is
   the same branch as "below offThreshold", so a lost face drops an engaged
   switch rather than holding it on. Failing toward off is the safer direction
   for a switch, but the cost is real: a tracking flicker mid-hold produces a
   release nobody performed, and then a refractory window that blocks the next
   genuine press. First thing to revisit if anyone reports the switch letting
   go on its own.

3. *The frame that ends a refractory window is judged, not spent.* Returning
   early on it would have added one frame, 67 ms at 15 Hz, to every refractory
   period, so `refractoryMs: 500` would quietly have been 567.

4. *The constructor and `configure` throw on a config that cannot behave*, in
   particular `offThreshold` above `onThreshold`. Keeping this. Inverted
   hysteresis does not fail visibly, it produces a switch that chatters, and a
   chattering switch with no visible cause in front of someone who cannot
   correct it by hand is a worse failure than one that refuses to start. It
   does mean a tuning UI has to validate before calling `configure`, which is
   the right place for that to happen anyway.

**What it does to the 08-31 clip:**

```
3 press, 3 release over 428 frames, 0.2 µs per frame
```

The cost is nothing. The count needs care, because the clip contains **four**
jawOpen excursions above 0.4, not three:

```
onset      held above off   frames   peak     result
 7072ms         800ms         13     0.8481   press
 8672ms         533ms          9     0.7851   press
11668ms         334ms          6     0.4896   press
27338ms         197ms          4     0.4066   swallowed, 53 ms short of dwell
```

Sweeping dwell puts the cliff between 150 ms and 200 ms: four presses at 150,
three at 200 and above.

What is *not* known is whether that fourth excursion was an intended gesture.
The clip has no label and no marker track, and at peak 0.41 against 0.85, 0.79
and 0.49 for the other three it is by some distance the weakest. It may have
been a deliberate small jaw opening the switch discarded, or a yawn, or speech.
That ambiguity is the argument for a marker track, or for one gesture per file.

Either way the useful part stands: 250 ms is not a comfortable middle. It sits
close enough to the edge that one 15 Hz sample decides whether a threshold
crossing becomes a press. That is not an argument for lowering it, since a
shorter dwell is exactly what would make a switch fire on ordinary movement,
and there is still nothing to check that against.

**This answers a question left open on 08-30.** That entry asked whether 15 Hz
is dense enough to tune a dwell against, and guessed four or five samples
inside a dwell might be too coarse. It is coarse: a 250 ms dwell is 3.7 frames
at the measured 67 ms spacing, and the accept/reject margin here was a single
sample. Worth knowing before any dwell number is treated as precise.

**UNVERIFIED:**

- **UNVERIFIED, and the blocker: false positives.** There is no negative
  control recording. Nothing here says anything about whether jawOpen crosses
  0.4 during ordinary talking or chewing. Every number in this entry came from
  a clip of deliberate gestures, and a switch that fires correctly on gestures
  is not a switch that works.
- **UNVERIFIED: the live path.** `frameFromResult` has never been called by
  anything. Nothing wires `GestureSwitch` into the detection loop. The switch
  has only ever seen replayed frames, so "a replayed frame is
  indistinguishable from a live one" is a claim about the types, not an
  observation.
- **UNVERIFIED: the cost when it actually runs per frame.** 0.2 µs per frame is
  measured in node over an array, not in the browser inside the detection loop.
  The soak has not been re-run with a switch in the loop, and cannot be until
  one is wired in.
- **UNVERIFIED: `getState` and `configure`.** The harness calls neither. Dwell
  progress, the refractory flag and live retuning have never been executed.
- **UNVERIFIED: one face, one clip, one session.** 28 seconds, one person,
  one device, one lighting condition.

**Open questions, still deliberately not decided:**

- Whether jawOpen is the right channel at all. It was chosen because it had a
  near-zero baseline and clean separation in one clip, which is a reason to
  try it, not a reason to keep it.
- Refractory from release rather than from press has never been felt by a
  person, only reasoned about.
- Recordings still have no marker track, which is what made the fourth
  excursion above ambiguous.

**Next:**

1. Record 20 to 30 seconds of normal talking and chewing. Run it through
   `replay-switch.mjs` with the same config. Zero presses is the pass.
2. Only then decide what moves, with numbers from both sides: a higher
   `onThreshold`, a longer dwell knowing it already costs gestures, or a
   different channel.
3. Wire the switch into the detection loop and re-run the soak.

---

## 2026-09-02 - Negative control fails: jawOpen unusable for speech

Recorded 63.5s of normal talking, ran through replay-switch.mjs with
committed config (on 0.4 / off 0.25 / dwell 250 / refractory 500).

Result: 10 press events, confirmed against the actual test-harness
output (not just a manual check). Press values ranged 0.5398 to
0.8574, overlapping the 0.85 peak from the original gesture clip.
No threshold separates "intentional jaw-open gesture" from "talking"
using this blendshape alone. The distributions overlap.

Conclusion: jawOpen is not usable as a switch channel while speech is
present. This is a channel choice problem, not a dwell/threshold
tuning problem.

Next: test a blendshape with no expected speech correlation, starting
with a voluntary long blink (eyeBlinkLeft/eyeBlinkRight held), since
people don't typically hold both eyes shut for 300ms+ mid-sentence.
Will reuse this same talking recording as the negative control rather
than re-recording it.

**Update, same day: blink evaluated against the existing recording, and dropped.**

eyeBlinkLeft and eyeBlinkRight replayed over the same 63.5s talking
recording with the committed config (on 0.4 / off 0.25 / dwell 250 /
refractory 500):

    eyeBlinkLeft     4 press
    eyeBlinkRight    7 press

Requiring both eyes together, min(left, right) at on 0.5 / off 0.3, gives
11 excursions in that clip:

    dwell 250ms -> 4 fire
    dwell 300ms -> 3 fire
    dwell 400ms -> 1 fire
    dwell 500ms -> 1 fire
    longest both-eye closures: 533ms, 333ms, 325ms, 267ms, 208ms

So the premise above, that people do not hold both eyes shut for 300ms+
mid-sentence, does not hold. It happened three times over 300ms and once
for 533ms in a single minute of talking. Zero fires would need a dwell
longer than 533ms, and that is the worst case from one minute.

Note: eyeBlinkLeft/eyeBlinkRight were evaluated only against the
existing talking negative-control recording. No deliberate blink
gesture clip was recorded, since the eyes-closed-during-scanning
problem disqualifies this channel on its own regardless of
false-positive rate. Numbers above are false-positive counts, not
a true/false positive comparison.

No replacement channel chosen yet.

---

## 2026-09-04 — Stress test: browDownLeft/Right, noseSneerLeft, eyeSquintLeft

Ran a 114.9s stress-test recording (talking + exaggerated expressions +
laugh/yawn + chewing + face-touching) against four upper-face candidates,
chosen to avoid the mouth-region contamination found in the jawOpen test
and the eyes-closed-during-scanning problem that disqualified blink.

Results at committed config (on 0.4 / off 0.25 / dwell 250 / refractory 500):
- browDownLeft:    2 false presses
- browDownRight:   1 false press
- noseSneerLeft:   0 false presses — never exceeded 0.0001 across the
  entire clip. Strongest result of any channel tested so far.
- eyeSquintLeft:   17 false presses — squinting is frequent and largely
  involuntary (light, concentration, laughing), ruled out.

noseSneerLeft is the leading candidate. Still needed before trusting it:
a deliberate gesture clip to confirm it's actually producible on demand
and reaches a usable peak value, and a judgment call on whether the
muscle group is a reasonable ask for the target population.

---

## 2026-09-04 (cont.) — noseSneerLeft ruled out: not producible

Attempted deliberate nose-sneer gestures. Could not reliably produce
the movement on demand — inconsistent, hard to control voluntarily.

This matters independent of the stress-test result. A channel that
never fires during ordinary movement is only useful if it can also be
triggered reliably on purpose. noseSneerLeft passed the negative
control but fails the positive control, so it's ruled out.

Back to browDownLeft/Right as the leading candidates — both were quiet
in the stress test (2 and 1 false presses respectively over 114.9s) and
"furrowing your brow" is a far easier voluntary motion for most people
than an isolated nose sneer.

---

## 2026-09-04 (cont.) — browDownLeft/Right ruled out: not sustainable

Segmented analysis of brow-attempt-1 showed rest and attempt values
overlapping at low effort (worst-case rest 0.285 vs weakest attempt
0.271) — no clean separation without effort ramping up over the
session (later attempts reached 0.40-0.50).

Stopped here rather than re-recording at higher effort: sustained
furrowing is physically uncomfortable to hold. A switch gesture that
causes strain is disqualified regardless of signal quality — this
would be unusable for repeated real-world use, and likely worse for
someone with limited muscle control, not better.

Five candidates now ruled out: jawOpen (overlaps ordinary talking/
surprise), eyeBlinkLeft/Right (blocks vision during scanning; also
noisy), noseSneerLeft (quiet but not voluntarily producible),
browDownLeft/Right (physically uncomfortable to sustain).

---

## 2026-09-04 — Channel selection: mouthPucker

Nine candidates tested against real recordings this session: jawOpen,
eyeBlinkLeft/Right, noseSneerLeft, browDownLeft/Right, cheekPuff,
jawForward, jawRight, jawLeft, mouthFunnel, mouthPucker. Each ruled
out for a specific documented reason except the last.

- jawOpen: overlaps ordinary talking and surprise (10 false presses/63.5s)
- eyeBlinkLeft/Right: disqualified structurally (blocks vision needed
  for scanning UI), also noisy (11+ false crossings)
- noseSneerLeft: quiet at rest (0 false positives) but not voluntarily
  producible on demand
- browDownLeft/Right: no clean rest/gesture separation at low effort,
  and sustained furrowing is physically uncomfortable — disqualified
  regardless of signal quality
- cheekPuff, jawForward, jawRight: model does not reliably sense these
  from a 2D front-facing camera (values near 0.000 even during
  deliberate attempts) — a sensing limitation, not a technique issue
- jawLeft: same sensing limitation, confirmed on a second, more
  deliberate attempt (max 0.087 even during gesture)
- mouthFunnel: some separation but thin (gap +0.062), not pursued
  further once mouthPucker showed a much stronger result

mouthPucker: clean separation in the positive-control recording
(worst rest 0.451, weakest attempt 0.928). At dwell 250ms, 3-4 speech
events still crossed threshold at full strength (spoken rounded
vowels briefly produce a full pucker shape). Raising dwell to 600ms
eliminated all false positives in a 63.5s pure-talking negative
control. In a separate, more adversarial 114.9s stress-test recording
(talking + exaggerated expressions + laugh/yawn + chewing +
face-touching), 2 false positives remained even at dwell 800ms,
source not identified — possibly an exaggerated expression made
during that section. Not chasing dwell further; the responsiveness
cost outweighs eliminating one unexplained edge case in an
intentionally adversarial test that doesn't represent real usage.

Final config: onThreshold 0.6, offThreshold 0.4, dwellMs 700,
refractoryMs 500.

Caveats: single user, single set of sessions, single lighting/camera
setup. Not yet validated across a second person or environment.

Still needed before broader trust: multiple recording sessions/days,
and eventually a different person's face entirely — findable via SLP
outreach.

---

## 2026-09-04 (evening) — First end-to-end path: camera to switch to scan to speech

**Worked on:** `ScanEngine` implemented, a six-cell board at `/board`, and the
whole chain wired up. `GestureSwitch.ts` untouched.

**What is verified, and how:**

- `test-harness/scan-trace.mjs`, 23 checks, all passing. No browser and no fake
  timers: the engine has no clock of its own, so the test hands it timestamps
  and reads its events back.
- `test-harness/verify-board.mjs` in headless Chromium: auto-scan advances at
  the configured interval, a press descends into the highlighted row, a second
  press selects the cell, `speechSynthesis.speak` is called with the right
  word, a third press inside the post-selection pause is swallowed, and the
  board resumes at the top. Zero page errors.
- Camera and model both reach `ready` on `/board` and the detection loop runs.

**UNVERIFIED, and it is the leg that matters:** that a real mouthPucker on a
real face produces a press on this page. A fake camera cannot pucker. The
switch meter on the page shows the live channel value, the threshold line and
dwell progress, so a gesture that is not registering should be visible rather
than mysterious. This is the first thing to check by hand.

Worse than that: the y4m face source and every recording from the last two
sessions were in a temp directory that has since been cleared, and the portrait
they were built from is gone with them. So the camera leg was checked with
Chromium's generated colour bars, which have no face in them and prove only
that a no-face frame reaches the switch without throwing. Committing a small
face fixture to the repo would fix this permanently, but a photograph of a real
person in a public repo is a licensing and privacy decision, not a build one.

**The timing decision, which is the important one:**

A press arrives `dwellMs` AFTER the gesture begins, because dwell is what
separates a gesture from a twitch. With the committed switch (dwell 700 ms) and
a 1000 ms scan interval, that leaves **300 ms** between the highlight landing on
a cell and the gesture having to start, or the press lands on the next cell.
300 ms is around the floor of ordinary simple reaction time and well under it
for most of the people this is for.

This was not designed in, it fell out of two numbers chosen separately, and it
is the kind of thing that would have been discovered as "the board keeps picking
the wrong word" rather than as arithmetic. Two ways out, both left open:

1. Raise `scanIntervalMs`. The budget grows one for one. Slider on the page.
2. `pressLatencyCompensationMs`: attribute a press to whatever was highlighted
   when the gesture STARTED. This is how switch hardware normally handles
   activation latency. Off by default, toggle on the page, and the engine keeps
   a short history of recent highlights to make it possible.

The page prints the budget live and warns under 400 ms. Both settings need a
real face before either becomes a default.

**Decisions, all of them tunable and none of them tested on a person:**

- **`scanIntervalMs` 1000** as asked. See above; it is tight.
- **`postSelectionPauseMs` 1000.** After a word is spoken the board freezes,
  ignores presses, then resumes **at the top of the board** rather than where it
  left off. Reasoning: the next word is a fresh choice, not a continuation. This
  is also the accidental-double-press answer, and it composes with the switch's
  own refractory rather than duplicating it: the switch cannot fire again until
  release plus 500 ms plus another 700 ms of dwell, so the two windows overlap
  and a lingering gesture cannot select anything.
- **Running out of passes inside a row escapes back to row level**, rather than
  giving up. Picking the wrong row is an ordinary mistake and it should cost a
  few seconds, not the session. Running out at *row* level stops the board,
  because flashing a grid at someone who has stopped answering is not neutral.
- **A press on an exhausted board restarts it.** Otherwise the only way back is
  a mouse, which is the one thing the person using this does not have.
- **`maxLoops` 3, `firstStepExtraMs` 0.** Both guesses. The second exists
  because the first step of a pass is where a slow responder most often misses,
  and it is currently doing nothing.
- **Six cells, two rows of three.** Worth knowing: on a 2x3 grid linear
  scanning averages 3.5 steps and row-column averages 3. Row-column barely pays
  for its second press at this size. It pays properly at 9.
- **Emoji, not symbols.** Placeholders. Real AAC uses a licensed symbol set and
  symbol choice is a clinical decision.
- **Speech cancels whatever is still speaking.** A new selection means the
  person has moved on. Cost: two fast selections only speak the second.
- **Rate and pitch left at platform defaults**, not guessed at.

**Added to the engine's interface, beyond the stub:**

- `tick(nowMs)`. The engine owns no timer, for the same reason `GestureSwitch`
  is driven by frames: a machine that reads the clock itself cannot be replayed.
- `pressLatencyCompensationMs` in the config, per the timing note above.

**What broke:**

- **The space-bar switch stand-in was pressing "Stop scanning" instead.** Space
  activates a focused button by default, and the button had just been clicked to
  start scanning, so every test press stopped the board. The headless run caught
  it immediately: the highlight went to `-` and the status to `idle` one press
  in. Now armed only while scanning, and it calls `preventDefault`. Buttons stay
  reachable with Enter.
- **Passed `{ current: videoElement }` as the video ref**, rebuilt on every
  render. `useFaceLandmarker` has that ref in its effect deps, so the model would
  have been torn down and reloaded on every state change, at 15 Hz, forever.
  Caught by reading it rather than by running it, which is luck; a real webcam
  would have made it obvious and the fake one might not have.
- Two of the 23 scan-trace assertions failed on the first run and **both were
  wrong tests, not wrong code**: one stopped ticking 500 ms before the press it
  was testing, so the engine had never been given the chance to advance.

**Next:**

- Try it on a face. Watch the meter, not the board, when it does not work.
- The reaction budget is the first thing to feel: 1000 ms scan interval with a
  700 ms dwell may simply not be operable, in which case raise the interval or
  turn compensation on and see which feels better.

---

## 2026-09-04 (night) — A camera that would not restart, and an instrument for the freeze

**Worked on:** A reported camera lockup, the two UI defects that made it
unreadable, live loop diagnostics on /board, and the board grown to nine cells.
`GestureSwitch.ts`, `ScanEngine.ts` and every timing number are untouched.

**The report:** on /board the camera "crashed" while a hand covered the mouth,
and afterwards "Start camera" did nothing and the page said the camera was off.
A hard refresh did not fix it. It resolved on its own later, and the machine
had been slow at the time.

**The stated hypothesis was wrong, and the path is worth writing down** because
it is the one that gets re-suspected. Occluding the face cannot throw here:

- `frame.ts:31-34` returns `{ values: NO_VALUES, faceDetected: false }` when
  `faceBlendshapes[0].categories` is empty.
- `GestureSwitch.update` reads `frame.values[blendshape] ?? 0`, so a missing
  channel is zero, which drops an engaged switch rather than holding it.
- Even a throwing consumer would not kill the loop: `tick` re-schedules its own
  `requestAnimationFrame` on its first line, before any work. Only
  `detectForVideo` throwing cancels it.

So a hand over the mouth is an ordinary handled state on this page, exactly as
it is in the recorder. No Chrome crash dumps existed either, so the GPU process
had not died.

**What actually fits the report, including the hard refresh:** a `getUserMedia`
call that never settles. There was no timeout, so the hook sat in `requesting`
forever; the start button is disabled in that state; and the video overlay
printed a flat "Camera is off." for *every* status that was not `ready`. A hung
request, a denial, and a camera that was genuinely off were indistinguishable on
screen, which is why neither of us could tell from the report which one it was.
This is unproven as the cause of that particular incident and now unfalsifiable,
since it cleared. It is a real defect regardless, and it is the defect that made
the incident unreadable.

**Fixed:**

1. `useCamera` races `getUserMedia` against `timeoutMs` (default 10 s) and
   reports a new `timeout` status with a message and a hint. `getUserMedia` has
   no cancel, so an abandoned request is left to run and whatever stream it
   eventually yields has its tracks stopped. That needed an attempt counter,
   which also revives the intent of the dead `!pendingRef.current` guard: `stop()`
   never cleared that flag, so the stale-stream check could not fire. It was
   unreachable through either page's UI, because both disable Stop unless ready.
2. `CameraOverlay`, shared by /board and /debug so they cannot drift apart
   again, says which state the camera is actually in. The start button reads
   "Starting…" or "Try again" instead of always "Start camera".

**Then a second report: intermittent freezing on /board**, camera, meter and
highlight together, followed by an apparent speed-up. Two things narrowed it
before any data:

- `detectForVideo` is a **synchronous** WASM call on the main thread. A slow
  inference is not something that happens alongside a page freeze, it *is* the
  page freeze. "Everything freezes together" is the shape that predicts.
- The highlight cannot actually burst. `ScanEngine.tick` advances one step per
  tick and reschedules from now (`ScanEngine.ts:227-230`). A highlight that
  looks like it bursts is queued rendering catching up, not the engine stepping
  twice.

**`LoopDiagnostics`**, a plain class in the style of the other two machines, fed
one call per processed frame from /board, with a panel beside the meter. Fixed
`Float64Array` ring buffers, no allocation on the hot path, percentiles computed
only in `snapshot` at the existing 15 Hz. An instrument that adds jank cannot
measure jank. `FrameStats` gained `sinceLastFrameMs`, `rafTicks` and
`videoTimeDeltaMs`; `rafTicks` is the one that separates "the loop is alive and
the camera stopped delivering" from "the whole loop was descheduled".

Visibility is recorded, not acted on. rAF already stops in a hidden tab and
resumes by itself, and nothing here changes that. The listener exists only
because the gap spanning a backgrounded stretch is arbitrarily large and would
otherwise be reported as the worst stall of the session, burying every real one.
Those gaps are excluded from the percentiles rather than counted.

**One bug in the instrument, found by running it and worth remembering.** A gap
is measured from the start of one inference to the start of the next, so a frame
whose model call takes 400 ms shows up as a 400 ms gap recorded against the
*following* frame. The first version therefore printed the recovering frame's
inference next to the stall: "worst 8498 ms · inference then 36.9 ms", which
says the model was fast about a stall the model caused. That is the single wrong
answer this instrument must not give. `StallRecord` now carries
`previousInferenceMs` and the panel reads "model busy 8152 ms of it".

**Verified, and how.** Production build, `next start -p 3111`, headless
Chromium via the harness.

| check | result |
| --- | --- |
| `tsc --noEmit` | clean |
| `eslint app lib` | clean, no findings |
| `next build` | clean, 5 static routes |
| `scan-trace.mjs` | 23/23 |
| `diagnostics-trace.mjs` (new) | 49/49 |
| `verify-camera-states.mjs` (new) | 29/29 |
| `verify-board.mjs`, no camera | pass, 0 page errors |
| `verify-board.mjs fake` | pass, camera and model ready, 0 page errors |
| `verify-viewer.mjs` | pass, 0 page errors |
| `soak-test.mjs fake`, 3 min | rate flat, heap flat, 0 page errors |

`verify-camera-states.mjs` stubs `getUserMedia` per scenario, because none of
these states can be reached with a real camera on demand. It checks: idle,
requesting and denied all say different things; a request that never settles
reaches `timeout` with a message and an enabled retry; **the retry then succeeds**,
which is the recovery that was impossible before; a stream arriving 12 s late
has its tracks stopped and does not attach itself; and the panel fills in with
live frames.

**The soak numbers, and their limits.** Three minutes on Chromium's generated
colour bars, because the y4m face fixture and every real recording were lost
with a cleared temp directory two sessions ago, and a photograph of a real person
in a public repo is a licensing and privacy decision rather than a build one.

| minute | Hz |
| --- | --- |
| 0 | 10.49 |
| 1 | 10.69 |
| 2 | 10.47 |
| 3 | 10.35 |

Overall 10.548 Hz. Gaps: min 28 ms, p50 93, p99 201, max 343, with 21 gaps over
200 ms. Heap after forced GC: 6.43 MB at start, 7.16 at 2 min, 7.32 at 3 min,
7.33 after stop; DOM nodes constant at 323 and listeners constant at 361
throughout. Timestamps monotonic, counts agree, no NaN, no page errors.

What that does and does not say. It says the rate is **flat**, the heap is flat,
and nothing leaks with the modified detection loop. It does **not** reproduce
the 15.00 Hz of 2026-08-31: detection only reached 11 to 16 fps here against 26
to 31 then, and the recorder decimates from detection so it cannot exceed it.
That difference is not attributable without the same fixture and the same
machine conditions, so it is not evidence either way about this change. Note
also that the soak runs /debug, which does not use `LoopDiagnostics` at all: it
exercised the `FrameStats` additions, not the instrument. The instrument is
covered by `diagnostics-trace.mjs` and `verify-camera-states.mjs`.

**The first soak run was contaminated and is discarded.** `verify-viewer` was
run concurrently with it, and the rate decayed from 8.3 Hz to 1.6 Hz across the
run in step with that. The heap and DOM figures from it agreed with the clean
run; the rate figures were an artefact of my own CPU contention. Worth the
entry: this harness measures a machine, so anything else running on that machine
is part of the measurement.

**The lead worth chasing next, from the clean soak.** Inference sampled at 10 s
intervals was mostly 25 to 37 ms, with spikes to 152.2, 126.8, 132.8 and 144.1
ms. Four spikes of four to five times baseline in eighteen point samples, on an
idle page with no face in frame. If that pattern is real rather than sampling
luck it is a strong candidate for the reported freeze, and the panel's
`inference p95` against `gap p95` on a real session will settle it. Chromium
also logged "GPU stall due to ReadPixels" during model startup, which is
MediaPipe reading results back off the GPU and is the obvious suspect.

**Two new fixtures, so this is not blocked again.** `make-fixture-recording.mjs`
generates a synthetic recording, which is what let `verify-viewer` run at all
after the real files were lost. It is sine waves and it is labelled as such in
the file. It is good for the viewer, which is a file reader. It must never be
used for anything about the access methods: replaying a switch over it would
measure the generator. `soak-test.mjs` now takes `fake` for the colour-bar
camera the way `verify-board.mjs` already did.

**The board is nine cells**, three rows of three, adding "I want", "hurt" and
"done". Nine is where row-column starts to pay for the press it costs: 5 steps
average against linear's 4 on 3x3, where on the old 2x3 it was 3 against 3.5.
Consequences not adjusted, because scan timing is being tuned separately against
a real face: a pass is three row steps rather than two, so worst case time to the
last cell is one scan interval longer, and `maxLoops` 3 now buys three passes
over three rows. The new row is appended rather than interleaved, because cell
order is a frequency decision made with the person using the board.

**Unverified, unchanged from before, and still the leg that matters:** that a
real mouthPucker on a real face produces a press on this page. Colour bars
cannot pucker. Nothing in this session moved that.

**Next:**

- Watch `inference p95` against `gap p95` on a real session during a freeze.
  If the model is the cost, the fix is delegate or capture resolution. If it is
  not, the panel says so and rules it out.
- The 15 Hz readout interval on /board is gated on nothing, so the page
  re-renders 15 times a second with the camera off and nothing scanning. Small,
  but it means the page never idles. One line to gate.
- A face fixture, decided deliberately rather than by accident: either a
  synthetic rendered face, or a photograph with documented permission.

---

## 2026-09-05 - Three GPU log lines triaged, none of them ours

**Worked on:** Nothing in the code. Three `chrome://gpu` log entries captured
during the 2026-09-04 live `/board` testing window, suspected of being behind
either the camera lockup or the intermittent freeze. Neither. Writing it down
because the previous entry already says this is the path that gets re-suspected.

**The lines, and how to read them.** Format is
`[pid:tid:MMDD/HHMMSS.us:SEVERITY:file(line)]`.

1. `20:21:45` `WARNING:ui/gl/angle_platform_impl.cc:53` shader compile log,
   `GL_OES_EGL_image_external` not supported, `samplerExternalOES` unsupported
   type, four more ERROR lines.
2. `20:36:17` `ERROR:shared_image_manager.cc:254` `ProduceSkia: Trying to
   Produce a Skia representation from a non-existent mailbox.`
3. `20:36:58` the same error again.

**The severity trap, which is the reusable part.** Entry 1 reads as six ERROR
lines. Chrome's own severity token on it is `WARNING`. Everything from
`Compiler log:` onward is ANGLE's internal compiler output quoted into the
message string. The severity to trust is the prefix, not the embedded text.

**Why the shader failure cannot be ours**, four ways:

- `GL_OES_EGL_image_external` / `samplerExternalOES` is the Android/EGL path for
  sampling camera and hardware-decoder output as an external YUV image
  (SurfaceTexture). macOS Chrome does not expose it, so a shader declaring it
  fails there deterministically, on every compile, forever. A permanent
  capability failure cannot produce an intermittent symptom that later cleared
  on its own.
- The app ships no WebGL. The only canvas is `app/viewer/TraceCanvas.tsx:47`, a
  2D context, and it is not on `/board`.
- It is not MediaPipe's either. Grepped the vendored binary:
  `vision_wasm_internal.wasm` has 62 `sampler2D` and 82 `texture2D`, and **zero**
  `samplerExternalOES`, zero `EGL_image_external`.
- It is logged in the GPU process, not from page-supplied shader code.

The subject matter genuinely is video texturing, which is why it looks
relevant. The platform is one this is not running on.

**Why the mailbox errors fit neither symptom.** A non-existent mailbox drops a
frame in the compositor. It cannot end a `MediaStreamTrack`, cannot make
`getUserMedia` hang, and cannot survive a hard refresh, which the reported
incident did. And the freeze is a main-thread stall by construction, because
`detectForVideo` is a synchronous WASM call on the main thread, so a GPU-process
error cannot cause one. If anything causality runs backwards: an 8 s stall, or
the teardown around it, leaves the compositor holding a shared image that is
already gone. Two occurrences 41 s apart is also far too sparse to account for
lag across a session.

**One thing the logs did establish, for free.** All three lines carry pid 1261,
tid 12834. Same GPU process, same thread, across 20:21:45 to 20:36:58, so the
GPU process did not restart in that window. Last night's "no crash dumps, so the
GPU process had not died" was argued from absence; this is positive evidence for
it.

**A timing fact worth having:** `/board` was committed at 21:08 (282a9b7), so
20:21 and 20:36 sit inside the evening session while `/board` was still being
hand-tested, before the night session's camera work. Whether that is the same
window as the camera-off incident is recorded nowhere, and I could not pin it.
If the incident was in the night session these logs predate it entirely.

**What broke:**

- The decisive check I wanted, the delegate readout in real Chrome, did not run.
  The browser extension is not connected. Not retried.
- Found while trying: **`/debug` cannot report the delegate without a camera.**
  `useFaceLandmarker` gets `enabled: cameraReady` (`app/debug/page.tsx:99`) and
  `setDelegate` only happens inside `load()`, so with the camera off the model
  never loads and `delegate` stays `null`. That readout is least available
  exactly when it would be most useful, which is while diagnosing a camera that
  will not start. Not changed, only noted.

**Decisions:**

- **The shader warning is ruled out permanently. Do not re-suspect it.**
- **The mailbox errors are noted and not chased.** If they turn out to correlate
  with observed stalls on a real session they are a symptom to read, not a cause
  to fix.
- The instrument from last night stays the way in: `inference p95` against
  `gap p95` on a real session.

**Unverified:**

- Unchanged and still the leg that matters: that a real mouthPucker on a real
  face produces a press on this page. Nothing this session moved it.
- **That the GPU delegate is actually taking in real Chrome on this machine.**
  Argued from the absence of the `[vision] GPU delegate unavailable` warning
  (`lib/vision/faceLandmarker.ts:67`), never observed. One glance at the
  `delegate` stat on `/debug` during the next real session settles it.

**Next:**

- The real-face session. Watch `inference p95` against `gap p95`, not the board.
- Note the `delegate` stat on `/debug` while the camera is on, once, and it stops
  being unverified.
- The four inference spikes from the clean soak, 152.2 / 126.8 / 132.8 / 144.1 ms
  against a 25 to 37 ms baseline, remain the lead.

---

## 2026-09-05 (cont.) — GPU delegate confirmed via capability probe

/debug delegate readout: GPU.
Capability probe: webgl2 true, renderer "ANGLE (Apple, ANGLE Metal
Renderer: Apple M4 Pro...)". This is the decisive datum, not the
externalImageExts field (which returns [] on every machine regardless
of driver support, since GL_OES_EGL_image_external is a native GLES
extension name that WebGL's getSupportedExtensions() never surfaces —
that field was a weak signal, not evidence). The renderer string
confirms the ANGLE Metal backend is in play, meaning the whole
EGL/Android extension family is off the table by construction. Combined
with delegate: GPU, the shader-log question from earlier today is
closed on direct observation, not inference.
