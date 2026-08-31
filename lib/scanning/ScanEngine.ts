/**
 * Row-column and linear scanning, driven by a switch.
 *
 * NOT IMPLEMENTED. Interface only.
 *
 * Nothing here computes timing. Scan rate is the single setting that decides
 * whether the board is usable, it varies enormously between people, and it is
 * the thing a therapist will want to adjust live, so it belongs in a real
 * implementation tuned against a real person.
 */

/** Linear steps through every cell. Row-column steps rows, then cells. */
export type ScanMode = "linear" | "row-column";

/**
 * How the highlight advances.
 * - "auto": moves on its own at scanIntervalMs; the switch selects.
 * - "step": one switch press advances, a second input or a hold selects.
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

export class ScanEngine {
  constructor(_config: ScanEngineConfig, _events?: ScanEngineEvents) {
    throw new Error("ScanEngine is not implemented yet.");
  }

  get config(): Readonly<ScanEngineConfig> {
    throw new Error("ScanEngine is not implemented yet.");
  }

  get status(): ScanEngineStatus {
    throw new Error("ScanEngine is not implemented yet.");
  }

  get position(): ScanPosition | null {
    throw new Error("ScanEngine is not implemented yet.");
  }

  start(): void {
    throw new Error("ScanEngine is not implemented yet.");
  }

  stop(): void {
    throw new Error("ScanEngine is not implemented yet.");
  }

  /** Called on a switch press. What it does depends on mode and drive. */
  onSwitchPress(_timestampMs: number): void {
    throw new Error("ScanEngine is not implemented yet.");
  }

  /** Manual advance, for step-scan and for testing without a switch. */
  advance(): void {
    throw new Error("ScanEngine is not implemented yet.");
  }

  configure(_patch: Partial<ScanEngineConfig>): void {
    throw new Error("ScanEngine is not implemented yet.");
  }

  reset(): void {
    throw new Error("ScanEngine is not implemented yet.");
  }
}
