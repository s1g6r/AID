/**
 * Runs a real `GestureSwitch` over a recorded trace and prints what it fired.
 *
 * The point is that the switch under test is the one in `lib/access/`, not a
 * copy of it: the same class the app would use, fed frames built by the same
 * `frameFromRecordingSample` the live path uses, so a result here means
 * something about the real thing. Nothing in this file decides anything about
 * a gesture. It reports the events the switch produced and the numbers the
 * file already contained.
 *
 * The question it exists to answer is the one the build log has open: does
 * this configuration fire when a jaw opens deliberately, and does it stay
 * silent through ordinary talking. Both halves need a recording of a real
 * person doing that. This script does not have an opinion about what it is
 * fed, and cannot tell a gesture from a conversation.
 *
 * Usage:
 *   node test-harness/replay-switch.mjs <recording.json> [options]
 *
 *   --blendshape <name>   channel to drive the switch  (default jawOpen)
 *   --on <0..1>           onThreshold                  (default 0.4)
 *   --off <0..1>          offThreshold                 (default 0.25)
 *   --dwell <ms>          dwellMs                      (default 250)
 *   --refractory <ms>     refractoryMs                 (default 500)
 *   --json <path>         also write the fire log as JSON
 *   --switch <path>       load GestureSwitch from somewhere else, for
 *                         comparing a variant against the committed one
 *
 * The defaults are the provisional numbers from the build log entry of
 * 2026-09-01, read off a single 28 second clip and not validated against
 * anything. They are a starting point for tuning, not a recommendation.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { registerTypeScriptResolution, PROJECT_ROOT } from "./ts-hooks.mjs";

registerTypeScriptResolution();

const DEFAULTS = {
  blendshape: "jawOpen",
  onThreshold: 0.4,
  offThreshold: 0.25,
  dwellMs: 250,
  refractoryMs: 500,
};

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        fail(`${arg} needs a value.`);
      }
      flags[arg.slice(2)] = value;
      i += 1;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function number(flags, key, fallback) {
  if (flags[key] === undefined) return fallback;
  const parsed = Number(flags[key]);
  if (!Number.isFinite(parsed)) fail(`--${key} must be a number, got "${flags[key]}".`);
  return parsed;
}

function ms(value) {
  return `${value.toFixed(0).padStart(6)}ms`;
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const filePath = positional[0];
if (!filePath) {
  fail("Usage: node test-harness/replay-switch.mjs <recording.json> [options]");
}

const config = {
  blendshape: flags.blendshape ?? DEFAULTS.blendshape,
  onThreshold: number(flags, "on", DEFAULTS.onThreshold),
  offThreshold: number(flags, "off", DEFAULTS.offThreshold),
  dwellMs: number(flags, "dwell", DEFAULTS.dwellMs),
  refractoryMs: number(flags, "refractory", DEFAULTS.refractoryMs),
};

// ---------------------------------------------------------------- load input

const { loadRecording } = await import(`${PROJECT_ROOT}/lib/recording/loadRecording.ts`);
const { framesFromRecording } = await import(`${PROJECT_ROOT}/lib/access/frame.ts`);

const switchModulePath = flags.switch
  ? pathToFileURL(resolvePath(process.cwd(), flags.switch)).href
  : `${PROJECT_ROOT}/lib/access/GestureSwitch.ts`;

let GestureSwitch;
try {
  ({ GestureSwitch } = await import(switchModulePath));
} catch (cause) {
  fail(`Could not load GestureSwitch from ${switchModulePath}\n  ${cause.message}`);
}
if (typeof GestureSwitch !== "function") {
  fail(`${switchModulePath} does not export a GestureSwitch class.`);
}

let loaded;
try {
  loaded = loadRecording(await readFile(filePath, "utf8"));
} catch (cause) {
  fail(`Could not read ${filePath}\n  ${cause.message}`);
}

const frames = framesFromRecording(loaded.recording);
const channel = loaded.channels.find((c) => c.name === config.blendshape);

// --------------------------------------------------------------- what we got

console.log(`\nfile          ${filePath}`);
if (loaded.recording.label) console.log(`label         ${loaded.recording.label}`);
console.log(`recorded      ${loaded.recording.recordedAt}`);
console.log(
  `samples       ${frames.length} over ${(loaded.durationMs / 1000).toFixed(1)}s` +
    (loaded.measuredHz ? `, ${loaded.measuredHz.toFixed(1)} Hz measured` : ""),
);
if (loaded.medianGapMs !== null) {
  console.log(
    `frame spacing ${loaded.medianGapMs.toFixed(0)}ms median, ${loaded.maxGapMs?.toFixed(0)}ms worst`,
  );
  const dwellFrames = config.dwellMs / loaded.medianGapMs;
  console.log(
    `              dwell of ${config.dwellMs}ms is about ${dwellFrames.toFixed(1)} frames at this spacing`,
  );
}
console.log(`no face in    ${loaded.faceMissingCount} sample(s)`);

if (!channel) {
  fail(
    `This file has no channel named "${config.blendshape}".\n` +
      `  It has: ${loaded.channels.map((c) => c.name).join(", ")}`,
  );
}
console.log(
  `${config.blendshape.padEnd(14)}${channel.min?.toFixed(4) ?? "-"} to ${channel.max?.toFixed(4) ?? "-"} in this file`,
);
if (channel.max !== null && channel.max < config.onThreshold) {
  console.log(
    `              never reaches onThreshold ${config.onThreshold}, so no press is possible here`,
  );
}

for (const warning of loaded.warnings) console.log(`warning       ${warning}`);

console.log(
  `\nconfig        on ${config.onThreshold}  off ${config.offThreshold}  ` +
    `dwell ${config.dwellMs}ms  refractory ${config.refractoryMs}ms`,
);
if (flags.switch) console.log(`switch        ${switchModulePath}`);

// ------------------------------------------------------------------ the run

let machine;
try {
  machine = new GestureSwitch(config);
} catch (cause) {
  fail(
    `GestureSwitch would not construct.\n  ${cause.message}\n\n` +
      `  If that is the "not implemented yet" error, this harness is ready and\n` +
      `  waiting: write the state machine in lib/access/GestureSwitch.ts and run\n` +
      `  this again. To try a variant without touching that file, point at it:\n` +
      `    node test-harness/replay-switch.mjs "${filePath}" --switch path/to/variant.ts`,
  );
}

const events = [];
const started = process.hrtime.bigint();
for (let index = 0; index < frames.length; index += 1) {
  let event;
  try {
    event = machine.update(frames[index]);
  } catch (cause) {
    fail(`update() threw on frame ${index} (t=${frames[index].timestampMs}ms)\n  ${cause.message}`);
  }
  if (event) events.push({ ...event, frame: index });
}
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

// -------------------------------------------------------------- the fire log

const presses = events.filter((e) => e.type === "press");
const releases = events.filter((e) => e.type === "release");

console.log(`\nfire log`);
if (events.length === 0) {
  console.log(`  nothing fired.`);
} else {
  let previousPressAt = null;
  for (const event of events) {
    const gap =
      event.type === "press" && previousPressAt !== null
        ? `  +${(event.timestampMs - previousPressAt).toFixed(0)}ms since last press`
        : "";
    if (event.type === "press") previousPressAt = event.timestampMs;
    console.log(
      `  ${ms(event.timestampMs)}  frame ${String(event.frame).padStart(4)}  ` +
        `${event.type.padEnd(7)}  value ${event.value?.toFixed(4) ?? "-"}${gap}`,
    );
  }
}

console.log(
  `\n${presses.length} press, ${releases.length} release, ` +
    `${events.length} event(s) over ${frames.length} frames`,
);
console.log(`switch cost   ${elapsedMs.toFixed(1)}ms total, ${((elapsedMs / frames.length) * 1000).toFixed(1)}µs per frame`);

// Unpaired events are worth seeing rather than counting past, since press and
// release not matching up is usually the state machine, not the recording.
if (presses.length !== releases.length) {
  console.log(
    `note          press and release counts differ. That may be intended, or ` +
      `may be a gesture still engaged when the file ended.`,
  );
}

if (flags.json) {
  const out = {
    file: filePath,
    switchModule: switchModulePath,
    config,
    frameCount: frames.length,
    durationMs: loaded.durationMs,
    measuredHz: loaded.measuredHz,
    channelRange: { min: channel.min, max: channel.max },
    pressCount: presses.length,
    releaseCount: releases.length,
    events,
  };
  await writeFile(flags.json, JSON.stringify(out, null, 2));
  console.log(`wrote         ${flags.json}`);
}
console.log();
