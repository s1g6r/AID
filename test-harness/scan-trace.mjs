/**
 * Drives ScanEngine on a synthetic clock and checks what it does.
 *
 * The engine has no timer of its own, so this needs no fake timers and no
 * waiting: it hands it timestamps and reads the events back. Every case below
 * is a behaviour a person would feel, not an implementation detail.
 *
 *   node test-harness/scan-trace.mjs
 */
import { registerTypeScriptResolution } from "./ts-hooks.mjs";
registerTypeScriptResolution();
const { ScanEngine } = await import("@/lib/scanning/ScanEngine.ts");

const BASE = {
  mode: "row-column",
  drive: "auto",
  rows: 2,
  columns: 3,
  scanIntervalMs: 1000,
  firstStepExtraMs: 0,
  maxLoops: 3,
  postSelectionPauseMs: 1000,
  pressLatencyCompensationMs: 0,
};

function harness(patch = {}) {
  const highlights = [];
  const selections = [];
  let exhausted = 0;
  const engine = new ScanEngine(
    { ...BASE, ...patch },
    {
      onHighlight: (p) => highlights.push(`${p.level}:${p.rowIndex},${p.columnIndex}`),
      onSelect: (s) => selections.push(s),
      onExhausted: () => (exhausted += 1),
    },
  );
  return { engine, highlights, selections, exhausted: () => exhausted };
}

/** Ticks from `from` to `to` in 16ms steps, like a rAF loop would. */
function run(engine, from, to) {
  for (let t = from; t <= to; t += 16) engine.tick(t);
  return to;
}

const results = [];
function check(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, pass, actual, expected });
}

// 1. Auto-scan walks the rows at the configured interval.
{
  const h = harness();
  h.engine.start();
  run(h.engine, 0, 3200);
  check("rows advance at 1000ms", h.highlights, ["row:0,0", "row:1,0", "row:0,0", "row:1,0"]);
}

// 2. First step of a pass can be given extra time.
{
  const h = harness({ firstStepExtraMs: 500 });
  h.engine.start();
  run(h.engine, 0, 1400);
  check("first step waits interval+extra", h.highlights, ["row:0,0"]);
  run(h.engine, 1408, 1600);
  check("then advances", h.highlights, ["row:0,0", "row:1,0"]);
}

// 3. Press at row level descends into that row, not into row 0.
{
  const h = harness();
  h.engine.start();
  run(h.engine, 0, 1100); // now on row 1
  h.engine.onSwitchPress(1150);
  check("press on row 1 descends into row 1", h.engine.position, {
    level: "cell", rowIndex: 1, columnIndex: 0,
  });
  check("no selection yet", h.selections.length, 0);
}

// 4. Press at cell level selects that cell.
{
  const h = harness();
  h.engine.start();
  run(h.engine, 0, 100);
  h.engine.onSwitchPress(150);      // choose row 0
  run(h.engine, 160, 1200);         // cell pass: 0,0 then 0,1
  h.engine.onSwitchPress(1250);
  check("selects row 0 cell 1", h.selections.map((s) => [s.rowIndex, s.columnIndex]), [[0, 1]]);
  check("status pauses after selection", h.engine.status, "paused");
}

// 5. A second press inside the post-selection pause is ignored.
{
  const h = harness();
  h.engine.start();
  run(h.engine, 0, 100);
  h.engine.onSwitchPress(150);
  h.engine.onSwitchPress(200);      // would select cell 0,0 if not paused
  check("one selection from two presses", h.selections.length, 1);
  h.engine.onSwitchPress(400);      // still inside the 1000ms pause
  check("still one selection", h.selections.length, 1);
  run(h.engine, 400, 1300);
  check("resumes at the top of the board", h.engine.position, {
    level: "row", rowIndex: 0, columnIndex: 0,
  });
}

// 6. Running out of passes inside a row escapes back to row level.
{
  const h = harness();
  h.engine.start();
  run(h.engine, 0, 100);
  h.engine.onSwitchPress(150);      // into row 0, cell pass begins
  run(h.engine, 160, 12000);        // let the cell pass exhaust
  check("escapes back to rows", h.engine.position?.level, "row");
  check("does not exhaust the engine", h.engine.status, "scanning");
  check("onExhausted not fired", h.exhausted(), 0);
}

// 7. Running out of passes at row level stops the board.
{
  const h = harness();
  h.engine.start();
  run(h.engine, 0, 12000);
  check("exhausts after maxLoops", h.engine.status, "exhausted");
  check("onExhausted fired once", h.exhausted(), 1);
}

// 8. A press on an exhausted board restarts it rather than doing nothing.
{
  const h = harness();
  h.engine.start();
  run(h.engine, 0, 12000);
  h.engine.onSwitchPress(12100);
  check("press wakes an exhausted board", h.engine.status, "scanning");
  check("and does not select anything", h.selections.length, 0);
}

// 9. Latency compensation attributes a press to where the gesture began.
{
  const h = harness({ pressLatencyCompensationMs: 700 });
  h.engine.start();
  run(h.engine, 0, 100);
  h.engine.onSwitchPress(150);      // into row 0
  run(h.engine, 160, 1590);         // cell 0,0 from 150, cell 0,1 from ~1152
  // Gesture began at ~900 while cell 0,0 was highlighted; press lands at 1600,
  // by which time the highlight has moved on to 0,1.
  h.engine.onSwitchPress(1600);
  check("compensated press selects the earlier cell",
    h.selections.map((s) => [s.rowIndex, s.columnIndex]), [[0, 0]]);
}
{
  const h = harness({ pressLatencyCompensationMs: 0 });
  h.engine.start();
  run(h.engine, 0, 100);
  h.engine.onSwitchPress(150);
  run(h.engine, 160, 1590);
  h.engine.onSwitchPress(1600);
  check("uncompensated press selects the later cell",
    h.selections.map((s) => [s.rowIndex, s.columnIndex]), [[0, 1]]);
}

// 10. Linear mode selects on the first press, with no row level at all.
{
  const h = harness({ mode: "linear" });
  h.engine.start();
  run(h.engine, 0, 2100);
  check("linear walks cells in reading order", h.highlights, ["cell:0,0", "cell:0,1", "cell:0,2"]);
  h.engine.onSwitchPress(2150);
  check("one press selects", h.selections.map((s) => [s.rowIndex, s.columnIndex]), [[0, 2]]);
}

// 11. A stalled loop must not fire a burst of catch-up steps.
{
  const h = harness();
  h.engine.start();
  h.engine.tick(0);
  h.engine.tick(9000);              // tab was backgrounded for nine seconds
  check("one step, not nine", h.highlights, ["row:0,0", "row:1,0"]);
}

// 12. A config that cannot behave is refused rather than accepted quietly.
{
  const tooFast = (() => {
    try {
      new ScanEngine({ ...BASE, scanIntervalMs: 10 });
      return "accepted";
    } catch (e) {
      return e.message.slice(0, 20);
    }
  })();
  check("refuses a strobing scan interval", tooFast, "scanIntervalMs of 10");
}

const failed = results.filter((r) => !r.pass);
for (const r of results) {
  console.log(`${r.pass ? "ok  " : "FAIL"}  ${r.name}`);
  if (!r.pass) console.log(`        expected ${JSON.stringify(r.expected)}\n        actual   ${JSON.stringify(r.actual)}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
