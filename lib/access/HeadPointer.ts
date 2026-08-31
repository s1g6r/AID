import type { AccessFrame, AccessMethod, PointerSample } from "./types";

/**
 * Cursor driven by head orientation.
 *
 * NOT IMPLEMENTED. Interface only.
 *
 * Scope warning carried over from the project plan: many people with severe
 * cerebral palsy have poor head control, which is often exactly why they use
 * eye gaze. This method does not serve the same population as GazePointer and
 * should never be presented as a substitute for it.
 *
 * Yaw and pitch are expected to come from the facial transformation matrix or
 * from landmark geometry; which one is a question for the build, not for this
 * file.
 */
export interface HeadPointerConfig {
  /** Screen travel per degree of head rotation, separately per axis. */
  gainX: number;
  gainY: number;
  /** Rotation, in degrees, treated as still. Suppresses resting tremor. */
  deadzoneDeg: number;
  /** One-euro filter parameters, for smoothing without adding lag. */
  filter: OneEuroFilterConfig;
  /** Invert an axis for a person seated at an angle to the camera. */
  invertX: boolean;
  invertY: boolean;
}

/** Standard one-euro filter parameters. Named here, tuned later. */
export interface OneEuroFilterConfig {
  /** Baseline cutoff frequency, Hz. Lower is smoother and laggier. */
  minCutoff: number;
  /** How aggressively the cutoff rises with speed. */
  beta: number;
  /** Cutoff for the derivative estimate, Hz. */
  derivateCutoff: number;
}

/** Head orientation in degrees, before any mapping to the screen. */
export interface HeadPose {
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
}

/**
 * Where the person's neutral head position sits, established by a calibration
 * step. All pointer output is relative to this.
 */
export interface HeadPointerCalibration {
  neutral: HeadPose;
  /** Comfortable rotation range in each direction, for mapping to screen edges. */
  rangeDeg: { yaw: number; pitch: number };
  capturedAt: number;
}

export class HeadPointer implements AccessMethod<HeadPointerConfig, PointerSample> {
  readonly kind = "head-pointer" as const;

  constructor(_config: HeadPointerConfig, _calibration?: HeadPointerCalibration) {
    throw new Error("HeadPointer is not implemented yet.");
  }

  get config(): Readonly<HeadPointerConfig> {
    throw new Error("HeadPointer is not implemented yet.");
  }

  update(_frame: AccessFrame): PointerSample | null {
    throw new Error("HeadPointer is not implemented yet.");
  }

  /** Raw pose for this frame, unsmoothed and uncalibrated. */
  getPose(): HeadPose | null {
    throw new Error("HeadPointer is not implemented yet.");
  }

  setCalibration(_calibration: HeadPointerCalibration): void {
    throw new Error("HeadPointer is not implemented yet.");
  }

  configure(_patch: Partial<HeadPointerConfig>): void {
    throw new Error("HeadPointer is not implemented yet.");
  }

  reset(): void {
    throw new Error("HeadPointer is not implemented yet.");
  }
}
