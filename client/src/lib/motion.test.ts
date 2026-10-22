/**
 * The motion tokens exist twice — once here for Framer, once in the stylesheet
 * for the CSS entrances that paint before any script runs. Two copies of a
 * number are one edit away from disagreeing, and nothing would look broken: the
 * page would simply move with two hands. This keeps them one.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DURATION, EASE, STAGGER } from "@/lib/motion";

// From the project root, which is where Vitest runs: under jsdom
// `import.meta.url` is not a file URL, so it cannot locate the stylesheet.
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function token(name: string): string | undefined {
  return css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();
}

const ms = (seconds: number) => `${Math.round(seconds * 1000)}ms`;

describe("motion tokens", () => {
  it("are the same durations in the stylesheet as in the script", () => {
    expect(token("motion-fast")).toBe(ms(DURATION.fast));
    expect(token("motion-base")).toBe(ms(DURATION.base));
    expect(token("motion-slow")).toBe(ms(DURATION.slow));
    expect(token("motion-stagger")).toBe(ms(STAGGER));
  });

  it("are the same curve, under both of the names the stylesheet uses", () => {
    const curve = `cubic-bezier(${EASE.join(", ")})`;
    expect(token("ease-motion")).toBe(curve);
    expect(token("ease-out-soft")).toBe(curve);
  });
});
