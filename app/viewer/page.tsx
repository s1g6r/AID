"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loadRecording,
  RecordingParseError,
  type LoadedRecording,
} from "@/lib/recording/loadRecording";
import { DetailChart } from "./DetailChart";
import { Sparkline } from "./Sparkline";
import { useDarkMode } from "./useDarkMode";
import { MAX_SERIES, SERIES_COLORS } from "./plot";

/**
 * Plots an exported recording so it can be looked at.
 *
 * This page draws lines and nothing else. It does not find peaks, does not
 * compare anything to a threshold, and has no idea what a gesture is. The
 * point of it is to see the shape of a real signal before choosing any numbers
 * from it, and a tool that has already decided where the interesting parts are
 * is no use for that.
 *
 * The file is read with FileReader in this tab. It is never uploaded, and
 * there is nowhere for it to be uploaded to.
 */

type SortMode = "range" | "model";

export default function ViewerPage() {
  const dark = useDarkMode();
  const [loaded, setLoaded] = useState<LoadedRecording | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("range");
  const [fit, setFit] = useState(false);
  const [view, setView] = useState<{ t0: number; t1: number } | null>(null);
  // Channel index per colour slot. Keyed by slot so that removing one channel
  // never repaints the others: a colour belongs to a channel, not to a rank.
  const [slots, setSlots] = useState<(number | null)[]>(() =>
    new Array(MAX_SERIES).fill(null),
  );
  const inputRef = useRef<HTMLInputElement | null>(null);

  const openFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const parsed = loadRecording(await file.text());
      setLoaded(parsed);
      setFileName(file.name);
      setView({
        t0: parsed.times[0],
        t1: parsed.times[parsed.times.length - 1],
      });
      // Nothing is plotted on open. Picking a channel to start with, even the
      // widest-ranging one, would be the page nominating a channel as the
      // interesting one, which is exactly the judgement it must not make.
      setSlots(new Array(MAX_SERIES).fill(null));
    } catch (cause) {
      setLoaded(null);
      setFileName(file.name);
      setError(
        cause instanceof RecordingParseError
          ? cause.message
          : `Could not read that file: ${String(cause)}`,
      );
    }
  }, []);

  const selected = useMemo(
    () =>
      slots
        .map((channelIndex, slot) => ({ channelIndex, slot }))
        .filter((entry) => entry.channelIndex !== null) as {
        channelIndex: number;
        slot: number;
      }[],
    [slots],
  );
  const palette = dark ? SERIES_COLORS.dark : SERIES_COLORS.light;
  const selectedIndices = selected.map((entry) => entry.channelIndex);
  const selectedColors = selected.map((entry) => palette[entry.slot]);
  const colorForChannel = useMemo(() => {
    const map = new Map<number, string>();
    selected.forEach((entry) => map.set(entry.channelIndex, palette[entry.slot]));
    return map;
  }, [selected, palette]);

  const toggleChannel = useCallback((channelIndex: number) => {
    setSlots((current) => {
      const existing = current.indexOf(channelIndex);
      const next = [...current];
      if (existing >= 0) {
        next[existing] = null;
        return next;
      }
      const free = next.indexOf(null);
      if (free < 0) return current;
      next[free] = channelIndex;
      return next;
    });
  }, []);

  // Both sort orders are one click, and also one keystroke. There are exactly
  // two of them and neither is cleverer than the other: one is the model's own
  // order, one is how far each value travelled in this file.
  useEffect(() => {
    if (!loaded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const isTextEntry =
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true ||
        (target instanceof HTMLInputElement &&
          !["checkbox", "radio", "file", "button"].includes(target.type));
      if (isTextEntry) return;
      if (event.key !== "s" && event.key !== "S") return;
      event.preventDefault();
      setSortMode((mode) => (mode === "range" ? "model" : "range"));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loaded]);

  const rows = useMemo(() => {
    if (!loaded) return [];
    if (sortMode === "model") return loaded.channels;
    return [...loaded.channels].sort((a, b) => {
      const rangeA = a.max === null || a.min === null ? -1 : a.max - a.min;
      const rangeB = b.max === null || b.min === null ? -1 : b.max - b.min;
      return rangeB - rangeA;
    });
  }, [loaded, sortMode]);

  const full = loaded
    ? { t0: loaded.times[0], t1: loaded.times[loaded.times.length - 1] }
    : null;
  const zoomed =
    view !== null &&
    full !== null &&
    (view.t0 > full.t0 || view.t1 < full.t1);
  const slotsFull = slots.every((slot) => slot !== null);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6 sm:p-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Recording viewer
        </h1>
        <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Opens a JSON file exported from{" "}
          <Link href="/debug" className="underline underline-offset-2">
            the debug page
          </Link>{" "}
          and plots every blendshape over time. It draws lines and nothing else:
          no peak finding, no thresholds, no opinion about where a gesture
          starts. The file is read in this tab and is not uploaded.
        </p>
      </header>

      <section
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          const file = event.dataTransfer.files[0];
          if (file) void openFile(file);
        }}
        className={`flex flex-wrap items-center gap-4 rounded-lg border border-dashed p-4 text-sm ${
          dragOver
            ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
            : "border-zinc-300 dark:border-zinc-700"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void openFile(file);
            event.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Choose a recording
        </button>
        <span className="text-zinc-500 dark:text-zinc-400">
          {fileName ? (
            <span className="font-mono text-xs">{fileName}</span>
          ) : (
            "or drop one here"
          )}
        </span>
      </section>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950"
        >
          <p className="font-medium text-red-800 dark:text-red-200">
            That file did not open.
          </p>
          <p className="mt-1 text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {loaded && view && full && (
        <>
          <section className="flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border border-zinc-200 p-4 font-mono text-xs sm:grid-cols-4 dark:border-zinc-800">
              <Field label="label" value={loaded.recording.label || "-"} />
              <Field
                label="recorded"
                value={loaded.recording.recordedAt.replace("T", " ").slice(0, 19)}
              />
              <Field
                label="duration"
                value={`${(loaded.durationMs / 1000).toFixed(1)} s`}
              />
              <Field label="samples" value={String(loaded.times.length)} />
              <Field
                label="measured rate"
                value={
                  loaded.measuredHz ? `${loaded.measuredHz.toFixed(2)} Hz` : "-"
                }
              />
              <Field
                label="target rate"
                value={`${loaded.recording.sampleRateHz} Hz`}
              />
              <Field
                label="median gap"
                value={
                  loaded.medianGapMs === null
                    ? "-"
                    : `${loaded.medianGapMs} ms`
                }
              />
              <Field
                label="largest gap"
                value={loaded.maxGapMs === null ? "-" : `${loaded.maxGapMs} ms`}
              />
              <Field
                label="no face"
                value={`${loaded.faceMissingCount} samples`}
              />
              <Field
                label="delegate"
                value={loaded.recording.device?.delegate ?? "-"}
              />
              <Field
                label="capture"
                value={
                  loaded.recording.device?.capture
                    ? `${loaded.recording.device.capture.width}x${loaded.recording.device.capture.height} @ ${loaded.recording.device.capture.frameRate ?? "?"}`
                    : "-"
                }
              />
              <Field
                label="channels"
                value={String(loaded.channels.length)}
              />
            </dl>

            {loaded.warnings.length > 0 && (
              <div
                role="alert"
                className="rounded-md border border-amber-400 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950"
              >
                <ul className="flex list-inside list-disc flex-col gap-1">
                  {loaded.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-medium">
                {selected.length === 0
                  ? "Nothing plotted"
                  : `${selected.length} channel${selected.length === 1 ? "" : "s"} plotted`}
                {zoomed && (
                  <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
                    showing {(view.t0 / 1000).toFixed(2)}s to{" "}
                    {(view.t1 / 1000).toFixed(2)}s
                  </span>
                )}
              </h2>
              <div className="flex flex-wrap gap-2 text-xs">
                <Toggle active={!fit} onClick={() => setFit(false)}>
                  y axis 0 to 1
                </Toggle>
                <Toggle active={fit} onClick={() => setFit(true)}>
                  fit to range
                </Toggle>
                <button
                  type="button"
                  onClick={() => setView(full)}
                  disabled={!zoomed}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  Reset zoom
                </button>
              </div>
            </div>

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Drag across the chart to zoom into a stretch of time, double click
              to zoom back out. Shaded bands are stretches where the model found
              no face; the line breaks there rather than being drawn through a
              value nobody measured.
            </p>

            <DetailChart
              loaded={loaded}
              selected={selectedIndices}
              colors={selectedColors}
              fit={fit}
              dark={dark}
              t0={view.t0}
              t1={view.t1}
              onZoom={(t0, t1) => setView({ t0, t1 })}
            />
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-medium">
                All {loaded.channels.length} channels
              </h2>
              <div className="flex flex-wrap gap-2 text-xs">
                <Toggle
                  active={sortMode === "range"}
                  onClick={() => setSortMode("range")}
                >
                  Sort by range
                </Toggle>
                <Toggle
                  active={sortMode === "model"}
                  onClick={() => setSortMode("model")}
                >
                  Model order
                </Toggle>
                <span className="self-center text-zinc-500 dark:text-zinc-400">
                  or press{" "}
                  <kbd className="rounded border border-zinc-300 px-1 font-mono dark:border-zinc-700">
                    s
                  </kbd>
                </span>
                <button
                  type="button"
                  onClick={() => setSlots(new Array(MAX_SERIES).fill(null))}
                  disabled={selected.length === 0}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  Clear
                </button>
              </div>
            </div>

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Sorting by range puts the channels that moved most in this file at
              the top. That is a sort order and nothing more: it says how far a
              value travelled, not that anything happened.{" "}
              {slotsFull &&
                `All ${MAX_SERIES} colours are in use. Unpick one to plot another.`}
            </p>

            <ul className="grid grid-cols-1 gap-x-8 gap-y-1 lg:grid-cols-2">
              {rows.map((channel) => {
                const isSelected = colorForChannel.has(channel.index);
                const disabled = !isSelected && slotsFull;
                return (
                  <li key={channel.index}>
                    <label
                      className={`grid grid-cols-[1rem_1.75rem_9.5rem_minmax(0,1fr)_5.5rem] items-center gap-2 rounded-md px-2 py-1 font-mono text-xs ${
                        disabled
                          ? "cursor-not-allowed opacity-40"
                          : "cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-900"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={disabled}
                        onChange={() => toggleChannel(channel.index)}
                        className="h-3.5 w-3.5 accent-blue-600"
                      />
                      <span className="text-right text-zinc-400 tabular-nums">
                        {channel.index}
                      </span>
                      <span className="truncate">{channel.name}</span>
                      <Sparkline
                        times={loaded.times}
                        values={channel.values}
                        faceGaps={loaded.faceGaps}
                        t0={view.t0}
                        t1={view.t1}
                        min={channel.min}
                        max={channel.max}
                        fit={fit}
                        dark={dark}
                        color={colorForChannel.get(channel.index) ?? null}
                      />
                      <span className="text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                        {channel.min === null || channel.max === null
                          ? "no face"
                          : `${channel.min.toFixed(2)}–${channel.max.toFixed(2)}`}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
      }
    >
      {children}
    </button>
  );
}
