/**
 * Builds a synthetic recording file, so /viewer can be checked without a face.
 *
 * The real fixtures from earlier sessions lived in a temp directory that has
 * since been cleared, and the portrait they were built from went with them. A
 * photograph of a real person is a licensing and privacy decision rather than
 * a build one, so this generates values instead of capturing them.
 *
 * What this IS good for: exercising the viewer, which is a file reader. Every
 * check in verify-viewer.mjs is about parsing, plotting, sorting, zooming and
 * hovering, none of which care whether a human produced the numbers.
 *
 * What this is NOT good for, and must never be used for: anything about the
 * access methods. These traces are sine waves. Replaying a switch over them
 * would measure the generator, not a face. Use a real recording for that.
 *
 *   node test-harness/make-fixture-recording.mjs /tmp/fixture.json [seconds]
 */
import { writeFile } from "node:fs/promises";
import { registerTypeScriptResolution } from "./ts-hooks.mjs";
registerTypeScriptResolution();

const { BLENDSHAPE_NAMES } = await import("@/lib/vision/blendshapes");
const { RECORDING_FORMAT, RECORDING_VERSION } = await import("@/lib/recording/types");

const OUT = process.argv[2] || "/tmp/fixture-recording.json";
const SECONDS = Number(process.argv[3] || 30);
const HZ = 15;

const names = [...BLENDSHAPE_NAMES];
const count = Math.round(SECONDS * HZ);
const samples = [];

for (let i = 0; i < count; i += 1) {
  const t = Math.round((i * 1000) / HZ);
  const seconds = t / 1000;
  // A short stretch with no face in it, because a real session has those and
  // the viewer has to draw around them rather than through them.
  const faceDetected = !(seconds > 12 && seconds < 14);
  if (!faceDetected) {
    samples.push({ t, faceDetected: false, v: null });
    continue;
  }
  const v = names.map((name, channel) => {
    if (name === "_neutral") return 0;
    // Each channel gets its own period so the traces are distinguishable in
    // the viewer, and a slow drift so no channel is a flat line.
    const period = 3 + (channel % 11);
    const base = 0.5 + 0.45 * Math.sin((2 * Math.PI * seconds) / period + channel);
    return Math.min(1, Math.max(0, +(base * (0.6 + 0.4 * Math.sin(seconds / 7))).toFixed(4)));
  });
  samples.push({ t, faceDetected: true, v });
}

const recording = {
  format: RECORDING_FORMAT,
  version: RECORDING_VERSION,
  label: "synthetic fixture, sine waves, NOT a face",
  recordedAt: new Date().toISOString(),
  sampleRateHz: HZ,
  durationMs: samples.at(-1).t,
  sampleCount: samples.length,
  blendshapeNames: names,
  device: {
    userAgent: "make-fixture-recording.mjs",
    capture: { width: 640, height: 480, frameRate: 30 },
    delegate: null,
  },
  samples,
};

await writeFile(OUT, JSON.stringify(recording));
console.log(
  JSON.stringify(
    { out: OUT, samples: samples.length, channels: names.length, seconds: SECONDS },
    null,
    2,
  ),
);
