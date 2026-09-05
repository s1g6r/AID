"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { useCamera } from "@/lib/camera/useCamera";
import { useFaceLandmarker, type FrameStats } from "@/lib/vision/useFaceLandmarker";
import { frameFromResult } from "@/lib/access/frame";
import { GestureSwitch, type GestureSwitchConfig, type GestureSwitchState } from "@/lib/access/GestureSwitch";
import { ScanEngine, type ScanEngineConfig, type ScanPosition, type ScanSelection } from "@/lib/scanning/ScanEngine";
import { BOARD, BOARD_COLUMNS, BOARD_ROWS } from "./cells";
import { speak, useSpeechAvailability } from "./speech";

/**
 * Camera to switch to scan to board to speech, end to end.
 *
 * The switch config is the one selected on 2026-09-04 after nine channels were
 * ruled out. It is transcribed here rather than imported from anywhere because
 * nothing else in the app has a settled config yet; when a second surface
 * needs it, it moves.
 */
const SWITCH_CONFIG: GestureSwitchConfig = {
  blendshape: "mouthPucker",
  onThreshold: 0.6,
  offThreshold: 0.4,
  dwellMs: 700,
  refractoryMs: 500,
};

/**
 * Scan defaults. Every one of these is a guess that needs a real person.
 *
 * scanIntervalMs 1000 is the asked-for starting point, and it is tight: a
 * press arrives dwellMs (700) after the gesture begins, so it leaves 300 ms to
 * react. The reaction budget is shown live below the board for exactly this
 * reason.
 */
const INITIAL_SCAN_CONFIG: ScanEngineConfig = {
  mode: "row-column",
  drive: "auto",
  rows: BOARD_ROWS,
  columns: BOARD_COLUMNS,
  scanIntervalMs: 1000,
  firstStepExtraMs: 0,
  maxLoops: 3,
  postSelectionPauseMs: 1000,
  pressLatencyCompensationMs: 0,
};

/** Switch readout refresh. The detector runs faster; nobody can read faster. */
const READOUT_HZ = 15;

export default function BoardPage() {
  // A real ref, not an object rebuilt each render: `useFaceLandmarker` has it
  // in its effect deps, so a new identity every render would tear down and
  // reload the model on every state change.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const camera = useCamera({ videoRef, width: 640, height: 480, frameRate: 30 });
  const cameraReady = camera.status === "ready";

  const [position, setPosition] = useState<ScanPosition | null>(null);
  const [lastSelection, setLastSelection] = useState<{ selection: ScanSelection; word: string } | null>(null);
  const [spokenHistory, setSpokenHistory] = useState<string[]>([]);
  const [speechProblem, setSpeechProblem] = useState<string | null>(null);
  const speechState = useSpeechAvailability();

  const [switchState, setSwitchState] = useState<GestureSwitchState | null>(null);
  const [engineStatus, setEngineStatus] = useState<string>("idle");
  const [pressCount, setPressCount] = useState(0);
  const [scanning, setScanning] = useState(false);

  const [scanIntervalMs, setScanIntervalMs] = useState(INITIAL_SCAN_CONFIG.scanIntervalMs);
  const [compensate, setCompensate] = useState(false);

  // Created once. Both machines are plain classes with no React inside them,
  // which is what lets the same code be replayed by the test harness.
  const [gestureSwitch] = useState(() => new GestureSwitch(SWITCH_CONFIG));
  const [engine] = useState(
    () =>
      new ScanEngine(INITIAL_SCAN_CONFIG, {
        onHighlight: (next) => setPosition(next),
        onSelect: (selection) => {
          const word = BOARD[selection.rowIndex]?.[selection.columnIndex]?.word;
          if (!word) return;
          setLastSelection({ selection, word });
          setSpokenHistory((history) => [...history.slice(-11), word]);
          const result = speak(word);
          setSpeechProblem(result.spoke ? null : (result.reason ?? "Speech failed."));
        },
        onExhausted: () => setPosition(null),
      }),
  );

  const handleResult = useCallback(
    (result: FaceLandmarkerResult, stats: FrameStats) => {
      const frame = frameFromResult(result, stats.timestampMs);
      const event = gestureSwitch.update(frame);
      if (event?.type === "press") {
        setPressCount((count) => count + 1);
        engine.onSwitchPress(event.timestampMs);
      }
    },
    [gestureSwitch, engine],
  );

  const landmarker = useFaceLandmarker({
    videoRef,
    enabled: cameraReady,
    onResult: handleResult,
  });

  // The scan runs off its own animation frame rather than off detected frames,
  // so the board keeps scanning through a lost face and can be driven by the
  // keyboard with no camera at all.
  useEffect(() => {
    if (!scanning) return;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      engine.tick(performance.now());
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [scanning, engine]);

  // Poll the two machines for display. Neither pushes state per frame, because
  // a setState at detector rate is the thing soak-test.mjs exists to catch.
  useEffect(() => {
    const id = window.setInterval(() => {
      setSwitchState(gestureSwitch.getState());
      setEngineStatus(engine.status);
    }, 1000 / READOUT_HZ);
    return () => window.clearInterval(id);
  }, [gestureSwitch, engine]);

  useEffect(() => {
    engine.configure({
      scanIntervalMs,
      pressLatencyCompensationMs: compensate ? SWITCH_CONFIG.dwellMs : 0,
    });
  }, [engine, scanIntervalMs, compensate]);

  /**
   * Keyboard stand-in for the switch.
   *
   * Not part of the access method. It is here because the board, the scan
   * timing and the speech need testing separately from whether the gesture is
   * firing, and debugging all four at once through one face is miserable.
   *
   * Only armed while scanning, and it calls preventDefault. Both matter: the
   * space bar activates a focused button by default, so the first version of
   * this silently pressed "Stop scanning" every time instead of the switch,
   * having just been clicked to start. Buttons stay reachable with Enter,
   * which is the other key that activates them.
   */
  useEffect(() => {
    if (!scanning) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target as HTMLElement | null;
      const isTextEntry =
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true ||
        (target instanceof HTMLInputElement &&
          !["checkbox", "radio", "range", "file", "button"].includes(target.type));
      if (isTextEntry) return;
      event.preventDefault();
      setPressCount((count) => count + 1);
      engine.onSwitchPress(performance.now());
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [engine, scanning]);

  const startScanning = useCallback(() => {
    engine.start();
    setScanning(true);
  }, [engine]);

  const stopScanning = useCallback(() => {
    engine.stop();
    setScanning(false);
    setPosition(null);
  }, [engine]);

  const reactionBudgetMs = scanIntervalMs - (compensate ? 0 : SWITCH_CONFIG.dwellMs);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 sm:p-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Scanning board</h1>
        <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          One facial gesture, row-column scanning, six words. The camera, the
          switch and the speech all run in this tab. Nothing is uploaded.
        </p>
      </header>

      <BoardGrid position={position} onCellClick={(row, column) => {
        const word = BOARD[row][column].word;
        setLastSelection({ selection: { rowIndex: row, columnIndex: column, timestampMs: performance.now(), stepsTaken: 0 }, word });
        setSpokenHistory((history) => [...history.slice(-11), word]);
        const result = speak(word);
        setSpeechProblem(result.spoke ? null : (result.reason ?? "Speech failed."));
      }} />

      <section className="flex flex-col gap-2">
        <div
          aria-live="polite"
          className="min-h-[3.5rem] rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800"
        >
          <p className="text-xs text-zinc-500 dark:text-zinc-400">said</p>
          <p className="truncate text-xl font-medium">
            {lastSelection ? lastSelection.word : "nothing yet"}
          </p>
        </div>
        {spokenHistory.length > 1 && (
          <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
            {spokenHistory.join(" · ")}
          </p>
        )}
        {speechState !== "ready" && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {speechState === "unsupported"
              ? "This browser reports no speech synthesis. Selections will still show above."
              : "No system voices are loaded yet. The first selection may be silent."}
          </p>
        )}
        {speechProblem && (
          <p className="text-xs text-red-700 dark:text-red-400">{speechProblem}</p>
        )}
      </section>

      <section className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void camera.start()}
          disabled={cameraReady || camera.status === "requesting"}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-400 dark:disabled:bg-zinc-700"
        >
          Start camera
        </button>
        {!scanning ? (
          <button
            type="button"
            onClick={startScanning}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Start scanning
          </button>
        ) : (
          <button
            type="button"
            onClick={stopScanning}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Stop scanning
          </button>
        )}
        <button
          type="button"
          onClick={camera.stop}
          disabled={!cameraReady}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Stop camera
        </button>
      </section>

      {camera.error && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950">
          <p className="font-medium text-red-800 dark:text-red-200">{camera.error.message}</p>
          <p className="mt-1 text-red-700 dark:text-red-300">{camera.error.hint}</p>
        </div>
      )}

      <section className="grid gap-6 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-zinc-900">
            <video
              ref={videoRef}
              className="h-full w-full -scale-x-100 object-cover"
              playsInline
              muted
              autoPlay
            />
            {!cameraReady && (
              <div className="absolute inset-0 grid place-items-center p-4 text-center text-xs text-zinc-400">
                Camera is off. The board still scans, and the space bar stands
                in for the switch.
              </div>
            )}
          </div>
          <SwitchMeter state={switchState} config={SWITCH_CONFIG} />
        </div>

        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-zinc-200 p-4 font-mono text-xs dark:border-zinc-800">
            <Stat label="channel" value={SWITCH_CONFIG.blendshape} />
            <Stat label="on / off" value={`${SWITCH_CONFIG.onThreshold} / ${SWITCH_CONFIG.offThreshold}`} />
            <Stat label="dwell" value={`${SWITCH_CONFIG.dwellMs} ms`} />
            <Stat label="refractory" value={`${SWITCH_CONFIG.refractoryMs} ms`} />
            <Stat label="camera" value={camera.status} />
            <Stat label="model" value={landmarker.status} />
            <Stat label="scan" value={engineStatus} />
            <Stat label="presses" value={String(pressCount)} />
            <Stat
              label="highlight"
              value={position ? `${position.level} ${position.rowIndex},${position.columnIndex}` : "-"}
            />
            <Stat label="steps last pick" value={lastSelection ? String(lastSelection.selection.stepsTaken) : "-"} />
          </dl>

          <div className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="text-sm font-medium">Tuning</h2>

            <label className="flex flex-col gap-1 text-xs">
              <span className="flex justify-between">
                <span className="text-zinc-500 dark:text-zinc-400">scan interval</span>
                <span className="font-mono">{scanIntervalMs} ms</span>
              </span>
              <input
                type="range"
                min={400}
                max={3000}
                step={100}
                value={scanIntervalMs}
                onChange={(event) => setScanIntervalMs(Number(event.target.value))}
                className="accent-blue-600"
              />
            </label>

            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={compensate}
                onChange={(event) => setCompensate(event.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-blue-600"
              />
              <span>
                <span className="font-medium">Compensate for dwell latency</span>
                <span className="block text-zinc-500 dark:text-zinc-400">
                  Select whatever was highlighted when the gesture started,
                  rather than when the press completed {SWITCH_CONFIG.dwellMs} ms later.
                </span>
              </span>
            </label>

            <p
              className={`rounded-md px-3 py-2 text-xs ${
                reactionBudgetMs < 400
                  ? "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                  : "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
              }`}
            >
              Reaction budget: <span className="font-mono">{reactionBudgetMs} ms</span>.{" "}
              {compensate
                ? "With compensation on, the whole step is available to react in."
                : `A press arrives ${SWITCH_CONFIG.dwellMs} ms after the gesture starts, so this is what is left of a ${scanIntervalMs} ms step.`}
              {reactionBudgetMs < 400 && " That is at or below ordinary simple reaction time."}
            </p>

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              While scanning, the space bar stands in for the switch, so the
              board can be tested without doing the gesture. Buttons still
              respond to Enter. Cells can also be clicked.
            </p>
          </div>

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            <Link href="/debug" className="underline underline-offset-2">Debug page</Link>
            {" · "}
            <Link href="/viewer" className="underline underline-offset-2">Recording viewer</Link>
          </p>
        </div>
      </section>
    </main>
  );
}

function BoardGrid({
  position,
  onCellClick,
}: {
  position: ScanPosition | null;
  onCellClick: (row: number, column: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {BOARD.map((row, rowIndex) => {
        const rowActive =
          position !== null &&
          position.rowIndex === rowIndex &&
          (position.level === "row" || position.level === "cell");
        const rowIsOffered = position?.level === "row" && position.rowIndex === rowIndex;
        return (
          <div
            key={rowIndex}
            className={`flex items-stretch gap-3 rounded-xl p-2 transition-colors ${
              rowIsOffered
                ? "bg-blue-100 ring-4 ring-blue-500 dark:bg-blue-950"
                : rowActive
                  ? "bg-zinc-100 ring-2 ring-zinc-400 dark:bg-zinc-900 dark:ring-zinc-600"
                  : "ring-2 ring-transparent"
            }`}
          >
            <span
              aria-hidden
              className={`grid w-6 place-items-center text-lg ${
                rowActive ? "text-blue-600 dark:text-blue-400" : "text-transparent"
              }`}
            >
              ▶
            </span>
            {row.map((cell, columnIndex) => {
              const cellOffered =
                position?.level === "cell" &&
                position.rowIndex === rowIndex &&
                position.columnIndex === columnIndex;
              return (
                <button
                  key={cell.word}
                  type="button"
                  onClick={() => onCellClick(rowIndex, columnIndex)}
                  aria-current={cellOffered ? "true" : undefined}
                  className={`flex min-h-[7rem] flex-1 flex-col items-center justify-center gap-2 rounded-lg border-4 p-3 transition-transform ${
                    cellOffered
                      ? "scale-105 border-blue-600 bg-blue-50 dark:border-blue-400 dark:bg-blue-950"
                      : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
                  }`}
                >
                  <span aria-hidden className="text-4xl leading-none">{cell.icon}</span>
                  <span className="text-lg font-medium">{cell.word}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** Live switch readout, so a gesture that is not registering is visible. */
function SwitchMeter({
  state,
  config,
}: {
  state: GestureSwitchState | null;
  config: GestureSwitchConfig;
}) {
  const value = state?.value ?? 0;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-baseline justify-between font-mono text-xs">
        <span className="text-zinc-500 dark:text-zinc-400">{config.blendshape}</span>
        <span className="tabular-nums">{value.toFixed(3)}</span>
      </div>
      <div className="relative h-3 w-full overflow-hidden rounded-sm bg-zinc-200 dark:bg-zinc-800">
        <span
          className={`block h-full ${state?.engaged ? "bg-blue-600" : "bg-zinc-400 dark:bg-zinc-600"}`}
          style={{ width: `${Math.min(100, value * 100)}%` }}
        />
        <span
          aria-hidden
          className="absolute top-0 h-full w-px bg-zinc-900 dark:bg-zinc-100"
          style={{ left: `${config.onThreshold * 100}%` }}
        />
      </div>
      <div className="h-2 w-full overflow-hidden rounded-sm bg-zinc-200 dark:bg-zinc-800">
        <span
          className="block h-full bg-green-600"
          style={{ width: `${(state?.dwellProgress ?? 0) * 100}%` }}
        />
      </div>
      <p className="font-mono text-[0.7rem] text-zinc-500 dark:text-zinc-400">
        {state?.refractory ? "refractory" : state?.engaged ? "holding" : "idle"}
      </p>
    </div>
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
