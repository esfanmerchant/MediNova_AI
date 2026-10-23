"use client";

import { useContext } from "react";

import { CONSOLE_ICONS } from "@/components/consoleIcons";
import { ConsoleSurface } from "@/components/consoleSurface";

/**
 * A Material Symbol — or, inside the administration console, the console's own
 * line drawing of the same thing (see `consoleIcons.ts`), so the console wears
 * the design's icons while every page keeps passing the same name.
 *
 * Always decorative: `aria-hidden` is not optional here. Every icon in this
 * application sits beside a real text label, and an icon font announced to a
 * screen reader reads out the ligature name — "monitor_heart" — which is worse
 * than silence.
 *
 * `filled` is the design system's active state. It is a shape change rather
 * than a colour change, so it survives a colour-blind reader and a bad monitor.
 * The console's line icons have no filled form; the console marks the active
 * state with its ground instead.
 */
export function Icon({
  name,
  filled = false,
  className,
}: {
  name: string;
  filled?: boolean;
  className?: string;
}) {
  const inConsole = useContext(ConsoleSurface);
  const drawing = inConsole ? CONSOLE_ICONS[name] : undefined;
  if (drawing) {
    return (
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={drawing.stroke ?? 2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={["console-icon", className].filter(Boolean).join(" ")}
      >
        <path d={drawing.d} />
      </svg>
    );
  }
  return (
    <span
      aria-hidden
      className={["msym", filled && "msym-fill", className].filter(Boolean).join(" ")}
    >
      {name}
    </span>
  );
}
