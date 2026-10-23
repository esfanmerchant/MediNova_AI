"use client";

/**
 * Light ⇄ dark, as a pill with a sliding puck.
 *
 * The theme is only known after mount — the server cannot know what a person
 * chose last visit — so the control renders in a neutral state until then
 * rather than guessing and correcting itself in front of the reader.
 *
 * Both icons stay visible: the one that is lit says where you are, and the
 * other says where the tap will take you. That is what makes it readable
 * without a label. When the theme flips, both redraw themselves — the one now
 * under the puck spins in from a quarter turn, the other turns the opposite
 * way into its resting place — while the screen behind cross-fades.
 */

import { animate, motion } from "framer-motion";
import { useEffect, useRef } from "react";

import { Icon } from "@/components/Icon";
import { cx } from "@/components/ui";
import { useTr } from "@/lib/lang";
import { EASE, DURATION, SPRING, useCalmMotion } from "@/lib/motion";
import { useThemeSwitch } from "@/lib/theme";
import { useHydrated } from "@/lib/useHydrated";

const TURN = { ...SPRING, opacity: { duration: DURATION.base, ease: EASE } };

export function ThemeToggle({ onDark = false, console = false }: { onDark?: boolean; console?: boolean }) {
  const tr = useTr();
  const calm = useCalmMotion();
  const { resolvedTheme, setTheme } = useThemeSwitch();
  // The stored choice only exists in the browser, so the control renders in a
  // neutral state until hydration rather than guessing and correcting itself.
  const mounted = useHydrated();

  const dark = mounted && resolvedTheme === "dark";
  const label = dark ? tr("Light mode", "Roshan mode") : tr("Dark mode", "Tareek mode");

  const sun = useRef<HTMLSpanElement>(null);
  const moon = useRef<HTMLSpanElement>(null);
  // What the control last showed, once it knew. The first answer after
  // hydration is not a change, so it does not spin.
  const shown = useRef<boolean | null>(null);

  useEffect(() => {
    if (!mounted) return;
    const before = shown.current;
    shown.current = dark;
    if (before === null || before === dark || calm) return;

    const arriving = dark ? moon.current : sun.current;
    const leaving = dark ? sun.current : moon.current;
    const runs = [
      arriving && animate(arriving, { rotate: [-90, 0], scale: [0.55, 1], opacity: [0, 1] }, TURN),
      leaving && animate(leaving, { rotate: [90, 0], scale: [0.8, 1], opacity: [0, 1] }, TURN),
    ];
    return () => runs.forEach((run) => run && run.stop());
  }, [dark, mounted, calm]);

  // The console's switch is one round button showing the theme it turns on —
  // a moon by day, a sun by night — as the design draws it.
  if (console) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={dark}
        aria-label={label}
        title={label}
        onClick={() => setTheme(dark ? "light" : "dark")}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line-strong bg-card text-strong transition-colors hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Icon name={dark ? "light_mode" : "dark_mode"} className="text-[18px]" />
      </button>
    );
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={label}
      title={label}
      onClick={() => setTheme(dark ? "light" : "dark")}
      className={cx(
        "relative inline-flex h-9 w-[68px] items-center rounded-full border p-1 transition-[background-color,border-color,transform] duration-150 active:scale-[0.97]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        onDark ? "border-white/25 bg-white/10" : "border-line-strong bg-sunken",
      )}
    >
      {/* The puck. `layout` moves it with a spring when the theme flips. */}
      <motion.span
        layout
        aria-hidden
        transition={calm ? { duration: 0 } : SPRING}
        className={cx(
          "bg-gradient-brand absolute h-7 w-7 rounded-full shadow-sm",
          dark ? "right-1" : "left-1",
        )}
      />
      <span className="relative z-10 flex w-full items-center justify-between px-1.5">
        <span ref={sun} className="inline-grid place-items-center">
          <Icon
            name="light_mode"
            filled={mounted && !dark}
            className={cx(
              "text-[17px] transition-colors",
              mounted && !dark ? "text-white" : onDark ? "text-white/60" : "text-faint",
            )}
          />
        </span>
        <span ref={moon} className="inline-grid place-items-center">
          <Icon
            name="dark_mode"
            filled={dark}
            className={cx(
              "text-[17px] transition-colors",
              dark ? "text-white" : onDark ? "text-white/60" : "text-faint",
            )}
          />
        </span>
      </span>
    </button>
  );
}
