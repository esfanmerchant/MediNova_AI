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
 * The colour is the money chart's consultation blue, `#3987e5`, so a bar of
 * consultation income here is the same blue as consultations there.
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
      <figcaption className="sr-only">{label}</figcaption>

      {/* One line a row — name, bar, amount — as the design draws it. */}
      <ul className="flex flex-col gap-3">
        {bars.map((bar, index) => {
          const value = toNumber(bar.value);
          return (
            <li key={bar.label} className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)_110px] items-center gap-3.5">
              <span className="truncate font-semibold text-strong">{bar.label}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-sunken">
                <span
                  style={{
                    width: `${Math.max(2, (value / peak) * 100)}%`,
                    animationDelay: `${Math.min(0.1 + index * 0.05, 1).toFixed(2)}s`,
                  }}
                  className="bar-grow-x block h-full rounded-full bg-[#3987e5]"
                />
              </span>
              {/* Directly labelled: with a handful of rows there is room, and
                  a value beside its bar needs no hover to be read. */}
              <b className="text-right font-bold whitespace-nowrap text-strong tabular-nums">
                {currency} {format(value)}
              </b>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
