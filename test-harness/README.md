# Test harness

Scripts that are run by hand when something needs proving, not on every commit.
Each one drives a real headless browser and prints JSON, because the questions
they answer ("does the sample rate hold for ten minutes", "does that canvas
actually have anything drawn on it") cannot be answered by a build passing.

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
