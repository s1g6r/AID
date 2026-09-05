/**
 * Row-column and linear scanning, driven by a single switch.
 *
 * The engine owns no timer. It is advanced by `tick(nowMs)` from whatever loop
 * the page already runs, for the same reason `GestureSwitch` is driven by
 * frames rather than by a clock of its own: a machine that reads the time
 * itself cannot be replayed, and every timing decision in this project is
 * meant to be re-runnable against a recording rather than re-felt by hand.
 *
 * Scan rate is the setting that decides whether a board is usable at all. It
 * varies enormously between people and it is the thing a therapist adjusts
 * live, so nothing here hardcodes it and `configure` takes effect mid-scan.
 *
 * TIMING NOTE, and it is the important one. A press from `GestureSwitch`
 * arrives `dwellMs` AFTER the gesture began, because dwell is what separates a
 * gesture from a twitch. With the committed switch config (dwellMs 700) and a
 * 1000 ms scan interval, a person has 1000 - 700 = 300 ms from the highlight
 * landing on their cell to starting the gesture, or the press lands on the
 * next cell instead. 300 ms is around the floor of ordinary simple reaction
 * time and well under it for most of the people this is for. Two ways out,
 * both left to whoever is tuning:
 *
 *   - Raise `scanIntervalMs`. Slower, but the budget grows one for one.
 *   - Set `pressLatencyCompensationMs` to the switch's `dwellMs`, which makes
 *     a press select whatever was highlighted when the gesture STARTED rather
 *     than when it completed.
 *
 * The second is how switch-scanning hardware usually handles activation
 * latency, and it is off by default (0) because it changes what a press means
 * and that should be a decision someone makes on purpose, with a real face,
 * not a default they inherit.
 */

/** Linear steps through every cell. Row-column steps rows, then cells. */
export type ScanMode = "linear" | "row-column";

/**
 * How the highlight advances.
 * - "auto": moves on its own at scanIntervalMs; the switch selects.
 * - "step": one switch press advances, a second input or a hold selects.
 *
 * "step" is only half-built: `onSwitchPress` advances the highlight, but the
 * second input that would select does not exist yet, so `select()` has to be
 * called by hand. With a single switch and no hold detection this mode is not
 * usable, and the board does not offer it.
 */
export type ScanDrive = "auto" | "step";

export interface ScanEngineConfig {
  mode: ScanMode;
  drive: ScanDrive;
  /** Grid the scan walks. Board progression in the plan is 4, then 6, then 9. */
  rows: number;
  columns: number;
  /** Dwell on each step, in ms. Auto-scan only. */
  scanIntervalMs: number;
  /**
   * Extra time added to the first step of a pass, which is where a slow
   * responder most often misses.
   */
  firstStepExtraMs: number;
  /** Passes over the board before the scan gives up and idles. */
  maxLoops: number;
  /** Ignore a second press this soon after a selection. */
  postSelectionPauseMs: number;
  /**
   * Treat a press as having happened this many ms earlier than it arrived.
   *
   * Set to the switch's `dwellMs` to select what was highlighted when the
   * gesture started. Zero means a press selects whatever is highlighted at the
   * moment it fires. See the timing note at the top of this file.
   */
  pressLatencyCompensationMs: number;
}

/** Which cell the scan is currently offering. */
export interface ScanPosition {
  /** In row-column mode, "row" is the first pass and "cell" the second. */
  level: "row" | "cell";
  rowIndex: number;
  /** Only meaningful at level "cell". */
  columnIndex: number;
}

export type ScanEngineStatus = "idle" | "scanning" | "paused" | "exhausted";

export interface ScanSelection {
  rowIndex: number;
  columnIndex: number;
  timestampMs: number;
  /** Steps elapsed before selection, kept for the benchmark table. */
  stepsTaken: number;
}

export interface ScanEngineEvents {
  /** Fires every time the highlight moves. Drives the board rendering. */
  onHighlight?: (position: ScanPosition) => void;
  /** Fires when a switch press lands on a cell. */
  onSelect?: (selection: ScanSelection) => void;
  /** Fires when maxLoops passes complete with no selection. */
  onExhausted?: () => void;
}

/** One entry of highlight history, for latency compensation. */
interface HighlightMoment {
  position: ScanPosition;
  atMs: number;
}

/** How many past highlights to keep. Only ever searched back a step or two. */
const HISTORY_LENGTH = 8;

function assertUsable(config: ScanEngineConfig): void {
  if (!Number.isInteger(config.rows) || config.rows < 1) {
    throw new Error(`rows must be a positive integer. Got ${config.rows}.`);
  }
  if (!Number.isInteger(config.columns) || config.columns < 1) {
    throw new Error(`columns must be a positive integer. Got ${config.columns}.`);
  }
  for (const key of [
    "scanIntervalMs",
    "firstStepExtraMs",
    "postSelectionPauseMs",
    "pressLatencyCompensationMs",
  ] as const) {
    if (!Number.isFinite(config[key]) || config[key] < 0) {
      throw new Error(`${key} must be zero or a positive number of ms. Got ${config[key]}.`);
    }
  }
  // A scan interval of zero would advance on every tick, which at 60 Hz is a
  // strobing grid in front of someone who cannot look away from it.
  if (config.scanIntervalMs < 100) {
    throw new Error(
      `scanIntervalMs of ${config.scanIntervalMs} is too fast to be read or acted on. Minimum 100.`,
    );
  }
  if (!Number.isFinite(config.maxLoops) || config.maxLoops < 1) {
    throw new Error(`maxLoops must be at least 1. Got ${config.maxLoops}.`);
  }
}

export class ScanEngine {
  private _config: ScanEngineConfig;
  private events: ScanEngineEvents;

  private _status: ScanEngineStatus = "idle";
  private _position: ScanPosition | null = null;
  /** When the highlight is next due to move. Null means "on the next tick". */
  private nextStepAt: number | null = null;
  /** Completed passes at the current level with no selection. */
  private loops = 0;
  /** Steps since this selection cycle began, across both levels. */
  private stepsTaken = 0;
  /** Post-selection pause expiry. */
  private pausedUntil: number | null = null;
  /** Latest time seen, so `advance()` can schedule without being handed one. */
  private nowMs = 0;
  private history: HighlightMoment[] = [];

  constructor(config: ScanEngineConfig, events: ScanEngineEvents = {}) {
    assertUsable(config);
    this._config = { ...config };
    this.events = events;
  }

  get config(): Readonly<ScanEngineConfig> {
    return this._config;
  }

  get status(): ScanEngineStatus {
    return this._status;
  }

  get position(): ScanPosition | null {
    return this._position;
  }

  start(): void {
    this._status = "scanning";
    this.loops = 0;
    this.stepsTaken = 0;
    this.pausedUntil = null;
    this.history = [];
    this._position = { level: this.topLevel(), rowIndex: 0, columnIndex: 0 };
    // Null means the first tick sets the schedule, so the engine never needs a
    // clock of its own just to know when it started.
    this.nextStepAt = null;
  }

  stop(): void {
    this._status = "idle";
    this._position = null;
    this.nextStepAt = null;
    this.pausedUntil = null;
  }

  /**
   * Advances the clock. Call from whatever loop the page already runs.
   *
   * Not in the original stub. The engine needs a time source and this is the
   * one that keeps it replayable.
   */
  tick(nowMs: number): void {
    this.nowMs = nowMs;

    if (this._status === "paused") {
      if (this.pausedUntil !== null && nowMs >= this.pausedUntil) {
        this.pausedUntil = null;
        this._status = "scanning";
        // Resume at the top of the board rather than mid-pass. After a word is
        // spoken the next one is a fresh sentence, not a continuation.
        this.beginPass(this.topLevel(), 0);
      }
      return;
    }

    if (this._status !== "scanning") return;
    if (this._config.drive !== "auto") return;

    if (this.nextStepAt === null) {
      this.emitHighlight();
      this.nextStepAt = nowMs + this.stepDuration(true);
      return;
    }

    // A loop that fell behind (a backgrounded tab, a long GC) must not fire a
    // burst of steps to catch up. One step per tick, schedule from now.
    if (nowMs >= this.nextStepAt) {
      this.advance();
    }
  }

  /**
   * Called on a switch press.
   *
   * At row level this descends into the row. At cell level it selects. In
   * linear mode it always selects. A press while exhausted restarts the scan
   * rather than doing nothing, so a person who let the board time out is not
   * locked out of it.
   */
  onSwitchPress(timestampMs: number): void {
    this.nowMs = timestampMs;

    if (this._status === "exhausted") {
      this.start();
      return;
    }
    // The post-selection pause is what stops one gesture that lingers, or a
    // second involuntary one, from immediately selecting whatever the board
    // resumed on.
    if (this._status === "paused") return;
    if (this._status !== "scanning" || this._position === null) return;

    if (this._config.drive === "step") {
      this.advance();
      return;
    }

    const at = this.positionAt(timestampMs - this._config.pressLatencyCompensationMs);

    if (this._config.mode === "linear" || at.level === "cell") {
      this.select(at, timestampMs);
      return;
    }

    // Row chosen. Start the cell pass inside it.
    this.beginPass("cell", at.rowIndex);
  }

  /** Manual advance, for step-scan and for testing without a switch. */
  advance(): void {
    if (this._position === null) return;
    const { rows, columns, mode } = this._config;
    const position = this._position;
    let wrapped = false;

    if (mode === "linear") {
      let flat = position.rowIndex * columns + position.columnIndex + 1;
      if (flat >= rows * columns) {
        flat = 0;
        wrapped = true;
      }
      this._position = {
        level: "cell",
        rowIndex: Math.floor(flat / columns),
        columnIndex: flat % columns,
      };
    } else if (position.level === "row") {
      let next = position.rowIndex + 1;
      if (next >= rows) {
        next = 0;
        wrapped = true;
      }
      this._position = { level: "row", rowIndex: next, columnIndex: 0 };
    } else {
      let next = position.columnIndex + 1;
      if (next >= columns) {
        next = 0;
        wrapped = true;
      }
      this._position = { level: "cell", rowIndex: position.rowIndex, columnIndex: next };
    }

    this.stepsTaken += 1;

    if (wrapped) {
      this.loops += 1;
      if (this.loops >= this._config.maxLoops) {
        // Running out of passes inside a row means the wrong row was chosen,
        // which is an ordinary mistake and recovers by going back up a level.
        // Running out at row level means nobody is pressing, and continuing to
        // flash a board at someone who has stopped answering is not neutral.
        if (this._config.mode === "row-column" && this._position.level === "cell") {
          this.beginPass("row", 0);
          return;
        }
        this._status = "exhausted";
        this.nextStepAt = null;
        this.events.onExhausted?.();
        return;
      }
    }

    this.emitHighlight();
    this.nextStepAt = this.nowMs + this.stepDuration(wrapped);
  }

  configure(patch: Partial<ScanEngineConfig>): void {
    const next = { ...this._config, ...patch };
    assertUsable(next);
    const gridChanged = next.rows !== this._config.rows || next.columns !== this._config.columns;
    const modeChanged = next.mode !== this._config.mode;
    this._config = next;
    // A grid or mode change mid-scan can leave the highlight outside the
    // board. Restart the pass rather than clamp into a position nobody chose.
    if ((gridChanged || modeChanged) && this._status === "scanning") {
      this.beginPass(this.topLevel(), 0);
    }
  }

  reset(): void {
    this._status = "idle";
    this._position = null;
    this.nextStepAt = null;
    this.pausedUntil = null;
    this.loops = 0;
    this.stepsTaken = 0;
    this.history = [];
  }

  // --- internals ---

  private stepDuration(isFirstOfPass: boolean): number {
    return this._config.scanIntervalMs + (isFirstOfPass ? this._config.firstStepExtraMs : 0);
  }

  /** Starts a fresh pass at a level, from index 0, with the loop count reset. */
  private beginPass(level: "row" | "cell", rowIndex: number): void {
    this._position = { level, rowIndex, columnIndex: 0 };
    this.loops = 0;
    this._status = "scanning";
    // Dropped, not kept: latency compensation must never reach back past the
    // start of a pass and resolve to a cell the person was never offered.
    this.history = [];
    this.emitHighlight();
    this.nextStepAt = this.nowMs + this.stepDuration(true);
  }

  /** The level a fresh pass starts at. Linear mode has no row level. */
  private topLevel(): "row" | "cell" {
    return this._config.mode === "linear" ? "cell" : "row";
  }

  private emitHighlight(): void {
    if (this._position === null) return;
    const position = { ...this._position };
    this.history.push({ position, atMs: this.nowMs });
    if (this.history.length > HISTORY_LENGTH) this.history.shift();
    this.events.onHighlight?.(position);
  }

  /**
   * Where the highlight was at a given time.
   *
   * With compensation at zero this is just the current position. With it set,
   * it walks back through recent highlights, which is what makes a press
   * select the cell the person was looking at when they began the gesture.
   */
  private positionAt(timestampMs: number): ScanPosition {
    const current = this._position as ScanPosition;
    if (this._config.pressLatencyCompensationMs <= 0) return current;
    for (let i = this.history.length - 1; i >= 0; i -= 1) {
      if (this.history[i].atMs <= timestampMs) return this.history[i].position;
    }
    return this.history[0]?.position ?? current;
  }

  private select(at: ScanPosition, timestampMs: number): void {
    this.events.onSelect?.({
      rowIndex: at.rowIndex,
      columnIndex: at.columnIndex,
      timestampMs,
      stepsTaken: this.stepsTaken,
    });
    this.stepsTaken = 0;
    this.loops = 0;
    if (this._config.postSelectionPauseMs > 0) {
      this._status = "paused";
      this.pausedUntil = timestampMs + this._config.postSelectionPauseMs;
      this.nextStepAt = null;
    } else {
      this.beginPass(this.topLevel(), 0);
    }
  }
}
