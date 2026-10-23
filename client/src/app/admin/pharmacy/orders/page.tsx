"use client";

/**
 * Every medicine order, filtered to the work in front of the pharmacy.
 *
 * The filter lives in the address so a link from the overview — "3
 * prescriptions to check" — lands on exactly those three, and a reload keeps
 * the view somebody was working through.
 */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { ConsoleHeader, FinishedState, MedicinePack } from "@/components/admin/console";
import { PharmacyAdminTabs } from "@/components/pharmacy/AdminTabs";
import { OrderStatusBadge, rupees } from "@/components/pharmacy/shared";
import { Badge, Card, EmptyState, ErrorState, Input, Loading, SkeletonRows, cx } from "@/components/ui";
import { pharmacy, type OrderStatus } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { PAGE_REFRESH_MS, useAsync } from "@/lib/useAsync";

type Filter =
  | { kind: "all" }
  | { kind: "queue"; queue: "rx-review" | "refunds" | "open" }
  | { kind: "status"; status: OrderStatus };

/** Filters that are somebody's work rather than a record: empty means done. */
const WORK_QUEUES = new Set(["rx-review", "CONFIRMED", "PACKED", "refunds"]);

const FILTERS: { key: string; label: [string, string]; filter: Filter }[] = [
  { key: "open", label: ["Open", "Khule"], filter: { kind: "queue", queue: "open" } },
  { key: "rx-review", label: ["Prescriptions to check", "Nuskhe check karne"], filter: { kind: "queue", queue: "rx-review" } },
  { key: "CONFIRMED", label: ["To pack", "Pack karna"], filter: { kind: "status", status: "CONFIRMED" } },
  { key: "PACKED", label: ["To dispatch", "Bhejna"], filter: { kind: "status", status: "PACKED" } },
  { key: "DISPATCHED", label: ["On the way", "Raste mein"], filter: { kind: "status", status: "DISPATCHED" } },
  { key: "AWAITING_PAYMENT", label: ["Awaiting payment", "Payment baqi"], filter: { kind: "status", status: "AWAITING_PAYMENT" } },
  { key: "PENDING_RX", label: ["Waiting on prescription", "Nuskhe ka intezar"], filter: { kind: "status", status: "PENDING_RX" } },
  { key: "DELIVERED", label: ["Delivered", "Pahunch gaye"], filter: { kind: "status", status: "DELIVERED" } },
  { key: "refunds", label: ["Refunds due", "Wapsi baqi"], filter: { kind: "queue", queue: "refunds" } },
  { key: "CANCELLED", label: ["Cancelled", "Mansookh"], filter: { kind: "status", status: "CANCELLED" } },
  { key: "all", label: ["All", "Sab"], filter: { kind: "all" } },
];

function OrdersBoard() {
  const tr = useTr();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState("");

  const key = params.get("queue") ?? params.get("status") ?? "open";
  const active = FILTERS.find((entry) => entry.key === key) ?? FILTERS[0];
  const filter = active.filter;

  const list = useAsync(
    () =>
      pharmacy.orders({
        limit: 50,
        search: search.trim() || undefined,
        ...(filter.kind === "queue" ? { queue: filter.queue } : {}),
        ...(filter.kind === "status" ? { status: filter.status } : {}),
      }),
    [key, search],
    { refreshMs: PAGE_REFRESH_MS },
  );
  const rows = list.data?.data ?? [];

  const choose = (entry: (typeof FILTERS)[number]) => {
    const next = new URLSearchParams();
    if (entry.filter.kind === "queue") next.set("queue", entry.filter.queue);
    if (entry.filter.kind === "status") next.set("status", entry.filter.status);
    if (entry.filter.kind === "all") next.set("queue", "all");
    router.replace(`${pathname}?${next.toString()}`);
  };

  return (
    <div className="mt-6 space-y-4">
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTERS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            aria-pressed={entry.key === active.key}
            onClick={() => choose(entry)}
            className={cx(
              "inline-flex min-h-9 shrink-0 items-center rounded-full px-3.5 text-[13px] font-semibold transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              entry.key === active.key
                ? "bg-primary text-primary-on"
                : "border border-line bg-card text-muted hover:border-primary hover:text-strong",
            )}
          >
            {tr(...entry.label)}
          </button>
        ))}
      </div>

      <Input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={tr("Search by order number, name, phone or city", "Order number, naam, phone ya shehar se dhoondein")}
        aria-label={tr("Search orders", "Orders dhoondein")}
      />

      {list.loading && !list.data ? (
        <SkeletonRows rows={4} />
      ) : list.error ? (
        <ErrorState message={list.error.message} onRetry={list.reload} />
      ) : rows.length === 0 && WORK_QUEUES.has(active.key) && !search.trim() ? (
        <FinishedState
          title={tr("Nothing waiting here", "Yahan kuchh baqi nahi")}
          description={tr("Orders that reach this step will appear here.", "Is marhale par aane wale orders yahan aayenge.")}
        />
      ) : rows.length === 0 ? (
        <EmptyState icon="inbox" title={tr("Nothing here", "Yahan kuchh nahi")} description={tr("Orders that match will appear here.", "Milte julte orders yahan nazar aayenge.")} />
      ) : (
        <Card flush>
          <ul className="divide-y divide-line">
            {rows.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/admin/pharmacy/orders/${order.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 transition-colors hover:bg-gradient-soft focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
                >
                  {/* The first item's pack: what is in the bag, before the words. */}
                  {order.items[0] && <MedicinePack form={order.items[0].form} />}
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-semibold tabular-nums text-strong">
                      {order.orderNumber}
                      {order.refundDue && <Badge tone="critical">{tr("Refund due", "Wapsi baqi")}</Badge>}
                      {order.status === "PENDING_RX" && order.rxRoute === "UPLOAD" && order.hasRxUpload && (
                        <Badge tone="warning">{tr("Check prescription", "Nuskha check karein")}</Badge>
                      )}
                    </p>
                    <p className="truncate text-sm text-muted">
                      {order.patientName ?? order.recipientName} · {order.city} ·{" "}
                      {order.items[0]
                        ? order.items.length > 1
                          ? tr(
                              `${order.items[0].productName} + ${order.items.length - 1} more`,
                              `${order.items[0].productName} + ${order.items.length - 1} aur`,
                            )
                          : order.items[0].productName
                        : tr("No items", "Koi cheez nahi")}
                    </p>
                    <p className="text-xs tabular-nums text-faint">
                      {new Date(order.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      {" · "}
                      {order.paymentMethod === "COD" ? tr("Cash on delivery", "Cash on delivery") : tr("Online", "Online")}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span className="font-display font-bold tabular-nums text-strong">{rupees(order.total)}</span>
                    <OrderStatusBadge status={order.status} />
                  </div>
                  <Icon name="chevron_right" className="text-[22px] text-faint" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export default function PharmacyOrders() {
  const tr = useTr();
  const summary = useAsync(() => pharmacy.dashboard(), [], { refreshMs: PAGE_REFRESH_MS });
  const data = summary.data;
  const toPack = data?.ordersByStatus.CONFIRMED ?? 0;
  return (
    <AppShell role="ADMIN">
      <div id="main">
        <ConsoleHeader mark="orders"
          icon="local_shipping"
          eyebrow={tr("Pharmacy", "Pharmacy")}
          title={tr("Orders", "Orders")}
        >
          {data ? (
            <p>
              <b>
                {data.openOrders} {tr(data.openOrders === 1 ? "order" : "orders", "orders")}
              </b>{" "}
              {tr("on the move.", "chal rahe hain.")}{" "}
              {data.prescriptionsToCheck > 0 && (
                <>
                  <Link href="/admin/pharmacy/orders?queue=rx-review">
                    {tr(
                      `${data.prescriptionsToCheck} ${data.prescriptionsToCheck === 1 ? "prescription" : "prescriptions"} to check`,
                      `${data.prescriptionsToCheck} nuskhe check karne hain`,
                    )}
                  </Link>
                  {toPack > 0 ? tr(", ", ", ") : ". "}
                </>
              )}
              {toPack > 0 && (
                <>
                  <Link href="/admin/pharmacy/orders?status=CONFIRMED">
                    {tr(`${toPack} to pack`, `${toPack} pack karne hain`)}
                  </Link>
                  .
                </>
              )}
            </p>
          ) : (
            <p>{tr("Check prescriptions, pack, dispatch and deliver.", "Nuskhe check karein, pack, rawana aur deliver karein.")}</p>
          )}
        </ConsoleHeader>
        <div className="mt-6">
          <PharmacyAdminTabs />
        </div>
        <Suspense fallback={<Loading />}>
          <OrdersBoard />
        </Suspense>
      </div>
    </AppShell>
  );
}
