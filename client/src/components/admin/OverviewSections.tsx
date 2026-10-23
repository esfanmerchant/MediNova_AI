"use client";

/**
 * The overview's lower half: the week by speciality, who is busiest, and the
 * pharmacy's pipeline. Each is a summary with a door to the page that owns it.
 */

import Link from "next/link";

import { Icon } from "@/components/Icon";
import { localToday, shift } from "@/components/admin/AppointmentWeek";
import { ConsoleCard } from "@/components/admin/console";
import { ErrorState, cx } from "@/components/ui";
import { appointments, pharmacy, type OrderStatus } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { PAGE_REFRESH_MS, useAsync } from "@/lib/useAsync";

/**
 * One step of a single blue ramp per band — magnitude, so one hue, light to
 * dark; text flips to white where the ground is dark enough to need it.
 */
function heat(count: number): string {
  if (count === 0) return "bg-sunken/60 text-faint";
  if (count === 1) return "bg-[#D4E6FA] text-[#0B1630] dark:bg-[#132E52] dark:text-[#EAF1FB]";
  if (count <= 3) return "bg-[#7DB3EC] text-[#0B1630] dark:bg-[#1E4F8F] dark:text-white";
  return "bg-[#1462C4] text-white dark:bg-[#4A86D8]";
}

export function WeekBySpeciality() {
  const tr = useTr();
  const today = localToday();
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const monday = shift(today, -((weekday + 6) % 7));
  const days = Array.from({ length: 7 }, (_, index) => shift(monday, index));
  const week = useAsync(() => appointments.list({ from: monday, to: days[6], limit: 100 }), [monday], {
    refreshMs: PAGE_REFRESH_MS,
  });

  const held = (week.data?.data ?? []).filter((visit) => visit.status !== "CANCELLED");
  const specialities = [...new Set(held.map((visit) => visit.specialization ?? tr("Other", "Deegar")))].sort();
  const cell = (speciality: string, date: string) =>
    held.filter((visit) => (visit.specialization ?? tr("Other", "Deegar")) === speciality && visit.localDate === date).length;
  const done = held.filter((visit) => visit.status === "COMPLETED").length;
  const asking = held.filter((visit) => visit.status === "REQUESTED").length;
  const fmt = (date: string, options: Intl.DateTimeFormatOptions) =>
    new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { ...options, timeZone: "UTC" });

  return (
    <ConsoleCard
      icon="grid_view"
      title={tr("This week, by speciality", "Is hafte, speciality ke hisaab se")}
      subtitle={
        week.data
          ? tr(
              `${held.length} visits · ${done} done · ${asking} still need a yes`,
              `${held.length} visits · ${done} mukammal · ${asking} ko haan chahiye`,
            )
          : undefined
      }
      footer={
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-muted">
          {(
            [
              [4, "4+"],
              [2, "2–3"],
              [1, "1"],
              [0, tr("None", "Koi nahi")],
            ] as const
          ).map(([count, text]) => (
            <span key={text} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cx("h-3 w-4 rounded-[4px]", heat(count))} />
              {text}
            </span>
          ))}
        </div>
      }
    >
      {week.error ? (
        <div className="px-5 pb-5">
          <ErrorState message={week.error.message} onRetry={week.reload} />
        </div>
      ) : specialities.length === 0 ? (
        <p className="px-5 pb-6 text-sm text-muted sm:px-6">
          {week.data ? tr("No visits booked this week yet.", "Is hafte abhi koi visit booked nahi.") : tr("Loading…", "Load ho raha hai…")}
        </p>
      ) : (
        <div className="overflow-x-auto px-5 pb-5 sm:px-6">
          <table className="w-full min-w-[34rem] border-separate border-spacing-1 text-center text-[12.5px]">
            <caption className="sr-only">
              {tr("Visits per speciality per day this week", "Is hafte har din har speciality ki visits")}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="sr-only">
                  {tr("Speciality", "Speciality")}
                </th>
                {days.map((date) => (
                  <th
                    key={date}
                    scope="col"
                    className={cx("pb-1 text-[11px] font-semibold", date === today ? "text-primary" : "text-faint")}
                  >
                    {fmt(date, { weekday: "short" })} {fmt(date, { day: "numeric" })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {specialities.map((speciality) => (
                <tr key={speciality}>
                  <th scope="row" className="pr-2 text-left text-[12.5px] font-semibold whitespace-nowrap text-strong">
                    {speciality}
                  </th>
                  {days.map((date) => {
                    const count = cell(speciality, date);
                    return (
                      <td key={date} className={cx("h-9 rounded-lg font-semibold tabular-nums", heat(count))}>
                        {count > 0 ? count : <span className="sr-only">0</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ConsoleCard>
  );
}

export function BusiestDoctors({
  doctors,
}: {
  doctors: Array<{ doctorId: string; name: string; specialization: string; visits: number }>;
}) {
  const tr = useTr();
  const top = Math.max(1, ...doctors.map((doctor) => doctor.visits));
  return (
    <ConsoleCard
      icon="stethoscope"
      title={tr("Busiest doctors", "Sab se masroof doctors")}
      subtitle={tr("Visits seen in the last 30 days", "Pichhle 30 din mein dekhi gayi visits")}
      footer={
        <Link href="/admin/users" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
          {tr("Everybody on the platform", "Platform par sab log")}
          <Icon name="arrow_forward" className="text-[16px]" />
        </Link>
      }
    >
      {doctors.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted sm:px-6">
          {tr("No visits completed in the last 30 days.", "Pichhle 30 din mein koi visit mukammal nahi hui.")}
        </p>
      ) : (
        <ol className="flex flex-col gap-3 px-5 pb-5 sm:px-6">
          {doctors.map((doctor) => (
            <li key={doctor.doctorId} className="flex items-center gap-3">
              <span
                aria-hidden
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#0B3FA8] to-[#14C4C1] text-[11.5px] font-bold text-white"
              >
                {doctor.name
                  .replace(/^Dr\.?\s+/i, "")
                  .split(/\s+/)
                  .map((part) => part[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13.5px] font-semibold text-strong">
                    {doctor.name} <span className="font-normal text-muted">· {doctor.specialization}</span>
                  </span>
                  <span className="shrink-0 text-[13px] font-bold tabular-nums text-strong">{doctor.visits}</span>
                </div>
                <span className="h-1.5 overflow-hidden rounded-full bg-sunken">
                  <span
                    className="bar-grow-x block h-full rounded-full bg-[#1462C4] dark:bg-[#4A86D8]"
                    style={{ width: `${(doctor.visits / top) * 100}%` }}
                  />
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </ConsoleCard>
  );
}

const PIPELINE: Array<{ status: OrderStatus; label: [string, string]; detail: [string, string] }> = [
  { status: "PENDING_RX", label: ["Prescription", "Nuskha"], detail: ["Waiting on a prescription", "Nuskhe ka intezar"] },
  { status: "AWAITING_PAYMENT", label: ["Awaiting payment", "Payment baqi"], detail: ["Patient has not paid yet", "Mareez ne abhi ada nahi kiya"] },
  { status: "CONFIRMED", label: ["To pack", "Pack karna"], detail: ["Paid or cash on delivery", "Ada shuda ya COD"] },
  { status: "PACKED", label: ["To dispatch", "Bhejna"], detail: ["Packed, waiting for a rider", "Pack, rider ka intezar"] },
  { status: "DISPATCHED", label: ["On the way", "Raste mein"], detail: ["With the courier", "Courier ke paas"] },
];

export function PharmacyPipeline() {
  const tr = useTr();
  const summary = useAsync(() => pharmacy.dashboard(), [], { refreshMs: PAGE_REFRESH_MS });
  const data = summary.data;
  return (
    <ConsoleCard
      icon="local_pharmacy"
      title={tr("Pharmacy pipeline", "Pharmacy ka silsila")}
      subtitle={
        data
          ? tr(
              `${data.openOrders} ${data.openOrders === 1 ? "order" : "orders"} moving`,
              `${data.openOrders} orders chal rahe hain`,
            )
          : undefined
      }
      footer={
        <Link href="/admin/pharmacy" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
          {tr("Open the pharmacy", "Pharmacy kholein")}
          <Icon name="arrow_forward" className="text-[16px]" />
        </Link>
      }
    >
      {summary.error ? (
        <div className="px-5 pb-5">
          <ErrorState message={summary.error.message} onRetry={summary.reload} />
        </div>
      ) : (
        <ol className="flex flex-col px-5 pb-4 sm:px-6">
          {PIPELINE.map((step, index) => {
            const count = data?.ordersByStatus[step.status] ?? 0;
            return (
              <li key={step.status}>
                <Link
                  href={`/admin/pharmacy/orders?status=${step.status}`}
                  className="group flex items-center gap-3 rounded-xl py-2 focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <span className="relative flex flex-col items-center self-stretch">
                    <span
                      className={cx(
                        "z-10 grid h-8 w-8 place-items-center rounded-full text-[13px] font-bold tabular-nums",
                        count > 0 ? "bg-[#0B3FA8] text-white dark:bg-[#3B6FE0]" : "bg-sunken text-faint",
                      )}
                    >
                      {data ? count : "·"}
                    </span>
                    {index < PIPELINE.length - 1 && (
                      <span aria-hidden className="absolute top-8 -bottom-2 w-0.5 bg-line" />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[13.5px] font-semibold text-strong group-hover:underline">{tr(...step.label)}</span>
                    <span className="text-[12px] text-muted">{tr(...step.detail)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </ConsoleCard>
  );
}
