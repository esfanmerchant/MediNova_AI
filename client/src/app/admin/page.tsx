"use client";

/**
 * The administrator's overview.
 *
 * Unreviewed break-glass grants are surfaced above everything else: the
 * post-hoc review is what makes emergency override safe to offer at all
 * (conflict C1). They lead the banner's sentence, own its only red button,
 * and head the "Needs you" list until somebody signs them off.
 *
 * The page reads as one sentence and then its evidence: the banner says what
 * today looks like, "Needs you" lists what is waiting on a person, the tiles
 * are the money and the doors, and the security card is the last week of
 * things that went wrong at the gate.
 */

import Link from "next/link";

import { AppShell } from "@/components/AppShell";
import {
  BannerAction,
  CardLink,
  ConsoleBanner,
  ConsoleCard,
  ConsoleLoading,
  dayMonth,
  FinishedState,
  NeedsList,
  PastelTile,
  type Need,
} from "@/components/admin/console";
import { localToday } from "@/components/admin/AppointmentWeek";
import { ClinicPulse } from "@/components/admin/ClinicPulse";
import { TodayByHour } from "@/components/admin/TodayByHour";
import { BusiestDoctors, PharmacyPipeline, WeekBySpeciality } from "@/components/admin/OverviewSections";
import { RevenuePanel, inWindow } from "@/components/admin/RevenueChart";
import { SetupChecklist } from "@/components/admin/SetupChecklist";
import { ErrorState, cx } from "@/components/ui";
import { appointments, dashboard, doctorRequests, invoices, revenue, withdrawalReview } from "@/lib/api";
import { useLang, useTr } from "@/lib/lang";
import { useSession } from "@/lib/session";
import { useAsync } from "@/lib/useAsync";

const ACTION_LABELS: Record<string, [string, string]> = {
  LOGIN_FAILED: ["Failed sign-in", "Nakam sign-in"],
  ACCESS_DENIED: ["Access denied", "Rasai se inkar"],
  EMERGENCY_ACCESS_GRANTED: ["Emergency access granted", "Emergency access di gayi"],
  EMERGENCY_ACCESS_USED: ["Emergency access used", "Emergency access istemal hui"],
  EMERGENCY_ACCESS_REVOKED: ["Emergency access revoked", "Emergency access wapas li gayi"],
  USER_STATUS_CHANGED: ["Account status changed", "Account status badla"],
  SESSION_EXPIRED: ["Session ended", "Session khatam"],
};

/** More failed sign-ins than this in a week is worth somebody's look. */
const FAILED_SIGN_IN_WATCH = 20;

const rupees = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 });

/** Small counts read as words in a sentence — "Five things need you". */
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const spell = (n: number) => WORDS[n] ?? String(n);

/** What an access-denied entry was reaching for, in the words of the page it lives on. */
const AREAS: Record<string, [string, string]> = {
  Patient: ["patient record", "mareez ka record"],
  Invoice: ["billing", "billing"],
  Payment: ["billing", "billing"],
  Prescription: ["prescriptions", "nuskhe"],
  MedicalDocument: ["documents", "documents"],
};

/** "21 Oct, 9:11 PM" — the security card's stamp. */
function stamp(iso: string): string {
  const at = new Date(iso);
  return `${dayMonth(at)}, ${at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

export default function AdminDashboard() {
  // This dashboard carries the recent security events, and the API audits the
  // read for that reason — so it refreshes when the administrator returns to
  // the window rather than on a timer. See lib/useAsync.ts.
  const { data, error, loading, reload } = useAsync(() => dashboard.admin(), [], {
    live: "on-return",
  });
  // The same count the rail's badge shows, from the same endpoint. A failure
  // is a missing line in "Needs you", not a broken page.
  const { data: applications } = useAsync(
    () => doctorRequests.list({ status: "SUBMITTED", limit: 1 }).catch(() => null),
    [],
  );
  const series = useAsync(() => revenue.series("day"), []);
  // Today's visits for the banner's chart, and the counts its sentence and
  // "Needs you" quote. Each read fails on its own without taking the page.
  const today = localToday();
  const visitsToday = useAsync(() => appointments.list({ from: today, to: today, limit: 100 }).catch(() => null), [today], {
    live: "on-return",
  });
  const asking = useAsync(() => appointments.list({ status: "REQUESTED", limit: 1 }).catch(() => null), []);
  const payouts = useAsync(() => withdrawalReview.pending({ limit: 1 }).catch(() => null), []);
  const ledger = useAsync(() => invoices.list({ status: "ISSUED", limit: 1 }).catch(() => null), []);
  const { user } = useSession();
  const tr = useTr();
  const lang = useLang();
  const english = lang !== "ur";

  const counts = data?.counts ?? {};
  const unreviewed = counts.unreviewedEmergencyGrants ?? 0;
  const openGrants = counts.activeEmergencyGrants ?? 0;
  const waitingDoctors = applications?.meta.pending ?? 0;
  const unpaid = counts.unpaidInvoices ?? 0;
  const failedSignIns = counts.failedLoginsThisWeek ?? 0;
  const currency = data?.revenue.currency ?? "PKR";
  const owed = Number(data?.revenue.owedToDoctors) || 0;
  const money = (value: number) => `${currency} ${rupees.format(value)}`;
  const needAYes = asking.data?.meta.total ?? 0;
  const withdrawalsWaiting = payouts.data?.meta.total ?? 0;
  const outstanding = Number(ledger.data?.meta.outstanding) || 0;
  const todaysVisits = (visitsToday.data?.data ?? []).filter((visit) => visit.localDate === today && visit.status !== "CANCELLED");
  // The thirty days the money panel draws, for the strip under it.
  const window30 = series.data ? inWindow(series.data.points, "day") : undefined;
  // What came in today: the last point of the daily series, when it is today's.
  const lastPoint = series.data?.points.at(-1);
  const cameInToday = lastPoint && lastPoint.period.slice(0, 10) === new Date().toISOString().slice(0, 10) ? Number(lastPoint.handled) || 0 : 0;

  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  const nowMs = new Date().getTime();
  const daysSince = (iso: string) => Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 86_400_000));
  const oldest = data?.oldest;
  const askingToday = todaysVisits.filter((visit) => visit.status === "REQUESTED").length;
  const lateDays = oldest?.unpaidInvoiceDueAt ? Math.floor((nowMs - Date.parse(oldest.unpaidInvoiceDueAt)) / 86_400_000) : 0;
  const waited = oldest?.applicationSubmittedAt ? daysSince(oldest.applicationSubmittedAt) : null;

  // Worst first: a person's records opened under break-glass outrank money.
  // An access that is open right now is said by the security card; the line
  // here is the review, which is the thing that waits on a person.
  const needs: Need[] = !data
    ? []
    : [
        unreviewed > 0 && {
          key: "review",
          href: "/admin/emergency",
          icon: "policy",
          title: tr(
            `${unreviewed} emergency ${plural(unreviewed, "access", "accesses")} to review`,
            `${unreviewed} emergency ${plural(unreviewed, "access", "accesses")} ka review`,
          ),
          detail: oldest?.unreviewedGrant
            ? tr(
                `${oldest.unreviewedGrant.requesterName ?? "Someone"} opened a record on ${dayMonth(new Date(oldest.unreviewedGrant.grantedAt))}`,
                `${oldest.unreviewedGrant.requesterName ?? "Kisi"} ne ${dayMonth(new Date(oldest.unreviewedGrant.grantedAt))} ko record khola`,
              )
            : tr("Every break-glass access is signed off afterwards", "Har break-glass access ka baad mein sign-off hota hai"),
          tone: "critical" as const,
        },
        waitingDoctors > 0 && {
          key: "doctors",
          href: "/admin/doctor-requests",
          icon: "how_to_reg",
          title: tr(
            `${waitingDoctors} ${plural(waitingDoctors, "doctor", "doctors")} waiting to be approved`,
            `${waitingDoctors} doctors approval ke muntazir`,
          ),
          detail:
            waited === null
              ? tr("Check the licence and documents, then decide", "License aur documents dekh kar faisla karein")
              : waited === 0
                ? tr("Oldest came in today", "Sab se purani aaj aayi")
                : tr(
                    `Oldest has waited ${waited} ${plural(waited, "day", "days")}`,
                    `Sab se purani ${waited} din se muntazir`,
                  ),
          tone: "warning" as const,
        },
        needAYes > 0 && {
          key: "asking",
          href: "/admin/appointments",
          icon: "calendar_month",
          title: tr(
            `${needAYes} ${plural(needAYes, "visit needs", "visits need")} a yes`,
            `${needAYes} visits ko haan chahiye`,
          ),
          detail: askingToday
            ? tr(
                needAYes === 1 ? "It is today" : `${askingToday} of them ${plural(askingToday, "is", "are")} today`,
                needAYes === 1 ? "Yeh aaj hai" : `In mein se ${askingToday} aaj hain`,
              )
            : tr("None of them is today", "In mein se koi aaj nahi"),
          tone: "warning" as const,
        },
        unpaid > 0 && {
          key: "unpaid",
          href: "/admin/billing",
          icon: "receipt_long",
          title: tr(
            `${unpaid} unpaid ${plural(unpaid, "invoice", "invoices")}`,
            `${unpaid} baqaya invoices`,
          ),
          detail: [
            outstanding ? money(outstanding) : null,
            lateDays > 0
              ? tr(`oldest ${lateDays} ${plural(lateDays, "day", "days")} late`, `sab se purani ${lateDays} din late`)
              : tr("none late yet", "abhi koi late nahi"),
          ]
            .filter(Boolean)
            .join(" · "),
          tone: "warning" as const,
        },
        owed > 0 && {
          key: "owed",
          href: "/admin/withdrawals",
          icon: "account_balance",
          title: withdrawalsWaiting
            ? tr(`${withdrawalsWaiting} ${plural(withdrawalsWaiting, "doctor", "doctors")} to pay`, `${withdrawalsWaiting} doctors ko ada karna hai`)
            : tr(`Doctors are owed ${money(owed)}`, `Doctors ko ${money(owed)} dene hain`),
          detail: withdrawalsWaiting
            ? tr(`${money(owed)} in withdrawals`, `${money(owed)} withdrawals mein`)
            : tr("Their fees, held until they withdraw", "Un ki fees, withdrawal tak hamare paas"),
          tone: "calm" as const,
        },
        failedSignIns > FAILED_SIGN_IN_WATCH && {
          key: "sign-ins",
          href: "/admin/audit",
          icon: "lock",
          title: tr(`${failedSignIns} failed sign-ins this week`, `Is hafte ${failedSignIns} nakam sign-ins`),
          detail: tr("More than usual, the audit trail shows from where", "Mamool se zyada, audit trail batata hai kahan se"),
          tone: "warning" as const,
        },
      ].filter((need): need is Need => Boolean(need));
  // The sentence reads the first line in words: "first one emergency access to review".
  const firstNeed = needs[0] ? needs[0].title.replace(/^\d+/, (digits) => (english ? spell(Number(digits)) : digits)) : "";

  const hour = new Date().getHours();
  const greeting =
    hour < 12
      ? tr("Good morning", "Subah bakhair")
      : hour < 17
        ? tr("Good afternoon", "Salam")
        : tr("Good evening", "Shaam bakhair");
  const firstName = user?.name.split(/\s+/)[0];

  return (
    <AppShell role="ADMIN">
      <div id="main" className="space-y-[22px]">
        <ConsoleBanner
          id="overview"
          live
          eyebrow={`${new Date()
            .toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })
            .replace(",", "")
            .toUpperCase()} · LIVE`}
          aside={<TodayByHour visits={visitsToday.data ? todaysVisits : null} />}
          title={firstName ? `${greeting}, ${firstName}.` : `${greeting}.`}
          actions={
            data && (
              <>
                {unreviewed > 0 && (
                  // The one red thing on the page, announced as it arrives.
                  <span role="alert" className="contents">
                    <BannerAction href="/admin/emergency" tone="critical" icon="policy">
                      {tr(
                        `Review ${unreviewed} emergency ${plural(unreviewed, "grant", "grants")}`,
                        `${unreviewed} emergency ${plural(unreviewed, "grant", "grants")} review karein`,
                      )}
                    </BannerAction>
                  </span>
                )}
                {needs.length > 0 && (
                  <BannerAction href="#needs">
                    {needs.length === 1 ? tr("See it", "Dekhein") : tr(`See all ${spell(needs.length)}`, `Sab ${needs.length} dekhein`)}
                  </BannerAction>
                )}
                <BannerAction href="/admin/audit" tone="ghost">
                  {tr("Audit trail", "Audit trail")}
                </BannerAction>
              </>
            )
          }
          stats={
            data
              ? [
                  { label: tr("Patients", "Mareez"), value: rupees.format(counts.patients ?? 0) },
                  { label: tr("Doctors", "Doctors"), value: rupees.format(counts.doctors ?? 0) },
                  {
                    label: tr("Booked, last 7 days", "Booking, pichhle 7 din"),
                    value: rupees.format(counts.appointmentsThisWeek ?? 0),
                  },
                  {
                    label: tr("Handled all time", "Ab tak kul raqam"),
                    value: `${currency} ${rupees.format(Number(data.revenue.handled) || 0)}`,
                  },
                ]
              : undefined
          }
        >
          {data ? (
            <p>
              <b>{money(cameInToday)}</b>
              {tr(" came in today and ", " aaj aaye aur ")}
              <b>
                {tr(
                  `${todaysVisits.length} ${plural(todaysVisits.length, "visit", "visits")}`,
                  `${todaysVisits.length} visits`,
                )}
              </b>
              {tr(" are on the books. ", " aaj booked hain. ")}
              {needs.length === 0 ? (
                tr("Nothing is waiting on you.", "Koi cheez aap ki muntazir nahi.")
              ) : (
                <>
                  {tr(
                    `${spell(needs.length).charAt(0).toUpperCase()}${spell(needs.length).slice(1)} ${plural(needs.length, "thing needs", "things need")} you, first `,
                    `${needs.length} cheezein aap ki muntazir hain, pehle `,
                  )}
                  <Link href={needs[0].href}>{firstNeed.charAt(0).toLowerCase() + firstNeed.slice(1)}</Link>.
                </>
              )}
            </p>
          ) : (
            <p>{error ? tr("The overview did not load.", "Jaiza load nahi hua.") : tr("Loading the overview…", "Jaiza load ho raha hai…")}</p>
          )}
        </ConsoleBanner>

        {loading && !data && <ConsoleLoading />}
        {/* Only while a new hospital still has setup left; gone once it is done. */}
        {data && <SetupChecklist doctors={counts.doctors ?? 0} />}
        {error && <ErrorState message={error.message} onRetry={reload} />}

        {data && (
          <div className="grid gap-[22px] xl:grid-cols-[minmax(0,70fr)_minmax(320px,39fr)] xl:grid-rows-[auto_1fr] xl:items-start">
            {/* First in the document, so a phone reaches it straight after the
                banner; the grid moves it to the right-hand column on a wide
                screen, beside the figures it is the to-do list for. */}
            <ConsoleCard
              id="needs"
              icon="checklist"
              title={tr("Needs you", "Aap ki zaroorat")}
              subtitle={tr("Worst first", "Sab se zaroori pehle")}
              className="xl:col-start-2 xl:row-start-1"
            >
              {needs.length === 0 ? (
                <FinishedState
                  title={tr("You're all caught up", "Sab kuchh nipat gaya")}
                  description={tr(
                    "No reviews, approvals or unpaid invoices are waiting.",
                    "Koi review, approval ya baqaya invoice muntazir nahi.",
                  )}
                />
              ) : (
                <NeedsList items={needs} />
              )}
            </ConsoleCard>

            <div className="flex min-w-0 flex-col gap-[22px] xl:col-start-1 xl:row-span-2 xl:row-start-1">
              <section id="totals" aria-label={tr("Money and access", "Raqam aur rasai")} className="scroll-section stagger grid grid-cols-1 gap-4 sm:grid-cols-2">
                <PastelTile
                  pastel="sky"
                  icon="account_balance_wallet"
                  label={tr("Owed to doctors", "Doctors ko dena hai")}
                  unit={currency}
                  value={rupees.format(owed)}
                  note={
                    withdrawalsWaiting
                      ? tr(
                          `${withdrawalsWaiting} ${plural(withdrawalsWaiting, "withdrawal", "withdrawals")} waiting`,
                          `${withdrawalsWaiting} withdrawals muntazir`,
                        )
                      : tr("Their fees, held until they withdraw", "Un ki fees, withdrawal tak")
                  }
                  chip={
                    owed > 0
                      ? { text: tr("To pay out", "Ada karna hai"), tone: "warning" }
                      : { text: tr("Settled", "Sab ada"), tone: "good" }
                  }
                  href="/admin/withdrawals"
                />
                <PastelTile
                  pastel="mint"
                  icon="monitoring"
                  label={tr("Earned by MediNova AI", "MediNova AI ki kamai")}
                  unit={currency}
                  value={rupees.format(Number(data.revenue.earned) || 0)}
                  note={tr("Fees and late charges, all time", "Fees aur late charges, ab tak")}
                  href="/admin/revenue"
                />
                <PastelTile
                  pastel="butter"
                  icon="receipt_long"
                  label={tr("Unpaid invoices", "Baqaya invoices")}
                  value={rupees.format(unpaid)}
                  note={
                    outstanding
                      ? tr(`${money(outstanding)} waiting on patients`, `${money(outstanding)} mareezon se baqi`)
                      : tr("Waiting on patients", "Mareezon ki adaigi baqi")
                  }
                  chip={unpaid > 0 ? { text: tr("Follow up", "Yaad dilayein"), tone: "warning" } : undefined}
                  href="/admin/billing"
                />
                <PastelTile
                  pastel="lilac"
                  icon="lock"
                  label={tr("Failed sign-ins, 7 days", "Nakam sign-ins, 7 din")}
                  value={rupees.format(failedSignIns)}
                  note={
                    failedSignIns > FAILED_SIGN_IN_WATCH
                      ? tr("More than usual — see the audit trail", "Mamool se zyada — audit trail dekhein")
                      : tr(`Normal. Over ${FAILED_SIGN_IN_WATCH} turns this amber.`, `Theek hai. ${FAILED_SIGN_IN_WATCH} se zyada par amber.`)
                  }
                  chip={
                    failedSignIns > FAILED_SIGN_IN_WATCH
                      ? { text: tr("Higher than usual", "Mamool se zyada"), tone: "warning" }
                      : undefined
                  }
                  href="/admin/audit"
                />
              </section>

              <ClinicPulse />

              <RevenuePanel
                grain="day"
                currency={currency}
                points={series.data?.points}
                loading={series.loading}
                error={series.error}
                onRetry={series.reload}
                footer={
                  window30 && (
                    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/10 sm:grid-cols-4">
                      {(
                        [
                          [tr("To doctors", "Doctors ko"), money(window30.reduce((sum, point) => sum + (Number(point.toDoctors) || 0), 0)), tr("Their fees, never ours", "Un ki fees, hamari nahi")],
                          [tr("Medicine", "Dawa"), money(window30.reduce((sum, point) => sum + (Number(point.pharmacy) || 0), 0)), tr("Pharmacy sales", "Pharmacy ki farokht")],
                          [tr("MediNova fees", "MediNova fees"), money(window30.reduce((sum, point) => sum + (Number(point.platformFee) || 0), 0)), tr("Ours", "Hamari")],
                          [tr("Still unpaid", "Abhi baqaya"), tr(`${unpaid} ${plural(unpaid, "invoice", "invoices")}`, `${unpaid} invoices`), tr("Waiting on patients", "Mareezon ki adaigi baqi")],
                        ] as const
                      ).map(([label, value, note]) => (
                        <div key={label} title={note} className="flex flex-col gap-0.5 bg-[#061230]/55 px-4 py-3">
                          <dt className="text-[11.5px] text-[#9DB0D1]">{label}</dt>
                          <dd className="m-0 font-display text-[14px] font-bold text-white">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  )
                }
              />

              <WeekBySpeciality />
            </div>

            <div className="flex flex-col gap-[22px] xl:col-start-2 xl:row-start-2">
              <PharmacyPipeline />
              <BusiestDoctors doctors={data.busiestDoctors ?? []} />

              <ConsoleCard
                id="security"
                icon="security"
                title={tr("Security, last 7 days", "Security, pichle 7 din")}
                subtitle={
                  openGrants > 0
                    ? tr(
                        `${openGrants} emergency ${plural(openGrants, "access", "accesses")} open right now`,
                        `${openGrants} emergency access abhi khuli hai`,
                      )
                    : tr("No emergency access is open right now", "Abhi koi emergency access khuli nahi")
                }
                footer={
                  <>
                    <CardLink href="/admin/audit" flush>
                      {tr("Open the audit trail →", "Audit trail kholein →")}
                    </CardLink>
                    <Link href="/admin/users" className="text-muted hover:underline">
                      {tr(
                        `${counts.suspendedAccounts ?? 0} suspended ${plural(counts.suspendedAccounts ?? 0, "account", "accounts")}`,
                        `${counts.suspendedAccounts ?? 0} muattal accounts`,
                      )}
                    </Link>
                  </>
                }
              >
                {data.recentSecurityEvents.length === 0 ? (
                  <FinishedState
                    art="shield"
                    size={120}
                    title={tr("Nothing to review", "Review ke liye kuchh nahi")}
                    description={tr("No security events have been recorded this week.", "Is hafte koi security waqia darj nahi hua.")}
                  />
                ) : (
                  <ul className="flex flex-col px-[22px] pb-2">
                    {data.recentSecurityEvents.map((event) => {
                      const breakGlass = event.severity === "BREAK_GLASS";
                      // Who, then what: the person and the door they were at.
                      const who =
                        event.action === "LOGIN_FAILED"
                          ? (event.actorEmail ?? tr("unknown email", "na-maloom email"))
                          : (event.actorName ?? tr("Unknown account", "Na-maloom account"));
                      const what = breakGlass
                        ? tr("break glass", "break glass")
                        : event.action === "ACCESS_DENIED" && event.entityType
                          ? tr(...(AREAS[event.entityType] ?? [event.entityType.replace(/(?<!^)([A-Z])/g, " $1").toLowerCase(), event.entityType]))
                          : event.ipAddress;
                      return (
                        <li key={event.id} className="flex gap-2.5 border-t border-line py-2.5">
                          <span
                            aria-hidden
                            className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", breakGlass ? "bg-critical" : "bg-[#F59E0B]")}
                          />
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="text-[13.5px] font-semibold text-strong">
                              {tr(...(ACTION_LABELS[event.action] ?? [event.action, event.action]))}
                            </span>
                            <span className="truncate text-[12.5px] text-muted">{[who, what].filter(Boolean).join(" · ")}</span>
                          </div>
                          <time dateTime={event.timestamp} className="shrink-0 text-[12.5px] whitespace-nowrap text-faint tabular-nums">
                            {stamp(event.timestamp)}
                          </time>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </ConsoleCard>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
