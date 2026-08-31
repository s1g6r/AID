"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * getUserMedia lifecycle, reduced to states a UI can actually branch on.
 *
 * The failure modes matter more here than in a typical app: the person in
 * front of the camera may not be able to speak or point, so whoever is
 * helping them needs to know from the screen alone whether the camera is
 * blocked, missing, or busy. Every failure carries a recovery hint.
 */
export type CameraStatus =
  | "idle"
  | "requesting"
  | "ready"
  | "denied"
  | "not-found"
  | "in-use"
  | "insecure-context"
  | "unsupported"
  | "error";

export interface CameraError {
  status: Exclude<CameraStatus, "idle" | "requesting" | "ready">;
  /** Plain-language explanation. No jargon, safe to show to a family. */
  message: string;
  /** What to try next. */
  hint: string;
  /** Underlying DOMException name, kept for the build log. */
  cause?: string;
}

export interface UseCameraOptions {
  /**
   * The <video> element to attach the stream to. The caller owns it, because
   * the detection loop needs the same element and React's compiler rules do
   * not want a ref handed back out of a hook alongside render state.
   */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Requested capture size. The browser may return something else. */
  width?: number;
  height?: number;
  frameRate?: number;
}

/*
 * There is deliberately no `autoStart`. The camera is only ever opened by an
 * explicit call from a user gesture, so nobody lands on a page and gets a
 * permission prompt they did not ask for. It also keeps Safari happy, which
 * is stricter about getUserMedia outside a gesture.
 */

export interface UseCameraResult {
  status: CameraStatus;
  error: CameraError | null;
  /** Live track settings once running, for the debug readout. */
  settings: MediaTrackSettings | null;
  start: () => Promise<void>;
  stop: () => void;
}

const DEFAULTS = { width: 640, height: 480, frameRate: 30 } as const;

function describe(err: unknown): CameraError {
  const name = err instanceof DOMException ? err.name : "";

  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return {
        status: "denied",
        message: "The browser is blocking camera access for this page.",
        hint: "Open the camera icon in the address bar, choose Allow, then reload. On macOS also check System Settings, Privacy and Security, Camera.",
        cause: name,
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return {
        status: "not-found",
        message: "No camera was found that matches what this page asked for.",
        hint: "Plug in a webcam, or close any app that may have claimed the built-in one, then try again.",
        cause: name,
      };
    case "NotReadableError":
    case "TrackStartError":
      return {
        status: "in-use",
        message: "A camera exists but another program is already using it.",
        hint: "Quit video call apps such as Zoom, Meet, Teams or Photo Booth, then try again.",
        cause: name,
      };
    case "NotSupportedError":
      // Not in the getUserMedia spec's rejection list, but Chromium emits it
      // from builds whose media stack cannot capture at all. Observed in
      // headless Chromium, where it is returned regardless of permission
      // state or whether a device exists.
      return {
        status: "unsupported",
        message: "This browser cannot capture from a camera.",
        hint: "Use a current version of Chrome, Edge, Firefox or Safari, in a normal window rather than a private or kiosk mode.",
        cause: name,
      };
    case "SecurityError":
      return {
        status: "insecure-context",
        message: "Camera access is only allowed on a secure connection.",
        hint: "Use the https:// address, or http://localhost during development.",
        cause: name,
      };
    case "AbortError":
      return {
        status: "error",
        message: "The camera started but stopped before it could deliver video.",
        hint: "Try again. If it keeps happening, restart the browser.",
        cause: name,
      };
    default:
      return {
        status: "error",
        message: "The camera could not be started.",
        hint: "Try again, or reload the page.",
        cause: name || (err instanceof Error ? err.message : String(err)),
      };
  }
}

export function useCamera(options: UseCameraOptions): UseCameraResult {
  const {
    videoRef,
    width = DEFAULTS.width,
    height = DEFAULTS.height,
    frameRate = DEFAULTS.frameRate,
  } = options;

  const streamRef = useRef<MediaStream | null>(null);
  // Guards against a second start() landing while the first is still awaiting
  // the permission prompt, which would leave an orphaned stream running.
  const pendingRef = useRef(false);

  const [status, setStatus] = useState<CameraStatus>("idle");
  const [error, setError] = useState<CameraError | null>(null);
  const [settings, setSettings] = useState<MediaTrackSettings | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setSettings(null);
    setStatus("idle");
  }, [videoRef]);

  const start = useCallback(async () => {
    if (pendingRef.current || streamRef.current) return;

    // Distinguish "browser has no support" from "page is not a secure context",
    // because the fixes are completely different.
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setError(describe(new DOMException("insecure", "SecurityError")));
      setStatus("insecure-context");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError({
        status: "unsupported",
        message: "This browser does not offer camera access to web pages.",
        hint: "Use a current version of Chrome, Edge, Firefox or Safari.",
      });
      setStatus("unsupported");
      return;
    }

    pendingRef.current = true;
    setError(null);
    setStatus("requesting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: width },
          height: { ideal: height },
          frameRate: { ideal: frameRate },
        },
      });

      // stop() may have run while the permission prompt was open.
      if (!pendingRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      setSettings(stream.getVideoTracks()[0]?.getSettings() ?? null);

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        // Some browsers reject play() if the element is not yet in the layout.
        await video.play().catch(() => undefined);
      }

      setStatus("ready");
    } catch (err) {
      const described = describe(err);
      setError(described);
      setStatus(described.status);
    } finally {
      pendingRef.current = false;
    }
  }, [videoRef, width, height, frameRate]);

  // Release the camera if the component unmounts while a stream is live.
  useEffect(() => {
    return () => {
      pendingRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  return { status, error, settings, start, stop };
}
