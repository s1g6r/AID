"use client";

import { useSyncExternalStore } from "react";

/**
 * Speaking a selected word.
 *
 * Web Speech API, which means the voice is whatever the operating system
 * provides and nothing is downloaded or sent anywhere. It is also the part
 * most likely to differ between machines: voice quality, latency and whether
 * any voice exists at all are all outside this project's control, so the
 * caller is told when it did not work rather than being left to assume it did.
 */

export type SpeechAvailability = "ready" | "no-voices" | "unsupported";

function subscribeToVoices(onChange: () => void) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return () => {};
  // Chrome populates the voice list asynchronously, so an empty list at page
  // load is not proof there are none.
  window.speechSynthesis.addEventListener("voiceschanged", onChange);
  return () => window.speechSynthesis.removeEventListener("voiceschanged", onChange);
}

/** Availability as a subscription, so a late-loading voice list updates the UI. */
export function useSpeechAvailability(): SpeechAvailability {
  return useSyncExternalStore(
    subscribeToVoices,
    speechAvailability,
    () => "unsupported" as const,
  );
}

export function speechAvailability(): SpeechAvailability {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return "unsupported";
  }
  // Voices load asynchronously in some browsers, so an empty list at page load
  // is not proof there are none. Reported separately from "unsupported" so the
  // UI can say which of the two it is.
  return window.speechSynthesis.getVoices().length > 0 ? "ready" : "no-voices";
}

export interface SpeakResult {
  spoke: boolean;
  reason?: string;
}

/**
 * Says one word.
 *
 * Cancels anything still speaking first. On a scanning board a new selection
 * means the person has moved on, and queueing would put the board further and
 * further behind what they just chose. The cost is that two fast selections
 * only speak the second one.
 */
export function speak(text: string): SpeakResult {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return { spoke: false, reason: "This browser has no speech synthesis." };
  }
  try {
    const synthesis = window.speechSynthesis;
    synthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    // Left at the platform defaults on purpose. Rate and pitch are things a
    // person picks for their own voice, not values to guess on their behalf.
    synthesis.speak(utterance);
    return { spoke: true };
  } catch (cause) {
    return { spoke: false, reason: cause instanceof Error ? cause.message : String(cause) };
  }
}
