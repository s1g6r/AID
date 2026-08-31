/**
 * Reads an exported recording file into the shape the viewer draws from.
 *
 * Deliberately descriptive and nothing more. It reports what is in the file:
 * how many samples there are, how far apart they landed, and the range each
 * channel covered. It does not look for peaks, does not compare anything to a
 * threshold, and does not decide what any of it means. Those are the decisions
 * a switch is made of, and making them here would make them on someone's
 * behalf, out of sight, from a file they were trying to look at with their own
 * eyes.
 */

import { isKnownBlendshape } from "@/lib/vision/blendshapes";
import {
  RECORDING_FORMAT,
  RECORDING_VERSION,
  type BlendshapeRecording,
} from "./types";

export interface ChannelSeries {
  /** Position in the model's output order. */
  index: number;
  name: string;
  /** Parallel to `times`. Null where the model found no face. */
  values: (number | null)[];
  /** Range actually covered in this file. Null if the channel is all nulls. */
  min: number | null;
  max: number | null;
}

/** A run of consecutive samples where no face was found, in recording time. */
export interface FaceGap {
  startMs: number;
  endMs: number;
}

export interface LoadedRecording {
  recording: BlendshapeRecording;
  /** Milliseconds since the recording started, one per sample. */
  times: number[];
  channels: ChannelSeries[];
  durationMs: number;
  /** Measured from the timestamps, not the rate the file claims it used. */
  measuredHz: number | null;
  medianGapMs: number | null;
  maxGapMs: number | null;
  faceMissingCount: number;
  faceGaps: FaceGap[];
  /** Things worth saying out loud rather than rendering as if they were fine. */
  warnings: string[];
}

export class RecordingParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordingParseError";
  }
}

export function loadRecording(text: string): LoadedRecording {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new RecordingParseError(
      "That file is not valid JSON. If the download was interrupted it may be truncated.",
    );
  }

  if (typeof raw !== "object" || raw === null) {
    throw new RecordingParseError("That file does not contain a recording.");
  }

  const file = raw as Partial<BlendshapeRecording>;
  const warnings: string[] = [];

  if (file.format !== RECORDING_FORMAT) {
    throw new RecordingParseError(
      `Expected a file with format "${RECORDING_FORMAT}". This one says "${String(
        file.format,
      )}".`,
    );
  }
  if (!Array.isArray(file.samples)) {
    throw new RecordingParseError("The file has no samples array.");
  }
  if (file.samples.length === 0) {
    throw new RecordingParseError("The file has no samples in it.");
  }
  if (file.version !== RECORDING_VERSION) {
    warnings.push(
      `File is version ${String(file.version)}, this viewer was written for version ${RECORDING_VERSION}. Reading it anyway.`,
    );
  }

  const samples = file.samples;
  const times = samples.map((sample) => sample.t);

  const declaredNames = Array.isArray(file.blendshapeNames)
    ? file.blendshapeNames
    : [];
  // A recording with no face in it has no names, because the names are read off
  // the model the first time a face appears. Fall back to indices so the file
  // still opens instead of failing on a detail.
  const widestSample = samples.reduce(
    (widest, sample) => Math.max(widest, sample.v?.length ?? 0),
    0,
  );
  const channelCount = Math.max(declaredNames.length, widestSample);
  if (channelCount === 0) {
    throw new RecordingParseError(
      "No blendshape values in this file. Every sample is empty, which happens when no face was ever detected.",
    );
  }
  if (declaredNames.length === 0) {
    warnings.push(
      "This file has no blendshape names, so channels are labelled by index. That happens when no face was detected during the recording.",
    );
  } else if (declaredNames.length !== widestSample && widestSample > 0) {
    warnings.push(
      `The file names ${declaredNames.length} channels but the widest sample has ${widestSample} values.`,
    );
  }

  const unknown = declaredNames.filter((name) => !isKnownBlendshape(name));
  if (unknown.length > 0) {
    warnings.push(
      `${unknown.length} channel name(s) are not in this project's blendshape list: ${unknown.slice(0, 5).join(", ")}${unknown.length > 5 ? "…" : ""}.`,
    );
  }

  const channels: ChannelSeries[] = [];
  for (let index = 0; index < channelCount; index += 1) {
    const values: (number | null)[] = new Array(samples.length);
    let min: number | null = null;
    let max: number | null = null;
    for (let s = 0; s < samples.length; s += 1) {
      const v = samples[s].v;
      const value = v ? (v[index] ?? null) : null;
      values[s] = value;
      if (value !== null && Number.isFinite(value)) {
        if (min === null || value < min) min = value;
        if (max === null || value > max) max = value;
      }
    }
    channels.push({
      index,
      name: declaredNames[index] ?? `#${index}`,
      values,
      min,
      max,
    });
  }

  const gaps: number[] = [];
  let nonMonotonic = 0;
  for (let i = 1; i < times.length; i += 1) {
    const delta = times[i] - times[i - 1];
    if (delta <= 0) nonMonotonic += 1;
    gaps.push(delta);
  }
  if (nonMonotonic > 0) {
    warnings.push(
      `${nonMonotonic} timestamp(s) do not increase. The file may be corrupt.`,
    );
  }
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const medianGapMs = sortedGaps.length
    ? sortedGaps[Math.floor(sortedGaps.length / 2)]
    : null;
  const maxGapMs = sortedGaps.length ? sortedGaps[sortedGaps.length - 1] : null;

  const durationMs = times[times.length - 1] - times[0];
  const measuredHz =
    durationMs > 0 ? ((times.length - 1) / durationMs) * 1000 : null;

  const faceGaps: FaceGap[] = [];
  let runStart: number | null = null;
  for (let i = 0; i < samples.length; i += 1) {
    const missing = !samples[i].faceDetected;
    if (missing && runStart === null) runStart = i;
    if ((!missing || i === samples.length - 1) && runStart !== null) {
      const lastMissing = missing ? i : i - 1;
      faceGaps.push({
        startMs: times[runStart],
        // Run the shading to the next sample that did have a face, so a single
        // dropped frame is still wide enough to see.
        endMs: times[Math.min(lastMissing + 1, times.length - 1)],
      });
      runStart = null;
    }
  }

  const faceMissingCount = samples.filter((s) => !s.faceDetected).length;
  if (faceMissingCount === samples.length) {
    warnings.push(
      "No face was detected in any sample, so there is nothing to plot.",
    );
  }

  if (file.sampleCount !== undefined && file.sampleCount !== samples.length) {
    warnings.push(
      `The file says ${file.sampleCount} samples but contains ${samples.length}.`,
    );
  }

  return {
    recording: file as BlendshapeRecording,
    times,
    channels,
    durationMs,
    measuredHz,
    medianGapMs,
    maxGapMs,
    faceMissingCount,
    faceGaps,
    warnings,
  };
}
