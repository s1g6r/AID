/**
 * What the export costs at the moment it happens.
 *
 * The soak measured retained heap after a forced GC, which is the steady state
 * and not the peak. At the instant `downloadRecording` runs, three copies of
 * the session exist at once: the sample array, the JSON string, and the Blob.
 * This builds a structure the same shape and size as the real ten minute
 * recording and measures each stage while holding the ones before it.
 */
import { loadChromium } from "./playwright.mjs";

const SAMPLES = Number(process.argv[2] || 9028);
const chromium = await loadChromium();
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("about:blank");
const cdp = await page.context().newCDPSession(page);
await cdp.send("HeapProfiler.enable");

async function heapMB(label) {
  await cdp.send("HeapProfiler.collectGarbage");
  const usage = await cdp.send("Runtime.getHeapUsage");
  return { label, mb: +(usage.usedSize / 1048576).toFixed(2) };
}

const points = [];
points.push(await heapMB("empty page"));

await page.evaluate((n) => {
  // Same shape the recorder holds: one growing array, each entry a fresh
  // 52-element array of float32-derived values.
  const held = [];
  for (let i = 0; i < n; i += 1) {
    const v = new Array(52);
    for (let j = 0; j < 52; j += 1) v[j] = Math.fround(Math.random());
    held.push({ t: i * 67, faceDetected: true, v });
  }
  window.__samples = held;
}, SAMPLES);
points.push(await heapMB("samples array held (what the recorder holds)"));

const stringifyMs = await page.evaluate(() => {
  const started = performance.now();
  window.__json = JSON.stringify({
    format: "aid-blendshape-recording",
    version: 1,
    samples: window.__samples,
  });
  return performance.now() - started;
});
points.push(await heapMB("+ JSON string held"));

const jsonBytes = await page.evaluate(() => window.__json.length);

await page.evaluate(() => {
  window.__blob = new Blob([window.__json], { type: "application/json" });
});
points.push(await heapMB("+ Blob held (peak: all three alive)"));

await page.evaluate(() => {
  window.__json = null;
  window.__blob = null;
});
points.push(await heapMB("string and blob released"));

await page.evaluate(() => {
  window.__samples = null;
});
points.push(await heapMB("samples released"));

console.log(
  JSON.stringify(
    {
      samples: SAMPLES,
      jsonBytes,
      jsonMB: +(jsonBytes / 1048576).toFixed(2),
      stringifyMs: +stringifyMs.toFixed(0),
      points,
    },
    null,
    2,
  ),
);
await browser.close();
