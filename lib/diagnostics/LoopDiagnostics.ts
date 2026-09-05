/**
 * What the live detection loop is actually doing, measured rather than assumed.
 *
 * Written for a reported symptom that no existing instrument could explain: on
 * /board the whole page intermittently freezes and then appears to speed up,
 * camera and meter and highlight all together. "All together" is the useful
 * part of that report, because it rules out a great deal. It is consistent
 * with the main thread being blocked, and not with the scan engine losing time
 * on its own, which cannot burst by construction (ScanEngine.tick advances one
 * step per tick and reschedules from now).
 *
 * The candidates this is built to separate:
 *
 * - **Inference cost.** detectForVideo is a synchronous WASM call on the main
 *   thread. Every millisecond it spends is a millisecond nothing else in the
 *   tab runs, so a slow inference IS a page freeze. `inference` percentiles
 *   against `gap` percentiles say whether the stall is inside the model.
 * - **The camera stalling.** The loop only runs the model when
 *   `video.currentTime` has advanced, so a camera that stops delivering frames
 *   produces no samples at all. `rafTicksPerFrame` rising well above 1 with
 *   inference times unchanged means the loop is alive and waiting on the
 *   camera, not stuck in the model.
 * - **Something outside both.** GC, thermal throttling, another tab. Shows up
 *   as gaps that are large while inference stays flat AND rAF ticks do not
 *   accumulate, because the whole loop was descheduled.
 * - **Tab visibility.** rAF does not fire in a hidden tab, so every
 *   backgrounding produces one enormous gap that means nothing. Those are
 *   counted separately and never pollute the percentiles, otherwise a single
 *   tab switch would dominate every number here.
 *
 * Deliberately allocation-free per frame: fixed ring buffers written by index,
 * no objects, no array growth. An instrument that adds jank cannot measure it.
 * Percentiles are computed in `snapshot`, which the UI calls at 15 Hz, not on
 * the hot path.
 *
 * This measures. It decides nothing and changes no timing.
 */

export interface LoopDiagnosticsConfig {
  /** How many processed frames to keep. 300 is about ten seconds at 30 fps. */
  windowSize: number;
  /** A frame-to-frame gap at or above this is recorded as a stall. */
  stallMs: number;
  /** At most one console warning per this many ms, so a stall cannot flood. */
  logThrottleMs: number;
  /** Set false to keep the on-screen readout but silence the console. */
  logToConsole: boolean;
}

const DEFAULTS: LoopDiagnosticsConfig = {
  windowSize: 300,
  stallMs: 100,
  logThrottleMs: 1000,
  logToConsole: true,
};

/** One processed frame, as the detection loop saw it. */
export interface LoopFrameSample {
  /** performance.now() at the start of this frame's inference. */
  timestampMs: number;
  /** Wall-clock ms inside detectForVideo. */
  inferenceMs: number;
  /** rAF callbacks that fired since the previous processed frame. */
  rafTicks: number;
  /** How far video.currentTime advanced since the previous frame, in ms. */
  videoTimeDeltaMs: number;
}

export interface Spread {
  p50: number;
  p95: number;
  max: number;
}

export interface StallRecord {
  /** performance.now() of the frame that ended the stall. */
  atMs: number;
  /** The frame-to-frame gap, in ms. */
  gapMs: number;
  /**
   * Inference time of the frame that ended the stall. Usually small: this is
   * the frame that recovered, not the one that caused the trouble.
   */
  inferenceMs: number;
  /**
   * Inference time of the frame BEFORE the gap, which is the one that matters.
   *
   * A gap is measured from the start of one inference to the start of the
   * next, so a frame whose model call took 400 ms shows up as a 400 ms gap
   * recorded against the *following* frame. Reading `inferenceMs` alone would
   * therefore say "the model was fast" about precisely the stall the model
   * caused. If this is close to `gapMs`, the time went into the model. If it
   * is small while the gap is large, the time went somewhere else.
   */
  previousInferenceMs: number;
  /** rAF ticks accumulated across the stall. */
  rafTicks: number;
}

export interface LoopSnapshot {
  /** Processed frames held in the window. */
  samples: number;
  /** Frames per second across the window, from timestamps rather than a target. */
  fps: number;
  /** Frame-to-frame gaps, excluding any that spanned a hidden tab. */
  gapMs: Spread;
  /** Time inside detectForVideo. */
  inferenceMs: Spread;
  /**
   * rAF callbacks per processed frame. At 30 fps capture on a 60 Hz display
   * this sits near 2 in normal operation. Much higher means the loop is
   * running and the camera is not delivering.
   */
  rafTicksPerFrame: Spread;
  /** How long since the last processed frame. Rises live during a freeze. */
  sinceLastFrameMs: number;
  /** Gaps at or above the stall threshold, in the current window. */
  stallCount: number;
  /** The worst one, or null if the window is clean. */
  worstStall: StallRecord | null;
  /** Times the tab has been hidden since this instrument was created. */
  hiddenCount: number;
  /** ms since the tab last became visible again, or null if never hidden. */
  sinceVisibleMs: number | null;
  /** True while the tab is hidden, when the loop is expected to be stopped. */
  hidden: boolean;
}

const EMPTY_SPREAD: Spread = { p50: 0, p95: 0, max: 0 };

export class LoopDiagnostics {
  private readonly config: LoopDiagnosticsConfig;
  private readonly size: number;

  private readonly gaps: Float64Array;
  private readonly inference: Float64Array;
  private readonly ticks: Float64Array;
  private readonly times: Float64Array;
  /** 1 when the gap at this index spanned a visibility change. */
  private readonly tainted: Uint8Array;
  /** Scratch for percentiles, so snapshot() allocates nothing either. */
  private readonly scratch: Float64Array;

  private count = 0;
  private lastFrameAt: number | null = null;
  private lastLoggedAt = 0;

  private _hidden = false;
  private hiddenCount = 0;
  private lastVisibleAt: number | null = null;
  /** Set by a visibility change, consumed by the next frame's gap. */
  private visibilityChangedSinceLastFrame = false;

  private worst: StallRecord | null = null;
  /** The previous frame's inference, so a stall can name its likely cause. */
  private previousInferenceMs = 0;
  private stallsInWindow: StallRecord[] = [];

  constructor(config: Partial<LoopDiagnosticsConfig> = {}) {
    this.config = { ...DEFAULTS, ...config };
    this.size = Math.max(2, Math.floor(this.config.windowSize));
    this.gaps = new Float64Array(this.size);
    this.inference = new Float64Array(this.size);
    this.ticks = new Float64Array(this.size);
    this.times = new Float64Array(this.size);
    this.tainted = new Uint8Array(this.size);
    this.scratch = new Float64Array(this.size);
  }

  /**
   * One processed frame. Called from the detection loop's result callback, so
   * this runs at capture rate and must stay cheap.
   */
  record(sample: LoopFrameSample): void {
    const index = this.count % this.size;
    const gap = this.lastFrameAt === null ? 0 : sample.timestampMs - this.lastFrameAt;
    const tainted = this.visibilityChangedSinceLastFrame || this.lastFrameAt === null;

    this.gaps[index] = gap;
    this.inference[index] = sample.inferenceMs;
    this.ticks[index] = sample.rafTicks;
    this.times[index] = sample.timestampMs;
    this.tainted[index] = tainted ? 1 : 0;

    this.count += 1;
    this.lastFrameAt = sample.timestampMs;
    this.visibilityChangedSinceLastFrame = false;

    if (!tainted && gap >= this.config.stallMs) {
      const stall: StallRecord = {
        atMs: sample.timestampMs,
        gapMs: gap,
        inferenceMs: sample.inferenceMs,
        previousInferenceMs: this.previousInferenceMs,
        rafTicks: sample.rafTicks,
      };
      this.stallsInWindow.push(stall);
      // Bounded by the same window the percentiles use, so the count on screen
      // and the numbers beside it describe the same stretch of time.
      if (this.stallsInWindow.length > this.size) this.stallsInWindow.shift();
      if (this.worst === null || gap > this.worst.gapMs) this.worst = stall;
      this.maybeLog(stall, sample);
    }

    this.previousInferenceMs = sample.inferenceMs;
  }

  /** Called from a visibilitychange listener. */
  noteVisibility(hidden: boolean, nowMs: number): void {
    if (hidden === this._hidden) return;
    this._hidden = hidden;
    // The gap straddling this change is an artefact of rAF not running, not a
    // stall, and it is large enough to wreck a p95 on its own.
    this.visibilityChangedSinceLastFrame = true;
    if (hidden) {
      this.hiddenCount += 1;
    } else {
      this.lastVisibleAt = nowMs;
    }
  }

  snapshot(nowMs: number): LoopSnapshot {
    const held = Math.min(this.count, this.size);
    const oldest = this.count > this.size ? this.count - this.size : 0;
    const first = this.times[oldest % this.size];
    const last = this.lastFrameAt ?? 0;
    const span = held > 1 ? last - first : 0;

    // Drop stalls that have aged out of the window, so the count matches what
    // the percentiles are describing rather than the whole session.
    const cutoff = held > 1 ? first : 0;
    while (this.stallsInWindow.length > 0 && this.stallsInWindow[0].atMs < cutoff) {
      this.stallsInWindow.shift();
    }

    return {
      samples: held,
      fps: span > 0 ? +(((held - 1) * 1000) / span).toFixed(2) : 0,
      gapMs: this.spread(this.gaps, true),
      inferenceMs: this.spread(this.inference, false),
      rafTicksPerFrame: this.spread(this.ticks, true),
      sinceLastFrameMs: this.lastFrameAt === null ? 0 : Math.round(nowMs - this.lastFrameAt),
      stallCount: this.stallsInWindow.length,
      worstStall: this.worst,
      hiddenCount: this.hiddenCount,
      sinceVisibleMs: this.lastVisibleAt === null ? null : Math.round(nowMs - this.lastVisibleAt),
      hidden: this._hidden,
    };
  }

  /** Clears the window and the worst-seen record. */
  reset(): void {
    this.count = 0;
    this.lastFrameAt = null;
    this.worst = null;
    this.stallsInWindow = [];
    this.visibilityChangedSinceLastFrame = false;
  }

  /**
   * Percentiles over the live part of the ring.
   *
   * `skipTainted` drops the gap that spans a visibility change and the very
   * first frame, both of which are not measurements of anything.
   */
  private spread(source: Float64Array, skipTainted: boolean): Spread {
    const held = Math.min(this.count, this.size);
    if (held === 0) return EMPTY_SPREAD;

    let n = 0;
    for (let i = 0; i < held; i += 1) {
      if (skipTainted && this.tainted[i] === 1) continue;
      this.scratch[n] = source[i];
      n += 1;
    }
    if (n === 0) return EMPTY_SPREAD;

    const view = this.scratch.subarray(0, n);
    view.sort();
    return {
      p50: round2(view[Math.floor(n * 0.5)]),
      p95: round2(view[Math.min(n - 1, Math.floor(n * 0.95))]),
      max: round2(view[n - 1]),
    };
  }

  private maybeLog(stall: StallRecord, sample: LoopFrameSample): void {
    if (!this.config.logToConsole) return;
    if (stall.atMs - this.lastLoggedAt < this.config.logThrottleMs) return;
    this.lastLoggedAt = stall.atMs;
    // One line, prefixed, so it can be filtered out of a noisy console.
    console.warn(
      `[loop] stall ${Math.round(stall.gapMs)}ms · model busy ${stall.previousInferenceMs.toFixed(1)}ms of it · ` +
        `${sample.rafTicks} rAF ticks · video advanced ${Math.round(sample.videoTimeDeltaMs)}ms`,
    );
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
