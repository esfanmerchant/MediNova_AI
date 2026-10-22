"use client";

/**
 * The pharmacy at a glance: what sold, what is waiting on somebody, and what
 * is about to run out.
 *
 * The queues come first because they are work. A prescription waiting to be
 * checked is a patient waiting for medicine; a refund due is somebody's money.
 */

import Link from "next/link";

import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { PharmacyAdminTabs } from "@/components/pharmacy/AdminTabs";
import { productTitle, rupees } from "@/components/pharmacy/shared";
import { Badge, Card, EmptyState, ErrorState, SkeletonTiles, StatTile } from "@/components/ui";
import { pharmacy } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { useAsync } from "@/lib/useAsync";

export default function PharmacyOverview() {
  const tr = useTr();
  const summary = useAsync(() => pharmacy.dashboard(), []);
  const data = summary.data;

  return (
    <AppShell role="ADMIN">
      <div id="main">
        <PageHeader
          eyebrow={tr("Administration", "Intezamiya")}
          title={tr("Pharmacy", "Pharmacy")}
          subtitle={tr(
            "Medicine sales, orders to move, and stock to watch.",
            "Dawaon ki farokht, aage barhane wale orders, aur stock par nazar.",
          )}
        />
        <div className="mt-6">
          <PharmacyAdminTabs />
        </div>

        {summary.loading && !data ? (
          <div className="mt-6">
            <SkeletonTiles count={4} />
          </div>
        ) : summary.error ? (
          <div className="mt-6">
            <ErrorState message={summary.error.message} onRetry={summary.reload} />
          </div>
        ) : data ? (
          <div className="mt-6 space-y-6">
            <div className="stagger grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatTile
                label={tr("Sales today", "Aaj ki farokht")}
                value={rupees(data.salesToday)}
                hint={tr(`${data.paidOrdersToday} paid`, `${data.paidOrdersToday} ada shuda`)}
                icon={<Icon name="payments" filled />}
                className="col-span-2 lg:col-span-1"
              />
              <StatTile
                label={tr("This month", "Is mahine")}
                value={rupees(data.salesThisMonth)}
                hint={tr(`${data.paidOrdersThisMonth} paid orders`, `${data.paidOrdersThisMonth} ada shuda orders`)}
                icon={<Icon name="calendar_month" filled />}
                className="col-span-2 lg:col-span-1"
              />
              <StatTile
                label={tr("Open orders", "Khule orders")}
                value={data.openOrders}
                href="/admin/pharmacy/orders"
                icon={<Icon name="local_shipping" filled />}
              />
              <StatTile
                label={tr("Margin this month", "Is mahine ka munafa")}
                value={rupees(data.marginThisMonth)}
                hint={tr(
                  `On ${data.marginCoveragePercent}% of sales with a cost price`,
                  `Cost price wali ${data.marginCoveragePercent}% farokht par`,
                )}
                icon={<Icon name="trending_up" filled />}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatTile
                label={tr("Prescriptions to check", "Nuskhe check karne hain")}
                value={data.prescriptionsToCheck}
                tone={data.prescriptionsToCheck > 0 ? "warning" : "neutral"}
                href="/admin/pharmacy/orders?queue=rx-review"
                icon={<Icon name="prescriptions" filled />}
              />
              <StatTile
                label={tr("Refunds due", "Wapsi baqi")}
                value={data.refundsDue}
                tone={data.refundsDue > 0 ? "critical" : "neutral"}
                href="/admin/pharmacy/orders?queue=refunds"
                icon={<Icon name="currency_exchange" filled />}
              />
              <StatTile
                label={tr("Running low", "Kam stock")}
                value={data.lowStockCount}
                tone={data.lowStockCount > 0 ? "warning" : "neutral"}
                href="/admin/pharmacy/catalog?lowStock=1"
                icon={<Icon name="inventory" filled />}
              />
            </div>

            {data.unreviewedPrices > 0 && (
              <Link
                href="/admin/pharmacy/catalog?unreviewed=1"
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-warning/40 bg-warning-soft p-4 text-sm text-strong hover:shadow-card"
              >
                <Icon name="price_check" filled className="text-[24px] text-warning" />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">
                    {tr(
                      `${data.unreviewedPrices} starter prices have not been checked yet.`,
                      `${data.unreviewedPrices} starter qeematein abhi check nahi hui.`,
                    )}
                  </span>{" "}
                  {tr(
                    "They are estimates — confirm each against the pack's DRAP maximum retail price before selling.",
                    "Yeh andaze hain — bechne se pehle har aik ko pack ki DRAP MRP se mila lein.",
                  )}
                </span>
                <Icon name="arrow_forward" className="text-[20px]" />
              </Link>
            )}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card icon="star" title={tr("Best sellers", "Sab se zyada bikne wali")} description={tr("Last 30 days", "Pichhle 30 din")}>
                {data.bestSellers.length === 0 ? (
                  <EmptyState icon="bar_chart" title={tr("No sales yet", "Abhi koi farokht nahi")} />
                ) : (
                  <ol className="space-y-3">
                    {data.bestSellers.map((row, index) => (
                      <li key={`${row.productId}-${row.name}`} className="flex items-center gap-3">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sunken text-sm font-bold tabular-nums text-muted">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-semibold text-strong">{row.name}</span>
                        <span className="text-sm tabular-nums text-muted">× {row.quantity}</span>
                        <span className="w-24 text-right font-semibold tabular-nums text-strong">{rupees(row.revenue)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>

              <Card icon="inventory" title={tr("Running low", "Kam stock")} description={tr("At or below their reorder level", "Reorder level par ya kam")}>
                {data.lowStock.length === 0 ? (
                  <EmptyState icon="check_circle" title={tr("Everything is stocked", "Sab stock mein hai")} />
                ) : (
                  <ul className="divide-y divide-line">
                    {data.lowStock.map((product) => (
                      <li key={product.id} className="flex items-center gap-3 py-2.5">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-strong">{productTitle(product)}</span>
                          <span className="block text-xs text-muted">{product.packSize}</span>
                        </span>
                        <Badge tone={(product.stock ?? 0) === 0 ? "critical" : "warning"}>
                          {(product.stock ?? 0) === 0 ? tr("Out", "Khatam") : tr(`${product.stock} left`, `${product.stock} baqi`)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <Card icon="stacked_bar_chart" title={tr("Orders by stage", "Marhalon ke hisaab se orders")}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                {(
                  [
                    ["PENDING_RX", "Prescription", "Nuskha"],
                    ["AWAITING_PAYMENT", "Awaiting payment", "Payment baqi"],
                    ["CONFIRMED", "To pack", "Pack karna"],
                    ["PACKED", "To dispatch", "Bhejna"],
                    ["DISPATCHED", "On the way", "Raste mein"],
                    ["DELIVERED", "Delivered", "Pahunch gaye"],
                    ["CANCELLED", "Cancelled", "Mansookh"],
                  ] as const
                ).map(([status, en, ur]) => (
                  <Link
                    key={status}
                    href={`/admin/pharmacy/orders?status=${status}`}
                    className="rounded-xl border border-line bg-card p-3 text-center transition-shadow hover:shadow-card"
                  >
                    <span className="block font-display text-2xl font-bold tabular-nums text-strong">
                      {data.ordersByStatus[status] ?? 0}
                    </span>
                    <span className="block text-xs text-muted">{tr(en, ur)}</span>
                  </Link>
                ))}
              </div>
            </Card>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
