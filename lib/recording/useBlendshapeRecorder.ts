"use client";

import { useCallback, useRef, useState } from "react";
import {
  RECORDING_FORMAT,
  RECORDING_VERSION,
  type BlendshapeRecording,
  type RecordingDevice,
  type RecordingSample,
} from "./types";

/**
 * Captures the blendshape stream to memory and hands it back as JSON.
 *
 * Plumbing only. It does not look at the numbers, it does not know what a
 * gesture is, and it makes no decisions about thresholds. The point is to get
 * honest data off a real face so those numbers can be chosen from evidence
 * rather than guessed.
 *
 * Samples live in a ref and never enter React state. Nine thousand samples in
 * state would re-render the page on every frame and starve the detector whose
 * output is being recorded. The UI polls `getStats()` on whatever cadence it
 * already renders at.
 */

export interface RecorderStats {
  isRecording: boolean;
  sampleCount: number;
  durationMs: number;
  /** Rough JSON size, for noticing a recording that has grown very large. */
  estimatedBytes: number;
}

export interface UseBlendshapeRecorderOptions {
  /** Target capture rate. Samples are gated on elapsed time, not frame count. */
  sampleRateHz?: number;
}

export interface UseBlendshapeRecorderResult {
  isRecording: boolean;
  /** True once there is something worth downloading. */
  hasRecording: boolean;
  start: () => void;
  stop: () => void;
  discard: () => void;
  /**
   * Called from the detection loop for every processed frame. Cheap and
   * side-effect free when not recording, and self-throttling to sampleRateHz.
   */
  capture: (
    names: string[],
    values: number[],
    faceDetected: boolean,
    timestampMs: number,
  ) => void;
  getStats: () => RecorderStats;
  /** Serialise what has been captured. Returns null if nothing has. */
  build: (label: string, device: RecordingDevice) => BlendshapeRecording | null;
}

export function useBlendshapeRecorder(
  options: UseBlendshapeRecorderOptions = {},
): UseBlendshapeRecorderResult {
  const { sampleRateHz = 15 } = options;
  const minGapMs = 1000 / sampleRateHz;

  const [isRecording, setIsRecording] = useState(false);
  const [hasRecording, setHasRecording] = useState(false);

  const recordingRef = useRef(false);
  const samplesRef = useRef<RecordingSample[]>([]);
  const namesRef = useRef<string[]>([]);
  const startedAtRef = useRef(0);
  /** Next slot on the fixed sampleRateHz grid that still wants a frame. */
  const nextTargetAtRef = useRef(0);
  const recordedAtRef = useRef<string>("");
  // Running estimate of the interval between incoming frames, used to decide
  // how early a frame may be taken. See the comment in `capture`.
  const lastFrameAtRef = useRef(0);
  const frameIntervalRef = useRef(0);

  const start = useCallback(() => {
    samplesRef.current = [];
    namesRef.current = [];
    startedAtRef.current = 0;
    nextTargetAtRef.current = 0;
    lastFrameAtRef.current = 0;
    frameIntervalRef.current = 0;
    recordedAtRef.current = new Date().toISOString();
    recordingRef.current = true;
    setIsRecording(true);
    setHasRecording(false);
  }, []);

  const stop = useCallback(() => {
    recordingRef.current = false;
    setIsRecording(false);
    setHasRecording(samplesRef.current.length > 0);
  }, []);

  const discard = useCallback(() => {
    recordingRef.current = false;
    samplesRef.current = [];
    namesRef.current = [];
    setIsRecording(false);
    setHasRecording(false);
  }, []);

  const capture = useCallback(
    (
      names: string[],
      values: number[],
      faceDetected: boolean,
      timestampMs: number,
    ) => {
      if (!recordingRef.current) return;

      if (startedAtRef.current === 0) {
        startedAtRef.current = timestampMs;
        nextTargetAtRef.current = timestampMs;
      }

      // Track how fast frames are actually arriving, as an exponential moving
      // average so one hitched frame does not move it much.
      if (lastFrameAtRef.current > 0) {
        const delta = timestampMs - lastFrameAtRef.current;
        frameIntervalRef.current =
          frameIntervalRef.current === 0
            ? delta
            : frameIntervalRef.current * 0.9 + delta * 0.1;
      }
      lastFrameAtRef.current = timestampMs;

      /*
       * Decimate against a fixed grid of target times, taking the frame
       * nearest each slot rather than the first frame strictly past it.
       *
       * Two failure modes this avoids, both measured rather than theorised:
       *
       *   - A plain `now - lastSample < minGap` gate halves the rate whenever
       *     the camera runs at about the target rate. At 15 fps every frame
       *     lands a fraction of a millisecond short of the 66.67 ms gate, is
       *     rejected, and the one after is taken instead. Measured: 127 ms
       *     median gap, 7.9 Hz, from a 15 fps source.
       *   - Measuring from the last sample taken rather than from the grid
       *     lets early frames drag the whole schedule forward, so a 20 fps
       *     source is taken in full. Measured: 20 Hz from a 15 Hz target.
       *
       * Allowing a frame up to half a frame-interval early is ordinary
       * nearest-neighbour resampling. It collapses to "take everything" when
       * the camera is slower than the target, which is the honest behaviour:
       * there is nothing to decimate.
       */
      const tolerance = frameIntervalRef.current / 2;
      if (timestampMs < nextTargetAtRef.current - tolerance) return;
      nextTargetAtRef.current += minGapMs;
      // If the loop stalled, do not try to make up the missed slots in a burst.
      if (nextTargetAtRef.current < timestampMs) {
        nextTargetAtRef.current = timestampMs + minGapMs;
      }

      // Read the names off the model the first time we see any, rather than
      // trusting the hardcoded list.
      if (namesRef.current.length === 0 && names.length > 0) {
        namesRef.current = names;
      }

      samplesRef.current.push({
        t: Math.round(timestampMs - startedAtRef.current),
        faceDetected,
        v: faceDetected && values.length > 0 ? values : null,
      });
    },
    [minGapMs],
  );

  const getStats = useCallback((): RecorderStats => {
    const samples = samplesRef.current;
    const last = samples.at(-1);
    return {
      isRecording: recordingRef.current,
      sampleCount: samples.length,
      durationMs: last ? last.t : 0,
      // ~7 bytes per coefficient once serialised, plus per-sample overhead.
      estimatedBytes: samples.length * (namesRef.current.length * 7 + 40),
    };
  }, []);

  const build = useCallback(
    (label: string, device: RecordingDevice): BlendshapeRecording | null => {
      const samples = samplesRef.current;
      if (samples.length === 0) return null;
      return {
        format: RECORDING_FORMAT,
        version: RECORDING_VERSION,
        label,
        recordedAt: recordedAtRef.current,
        sampleRateHz,
        durationMs: samples.at(-1)?.t ?? 0,
        sampleCount: samples.length,
        blendshapeNames: namesRef.current,
        device,
        samples,
      };
    },
    [sampleRateHz],
  );

  return {
    isRecording,
    hasRecording,
    start,
    stop,
    discard,
    capture,
    getStats,
    build,
  };
}

/** Triggers a browser download. Nothing is uploaded; the blob is local. */
export function downloadRecording(recording: BlendshapeRecording): string {
  const slug =
    recording.label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "recording";
  const stamp = recording.recordedAt.replace(/[:.]/g, "-").slice(0, 19);
  const filename = `aid-${slug}-${stamp}.json`;

  const blob = new Blob([JSON.stringify(recording)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);

  return filename;
}
