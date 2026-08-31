/**
 * On-disk shape of a blendshape recording.
 *
 * Designed to be loaded straight into pandas or numpy without reshaping, so
 * the values are a flat array positionally indexed by `blendshapeNames` rather
 * than 52 key/value pairs per sample. A ten minute session is roughly nine
 * thousand samples; the flat form keeps that to a few megabytes instead of
 * tens.
 */

export const RECORDING_FORMAT = "aid-blendshape-recording";
export const RECORDING_VERSION = 1;

export interface RecordingSample {
  /** Milliseconds since recording started. */
  t: number;
  /** False when the model found no face in this frame. */
  faceDetected: boolean;
  /**
   * The 52 coefficients, positionally matching `blendshapeNames`.
   *
   * Null, not zeros, when no face was detected. Writing zeros would be
   * fabricating a reading of a neutral face, which is a different claim from
   * "there was nothing to read".
   */
  v: number[] | null;
}

export interface RecordingDevice {
  userAgent: string;
  /** Resolution and frame rate the camera actually gave us. */
  capture: { width?: number; height?: number; frameRate?: number } | null;
  /** Which MediaPipe delegate ran the model. */
  delegate: "GPU" | "CPU" | null;
}

export interface BlendshapeRecording {
  format: typeof RECORDING_FORMAT;
  version: typeof RECORDING_VERSION;
  /** Free-text note, e.g. "jawOpen x10 slow". Empty if not given. */
  label: string;
  /** ISO 8601, local clock. */
  recordedAt: string;
  /** Target rate. Actual spacing is in each sample's `t`, trust that instead. */
  sampleRateHz: number;
  durationMs: number;
  sampleCount: number;
  /** Model output order, read off the model rather than hardcoded. */
  blendshapeNames: string[];
  device: RecordingDevice;
  samples: RecordingSample[];
}
