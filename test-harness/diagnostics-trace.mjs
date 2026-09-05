/**
 * Does LoopDiagnostics report what it claims to report.
 *
 * No browser and no clock, for the same reason as scan-trace.mjs: the class
 * takes timestamps rather than reading them, so the test can hand it a stall,
 * a backgrounded tab or a ring-buffer wrap and read the numbers back. Every
 * case here is a thing the on-screen panel would say during a live session.
 *
 *   node test-harness/diagnostics-trace.mjs
 */
import { registerTypeScriptResolution } from "./ts-hooks.mjs";
registerTypeScriptResolution();

const { LoopDiagnostics } = await import("@/lib/diagnostics/LoopDiagnostics");

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (ok) { passed += 1; console.log(`ok    ${label}`); }
  else { failed += 1; console.log(`FAIL  ${label}\n        expected ${expected}\n        actual   ${actual}`); }
}

function near(label, actual, expected, tolerance) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) { passed += 1; console.log(`ok    ${label}`); }
  else { failed += 1; console.log(`FAIL  ${label}\n        expected ${expected} +/- ${tolerance}\n        actual   ${actual}`); }
}

/**
 * Frames at a steady interval, starting at `from`. Returns the timestamp of
 * the LAST frame recorded, not the next one: every assertion below is about a
 * gap measured from a frame that exists, and returning the next slot instead
 * silently adds one interval to each of them.
 */
function steady(diag, { from, count, gap, inference = 10, rafTicks = 2 }) {
  let t = from;
  for (let i = 0; i < count; i += 1) {
    diag.record({ timestampMs: t, inferenceMs: inference, rafTicks, videoTimeDeltaMs: gap });
    t += gap;
  }
  return t - gap;
}

// --- an instrument with nothing in it says nothing ------------------------
{
  const diag = new LoopDiagnostics();
  const snap = diag.snapshot(1000);
  check("empty: no samples", snap.samples, 0);
  check("empty: no fps", snap.fps, 0);
  check("empty: gap max is zero", snap.gapMs.max, 0);
  check("empty: no stalls", snap.stallCount, 0);
  check("empty: no worst stall", snap.worstStall, null);
  check("empty: sinceLastFrame is zero, not NaN", snap.sinceLastFrameMs, 0);
}

// --- a steady 30 fps loop -------------------------------------------------
{
  const diag = new LoopDiagnostics();
  const end = steady(diag, { from: 1000, count: 31, gap: 33.34, inference: 12 });
  const snap = diag.snapshot(end);
  check("steady: all frames held", snap.samples, 31);
  near("steady: fps reads 30", snap.fps, 30, 0.1);
  near("steady: gap p50", snap.gapMs.p50, 33.34, 0.01);
  near("steady: gap max", snap.gapMs.max, 33.34, 0.01);
  near("steady: inference p50", snap.inferenceMs.p50, 12, 0.01);
  check("steady: no stalls", snap.stallCount, 0);
  // The first frame has no predecessor, so its gap of zero is not a
  // measurement of anything and must not drag the percentiles down.
  check("steady: first frame excluded from gaps", snap.gapMs.p50 > 0, true);
}

// --- one long frame is the whole complaint --------------------------------
{
  const diag = new LoopDiagnostics({ stallMs: 100, logToConsole: false });
  const before = steady(diag, { from: 0, count: 10, gap: 33 });
  // A 400 ms gap, of which 380 ms was spent inside the model.
  const stallAt = before + 400;
  diag.record({ timestampMs: stallAt, inferenceMs: 380, rafTicks: 24, videoTimeDeltaMs: 400 });
  const last = steady(diag, { from: stallAt + 33, count: 10, gap: 33 });

  const snap = diag.snapshot(last);
  check("stall: counted once", snap.stallCount, 1);
  near("stall: worst gap", snap.worstStall.gapMs, 400, 0.01);
  near("stall: inference at that frame", snap.worstStall.inferenceMs, 380, 0.01);
  check("stall: rAF ticks across it", snap.worstStall.rafTicks, 24);
  near("stall: shows in gap max", snap.gapMs.max, 400, 0.01);
  // The point of percentiles: one bad frame must not move the median.
  near("stall: median unmoved", snap.gapMs.p50, 33, 1);
  near("stall: inference max", snap.inferenceMs.max, 380, 0.01);
}

// --- a stall names the frame that caused it, not the one that recovered ---
{
  const diag = new LoopDiagnostics({ stallMs: 100, logToConsole: false });
  const before = steady(diag, { from: 0, count: 5, gap: 33, inference: 12 });
  // The model takes 400 ms on this frame. The gap that costs is measured from
  // here to the NEXT frame, so the stall is recorded against that next one.
  diag.record({ timestampMs: before + 33, inferenceMs: 400, rafTicks: 2, videoTimeDeltaMs: 33 });
  diag.record({ timestampMs: before + 33 + 405, inferenceMs: 11, rafTicks: 25, videoTimeDeltaMs: 405 });

  const snap = diag.snapshot(before + 33 + 405);
  near("attribution: the gap is the slow frame's cost", snap.worstStall.gapMs, 405, 0.01);
  near("attribution: the recovering frame was fast", snap.worstStall.inferenceMs, 11, 0.01);
  // Without this the panel would say "the model was fast" about a stall the
  // model caused, which is the one wrong answer it must not give.
  near("attribution: the model is named as the cause", snap.worstStall.previousInferenceMs, 400, 0.01);
}

// --- the threshold is a threshold ----------------------------------------
{
  const diag = new LoopDiagnostics({ stallMs: 100, logToConsole: false });
  const last = steady(diag, { from: 0, count: 5, gap: 33 });
  const justUnder = last + 99;
  diag.record({ timestampMs: justUnder, inferenceMs: 20, rafTicks: 6, videoTimeDeltaMs: 99 });
  check("threshold: 99 ms is not a stall at 100", diag.snapshot(justUnder).stallCount, 0);
  const exactly = justUnder + 100;
  diag.record({ timestampMs: exactly, inferenceMs: 20, rafTicks: 6, videoTimeDeltaMs: 100 });
  check("threshold: 100 ms is", diag.snapshot(exactly).stallCount, 1);
}

// --- a backgrounded tab is not a stall ------------------------------------
{
  const diag = new LoopDiagnostics({ stallMs: 100, logToConsole: false });
  const before = steady(diag, { from: 0, count: 10, gap: 33 });

  diag.noteVisibility(true, before);
  // rAF does not fire while hidden, so nothing is recorded for 30 seconds.
  const backAt = before + 30_000;
  diag.noteVisibility(false, backAt);
  diag.record({ timestampMs: backAt, inferenceMs: 12, rafTicks: 1, videoTimeDeltaMs: 30_000 });
  const last = steady(diag, { from: backAt + 33, count: 10, gap: 33 });

  const snap = diag.snapshot(last);
  check("hidden: the 30 s gap is not a stall", snap.stallCount, 0);
  check("hidden: and does not become the worst", snap.worstStall, null);
  // Without the taint this p95 would be 30,000 and every real stall would be
  // invisible underneath it.
  near("hidden: gap max excludes it", snap.gapMs.max, 33, 1);
  check("hidden: counted as a backgrounding", snap.hiddenCount, 1);
  near("hidden: time since visible", snap.sinceVisibleMs, last - backAt, 2);
  check("hidden: not hidden now", snap.hidden, false);
}

// --- and the loop is reported as stopped while it is stopped --------------
{
  const diag = new LoopDiagnostics();
  steady(diag, { from: 0, count: 5, gap: 33 });
  diag.noteVisibility(true, 200);
  const snap = diag.snapshot(5000);
  check("hidden: reported hidden", snap.hidden, true);
  check("hidden: hidden count", snap.hiddenCount, 1);
}

// --- the window is a window ----------------------------------------------
{
  const diag = new LoopDiagnostics({ windowSize: 50, stallMs: 100, logToConsole: false });
  // A stall, then enough clean frames to push it out of the window entirely.
  const before = steady(diag, { from: 0, count: 5, gap: 33 });
  const stallAt = before + 500;
  diag.record({ timestampMs: stallAt, inferenceMs: 400, rafTicks: 30, videoTimeDeltaMs: 500 });
  check("window: stall present", diag.snapshot(stallAt).stallCount, 1);

  const last = steady(diag, { from: stallAt + 33, count: 60, gap: 33 });
  const snap = diag.snapshot(last);
  check("window: samples capped at window size", snap.samples, 50);
  check("window: aged-out stall no longer counted", snap.stallCount, 0);
  // Deliberate: the count is window-scoped, the worst is session-scoped, so
  // the number that made someone open the panel is still there to read.
  near("window: worst is kept for the session", snap.worstStall.gapMs, 500, 0.01);
  near("window: percentiles are clean again", snap.gapMs.max, 33, 1);
}

// --- waiting on the camera looks different from waiting on the model ------
{
  const diag = new LoopDiagnostics();
  steady(diag, { from: 0, count: 20, gap: 33, inference: 12, rafTicks: 2 });
  const normal = diag.snapshot(20 * 33);
  near("camera: rAF per frame is ~2 when healthy", normal.rafTicksPerFrame.p50, 2, 0.01);

  const stalled = new LoopDiagnostics({ logToConsole: false });
  // The loop keeps ticking at 60 Hz; the camera delivers a frame every 500 ms.
  steady(stalled, { from: 0, count: 20, gap: 500, inference: 12, rafTicks: 30 });
  const snap = stalled.snapshot(20 * 500);
  near("camera: rAF per frame climbs when the camera stalls", snap.rafTicksPerFrame.p50, 30, 0.01);
  near("camera: while inference stays flat", snap.inferenceMs.p50, 12, 0.01);
}

// --- a freeze that is happening right now ---------------------------------
{
  const diag = new LoopDiagnostics();
  const last = steady(diag, { from: 0, count: 10, gap: 33 });
  const snap = diag.snapshot(last + 800);
  near("live: sinceLastFrame rises during a freeze", snap.sinceLastFrameMs, 800, 1);
}

// --- snapshot is a read, not a write --------------------------------------
{
  const diag = new LoopDiagnostics();
  const t = steady(diag, { from: 0, count: 20, gap: 33 });
  const a = diag.snapshot(t);
  const b = diag.snapshot(t);
  check("snapshot: repeatable", a.gapMs.p50 === b.gapMs.p50 && a.samples === b.samples, true);
}

// --- reset ----------------------------------------------------------------
{
  const diag = new LoopDiagnostics({ stallMs: 100, logToConsole: false });
  const last = steady(diag, { from: 0, count: 5, gap: 33 });
  diag.record({ timestampMs: last + 900, inferenceMs: 800, rafTicks: 50, videoTimeDeltaMs: 900 });
  diag.reset();
  const snap = diag.snapshot(last + 900);
  check("reset: samples cleared", snap.samples, 0);
  check("reset: worst cleared", snap.worstStall, null);
  check("reset: stalls cleared", snap.stallCount, 0);
}

// --- the console warning fires, once, however long the stall lasts --------
{
  const lines = [];
  const realWarn = console.warn;
  console.warn = (line) => lines.push(line);
  try {
    const diag = new LoopDiagnostics({ stallMs: 100, logThrottleMs: 1000 });
    const last = steady(diag, { from: 0, count: 5, gap: 33 });
    // Three stalls inside one throttle window.
    diag.record({ timestampMs: last + 300, inferenceMs: 280, rafTicks: 18, videoTimeDeltaMs: 300 });
    diag.record({ timestampMs: last + 600, inferenceMs: 280, rafTicks: 18, videoTimeDeltaMs: 300 });
    diag.record({ timestampMs: last + 900, inferenceMs: 280, rafTicks: 18, videoTimeDeltaMs: 300 });
    // And one after it has expired.
    diag.record({ timestampMs: last + 2100, inferenceMs: 280, rafTicks: 18, videoTimeDeltaMs: 1200 });
    check("console: three stalls in a window log once", lines.length, 2);
    check("console: prefixed for filtering", lines[0].startsWith("[loop] stall "), true);
    check("console: carries the causing inference time", lines[0].includes("model busy 280.0ms"), true);
  } finally {
    console.warn = realWarn;
  }
}

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed === 0 ? 0 : 1);
