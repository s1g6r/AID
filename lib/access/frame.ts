/**
 * Builds `AccessFrame`s from the two places frames come from.
 *
 * A live frame comes off the model. A replayed frame comes out of a recording
 * file. An access method should not be able to tell the difference, because
 * the whole reason the recorder and the viewer exist is so a method can be
 * written against real traces and re-run against them later. Keeping both
 * constructions here, rather than in the detection loop and in a test script,
 * is what keeps those two paths honestly identical.
 *
 * Neither function interprets anything. They rekey values and copy timestamps.
 */

import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { isKnownBlendshape, type BlendshapeName } from "@/lib/vision/blendshapes";
import type { BlendshapeRecording, RecordingSample } from "@/lib/recording/types";
import type { AccessFrame, BlendshapeValues } from "./types";

const NO_VALUES: BlendshapeValues = Object.freeze({});

/**
 * One live frame.
 *
 * `timestampMs` is passed in rather than read off the result, so it stays the
 * same clock the detection loop is already using.
 */
export function frameFromResult(
  result: FaceLandmarkerResult,
  timestampMs: number,
): AccessFrame {
  const categories = result.faceBlendshapes?.[0]?.categories;
  if (!categories || categories.length === 0) {
    return { values: NO_VALUES, timestampMs, faceDetected: false, result };
  }

  const values: Partial<Record<BlendshapeName, number>> = {};
  for (const category of categories) {
    // A name this codebase does not know about is dropped rather than carried
    // as an untyped key. The debug page is where model drift is meant to
    // surface; silently widening the type here would hide it instead.
    if (isKnownBlendshape(category.categoryName)) {
      values[category.categoryName] = category.score;
    }
  }
  return { values, timestampMs, faceDetected: true, result };
}

/**
 * One recorded sample.
 *
 * `names` is the recording's own `blendshapeNames`, which is read off the
 * model at record time rather than hardcoded, so it is the only correct way to
 * turn the flat positional array back into names. Passing this project's
 * static list instead would silently mislabel every channel in a file recorded
 * against a different model.
 */
export function frameFromRecordingSample(
  sample: RecordingSample,
  names: readonly string[],
): AccessFrame {
  if (!sample.faceDetected || sample.v === null) {
    return { values: NO_VALUES, timestampMs: sample.t, faceDetected: false };
  }

  const values: Partial<Record<BlendshapeName, number>> = {};
  for (let index = 0; index < names.length; index += 1) {
    const value = sample.v[index];
    if (value === undefined) continue;
    const name = names[index];
    if (isKnownBlendshape(name)) {
      values[name] = value;
    }
  }
  return { values, timestampMs: sample.t, faceDetected: true };
}

/**
 * A whole recording, in order.
 *
 * Timestamps stay as the file's own milliseconds-since-start. That is not the
 * same origin as `performance.now()`, which is fine for any method that only
 * takes differences, and is a bug waiting to happen for one that does not.
 */
export function framesFromRecording(recording: BlendshapeRecording): AccessFrame[] {
  const names = recording.blendshapeNames ?? [];
  return recording.samples.map((sample) => frameFromRecordingSample(sample, names));
}
