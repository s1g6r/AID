import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";

/**
 * Creation of the MediaPipe Face Landmarker, pointed at our own origin.
 *
 * Both paths are served from public/ (see scripts/sync-mediapipe-wasm.mjs and
 * public/models/). Nothing is fetched from a CDN, and no frame ever leaves the
 * browser: the WASM runtime does inference in this tab and returns numbers.
 */
export const WASM_BASE_PATH = "/mediapipe/wasm";
export const MODEL_ASSET_PATH = "/models/face_landmarker.task";

export type { FaceLandmarkerResult };

export interface CreateFaceLandmarkerOptions {
  /** "GPU" uses WebGL and is much faster; "CPU" is the compatibility path. */
  delegate?: "GPU" | "CPU";
  numFaces?: number;
  minFaceDetectionConfidence?: number;
  minFacePresenceConfidence?: number;
  minTrackingConfidence?: number;
}

/**
 * Loads the WASM runtime and the model bundle, in VIDEO running mode.
 *
 * Falls back from GPU to CPU on machines where WebGL is unavailable or
 * blocklisted, which is common on the older hardware this tool has to run on.
 * The returned `delegate` says which one actually took, so the debug page can
 * show it rather than assuming.
 */
export async function createFaceLandmarker(
  options: CreateFaceLandmarkerOptions = {},
): Promise<{ landmarker: FaceLandmarker; delegate: "GPU" | "CPU" }> {
  const {
    delegate = "GPU",
    numFaces = 1,
    minFaceDetectionConfidence = 0.5,
    minFacePresenceConfidence = 0.5,
    minTrackingConfidence = 0.5,
  } = options;

  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_PATH);

  const build = (which: "GPU" | "CPU") =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_ASSET_PATH, delegate: which },
      runningMode: "VIDEO",
      numFaces,
      minFaceDetectionConfidence,
      minFacePresenceConfidence,
      minTrackingConfidence,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });

  try {
    return { landmarker: await build(delegate), delegate };
  } catch (err) {
    if (delegate === "CPU") throw err;
    console.warn("[vision] GPU delegate unavailable, falling back to CPU", err);
    return { landmarker: await build("CPU"), delegate: "CPU" };
  }
}
