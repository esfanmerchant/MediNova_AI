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
import { AppointmentWeek, localToday } from "@/components/admin/AppointmentWeek";
import { ClinicPulse } from "@/components/admin/ClinicPulse";
import {
  ConsoleHeader,
  ConsoleLoading,
  FinishedState,
  Pager,
  PastelRow,
  PastelTile,
  StatusPill,
  type PillTone,
} from "@/components/admin/console";
import { Segmented } from "@/components/forms";
import { Button, EmptyState, ErrorState, SkeletonRows, cx } from "@/components/ui";
import { ApiError, appointments, type Appointment, type AppointmentStatus } from "@/lib/api";
import { DATE_BOUNDS } from "@/lib/dates";
import { useTr } from "@/lib/lang";
import { useAsync, PAGE_REFRESH_MS } from "@/lib/useAsync";

type FilterKey = "upcoming" | "asking" | "confirmed" | "completed" | "cancelled" | "missed" | "all";

const FILTERS: Array<{
  key: FilterKey;
  label: [string, string];
  status?: AppointmentStatus;
  upcomingOnly?: boolean;
}> = [
  { key: "upcoming", label: ["Upcoming", "Aane wali"], upcomingOnly: true },
  { key: "asking", label: ["Need a yes", "Haan chahiye"], status: "REQUESTED" },
  { key: "confirmed", label: ["Confirmed", "Confirm shuda"], status: "CONFIRMED" },
  { key: "completed", label: ["Completed", "Mukammal"], status: "COMPLETED" },
  { key: "cancelled", label: ["Cancelled", "Mansookh"], status: "CANCELLED" },
  { key: "missed", label: ["Did not come", "Nahi aaye"], status: "NO_SHOW" },
  { key: "all", label: ["All", "Sab"] },
];

/** Twenty to a page: a day's list, with room for the busy ones. */
const PAGE = 20;

const STATUS: Record<AppointmentStatus, { tone: PillTone; label: [string, string] }> = {
  REQUESTED: { tone: "warning", label: ["Needs a yes", "Haan chahiye"] },
  CONFIRMED: { tone: "info", label: ["Confirmed", "Confirm shuda"] },
  CHECKED_IN: { tone: "info", label: ["Checked in", "Pohanch gaye"] },
  IN_PROGRESS: { tone: "info", label: ["With the doctor", "Doctor ke paas"] },
  COMPLETED: { tone: "good", label: ["Completed", "Mukammal"] },
  CANCELLED: { tone: "neutral", label: ["Cancelled", "Mansookh"] },
  NO_SHOW: { tone: "critical", label: ["Did not come", "Nahi aaye"] },
};

/** "Fri 23 Oct", from the clinic's own date — never moved by the browser's zone. */
function clinicDay(date: string): string {
  return new Date(`${date}T00:00:00Z`)
    .toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .replace(",", "");
}

/** "14:00" as "2:00 PM". */
function clock(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}

export default function AdminAppointments() {
  const tr = useTr();
  const [filterKey, setFilterKey] = useState<FilterKey>("upcoming");
  const [day, setDay] = useState("");
  const [view, setView] = useState<"week" | "day">("week");
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const reloadAll = useCallback(() => setRefresh((n) => n + 1), []);

  const filter = FILTERS.find((option) => option.key === filterKey) ?? FILTERS[0];
  const list = useAsync(
    () =>
      appointments.list({
        status: filter.status,
        upcomingOnly: filter.upcomingOnly,
        from: day || undefined,
        to: day || undefined,
        limit: PAGE,
        offset,
      }),
    [filterKey, day, offset, refresh],
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
  const showList = (key: FilterKey) => {
    setFilterKey(key);
    setOffset(0);
    document.getElementById("list")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const stats = tally.data;
  const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : "—");

  // The calendar's own switch, carried into whichever card is showing.
  const views = (
    <Segmented
      options={[
        { value: "week" as const, label: tr("Week", "Hafta") },
        { value: "day" as const, label: tr("Day, by doctor", "Din, doctor ke hisaab se") },
      ]}
      value={view}
      onChange={setView}
      label={tr("Calendar view", "Calendar ka view")}
    />
  );

  const rows = list.data?.data ?? [];

  return (
    <AppShell role="ADMIN">
      <div id="main">
        <ConsoleHeader
          mark="appointments"
          eyebrow={tr("Every booking in the hospital", "Hospital ki har booking")}
          title={tr("Appointments", "Appointments")}
        >
          {stats ? (
            <p>
              <b>
                {stats.upcoming} {tr(stats.upcoming === 1 ? "visit" : "visits", "visits")}
              </b>{" "}
              {tr("still to come.", "abhi baqi hain.")}{" "}
              {stats.requested > 0 ? (
                <>
                  <a
                    href="#list"
                    onClick={(event) => {
                      event.preventDefault();
                      showList("asking");
                    }}
                  >
                    {tr(
                      `${stats.requested} still ${stats.requested === 1 ? "needs" : "need"} a yes`,
                      `${stats.requested} ko abhi haan chahiye`,
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
          <div className="mt-[22px]">
            <ConsoleLoading rows={0} />
          </div>
        )}
        {stats && (
          <PastelRow className="mt-[22px]">
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
              label={tr("Video visits", "Video visits")}
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

        <div className="mt-[22px]">
          {view === "week" ? (
            <AppointmentWeek
              lead={views}
              onPickDay={(date) => {
                setDay(date);
                showList("all");
              }}
            />
          ) : (
            <ClinicPulse navigable lead={views} />
          )}
        </div>

        <section
          id="list"
          aria-label={tr("Appointments", "Appointments")}
          className="mt-[22px] scroll-mt-24 overflow-hidden rounded-3xl border border-line bg-card shadow-card"
        >
          <div className="flex flex-wrap items-center gap-3 px-[18px] py-4">
            <Segmented
              options={FILTERS.map((option) => ({
                value: option.key,
                label: tr(...option.label),
                count:
                  option.key === "upcoming" ? stats?.upcoming : option.key === "asking" ? stats?.requested : undefined,
              }))}
              value={filterKey}
              onChange={(next) => {
                setFilterKey(next);
                setOffset(0);
              }}
              label={tr("Filter appointments", "Appointments chhantein")}
            />
            {/* The day sits with the list it narrows, not on a row of its own. */}
            <div className="flex items-center gap-2 sm:ml-auto">
              <label htmlFor="day" className="text-[13px] font-semibold text-muted">
                {tr("On a day", "Kisi din")}
              </label>
              <input
                id="day"
                type="date"
                // Without these a browser accepts a six-digit year.
                min={DATE_BOUNDS.min}
                max={DATE_BOUNDS.max}
                value={day}
                onChange={(event) => {
                  setDay(event.target.value);
                  setOffset(0);
                }}
                className="h-10 w-[170px] rounded-xl border border-line-strong bg-card px-3 text-[14px] text-strong focus-visible:outline-2 focus-visible:outline-primary"
              />
              {day && (
                <button
                  type="button"
                  aria-label={tr("Clear the day", "Din hatayein")}
                  onClick={() => {
                    setDay("");
                    setOffset(0);
                  }}
                  className="grid h-8 w-8 place-items-center rounded-full border border-line-strong bg-card text-strong hover:bg-sunken focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <Icon name="close" className="text-[17px]" />
                </button>
              )}
            </div>
          </div>

          {list.loading && !list.data && (
            <div role="status" aria-live="polite" className="px-[18px] pb-5">
              <span className="sr-only">{tr("Loading appointments…", "Appointments load ho rahi hain…")}</span>
              <SkeletonRows rows={4} title={false} />
            </div>
          )}
          {list.error && (
            <div className="px-[18px] pb-5">
              <ErrorState message={list.error.message} onRetry={list.reload} />
            </div>
          )}

          {list.data && rows.length === 0 && filter.status === "REQUESTED" && !day ? (
            <FinishedState
              title={tr("Every request has an answer", "Har darkhwast ka jawab ho chuka")}
              description={tr(
                "New bookings that need confirming will appear here.",
                "Nayi bookings jinhein confirm karna ho, yahan aayengi.",
              )}
            />
          ) : list.data && rows.length === 0 ? (
            <EmptyState
              icon="event_busy"
              title={tr("Nothing matches that filter", "Is filter par kuchh nahi")}
              description={tr(
                "Try another status, or clear the day to see every booking.",
                "Koi aur haalat chunein, ya din hata kar saari bookings dekhein.",
              )}
            />
          ) : null}

          {rows.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="console-table min-w-[56rem]">
                  <thead>
                    <tr>
                      <th scope="col">{tr("When", "Kab")}</th>
                      <th scope="col">{tr("Patient", "Mareez")}</th>
                      <th scope="col">{tr("Doctor", "Doctor")}</th>
                      <th scope="col">{tr("Type", "Qism")}</th>
                      <th scope="col">{tr("Status", "Haalat")}</th>
                      <th scope="col" className="text-right">
                        <span className="sr-only">{tr("Actions", "Actions")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((appointment) => (
                      <AdminRow key={appointment.id} appointment={appointment} onChanged={reloadAll} />
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager offset={offset} limit={PAGE} total={list.data?.meta.total ?? rows.length} onChange={setOffset} />
            </>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function AdminRow({ appointment, onChanged }: { appointment: Appointment; onChanged: () => void }) {
  const tr = useTr();
  const [busy, setBusy] = useState<"confirm" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (which: "confirm" | "cancel", action: () => Promise<unknown>) => {
    setBusy(which);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : tr("Could not update the appointment.", "Appointment update nahi ho saki."));
      setBusy(null);
    }
  };

  const canConfirm = appointment.status === "REQUESTED";
  const canCancel = ["REQUESTED", "CONFIRMED", "CHECKED_IN"].includes(appointment.status);
  const status = STATUS[appointment.status];
  const video = appointment.mode === "ONLINE";

  return (
    <tr>
      <td className="whitespace-nowrap tabular-nums">
        <b className="font-semibold">{clinicDay(appointment.localDate)}</b>
        <span className="text-muted"> · {clock(appointment.localTime)}</span>
      </td>
      <td>
        <span className="block font-semibold">{appointment.patientName ?? tr("Patient", "Mareez")}</span>
        {appointment.medicalRecordNumber && (
          <span className="block font-mono text-[12.5px] text-muted">{appointment.medicalRecordNumber}</span>
        )}
      </td>
      <td>
        <span className="block font-semibold">{appointment.doctorName ?? "—"}</span>
        {appointment.specialization && <span className="block text-[12.5px] text-muted">{appointment.specialization}</span>}
      </td>
      <td>
        <StatusPill icon={video ? "videocam" : "location_on"}>{video ? tr("Video", "Video") : tr("Clinic", "Clinic")}</StatusPill>
      </td>
      <td>
        <StatusPill dot tone={status.tone}>
          {tr(...status.label)}
        </StatusPill>
        {error && (
          <span role="alert" className="mt-1 flex items-center gap-1 text-[12.5px] font-medium text-critical">
            <Icon name="error" className="text-[14px]" />
            {error}
          </span>
        )}
      </td>
      <td className="text-right whitespace-nowrap">
        <span className={cx("inline-flex items-center gap-1", !canConfirm && !canCancel && "hidden")}>
          {canConfirm && (
            <Button
              size="sm"
              disabled={busy !== null}
              loading={busy === "confirm"}
              onClick={() => void run("confirm", () => appointments.setStatus(appointment.id, "CONFIRMED"))}
            >
              <Icon name="check" className="text-[16px]" />
              {tr("Confirm", "Confirm")}
            </Button>
          )}
          {canCancel && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              loading={busy === "cancel"}
              onClick={() => void run("cancel", () => appointments.cancel(appointment.id, "Cancelled by the hospital"))}
            >
              {tr("Cancel", "Cancel")}
            </Button>
          )}
        </span>
      </td>
    </tr>
  );
}
