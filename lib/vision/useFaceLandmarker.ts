"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FaceLandmarker, FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { createFaceLandmarker, type CreateFaceLandmarkerOptions } from "./faceLandmarker";

export type LandmarkerStatus = "idle" | "loading" | "ready" | "error";

/** Per-frame timing, kept separate from the model output. */
export interface FrameStats {
  /** Wall-clock time spent inside detectForVideo, in ms. */
  inferenceMs: number;
  /** Frames actually run through the model in the last second. */
  fps: number;
  /** Timestamp handed to MediaPipe for this frame. */
  timestampMs: number;
  /** False when the model returned no face for this frame. */
  faceDetected: boolean;
}

export interface UseFaceLandmarkerOptions extends CreateFaceLandmarkerOptions {
  /** The element the loop reads frames from. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Load the model. Flip to true once the camera is running. */
  enabled: boolean;
  /**
   * Called on every processed frame.
   *
   * This is a hot path at 30 to 60 Hz, so it is invoked directly rather than
   * routed through React state. Consumers that need to render should throttle
   * on their own side.
   */
  onResult?: (result: FaceLandmarkerResult, stats: FrameStats) => void;
}

export interface UseFaceLandmarkerResult {
  status: LandmarkerStatus;
  error: string | null;
  /** Which delegate the model actually loaded on. */
  delegate: "GPU" | "CPU" | null;
}

export function useFaceLandmarker(
  options: UseFaceLandmarkerOptions,
): UseFaceLandmarkerResult {
  const {
    videoRef,
    enabled,
    onResult,
    delegate: requestedDelegate = "GPU",
    numFaces = 1,
    minFaceDetectionConfidence = 0.5,
    minFacePresenceConfidence = 0.5,
    minTrackingConfidence = 0.5,
  } = options;

  const [status, setStatus] = useState<LandmarkerStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [delegate, setDelegate] = useState<"GPU" | "CPU" | null>(null);

  // Held in a ref so a consumer re-render never restarts the detection loop.
  // Written in an effect rather than during render, per the React ref rules;
  // being one commit stale is harmless for a callback the loop reads at 60 Hz.
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);

  const fail = useCallback((message: string) => {
    setError(message);
    setStatus("error");
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    // MediaPipe rejects a timestamp that is not strictly increasing, and
    // requestAnimationFrame fires faster than the camera produces frames, so
    // we skip any tick where the video has not advanced.
    let lastVideoTime = -1;
    let framesThisSecond = 0;
    let windowStart = performance.now();
    let fps = 0;

    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);

      const video = videoRef.current;
      const landmarker = landmarkerRef.current;
      if (!video || !landmarker) return;
      // HAVE_CURRENT_DATA. Before this the element has no frame to read.
      if (video.readyState < 2 || video.videoWidth === 0) return;
      if (video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;

      const timestampMs = performance.now();
      let result: FaceLandmarkerResult;
      try {
        result = landmarker.detectForVideo(video, timestampMs);
      } catch (err) {
        // Stop rather than spam: a throwing detector throws every frame.
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        fail(err instanceof Error ? err.message : String(err));
        return;
      }
      const inferenceMs = performance.now() - timestampMs;

      framesThisSecond += 1;
      const elapsed = timestampMs - windowStart;
      if (elapsed >= 1000) {
        fps = Math.round((framesThisSecond * 1000) / elapsed);
        framesThisSecond = 0;
        windowStart = timestampMs;
      }

      onResultRef.current?.(result, {
        inferenceMs,
        fps,
        timestampMs,
        faceDetected: result.faceLandmarks.length > 0,
      });
    };

    const load = async () => {
      setStatus("loading");
      setError(null);
      try {
        const created = await createFaceLandmarker({
          delegate: requestedDelegate,
          numFaces,
          minFaceDetectionConfidence,
          minFacePresenceConfidence,
          minTrackingConfidence,
        });
        if (cancelled) {
          created.landmarker.close();
          return;
        }
        landmarkerRef.current = created.landmarker;
        setDelegate(created.delegate);
        setStatus("ready");
        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        if (cancelled) return;
        fail(err instanceof Error ? err.message : String(err));
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, [
    enabled,
    videoRef,
    fail,
    requestedDelegate,
    numFaces,
    minFaceDetectionConfidence,
    minFacePresenceConfidence,
    minTrackingConfidence,
  ]);

  return { status, error, delegate };
}
