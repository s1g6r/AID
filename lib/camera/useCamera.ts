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
  | "timeout"
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
  /**
   * How long to wait for getUserMedia before giving up on it.
   *
   * A hung request is not hypothetical: on a loaded machine, or with a camera
   * the OS has not released, getUserMedia can sit forever without resolving or
   * rejecting. Without this the page stays in `requesting`, the start button
   * stays disabled, and clicking it does nothing with nothing on screen to say
   * why. Reported as "the camera is stuck off" on 2026-09-04.
   */
  timeoutMs?: number;
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

const DEFAULTS = { width: 640, height: 480, frameRate: 30, timeoutMs: 10_000 } as const;

/** Thrown by the timeout leg of the race, so the catch can tell them apart. */
const TIMED_OUT = Symbol("camera-request-timed-out");

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
    timeoutMs = DEFAULTS.timeoutMs,
  } = options;

  const streamRef = useRef<MediaStream | null>(null);
  // Guards against a second start() landing while the first is still awaiting
  // the permission prompt, which would leave an orphaned stream running.
  const pendingRef = useRef(false);
  /**
   * Bumped by stop(), by unmount, and by every new start(). A request whose
   * number is no longer current has been abandoned, and any stream it produces
   * is stopped rather than attached. This is what makes the timeout safe:
   * getUserMedia cannot be cancelled, so a late grant has to be caught here.
   */
  const attemptRef = useRef(0);

  const [status, setStatus] = useState<CameraStatus>("idle");
  const [error, setError] = useState<CameraError | null>(null);
  const [settings, setSettings] = useState<MediaTrackSettings | null>(null);

  const stop = useCallback(() => {
    // Abandon anything still in flight, so a stream that arrives after this
    // cannot attach itself to a camera the user has just switched off.
    attemptRef.current += 1;
    pendingRef.current = false;
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

    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    pendingRef.current = true;
    setError(null);
    setStatus("requesting");

    const request = navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: width },
        height: { ideal: height },
        frameRate: { ideal: frameRate },
      },
    });

    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const stream = await Promise.race([
        request,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(TIMED_OUT), timeoutMs);
        }),
      ]);

      // stop(), unmount, or a newer start() ran while the prompt was open.
      if (attemptRef.current !== attempt) {
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
      if (attemptRef.current !== attempt) return;

      if (err === TIMED_OUT) {
        // getUserMedia has no cancel. The request keeps running, so the only
        // thing to do is let it finish on its own and release whatever it
        // eventually produces. Without this a late grant leaves the camera
        // light on with nothing on screen accounting for it.
        void request.then(
          (late) => late.getTracks().forEach((track) => track.stop()),
          () => undefined,
        );
        setError({
          status: "timeout",
          message: `The camera did not respond within ${Math.round(timeoutMs / 1000)} seconds.`,
          hint: "This usually means the machine is busy or another program is still holding the camera. Wait a moment and try again. If a permission prompt is open, answer it first.",
        });
        setStatus("timeout");
        return;
      }

      const described = describe(err);
      setError(described);
      setStatus(described.status);
    } finally {
      clearTimeout(timer);
      // Only if this attempt is still the current one: a newer start() owns
      // the flag by now and clearing it here would let a third request in.
      if (attemptRef.current === attempt) pendingRef.current = false;
    }
  }, [videoRef, width, height, frameRate, timeoutMs]);

  // Release the camera if the component unmounts while a stream is live.
  useEffect(() => {
    return () => {
      attemptRef.current += 1;
      pendingRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  return { status, error, settings, start, stop };
}
