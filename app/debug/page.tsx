"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { useCamera } from "@/lib/camera/useCamera";
import { CameraOverlay, startButtonLabel } from "@/lib/camera/CameraOverlay";
import { useFaceLandmarker, type FrameStats } from "@/lib/vision/useFaceLandmarker";
import {
  BLENDSHAPE_NAMES,
  EXPECTED_BLENDSHAPE_COUNT,
  isKnownBlendshape,
  type BlendshapeScore,
} from "@/lib/vision/blendshapes";
import {
  downloadRecording,
  useBlendshapeRecorder,
  type RecorderStats,
} from "@/lib/recording/useBlendshapeRecorder";

/**
 * Hello world for the sensing layer: live camera plus every blendshape the
 * model emits, updating in place.
 *
 * The detector runs at camera rate but React renders at 15 Hz. Re-rendering
 * 52 rows sixty times a second would starve the loop whose numbers we are
 * trying to read, and nobody can read a number that changes that fast anyway.
 */
const RENDER_HZ = 15;

/**
 * Recording rate. The detector runs faster than this, at camera rate, so
 * samples are decimated. Fifteen samples a second gives four or five readings
 * inside a 300 ms dwell, which is enough to see the shape of a gesture.
 */
const RECORD_HZ = 15;

type SortMode = "score" | "model";

export default function DebugPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const camera = useCamera({ videoRef, width: 640, height: 480, frameRate: 30 });
  const cameraReady = camera.status === "ready";

  // Written by the detection loop, read by the render timer. Never in state.
  const latestRef = useRef<{
    scores: BlendshapeScore[];
    stats: FrameStats;
  } | null>(null);

  const [scores, setScores] = useState<BlendshapeScore[]>([]);
  const [stats, setStats] = useState<FrameStats | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("score");
  const [observedNames, setObservedNames] = useState<string[] | null>(null);

  const {
    isRecording,
    hasRecording,
    start: startRecording,
    stop: stopRecording,
    discard: discardRecording,
    capture: captureSample,
    getStats,
    build: buildRecording,
  } = useBlendshapeRecorder({ sampleRateHz: RECORD_HZ });
  const [label, setLabel] = useState("");
  const [recorderStats, setRecorderStats] = useState<RecorderStats | null>(null);
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const captureRef = useRef(captureSample);
  useEffect(() => {
    captureRef.current = captureSample;
  }, [captureSample]);

  const handleResult = useCallback(
    (result: FaceLandmarkerResult, frameStats: FrameStats) => {
      const categories = result.faceBlendshapes[0]?.categories ?? [];
      latestRef.current = {
        scores: categories.map((category, index) => ({
          index,
          name: category.categoryName,
          score: category.score,
        })),
        stats: frameStats,
      };
      // Recording is gated on elapsed time inside the recorder, and is a no-op
      // when not recording, so this stays cheap on the hot path.
      captureRef.current(
        categories.map((category) => category.categoryName),
        categories.map((category) => category.score),
        frameStats.faceDetected,
        frameStats.timestampMs,
      );
    },
    [],
  );

  const landmarker = useFaceLandmarker({
    videoRef,
    enabled: cameraReady,
    onResult: handleResult,
  });
  const landmarkerDelegate = landmarker.delegate;
  const cameraSettings = camera.settings;
  const modelReady = landmarker.status === "ready";

  const handleDownload = useCallback(() => {
    const recording = buildRecording(label.trim(), {
      userAgent: navigator.userAgent,
      capture: cameraSettings
        ? {
            width: cameraSettings.width,
            height: cameraSettings.height,
            frameRate: cameraSettings.frameRate,
          }
        : null,
      delegate: landmarkerDelegate,
    });
    if (!recording) return;
    setSavedAs(downloadRecording(recording));
  }, [buildRecording, label, cameraSettings, landmarkerDelegate]);

  // Pull the latest frame into React on a fixed cadence.
  useEffect(() => {
    if (!cameraReady) return;
    const id = window.setInterval(() => {
      const latest = latestRef.current;
      if (!latest) return;
      setScores(latest.scores);
      setStats(latest.stats);
      if (latest.scores.length > 0) {
        setObservedNames(latest.scores.map((entry) => entry.name));
      }
      setRecorderStats(getStats());
    }, 1000 / RENDER_HZ);
    return () => window.clearInterval(id);
  }, [cameraReady, getStats]);

  const rows = useMemo(() => {
    if (sortMode === "model") return scores;
    return [...scores].sort((a, b) => b.score - a.score);
  }, [scores, sortMode]);

  // Surfaces a model swap that changes the vocabulary out from under a switch
  // that was bound to a name. Compares against lib/vision/blendshapes.ts.
  const drift = useMemo(() => {
    if (!observedNames) return null;
    const unexpected = observedNames.filter((name) => !isKnownBlendshape(name));
    const missing = BLENDSHAPE_NAMES.filter(
      (name) => !observedNames.includes(name),
    );
    const countOk = observedNames.length === EXPECTED_BLENDSHAPE_COUNT;
    if (countOk && unexpected.length === 0 && missing.length === 0) return null;
    return { count: observedNames.length, unexpected, missing };
  }, [observedNames]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6 sm:p-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Blendshape debug</h1>
        <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Live camera and every blendshape coefficient the Face Landmarker
          reports. Everything runs in this tab. No video and no numbers are sent
          anywhere.
        </p>
      </header>

      <section className="grid gap-8 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-zinc-900">
            <video
              ref={videoRef}
              className="h-full w-full -scale-x-100 object-cover"
              playsInline
              muted
              autoPlay
            />
            <CameraOverlay status={camera.status} error={camera.error} />
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void camera.start()}
              disabled={cameraReady || camera.status === "requesting"}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-400 dark:disabled:bg-zinc-700"
            >
              {startButtonLabel(camera.status)}
            </button>
            <button
              type="button"
              onClick={camera.stop}
              disabled={!cameraReady}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Stop camera
            </button>
          </div>

          {camera.error && (
            <div
              role="alert"
              className="rounded-md border border-red-300 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950"
            >
              <p className="font-medium text-red-800 dark:text-red-200">
                {camera.error.message}
              </p>
              <p className="mt-1 text-red-700 dark:text-red-300">
                {camera.error.hint}
              </p>
              {camera.error.cause && (
                <p className="mt-2 font-mono text-xs text-red-600 dark:text-red-400">
                  {camera.error.cause}
                </p>
              )}
            </div>
          )}

          {landmarker.error && (
            <div
              role="alert"
              className="rounded-md border border-red-300 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950"
            >
              <p className="font-medium text-red-800 dark:text-red-200">
                The face model failed.
              </p>
              <p className="mt-1 font-mono text-xs text-red-700 dark:text-red-300">
                {landmarker.error}
              </p>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-zinc-200 p-4 font-mono text-xs dark:border-zinc-800">
            <Stat label="camera" value={camera.status} />
            <Stat label="model" value={landmarker.status} />
            <Stat label="delegate" value={landmarker.delegate ?? "-"} />
            <Stat
              label="capture"
              value={
                camera.settings
                  ? `${camera.settings.width}x${camera.settings.height}`
                  : "-"
              }
            />
            <Stat label="detect fps" value={stats ? String(stats.fps) : "-"} />
            <Stat
              label="inference"
              value={stats ? `${stats.inferenceMs.toFixed(1)} ms` : "-"}
            />
            <Stat
              label="face"
              value={stats ? (stats.faceDetected ? "yes" : "no") : "-"}
            />
            <Stat label="blendshapes" value={String(scores.length)} />
          </dl>

          <section className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Record a session</h2>
              {isRecording && (
                <span className="flex items-center gap-2 text-xs font-medium text-red-600 dark:text-red-400">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-red-600 dark:bg-red-400" />
                  recording
                </span>
              )}
            </div>

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Captures all {EXPECTED_BLENDSHAPE_COUNT} coefficients at{" "}
              {RECORD_HZ} Hz to a JSON file. The file is built in this tab and
              saved straight to your downloads folder. Nothing is uploaded.
            </p>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-zinc-500 dark:text-zinc-400">
                What is this recording? Goes in the filename.
              </span>
              <input
                type="text"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="jawOpen x10 slow"
                disabled={isRecording}
                className="rounded-md border border-zinc-300 px-3 py-2 font-mono text-xs disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              {!isRecording ? (
                <button
                  type="button"
                  onClick={() => {
                    setSavedAs(null);
                    startRecording();
                  }}
                  disabled={!modelReady}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-zinc-400 dark:disabled:bg-zinc-700"
                >
                  Start recording
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopRecording}
                  className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  Stop recording
                </button>
              )}
              <button
                type="button"
                onClick={handleDownload}
                disabled={!hasRecording || isRecording}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                Download JSON
              </button>
              <button
                type="button"
                onClick={() => {
                  setSavedAs(null);
                  discardRecording();
                }}
                disabled={!hasRecording && !isRecording}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                Discard
              </button>
            </div>

            {(isRecording || hasRecording) && recorderStats && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs">
                <Stat
                  label="samples"
                  value={String(recorderStats.sampleCount)}
                />
                <Stat
                  label="duration"
                  value={`${(recorderStats.durationMs / 1000).toFixed(1)} s`}
                />
                <Stat
                  label="approx size"
                  value={`${(recorderStats.estimatedBytes / 1024).toFixed(0)} KB`}
                />
              </dl>
            )}

            {savedAs && (
              <p className="font-mono text-xs text-green-700 dark:text-green-400">
                saved {savedAs}
              </p>
            )}

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Open a saved file in{" "}
              <Link href="/viewer" className="underline underline-offset-2">
                the viewer
              </Link>{" "}
              to plot it.
            </p>
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium">
              {scores.length} blendshapes
              {stats ? ` at ${RENDER_HZ} Hz` : ""}
            </h2>
            <div className="flex gap-2 text-xs">
              <SortButton
                active={sortMode === "score"}
                onClick={() => setSortMode("score")}
              >
                Sort by value
              </SortButton>
              <SortButton
                active={sortMode === "model"}
                onClick={() => setSortMode("model")}
              >
                Model order
              </SortButton>
            </div>
          </div>

          {drift && (
            <div
              role="alert"
              className="rounded-md border border-amber-400 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950"
            >
              <p className="font-medium">
                Model output does not match the expected {EXPECTED_BLENDSHAPE_COUNT}{" "}
                blendshapes. Got {drift.count}.
              </p>
              {drift.unexpected.length > 0 && (
                <p className="mt-1 font-mono text-xs">
                  unexpected: {drift.unexpected.join(", ")}
                </p>
              )}
              {drift.missing.length > 0 && (
                <p className="mt-1 font-mono text-xs">
                  missing: {drift.missing.join(", ")}
                </p>
              )}
            </div>
          )}

          {rows.length === 0 ? (
            <p className="rounded-md border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
              Start the camera and put a face in frame.
            </p>
          ) : (
            /*
             * Not an aria-live region on purpose. Fifty-two values changing
             * fifteen times a second would make a screen reader unusable.
             */
            <ol className="flex flex-col gap-px font-mono text-xs">
              {rows.map((row) => (
                <li
                  key={row.name || row.index}
                  className="grid grid-cols-[1.5rem_11rem_3.5rem_minmax(0,1fr)] items-center gap-2 py-0.5"
                >
                  <span className="text-right text-zinc-400 tabular-nums">
                    {row.index}
                  </span>
                  <span className="truncate">{row.name}</span>
                  <span className="text-right tabular-nums">
                    {row.score.toFixed(3)}
                  </span>
                  <span className="h-2 w-full overflow-hidden rounded-sm bg-zinc-200 dark:bg-zinc-800">
                    <span
                      className="block h-full rounded-sm bg-blue-500"
                      style={{ width: `${Math.min(100, row.score * 100)}%` }}
                    />
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="truncate text-right">{value}</dd>
    </>
  );
}

function SortButton({
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
