"use client";

/**
 * The reusable pieces of the motion system.
 *
 * Two engines, each where it is strongest. Entrances that only ever play
 * forwards — a page arriving, a row of cards taking turns, the words of a
 * heading — are CSS animations: they start on the compositor before React has
 * finished committing, and with `backwards` fill they leave nothing behind, so
 * a card's own hover lift still owns its transform afterwards. Anything that
 * has to be interrupted, reversed, sprung or driven by a number — a value
 * counting, a section revealed on scroll, a bar filling — goes through Framer.
 *
 * Every one of them is at rest from the first frame for somebody who has asked
 * for less movement: nothing is hidden and then shown, it is simply there.
 * Failure works the same way. Sections are hidden from JavaScript, after mount,
 * so a script that never runs costs the fade, never the content.
 */

import {
  animate,
  inView,
  motion,
  useMotionValue,
  useTransform,
  type MotionProps,
} from "framer-motion";
import { usePathname } from "next/navigation";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";

import {
  COUNT_DURATION,
  REVEAL_RISE,
  SPRING,
  STAGGER,
  TRANSITION,
  WORD_STAGGER,
  delayUntil,
  pendingEntrance,
  secondsIntoPage,
  useCalmMotion,
} from "@/lib/motion";

// Not `cx` from ui.tsx: ui.tsx renders CountUp, and a module cycle between the
// two would be one refactor away from an undefined import at load time.
const join = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");

// Under test the final state is the only one worth asserting on, and jsdom has
// neither a compositor nor an IntersectionObserver to drive the rest.
const IN_TESTS = process.env.NODE_ENV === "test";

type Tag = "div" | "section" | "ul" | "ol" | "dl" | "article";

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/**
 * Every portal page arrives the same way: up 16px and in, over 350ms.
 *
 * It wraps the content inside the shell rather than the shell itself, so the
 * navigation and the header hold still while the page under them changes —
 * chrome that moves on every click reads as the whole app reloading. It also
 * starts the page clock that staggered groups further down count from.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const key = usePathname() ?? "";
  useLayoutEffect(() => {
    secondsIntoPage(key);
  }, [key]);
  return (
    <div className="page-enter" data-page-transition>
      {children}
    </div>
  );
}

/**
 * Gives each child of `ref` its turn: `at` seconds into the page, then one
 * `step` apart.
 *
 * Measured against the page clock, so a group that mounts after its data has
 * arrived waits only for whatever is left of its turn — usually nothing. Set
 * once, on arrival: children that come later (a list growing) fall back to the
 * stylesheet's own spacing, which counts from zero.
 */
export function useStaggerAt(
  ref: RefObject<HTMLElement | null>,
  at: number | undefined,
  step: number = STAGGER,
): void {
  const key = usePathname() ?? "";
  const placed = useRef(false);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || at === undefined || placed.current) return;
    placed.current = true;
    const start = delayUntil(at, key);
    Array.from(node.children).forEach((child, index) => {
      (child as HTMLElement).style.animationDelay = `${(start + index * step).toFixed(3)}s`;
    });
  }, [ref, at, step, key]);
}

/**
 * Children that arrive one after another.
 *
 * The animation itself is the `.stagger` rule in `globals.css`; this component
 * only decides *when* it starts.
 */
export function Stagger({
  as = "div",
  at = 0,
  step = STAGGER,
  className,
  children,
  ...rest
}: {
  as?: Tag;
  /** Seconds into the page this group's first child should start. */
  at?: number;
  step?: number;
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "className" | "children">) {
  const ref = useRef<HTMLDivElement | null>(null);
  useStaggerAt(ref, at, step);
  // One element type as far as the types are concerned; at runtime it is
  // whichever tag was asked for — a list stays a list.
  const Element = as as "div";
  return (
    <Element {...rest} ref={ref} className={join("stagger", className)}>
      {children}
    </Element>
  );
}

// ---------------------------------------------------------------------------
// Scroll
// ---------------------------------------------------------------------------

/**
 * Fades `ref` up 24px the first time it is scrolled into view.
 *
 * Something already on screen when it mounts still waits for its turn on the
 * page clock, so a dashboard on a tall monitor arrives in order instead of all
 * at once. `undefined` turns the whole thing off.
 */
export function useRevealOnScroll(ref: RefObject<HTMLElement | null>, at: number | undefined): void {
  const key = usePathname() ?? "";
  const calm = useCalmMotion();

  useLayoutEffect(() => {
    const node = ref.current;
    if (at === undefined || !node || calm || IN_TESTS) return;
    if (typeof IntersectionObserver === "undefined") return;

    // Hidden here, before the first paint, and only from here.
    node.dataset.reveal = "";
    node.style.opacity = "0";
    node.style.transform = `translateY(${REVEAL_RISE}px)`;

    let controls: ReturnType<typeof animate> | undefined;
    const settle = () => {
      node.style.removeProperty("opacity");
      node.style.removeProperty("transform");
    };
    const stop = inView(
      node,
      () => {
        stop();
        // Entrances inside the section have been held at their first frame
        // (globals.css); this lets them play now that anybody can see them.
        node.dataset.revealed = "";
        controls = animate(
          node,
          { opacity: [0, 1], y: [REVEAL_RISE, 0] },
          { ...TRANSITION.slow, delay: delayUntil(at, key) },
        );
        // Hand the element back to the stylesheet once it has arrived.
        void controls.then(settle);
      },
      // Any part of it, once that part is 40px up from the bottom edge — not a
      // fraction of it, and not a percentage of the screen. A fraction can be
      // more than a long section ever shows at once; a percentage can be more
      // than a short section at the very end of the page can ever climb above.
      // Either way the section would never appear.
      { amount: "some", margin: "0px 0px -40px 0px" },
    );

    return () => {
      stop();
      controls?.stop();
      settle();
      delete node.dataset.reveal;
      delete node.dataset.revealed;
    };
  }, [ref, at, calm, key]);
}

/** A block that fades up into place when scrolled to. */
export function Reveal({
  as = "div",
  at = 0,
  className,
  children,
  ...rest
}: {
  as?: Tag;
  at?: number;
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "className" | "children">) {
  const ref = useRef<HTMLDivElement | null>(null);
  useRevealOnScroll(ref, at);
  const Element = as as "div";
  return (
    <Element {...rest} ref={ref} className={className}>
      {children}
    </Element>
  );
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/**
 * A heading whose words rise into place, each from behind its own edge.
 *
 * The words are drawn twice: once whole for assistive technology, once split
 * and hidden from it. Splitting the only copy would have a screen reader read a
 * title as a list of separate words, or pause between every one.
 */
export function RevealText({ text, at = 0 }: { text: string; at?: number }) {
  const calm = useCalmMotion();
  if (calm || IN_TESTS) return <>{text}</>;

  const words = text.split(/\s+/).filter(Boolean);
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {words.map((word, index) => (
          <Fragment key={index}>
            <span className="word-mask">
              <span style={{ animationDelay: `${(at + index * WORD_STAGGER).toFixed(3)}s` }}>{word}</span>
            </span>
            {index < words.length - 1 && " "}
          </Fragment>
        ))}
      </span>
    </>
  );
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/**
 * A number that counts up to its value on arrival, and from the old value to
 * the new one whenever it changes.
 *
 * The digits are written straight into the text node by a motion value, so the
 * count costs no React renders. It waits for its tile's own entrance before it
 * starts — a count that finishes while the tile is still invisible is a count
 * nobody saw.
 */
export function CountUp({
  value,
  decimals = 0,
  duration = COUNT_DURATION,
  format,
}: {
  value: number;
  decimals?: number;
  duration?: number;
  /** For anything other than a plain number: a unit, a locale, a sign. */
  format?: (value: number) => string;
}) {
  const calm = useCalmMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useMotionValue(calm || IN_TESTS ? value : 0);
  const text = useTransform(shown, (latest) => (format ? format(latest) : latest.toFixed(decimals)));

  useEffect(() => {
    if (calm || IN_TESTS) {
      shown.jump(value);
      return;
    }
    const controls = animate(shown, value, {
      duration,
      ease: "easeOut",
      delay: pendingEntrance(ref.current),
    });
    return () => controls.stop();
  }, [value, calm, duration, shown]);

  if (IN_TESTS) return <>{format ? format(value) : value.toFixed(decimals)}</>;
  return <motion.span ref={ref}>{text}</motion.span>;
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

type PresenceProps = Pick<MotionProps, "layout" | "initial" | "animate" | "exit" | "transition">;

/**
 * Props for one row of a list that changes under somebody's eyes.
 *
 * A row that arrives opens from nothing; one that leaves fades and closes; the
 * rows around it slide to their new places rather than jumping there. Spread
 * onto a `motion.li` inside `<AnimatePresence initial={false}>` — `initial`
 * off, so the rows already there when the list first appears take the page's
 * own entrance instead of opening one by one.
 *
 * Height is the one non-composited property in the motion system, and it is
 * here on purpose: a row closing is the only honest picture of a row leaving.
 * It runs on one element for a third of a second, and only when something
 * actually changed.
 */
export function usePresenceItem(): PresenceProps {
  const calm = useCalmMotion();
  if (calm) {
    return {
      initial: false,
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: TRANSITION.fast,
    };
  }
  return {
    layout: "position",
    initial: { opacity: 0, height: 0, overflow: "hidden" },
    animate: { opacity: 1, height: "auto", transitionEnd: { overflow: "visible" } },
    exit: { opacity: 0, height: 0, overflow: "hidden" },
    transition: { ...TRANSITION.base, layout: SPRING },
  };
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/**
 * A bar that fills to `value` (0–1) on arrival and slides to every new value.
 *
 * The bar's width is set once, as layout; what moves is a scale from where it
 * was to where it is now. So the bar at rest is exactly the bar it always was —
 * the gradient across its own length, the rounded end — while the movement
 * stays on the compositor.
 */
export function Progress({
  value,
  className,
  barClassName,
  label,
}: {
  value: number;
  /** The track: height, radius, ground. */
  className?: string;
  /** The fill: its colour. */
  barClassName?: string;
  /** Names the bar for assistive technology. Without one it is decoration. */
  label?: string;
}) {
  const calm = useCalmMotion();
  const ratio = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const bar = useRef<HTMLDivElement>(null);
  const previous = useRef<number | null>(null);

  useLayoutEffect(() => {
    const node = bar.current;
    const from = previous.current === null ? 0 : previous.current / (ratio || 1);
    previous.current = ratio;
    if (!node || calm || IN_TESTS || ratio === 0 || from === 1) return;
    const controls = animate(node, { scaleX: [from, 1] }, TRANSITION.slow);
    return () => controls.stop();
  }, [ratio, calm]);

  return (
    <div
      className={join("overflow-hidden", className)}
      role={label ? "progressbar" : undefined}
      aria-label={label}
      aria-valuemin={label ? 0 : undefined}
      aria-valuemax={label ? 100 : undefined}
      aria-valuenow={label ? Math.round(ratio * 100) : undefined}
      aria-hidden={label ? undefined : true}
    >
      <div
        ref={bar}
        className={join("h-full origin-left rounded-full", barClassName)}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}
