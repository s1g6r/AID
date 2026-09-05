"use client";

import type { CameraError, CameraStatus } from "./useCamera";

/**
 * What the video panel says when there is no picture.
 *
 * This exists because /board rendered a flat "Camera is off." for every state
 * that was not `ready`. A request still in flight, a denial, a hung device and
 * a camera that was genuinely off were indistinguishable on screen, and the
 * start button is disabled while a request is in flight. The result, reported
 * on 2026-09-04, was "clicking Start camera does nothing and it says the
 * camera is off" for what was most likely a getUserMedia call that never came
 * back on a loaded machine.
 *
 * Both pages that open a camera use this, so the two cannot drift apart again.
 */
export function CameraOverlay({
  status,
  error,
  idleNote,
}: {
  status: CameraStatus;
  error: CameraError | null;
  /** Page-specific reassurance shown only when the camera is simply off. */
  idleNote?: string;
}) {
  if (status === "ready") return null;

  if (status === "requesting") {
    return (
      <Shell>
        <span className="flex items-center gap-2 font-medium text-zinc-200">
          <span
            aria-hidden
            className="h-2 w-2 animate-pulse rounded-full bg-blue-400"
          />
          Asking for the camera
        </span>
        <span className="text-zinc-400">
          If no prompt appeared, check the camera icon in the address bar. This
          can take a few seconds on a busy machine.
        </span>
      </Shell>
    );
  }

  if (status === "idle") {
    return (
      <Shell>
        <span className="font-medium text-zinc-300">Camera is off.</span>
        {idleNote && <span className="text-zinc-400">{idleNote}</span>}
      </Shell>
    );
  }

  // Every remaining status is a failure, and each one carries its own message
  // and hint from the hook. The fallback text is unreachable in practice and
  // is here so a new status added to the union cannot render an empty panel.
  return (
    <Shell>
      <span className="font-medium text-amber-300">
        {error?.message ?? "The camera is not running."}
      </span>
      {error?.hint && <span className="text-zinc-400">{error.hint}</span>}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-4 text-center text-xs leading-relaxed"
    >
      {children}
    </div>
  );
}

/** Start-button label, so the button says what the camera is actually doing. */
export function startButtonLabel(status: CameraStatus): string {
  if (status === "requesting") return "Starting…";
  if (status === "idle" || status === "ready") return "Start camera";
  return "Try again";
}
