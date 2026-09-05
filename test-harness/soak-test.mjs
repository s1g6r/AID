/**
 * Ten minute recorder soak.
 *
 * Records a full session against a looping fake camera and measures, at wall
 * clock intervals: JS heap after a forced GC, DOM counters, the recorder's own
 * sample count, and the detector's frame rate. Then downloads the JSON and
 * measures the file rather than estimating it.
 */
import { loadChromium } from "./playwright.mjs";
import { readFile, writeFile, stat } from "node:fs/promises";

const URL = process.env.SOAK_URL || "http://localhost:3111/debug";
/**
 * Camera source: a path to a .y4m with a face in it, or the literal "fake" for
 * Chromium's generated colour bars.
 *
 * The bars contain no face, so every sample comes back `faceDetected: false`
 * with `v: null`. That still exercises the detection loop and the recorder at
 * full cost, which is what makes it a usable regression check for a change to
 * either, but it cannot say anything about blendshape values. Use a face y4m
 * when the question is about the numbers rather than the machinery.
 */
const CAMERA = process.argv[2];
const Y4M = CAMERA && CAMERA !== "fake" ? CAMERA : null;
const OUT = process.argv[3] || "/tmp/soak-result.json";
const DURATION_MS = Number(process.env.SOAK_MINUTES || 10) * 60_000;
const POLL_MS = 10_000;
const HEAP_AT_MS = [0, 2 * 60_000, 5 * 60_000, 10 * 60_000];

const chromium = await loadChromium();
const browser = await chromium.launch({
  args: [
    "--use-fake-device-for-media-stream",
    ...(Y4M ? [`--use-file-for-fake-video-capture=${Y4M}`] : []),
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const context = await browser.newContext({
  permissions: ["camera"],
  viewport: { width: 1400, height: 1100 },
  acceptDownloads: true,
});
const page = await context.newPage();
const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (e) => pageErrors.push({ at: Date.now(), message: e.message }));
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") {
    consoleErrors.push({ at: Date.now(), type: m.type(), text: m.text().slice(0, 300) });
  }
});

const cdp = await context.newCDPSession(page);
await cdp.send("HeapProfiler.enable");

async function heap() {
  // Force a full GC first, so what is left is genuinely retained rather than
  // garbage that has not been collected yet.
  await cdp.send("HeapProfiler.collectGarbage");
  const usage = await cdp.send("Runtime.getHeapUsage");
  const dom = await cdp.send("Memory.getDOMCounters");
  return {
    heapUsedMB: +(usage.usedSize / 1048576).toFixed(2),
    heapTotalMB: +(usage.totalSize / 1048576).toFixed(2),
    domNodes: dom.nodes,
    domListeners: dom.jsEventListeners,
    domDocuments: dom.documents,
  };
}

const readStats = () =>
  page.evaluate(() => {
    const dts = [...document.querySelectorAll("dt")].map((d) => d.textContent);
    const dds = [...document.querySelectorAll("dd")].map((d) => d.textContent);
    const out = {};
    dts.forEach((k, i) => (out[k] = dds[i]));
    return out;
  });

await page.goto(URL, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Start camera" }).click();
await page.waitForFunction(
  () => [...document.querySelectorAll("dd")][1]?.textContent === "ready",
  { timeout: 60_000 },
);
// Let the detector settle before the baseline heap reading.
await page.waitForTimeout(3000);

const baseline = await heap();
const beforeStats = await readStats();

await page.getByPlaceholder("jawOpen x10 slow").fill("ten minute soak");
const t0 = Date.now();
await page.getByRole("button", { name: "Start recording" }).click();

const timeline = [];
const heapPoints = [];
let nextHeapIdx = 0;
// t=0 heap reading, taken immediately after the recording starts.
heapPoints.push({ atMs: 0, wallMs: 0, ...(await heap()), note: "recording just started" });
nextHeapIdx = 1;

while (Date.now() - t0 < DURATION_MS) {
  await page.waitForTimeout(POLL_MS);
  const elapsed = Date.now() - t0;
  const s = await readStats();
  const point = {
    wallMs: elapsed,
    samples: Number(String(s.samples ?? "").replace(/[^0-9]/g, "")) || 0,
    recorderDurationS: parseFloat(s.duration) || 0,
    approxSizeKB: parseFloat(s["approx size"]) || 0,
    detectFps: Number(s["detect fps"]),
    inferenceMs: parseFloat(s.inference),
    face: s.face,
    camera: s.camera,
    model: s.model,
  };
  timeline.push(point);
  process.stdout.write(
    `t=${(elapsed / 1000).toFixed(0)}s samples=${point.samples} recDur=${point.recorderDurationS}s fps=${point.detectFps} face=${point.face}\n`,
  );

  while (nextHeapIdx < HEAP_AT_MS.length && elapsed >= HEAP_AT_MS[nextHeapIdx]) {
    const target = HEAP_AT_MS[nextHeapIdx];
    heapPoints.push({ atMs: target, wallMs: elapsed, ...(await heap()), samples: point.samples });
    process.stdout.write(`  heap@${target / 60000}min -> ${heapPoints.at(-1).heapUsedMB} MB used, ${heapPoints.at(-1).domNodes} nodes\n`);
    nextHeapIdx += 1;
  }
}

const elapsedAtStop = Date.now() - t0;
const statsAtStop = await readStats();
// The 10 minute reading, if the loop exited before the poll that would have taken it.
if (nextHeapIdx < HEAP_AT_MS.length) {
  heapPoints.push({
    atMs: HEAP_AT_MS[nextHeapIdx],
    wallMs: elapsedAtStop,
    ...(await heap()),
    samples: Number(String(statsAtStop.samples ?? "").replace(/[^0-9]/g, "")) || 0,
  });
}

await page.getByRole("button", { name: "Stop recording" }).click();
const afterStop = await heap();

const downloadStart = Date.now();
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 180_000 }),
  page.getByRole("button", { name: "Download JSON" }).click(),
]);
const suggested = download.suggestedFilename();
const savedPath = `${OUT.replace(/\.json$/, "")}-${suggested}`;
await download.saveAs(savedPath);
const downloadMs = Date.now() - downloadStart;
const afterDownload = await heap();

await page.screenshot({ path: OUT.replace(/\.json$/, "") + "-page.png", fullPage: true });

const bytes = (await stat(savedPath)).size;
const raw = await readFile(savedPath, "utf8");
let parsed = null;
let parseError = null;
try {
  parsed = JSON.parse(raw);
} catch (e) {
  parseError = e.message;
}

let fileReport = { parseError };
if (parsed) {
  const samples = parsed.samples;
  const gaps = samples.slice(1).map((s, i) => s.t - samples[i].t);
  const sorted = [...gaps].sort((a, b) => a - b);
  // Rate inside each 60 s window, computed from the sample timestamps rather
  // than wall clock, so a stall shows up as a dip instead of averaging away.
  const buckets = [];
  for (let start = 0; start < parsed.durationMs; start += 60_000) {
    const end = start + 60_000;
    const inWindow = samples.filter((s) => s.t >= start && s.t < end);
    const span = inWindow.length > 1 ? inWindow.at(-1).t - inWindow[0].t : 0;
    buckets.push({
      minute: start / 60_000,
      count: inWindow.length,
      hz: span > 0 ? +(((inWindow.length - 1) / span) * 1000).toFixed(2) : null,
      faceDetected: inWindow.filter((s) => s.faceDetected).length,
    });
  }
  fileReport = {
    bytes,
    megabytes: +(bytes / 1048576).toFixed(2),
    downloadMs,
    format: parsed.format,
    version: parsed.version,
    label: parsed.label,
    recordedAt: parsed.recordedAt,
    sampleRateHz: parsed.sampleRateHz,
    durationMs: parsed.durationMs,
    durationMin: +(parsed.durationMs / 60000).toFixed(3),
    sampleCount: parsed.sampleCount,
    samplesActualLength: samples.length,
    countsAgree: parsed.sampleCount === samples.length,
    blendshapeNameCount: parsed.blendshapeNames.length,
    device: parsed.device,
    faceDetectedCount: samples.filter((s) => s.faceDetected).length,
    faceMissingCount: samples.filter((s) => !s.faceDetected).length,
    vLengths: [...new Set(samples.map((s) => (s.v === null ? "null" : s.v.length)))],
    overallHz: +(((samples.length - 1) / parsed.durationMs) * 1000).toFixed(3),
    gapMin: sorted[0],
    gapP50: sorted[Math.floor(sorted.length / 2)],
    gapP99: sorted[Math.floor(sorted.length * 0.99)],
    gapMax: sorted.at(-1),
    gapsOver200ms: gaps.filter((g) => g > 200).length,
    monotonicTimestamps: samples.every((s, i) => i === 0 || s.t > samples[i - 1].t),
    allValuesInRange: samples.every(
      (s) => s.v === null || s.v.every((x) => typeof x === "number" && x >= 0 && x <= 1),
    ),
    anyNaN: samples.some((s) => s.v !== null && s.v.some((x) => Number.isNaN(x))),
    perMinute: buckets,
    lastSampleT: samples.at(-1).t,
    firstSampleT: samples[0].t,
    // Does the last byte of the file close the JSON, i.e. no truncation.
    tail: raw.slice(-60),
  };
}

const result = {
  url: URL,
  source: Y4M,
  savedPath,
  requestedDurationMs: DURATION_MS,
  actualRecordingWallMs: elapsedAtStop,
  baselineBeforeRecording: baseline,
  beforeStats,
  heapPoints,
  afterStop,
  afterDownload,
  statsAtStop,
  timeline,
  pageErrors,
  consoleErrors: consoleErrors.slice(0, 40),
  consoleErrorCount: consoleErrors.length,
  file: fileReport,
};

await writeFile(OUT, JSON.stringify(result, null, 2));
console.log("\n=== DONE ===");
console.log(JSON.stringify({ ...result, timeline: `${timeline.length} points`, file: { ...fileReport, perMinute: fileReport.perMinute } }, null, 2));
await browser.close();
