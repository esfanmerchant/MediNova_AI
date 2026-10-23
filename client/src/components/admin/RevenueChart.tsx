"use client";

/**
 * Money paid over time, on the console's navy panel.
 *
 * Each bar is one period, stacked by whose business it was — consultations
 * below, medicine on top. The best period is named in the corner, because
 * "what was our best day" is the question this chart gets asked most; the
 * window's total sits above the chart rather than as a second line in it, so
 * the chart keeps one axis.
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

import { ErrorState, cx } from "@/components/ui";
import type { RevenueGrain, RevenuePoint } from "@/lib/api";
import { useTr } from "@/lib/lang";

/** How far back each grain looks. Kept in step with `_WINDOW` in api/app/modules/billing/revenue.py. */
const WINDOW_SLOTS: Record<RevenueGrain, number> = { day: 31, week: 13, month: 13 };

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

/** The smallest of 1, 2, 2.5 or 5 × 10ⁿ that is at least `raw`. */
function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / magnitude;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * magnitude;
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${+(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

const whole = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 });

export function RevenueChart({
  points,
  grain,
  currency,
}: {
  points: RevenuePoint[];
  grain: RevenueGrain;
  currency: string;
}) {
  const tr = useTr();
  const [active, setActive] = useState<number | null>(null);
  const slots = slotsFor(points, grain, new Date());

  const label = (slot: Slot, long = false) => {
    if (grain === "month") {
      return slot.start.toLocaleDateString("en-GB", { month: long ? "long" : "short", year: long ? "numeric" : "2-digit", timeZone: "UTC" });
    }
    const date = slot.start.toLocaleDateString("en-GB", {
      weekday: long && grain === "day" ? "short" : undefined,
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
    return grain === "week" && long ? tr(`Week of ${date}`, `${date} wala hafta`) : date;
  };

  if (!slots.some((slot) => slot.paid)) {
    return (
      <p className="py-16 text-center text-sm text-[#B9C7DD]">
        {tr("Nothing has been paid in this period yet.", "Is muddat mein abhi kuchh ada nahi hua.")}
      </p>
    );
  }

  const totals = slots.map((slot) => slot.visits + slot.medicine);
  const ceiling = niceStep(Math.max(...totals) / 3) * 3;
  const ticks = [3, 2, 1, 0].map((n) => (ceiling / 3) * n);
  const best = totals.indexOf(Math.max(...totals));

  const labelled = [0, Math.round((slots.length - 1) / 4), Math.round((slots.length - 1) / 2), Math.round(((slots.length - 1) * 3) / 4), slots.length - 1];
  const shown = active ?? best;
  const focus = slots[shown];

  return (
    <figure className="m-0">
      {/* Above the plot, not in it: inside, it would sit on the tallest bar
          whenever the best day is a recent one. */}
      <div className="mb-3 flex min-h-[4.25rem]">
        {focus && (
          <div className="ml-auto rounded-xl bg-[#061230]/60 px-3 py-2 text-right">
            <p className="font-mono text-[10.5px] tracking-[0.12em] text-[#7FD8E6] uppercase">
              {label(focus, true)}
              {active === null && ` · ${tr("best", "behtareen")}`}
            </p>
            <p className="font-display text-lg font-bold text-white tabular-nums">
              {currency} {whole.format(totals[shown])}
            </p>
            <p className="text-[11.5px] text-[#B9C7DD] tabular-nums">
              {tr("Visits", "Visits")} {whole.format(focus.visits)} · {tr("Medicine", "Dawa")} {whole.format(focus.medicine)} ·{" "}
              {focus.invoices} {tr(focus.invoices === 1 ? "invoice" : "invoices", "invoices")}
            </p>
          </div>
        )}
      </div>
      <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-2">
        <div aria-hidden className="relative h-56 font-mono text-[10.5px] text-[#8EA1C2]">
          {ticks.map((tick, index) => (
            <span key={tick} className="absolute right-0 -translate-y-1/2" style={{ top: `${(index / 3) * 100}%` }}>
              {compact(tick)}
            </span>
          ))}
        </div>

        <div className="relative h-56">
          {ticks.map((tick, index) => (
            <span
              key={tick}
              aria-hidden
              className={cx("absolute inset-x-0 border-t", index === 3 ? "border-white/25" : "border-dashed border-white/10")}
              style={{ top: `${(index / 3) * 100}%` }}
            />
          ))}

          <div className="absolute inset-0 flex items-end gap-[2px] sm:gap-1" onMouseLeave={() => setActive(null)}>
            {slots.map((slot, index) => {
              const total = totals[index];
              const height = total > 0 ? Math.max(1.5, (total / ceiling) * 100) : 0;
              return (
                <button
                  key={slot.key}
                  type="button"
                  aria-label={`${label(slot, true)}: ${currency} ${whole.format(total)}`}
                  onMouseEnter={() => setActive(index)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive((current) => (current === index ? null : current))}
                  className={cx(
                    "relative flex h-full flex-1 flex-col justify-end rounded-t-[4px] transition-opacity duration-150",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5EEAD4]",
                    active !== null && active !== index && "opacity-50",
                  )}
                >
                  <span
                    className="bar-grow flex w-full flex-col gap-[2px]"
                    style={{ height: `${height}%`, animationDelay: `${Math.min(index * 0.03, 0.9).toFixed(2)}s` }}
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
          </div>

        </div>

        <span aria-hidden />
        <div aria-hidden className="relative mt-2 h-4 text-[11px] text-[#8EA1C2]">
          {[...new Set(labelled)].map((index) => (
            <span
              key={index}
              className={cx(
                "absolute whitespace-nowrap",
                index === 0 ? "left-0" : index === slots.length - 1 ? "right-0" : "-translate-x-1/2",
              )}
              style={index === 0 || index === slots.length - 1 ? undefined : { left: `${((index + 0.5) / slots.length) * 100}%` }}
            >
              {index === slots.length - 1 ? tr(grain === "day" ? "Today" : "Now", grain === "day" ? "Aaj" : "Ab") : label(slots[index])}
            </span>
          ))}
        </div>
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
  /** Offers Daily, Weekly and Monthly when given. */
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
  const amount = (value: string) =>
    `${currency} ${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(Number(value) || 0)}`;
  return (
    <section
      aria-label={tr("Over time", "Waqt ke saath")}
      className={cx(
        "relative isolate overflow-hidden rounded-[28px] bg-[linear-gradient(150deg,#081A40_0%,#0A2558_55%,#0B3A73_100%)] p-5 text-[#DCE7F7] shadow-[0_30px_60px_-32px_rgba(8,22,51,0.85)] sm:p-7",
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(520px_260px_at_92%_8%,rgba(57,135,229,0.18),transparent_70%),radial-gradient(460px_240px_at_10%_110%,rgba(94,234,212,0.12),transparent_70%)]"
      />
      <div className="mb-5 flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <span className="mono-caps text-[0.7rem] text-[#7FD8E6]">
            {tr("Money paid", "Ada shuda raqam")} ·{" "}
            {tr(...GRAINS.find((option) => option.value === grain)!.window)}
          </span>
          <span className="font-display text-3xl font-bold text-white tabular-nums sm:text-[2.4rem]">
            {points
              ? amount(String(points.reduce((sum, point) => sum + (Number(point.handled) || 0), 0)))
              : "—"}
          </span>
        </div>
        <div className="flex flex-wrap gap-4 pb-1.5 text-[12.5px] text-[#B9C7DD]">
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-[#3987e5]" />
            {tr("Consultations", "Consultations")}
          </span>
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-[#199e70]" />
            {tr("Medicine", "Dawa")}
          </span>
        </div>
        {onGrain && (
          <div
            role="group"
            aria-label={tr("Period", "Muddat")}
            className="ml-auto inline-flex rounded-full border border-white/15 bg-white/5 p-1"
          >
            {GRAINS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={grain === option.value}
                onClick={() => onGrain(option.value)}
                className={cx(
                  "min-h-9 rounded-full px-3.5 text-xs font-bold transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5EEAD4]",
                  grain === option.value ? "bg-white text-[#0A2A72]" : "text-[#B9C7DD] hover:text-white",
                )}
              >
                {tr(...option.label)}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && !points && <div aria-hidden className="h-56 animate-pulse rounded-2xl bg-white/5" />}
      {error && <ErrorState message={error.message} onRetry={onRetry} />}
      {points && <RevenueChart points={points} grain={grain} currency={currency} />}
      {footer}
    </section>
  );
}
