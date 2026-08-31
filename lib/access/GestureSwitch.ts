import type { BlendshapeName } from "@/lib/vision/blendshapes";
import type { AccessFrame, AccessMethod, SwitchEvent } from "./types";

/**
 * Turns one blendshape into a single switch.
 *
 * NOT IMPLEMENTED. Interface only.
 *
 * The config fields below are transcribed from the project plan (threshold,
 * dwell, hysteresis, refractory period). They are a starting vocabulary, not
 * a committed design. The hysteresis and refractory behaviour is the part
 * that decides whether this is usable by someone with dystonia or athetosis,
 * so it should be settled against a real person, not guessed at here.
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
  /** Dead time after a press during which no further press can fire. */
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

export class GestureSwitch implements AccessMethod<GestureSwitchConfig, SwitchEvent> {
  readonly kind = "gesture-switch" as const;

  constructor(_config: GestureSwitchConfig) {
    throw new Error("GestureSwitch is not implemented yet.");
  }

  get config(): Readonly<GestureSwitchConfig> {
    throw new Error("GestureSwitch is not implemented yet.");
  }

  /** Reads the configured blendshape and returns a press or release, or null. */
  update(_frame: AccessFrame): SwitchEvent | null {
    throw new Error("GestureSwitch is not implemented yet.");
  }

  /** Current internal state, for the tuning UI. */
  getState(): GestureSwitchState {
    throw new Error("GestureSwitch is not implemented yet.");
  }

  configure(_patch: Partial<GestureSwitchConfig>): void {
    throw new Error("GestureSwitch is not implemented yet.");
  }

  reset(): void {
    throw new Error("GestureSwitch is not implemented yet.");
  }
}
