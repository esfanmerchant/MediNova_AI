"use client";

/**
 * What the platform has taken, and what of it is actually the platform's.
 *
 * The page leads with the flattering number because that is the one people ask
 * for — and then immediately splits it, because most of it was never MediNova AI's
 * money. It passed through on the way to a doctor or to the tax authority, and a
 * dashboard that lets "total revenue" stand unqualified is one somebody
 * eventually has to explain to an accountant.
 *
 * So the tiles are ordered as an argument: handled, then out to doctors, then
 * held for tax, then what is left — which is the only figure here that is
 * income. The amount still owed to doctors sits beside them as a debt.
 */

import { useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { ConsoleHeader, PastelTile } from "@/components/admin/console";
import {
  PageSectionNav,
  Section,
  type Section as SectionSpec,
} from "@/components/layout/PageSectionNav";
import { CategoryBars, type Bar } from "@/components/charts";
import { RevenuePanel } from "@/components/admin/RevenueChart";
import { Card, ErrorState, SkeletonRows } from "@/components/ui";
import { revenue, type RevenueGrain } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { useAsync } from "@/lib/useAsync";

function figure(value: string): string {
  return new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function amount(value: string, currency: string): string {
  return `${currency} ${figure(value)}`;
}

const SECTIONS: Array<SectionSpec & { words: [string, string] }> = [
  { id: "totals", label: "", words: ["Totals", "Kul"], icon: "payments" },
  { id: "over-time", label: "", words: ["Over time", "Waqt ke saath"], icon: "bar_chart" },
  { id: "by-speciality", label: "", words: ["By speciality", "Speciality ke hisaab se"], icon: "pie_chart" },
];

export default function AdminRevenue() {
  const tr = useTr();
  const [grain, setGrain] = useState<RevenueGrain>("day");

  const summary = useAsync(() => revenue.summary(), []);
  const series = useAsync(() => revenue.series(grain), [grain]);

  const totals = summary.data;
  const currency = totals?.currency ?? "PKR";

  const specialities: Bar[] = (series.data?.bySpeciality ?? []).map((row) => ({
    label: row.label,
    value: row.amount,
  }));

  return (
    <AppShell role="ADMIN">
      <div id="main" className="space-y-6">
        <ConsoleHeader mark="revenue"
          icon="monitoring"
          eyebrow={tr("Money that has actually been paid", "Woh raqam jo waqai ada ho chuki")}
          title={tr("Revenue", "Aamdani")}
        >
          {totals ? (
            <p>
              {tr("MediNova AI has earned ", "MediNova AI ne ab tak ")}
              <b>{amount(totals.allTime.earned, currency)}</b>
              {tr(" all time, ", " kamaye, ")}
              <b>{amount(totals.thisMonth.earned, currency)}</b>
              {tr(" of it this month. Another ", " is mahine. Mazeed ")}
              <b>{amount(totals.allTime.toDoctors, currency)}</b>
              {tr(" passed straight through to doctors.", " seedha doctors ko gaye.")}
            </p>
          ) : (
            <p>{tr("Money that has actually been paid, and whose it is.", "Woh raqam jo waqai ada ho chuki, aur woh kis ki hai.")}</p>
          )}
        </ConsoleHeader>

        {summary.loading && <SkeletonRows rows={2} />}
        {summary.error && <ErrorState message={summary.error.message} onRetry={summary.reload} />}

        {totals && (
          <>
            <PageSectionNav
              mode="jump"
              label={tr("Sections", "Hisse")}
              sections={SECTIONS.map(({ words, ...section }) => ({ ...section, label: tr(...words) }))}
            />

            <Section id="totals">
<Card>
              <p className="text-[11px] font-bold uppercase tracking-wider text-faint">
                {tr("Handled all time", "Ab tak kul raqam")}
              </p>
              <p className="font-display text-[2.4rem] font-bold whitespace-nowrap tabular-nums text-strong sm:text-5xl">
                {amount(totals.allTime.handled, currency)}
              </p>
              <p className="mt-1 text-sm text-muted">
                {tr(
                  `Across ${totals.allTime.invoices} paid invoices · ${amount(totals.thisMonth.handled, currency)} this month`,
                  `${totals.allTime.invoices} ada shuda invoices · is mahine ${amount(totals.thisMonth.handled, currency)}`,
                )}
              </p>

              {/* Ordered as an argument: what came in, what left, what stayed. */}
              <div className="stagger mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <PastelTile
                  pastel="sky"
                  icon="stethoscope"
                  label={tr("Paid to doctors", "Doctors ko gaya")}
                  unit={currency}
                  value={figure(totals.allTime.toDoctors)}
                  note={tr("Consultation fees — never ours.", "Consultation fees — kabhi hamari nahi.")}
                />
                <PastelTile
                  pastel="lilac"
                  icon="account_balance"
                  label={tr("Held for tax", "Tax ke liye roka")}
                  unit={currency}
                  value={figure(totals.allTime.tax)}
                  note={tr("Collected for the state, not income.", "Riyasat ke liye jama, aamdani nahi.")}
                />
                <PastelTile
                  pastel="mint"
                  icon="monitoring"
                  label={tr("MediNova AI earned", "MediNova AI ki kamai")}
                  unit={currency}
                  value={figure(totals.allTime.earned)}
                  note={tr("Platform fees and late charges.", "Platform fees aur der ke charges.")}
                  chip={{ text: tr("Ours", "Hamari"), tone: "good" }}
                />
                <PastelTile
                  pastel="butter"
                  icon="account_balance_wallet"
                  label={tr("Owed to doctors", "Doctors ko dena hai")}
                  unit={currency}
                  value={figure(totals.owedToDoctors)}
                  note={tr("Credited but not yet withdrawn.", "Credit ho chuka, abhi nikala nahi.")}
                  href="/admin/withdrawals"
                />
              </div>

              {/* The second business. Kept as its own line rather than folded
                  into "earned": medicine sales are gross takings, and the
                  margin on them is the pharmacy's dashboard's question. */}
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <PastelTile
                  pastel="blush"
                  icon="medication"
                  label={tr("Pharmacy sales", "Pharmacy ki farokht")}
                  unit={currency}
                  value={figure(totals.allTime.pharmacySales)}
                  note={tr(
                    `${totals.allTime.pharmacyOrders} paid orders · ${amount(totals.thisMonth.pharmacySales, currency)} this month`,
                    `${totals.allTime.pharmacyOrders} ada shuda orders · is mahine ${amount(totals.thisMonth.pharmacySales, currency)}`,
                  )}
                  href="/admin/pharmacy"
                />
                <PastelTile
                  pastel="mint"
                  icon="savings"
                  label={tr("Platform revenue", "Platform ki aamdani")}
                  unit={currency}
                  value={figure(totals.allTime.platformRevenue)}
                  note={tr(
                    "Fees, late charges and medicine sales — before costs.",
                    "Fees, der ke charges aur dawaon ki farokht — kharche se pehle.",
                  )}
                />
              </div>
            </Card>

            
            </Section>

            <Section id="over-time">
              <RevenuePanel
                className="mt-6"
                grain={grain}
                onGrain={setGrain}
                currency={currency}
                points={series.data?.points}
                loading={series.loading}
                error={series.error}
                onRetry={series.reload}
              />
            </Section>

            <Section id="by-speciality">
            {specialities.length > 0 && (
              <Card icon="pie_chart" title={tr("By speciality", "Speciality ke hisaab se")}>
                <CategoryBars
                  bars={specialities}
                  currency={currency}
                  label={tr(
                    "Where the money came from",
                    "Raqam kahan se aayi",
                  )}
                />
                <p className="mt-4 flex items-start gap-2 text-xs text-muted">
                  <Icon name="info" className="mt-0.5 shrink-0 text-[15px]" />
                  {tr(
                    "Grouped by each doctor's current speciality, so a doctor who changes speciality takes their past income with them.",
                    "Har doctor ki maujooda speciality ke hisaab se — speciality badalne par purani aamdani bhi saath chali jaati hai.",
                  )}
                </p>
              </Card>
            )}
              </Section>

              
          </>
        )}
      </div>
    </AppShell>
  );
}
