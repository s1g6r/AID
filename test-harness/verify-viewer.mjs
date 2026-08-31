/**
 * Opens a real recording in /viewer and checks that it actually draws.
 *
 * Canvas is easy to fake a pass on: an empty one still exists, still has a
 * size, and still answers every query about it. So this counts non-transparent
 * pixels, which is the only evidence that anything was drawn.
 */
import { loadChromium } from "./playwright.mjs";

const URL = process.env.VIEWER_URL || "http://localhost:3111/viewer";
const FILE = process.argv[2];
const SHOT = process.argv[3];

const chromium = await loadChromium();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 1400 } });
const page = await context.newPage();
const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });

const cdp = await context.newCDPSession(page);
await cdp.send("HeapProfiler.enable");
const heap = async () => {
  await cdp.send("HeapProfiler.collectGarbage");
  const u = await cdp.send("Runtime.getHeapUsage");
  return +(u.usedSize / 1048576).toFixed(2);
};

await page.goto(URL, { waitUntil: "networkidle" });
const heapBefore = await heap();

const started = Date.now();
await page.setInputFiles('input[type="file"]', FILE);
await page.waitForSelector("dt:text-is('measured rate')", { timeout: 120_000 });
const loadMs = Date.now() - started;
const heapAfter = await heap();

const meta = await page.evaluate(() => {
  const out = {};
  for (const dt of document.querySelectorAll("dt")) {
    out[dt.textContent] = dt.nextElementSibling?.textContent;
  }
  return out;
});

const channelRows = await page.locator("ul li label input[type=checkbox]").count();
// Nothing should be plotted until a human picks something.
const checked = await page.locator("ul li label input[type=checkbox]:checked").count();

// Sort order: two orders, one keystroke, and the list actually reorders.
const firstRow = () => page.locator("ul li label span.truncate").first().textContent();
const sortByRange = await firstRow();
await page.keyboard.press("s");
await page.waitForTimeout(200);
const modelOrder = await firstRow();
const modelPressed = await page.getByRole("button", { name: "Model order" }).getAttribute("aria-pressed");
await page.keyboard.press("s");
await page.waitForTimeout(200);
const backToRange = await firstRow();

// Canvas is only proof of anything if it has non-blank pixels in it.
const canvasInk = async () =>
  page.evaluate(() => {
    const canvases = [...document.querySelectorAll("canvas")];
    return canvases.slice(0, 6).map((c) => {
      const ctx = c.getContext("2d");
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let painted = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted += 1;
      return { w: c.width, h: c.height, paintedPixels: painted };
    });
  });
const inkBefore = await canvasInk();

// Plot a few more channels, then zoom by dragging across the detail chart.
const boxes = page.locator("ul li label input[type=checkbox]");
for (const i of [0, 1, 2, 3]) await boxes.nth(i).check();
await page.waitForTimeout(300);
const legendAfterPick = await page.locator("ul.font-mono li").count();

const chart = page.locator("canvas").first();
const box = await chart.boundingBox();
await page.mouse.move(box.x + box.width * 0.35, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(400);
const zoomLabel = await page.locator("h2", { hasText: "plotted" }).textContent();

// Hover to read a value off the trace.
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
await page.waitForTimeout(200);
const legend = await page.locator("ul.font-mono").first().innerText();

if (SHOT) await page.screenshot({ path: SHOT, fullPage: false });
const inkAfter = await canvasInk();

const resetDisabled = await page.getByRole("button", { name: "Reset zoom" }).isDisabled();
await page.getByRole("button", { name: "Reset zoom" }).click();
await page.waitForTimeout(300);
const afterReset = await page.locator("h2", { hasText: "plotted" }).textContent();

console.log(JSON.stringify({
  loadMs, heapBefore, heapAfter, heapGrowthMB: +(heapAfter - heapBefore).toFixed(2),
  meta, channelRows, checkedOnOpen: checked,
  sort: { sortByRange, modelOrder, backToRange, modelPressedAfterKey: modelPressed,
          reordered: sortByRange !== modelOrder, restored: sortByRange === backToRange },
  detailCanvasBefore: inkBefore[0], sparklineSample: inkBefore.slice(1, 4),
  legendAfterPick, zoomLabel: zoomLabel?.replace(/\s+/g, " ").trim(),
  legend: legend.replace(/\s+/g, " ").trim(),
  resetWasEnabled: !resetDisabled,
  afterReset: afterReset?.replace(/\s+/g, " ").trim(),
  detailCanvasAfter: inkAfter[0],
  pageErrors, consoleErrors,
}, null, 2));
await browser.close();
