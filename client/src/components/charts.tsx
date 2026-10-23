"use client";

/**
 * Bars by category, drawn by hand.
 *
 * No charting library. These are rectangles with a scale, and a library would
 * add a dependency, a bundle, and a second theming system to keep in step with
 * this one, in exchange for features nothing here asks for.
 *
 * Money over time lives in `admin/RevenueChart.tsx`, which stacks two series.
 * The brand ramp could not do that — it is blue through cyan, and any two of
 * its stops land under ΔE 15 of each other — so that chart takes two validated
 * steps from outside it rather than reusing brand or status colours.
 *
 * The colour here is a validated step in each mode, not one colour with
 * opacity: `#1462c4` on light, `#4a86d8` on dark, both inside the mode's
 * lightness band and above 3:1 on its surface.
 */

import { useTr } from "@/lib/lang";

/** One bar's worth of data. `value` is a decimal string, as money always is. */
export interface Bar {
  label: string;
  value: string;
  /** Shown in the tooltip under the value — a count, a date, anything. */
  detail?: string;
}

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function format(value: number): string {
  // Grouped, never abbreviated: "1.2M" on a money figure invites somebody to
  // read it as the exact amount, and this is the only place the number appears.
  return new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(value);
}

/** Magnitude by category — horizontal, because the labels are words. */
export function CategoryBars({
  bars,
  currency,
  label,
}: {
  bars: Bar[];
  currency: string;
  label: string;
}) {
  const tr = useTr();
  const peak = Math.max(1, ...bars.map((bar) => toNumber(bar.value)));

  if (bars.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">{tr("Nothing to show yet.", "Dikhane ko abhi kuchh nahi.")}</p>;
  }

  return (
    <figure className="m-0">
      <figcaption className="mb-4 text-sm text-muted">{label}</figcaption>

      <ul className="space-y-3">
        {bars.map((bar, index) => {
          const value = toNumber(bar.value);
          return (
            <li key={bar.label}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate font-medium text-strong">{bar.label}</span>
                {/* Directly labelled: with a handful of rows there is room, and
                    a value beside its bar needs no hover to be read. */}
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                  {currency} {format(value)}
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-sunken">
                <div
                  style={{
                    width: `${Math.max(2, (value / peak) * 100)}%`,
                    animationDelay: `${Math.min(index * 0.05, 1).toFixed(2)}s`,
                  }}
                  className="bar-grow-x h-full rounded-full bg-[#1462c4] dark:bg-[#4a86d8]"
                />
              </div>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
