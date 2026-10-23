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
import { Icon } from "@/components/Icon";
import {
  BannerAction,
  ConsoleBanner,
  ConsoleCard,
  ConsoleLoading,
  FinishedState,
  NeedsList,
  PastelTile,
  type Need,
} from "@/components/admin/console";
import { ClinicPulse } from "@/components/admin/ClinicPulse";
import { BusiestDoctors, PharmacyPipeline, WeekBySpeciality } from "@/components/admin/OverviewSections";
import { RevenuePanel } from "@/components/admin/RevenueChart";
import { SetupChecklist } from "@/components/admin/SetupChecklist";
import { ErrorState, cx } from "@/components/ui";
import { dashboard, doctorRequests, revenue } from "@/lib/api";
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
  const { user } = useSession();
  const tr = useTr();
  const lang = useLang();
  const locale = lang === "ur" ? "en-PK" : undefined;

  const counts = data?.counts ?? {};
  const unreviewed = counts.unreviewedEmergencyGrants ?? 0;
  const openGrants = counts.activeEmergencyGrants ?? 0;
  const waitingDoctors = applications?.meta.pending ?? 0;
  const unpaid = counts.unpaidInvoices ?? 0;
  const failedSignIns = counts.failedLoginsThisWeek ?? 0;
  const currency = data?.revenue.currency ?? "PKR";
  const owed = Number(data?.revenue.owedToDoctors) || 0;
  const money = (value: number) => `${currency} ${rupees.format(value)}`;

  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

  // Worst first: a person's records open under break-glass outrank money.
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
          detail: tr(
            "Every break-glass access is signed off afterwards.",
            "Har break-glass access ka baad mein sign-off hota hai.",
          ),
          tone: "critical" as const,
        },
        openGrants > 0 && {
          key: "open",
          href: "/admin/emergency",
          icon: "e911_emergency",
          title: tr(
            `${openGrants} emergency ${plural(openGrants, "access is", "accesses are")} open now`,
            `${openGrants} emergency access abhi khuli hai`,
          ),
          detail: tr(
            "Records are being read under break-glass right now.",
            "Is waqt break-glass ke tehat records parhe ja rahe hain.",
          ),
          tone: "critical" as const,
        },
        waitingDoctors > 0 && {
          key: "doctors",
          href: "/admin/doctor-requests",
          icon: "how_to_reg",
          title: tr(
            `${waitingDoctors} ${plural(waitingDoctors, "doctor is", "doctors are")} waiting to be approved`,
            `${waitingDoctors} doctors approval ke muntazir`,
          ),
          detail: tr("Check the licence and documents, then decide.", "License aur documents dekh kar faisla karein."),
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
          detail: tr("Patients who have not paid yet.", "Woh mareez jinhon ne abhi tak adaigi nahi ki."),
          tone: "warning" as const,
        },
        owed > 0 && {
          key: "owed",
          href: "/admin/withdrawals",
          icon: "account_balance_wallet",
          title: tr(`Doctors are owed ${currency} ${rupees.format(owed)}`, `Doctors ko ${currency} ${rupees.format(owed)} dene hain`),
          detail: tr("Their fees, held until they withdraw.", "Un ki fees, withdrawal tak hamare paas."),
          tone: "calm" as const,
        },
        failedSignIns > FAILED_SIGN_IN_WATCH && {
          key: "sign-ins",
          href: "/admin/audit",
          icon: "lock",
          title: tr(`${failedSignIns} failed sign-ins this week`, `Is hafte ${failedSignIns} nakam sign-ins`),
          detail: tr("More than usual. The audit trail shows from where.", "Mamool se zyada. Audit trail batata hai kahan se."),
          tone: "warning" as const,
        },
      ].filter((need): need is Need => Boolean(need));

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
      <div id="main" className="space-y-6">
        <ConsoleBanner
          id="overview"
          live
          eyebrow={new Date()
            .toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })
            .toUpperCase()}
          title={firstName ? `${greeting}, ${firstName}.` : `${greeting}.`}
          actions={
            data && (
              <>
                {unreviewed > 0 ? (
                  // The one red thing on the page, announced as it arrives.
                  <span role="alert" className="contents">
                    <BannerAction href="/admin/emergency" tone="critical" icon="policy">
                      {tr(
                        `Review ${unreviewed} emergency ${plural(unreviewed, "grant", "grants")}`,
                        `${unreviewed} emergency ${plural(unreviewed, "grant", "grants")} review karein`,
                      )}
                    </BannerAction>
                  </span>
                ) : (
                  needs.length > 0 && (
                    <BannerAction href="#needs" icon="checklist">
                      {tr("See what needs you", "Dekhein kya baqi hai")}
                    </BannerAction>
                  )
                )}
                <BannerAction href="/admin/audit" tone="ghost" icon="verified_user">
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
              {tr(
                `${counts.patients ?? 0} patients and ${counts.doctors ?? 0} doctors, and `,
                `${counts.patients ?? 0} mareez aur ${counts.doctors ?? 0} doctors, aur pichhle 7 din mein `,
              )}
              <Link href="/admin/appointments">
                {tr(
                  `${counts.appointmentsThisWeek ?? 0} ${plural(counts.appointmentsThisWeek ?? 0, "visit", "visits")} booked`,
                  `${counts.appointmentsThisWeek ?? 0} visits book hui`,
                )}
              </Link>
              {tr(" in the last 7 days. ", ". ")}
              {needs.length === 0 ? (
                tr("Nothing is waiting on you.", "Koi cheez aap ki muntazir nahi.")
              ) : (
                <>
                  {tr(
                    `${needs.length} ${plural(needs.length, "thing needs", "things need")} you, first `,
                    `${needs.length} cheezein aap ki muntazir hain, pehle `,
                  )}
                  <Link href={needs[0].href}>{needs[0].title.charAt(0).toLowerCase() + needs[0].title.slice(1)}</Link>.
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
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)] xl:grid-rows-[auto_1fr] xl:items-start">
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

            <div className="flex min-w-0 flex-col gap-6 xl:col-start-1 xl:row-span-2 xl:row-start-1">
              <section id="totals" aria-label={tr("Money and access", "Raqam aur rasai")} className="scroll-section stagger grid grid-cols-1 gap-4 sm:grid-cols-2">
                <PastelTile
                  pastel="sky"
                  icon="account_balance_wallet"
                  label={tr("Owed to doctors", "Doctors ko dena hai")}
                  unit={currency}
                  value={rupees.format(owed)}
                  note={tr("Their fees, held until they withdraw", "Un ki fees, withdrawal tak")}
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
                  note={tr("Waiting on patients", "Mareezon ki adaigi baqi")}
                  chip={unpaid > 0 ? { text: tr("Follow up", "Yaad dilayein"), tone: "warning" } : undefined}
                  href="/admin/billing"
                />
                <PastelTile
                  pastel="lilac"
                  icon="lock"
                  label={tr("Failed sign-ins, 7 days", "Nakam sign-ins, 7 din")}
                  value={rupees.format(failedSignIns)}
                  note={tr("Wrong passwords and blocked tries", "Ghalat password aur roki gayi koshishen")}
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
                  series.data && (
                    <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/10 sm:grid-cols-4">
                      {(
                        [
                          [tr("To doctors", "Doctors ko"), money(series.data.points.reduce((sum, point) => sum + (Number(point.toDoctors) || 0), 0)), tr("Their fees, never ours", "Un ki fees, hamari nahi")],
                          [tr("Medicine", "Dawa"), money(series.data.points.reduce((sum, point) => sum + (Number(point.pharmacy) || 0), 0)), tr("Pharmacy sales", "Pharmacy ki farokht")],
                          [tr("MediNova fees", "MediNova fees"), money(series.data.points.reduce((sum, point) => sum + (Number(point.platformFee) || 0), 0)), tr("Ours", "Hamari")],
                          [tr("Still unpaid", "Abhi baqaya"), tr(`${unpaid} ${plural(unpaid, "invoice", "invoices")}`, `${unpaid} invoices`), tr("Waiting on patients", "Mareezon ki adaigi baqi")],
                        ] as const
                      ).map(([label, value, note]) => (
                        <div key={label} className="flex flex-col gap-0.5 bg-[#061230]/50 px-4 py-3">
                          <dt className="mono-caps text-[0.62rem] text-[#8EA1C2]">{label}</dt>
                          <dd className="m-0 font-display text-base font-bold text-white tabular-nums">{value}</dd>
                          <dd className="m-0 text-[11.5px] text-[#B9C7DD]">{note}</dd>
                        </div>
                      ))}
                    </dl>
                  )
                }
              />

              <WeekBySpeciality />
            </div>

            <div className="flex flex-col gap-6 xl:col-start-2 xl:row-start-2">
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
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href="/admin/audit" className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline">
                      <Icon name="verified_user" className="text-[18px]" />
                      {tr("Open the audit trail", "Audit trail kholein")}
                    </Link>
                    <Link
                      href="/admin/users"
                      className={cx(
                        "text-[13px] hover:underline",
                        counts.suspendedAccounts ? "font-semibold text-warning" : "text-muted",
                      )}
                    >
                      {tr(
                        `${counts.suspendedAccounts ?? 0} suspended ${plural(counts.suspendedAccounts ?? 0, "account", "accounts")}`,
                        `${counts.suspendedAccounts ?? 0} muattal accounts`,
                      )}
                    </Link>
                  </div>
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
                  <ul className="divide-y divide-line px-5 pb-2 sm:px-6">
                    {data.recentSecurityEvents.map((event) => {
                      const breakGlass = event.severity === "BREAK_GLASS";
                      return (
                        <li key={event.id} className="flex items-start gap-3 py-3">
                          <span
                            aria-hidden
                            className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", breakGlass ? "bg-critical" : "bg-warning")}
                          />
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="text-[14px] font-semibold text-strong">
                              {tr(...(ACTION_LABELS[event.action] ?? [event.action, event.action]))}
                            </span>
                            <span className="text-[12.5px] text-muted">
                              <span className={breakGlass ? "text-critical" : "text-warning"}>
                                {event.severity.toLowerCase().replace("_", " ")}
                              </span>
                              {event.ipAddress && <span className="tabular-nums"> · {event.ipAddress}</span>}
                            </span>
                          </div>
                          <time
                            dateTime={event.timestamp}
                            className="shrink-0 text-[12.5px] whitespace-nowrap text-faint tabular-nums"
                          >
                            {new Date(event.timestamp).toLocaleString(locale, {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
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
