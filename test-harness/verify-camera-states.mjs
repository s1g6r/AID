/**
 * The camera states the UI has to tell apart, driven in a real browser.
 *
 * This exists because of a real report: "clicking Start camera does nothing
 * and it says the camera is off". The page said that for a request still in
 * flight, for a denial, and for a camera that was genuinely off, and the start
 * button is disabled while a request is in flight, so a getUserMedia call that
 * never came back was indistinguishable from a dead button. None of those
 * states can be reached with a real camera on demand, so getUserMedia is
 * stubbed per scenario before any app code runs.
 *
 *   node test-harness/verify-camera-states.mjs [http://localhost:3111/board]
 */
import { loadChromium } from "./playwright.mjs";

const URL = process.argv[2] || process.env.BOARD_URL || "http://localhost:3111/board";
const SHOT = process.argv[3];

const chromium = await loadChromium();
const browser = await chromium.launch({
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});

let passed = 0;
let failed = 0;
const pageErrors = [];

function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (ok) { passed += 1; console.log(`ok    ${label}`); }
  else { failed += 1; console.log(`FAIL  ${label}\n        expected ${expected}\n        actual   ${actual}`); }
}

function contains(label, haystack, needle) {
  const ok = typeof haystack === "string" && haystack.includes(needle);
  if (ok) { passed += 1; console.log(`ok    ${label}`); }
  else { failed += 1; console.log(`FAIL  ${label}\n        expected to contain ${JSON.stringify(needle)}\n        actual   ${JSON.stringify(haystack)}`); }
}

/** Reads one cell out of the page's stat grid by its label. */
const stat = (page, label) =>
  page.evaluate((wanted) => {
    const dt = [...document.querySelectorAll("dt")].find(
      (node) => node.textContent.trim() === wanted,
    );
    return dt?.nextElementSibling?.textContent?.trim() ?? null;
  }, label);

const overlayText = (page) => page.locator('[role="status"]').first().innerText();
const startButton = (page) =>
  page.getByRole("button", { name: /Start camera|Starting|Try again/ });

async function openPage(initScript) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1400 },
    permissions: ["camera"],
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  if (initScript) await page.addInitScript(initScript);
  await page.goto(URL, { waitUntil: "networkidle" });
  return { page, context };
}

// --- 1. a request that never comes back, then a retry that works ----------
{
  const { page, context } = await openPage(() => {
    // First call hangs forever, which is what a wedged media stack looks like.
    // Second call is the real one, so the retry can actually succeed.
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let calls = 0;
    navigator.mediaDevices.getUserMedia = (...args) => {
      calls += 1;
      window.__gumCalls = calls;
      if (calls === 1) return new Promise(() => {});
      return real(...args);
    };
  });

  check("idle: status is idle", await stat(page, "camera"), "idle");
  contains("idle: overlay says the camera is off", await overlayText(page), "Camera is off.");
  check("idle: button offers to start", await startButton(page).innerText(), "Start camera");

  await startButton(page).click();

  check("requesting: status", await stat(page, "camera"), "requesting");
  contains("requesting: overlay is distinct from idle", await overlayText(page), "Asking for the camera");
  check("requesting: button says what it is doing", await startButton(page).innerText(), "Starting…");
  check("requesting: button is disabled", await startButton(page).isDisabled(), true);

  // The whole point: this used to sit here forever.
  await page.waitForFunction(() => {
    const dt = [...document.querySelectorAll("dt")].find((n) => n.textContent.trim() === "camera");
    return dt?.nextElementSibling?.textContent?.trim() === "timeout";
  }, null, { timeout: 20_000 });

  check("timeout: status", await stat(page, "camera"), "timeout");
  contains("timeout: overlay explains itself", await overlayText(page), "did not respond within 10 seconds");
  contains("timeout: and gives a hint", await overlayText(page), "machine is busy");
  check("timeout: button offers a retry", await startButton(page).innerText(), "Try again");
  check("timeout: button is enabled again", await startButton(page).isDisabled(), false);

  // Next injects its own role="alert" route announcer, so this is scoped to
  // the one that actually has text in it.
  const banner = await page.getByRole("alert").filter({ hasText: "camera" }).first().innerText();
  contains("timeout: error banner agrees with the overlay", banner, "did not respond");

  // Recovery, which is the thing that was impossible before.
  await startButton(page).click();
  await page.waitForFunction(() => {
    const dt = [...document.querySelectorAll("dt")].find((n) => n.textContent.trim() === "camera");
    return dt?.nextElementSibling?.textContent?.trim() === "ready";
  }, null, { timeout: 20_000 });

  check("retry: camera reaches ready", await stat(page, "camera"), "ready");
  check("retry: it took a second getUserMedia call", await page.evaluate(() => window.__gumCalls), 2);
  check("retry: overlay is gone", await page.locator('[role="status"]').count(), 0);
  if (SHOT) await page.screenshot({ path: SHOT, fullPage: true });
  await context.close();
}

// --- 2. a stream that arrives after we gave up ----------------------------
{
  const { page, context } = await openPage(() => {
    window.__lateTracksStopped = 0;
    // Resolves well after the 10 s timeout, with a stream nobody is waiting
    // for any more. Its tracks must be stopped, or the camera light stays on
    // with nothing on screen accounting for it.
    navigator.mediaDevices.getUserMedia = () =>
      new Promise((resolve) => {
        setTimeout(() => {
          const track = {
            kind: "video",
            stop() { window.__lateTracksStopped += 1; },
            getSettings: () => ({}),
          };
          resolve({ getTracks: () => [track], getVideoTracks: () => [track] });
        }, 12_000);
      });
  });

  await startButton(page).click();
  await page.waitForFunction(() => {
    const dt = [...document.querySelectorAll("dt")].find((n) => n.textContent.trim() === "camera");
    return dt?.nextElementSibling?.textContent?.trim() === "timeout";
  }, null, { timeout: 20_000 });

  await page.waitForFunction(() => window.__lateTracksStopped > 0, null, { timeout: 20_000 });
  check("late stream: its tracks were stopped", await page.evaluate(() => window.__lateTracksStopped), 1);
  check("late stream: it did not attach itself", await stat(page, "camera"), "timeout");
  await context.close();
}

// --- 3. a denial is not the same thing as being off -----------------------
{
  const { page, context } = await openPage(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException("denied", "NotAllowedError"));
  });

  await startButton(page).click();
  await page.waitForFunction(() => {
    const dt = [...document.querySelectorAll("dt")].find((n) => n.textContent.trim() === "camera");
    return dt?.nextElementSibling?.textContent?.trim() === "denied";
  }, null, { timeout: 10_000 });

  const text = await overlayText(page);
  check("denied: status", await stat(page, "camera"), "denied");
  contains("denied: overlay names the cause", text, "blocking camera access");
  contains("denied: and says where to fix it", text, "address bar");
  check("denied: does not claim the camera is merely off", text.includes("Camera is off."), false);
  await context.close();
}

// --- 4. the loop diagnostics fill in once frames are flowing --------------
{
  const { page, context } = await openPage(null);
  await startButton(page).click();
  await page.waitForFunction(() => {
    const dt = [...document.querySelectorAll("dt")].find((n) => n.textContent.trim() === "model");
    return dt?.nextElementSibling?.textContent?.trim() === "ready";
  }, null, { timeout: 60_000 });

  // Long enough for the 15 Hz readout to have sampled a few dozen frames.
  await page.waitForFunction(
    () => /(\d+) frames/.exec(document.body.innerText)?.[1] > 20,
    null,
    { timeout: 30_000 },
  );

  // Read the whole page rather than trying to bound the panel: nesting a
  // locator on "the div containing this heading" matches the innermost one,
  // which is the header row. Every label below is unique on the page.
  const panel = await page.evaluate(() => {
    const text = document.body.innerText;
    const start = text.indexOf("Loop timing");
    return start < 0 ? text : text.slice(start, text.indexOf("Tuning", start));
  });

  const fps = Number(/([\d.]+) fps/.exec(panel)?.[1]);
  const frames = Number(/(\d+) frames/.exec(panel)?.[1]);
  const gapP50 = Number(/gap ms\s*\n?\s*p50 ([\d.]+)/.exec(panel)?.[1]);
  const inferenceP50 = Number(/inference ms\s*\n?\s*p50 ([\d.]+)/.exec(panel)?.[1]);
  const rafP50 = Number(/rAF\/frame\s*\n?\s*p50 ([\d.]+)/.exec(panel)?.[1]);

  check("panel: frames are accumulating", frames > 20, true);
  check("panel: fps is a real rate", fps > 1 && fps < 200, true);
  check("panel: gap p50 is populated", gapP50 > 0, true);
  check("panel: inference p50 is populated", inferenceP50 > 0, true);
  check("panel: rAF per frame is at least 1", rafP50 >= 1, true);
  contains("panel: reports tab visibility", panel, "tab hidden 0×");

  console.log(`\nlive panel readout:\n${panel.split("\n").map((l) => `  ${l}`).join("\n")}`);
  await context.close();
}

await browser.close();

check("no page errors", pageErrors.length, 0);
if (pageErrors.length > 0) console.log(pageErrors.map((e) => `  ${e}`).join("\n"));

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed === 0 ? 0 : 1);
