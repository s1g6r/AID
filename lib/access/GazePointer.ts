import type { AccessFrame, AccessMethod, PointerSample } from "./types";

/**
 * Cursor driven by estimated gaze direction.
 *
 * NOT IMPLEMENTED. Interface only. Build this one last.
 *
 * Honesty requirement carried over from the project plan: browser gaze
 * estimation runs around four degrees of visual angle of error, roughly four
 * centimetres on a thirteen inch screen, against 0.4 to 0.9 degrees for a
 * research-grade tracker. That is enough to separate four to nine large
 * targets and nowhere near enough to drive a sixty cell symbol board.
 *
 * The interface therefore makes the error a required output rather than an
 * optional extra, so no consumer can render a gaze cursor without also having
 * the number that says how much to trust it.
 */
export interface GazePointerConfig {
  /** Smoothing parameters. Gaze is noisier than head pose. */
  smoothingWindowFrames: number;
  /**
   * Below this confidence, emit nothing rather than a plausible-looking
   * position. A wrong cursor is worse than no cursor.
   */
  minConfidence: number;
}

/** A calibration point: where we asked them to look, and what we measured. */
export interface GazeCalibrationSample {
  /** Target shown on screen, normalized 0..1. */
  targetX: number;
  targetY: number;
  /** Raw estimate recorded while they looked at it. */
  rawX: number;
  rawY: number;
  timestampMs: number;
}

export interface GazeCalibration {
  samples: GazeCalibrationSample[];
  capturedAt: number;
  /**
   * Residual error from the calibration fit, in degrees of visual angle.
   * This is the number that gets displayed to the user, not hidden in a log.
   */
  meanErrorDeg: number;
}

/** Gaze output always carries its own error estimate. */
export interface GazeSample extends PointerSample {
  /** Estimated error radius for this sample, in degrees of visual angle. */
  errorDeg: number;
}

export class GazePointer implements AccessMethod<GazePointerConfig, GazeSample> {
  readonly kind = "gaze-pointer" as const;

  constructor(_config: GazePointerConfig, _calibration?: GazeCalibration) {
    throw new Error("GazePointer is not implemented yet.");
  }

  get config(): Readonly<GazePointerConfig> {
    throw new Error("GazePointer is not implemented yet.");
  }

  update(_frame: AccessFrame): GazeSample | null {
    throw new Error("GazePointer is not implemented yet.");
  }

  setCalibration(_calibration: GazeCalibration): void {
    throw new Error("GazePointer is not implemented yet.");
  }

  /** Current calibration quality, for the honest error readout. */
  getCalibration(): GazeCalibration | null {
    throw new Error("GazePointer is not implemented yet.");
  }

  configure(_patch: Partial<GazePointerConfig>): void {
    throw new Error("GazePointer is not implemented yet.");
  }

  reset(): void {
    throw new Error("GazePointer is not implemented yet.");
  }
}
