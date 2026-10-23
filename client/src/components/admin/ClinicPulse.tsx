"use client";

/**
 * One day of the clinic, a line per doctor.
 *
 * Each visit is a block at its clinic time, as long as it lasts, in the colour
 * of where it stands — done, booked, still needing a yes, or off. On today a
 * line marks the present, so "who is running late" is a glance, not a sum.
 *
 * Times come from the server's `localTime`, never from converting `startTime`
 * in the browser: the clinic's day is the one that matters, wherever the
 * administrator happens to be reading from.
 *
 * The overview shows today; the Appointments page's Day view shows any day.
 */

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { Icon } from "@/components/Icon";
import { CHIP, KIND, localToday, shift } from "@/components/admin/AppointmentWeek";
import { ConsoleCard } from "@/components/admin/console";
import { ErrorState, cx } from "@/components/ui";
import { appointments, type Appointment, type AppointmentMode } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { PAGE_REFRESH_MS, useAsync } from "@/lib/useAsync";

/** The day's frame when nothing is booked outside it. */
const OPEN_HOUR = 9;
const CLOSE_HOUR = 21;

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function initials(name: string | null): string {
  return (name ?? "?")
    .replace(/^Dr\.?\s+/i, "")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function ClinicPulse({
  date: initialDate,
  navigable = false,
  title,
  lead,
}: {
  /** "YYYY-MM-DD", clinic-local. Today when omitted. */
  date?: string;
  /** Offers previous and next day — the Appointments page's Day view. */
  navigable?: boolean;
  title?: string;
  /** Set first in the card's header — the Appointments page's view switch. */
  lead?: ReactNode;
}) {
  const tr = useTr();
  const today = localToday();
  const [date, setDate] = useState(initialDate ?? today);
  const [mode, setMode] = useState<AppointmentMode | "ALL">("ALL");

  const day = useAsync(() => appointments.list({ from: date, to: date, limit: 100 }), [date], {
    refreshMs: PAGE_REFRESH_MS,
  });

  const all = (day.data?.data ?? []).filter((visit) => visit.localDate === date);
  const visits = all.filter((visit) => mode === "ALL" || visit.mode === mode);

  // One lane per doctor, busiest first, so the eye starts where the day is.
  const lanes = new Map<string, { name: string | null; specialization: string | null; visits: Appointment[] }>();
  for (const visit of visits) {
    const lane = lanes.get(visit.doctorId) ?? { name: visit.doctorName, specialization: visit.specialization, visits: [] };
    lane.visits.push(visit);
    lanes.set(visit.doctorId, lane);
  }
  const ordered = [...lanes.values()].sort((a, b) => b.visits.length - a.visits.length);

  // The frame stretches to fit an early or late visit rather than hiding it.
  const starts = all.map((visit) => minutesOf(visit.localTime));
  const ends = all.map((visit) => minutesOf(visit.localTime) + visit.durationMinutes);
  const open = Math.min(OPEN_HOUR * 60, ...starts.map((minute) => Math.floor(minute / 60) * 60));
  const close = Math.max(CLOSE_HOUR * 60, ...ends.map((minute) => Math.ceil(minute / 60) * 60));
  const span = Math.max(60, close - open);
  const at = (minute: number) => `${((minute - open) / span) * 100}%`;
  // A mark every two hours over an ordinary day, every four over a long one,
  // so the labels never run into each other.
  const every = span > 14 * 60 ? 240 : 120;
  const hours = Array.from({ length: Math.floor(span / every) + 1 }, (_, index) => open + index * every).filter((minute) => minute <= close);

  const now = new Date();
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  const showNow = date === today && nowMinute >= open && nowMinute <= close;

  const label = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

  return (
    <ConsoleCard
      id="pulse"
      icon="monitor_heart"
      title={title ?? tr("Clinic pulse", "Clinic ki nabz")}
      subtitle={
        date === today
          ? tr("Today — every visit, by doctor.", "Aaj — har visit, doctor ke hisaab se.")
          : label
      }
      action={
        <div className="flex flex-wrap items-center gap-2">
          {lead}
          {navigable && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={tr("Previous day", "Pichhla din")}
                onClick={() => setDate((value) => shift(value, -1))}
                className="grid h-9 w-9 place-items-center rounded-full border border-line bg-card hover:bg-sunken focus-visible:outline-2 focus-visible:outline-primary"
              >
                <Icon name="chevron_left" className="text-[20px]" />
              </button>
              {date !== today && (
                <button
                  type="button"
                  onClick={() => setDate(today)}
                  className="h-9 rounded-full border border-line bg-card px-3 text-[13px] font-semibold hover:bg-sunken focus-visible:outline-2 focus-visible:outline-primary"
                >
                  {tr("Today", "Aaj")}
                </button>
              )}
              <button
                type="button"
                aria-label={tr("Next day", "Agla din")}
                onClick={() => setDate((value) => shift(value, 1))}
                className="grid h-9 w-9 place-items-center rounded-full border border-line bg-card hover:bg-sunken focus-visible:outline-2 focus-visible:outline-primary"
              >
                <Icon name="chevron_right" className="text-[20px]" />
              </button>
            </div>
          )}
          <div role="group" aria-label={tr("Visit type", "Visit ki qism")} className="inline-flex rounded-full bg-sunken p-1">
            {(
              [
                ["ALL", tr("All", "Sab")],
                ["CLINIC", tr("Clinic", "Clinic")],
                ["ONLINE", tr("Video", "Video")],
              ] as const
            ).map(([value, text]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
                className={cx(
                  "h-8 rounded-full px-3 text-[12.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-primary",
                  mode === value ? "bg-card text-strong shadow-sm" : "text-muted hover:text-strong",
                )}
              >
                {text}
              </button>
            ))}
          </div>
        </div>
      }
      footer={
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-muted">
          {(
            [
              ["done", tr("Done", "Mukammal")],
              ["booked", tr("Confirmed or with the doctor", "Confirm ya doctor ke paas")],
              ["ask", tr("Needs a yes", "Haan chahiye")],
              ["off", tr("Cancelled or did not come", "Cancel ya nahi aaye")],
            ] as const
          ).map(([kind, text]) => (
            <span key={kind} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cx("h-2.5 w-2.5 rounded-[3px] border-l-[3px]", CHIP[kind])} />
              {text}
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <Icon name="videocam" className="text-[14px]" />
            {tr("Video visit", "Video visit")}
          </span>
          {!navigable && (
            <Link href="/admin/appointments" className="ml-auto font-semibold text-primary hover:underline">
              {tr("Open appointments", "Appointments kholein")}
            </Link>
          )}
        </div>
      }
    >
      {day.error ? (
        <div className="px-5 pb-5">
          <ErrorState message={day.error.message} onRetry={day.reload} />
        </div>
      ) : day.loading && !day.data ? (
        <div aria-hidden className="mx-5 mb-5 h-48 animate-pulse rounded-2xl bg-sunken sm:mx-6" />
      ) : (
        <div className="flex flex-col gap-4 px-5 pb-5 sm:px-6">

          {ordered.length === 0 ? (
            <p className="rounded-2xl bg-sunken/60 px-4 py-8 text-center text-sm text-muted">
              {mode === "ALL"
                ? tr("No visits booked for this day.", "Is din koi visit booked nahi.")
                : tr("No visits of this kind on this day.", "Is din is qism ki koi visit nahi.")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <div className="grid min-w-[44rem] grid-cols-[11rem_minmax(0,1fr)] gap-x-3 gap-y-2">
                <span aria-hidden />
                <div aria-hidden className="relative h-5 text-[11px] text-faint tabular-nums">
                  {hours.map((minute, index) => (
                    <span
                      key={minute}
                      className={cx(
                        "absolute",
                        // The ends sit inside the lane rather than hanging off it.
                        index === 0 ? "" : minute === close ? "-translate-x-full" : "-translate-x-1/2",
                      )}
                      style={{ left: at(minute) }}
                    >
                      {String(Math.floor(minute / 60) % 24).padStart(2, "0")}:00
                    </span>
                  ))}
                </div>
                {ordered.map((lane) => (
                  <div key={lane.name ?? lane.visits[0].doctorId} className="contents">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        aria-hidden
                        className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-sunken text-[12px] font-bold text-primary"
                      >
                        {initials(lane.name)}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-[13px] font-semibold text-strong">{lane.name}</span>
                        <span className="truncate text-[11.5px] text-muted">
                          {lane.specialization} · {lane.visits.length}
                        </span>
                      </span>
                    </div>
                    <div className="relative h-11 rounded-xl bg-sunken/60">
                      {hours.map((minute) => (
                        <span key={minute} aria-hidden className="absolute inset-y-0 border-l border-line/70" style={{ left: at(minute) }} />
                      ))}
                      {lane.visits.map((visit) => {
                        const start = minutesOf(visit.localTime);
                        return (
                          <Link
                            key={visit.id}
                            href="/admin/appointments"
                            aria-label={`${visit.localTime} · ${visit.patientName ?? ""} · ${lane.name ?? ""}`}
                            title={`${visit.localTime} · ${visit.patientName ?? ""}`}
                            className={cx(
                              "bar-grow-x absolute inset-y-1 flex min-w-[1.75rem] items-center gap-1 overflow-hidden rounded-lg border-l-[3px] px-1.5 text-[11px] font-semibold whitespace-nowrap text-strong",
                              "focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-primary",
                              CHIP[KIND[visit.status]],
                            )}
                            style={{ left: at(start), width: `${(visit.durationMinutes / span) * 100}%` }}
                          >
                            {visit.mode === "ONLINE" && <Icon name="videocam" className="text-[13px]" />}
                            <span className="truncate">{visit.patientName?.split(" ")[0]}</span>
                          </Link>
                        );
                      })}
                      {showNow && (
                        <span aria-hidden className="absolute inset-y-[-4px] w-0.5 rounded-full bg-critical" style={{ left: at(nowMinute) }} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(day.data?.meta.total ?? 0) > (day.data?.data.length ?? 0) && (
            <p className="text-[12px] text-muted">
              {tr("Showing the first 100 visits of this day.", "Is din ki pehli 100 visits dikh rahi hain.")}
            </p>
          )}
        </div>
      )}
    </ConsoleCard>
  );
}
