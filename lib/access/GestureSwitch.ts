import type { BlendshapeName } from "@/lib/vision/blendshapes";
import type { AccessFrame, AccessMethod, SwitchEvent } from "./types";

/**
 * Turns one blendshape into a single switch.
 *
 * The config fields were transcribed from the project plan (threshold, dwell,
 * hysteresis, refractory period) and the numbers now in use came off a single
 * 28 second recording. The hysteresis and refractory behaviour is the part
 * that decides whether this is usable by someone with dystonia or athetosis,
 * and one clip of one face is not that. Treat the defaults as a starting point
 * for tuning against a real person, not as a result.
 *
 * Two behaviours are decisions rather than mechanics, and both are in the
 * build log entry of 2026-09-01:
 *
 * 1. Refractory starts at release, not at press. This is a hold-style switch:
 *    press fires once when dwell completes, the switch stays held for as long
 *    as the gesture is held, release fires when it is let go, and only then
 *    does the dead time begin. Starting it at press would let a single long
 *    hold re-fire partway through itself.
 *
 * 2. A blendshape missing from a frame is read as zero. In this machine that
 *    is the same thing as "below offThreshold", so a lost face drops an
 *    engaged switch rather than holding it on. The cost is that a tracking
 *    flicker mid-hold produces a release the person did not perform, and then
 *    a refractory window that blocks the next real press. That is the safer
 *    direction to fail in, but it is a real behaviour and not a detail.
 */
export interface GestureSwitchConfig {
  /** Which coefficient drives the switch, e.g. "jawOpen". */
  blendshape: BlendshapeName;
  /** Activation level, 0..1, at which the switch begins to engage. */
  onThreshold: number;
  /**
   * Level at which an engaged switch releases. Below onThreshold, so noise
   * around the threshold cannot chatter the switch on and off.
   */
  offThreshold: number;
  /** How long the signal must stay above onThreshold before a press fires. */
  dwellMs: number;
  /** Dead time after a release during which no further press can fire. */
  refractoryMs: number;
}

/** Everything the switch knows right now, for on-screen tuning feedback. */
export interface GestureSwitchState {
  /** Latest value of the driving blendshape. */
  value: number;
  /** True between press and release. */
  engaged: boolean;
  /** Progress through dwell, 0..1. Drives a countdown ring in the UI. */
  dwellProgress: number;
  /** True while inside the refractory window. */
  refractory: boolean;
}

/**
 * Rejects a config that cannot behave.
 *
 * Loud rather than silent: an inverted hysteresis pair does not fail visibly,
 * it produces a switch that chatters, and a switch that chatters in front of
 * someone who cannot correct it by hand is worse than one that refuses to
 * start. A tuning UI should check values before calling `configure`.
 */
function assertUsable(config: GestureSwitchConfig): void {
  const inUnitRange = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
  if (!inUnitRange(config.onThreshold) || !inUnitRange(config.offThreshold)) {
    throw new Error(
      `Thresholds must be between 0 and 1. Got on=${config.onThreshold}, off=${config.offThreshold}.`,
    );
  }
  if (config.offThreshold > config.onThreshold) {
    throw new Error(
      `offThreshold (${config.offThreshold}) is above onThreshold (${config.onThreshold}), which inverts the hysteresis.`,
    );
  }
  for (const key of ["dwellMs", "refractoryMs"] as const) {
    if (!Number.isFinite(config[key]) || config[key] < 0) {
      throw new Error(`${key} must be zero or a positive number of milliseconds. Got ${config[key]}.`);
    }
  }
}

export class GestureSwitch implements AccessMethod<GestureSwitchConfig, SwitchEvent> {
  readonly kind = "gesture-switch" as const;

  private _config: GestureSwitchConfig;
  /** True from the moment the signal crosses onThreshold until it drops. */
  private engaged = false;
  /** True once dwell has completed and a press has been emitted. */
  private pressed = false;
  /** Only meaningful while `engaged`. */
  private holdStartTime = 0;
  private refractoryUntil: number | null = null;
  private lastValue = 0;
  private lastFrameTime = 0;

  constructor(config: GestureSwitchConfig) {
    assertUsable(config);
    this._config = { ...config };
  }

  get config(): Readonly<GestureSwitchConfig> {
    return this._config;
  }

  /** Reads the configured blendshape and returns a press or release, or null. */
  update(frame: AccessFrame): SwitchEvent | null {
    // Absent means the channel was not reported this frame, which is a
    // different claim from a reading of zero. Read as zero anyway, because in
    // this machine zero and "below offThreshold" do the same thing, and no
    // signal must not be able to hold a switch on. See the note above.
    const value = frame.values[this._config.blendshape] ?? 0;
    const t = frame.timestampMs;
    this.lastValue = value;
    this.lastFrameTime = t;

    if (this.refractoryUntil !== null) {
      if (t < this.refractoryUntil) return null;
      // Expired. Fall through and judge this frame rather than spending it:
      // at 15 Hz, returning here would add 67ms of dead time to every
      // refractory period, which is not what the number says it is.
      this.refractoryUntil = null;
    }

    if (!this.engaged) {
      if (value >= this._config.onThreshold) {
        this.engaged = true;
        this.pressed = false;
        this.holdStartTime = t;
      }
      return null;
    }

    if (!this.pressed) {
      if (value < this._config.offThreshold) {
        // Dropped out before dwell completed. Nothing is emitted, because
        // swallowing this is the entire job dwell was given.
        this.engaged = false;
        return null;
      }
      if (t - this.holdStartTime >= this._config.dwellMs) {
        this.pressed = true;
        return { type: "press", timestampMs: t, value };
      }
      return null;
    }

    // Held. Waiting for the gesture to end.
    if (value < this._config.offThreshold) {
      this.engaged = false;
      this.pressed = false;
      this.refractoryUntil = t + this._config.refractoryMs;
      return { type: "release", timestampMs: t, value };
    }

    return null;
  }

  /** Current internal state, for the tuning UI. */
  getState(): GestureSwitchState {
    let dwellProgress = 0;
    if (this.engaged) {
      dwellProgress =
        this._config.dwellMs > 0
          ? Math.min(1, (this.lastFrameTime - this.holdStartTime) / this._config.dwellMs)
          : 1;
    }
    return {
      value: this.lastValue,
      engaged: this.engaged,
      dwellProgress,
      refractory: this.refractoryUntil !== null,
    };
  }

  /**
   * Live retune. Deliberately does not reset state: a person adjusting a
   * threshold mid-session should not have the switch forget where it was.
   */
  configure(patch: Partial<GestureSwitchConfig>): void {
    const next = { ...this._config, ...patch };
    assertUsable(next);
    this._config = next;
  }

  reset(): void {
    this.engaged = false;
    this.pressed = false;
    this.holdStartTime = 0;
    this.refractoryUntil = null;
    this.lastValue = 0;
    this.lastFrameTime = 0;
  }
}
