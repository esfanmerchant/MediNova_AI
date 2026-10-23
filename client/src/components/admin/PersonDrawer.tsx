"use client";

/**
 * One person, opened from the People page or from search.
 *
 * Read-only on purpose. Suspending and removing stay on the row, where their
 * confirmations already live; this is where an administrator checks who
 * somebody is before doing either — their account, and for a doctor or a
 * patient, how much of the hospital they are part of.
 *
 * Search hands a person across with `holdPerson` rather than in the URL: a
 * name and an email address in a query string end up in browser history and
 * server logs, and neither is the place for them.
 */

import { Fragment, type ReactNode } from "react";

import { Icon } from "@/components/Icon";
import { Drawer } from "@/components/overlays";
import { Avatar, Badge, ErrorState, cx } from "@/components/ui";
import { appointments, doctors, invoices, type AccountRow, type Role } from "@/lib/api";
import { useLang, useTr } from "@/lib/lang";
import { useAsync } from "@/lib/useAsync";

let held: AccountRow | null = null;

/** Fired when a person is held, for a People page that is already showing. */
export const PERSON_HELD = "medinova:person-held";

/** Keeps a person for the People page to open. */
export function holdPerson(person: AccountRow) {
  held = person;
  window.dispatchEvent(new Event(PERSON_HELD));
}

/** The person waiting to be opened, without spending the hand-off. */
export function peekHeldPerson(): AccountRow | null {
  return held;
}

/** The person waiting to be opened; the hand-off is spent by taking it. */
export function takeHeldPerson(): AccountRow | null {
  const person = held;
  held = null;
  return person;
}

export const ROLE_LABEL: Record<Role, [string, string]> = {
  PATIENT: ["Patient", "Mareez"],
  DOCTOR: ["Doctor", "Doctor"],
  NURSE: ["Nurse", "Nurse"],
  ADMIN: ["Administrator", "Admin"],
};

export const STATUS_LABEL: Record<string, [string, string]> = {
  ACTIVE: ["Active", "Faal"],
  SUSPENDED: ["Suspended", "Muattal"],
  DEACTIVATED: ["Closed", "Band"],
  PENDING_VERIFICATION: ["Email not verified", "Email tasdeeq baqi"],
};

const DAY = 86_400_000;

function isoDay(offsetDays = 0): string {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) + offsetDays * DAY)
    .toISOString()
    .slice(0, 10);
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-[12.5px] text-faint">{label}</dt>
      <dd className="m-0 min-w-0 text-[14px] font-semibold break-words text-strong">{children}</dd>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "warning" }) {
  return (
    <div className={cx("flex flex-col gap-1 rounded-2xl p-3.5", tone === "warning" ? "bg-warning-soft" : "bg-sunken")}>
      <span className={cx("text-[12px] font-semibold", tone === "warning" ? "text-warning" : "text-muted")}>{label}</span>
      <span className="font-display text-xl font-bold text-strong tabular-nums">{value}</span>
    </div>
  );
}

function DoctorFacts({ doctorId }: { doctorId: string }) {
  const tr = useTr();
  const profile = useAsync(() => doctors.get(doctorId), [doctorId]);
  const stats = useAsync(
    () =>
      Promise.all([
        appointments.list({ doctorId, status: "COMPLETED", from: isoDay(-30), to: isoDay(), limit: 1 }),
        appointments.list({ doctorId, upcomingOnly: true, limit: 1 }),
        appointments.list({ doctorId, status: "NO_SHOW", from: isoDay(-30), to: isoDay(), limit: 1 }),
      ]).then(([seen, coming, missed]) => ({
        seen: seen.meta.total,
        coming: coming.meta.total,
        missed: missed.meta.total,
      })),
    [doctorId],
  );
  const doctor = profile.data;

  return (
    <section aria-label={tr("As a doctor", "Doctor ke taur par")} className="flex flex-col gap-4">
      <h3 className="mono-caps text-[0.7rem] text-faint">{tr("As a doctor", "Doctor ke taur par")}</h3>
      {stats.data && (
        <div className="grid grid-cols-3 gap-2">
          <Stat label={tr("Seen, 30 days", "30 din mein dekhe")} value={stats.data.seen} />
          <Stat label={tr("Coming up", "Aane wale")} value={stats.data.coming} />
          <Stat label={tr("No-shows, 30 days", "Nahi aaye, 30 din")} value={stats.data.missed} />
        </div>
      )}
      {profile.error && <ErrorState message={profile.error.message} onRetry={profile.reload} />}
      {doctor && (
        <dl className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 gap-y-2.5">
          <Fact label={tr("Speciality", "Speciality")}>{doctor.specialization}</Fact>
          {doctor.department && <Fact label={tr("Department", "Shoba")}>{doctor.department.name}</Fact>}
          {doctor.qualifications && <Fact label={tr("Qualifications", "Taleem")}>{doctor.qualifications}</Fact>}
          <Fact label={tr("Visit fee", "Visit fee")}>
            PKR {new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(doctor.consultationFee)}
          </Fact>
          <Fact label={tr("Video visits", "Video visits")}>
            {doctor.offersOnline ? tr("Offered", "Dastiyab") : tr("Not offered", "Nahi")}
          </Fact>
          {(doctor.clinicName || doctor.city) && (
            <Fact label={tr("Clinic", "Clinic")}>{[doctor.clinicName, doctor.city].filter(Boolean).join(", ")}</Fact>
          )}
          <Fact label={tr("New patients", "Naye mareez")}>
            {doctor.acceptingPatients ? tr("Accepting", "Le rahe hain") : tr("Not accepting", "Nahi le rahe")}
          </Fact>
        </dl>
      )}
    </section>
  );
}

function PatientFacts({ patientId }: { patientId: string }) {
  const tr = useTr();
  const stats = useAsync(
    () =>
      Promise.all([
        appointments.list({ patientId, upcomingOnly: true, limit: 1 }),
        appointments.list({ patientId, status: "COMPLETED", limit: 1 }),
        invoices.list({ patientId, status: "ISSUED", limit: 1 }),
        invoices.list({ patientId, status: "OVERDUE", limit: 1 }),
      ]).then(([coming, seen, issued, overdue]) => ({
        coming: coming.meta.total,
        seen: seen.meta.total,
        unpaid: issued.meta.total + overdue.meta.total,
        overdue: overdue.meta.total,
      })),
    [patientId],
  );

  return (
    <section aria-label={tr("As a patient", "Mareez ke taur par")} className="flex flex-col gap-4">
      <h3 className="mono-caps text-[0.7rem] text-faint">{tr("As a patient", "Mareez ke taur par")}</h3>
      {stats.error && <ErrorState message={stats.error.message} onRetry={stats.reload} />}
      {stats.data && (
        <div className="grid grid-cols-3 gap-2">
          <Stat label={tr("Visits coming", "Aane wali visits")} value={stats.data.coming} />
          <Stat label={tr("Visits done", "Mukammal visits")} value={stats.data.seen} />
          <Stat
            label={stats.data.overdue > 0 ? tr("Unpaid, some late", "Baqaya, kuchh late") : tr("Unpaid invoices", "Baqaya invoices")}
            value={stats.data.unpaid}
            tone={stats.data.overdue > 0 ? "warning" : undefined}
          />
        </div>
      )}
      <p className="flex items-start gap-2 text-[12.5px] text-muted">
        <Icon name="lock" className="mt-px shrink-0 text-[15px]" />
        {tr(
          "Their medical record is not shown here. Opening it is a clinician's act and is audited.",
          "Un ka tibbi record yahan nahi dikhaya jaata. Usay kholna doctor ka kaam hai aur audit hota hai.",
        )}
      </p>
    </section>
  );
}

export function PersonDrawer({ person, onClose }: { person: AccountRow | null; onClose: () => void }) {
  const tr = useTr();
  const locale = useLang() === "ur" ? "en-PK" : undefined;
  const date = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) : tr("Never", "Kabhi nahi");

  return (
    <Drawer
      open={person !== null}
      onClose={onClose}
      title={person?.name ?? ""}
      description={person ? tr(...(ROLE_LABEL[person.role] ?? [person.role, person.role])) : undefined}
      width={520}
    >
      {person && (
        <div className="flex flex-col gap-7">
          <div className="flex items-center gap-4">
            <Avatar name={person.name} size="lg" ring={person.status === "ACTIVE" ? "active" : "inactive"} />
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="font-display text-xl font-bold text-strong">{person.name}</span>
              <span className="flex flex-wrap gap-1.5">
                <Badge tone="neutral">{tr(...(ROLE_LABEL[person.role] ?? [person.role, person.role]))}</Badge>
                <Badge tone={person.status === "ACTIVE" ? "good" : "critical"}>
                  {tr(...(STATUS_LABEL[person.status] ?? [person.status, person.status]))}
                </Badge>
              </span>
            </div>
          </div>

          <dl className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 gap-y-2.5">
            {(
              [
                [tr("Email", "Email"), person.email],
                [tr("Phone", "Phone"), person.phone ?? "—"],
                [tr("Joined", "Shamil hue"), date(person.createdAt)],
                [tr("Last sign-in", "Aakhri sign-in"), date(person.lastLoginAt)],
              ] as const
            ).map(([label, value]) => (
              <Fragment key={label}>
                <Fact label={label}>{value}</Fact>
              </Fragment>
            ))}
          </dl>

          {person.doctorId && <DoctorFacts doctorId={person.doctorId} />}
          {person.patientId && <PatientFacts patientId={person.patientId} />}
        </div>
      )}
    </Drawer>
  );
}
