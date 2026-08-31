/**
 * Drawing primitives for the recording viewer.
 *
 * Canvas rather than SVG because a ten minute recording is nine thousand
 * samples per channel across fifty-two channels, and nine thousand SVG path
 * points times fifty-two is not something a browser enjoys.
 */

/**
 * Categorical series colours, assigned by slot in this fixed order and never
 * cycled. Both columns are the same eight hues stepped for their own surface;
 * the dark column is chosen, not derived by flipping the light one.
 *
 * Validated for colour-vision-deficiency separation and for contrast against
 * this page's own surfaces (#ffffff and #0a0a0a). Three of the light steps sit
 * under 3:1 on white, which is why every series also carries a visible text
 * label in the legend and, at four or fewer series, at the end of its own
 * line. Colour is never the only thing telling two lines apart.
 */
export const SERIES_COLORS = {
  light: [
    "#2a78d6",
    "#eb6834",
    "#1baf7a",
    "#eda100",
    "#e87ba4",
    "#008300",
    "#4a3aa7",
    "#e34948",
  ],
  dark: [
    "#3987e5",
    "#d95926",
    "#199e70",
    "#c98500",
    "#d55181",
    "#008300",
    "#9085e9",
    "#e66767",
  ],
} as const;

export const MAX_SERIES = SERIES_COLORS.light.length;

export interface ChartTheme {
  grid: string;
  axis: string;
  text: string;
  muted: string;
  faceGap: string;
  crosshair: string;
  selection: string;
  sparkline: string;
}

export function chartTheme(dark: boolean): ChartTheme {
  return dark
    ? {
        grid: "#27272a",
        axis: "#3f3f46",
        text: "#a1a1aa",
        muted: "#71717a",
        faceGap: "rgba(120, 113, 108, 0.28)",
        crosshair: "#a1a1aa",
        selection: "rgba(57, 135, 229, 0.22)",
        sparkline: "#a1a1aa",
      }
    : {
        grid: "#e4e4e7",
        axis: "#d4d4d8",
        text: "#71717a",
        muted: "#a1a1aa",
        faceGap: "rgba(161, 161, 170, 0.24)",
        crosshair: "#52525b",
        selection: "rgba(42, 120, 214, 0.18)",
        sparkline: "#52525b",
      };
}

/** Index of the last sample at or before `t`. -1 if `t` precedes them all. */
export function indexAtOrBefore(times: number[], t: number): number {
  let low = 0;
  let high = times.length - 1;
  let best = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (times[mid] <= t) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

/** Index of the sample closest in time to `t`. */
export function nearestIndex(times: number[], t: number): number {
  if (times.length === 0) return -1;
  const before = indexAtOrBefore(times, t);
  if (before < 0) return 0;
  if (before >= times.length - 1) return times.length - 1;
  const a = times[before];
  const b = times[before + 1];
  return t - a <= b - t ? before : before + 1;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TraceOptions {
  times: number[];
  values: (number | null)[];
  /** Visible time window. */
  t0: number;
  t1: number;
  /** Visible value window. */
  v0: number;
  v1: number;
  rect: Rect;
  color: string;
  lineWidth?: number;
}

/**
 * Draws one channel as a line, breaking the line wherever the model reported
 * no face. A gap in the line is the honest rendering of a null: joining across
 * it would draw a value that was never measured.
 *
 * Above roughly two samples per pixel it switches to a per-column min/max
 * envelope. That is ordinary downsampling for display: every extreme in the
 * data still reaches the screen, it is just no longer one point per sample.
 */
export function drawTrace(ctx: CanvasRenderingContext2D, opts: TraceOptions) {
  const { times, values, t0, t1, v0, v1, rect, color } = opts;
  const span = t1 - t0;
  if (span <= 0 || rect.width <= 0 || rect.height <= 0) return;

  const vSpan = v1 - v0 || 1;
  const xFor = (t: number) => rect.x + ((t - t0) / span) * rect.width;
  const yFor = (v: number) =>
    rect.y + rect.height - ((v - v0) / vSpan) * rect.height;

  // One sample either side of the window so lines reach the edges.
  const first = Math.max(0, indexAtOrBefore(times, t0));
  const before = indexAtOrBefore(times, t1);
  const last = before < 0 ? -1 : Math.min(times.length - 1, before + 1);
  if (last < first) return;
  const count = last - first + 1;

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = opts.lineWidth ?? 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (count <= rect.width * 2) {
    ctx.beginPath();
    let drawing = false;
    for (let i = first; i <= last; i += 1) {
      const value = values[i];
      if (value === null || !Number.isFinite(value)) {
        drawing = false;
        continue;
      }
      const x = xFor(times[i]);
      const y = yFor(value);
      if (drawing) ctx.lineTo(x, y);
      else {
        ctx.moveTo(x, y);
        drawing = true;
      }
    }
    ctx.stroke();
  } else {
    // Per-pixel-column min/max, drawn as one path so consecutive columns join
    // into a line rather than reading as a bar chart.
    const columns = Math.max(1, Math.floor(rect.width));
    const colMin = new Float64Array(columns).fill(Number.POSITIVE_INFINITY);
    const colMax = new Float64Array(columns).fill(Number.NEGATIVE_INFINITY);
    for (let i = first; i <= last; i += 1) {
      const value = values[i];
      if (value === null || !Number.isFinite(value)) continue;
      const col = Math.min(
        columns - 1,
        Math.max(0, Math.floor(((times[i] - t0) / span) * columns)),
      );
      if (value < colMin[col]) colMin[col] = value;
      if (value > colMax[col]) colMax[col] = value;
    }
    ctx.beginPath();
    let drawing = false;
    for (let col = 0; col < columns; col += 1) {
      if (colMin[col] === Number.POSITIVE_INFINITY) {
        drawing = false;
        continue;
      }
      const x = rect.x + col + 0.5;
      const yTop = yFor(colMax[col]);
      const yBottom = yFor(colMin[col]);
      if (!drawing) {
        ctx.moveTo(x, yBottom);
        drawing = true;
      } else {
        ctx.lineTo(x, yBottom);
      }
      ctx.lineTo(x, yTop);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Shades the stretches where the model reported no face. */
export function drawFaceGaps(
  ctx: CanvasRenderingContext2D,
  gaps: { startMs: number; endMs: number }[],
  t0: number,
  t1: number,
  rect: Rect,
  color: string,
) {
  const span = t1 - t0;
  if (span <= 0) return;
  ctx.save();
  ctx.fillStyle = color;
  for (const gap of gaps) {
    if (gap.endMs < t0 || gap.startMs > t1) continue;
    const x = rect.x + ((Math.max(gap.startMs, t0) - t0) / span) * rect.width;
    const right = rect.x + ((Math.min(gap.endMs, t1) - t0) / span) * rect.width;
    ctx.fillRect(x, rect.y, Math.max(1, right - x), rect.height);
  }
  ctx.restore();
}

/** Seconds, with just enough precision for the window being looked at. */
export function formatTime(ms: number, spanMs: number): string {
  const totalSeconds = ms / 1000;
  if (spanMs >= 120_000) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
  const decimals = spanMs < 2000 ? 2 : spanMs < 30_000 ? 1 : 0;
  return `${totalSeconds.toFixed(decimals)}s`;
}

/** Round tick spacing for a time axis, in milliseconds. */
export function timeTickStep(spanMs: number, targetTicks: number): number {
  const rough = spanMs / Math.max(1, targetTicks);
  const steps = [
    10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000,
    120_000, 300_000, 600_000,
  ];
  for (const step of steps) if (step >= rough) return step;
  return steps[steps.length - 1];
}
