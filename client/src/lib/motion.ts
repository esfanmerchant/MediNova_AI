/**
 * The motion system, in one place.
 *
 * Every duration, curve and spring in the application comes from here, so the
 * product moves with one hand rather than thirty. The same numbers exist as CSS
 * custom properties at the top of `globals.css` — the stylesheet runs the
 * cheap, compositor-only entrances, Framer runs the springs and the exits —
 * and `motion.test.ts` fails if the two ever drift apart.
 *
 * **Only transform and opacity move.** Both are composited: the browser hands
 * them to the GPU and the page's layout is never recomputed mid-animation. A
 * width, a top or a box-shadow animated on a busy dashboard is a relayout or a
 * repaint every frame, competing with the scroll for the same sixteen
 * milliseconds — which is how an animated page ends up feeling slower than a
 * still one.
 *
 * **Nobody has motion forced on them.** `useCalmMotion` is true when either the
 * operating system or this application's own Appearance setting asks for less
 * movement. The second exists because a ward terminal's OS setting belongs to
 * the hospital, not to the person reading a vital sign on it.
 */

import { useReducedMotion } from "framer-motion";

import { useMotionPreference } from "@/components/settings/preferences";

/** Seconds. `fast` acknowledges, `base` moves, `slow` arrives. */
export const DURATION = { fast: 0.15, base: 0.35, slow: 0.6 } as const;

/** A long, soft settle: quick out of the gate, no bounce at the end. */
export const EASE = [0.22, 1, 0.36, 1] as const;
export const EASE_CSS = "cubic-bezier(0.22, 1, 0.36, 1)";

/** For things that are thrown rather than placed: pills, drawers, panels. */
export const SPRING = { type: "spring", stiffness: 300, damping: 30 } as const;

/** Between siblings arriving one after another. */
export const STAGGER = 0.06;
/** Between the words of a heading as they rise into place. */
export const WORD_STAGGER = 0.05;

/** How far a page rises as it arrives, in pixels. */
export const PAGE_RISE = 16;
/** How far a section below the fold rises when it is scrolled into view. */
export const REVEAL_RISE = 24;

/** A number counting up to its value. */
export const COUNT_DURATION = 0.9;

export const TRANSITION = {
  fast: { duration: DURATION.fast, ease: EASE },
  base: { duration: DURATION.base, ease: EASE },
  slow: { duration: DURATION.slow, ease: EASE },
} as const;

/** Whether anything should move at all, from either place a person can say no. */
export function useCalmMotion(): boolean {
  const system = useReducedMotion();
  const chosen = useMotionPreference();
  return Boolean(system) || chosen === "reduced";
}

/** The same question, for code that runs outside render. */
export function prefersCalm(): boolean {
  if (typeof window === "undefined") return true;
  const system =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return system || document.documentElement.dataset.motion === "reduced";
}

/**
 * "That changed": scale 1 → 1.03 → 1.
 *
 * Through the Web Animations API with `composite: "add"`, so it is laid on top
 * of whatever transform the element already has — a tile lifted under the
 * cursor pulses where it is instead of dropping back down — and it leaves no
 * inline style behind once it ends. A browser without additive composition
 * simply replaces the transform for the 420ms it runs, which is fine.
 */
export function pulse(element: Element | null): void {
  if (!element || typeof element.animate !== "function" || prefersCalm()) return;
  element.animate(
    [{ transform: "scale(1)" }, { transform: "scale(1.03)" }, { transform: "scale(1)" }],
    { duration: 420, easing: EASE_CSS, composite: "add" },
  );
}

// ---------------------------------------------------------------------------
// The page clock
// ---------------------------------------------------------------------------

/**
 * When the page now on screen began to arrive.
 *
 * A dashboard enters in order — greeting, shortcuts, numbers, lists — but the
 * numbers wait on a request. If they come back after their turn has passed they
 * should simply appear, not sit out a delay the page already spent; if they
 * come back first (from cache) they should still wait for the greeting. So each
 * group asks "how long until my turn?" against a clock that starts with the
 * page, rather than counting from its own mount.
 *
 * Keyed by path, because that is what a navigation changes. The first thing to
 * ask on a new path starts the clock; everything mounted in that same commit
 * reads the same zero.
 */
let clock = { key: "", startedAt: 0 };

export function secondsIntoPage(key: string): number {
  const now = performance.now();
  if (clock.key !== key) clock = { key, startedAt: now };
  return (now - clock.startedAt) / 1000;
}

/** Seconds left until `at` on this page's clock; zero once it has passed. */
export function delayUntil(at: number, key: string): number {
  return Math.max(0, at - secondsIntoPage(key));
}

/**
 * How long until an element's entrance actually begins.
 *
 * A number that counts up while its tile is still waiting for its turn in a
 * stagger finishes counting before anybody can see it. This looks up the
 * element's own entrance — and its parents', since the tile is usually what is
 * staggered and the number sits a few levels inside it — and reports the delay
 * still outstanding, so the count can start the moment the tile does.
 */
export function pendingEntrance(element: Element | null): number {
  let wait = 0;
  let node: Element | null = element;
  for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
    if (typeof node.getAnimations !== "function") break;
    for (const animation of node.getAnimations()) {
      const timing = animation.effect?.getComputedTiming();
      const delay = typeof timing?.delay === "number" ? timing.delay : 0;
      const current = typeof animation.currentTime === "number" ? animation.currentTime : 0;
      wait = Math.max(wait, (delay - current) / 1000);
    }
  }
  return wait;
}
