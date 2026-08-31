import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";

/**
 * Shared shapes for the three access methods.
 *
 * STATUS: sketch. These types exist so the stubs can reference each other and
 * so the debug tooling has something to import. They encode the structure the
 * project plan describes (one interface, three implementations) and nothing
 * more. Change them freely once the first real method is working; nothing
 * downstream depends on them yet.
 */

export type AccessMethodKind = "gesture-switch" | "head-pointer" | "gaze-pointer";

/** One frame of model output, handed to a method by the detection loop. */
export interface AccessFrame {
  result: FaceLandmarkerResult;
  /** Same clock the detection loop used, i.e. performance.now(). */
  timestampMs: number;
}

/** A discrete activation, the output of a switch. */
export interface SwitchEvent {
  type: "press" | "release";
  timestampMs: number;
  /** Activation value at the moment the event fired, for the build log. */
  value: number;
}

/** A continuous pointer position in normalized viewport coordinates, 0..1. */
export interface PointerSample {
  x: number;
  y: number;
  timestampMs: number;
  /**
   * How much to trust this sample, 0..1. GazePointer is expected to report
   * low values; the plan is to show the error rather than hide it.
   */
  confidence: number;
}

/**
 * The common contract. `update` is called once per detected frame and returns
 * this method's output for that frame, or null when it has nothing to say.
 */
export interface AccessMethod<TConfig, TOutput> {
  readonly kind: AccessMethodKind;
  readonly config: Readonly<TConfig>;
  update(frame: AccessFrame): TOutput | null;
  configure(patch: Partial<TConfig>): void;
  /** Drop all accumulated state. Called between trials. */
  reset(): void;
}
