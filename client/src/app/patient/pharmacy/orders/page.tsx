"use client";

/** Every medicine order this patient has placed, newest first. */

import Link from "next/link";

import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { OrderStatusBadge, rupees } from "@/components/pharmacy/shared";
import { Card, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import { pharmacy } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { PAGE_REFRESH_MS, useAsync } from "@/lib/useAsync";

export default function MyOrders() {
  const tr = useTr();
  const orders = useAsync(() => pharmacy.orders({ limit: 50 }), [], { refreshMs: PAGE_REFRESH_MS });
  const rows = orders.data?.data ?? [];

  return (
    <AppShell role="PATIENT">
      <div id="main" className="page-enter">
        <Link
          href="/patient/pharmacy"
          className="group inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
        >
          <Icon name="arrow_back" className="text-[18px] transition-transform group-hover:-translate-x-0.5" />
          {tr("Back to the pharmacy", "Pharmacy par wapas")}
        </Link>
        <PageHeader
          eyebrow="MediNova Pharmacy"
          title={tr("My orders", "Mere orders")}
          subtitle={tr("Where each order is, and what it needs from you.", "Har order kahan hai, aur aap se kya chahiye.")}
        />

        <div className="mt-6">
          {orders.loading && !orders.data ? (
            <SkeletonRows rows={4} />
          ) : orders.error ? (
            <ErrorState message={orders.error.message} onRetry={orders.reload} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon="receipt_long"
              title={tr("No orders yet", "Abhi koi order nahi")}
              description={tr("Medicines you order will appear here, with their tracking.", "Aap ke orders tracking ke saath yahan nazar aayenge.")}
              action={
                <Link href="/patient/pharmacy" className="inline-flex min-h-11 items-center rounded-xl bg-gradient-brand px-4 font-semibold text-white">
                  {tr("Browse medicines", "Dawaiyan dekhein")}
                </Link>
              }
            />
          ) : (
            <Card flush>
              <ul className="divide-y divide-line">
                {rows.map((order) => {
                  const needsYou =
                    (order.status === "PENDING_RX" && order.rxRoute === "UPLOAD" && !order.hasRxUpload) ||
                    (order.status === "AWAITING_PAYMENT" && !order.invoice?.awaitingReview);
                  return (
                    <li key={order.id}>
                      <Link
                        href={`/patient/pharmacy/orders/${order.id}`}
                        className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 transition-colors hover:bg-gradient-soft focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
                      >
                        <span aria-hidden className="bg-gradient-soft grid h-11 w-11 shrink-0 place-items-center rounded-xl text-primary">
                          <Icon name="medication" className="text-[22px]" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold tabular-nums text-strong">{order.orderNumber}</p>
                          <p className="truncate text-sm text-muted">
                            {order.items.map((item) => item.productName).join(", ")}
                          </p>
                          <p className="text-xs tabular-nums text-faint">
                            {new Date(order.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <span className="font-display font-bold tabular-nums text-strong">{rupees(order.total)}</span>
                          <OrderStatusBadge status={order.status} />
                          {needsYou && (
                            <span className="text-xs font-semibold text-warning">
                              {tr("Needs you", "Aap ka intezar")}
                            </span>
                          )}
                        </div>
                        <Icon name="chevron_right" className="text-[22px] text-faint" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </AppShell>
  );
}
