"use client";

/**
 * One week of the hospital's appointments, a column a day.
 *
 * Days are the clinic's: each appointment is placed by the `localDate` the
 * server formats in the clinic's time zone, never by converting `startTime` in
 * the browser — an administrator abroad would otherwise see an evening visit
 * land on the wrong day. The columns themselves are counted from the browser's
 * today, which is the clinic's today for anyone working in the hospital.
 */

import { useState, type ReactNode } from "react";

import { Icon } from "@/components/Icon";
import { ConsoleCard, dayMonth } from "@/components/admin/console";
import { ErrorState, cx } from "@/components/ui";
import { appointments, type Appointment, type AppointmentStatus } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { PAGE_REFRESH_MS, useAsync } from "@/lib/useAsync";

/** How many visits a day shows before it offers the rest in the list below. */
const DAY_DEPTH = 4;

const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" arithmetic, done in UTC so no time zone can move a date. */
export function shift(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Today in the browser, as a date string. */
export function localToday(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString().slice(0, 10);
}

/** The Monday on or before a date. */
function mondayOf(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return shift(date, -((weekday + 6) % 7));
}

export type Kind = "done" | "booked" | "ask" | "off";

export const KIND: Record<AppointmentStatus, Kind> = {
  COMPLETED: "done",
  CONFIRMED: "booked",
  CHECKED_IN: "booked",
  IN_PROGRESS: "booked",
  REQUESTED: "ask",
  CANCELLED: "off",
  NO_SHOW: "off",
};

export const CHIP: Record<Kind, string> = {
  done: "border-l-stable bg-stable-soft",
  booked: "border-l-[#0B3FA8] bg-info-soft dark:border-l-[#7DA2FF]",
  ask: "border-l-[#F59E0B] bg-warning-soft",
  off: "border-l-[#9DB0CC] bg-sunken text-faint line-through decoration-faint/60",
};

export function AppointmentWeek({
  onPickDay,
  lead,
}: {
  onPickDay: (date: string) => void;
  /** Set in the card's header before the week's arrows — the page's view switch. */
  lead?: ReactNode;
}) {
  const tr = useTr();
  const today = localToday();
  const [offset, setOffset] = useState(0);
  const monday = shift(mondayOf(today), offset * 7);
  const sunday = shift(monday, 6);

  const week = useAsync(() => appointments.list({ from: monday, to: sunday, limit: 100 }), [monday], {
    refreshMs: PAGE_REFRESH_MS,
  });

  const byDay = new Map<string, Appointment[]>();
  for (const appointment of week.data?.data ?? []) {
    byDay.set(appointment.localDate, [...(byDay.get(appointment.localDate) ?? []), appointment]);
  }
  for (const list of byDay.values()) list.sort((a, b) => a.startTime.localeCompare(b.startTime));

  const days = Array.from({ length: 7 }, (_, index) => shift(monday, index));
  const fmt = (date: string, options: Intl.DateTimeFormatOptions) =>
    new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { ...options, timeZone: "UTC" });
  const live = (week.data?.data ?? []).filter((appointment) => KIND[appointment.status] !== "off");
  const truncated = (week.data?.meta.total ?? 0) > (week.data?.data.length ?? 0);
  // "19 – 25 Oct", or "28 Sep – 4 Oct" when the week crosses a month.
  const sameMonth = monday.slice(0, 7) === sunday.slice(0, 7);
  const title = sameMonth
    ? `${fmt(monday, { day: "numeric" })} – ${dayMonth(new Date(`${sunday}T00:00:00Z`), { utc: true })}`
    : `${dayMonth(new Date(`${monday}T00:00:00Z`), { utc: true })} – ${dayMonth(new Date(`${sunday}T00:00:00Z`), { utc: true })}`;
  const weekday = fmt(today, { weekday: "long" });

  return (
    <ConsoleCard
      icon="calendar_month"
      title={title}
      subtitle={
        week.data
          ? offset === 0
            ? tr(
                `${live.length} ${live.length === 1 ? "visit" : "visits"} this week${truncated ? " (first 100 shown)" : ""} · today is ${weekday}`,
                `Is hafte ${live.length} visits${truncated ? " (pehle 100)" : ""} · aaj ${weekday} hai`,
              )
            : tr(
                `${live.length} ${live.length === 1 ? "visit" : "visits"} that week${truncated ? " (first 100 shown)" : ""}`,
                `Us hafte ${live.length} visits${truncated ? " (pehle 100)" : ""}`,
              )
          : tr("Loading the week…", "Hafta load ho raha hai…")
      }
      action={
        <div className="flex flex-wrap items-center gap-1.5">
          {lead && <div className="mr-1.5">{lead}</div>}
          <button
            type="button"
            aria-label={tr("Previous week", "Pichhla hafta")}
            onClick={() => setOffset((value) => value - 1)}
            className="grid h-8 w-8 place-items-center rounded-full border border-line-strong bg-card text-strong hover:bg-sunken focus-visible:outline-2 focus-visible:outline-primary"
          >
            <Icon name="chevron_left" className="text-[16px]" />
          </button>
          {offset !== 0 && (
            <button
              type="button"
              onClick={() => setOffset(0)}
              className="h-8 rounded-full border border-line-strong bg-card px-[13px] text-[12.5px] font-semibold text-strong hover:bg-sunken focus-visible:outline-2 focus-visible:outline-primary"
            >
              {tr("This week", "Yeh hafta")}
            </button>
          )}
          <button
            type="button"
            aria-label={tr("Next week", "Agla hafta")}
            onClick={() => setOffset((value) => value + 1)}
            className="grid h-8 w-8 place-items-center rounded-full border border-line-strong bg-card text-strong hover:bg-sunken focus-visible:outline-2 focus-visible:outline-primary"
          >
            <Icon name="chevron_right" className="text-[16px]" />
          </button>
        </div>
      }
      footer={
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-muted">
          {(
            [
              ["done", tr("Done", "Mukammal")],
              ["booked", tr("Confirmed", "Confirm")],
              ["ask", tr("Needs a yes", "Haan chahiye")],
              ["off", tr("Cancelled or did not come", "Cancel ya nahi aaye")],
            ] as const
          ).map(([kind, text]) => (
            <span key={kind} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cx("h-2.5 w-2.5 rounded-[3px] border-l-[3px]", CHIP[kind])} />
              {text}
            </span>
          ))}
        </div>
      }
    >
      {week.error ? (
        <div className="px-[22px] pb-[18px]">
          <ErrorState message={week.error.message} onRetry={week.reload} />
        </div>
      ) : (
        <div className="overflow-x-auto px-[22px] pb-[18px]">
          <ol className="grid min-w-[860px] grid-cols-7 gap-2">
            {days.map((date) => {
              const visits = byDay.get(date) ?? [];
              const isToday = date === today;
              return (
                <li
                  key={date}
                  aria-label={fmt(date, { weekday: "long", day: "numeric", month: "long" })}
                  className={cx(
                    "flex min-h-[180px] flex-col gap-1.5 rounded-2xl p-2",
                    isToday
                      ? "bg-pastel-sky ring-1 ring-[#0B3FA8]/30 ring-inset dark:ring-[#7DA2FF]/30"
                      : "bg-[var(--console-soft,var(--surface-sunken))]",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onPickDay(date)}
                    className="flex items-baseline gap-1.5 rounded-lg px-1 py-0.5 text-left hover:bg-card/70 focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <span className={cx("text-[11px] font-bold tracking-[0.06em] uppercase", isToday ? "text-primary" : "text-faint")}>
                      {fmt(date, { weekday: "short" })}
                    </span>
                    <span className="font-display text-[15px] font-bold text-strong">{fmt(date, { day: "numeric" })}</span>
                    {visits.length > 0 && (
                      <span className="ml-auto text-[11px] font-semibold text-muted tabular-nums">{visits.length}</span>
                    )}
                  </button>
                  {week.loading && !week.data ? (
                    <span aria-hidden className="h-12 animate-pulse rounded-lg bg-card/70" />
                  ) : (
                    <>
                      {visits.slice(0, DAY_DEPTH).map((visit) => (
                        <button
                          key={visit.id}
                          type="button"
                          onClick={() => onPickDay(date)}
                          title={`${visit.localTime} · ${visit.patientName ?? ""} · ${visit.doctorName ?? ""}`}
                          className={cx(
                            "flex flex-col gap-px rounded-[9px] border-l-[3px] px-2 py-1.5 text-left transition-transform hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-primary",
                            CHIP[KIND[visit.status]],
                          )}
                        >
                          <span className="text-[11px] font-semibold tabular-nums">{visit.localTime}</span>
                          <span className={cx("truncate text-[12px] font-semibold", KIND[visit.status] !== "off" && "text-strong")}>
                            {visit.patientName}
                          </span>
                          <span className="truncate text-[11px] text-muted">{visit.doctorName}</span>
                        </button>
                      ))}
                      {visits.length > DAY_DEPTH && (
                        <button
                          type="button"
                          onClick={() => onPickDay(date)}
                          className="px-1 text-left text-[12px] font-semibold text-primary hover:underline"
                        >
                          {tr(`+ ${visits.length - DAY_DEPTH} more`, `+ ${visits.length - DAY_DEPTH} aur`)}
                        </button>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </ConsoleCard>
  );
}
