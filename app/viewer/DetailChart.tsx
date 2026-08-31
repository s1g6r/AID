"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { LoadedRecording } from "@/lib/recording/loadRecording";
import { TraceCanvas } from "./TraceCanvas";
import {
  chartTheme,
  drawFaceGaps,
  drawTrace,
  formatTime,
  nearestIndex,
  timeTickStep,
  type Rect,
} from "./plot";

const PADDING = { left: 48, right: 16, top: 12, bottom: 28 };

interface DetailChartProps {
  loaded: LoadedRecording;
  /** Channel indices to plot, in the order they were picked. */
  selected: number[];
  /** Series colour per selected channel, same order. */
  colors: string[];
  /** Scale the value axis to the selected channels' range instead of 0..1. */
  fit: boolean;
  dark: boolean;
  t0: number;
  t1: number;
  onZoom: (t0: number, t1: number) => void;
}

function niceValueStep(span: number): number {
  const steps = [0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5];
  const rough = span / 6;
  for (const step of steps) if (step >= rough) return step;
  return 0.5;
}

export function DetailChart({
  loaded,
  selected,
  colors,
  fit,
  dark,
  t0,
  t1,
  onZoom,
}: DetailChartProps) {
  const { times, channels, faceGaps } = loaded;
  const [cursorT, setCursorT] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  // Written by the draw pass, read by the pointer handlers so both agree on
  // where the plot area actually is.
  const rectRef = useRef<Rect>({ x: 0, y: 0, width: 0, height: 0 });

  const domain = useMemo(() => {
    if (!fit || selected.length === 0) return { v0: 0, v1: 1 };
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const index of selected) {
      const channel = channels[index];
      if (channel?.min !== null && channel?.min !== undefined)
        min = Math.min(min, channel.min);
      if (channel?.max !== null && channel?.max !== undefined)
        max = Math.max(max, channel.max);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { v0: 0, v1: 1 };
    const pad = Math.max(0.01, (max - min) * 0.08);
    return {
      v0: Math.max(0, min - pad),
      v1: Math.min(1, max + pad) || 1,
    };
  }, [fit, selected, channels]);

  const tFromClientX = useCallback(
    (event: { currentTarget: HTMLCanvasElement; clientX: number }) => {
      const rect = rectRef.current;
      if (rect.width <= 0) return null;
      const box = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - box.left;
      const ratio = (x - rect.x) / rect.width;
      return t0 + Math.min(1, Math.max(0, ratio)) * (t1 - t0);
    },
    [t0, t1],
  );

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const theme = chartTheme(dark);
      const rect: Rect = {
        x: PADDING.left,
        y: PADDING.top,
        width: Math.max(1, width - PADDING.left - PADDING.right),
        height: Math.max(1, height - PADDING.top - PADDING.bottom),
      };
      rectRef.current = rect;
      const { v0, v1 } = domain;
      const span = t1 - t0;
      const xFor = (t: number) => rect.x + ((t - t0) / span) * rect.width;
      const yFor = (v: number) =>
        rect.y + rect.height - ((v - v0) / (v1 - v0)) * rect.height;

      drawFaceGaps(ctx, faceGaps, t0, t1, rect, theme.faceGap);

      ctx.font =
        '11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      ctx.textBaseline = "middle";

      // Value axis. Recessive: thin, low contrast, behind the data.
      const vStep = niceValueStep(v1 - v0);
      ctx.strokeStyle = theme.grid;
      ctx.fillStyle = theme.text;
      ctx.lineWidth = 1;
      ctx.textAlign = "right";
      for (let v = Math.ceil(v0 / vStep) * vStep; v <= v1 + 1e-9; v += vStep) {
        const y = Math.round(yFor(v)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(rect.x, y);
        ctx.lineTo(rect.x + rect.width, y);
        ctx.stroke();
        ctx.fillText(v.toFixed(vStep < 0.01 ? 3 : 2), rect.x - 8, y);
      }

      // Time axis.
      const tStep = timeTickStep(span, Math.max(2, Math.floor(rect.width / 90)));
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let t = Math.ceil(t0 / tStep) * tStep; t <= t1; t += tStep) {
        const x = Math.round(xFor(t)) + 0.5;
        ctx.strokeStyle = theme.grid;
        ctx.beginPath();
        ctx.moveTo(x, rect.y);
        ctx.lineTo(x, rect.y + rect.height);
        ctx.stroke();
        ctx.fillStyle = theme.text;
        ctx.fillText(formatTime(t, span), x, rect.y + rect.height + 8);
      }

      ctx.strokeStyle = theme.axis;
      ctx.beginPath();
      ctx.moveTo(rect.x + 0.5, rect.y);
      ctx.lineTo(rect.x + 0.5, rect.y + rect.height + 0.5);
      ctx.lineTo(rect.x + rect.width, rect.y + rect.height + 0.5);
      ctx.stroke();

      selected.forEach((index, slot) => {
        const channel = channels[index];
        if (!channel) return;
        drawTrace(ctx, {
          times,
          values: channel.values,
          t0,
          t1,
          v0,
          v1,
          rect,
          color: colors[slot],
        });
      });

      // At four series or fewer, name each line where it ends as well as in
      // the legend, so identity never depends on telling two colours apart.
      if (selected.length > 1 && selected.length <= 4) {
        const placed: number[] = [];
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        selected.forEach((index, slot) => {
          const channel = channels[index];
          if (!channel) return;
          const last = nearestIndex(times, t1);
          const value = channel.values[last];
          if (value === null || value === undefined) return;
          let y = yFor(value);
          while (placed.some((other) => Math.abs(other - y) < 13)) y -= 13;
          y = Math.min(rect.y + rect.height - 6, Math.max(rect.y + 6, y));
          placed.push(y);
          const label = channel.name;
          const textWidth = ctx.measureText(label).width;
          const x = rect.x + rect.width - 6;
          ctx.fillStyle = dark
            ? "rgba(10, 10, 10, 0.72)"
            : "rgba(255, 255, 255, 0.78)";
          ctx.fillRect(x - textWidth - 4, y - 7, textWidth + 8, 14);
          ctx.fillStyle = colors[slot];
          ctx.fillText(label, x, y);
        });
      }

      if (drag) {
        const from = Math.min(drag.from, drag.to);
        const to = Math.max(drag.from, drag.to);
        ctx.fillStyle = theme.selection;
        ctx.fillRect(xFor(from), rect.y, xFor(to) - xFor(from), rect.height);
      }

      if (cursorT !== null && selected.length > 0) {
        const x = Math.round(xFor(cursorT)) + 0.5;
        ctx.strokeStyle = theme.crosshair;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, rect.y);
        ctx.lineTo(x, rect.y + rect.height);
        ctx.stroke();
        ctx.setLineDash([]);
        const at = nearestIndex(times, cursorT);
        selected.forEach((index, slot) => {
          const value = channels[index]?.values[at];
          if (value === null || value === undefined) return;
          ctx.beginPath();
          ctx.arc(xFor(times[at]), yFor(value), 3.5, 0, Math.PI * 2);
          ctx.fillStyle = colors[slot];
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = dark ? "#0a0a0a" : "#ffffff";
          ctx.stroke();
        });
      }
    },
    [dark, domain, t0, t1, faceGaps, selected, colors, channels, times, drag, cursorT],
  );

  const cursorIndex =
    cursorT === null || times.length === 0 ? null : nearestIndex(times, cursorT);

  return (
    <div className="flex flex-col gap-3">
      <TraceCanvas
        draw={draw}
        className="block h-[320px] w-full touch-none select-none"
        onPointerMove={(event) => {
          const t = tFromClientX(event);
          setCursorT(t);
          if (drag && t !== null) setDrag({ from: drag.from, to: t });
        }}
        onPointerLeave={() => setCursorT(null)}
        onPointerDown={(event) => {
          const t = tFromClientX(event);
          if (t === null) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDrag({ from: t, to: t });
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
          if (!drag) return;
          const from = Math.min(drag.from, drag.to);
          const to = Math.max(drag.from, drag.to);
          setDrag(null);
          // A click is a drag of zero width. Do not zoom to nothing.
          if (to - from > 30) onZoom(from, to);
        }}
        onDoubleClick={() => onZoom(times[0], times[times.length - 1])}
      />

      {selected.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Pick a channel below to plot it here.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs">
          {selected.map((index, slot) => {
            const channel = channels[index];
            const value =
              cursorIndex === null ? null : channel?.values[cursorIndex];
            return (
              <li key={index} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: colors[slot] }}
                />
                <span>{channel?.name}</span>
                <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
                  {cursorIndex === null
                    ? "-"
                    : value === null || value === undefined
                      ? "no face"
                      : value.toFixed(3)}
                </span>
              </li>
            );
          })}
          {cursorIndex !== null && (
            <li className="text-zinc-500 dark:text-zinc-400">
              at {(times[cursorIndex] / 1000).toFixed(2)}s
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
