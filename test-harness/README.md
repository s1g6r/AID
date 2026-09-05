# Test harness

Scripts that are run by hand when something needs proving, not on every commit.
Most drive a real headless browser and print JSON, because the questions they
answer ("does the sample rate hold for ten minutes", "does that canvas actually
have anything drawn on it") cannot be answered by a build passing.

`replay-switch.mjs` is the exception: it needs no browser and no build, because
the question it answers is about a recording that already exists.

## Setup

Playwright is not a dependency of this project. Install it when you need it:

```sh
npm install --no-save playwright && npx playwright install chromium
```

Or point at an install you already have:

```sh
PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs node test-harness/soak-test.mjs ...
```

Everything below assumes a production build being served, not `next dev`:

```sh
npm run build && npx next start -p 3111
```

`replay-switch.mjs` needs neither. It does need Node 23.6 or newer, which runs
the app's TypeScript directly; it was written against 26.5.

## The fake camera

Chromium can be fed a `.y4m` file as its camera. This makes one with a face in
frame and a slow pan, so the blendshape values move instead of repeating a
single frame. It is 30 seconds long and Chromium loops it, which is what makes
a ten minute run possible from a 396 MB file.

```sh
ffmpeg -loop 1 -i portrait.jpg -t 30 -r 30 \
  -vf "crop=w=560:h=420:x='130+60*sin(2*PI*t/9)':y='60+45*sin(2*PI*t/13)',scale=640:480,format=yuv420p" \
  face-loop-30fps.y4m
```

`portrait.jpg` is any 820x1024 portrait photograph; the crop numbers frame the
head in that geometry, so check the first frame if you swap the photo in:

```sh
ffmpeg -i face-loop-30fps.y4m -vframes 1 frame0.png
```

**Look at that frame.** A centre crop of a portrait is a crop of a necktie, and
a soak run with no face in it reports a perfect sample rate for nothing at all.
That failure has already happened once.

## The scripts

### `soak-test.mjs`: does the recorder hold up over a long session

```sh
node test-harness/soak-test.mjs /path/to/face-loop-30fps.y4m /tmp/soak.json
SOAK_MINUTES=10 SOAK_URL=http://localhost:3111/debug node test-harness/soak-test.mjs ...
```

Records for `SOAK_MINUTES` (default 10), then reports: sample rate per minute
computed from the exported timestamps rather than wall clock, JS heap after a
forced GC at 0/2/5/10 minutes, DOM node and listener counts at each, detector
frame rate and inference time throughout, and every structural check on the
downloaded file (counts agree, all values in range, timestamps increasing,
nothing truncated). Writes the full result JSON, the downloaded recording and a
screenshot next to the output path.

Re-run this after any change to the detection loop or the recorder. It is also
the regression test for `GestureSwitch` once that exists: if running a switch on
every frame costs frames, this is what shows it, as a sample rate that no longer
holds at 15 Hz.

### `verify-viewer.mjs`: does `/viewer` actually draw the file

```sh
node test-harness/verify-viewer.mjs /path/to/recording.json /tmp/viewer.png
VIEWER_URL=http://localhost:3111/viewer node test-harness/verify-viewer.mjs ...
```

Loads a recording, then checks: metadata, that nothing is plotted until asked,
that both sort orders work by keystroke and reorder the list, that the detail
canvas and the thumbnails contain non-transparent pixels, that drag-to-zoom
narrows the window, that hovering reads values off the traces, and that reset
restores. Prints heap cost and load time. Fails loudly on any page error.

### `scan-trace.mjs`: does the scanning state machine do what it says

```sh
node test-harness/scan-trace.mjs
```

No browser and no clock. `ScanEngine` has no timer of its own, so this hands it
timestamps and reads the events back: step timing, descending into a row,
selecting a cell, the post-selection pause swallowing a double press, escaping
back to row level when a row runs out of passes, exhaustion, waking an
exhausted board, both dwell-latency compensation settings, linear mode, and
that a stalled loop fires one catch-up step rather than nine.

Every case is a behaviour a person would feel. Run it after any change to
`ScanEngine.ts`; it takes under a second.

### `verify-board.mjs`: does the whole loop work end to end

```sh
node test-harness/verify-board.mjs                                   # no camera
node test-harness/verify-board.mjs http://localhost:3111/board out.png fake
node test-harness/verify-board.mjs http://localhost:3111/board out.png face.y4m
```

Drives `/board` in a real browser: auto-scan advances, a press descends a row,
a second press selects a cell and the right word reaches speech synthesis, a
third press inside the post-selection pause is swallowed, the board resumes at
the top, and the reaction-budget readout tracks the compensation toggle.
`speechSynthesis.speak` is wrapped in an init script rather than listened for,
because headless Chromium has no voices and would silently speak nothing.

The fourth argument is optional. `fake` uses Chromium's generated colour bars:
no face in them, so it checks only that the camera and model come up and that a
frame with no face reaches the switch without throwing. A `.y4m` path with a
face in it goes further. Neither can perform a mouthPucker, so **no automated
check here proves that a real gesture produces a press** on this page. That leg
needs a face, and the switch meter on the page exists to make it obvious.

### `serialize-probe.mjs`: what the export costs at the moment it runs

```sh
node test-harness/serialize-probe.mjs 9028
```

Builds a structure the same shape and size as a recording of N samples in a
bare page, then measures the heap while holding each stage alive: the sample
array, then the JSON string, then the Blob. This is how the export peak was
measured, and it is separate from the soak because `JSON.stringify` blocks the
main thread, so nothing on that thread can observe the peak while it exists.

One thing it showed that is worth remembering: heap readings taken after the
Blob exists understate what the process holds, because constructing a Blob moves
the string's bytes out of the V8 heap while the string is still referenced and
still readable.

### `replay-switch.mjs`: what a switch does to a recording you already have

```sh
node test-harness/replay-switch.mjs /path/to/recording.json
node test-harness/replay-switch.mjs recording.json --blendshape jawOpen \
  --on 0.4 --off 0.25 --dwell 250 --refractory 500 --json /tmp/fires.json
```

Runs the real `GestureSwitch` from `lib/access/` over every sample in a
recording and prints each press and release with its timestamp and the value
that triggered it, then the totals. No browser, no camera, no build. Reruns in
milliseconds, so a threshold can be changed and re-checked immediately.

Frames are built by `frameFromRecordingSample` in `lib/access/frame.ts`, the
sibling of the `frameFromResult` a live detection loop would call. Both produce
the same `AccessFrame`, so a number here is a number about the real class and
not about a copy of it. Worth being precise about the limit though: nothing
calls the live builder yet, so "a replayed frame is indistinguishable from a
live one" is currently a claim about the types rather than something that has
been observed.

Before the fire log it prints what the file itself contains: measured sample
rate, median and worst frame spacing, how many frames the configured dwell
actually spans at that spacing, the range the chosen channel covered, and
whether that range ever reaches `onThreshold` at all. A dwell of 250ms is under
four frames at 15 Hz, and that is easier to reason about when it is on screen
next to the result.

`--switch path/to/variant.ts` runs a different implementation instead of the
committed one, for comparing two state machines against the same trace.

The defaults are the provisional numbers from the build log entry of
2026-09-01, and **they are known to be wrong**. This script cannot tell a
deliberate gesture from ordinary talking, and neither can the switch. That
negative control has now been run: 63.5 seconds of normal speech fired ten
presses on jawOpen at the default config, at values overlapping real gestures.

So the defaults are useful for exercising the harness and useless as a
configuration. Any new channel gets the same treatment before it is trusted:
run it over the talking recording first, and expect zero presses.

### `ts-hooks.mjs`

Not a test. It teaches Node to resolve the `@/...` alias and extensionless
imports the app is written with, so a harness script can import `lib/` source
directly instead of the app being rewritten to suit a test script.
