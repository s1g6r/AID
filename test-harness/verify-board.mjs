/**
 * Drives /board in a real browser and checks the loop end to end.
 *
 * A mouthPucker cannot be performed by a fake camera, so the switch itself is
 * exercised by scan-trace.mjs and replay-switch.mjs instead. What this checks
 * is everything downstream of a press: that the scan advances on its own, that
 * a press descends a row and then selects a cell, that the right word reaches
 * speech synthesis, and that the post-selection pause swallows a double press.
 *
 * speechSynthesis is wrapped rather than listened to, because headless
 * Chromium has no voices and would silently speak nothing.
 *
 *   node test-harness/verify-board.mjs [http://localhost:3111/board]
 */
import { loadChromium } from "./playwright.mjs";

const URL = process.argv[2] || process.env.BOARD_URL || "http://localhost:3111/board";
const SHOT = process.argv[3];
/**
 * Optional camera source: a path to a .y4m with a face in it, or the literal
 * "fake" for Chromium's generated colour bars. The bars have no face, so they
 * check that the camera, the model and the detection loop all come up and that
 * a frame with no face reaches the switch without throwing; they cannot check
 * that a real blendshape value arrives. See the README.
 */
const CAMERA = process.argv[4] || process.env.BOARD_CAMERA || null;
const Y4M = CAMERA && CAMERA !== "fake" ? CAMERA : null;

const chromium = await loadChromium();
const browser = await chromium.launch({
  args: CAMERA
    ? [
        "--use-fake-device-for-media-stream",
        ...(Y4M ? [`--use-file-for-fake-video-capture=${Y4M}`] : []),
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ]
    : [],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 1400 },
  ...(CAMERA ? { permissions: ["camera"] } : {}),
});
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

// Record what the page asks to be spoken, before any app code runs.
await page.addInitScript(() => {
  window.__spoken = [];
  const synthesis = window.speechSynthesis;
  if (!synthesis) return;
  const realSpeak = synthesis.speak.bind(synthesis);
  synthesis.speak = (utterance) => {
    window.__spoken.push(utterance.text);
    try { realSpeak(utterance); } catch { /* headless has no voices */ }
  };
});

await page.goto(URL, { waitUntil: "networkidle" });

const highlight = () => page.locator("dt:text-is('highlight') + dd").textContent();
const scanStatus = () => page.locator("dt:text-is('scan') + dd").textContent();
const said = () => page.locator('[aria-live="polite"] p:last-child').textContent();
const spoken = () => page.evaluate(() => window.__spoken);
const budget = () => page.locator("p", { hasText: "Reaction budget" }).first().innerText();

const before = { highlight: await highlight(), scan: await scanStatus(), said: await said() };

await page.getByRole("button", { name: "Start scanning" }).click();
await page.waitForTimeout(150);
const atStart = await highlight();

// Auto-advance: after ~1.1s the highlight should be on the second row.
await page.waitForTimeout(1100);
const afterOneStep = await highlight();

// Press on row 1 descends into row 1.
await page.keyboard.press("Space");
await page.waitForTimeout(150);
const afterRowPress = await highlight();

// Press again selects the first cell of that row.
await page.keyboard.press("Space");
await page.waitForTimeout(300);
const afterCellPress = { said: await said(), spoken: await spoken(), scan: await scanStatus() };

// A second press inside the post-selection pause must not select anything.
await page.keyboard.press("Space");
await page.waitForTimeout(200);
const duringPause = await spoken();

// After the pause the board resumes at the top.
await page.waitForTimeout(1100);
const afterPause = { highlight: await highlight(), scan: await scanStatus() };

// The reaction-budget warning reflects the compensation toggle.
const budgetOff = await budget();
await page.getByRole("checkbox").check();
await page.waitForTimeout(150);
const budgetOn = await budget();

// Clicking a cell speaks it too, which is how a partner or a test drives it.
await page.getByRole("button", { name: /thank you/ }).click();
await page.waitForTimeout(200);
const afterClick = await spoken();

// The scan keeps running with no camera at all.
const stillScanning = await scanStatus();

const cells = await page.locator("main button span.text-lg").allTextContents();

/*
 * The camera path. A fake camera cannot perform a mouthPucker, so this cannot
 * prove a real gesture produces a press. What it does prove is that frames
 * reach GestureSwitch at all: the meter renders the switch's own view of its
 * channel, so a value that is live and moving means the chain from
 * detectForVideo through frameFromResult into update() is connected.
 */
let cameraCheck = null;
if (CAMERA) {
  await page.getByRole("button", { name: "Start camera" }).click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("dt")].some(
        (d) => d.textContent === "model" && d.nextElementSibling?.textContent === "ready",
      ),
    null,
    { timeout: 90_000 },
  );
  // The only tabular-nums span on the page is the switch meter's own value.
  const readMeter = () => page.locator("span.tabular-nums").first().textContent();
  const samples = [];
  for (let i = 0; i < 6; i += 1) {
    await page.waitForTimeout(400);
    samples.push(await readMeter());
  }
  const status = await page.evaluate(() => {
    const out = {};
    for (const dt of document.querySelectorAll("dt")) out[dt.textContent] = dt.nextElementSibling?.textContent;
    return out;
  });
  cameraCheck = {
    source: Y4M ? "video file" : "generated colour bars, no face in them",
    camera: status.camera,
    model: status.model,
    channelValues: samples,
    distinctValues: [...new Set(samples)].length,
    anyNonZero: samples.some((v) => Number(v) > 0),
    // Cumulative, and the keyboard presses above are in it too.
    pressCountAfterAllPresses: status.presses,
  };
}

if (SHOT) await page.screenshot({ path: SHOT, fullPage: true });

console.log(JSON.stringify({
  before, atStart, afterOneStep, afterRowPress, afterCellPress,
  duringPause, afterPause, budgetOff, budgetOn, afterClick, stillScanning,
  cells, cameraCheck, pageErrors,
}, null, 2));
await browser.close();
