"use client";

/**
 * Questions about the machine the page is running on.
 *
 * All of them are asked through `useSyncExternalStore` rather than an effect
 * that calls `setState`. The distinction matters twice over: the server has no
 * window to ask, so a snapshot lets the prerendered HTML and the first client
 * render agree and React swap in the truth right after hydration — no mismatch;
 * and none of this is state the application owns, so storing it would mean
 * keeping a copy in step with something that can change under it.
 *
 * Each server snapshot is chosen to be the *safe* answer rather than the likely
 * one: motion is reduced, the screen is small, the machine is modest. A page
 * that renders its cheap form first and upgrades is right on every device; one
 * that assumes a desktop and downgrades has already spent the phone's battery
 * by the time it finds out.
 */

import { useSyncExternalStore } from "react";

function subscribe(query: string) {
  return (onChange: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  };
}

/**
 * Whether a media query matches, kept current as it changes.
 *
 * `whenUnknown` is what the server and the first client render see. Pick the
 * conservative answer, not the common one.
 */
export function useMediaQuery(query: string, whenUnknown: boolean): boolean {
  return useSyncExternalStore(
    subscribe(query),
    () => window.matchMedia(query).matches,
    () => whenUnknown,
  );
}

/** Nothing to subscribe to: these answers cannot change within one page load. */
const settled = () => () => {};

/**
 * A fact about the environment that is fixed for this page load.
 *
 * Same reasoning as `useMediaQuery` — read during render through a snapshot
 * rather than discovered in an effect and written back as state. `whenUnknown`
 * is what the server renders, so it must be the answer that is safe to be
 * wrong about for one frame.
 */
export function useEnvironment(read: () => boolean, whenUnknown: boolean): boolean {
  return useSyncExternalStore(settled, read, () => whenUnknown);
}

/**
 * A screen big enough, and a reader who has not asked for less movement.
 *
 * One query rather than two, because the answer is only ever used as a pair:
 * either an expensive decoration is welcome here or it is not.
 */
const WELCOMING = "(min-width: 1025px) and (prefers-reduced-motion: no-preference)";

/**
 * Whether this machine should be given something expensive to render.
 *
 * Used to decide whether the landing page runs its WebGL scene or shows the
 * still rendered from it. A render loop with shadows is not free on a phone —
 * it heats the device and makes the rest of the page feel like it is dragging —
 * and what it buys is decoration. The still is the same building.
 *
 * `deviceMemory` is Chromium-only and `hardwareConcurrency` can be absent, so
 * both default to a passing value: they are only ever used to say *no*, never
 * to promote a device that already failed the query above.
 */
export function useCanAffordDecoration(): boolean {
  const welcoming = useMediaQuery(WELCOMING, false);
  if (!welcoming) return false;

  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return memory >= 4 && (navigator.hardwareConcurrency ?? 8) >= 4;
}
