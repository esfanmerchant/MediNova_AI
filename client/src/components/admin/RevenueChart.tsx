"use client";

/**
 * Money paid over time, on the console's navy panel.
 *
 * Each bar is one period, stacked by whose business it was — consultations
 * below, medicine on top. On the overview the best period is named in the
 * corner, because "what was our best day" is the question that page's chart
 * gets asked most; the window's total sits above the chart rather than as a
 * second line in it. There is no value axis: the bars are read against each
 * other, and the exact figure of any one is a hover away.
 *
 * The two colours are the dataviz reference palette's dark blue and aqua steps
 * (`#3987e5`, `#199e70`), validated on this panel's navy: both inside the dark
 * lightness band, ΔE 18.8 apart under deuteranopia and 20.3 with full colour
 * vision. The brand's own light blue and teal were tried first and fail — ΔE 13
 * apart, the same problem `charts.tsx` records — so the segments also keep a
 * 2px gap between them, and the legend and table name both.
 *
 * Every period in the window gets a slot, paid or not. The server leaves quiet
 * periods out (a gap is honest; an invented zero is not), and the axis has to
 * keep them as gaps — thirty days drawn as nineteen bars would squeeze the
 * calendar and lie about the shape of the month.
 */

import { useState, type ReactNode } from "react";

import { dayMonth } from "@/components/admin/console";
import { ErrorState, cx } from "@/components/ui";
import type { RevenueGrain, RevenuePoint } from "@/lib/api";
import { useTr } from "@/lib/lang";

/**
 * How many periods each grain draws. `_WINDOW` in api/app/modules/billing/revenue.py
 * reaches one bucket further, into a period it only partly covers; that partial
 * one is left off the chart and out of the total, so "last 30 days" is thirty.
 */
const WINDOW_SLOTS: Record<RevenueGrain, number> = { day: 30, week: 12, month: 12 };

const DAY = 86_400_000;

interface Slot {
  key: string;
  start: Date;
  visits: number;
  medicine: number;
  invoices: number;
  paid: boolean;
}

/** The start of the period a moment falls in, in UTC — the database buckets in UTC. */
function truncate(moment: Date, grain: RevenueGrain): Date {
  const day = new Date(Date.UTC(moment.getUTCFullYear(), moment.getUTCMonth(), moment.getUTCDate()));
  if (grain === "day") return day;
  if (grain === "week") return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY);
  return new Date(Date.UTC(moment.getUTCFullYear(), moment.getUTCMonth(), 1));
}

function step(moment: Date, grain: RevenueGrain, by: number): Date {
  if (grain === "day") return new Date(moment.getTime() + by * DAY);
  if (grain === "week") return new Date(moment.getTime() + by * 7 * DAY);
  return new Date(Date.UTC(moment.getUTCFullYear(), moment.getUTCMonth() + by, 1));
}

function slotsFor(points: RevenuePoint[], grain: RevenueGrain, now: Date): Slot[] {
  const byKey = new Map(points.map((point) => [truncate(new Date(point.period), grain).toISOString(), point]));
  const last = truncate(now, grain);
  return Array.from({ length: WINDOW_SLOTS[grain] }, (_, index) => {
    const start = step(last, grain, index - WINDOW_SLOTS[grain] + 1);
    const point = byKey.get(start.toISOString());
    const handled = Number(point?.handled) || 0;
    const medicine = Number(point?.pharmacy) || 0;
    return {
      key: start.toISOString(),
      start,
      visits: Math.max(0, handled - medicine),
      medicine,
      invoices: point?.invoices ?? 0,
      paid: Boolean(point),
    };
  });
}

/** The points the chart draws — the window's periods, without the partial oldest one. */
export function inWindow(points: RevenuePoint[], grain: RevenueGrain, now = new Date()): RevenuePoint[] {
  const first = step(truncate(now, grain), grain, 1 - WINDOW_SLOTS[grain]).getTime();
  return points.filter((point) => truncate(new Date(point.period), grain).getTime() >= first);
}

const whole = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 });

function useSlotLabel(grain: RevenueGrain) {
  const tr = useTr();
  return (slot: Slot, long = false) => {
    if (grain === "month") {
      return slot.start.toLocaleDateString("en-GB", { month: long ? "long" : "short", year: long ? "numeric" : "2-digit", timeZone: "UTC" });
    }
    const date = dayMonth(slot.start, { utc: true, weekday: long && grain === "day" });
    return grain === "week" && long ? tr(`Week of ${date}`, `${date} wala hafta`) : date;
  };
}

export function RevenueChart({
  points,
  grain,
  currency,
  height = 220,
  active: controlled,
  onActive,
}: {
  points: RevenuePoint[];
  grain: RevenueGrain;
  currency: string;
  /** The plot's height in pixels: 170 on the overview, 220 on the Revenue page. */
  height?: number;
  /** The bar being looked at, when the panel shows it elsewhere; a tooltip otherwise. */
  active?: number | null;
  onActive?: (index: number | null) => void;
}) {
  const tr = useTr();
  const [own, setOwn] = useState<number | null>(null);
  const active = onActive ? (controlled ?? null) : own;
  const setActive = onActive ?? setOwn;
  const slots = slotsFor(points, grain, new Date());
  const label = useSlotLabel(grain);

  if (!slots.some((slot) => slot.paid)) {
    return (
      <p className="py-16 text-center text-sm text-[#B9C7DD]">
        {tr("Nothing has been paid in this period yet.", "Is muddat mein abhi kuchh ada nahi hua.")}
      </p>
    );
  }

  const totals = slots.map((slot) => slot.visits + slot.medicine);
  // Headroom above the tallest bar, so it never touches the panel's header.
  const ceiling = Math.max(...totals) * 1.08 || 1;
  // Day by day, a label a week apart; otherwise four even steps. Spread
  // evenly across the plot, the way the design sets them.
  const stride = grain === "day" ? 7 : Math.max(1, Math.round((slots.length - 1) / 4));
  // A step that would sit right against the last label is left to it.
  const last = slots.length - 1;
  const labelled = [...Array.from({ length: Math.ceil((last - stride / 2) / stride) }, (_, i) => i * stride), last];
  const tip = !onActive && active !== null ? active : null;

  return (
    <figure className="m-0 flex flex-col gap-4">
      <div
        className="relative flex items-end gap-[2px] border-b border-white/20 sm:gap-1"
        style={{ height }}
        onMouseLeave={() => setActive(null)}
      >
        {slots.map((slot, index) => {
          const total = totals[index];
          const share = total > 0 ? Math.max(1.5, (total / ceiling) * 100) : 0;
          return (
            <button
              key={slot.key}
              type="button"
              aria-label={`${label(slot, true)}: ${currency} ${whole.format(total)}`}
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              className={cx(
                "relative flex h-full flex-1 flex-col justify-end rounded-t-[4px] transition-opacity duration-150",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5EEAD4]",
                active !== null && active !== index && "opacity-50",
              )}
            >
              <span
                className="bar-grow flex w-full flex-col gap-[2px]"
                style={{ height: `${share}%`, animationDelay: `${Math.min(index * 0.03, 0.9).toFixed(2)}s` }}
              >
                {slot.medicine > 0 && <span className="w-full rounded-t-[4px] bg-[#199e70]" style={{ flexGrow: slot.medicine }} />}
                {slot.visits > 0 && (
                  <span
                    className={cx("w-full bg-[#3987e5]", slot.medicine === 0 && "rounded-t-[4px]")}
                    style={{ flexGrow: slot.visits }}
                  />
                )}
              </span>
            </button>
          );
        })}
        {tip !== null && (
          <span
            role="status"
            className={cx(
              "pointer-events-none absolute z-10 rounded-lg bg-[#061230]/90 px-2.5 py-1.5 text-right whitespace-nowrap",
              tip > slots.length / 2 ? "-translate-x-full" : "",
            )}
            style={{
              left: `${((tip + (tip > slots.length / 2 ? 0 : 1)) / slots.length) * 100}%`,
              bottom: `calc(${Math.max(1.5, (totals[tip] / ceiling) * 100)}% + 6px)`,
            }}
          >
            <span className="block font-mono text-[10px] tracking-[0.12em] text-[#7FD8E6] uppercase">{label(slots[tip], true)}</span>
            <span className="block font-display text-[14px] font-bold text-white tabular-nums">
              {currency} {whole.format(totals[tip])}
            </span>
          </span>
        )}
      </div>

      <div aria-hidden className="flex justify-between text-[11px] text-[#8EA1C2]">
        {[...new Set(labelled)].map((index) => (
          <span key={index} className="whitespace-nowrap">
            {index === slots.length - 1 ? tr(grain === "day" ? "Today" : grain === "week" ? "This week" : "This month", grain === "day" ? "Aaj" : "Ab") : label(slots[index])}
          </span>
        ))}
      </div>

      <table className="sr-only">
        <caption>{tr("Money paid, by period", "Ada shuda raqam, muddat ke hisaab se")}</caption>
        <thead>
          <tr>
            <th scope="col">{tr("Period", "Muddat")}</th>
            <th scope="col">{tr(`Consultations (${currency})`, `Consultations (${currency})`)}</th>
            <th scope="col">{tr(`Medicine (${currency})`, `Dawa (${currency})`)}</th>
            <th scope="col">{tr(`Total (${currency})`, `Kul (${currency})`)}</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((slot, index) => (
            <tr key={slot.key}>
              <th scope="row">{label(slot, true)}</th>
              <td>{whole.format(slot.visits)}</td>
              <td>{whole.format(slot.medicine)}</td>
              <td>{whole.format(totals[index])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export const GRAINS: Array<{ value: RevenueGrain; label: [string, string]; window: [string, string] }> = [
  { value: "day", label: ["Daily", "Rozana"], window: ["last 30 days", "pichhle 30 din"] },
  { value: "week", label: ["Weekly", "Haftawar"], window: ["last 12 weeks", "pichhle 12 haftay"] },
  { value: "month", label: ["Monthly", "Mahana"], window: ["last 12 months", "pichhle 12 mahine"] },
];

/**
 * The chart on its navy panel, with the window's total and the legend: the
 * Revenue page lets the period change, the overview keeps it to thirty days.
 */
export function RevenuePanel({
  grain,
  onGrain,
  currency,
  points,
  loading,
  error,
  onRetry,
  footer,
  className,
}: {
  grain: RevenueGrain;
  /** Offers Daily, Weekly and Monthly when given — the Revenue page. Without
   * it the panel is the overview's, and names the best period instead. */
  onGrain?: (grain: RevenueGrain) => void;
  currency: string;
  points: RevenuePoint[] | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  footer?: ReactNode;
  className?: string;
}) {
  const tr = useTr();
  const label = useSlotLabel(grain);
  const [active, setActive] = useState<number | null>(null);
  const shown = points ? inWindow(points, grain) : undefined;
  const slots = points ? slotsFor(points, grain, new Date()) : [];
  const totals = slots.map((slot) => slot.visits + slot.medicine);
  const best = totals.length && Math.max(...totals) > 0 ? totals.indexOf(Math.max(...totals)) : null;
  const focus = active ?? best;
  const bestWord = grain === "day" ? tr("best day", "behtareen din") : grain === "week" ? tr("best week", "behtareen hafta") : tr("best month", "behtareen mahina");

  return (
    <section
      aria-label={tr("Over time", "Waqt ke saath")}
      className={cx(
        "relative isolate flex flex-col gap-4 overflow-hidden rounded-[28px] bg-[linear-gradient(150deg,#081A40_0%,#0A2558_55%,#0B3A73_100%)] text-[#DCE7F7] shadow-[0_30px_60px_-32px_rgba(8,22,51,0.85)]",
        onGrain ? "px-5 py-6 sm:px-7 sm:py-[26px]" : "px-5 py-6 sm:px-[26px]",
        className,
      )}
    >
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3.5">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[11px] tracking-[0.14em] text-[#7FD8E6] uppercase">
            {tr("Money paid", "Ada shuda raqam")} · {tr(...GRAINS.find((option) => option.value === grain)!.window)}
          </span>
          <span
            className={cx(
              "font-display leading-tight font-bold text-white tabular-nums",
              onGrain ? "text-3xl sm:text-[38px]" : "text-3xl sm:text-[36px]",
            )}
          >
            {shown ? `${currency} ${whole.format(shown.reduce((sum, point) => sum + (Number(point.handled) || 0), 0))}` : "—"}
          </span>
        </div>
        <div className={cx("flex flex-wrap gap-4 text-[12.5px] text-[#B9C7DD]", onGrain ? "pb-2" : "pb-1.5")}>
          <span className="inline-flex items-center gap-[7px]">
            <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-[#3987e5]" />
            {tr("Consultations", "Consultations")}
          </span>
          <span className="inline-flex items-center gap-[7px]">
            <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-[#199e70]" />
            {tr("Medicine", "Dawa")}
          </span>
        </div>
        {onGrain ? (
          <div role="group" aria-label={tr("Period", "Muddat")} className="ml-auto inline-flex rounded-full bg-[#061230]/60 p-1">
            {GRAINS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={grain === option.value}
                onClick={() => onGrain(option.value)}
                className={cx(
                  "h-8 rounded-full px-3.5 text-[12.5px] font-semibold transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5EEAD4]",
                  grain === option.value ? "bg-white text-[#0A2A72]" : "text-[#B9C7DD] hover:text-white",
                )}
              >
                {tr(...option.label)}
              </button>
            ))}
          </div>
        ) : (
          focus !== null &&
          slots[focus] && (
            <div aria-live="polite" className="ml-auto basis-full sm:basis-auto sm:w-full sm:flex sm:justify-end">
            <div className="rounded-xl bg-[#061230]/60 px-3 py-2 text-right">
              <span className="block font-mono text-[10.5px] tracking-[0.12em] text-[#7FD8E6] uppercase">
                {label(slots[focus], true)}
                {active === null && ` · ${bestWord}`}
              </span>
              <span className="block font-display text-[17px] font-bold text-white tabular-nums">
                {currency} {whole.format(totals[focus])}
              </span>
            </div>
            </div>
          )
        )}
      </div>

      {loading && !points && <div aria-hidden className="animate-pulse rounded-2xl bg-white/5" style={{ height: onGrain ? 220 : 170 }} />}
      {error && <ErrorState message={error.message} onRetry={onRetry} />}
      {points && (
        <RevenueChart
          points={points}
          grain={grain}
          currency={currency}
          height={onGrain ? 220 : 170}
          {...(onGrain ? {} : { active, onActive: setActive })}
        />
      )}
      {footer}
    </section>
  );
}
