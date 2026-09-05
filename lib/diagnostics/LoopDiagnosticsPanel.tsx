"use client";

import type { LoopSnapshot, Spread } from "./LoopDiagnostics";

/**
 * The loop's own timing, on screen, next to the thing that is stuttering.
 *
 * Deliberately not pretty. It exists to be read during a live session and
 * copied into a build log, so the numbers are monospace, unrounded past two
 * decimals, and labelled with what they mean rather than what they are called
 * in the code.
 *
 * How to read it, in the order that narrows fastest:
 *
 * - `gap p95` near `gap p50` means the loop is even. The complaint is
 *   elsewhere, most likely rendering or the compositor.
 * - `gap max` far above `inference max` means the time was lost outside the
 *   model: GC, another tab, thermal throttling, or the camera stalling.
 * - `inference p95` climbing with gap means the model itself is the cost, and
 *   the fix is delegate or resolution, not scheduling.
 * - `rAF/frame` well above its usual 2 during a stall means the loop kept
 *   running and the camera stopped delivering frames.
 * - `stalled` counting up live is a freeze happening right now.
 */
export function LoopDiagnosticsPanel({
  snapshot,
  stallMs,
}: {
  snapshot: LoopSnapshot | null;
  stallMs: number;
}) {
  if (!snapshot || snapshot.samples === 0) {
    return (
      <div className="rounded-md border border-zinc-200 p-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        Loop timing appears once the camera and model are running.
      </div>
    );
  }

  const stalledNow = snapshot.sinceLastFrameMs >= stallMs && !snapshot.hidden;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Loop timing</h2>
        <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
          {snapshot.fps.toFixed(1)} fps · {snapshot.samples} frames
        </span>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs">
        <Row label="gap ms" spread={snapshot.gapMs} />
        <Row label="inference ms" spread={snapshot.inferenceMs} />
        <Row label="rAF/frame" spread={snapshot.rafTicksPerFrame} />
      </dl>

      <div
        className={`rounded px-3 py-2 font-mono text-xs ${
          stalledNow
            ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
        }`}
      >
        {stalledNow
          ? `stalled ${snapshot.sinceLastFrameMs} ms and counting`
          : `last frame ${snapshot.sinceLastFrameMs} ms ago`}
      </div>

      <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
        stalls over {stallMs} ms in window: {snapshot.stallCount}
      </p>

      {snapshot.worstStall && (
        <p className="font-mono text-[0.7rem] leading-relaxed text-zinc-500 dark:text-zinc-400">
          worst (session) {Math.round(snapshot.worstStall.gapMs)} ms · model busy{" "}
          {snapshot.worstStall.previousInferenceMs.toFixed(1)} ms of it ·{" "}
          {snapshot.worstStall.rafTicks} rAF ticks across it
        </p>
      )}

      <p className="font-mono text-[0.7rem] text-zinc-500 dark:text-zinc-400">
        tab hidden {snapshot.hiddenCount}×
        {snapshot.sinceVisibleMs !== null &&
          ` · back ${Math.round(snapshot.sinceVisibleMs / 1000)}s ago`}
        {snapshot.hidden && " · hidden now, loop is stopped"}
      </p>
    </div>
  );
}

function Row({ label, spread }: { label: string; spread: Spread }) {
  return (
    <>
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-right tabular-nums">
        p50 {spread.p50} · p95 {spread.p95} · max {spread.max}
      </dd>
    </>
  );
}
