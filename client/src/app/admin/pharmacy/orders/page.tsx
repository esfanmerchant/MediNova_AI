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
import {
  ConsoleHeader,
  FinishedState,
  MedicinePack,
  Pager,
  StatusPill,
  consoleStamp,
} from "@/components/admin/console";
import { RowMenu } from "@/components/admin/RowMenu";
import { Segmented } from "@/components/forms";
import { AdminOrderStatus, PharmacyAdminTabs } from "@/components/pharmacy/AdminTabs";
import { rupees } from "@/components/pharmacy/shared";
import { EmptyState, ErrorState, Loading, SkeletonRows } from "@/components/ui";
import { pharmacy, type OrderStatus, type PharmacyDashboard } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { PAGE_REFRESH_MS, useAsync } from "@/lib/useAsync";

type Filter =
  | { kind: "all" }
  | { kind: "queue"; queue: "rx-review" | "refunds" | "open" }
  | { kind: "status"; status: OrderStatus };

/** Filters that are somebody's work rather than a record: empty means done. */
const WORK_QUEUES = new Set(["rx-review", "CONFIRMED", "PACKED", "refunds"]);

/** Twenty to a page; the open queue rarely needs a second. */
const PAGE = 20;

type Entry = { key: string; label: [string, string]; filter: Filter; count?: (data: PharmacyDashboard) => number };

/** The work, as tabs: what an order is waiting on, in the order it moves. */
const MAIN: Entry[] = [
  { key: "open", label: ["Open", "Khule"], filter: { kind: "queue", queue: "open" }, count: (data) => data.openOrders },
  {
    key: "rx-review",
    label: ["Prescriptions to check", "Nuskhe check karne"],
    filter: { kind: "queue", queue: "rx-review" },
    count: (data) => data.prescriptionsToCheck,
  },
  { key: "CONFIRMED", label: ["To pack", "Pack karna"], filter: { kind: "status", status: "CONFIRMED" }, count: (data) => data.ordersByStatus.CONFIRMED ?? 0 },
  { key: "PACKED", label: ["To dispatch", "Bhejna"], filter: { kind: "status", status: "PACKED" }, count: (data) => data.ordersByStatus.PACKED ?? 0 },
  { key: "DISPATCHED", label: ["On the way", "Raste mein"], filter: { kind: "status", status: "DISPATCHED" }, count: (data) => data.ordersByStatus.DISPATCHED ?? 0 },
];

/** The records, and the waits nobody here can hurry, behind "More". */
const MORE: Entry[] = [
  { key: "AWAITING_PAYMENT", label: ["Awaiting payment", "Payment baqi"], filter: { kind: "status", status: "AWAITING_PAYMENT" }, count: (data) => data.ordersByStatus.AWAITING_PAYMENT ?? 0 },
  { key: "PENDING_RX", label: ["Waiting on prescription", "Nuskhe ka intezar"], filter: { kind: "status", status: "PENDING_RX" }, count: (data) => data.ordersByStatus.PENDING_RX ?? 0 },
  { key: "DELIVERED", label: ["Delivered", "Pahunch gaye"], filter: { kind: "status", status: "DELIVERED" }, count: (data) => data.ordersByStatus.DELIVERED ?? 0 },
  { key: "refunds", label: ["Refunds due", "Wapsi baqi"], filter: { kind: "queue", queue: "refunds" }, count: (data) => data.refundsDue },
  { key: "CANCELLED", label: ["Cancelled", "Mansookh"], filter: { kind: "status", status: "CANCELLED" }, count: (data) => data.ordersByStatus.CANCELLED ?? 0 },
  { key: "all", label: ["All", "Sab"], filter: { kind: "all" } },
];

const FILTERS = [...MAIN, ...MORE];

function OrdersBoard({ summary }: { summary: PharmacyDashboard | undefined }) {
  const tr = useTr();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);

  const key = params.get("queue") ?? params.get("status") ?? "open";
  const active = FILTERS.find((entry) => entry.key === key) ?? FILTERS[0];
  const filter = active.filter;
  const inMore = MORE.some((entry) => entry.key === active.key);

  const list = useAsync(
    () =>
      pharmacy.orders({
        limit: PAGE,
        offset,
        search: search.trim() || undefined,
        ...(filter.kind === "queue" ? { queue: filter.queue } : {}),
        ...(filter.kind === "status" ? { status: filter.status } : {}),
      }),
    [key, search, offset],
    { refreshMs: PAGE_REFRESH_MS },
  );
  const rows = list.data?.data ?? [];

  const choose = (entry: Entry) => {
    const next = new URLSearchParams();
    if (entry.filter.kind === "queue") next.set("queue", entry.filter.queue);
    if (entry.filter.kind === "status") next.set("status", entry.filter.status);
    if (entry.filter.kind === "all") next.set("queue", "all");
    setOffset(0);
    router.replace(`${pathname}?${next.toString()}`);
  };

  return (
    <section
      aria-label={tr("Orders", "Orders")}
      className="rise-in mt-6 overflow-hidden rounded-3xl border border-line bg-card shadow-card"
    >
      <div className="flex flex-wrap items-center gap-3 px-[18px] py-4">
        <Segmented
          options={MAIN.map((entry) => ({
            value: entry.key,
            label: tr(...entry.label),
            count: summary && entry.count ? entry.count(summary) : undefined,
          }))}
          // A choice behind "More" leaves no tab raised.
          value={inMore ? "" : active.key}
          onChange={(value) => choose(MAIN.find((entry) => entry.key === value) ?? MAIN[0])}
          label={tr("Orders to show", "Kaun se orders")}
        />
        <RowMenu
          label={tr("More order lists", "Mazeed order lists")}
          trigger={inMore ? tr(...active.label) : tr("More", "Mazeed")}
          active={inMore}
          align="start"
          items={MORE.map((entry) => ({
            label: tr(...entry.label),
            hint: summary && entry.count ? String(entry.count(summary)) : undefined,
            onSelect: () => choose(entry),
          }))}
        />
        <label className="flex h-10 w-full items-center gap-2.5 rounded-full border border-line-strong bg-card pr-3 pl-3.5 text-muted focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary sm:ml-auto sm:w-auto sm:max-w-[340px] sm:min-w-[220px] sm:flex-1">
          <Icon name="search" className="text-[18px]" />
          <input
            type="search"
            aria-label={tr("Search orders", "Orders dhoondein")}
            placeholder={tr("Order number, name, phone or city", "Order number, naam, phone ya shehar")}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setOffset(0);
            }}
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-strong outline-none placeholder:text-muted"
          />
        </label>
      </div>

      {list.loading && !list.data ? (
        <div className="px-[18px] pb-5">
          <SkeletonRows rows={4} title={false} />
        </div>
      ) : list.error ? (
        <div className="px-[18px] pb-5">
          <ErrorState message={list.error.message} onRetry={list.reload} />
        </div>
      ) : rows.length === 0 && WORK_QUEUES.has(active.key) && !search.trim() ? (
        <FinishedState
          title={tr("Nothing waiting here", "Yahan kuchh baqi nahi")}
          description={tr("Orders that reach this step will appear here.", "Is marhale par aane wale orders yahan aayenge.")}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="inbox"
          title={tr("Nothing here", "Yahan kuchh nahi")}
          description={tr("Orders that match will appear here.", "Milte julte orders yahan nazar aayenge.")}
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="console-table min-w-[60rem]">
              <thead>
                <tr>
                  <th scope="col">{tr("Order", "Order")}</th>
                  <th scope="col">{tr("Patient", "Mareez")}</th>
                  <th scope="col">{tr("Medicines", "Dawaiyan")}</th>
                  <th scope="col">{tr("Placed", "Diya gaya")}</th>
                  <th scope="col">{tr("Payment", "Adaigi")}</th>
                  <th scope="col" className="text-right">
                    {tr("Total", "Kul")}
                  </th>
                  <th scope="col">{tr("Status", "Haalat")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((order) => {
                  const href = `/admin/pharmacy/orders/${order.id}`;
                  const checkRx = order.status === "PENDING_RX" && order.rxRoute === "UPLOAD" && order.hasRxUpload;
                  return (
                    <tr key={order.id} onClick={() => router.push(href)} className="cursor-pointer">
                      <td>
                        <div className="flex items-center gap-[11px]">
                          {/* The first item's pack: what is in the bag, before the words. */}
                          {order.items[0] && <MedicinePack form={order.items[0].form} size={28} />}
                          <span className="flex flex-col items-start gap-[3px]">
                            <Link
                              href={href}
                              onClick={(event) => event.stopPropagation()}
                              className="rounded font-mono text-[12.5px] font-semibold whitespace-nowrap text-strong hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                            >
                              {order.orderNumber}
                            </Link>
                            {order.refundDue && <StatusPill tone="critical">{tr("Refund due", "Wapsi baqi")}</StatusPill>}
                            {checkRx && <StatusPill tone="warning">{tr("Check prescription", "Nuskha check karein")}</StatusPill>}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className="block font-semibold whitespace-nowrap">{order.patientName ?? order.recipientName}</span>
                        <span className="block text-[12.5px] text-muted">{order.city}</span>
                      </td>
                      <td className="max-w-[14rem] truncate text-muted">
                        {order.items[0]
                          ? order.items.length > 1
                            ? tr(
                                `${order.items[0].productName} + ${order.items.length - 1} more`,
                                `${order.items[0].productName} + ${order.items.length - 1} aur`,
                              )
                            : order.items[0].productName
                          : tr("No items", "Koi cheez nahi")}
                      </td>
                      <td className="whitespace-nowrap text-muted tabular-nums">{consoleStamp(order.createdAt)}</td>
                      <td>
                        <StatusPill>
                          {order.paymentMethod === "COD" ? tr("Cash on delivery", "Cash on delivery") : tr("Online", "Online")}
                        </StatusPill>
                      </td>
                      <td className="text-right font-semibold whitespace-nowrap tabular-nums">{rupees(order.total)}</td>
                      <td>
                        <AdminOrderStatus status={order.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager offset={offset} limit={PAGE} total={list.data?.meta.total ?? rows.length} onChange={setOffset} />
        </>
      )}
    </section>
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
        <ConsoleHeader mark="orders" eyebrow={tr("Pharmacy", "Pharmacy")} title={tr("Orders", "Orders")}>
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
          <PharmacyAdminTabs openOrders={data?.openOrders} />
        </div>
        <Suspense fallback={<Loading />}>
          <OrdersBoard summary={data ?? undefined} />
        </Suspense>
      </div>
    </AppShell>
  );
}
