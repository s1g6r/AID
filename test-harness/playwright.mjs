/**
 * Finds Playwright without this project depending on it.
 *
 * These scripts are run by hand, occasionally, and Playwright plus its browser
 * downloads is a heavy thing to put in a project whose whole build is a static
 * export. So it is resolved at runtime: normal resolution first, then whatever
 * `PLAYWRIGHT` points at, and a clear message rather than a stack trace if
 * neither works.
 */

export async function loadChromium() {
  const attempts = ["playwright", process.env.PLAYWRIGHT].filter(Boolean);
  const failures = [];
  for (const specifier of attempts) {
    try {
      const loaded = await import(specifier);
      return (loaded.default ?? loaded).chromium;
    } catch (cause) {
      failures.push(`${specifier}: ${cause.message.split("\n")[0]}`);
    }
  }
  throw new Error(
    [
      "Could not load Playwright.",
      "",
      "Either install it here:",
      "  npm install --no-save playwright && npx playwright install chromium",
      "",
      "or point at an existing install:",
      "  PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs node test-harness/...",
      "",
      "Tried:",
      ...failures.map((line) => `  ${line}`),
    ].join("\n"),
  );
}
