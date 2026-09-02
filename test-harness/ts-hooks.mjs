/**
 * Lets these scripts import the app's TypeScript directly.
 *
 * Node runs `.ts` files on its own now, so nothing here compiles anything.
 * What it does not do is resolve the two specifier styles the app is written
 * in: the `@/...` alias from `tsconfig.json`, and relative imports without a
 * file extension. Both are normal in a bundled app and neither is valid to
 * Node, so a resolve hook fills that gap and the app's source stays untouched.
 *
 * The alternative was rewriting imports in `lib/` to suit a test script, which
 * is the wrong way round: the harness exists to observe the real code, so it
 * is the harness that bends.
 *
 * Call `registerTypeScriptResolution()` before importing anything from `lib/`.
 */

import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { existsSync, statSync } from "node:fs";

const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Extensions to try, in the order a bundler would try them. */
const CANDIDATES = [".ts", ".tsx", ".mts", ".js", ".mjs"];

function firstExisting(basePath) {
  if (existsSync(basePath) && statSync(basePath).isFile()) return basePath;
  for (const extension of CANDIDATES) {
    const candidate = `${basePath}${extension}`;
    if (existsSync(candidate)) return candidate;
  }
  for (const extension of CANDIDATES) {
    const candidate = resolvePath(basePath, `index${extension}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function resolved(filePath) {
  return {
    url: pathToFileURL(filePath).href,
    // Stated rather than sniffed. Without this Node reparses each file to work
    // out whether it is ESM, and warns about it, because the app's
    // package.json has no "type" field and is not this harness's to change.
    format: filePath.endsWith(".ts") || filePath.endsWith(".tsx")
      ? "module-typescript"
      : undefined,
    shortCircuit: true,
  };
}

/** Synchronous, in-thread. `module.register()` is deprecated as of Node 26. */
export function registerTypeScriptResolution() {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      // The `@/*` alias, which tsconfig maps to the project root.
      if (specifier.startsWith("@/")) {
        const found = firstExisting(resolvePath(PROJECT_ROOT, specifier.slice(2)));
        if (found) return resolved(found);
      }

      // Relative imports written without an extension.
      if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
        const parentDir = dirname(fileURLToPath(context.parentURL));
        const found = firstExisting(resolvePath(parentDir, specifier));
        if (found) return resolved(found);
      }

      return nextResolve(specifier, context);
    },

    load(url, context, nextLoad) {
      // Same reason as `format` above: state that a `.ts` file is an ES module
      // so Node does not parse it twice and warn about it each time.
      if (url.endsWith(".ts") || url.endsWith(".tsx")) {
        return nextLoad(url, { ...context, format: "module-typescript" });
      }
      return nextLoad(url, context);
    },
  });
}

export { PROJECT_ROOT };
