"use client";

/**
 * The Roman Urdu ⇄ English switch.
 *
 * A segmented pill rather than a dropdown: two languages is a toggle, and both
 * options staying visible is what tells a visitor the other language exists at
 * all. Each segment is labelled in its own language — "اردو would be wrong here;
 * the site is Roman Urdu, so the label is too.
 *
 * The lit ground is one element that slides from one segment to the other,
 * rather than two that switch on and off: the movement is what says "this
 * changed", in a control whose whole effect is that every word on the screen
 * just did.
 */

import { motion } from "framer-motion";
import { useId, useState } from "react";

import { setLang, useLang } from "@/lib/lang";
import { SPRING, useCalmMotion } from "@/lib/motion";
import { cx } from "@/components/ui";

const OPTIONS = [
  { value: "ur", label: "Urdu" },
  { value: "en", label: "English" },
] as const;

/** The console reads in the order the design sets: English, then Urdu. */
const CONSOLE_OPTIONS = [OPTIONS[1], OPTIONS[0]] as const;

export function LanguageToggle({ onDark = false, console = false }: { onDark?: boolean; console?: boolean }) {
  const lang = useLang();
  const calm = useCalmMotion();
  // One per toggle: the header and the account menu can both be on screen,
  // and a shared id would have the pill fly between them.
  const pill = useId();
  // The stored language replaces the default a moment after load; that is a
  // correction, not a choice, so the pill only travels once it has been tapped.
  const [touched, setTouched] = useState(false);

  return (
    <div
      role="group"
      aria-label="Language / Zubaan"
      className={cx(
        "flex items-center rounded-full border font-semibold",
        console ? "p-[3px] text-[12.5px]" : "p-0.5 text-xs",
        onDark ? "border-white/25 bg-white/10" : "border-line-strong bg-card",
      )}
    >
      {(console ? CONSOLE_OPTIONS : OPTIONS).map((option) => {
        const active = lang === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => {
              setTouched(true);
              setLang(option.value);
            }}
            className={cx(
              "relative rounded-full px-3 transition-[color,transform] duration-150 active:scale-[0.97]",
              console ? "h-8" : "min-h-11",
              "focus-visible:outline-2 focus-visible:outline-offset-2",
              onDark ? "focus-visible:outline-white" : "focus-visible:outline-primary",
              active
                ? onDark
                  ? "text-[#053B38]"
                  : console
                    ? "text-white"
                    : // `text-primary-on`, not `text-white`. The primary colour is a
                    // deep blue on a light ground and a pale one on a dark
                    // ground, so white on it is 12:1 in one theme and 2.6:1 in
                    // the other — the token exists precisely to follow it.
                    "text-primary-on"
                : onDark
                  ? "text-white/70 hover:text-white"
                  : "text-muted hover:text-strong",
            )}
          >
            {active && (
              <motion.span
                layoutId={pill}
                aria-hidden
                transition={calm || !touched ? { duration: 0 } : SPRING}
                className={cx(
                  "absolute inset-0 rounded-full",
                  onDark ? "bg-accent-bright" : console ? "bg-[#0B3FA8] dark:bg-[#3B6FE0]" : "bg-primary",
                )}
              />
            )}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
