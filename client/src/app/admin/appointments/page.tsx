"use client";

/**
 * Hospital-wide appointment oversight.
 *
 * An administrator schedules and unblocks — they confirm bookings, cancel on a
 * patient's behalf and mark absences. What they cannot do is complete a
 * consultation: that is a clinical act, and the permission catalogue withholds
 * it from admins on purpose (R2). The buttons below reflect that rather than
 * offering an action the server would refuse.
 */

import { useCallback, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { AppointmentRow } from "@/components/appointments";
import { AppointmentWeek, localToday } from "@/components/admin/AppointmentWeek";
import { ClinicPulse } from "@/components/admin/ClinicPulse";
import { ConsoleHeader, ConsoleLoading, FinishedState, PastelRow, PastelTile } from "@/components/admin/console";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  SkeletonRows,
  cx,
} from "@/components/ui";
import {
  ApiError,
  appointments,
  type Appointment,
  type AppointmentStatus,
} from "@/lib/api";
import { DATE_BOUNDS } from "@/lib/dates";
import { useTr } from "@/lib/lang";
import { useAsync, PAGE_REFRESH_MS } from "@/lib/useAsync";

const FILTERS: Array<{
  label: [string, string];
  icon: string;
  status?: AppointmentStatus;
  upcomingOnly?: boolean;
}> = [
  { label: ["Upcoming", "Aane wali"], icon: "event_upcoming", upcomingOnly: true },
  { label: ["Awaiting confirmation", "Confirm baqi"], icon: "hourglass_top", status: "REQUESTED" },
  { label: ["Confirmed", "Confirm shuda"], icon: "check_circle", status: "CONFIRMED" },
  { label: ["Completed", "Mukammal"], icon: "task_alt", status: "COMPLETED" },
  { label: ["Cancelled", "Mansookh"], icon: "cancel", status: "CANCELLED" },
  { label: ["Did not attend", "Nahi aaye"], icon: "person_off", status: "NO_SHOW" },
  { label: ["All", "Sab"], icon: "list" },
];

/** Picking a day on the week shows everything that day, past or not. */
const ALL_INDEX = FILTERS.length - 1;

export default function AdminAppointments() {
  const tr = useTr();
  const [active, setActive] = useState(0);
  const [day, setDay] = useState("");
  const [view, setView] = useState<"week" | "day">("week");
  const [refresh, setRefresh] = useState(0);
  const reloadAll = useCallback(() => setRefresh((n) => n + 1), []);

  const filter = FILTERS[active];
  const list = useAsync(
    () =>
      appointments.list({
        status: filter.status,
        upcomingOnly: filter.upcomingOnly,
        from: day || undefined,
        to: day || undefined,
        limit: 100,
      }),
    [active, day, refresh],
    { refreshMs: PAGE_REFRESH_MS },
  );
  // The header's sentence and the tiles. Counts come from one-row reads, so
  // they are the server's totals and never a page's worth; today and this week
  // are small enough to read whole.
  const tally = useAsync(
    () => {
      const today = localToday();
      const monthAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
      const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
      const monday = new Date(Date.parse(`${today}T00:00:00Z`) - ((weekday + 6) % 7) * 86_400_000);
      const sunday = new Date(monday.getTime() + 6 * 86_400_000);
      return Promise.all([
        appointments.list({ upcomingOnly: true, limit: 1 }),
        appointments.list({ status: "REQUESTED", limit: 1 }),
        appointments.list({ from: today, to: today, limit: 100 }),
        appointments.list({ from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10), limit: 100 }),
        appointments.list({ status: "NO_SHOW", from: monthAgo, to: today, limit: 1 }),
        appointments.list({ status: "COMPLETED", from: monthAgo, to: today, limit: 1 }),
      ]).then(([upcoming, requested, todays, week, noShows, completed]) => {
        const held = (rows: Appointment[]) => rows.filter((row) => row.status !== "CANCELLED");
        const thisWeek = held(week.data);
        return {
          upcoming: upcoming.meta.total,
          requested: requested.meta.total,
          today: held(todays.data).length,
          todayDone: todays.data.filter((row) => row.status === "COMPLETED").length,
          todayToCome: todays.data.filter((row) => ["REQUESTED", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS"].includes(row.status)).length,
          week: thisWeek.length,
          video: thisWeek.filter((row) => row.mode === "ONLINE").length,
          noShows: noShows.meta.total,
          attended: completed.meta.total,
        };
      });
    },
    [refresh],
    { refreshMs: PAGE_REFRESH_MS },
  );
  const awaitingIndex = FILTERS.findIndex((option) => option.status === "REQUESTED");
  const showList = (index: number) => {
    setActive(index);
    document.getElementById("list")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const stats = tally.data;
  const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : "—");

  return (
    <AppShell role="ADMIN">
      <div id="main">
        <ConsoleHeader
          icon="calendar_month"
          eyebrow={tr("Every booking in the hospital", "Hospital ki har booking")}
          title={tr("Appointments", "Appointments")}
        >
          {tally.data ? (
            <p>
              <b>
                {tally.data.upcoming} {tr(tally.data.upcoming === 1 ? "visit" : "visits", "visits")}
              </b>{" "}
              {tr("still to come.", "abhi baqi hain.")}{" "}
              {tally.data.requested > 0 ? (
                <>
                  <a
                    href="#list"
                    onClick={(event) => {
                      event.preventDefault();
                      showList(awaitingIndex);
                    }}
                  >
                    {tr(
                      `${tally.data.requested} still ${tally.data.requested === 1 ? "needs" : "need"} a yes`,
                      `${tally.data.requested} ko abhi haan chahiye`,
                    )}
                  </a>
                  .
                </>
              ) : (
                tr("Every request has an answer.", "Har darkhwast ka jawab ho chuka.")
              )}
            </p>
          ) : (
            <p>{tr("Confirm, cancel or mark who did not come.", "Confirm, cancel, ya jo nahi aaya usay mark karein.")}</p>
          )}
        </ConsoleHeader>

        {!stats && tally.loading && (
          <div className="mt-6">
            <ConsoleLoading rows={0} />
          </div>
        )}
        {stats && (
          <PastelRow className="mt-6">
            <PastelTile
              pastel="mint"
              icon="today"
              label={tr("Today", "Aaj")}
              value={tr(`${stats.today} ${stats.today === 1 ? "visit" : "visits"}`, `${stats.today} visits`)}
              note={tr(`${stats.todayDone} done · ${stats.todayToCome} still to come`, `${stats.todayDone} mukammal · ${stats.todayToCome} baqi`)}
            />
            <PastelTile
              pastel="butter"
              icon="hourglass_top"
              label={tr("Need a yes", "Haan chahiye")}
              value={stats.requested}
              note={tr("Asked for by patients, not yet confirmed", "Mareezon ne manga, abhi confirm nahi")}
              chip={stats.requested > 0 ? { text: tr("Waiting", "Muntazir"), tone: "warning" } : undefined}
            />
            <PastelTile
              pastel="sky"
              icon="videocam"
              label={tr("Video consults", "Video consults")}
              value={stats.video}
              note={tr(
                `This week · ${percent(stats.video, stats.week)} of visits`,
                `Is hafte · ${percent(stats.video, stats.week)} visits`,
              )}
            />
            <PastelTile
              pastel="lilac"
              icon="person_off"
              label={tr("No-show rate", "Na aane ki sharah")}
              value={percent(stats.noShows, stats.noShows + stats.attended)}
              note={tr(
                `30 days · ${stats.noShows} of ${stats.noShows + stats.attended} did not come`,
                `30 din · ${stats.noShows + stats.attended} mein se ${stats.noShows} nahi aaye`,
              )}
            />
          </PastelRow>
        )}

        <div className="mt-6 flex flex-col gap-3">
          <div role="group" aria-label={tr("Calendar view", "Calendar ka view")} className="inline-flex self-start rounded-full bg-sunken p-1">
            {(
              [
                ["week", tr("Week", "Hafta")],
                ["day", tr("Day, by doctor", "Din, doctor ke hisaab se")],
              ] as const
            ).map(([value, text]) => (
              <button
                key={value}
                type="button"
                aria-pressed={view === value}
                onClick={() => setView(value)}
                className={cx(
                  "h-9 rounded-full px-4 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-primary",
                  view === value ? "bg-card text-strong shadow-sm" : "text-muted hover:text-strong",
                )}
              >
                {text}
              </button>
            ))}
          </div>
          {view === "week" ? (
            <AppointmentWeek
              onPickDay={(date) => {
                setDay(date);
                showList(ALL_INDEX);
              }}
            />
          ) : (
            <ClinicPulse navigable title={tr("The day, by doctor", "Din, doctor ke hisaab se")} />
          )}
        </div>

        <div
          role="tablist"
          aria-label={tr("Filter appointments", "Appointments chhantein")}
          className="no-scrollbar -mx-4 mt-6 flex gap-1 overflow-x-auto px-4"
        >
          <div className="inline-flex shrink-0 gap-1 rounded-2xl border border-line bg-sunken p-1">
            {FILTERS.map((option, index) => {
              const selected = index === active;
              return (
                <button
                  key={option.label[0]}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActive(index)}
                  className={cx(
                    "inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 text-sm font-semibold transition-[background-color,color,box-shadow,transform] duration-200 ease-out",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                    selected
                      ? "bg-gradient-brand text-white shadow-sm"
                      : "text-muted hover:bg-card hover:text-strong hover:shadow-sm",
                  )}
                >
                  <Icon name={option.icon} filled={selected} className="text-[18px]" />
                  {tr(...option.label)}
                </button>
              );
            })}
          </div>
        </div>

        <div id="list" className="mt-6 scroll-mt-24">
          {list.loading && (
            <div role="status" aria-live="polite">
              <span className="sr-only">{tr("Loading appointments…", "Appointments load ho rahi hain…")}</span>
              <SkeletonRows rows={4} />
            </div>
          )}
          {list.error && <ErrorState message={list.error.message} onRetry={list.reload} />}

          {list.data && (
            <Card
              icon={filter.icon}
              title={tr(...filter.label)}
              description={tr(
                `${list.data.meta.total} appointment${list.data.meta.total === 1 ? "" : "s"}`,
                `${list.data.meta.total} appointments`,
              )}
              action={
                // The day sits with the list it narrows, not on a row of its own.
                <div className="flex items-center gap-2">
                  <label htmlFor="day" className="sr-only">
                    {tr("On a specific day", "Kisi khaas din")}
                  </label>
                  <Input
                    id="day"
                    type="date"
                    // Without these a browser accepts a six-digit year.
                    min={DATE_BOUNDS.min}
                    max={DATE_BOUNDS.max}
                    value={day}
                    onChange={(event) => setDay(event.target.value)}
                    className="!min-h-10 w-44"
                  />
                  {day && (
                    <Button variant="ghost" className="!min-h-9 px-3 text-sm" onClick={() => setDay("")}>
                      <Icon name="close" className="text-[18px]" />
                      {tr("Clear day", "Din hatayein")}
                    </Button>
                  )}
                </div>
              }
            >
              {list.data.data.length === 0 && filter.status === "REQUESTED" && !day ? (
                <FinishedState
                  title={tr("Every request has an answer", "Har darkhwast ka jawab ho chuka")}
                  description={tr(
                    "New bookings that need confirming will appear here.",
                    "Nayi bookings jinhein confirm karna ho, yahan aayengi.",
                  )}
                />
              ) : list.data.data.length === 0 ? (
                <EmptyState
                  icon="event_busy"
                  title={tr("Nothing matches that filter", "Is filter par kuchh nahi")}
                  description={tr(
                    "Try another status, or clear the day to see every booking.",
                    "Koi aur haalat chunein, ya din hata kar saari bookings dekhein.",
                  )}
                />
              ) : (
                <ul className="stagger divide-y divide-line">
                  {list.data.data.map((appointment) => (
                    <AdminRow
                      key={appointment.id}
                      appointment={appointment}
                      onChanged={reloadAll}
                    />
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function AdminRow({
  appointment,
  onChanged,
}: {
  appointment: Appointment;
  onChanged: () => void;
}) {
  const tr = useTr();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : tr("Could not update the appointment.", "Appointment update nahi ho saki."));
      setBusy(false);
    }
  };

  const canConfirm = appointment.status === "REQUESTED";
  const canCancel = ["REQUESTED", "CONFIRMED", "CHECKED_IN"].includes(appointment.status);

  return (
    <>
      <AppointmentRow
        appointment={appointment}
        counterparty={appointment.patientName ?? tr("Patient", "Mareez")}
        detail={
          appointment.doctorName
            ? `${appointment.doctorName}${appointment.specialization ? ` · ${appointment.specialization}` : ""}`
            : appointment.medicalRecordNumber
        }
        actions={
          <>
            {canConfirm && (
              <Button
                disabled={busy}
                loading={busy}
                onClick={() =>
                  void run(() => appointments.setStatus(appointment.id, "CONFIRMED"))
                }
              >
                <Icon name="check" className="text-[20px]" />
                {tr("Confirm", "Confirm")}
              </Button>
            )}
            {canCancel && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    appointments.cancel(appointment.id, "Cancelled by the hospital"),
                  )
                }
              >
                {tr("Cancel", "Cancel")}
              </Button>
            )}
          </>
        }
      />
      {error && (
        <p role="alert" className="pop-in flex items-center gap-1.5 pb-3 text-sm font-medium text-critical">
          <Icon name="error" className="text-[16px]" />
          {error}
        </p>
      )}
    </>
  );
}
