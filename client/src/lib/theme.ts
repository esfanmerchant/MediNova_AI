"use client";

/**
 * Changing the theme as a cross-fade rather than a cut.
 *
 * Every surface, line and word on the screen changes colour at once, and done
 * instantly that reads as a flash — a white page blinking to navy in one frame
 * is the brightest thing an application can do to somebody's eyes at night.
 *
 * Where the browser supports view transitions the old and new screens are
 * captured as two images and dissolved into each other over 400ms: one
 * composited layer each, however many thousand elements changed, gradients and
 * images included. Everywhere else the colours themselves transition for the
 * same 400ms (`.theme-fading` in globals.css). Somebody who has asked for less
 * motion gets the cut, which is what they asked for.
 *
 * Every control that changes the theme goes through here, so they all behave
 * alike: the header switch, the account menu, the Appearance tab.
 */

import { useTheme } from "next-themes";
import { useCallback } from "react";
import { flushSync } from "react-dom";

import { prefersCalm } from "@/lib/motion";

const FADE_MS = 400;
let fadeTimer: number | undefined;

function resolve(choice: string): "light" | "dark" {
  if (choice === "dark" || choice === "light") return choice;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Puts the class on `<html>` now, the way next-themes would on its next effect.
 *
 * The view transition captures the new screen as soon as its callback returns,
 * so the change has to have happened by then rather than one effect later.
 * Element transitions are held off for the moment of the switch, as next-themes
 * does — inside a cross-fade, a button easing between its own two colours
 * would be a second, smaller fade layered on the first.
 */
function applyNow(choice: string): void {
  const root = document.documentElement;
  const theme = resolve(choice);
  const hold = document.createElement("style");
  hold.textContent = "*,*::before,*::after{transition:none!important}";
  document.head.appendChild(hold);
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  root.style.colorScheme = theme;
  window.getComputedStyle(document.body).getPropertyValue("color");
  window.setTimeout(() => hold.remove(), 1);
}

export function useThemeSwitch() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  const switchTheme = useCallback(
    (next: string) => {
      if (prefersCalm()) {
        setTheme(next);
        return;
      }

      if (typeof document.startViewTransition === "function") {
        document.startViewTransition(() => {
          flushSync(() => setTheme(next));
          applyNow(next);
        });
        return;
      }

      const root = document.documentElement;
      root.classList.add("theme-fading");
      window.clearTimeout(fadeTimer);
      setTheme(next);
      fadeTimer = window.setTimeout(() => root.classList.remove("theme-fading"), FADE_MS + 60);
    },
    [setTheme],
  );

  return { theme, resolvedTheme, setTheme: switchTheme };
}
