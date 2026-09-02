import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import type { BlendshapeName } from "@/lib/vision/blendshapes";

/**
 * Shared shapes for the three access methods.
 *
 * STATUS: sketch, second pass. These types exist so the stubs can reference
 * each other and so the debug tooling has something to import. They encode the
 * structure the project plan describes (one interface, three implementations)
 * and nothing more. Change them freely once the first real method is working.
 */

export type AccessMethodKind = "gesture-switch" | "head-pointer" | "gaze-pointer";

/**
 * Blendshape scores for one frame, keyed by name, 0..1.
 *
 * Partial because the source is not guaranteed to carry all 52: a model swap
 * can rename or drop a channel, and a recording only contains what was in the
 * file. A missing key means "not reported", which is a different claim from a
 * score of zero, so methods should decide for themselves what to do about it
 * rather than reading a fabricated 0.
 */
export type BlendshapeValues = Readonly<Partial<Record<BlendshapeName, number>>>;

/**
 * One frame of model output, handed to a method by the detection loop.
 *
 * Previously this carried a raw `FaceLandmarkerResult` and every method dug
 * the values out itself. It now carries the blendshape scores already keyed by
 * name, for two reasons: a switch reading one channel should not walk a
 * 52-entry array every frame when the detection loop runs at 15 Hz and
 * `soak-test.mjs` exists to catch exactly that kind of cost, and a frame in
 * this shape can be built from a recorded sample as easily as from a live
 * result, which is what makes replaying a recording through a real method
 * possible at all.
 */
export interface AccessFrame {
  /** Empty when `faceDetected` is false. */
  values: BlendshapeValues;
  /**
   * Monotonic milliseconds. `performance.now()` for live frames, milliseconds
   * since the recording started when replayed. Methods should only ever take
   * differences of this, never treat it as wall clock.
   */
  timestampMs: number;
  /**
   * False when the model found no face. `values` is empty in that case, which
   * is not the same as a neutral face, and a method that treats it as one is
   * making a claim about a person it cannot see.
   */
  faceDetected: boolean;
  /**
   * The raw model output, present only on live frames.
   *
   * GestureSwitch does not need this. HeadPointer and GazePointer do: head
   * pose comes from the facial transformation matrix or landmark geometry,
   * and neither survives into a blendshape recording. Undefined on replayed
   * frames, so those two methods cannot be tested against recordings until
   * the recorder stores geometry as well.
   */
  result?: FaceLandmarkerResult;
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
