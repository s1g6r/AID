/**
 * The 52 blendshape coefficients MediaPipe Face Landmarker reports per frame.
 *
 * The list is the ARKit-compatible set the model was trained against, in the
 * model's own output order (index 0 is `_neutral`). Scores are 0..1.
 *
 * This list is a convenience for writing type-safe access methods later, e.g.
 * `{ blendshape: "jawOpen" }`. It is NOT the source of truth at runtime: the
 * debug page renders whatever the model actually returns and flags any drift
 * from this list, so a model swap surfaces loudly instead of silently.
 */
export const BLENDSHAPE_NAMES = [
  "_neutral",
  "browDownLeft",
  "browDownRight",
  "browInnerUp",
  "browOuterUpLeft",
  "browOuterUpRight",
  "cheekPuff",
  "cheekSquintLeft",
  "cheekSquintRight",
  "eyeBlinkLeft",
  "eyeBlinkRight",
  "eyeLookDownLeft",
  "eyeLookDownRight",
  "eyeLookInLeft",
  "eyeLookInRight",
  "eyeLookOutLeft",
  "eyeLookOutRight",
  "eyeLookUpLeft",
  "eyeLookUpRight",
  "eyeSquintLeft",
  "eyeSquintRight",
  "eyeWideLeft",
  "eyeWideRight",
  "jawForward",
  "jawLeft",
  "jawOpen",
  "jawRight",
  "mouthClose",
  "mouthDimpleLeft",
  "mouthDimpleRight",
  "mouthFrownLeft",
  "mouthFrownRight",
  "mouthFunnel",
  "mouthLeft",
  "mouthLowerDownLeft",
  "mouthLowerDownRight",
  "mouthPressLeft",
  "mouthPressRight",
  "mouthPucker",
  "mouthRight",
  "mouthRollLower",
  "mouthRollUpper",
  "mouthShrugLower",
  "mouthShrugUpper",
  "mouthSmileLeft",
  "mouthSmileRight",
  "mouthStretchLeft",
  "mouthStretchRight",
  "mouthUpperUpLeft",
  "mouthUpperUpRight",
  "noseSneerLeft",
  "noseSneerRight",
] as const;

/** Number of blendshapes the model is expected to emit. */
export const EXPECTED_BLENDSHAPE_COUNT = BLENDSHAPE_NAMES.length;

/** A single blendshape's name, e.g. `"jawOpen"`. */
export type BlendshapeName = (typeof BLENDSHAPE_NAMES)[number];

/** One blendshape score for one frame. */
export interface BlendshapeScore {
  /** Model output order. */
  index: number;
  /** Category name as reported by the model. */
  name: string;
  /** Activation, 0..1. */
  score: number;
}

const NAME_SET: ReadonlySet<string> = new Set(BLENDSHAPE_NAMES);

/** True if `name` is one of the 52 names this codebase knows about. */
export function isKnownBlendshape(name: string): name is BlendshapeName {
  return NAME_SET.has(name);
}
