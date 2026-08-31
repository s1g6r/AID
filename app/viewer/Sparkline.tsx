"use client";

import { memo, useCallback } from "react";
import { TraceCanvas } from "./TraceCanvas";
import { chartTheme, drawFaceGaps, drawTrace, type Rect } from "./plot";
import type { FaceGap } from "@/lib/recording/loadRecording";

interface SparklineProps {
  times: number[];
  values: (number | null)[];
  faceGaps: FaceGap[];
  t0: number;
  t1: number;
  /** Channel range, used only when `fit` is on. */
  min: number | null;
  max: number | null;
  /** Scale to the channel's own range instead of the full 0..1. */
  fit: boolean;
  dark: boolean;
  /** Series colour when this channel is plotted below, muted grey when not. */
  color: string | null;
}

/**
 * One channel at thumbnail size, for scanning all fifty-two at once to see
 * which ones moved.
 *
 * Memoised: hovering the big chart re-renders its own subtree fifteen times a
 * second and there is no reason for fifty-two canvases to repaint with it.
 */
export const Sparkline = memo(function Sparkline({
  times,
  values,
  faceGaps,
  t0,
  t1,
  min,
  max,
  fit,
  dark,
  color,
}: SparklineProps) {
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const theme = chartTheme(dark);
      const rect: Rect = { x: 0, y: 2, width, height: height - 4 };

      let v0 = 0;
      let v1 = 1;
      if (fit && min !== null && max !== null) {
        const pad = Math.max(0.02, (max - min) * 0.08);
        v0 = Math.max(0, min - pad);
        v1 = Math.min(1, max + pad);
        if (v1 - v0 < 0.01) v1 = v0 + 0.01;
      }

      drawFaceGaps(ctx, faceGaps, t0, t1, rect, theme.faceGap);

      // A baseline, so a flat channel still reads as sitting at zero rather
      // than floating.
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(rect.x, rect.y + rect.height - 0.5);
      ctx.lineTo(rect.x + rect.width, rect.y + rect.height - 0.5);
      ctx.stroke();

      drawTrace(ctx, {
        times,
        values,
        t0,
        t1,
        v0,
        v1,
        rect,
        color: color ?? theme.sparkline,
        lineWidth: color ? 1.5 : 1,
      });
    },
    [times, values, faceGaps, t0, t1, min, max, fit, dark, color],
  );

  return <TraceCanvas draw={draw} className="block h-9 w-full" />;
});
