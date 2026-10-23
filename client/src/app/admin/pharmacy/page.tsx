"use client";

/**
 * The pharmacy at a glance: what sold, what is waiting on somebody, and what
 * is about to run out.
 *
 * The header says the queues out loud; the board shows them. Every open order
 * sits in the column for what it is waiting on — a prescription, a payment, a
 * pair of hands to pack it, a rider — so the counter can see the whole day in
 * one look. A refund due is somebody's money and gets a strip of its own above
 * everything else.
 */

import Link from "next/link";
import { Fragment, useState, type DragEvent } from "react";

import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import {
  CardLink,
  ConsoleCard,
  ConsoleHeader,
  ConsoleLoading,
  FinishedState,
  HeaderPill,
  MedicinePack,
  PastelTile,
} from "@/components/admin/console";
import { PharmacyAdminTabs } from "@/components/pharmacy/AdminTabs";
import { productTitle, rupees } from "@/components/pharmacy/shared";
import { ErrorState, SkeletonRows, cx } from "@/components/ui";
import { ApiError, pharmacy, type Order, type OrderStatus } from "@/lib/api";
import { useLang, useTr } from "@/lib/lang";
import { PAGE_REFRESH_MS, useAsync } from "@/lib/useAsync";

/** The board's columns: every open status, in the order an order moves through them. */
const COLUMNS: Array<{ status: OrderStatus; label: [string, string]; dot: string; empty: [string, string] }> = [
  { status: "PENDING_RX", label: ["Prescription", "Nuskha"], dot: "bg-[#8B5CF6]", empty: ["None waiting", "Koi nahi"] },
  { status: "AWAITING_PAYMENT", label: ["Awaiting payment", "Payment baqi"], dot: "bg-[#F59E0B]", empty: ["All paid", "Sab ada"] },
  { status: "CONFIRMED", label: ["To pack", "Pack karna"], dot: "bg-[#0B3FA8] dark:bg-[#7DA2FF]", empty: ["Nothing to pack", "Pack ko kuchh nahi"] },
  { status: "PACKED", label: ["To dispatch", "Bhejna"], dot: "bg-[#0E7490] dark:bg-[#5FD3E8]", empty: ["Nothing to send", "Bhejne ko kuchh nahi"] },
  { status: "DISPATCHED", label: ["On the way", "Raste mein"], dot: "bg-[#0F766E] dark:bg-[#5EEAD4]", empty: ["None out", "Koi raste mein nahi"] },
];

/** A figure with the currency left to the tile, which sets it small before. */
function figure(value: string): string {
  return new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

/** How many tickets a column shows before it says "+ n more". */
const COLUMN_DEPTH = 3;

/** "2 h ago", "yesterday", "2 days ago" — a ticket's age, as the counter says it. */
function ticketAge(iso: string, now: number, urdu: boolean): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return urdu ? `${minutes} min pehle` : `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return urdu ? `${hours} ghante pehle` : `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return urdu ? "kal" : "yesterday";
  return urdu ? `${days} din pehle` : `${days} days ago`;
}

/** The three packs the price check is about: a bottle, a capsule, a blister. */
function PackArt() {
  return (
    <span aria-hidden className="flex">
      <span className="grid h-[52px] w-[52px] -rotate-6 place-items-center rounded-[14px] bg-white/70">
        <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
          <rect x="10" y="9" width="14" height="20" rx="3" fill="#E8F0FE" stroke="#0B3FA8" strokeWidth="1.6" />
          <rect x="12" y="4" width="10" height="5" rx="1.5" fill="#0B3FA8" />
          <rect x="12.5" y="15" width="9" height="6" rx="1" fill="#5EEAD4" />
        </svg>
      </span>
      <span className="relative z-[1] -ml-2.5 grid h-[52px] w-[52px] place-items-center rounded-[14px] bg-white/85">
        <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
          <rect x="5" y="13" width="24" height="9" rx="4.5" fill="#FFFFFF" stroke="#0B3FA8" strokeWidth="1.6" />
          <path d="M17 13v9" stroke="#0B3FA8" strokeWidth="1.6" />
          <path d="M17 13h7.5a4.5 4.5 0 0 1 0 9H17z" fill="#F59E0B" />
        </svg>
      </span>
      <span className="-ml-2.5 grid h-[52px] w-[52px] rotate-6 place-items-center rounded-[14px] bg-white/70">
        <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
          <rect x="5" y="9" width="24" height="16" rx="3" fill="#FFFFFF" stroke="#0B3FA8" strokeWidth="1.6" />
          {[11, 17, 23].flatMap((cx) => [14, 20].map((cy) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.2" fill="#5EEAD4" />))}
        </svg>
      </span>
    </span>
  );
}

export default function PharmacyOverview() {
  const tr = useTr();
  const urdu = useLang() === "ur";
  const summary = useAsync(() => pharmacy.dashboard(), [], { refreshMs: PAGE_REFRESH_MS });
  const open = useAsync(() => pharmacy.orders({ queue: "open", limit: 100 }), [], { refreshMs: PAGE_REFRESH_MS });
  // The price check's progress needs the catalog's size; one row is enough to learn it.
  const catalog = useAsync(() => pharmacy.products({ includeInactive: true, limit: 1 }), []);
  const data = summary.data;

  // The queues, said in the header as links — only the ones with something in them.
  const waiting = !data
    ? []
    : [
        data.prescriptionsToCheck > 0 && {
          href: "/admin/pharmacy/orders?queue=rx-review",
          text: tr(
            `${data.prescriptionsToCheck} ${data.prescriptionsToCheck === 1 ? "prescription" : "prescriptions"} to check`,
            `${data.prescriptionsToCheck} nuskhe check karne hain`,
          ),
        },
        data.refundsDue > 0 && {
          href: "/admin/pharmacy/orders?queue=refunds",
          text: tr(
            `${data.refundsDue} ${data.refundsDue === 1 ? "refund" : "refunds"} due`,
            `${data.refundsDue} wapsi baqi`,
          ),
        },
        data.lowStockCount > 0 && {
          href: "/admin/pharmacy/catalog?lowStock=1",
          text: tr(
            `${data.lowStockCount} ${data.lowStockCount === 1 ? "medicine" : "medicines"} running low`,
            `${data.lowStockCount} dawaiyan kam`,
          ),
        },
      ].filter((item): item is { href: string; text: string } => Boolean(item));

  const byStatus = new Map<OrderStatus, Order[]>();
  for (const order of open.data?.data ?? []) {
    byStatus.set(order.status, [...(byStatus.get(order.status) ?? []), order]);
  }

  // Packing is the one step the board can take by itself: every other move
  // needs something typed — a courier, a tracking number, a prescription read —
  // and those stay on the order's page. Drag a ticket from "To pack" onto "To
  // dispatch", or press its button; both do the same thing.
  const [dragging, setDragging] = useState<string | null>(null);
  const [packing, setPacking] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const pack = async (id: string) => {
    setPacking(id);
    setMoveError(null);
    try {
      await pharmacy.advance(id, "PACKED");
      open.reload();
      summary.reload();
    } catch (caught) {
      setMoveError(caught instanceof ApiError ? caught.message : tr("That order could not be marked packed.", "Order pack mark nahi ho saka."));
    } finally {
      setPacking(null);
    }
  };
  const dropZone = (status: OrderStatus) =>
    status === "PACKED"
      ? {
          onDragOver: (event: DragEvent<HTMLDivElement>) => {
            if (dragging) event.preventDefault();
          },
          onDrop: (event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const id = event.dataTransfer.getData("text/plain");
            setDragging(null);
            if (id) void pack(id);
          },
        }
      : {};

  const now = new Date().getTime();
  const totalProducts = catalog.data?.meta.total ?? 0;
  const checked = data ? Math.max(0, totalProducts - data.unreviewedPrices) : 0;
  const topRevenue = Math.max(1, ...(data?.bestSellers ?? []).map((row) => Number(row.revenue) || 0));

  return (
    <AppShell role="ADMIN">
      <div id="main">
        <ConsoleHeader
          mark="pharmacy"
          eyebrow={tr("Medicine sales, orders and stock", "Dawaon ki farokht, orders aur stock")}
          title={tr("Pharmacy", "Pharmacy")}
          actions={
            <>
              <HeaderPill href="/admin/pharmacy/catalog?lowStock=1">
                {tr("Stock to reorder", "Reorder ka stock")}
              </HeaderPill>
              <HeaderPill href="/admin/pharmacy/catalog" icon="add" tone="primary">
                {tr("Add a medicine", "Dawa shamil karein")}
              </HeaderPill>
            </>
          }
        >
          {data ? (
            <p>
              <b>{rupees(data.salesThisMonth)}</b>{" "}
              {tr(
                `in medicine this month from ${data.paidOrdersThisMonth} paid ${data.paidOrdersThisMonth === 1 ? "order" : "orders"}.`,
                `is mahine ${data.paidOrdersThisMonth} ada shuda orders se.`,
              )}{" "}
              {waiting.length === 0 ? (
                tr("Nothing is waiting on the pharmacy.", "Pharmacy par kuchh baqi nahi.")
              ) : (
                <>
                  {waiting.map((item, index) => (
                    <Fragment key={item.href}>
                      {index > 0 && (index === waiting.length - 1 ? tr(" and ", " aur ") : ", ")}
                      <Link href={item.href}>{item.text}</Link>
                    </Fragment>
                  ))}
                  .
                </>
              )}
            </p>
          ) : (
            <p>
              {tr(
                "Medicine sales, orders to move, and stock to watch.",
                "Dawaon ki farokht, aage barhane wale orders, aur stock par nazar.",
              )}
            </p>
          )}
        </ConsoleHeader>
        <div className="mt-[22px]">
          <PharmacyAdminTabs openOrders={data?.openOrders} />
        </div>

        {summary.loading && !data ? (
          <div className="mt-[22px]">
            <ConsoleLoading />
          </div>
        ) : summary.error ? (
          <div className="mt-[22px]">
            <ErrorState message={summary.error.message} onRetry={summary.reload} />
          </div>
        ) : data ? (
          <div className="mt-[22px] space-y-[22px]">
            <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <PastelTile
                pastel="mint"
                icon="payments"
                label={tr("Sales today", "Aaj ki farokht")}
                unit="PKR"
                value={figure(data.salesToday)}
                note={tr(
                  `${data.paidOrdersToday} paid ${data.paidOrdersToday === 1 ? "order" : "orders"}`,
                  `${data.paidOrdersToday} ada shuda orders`,
                )}
              />
              <PastelTile
                pastel="sky"
                icon="calendar_month"
                label={tr("This month", "Is mahine")}
                unit="PKR"
                value={figure(data.salesThisMonth)}
                note={tr(`${data.paidOrdersThisMonth} paid orders`, `${data.paidOrdersThisMonth} ada shuda orders`)}
              />
              <PastelTile
                pastel="lilac"
                icon="local_shipping"
                label={tr("Open orders", "Khule orders")}
                value={data.openOrders}
                note={tr("Placed and not yet delivered", "Diye gaye, abhi pahunche nahi")}
                href="/admin/pharmacy/orders"
              />
              <PastelTile
                pastel="butter"
                icon="trending_up"
                label={tr("Margin this month", "Is mahine ka munafa")}
                unit="PKR"
                value={figure(data.marginThisMonth)}
                note={tr(
                  `On ${Math.round(Number(data.marginCoveragePercent) || 0)}% of sales with a cost price`,
                  `Cost price wali ${Math.round(Number(data.marginCoveragePercent) || 0)}% farokht par`,
                )}
              />
            </div>

            {data.refundsDue > 0 && (
              <Link
                href="/admin/pharmacy/orders?queue=refunds"
                className="rise-in flex flex-wrap items-center gap-3.5 rounded-[18px] border border-critical/35 bg-critical-soft px-[18px] py-3.5 text-[14px] text-strong transition-shadow hover:shadow-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-card text-critical">
                  <Icon name="currency_exchange" className="text-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <b className="font-semibold text-critical">
                    {tr(
                      `${data.refundsDue} cancelled ${data.refundsDue === 1 ? "order has" : "orders have"} money to give back.`,
                      `${data.refundsDue} mansookh orders ki raqam wapas karni hai.`,
                    )}
                  </b>{" "}
                  {tr("Record each refund once it has been sent.", "Har wapsi bhejne ke baad darj karein.")}
                </span>
                <span className="inline-flex h-8 items-center px-[13px] text-[12.5px] font-semibold text-critical">
                  {tr("Record refunds →", "Wapsi darj karein →")}
                </span>
              </Link>
            )}

            {data.unreviewedPrices > 0 && (
              // The price check: the one task in the pharmacy with a law behind it.
              <section
                aria-label={tr("Price check", "Qeemat ki jaanch")}
                className="flex flex-wrap items-center gap-5 rounded-3xl bg-pastel-butter px-6 py-5 text-pastel-ink"
              >
                <PackArt />
                <div className="flex min-w-[16rem] flex-[1_1_320px] flex-col gap-1.5">
                  <p className="font-display text-[17px] font-bold">
                    {tr(
                      `${data.unreviewedPrices} starter ${data.unreviewedPrices === 1 ? "price is" : "prices are"} still estimates`,
                      `${data.unreviewedPrices} starter qeematein abhi andaze hain`,
                    )}
                  </p>
                  <p className="text-[13.5px] opacity-[0.85]">
                    {tr(
                      "Check each against the pack's DRAP maximum retail price before the pharmacy sells it.",
                      "Bechne se pehle har aik ko pack ki DRAP MRP se mila lein.",
                    )}
                  </p>
                  {totalProducts > 0 && (
                    <div className="mt-1 flex items-center gap-3">
                      <span
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={totalProducts}
                        aria-valuenow={checked}
                        aria-label={tr("Prices checked", "Check shuda qeematein")}
                        className="h-2 flex-[0_1_300px] overflow-hidden rounded-full bg-pastel-ink/10"
                      >
                        <span
                          className="bar-grow-x block h-full rounded-full bg-[#B45309] dark:bg-[#FBD27A]"
                          style={{ width: `${(checked / totalProducts) * 100}%` }}
                        />
                      </span>
                      <span className="shrink-0 text-[12.5px] font-semibold tabular-nums">
                        {tr(`${checked} of ${totalProducts} checked`, `${totalProducts} mein se ${checked} check`)}
                      </span>
                    </div>
                  )}
                </div>
                <HeaderPill href="/admin/pharmacy/catalog?unreviewed=1" tone="primary">
                  {tr("Start checking", "Check karna shuru karein")}
                </HeaderPill>
              </section>
            )}

            <ConsoleCard
              icon="view_kanban"
              title={tr("Order board", "Order board")}
              subtitle={tr(
                "Every open order, by what it is waiting for. Drag a ticket from To pack to To dispatch once it is packed.",
                "Har khula order, is hisaab se ke woh kis ka muntazir hai. Pack hone par ticket ko To pack se To dispatch mein le jayein.",
              )}
              action={<CardLink href="/admin/pharmacy/orders?queue=all">{tr("All orders →", "Tamam orders →")}</CardLink>}
              footer={
                <p className="text-[13px] text-muted">
                  <Link href="/admin/pharmacy/orders?status=DELIVERED" className="font-semibold text-strong hover:underline">
                    {tr(`${data.ordersByStatus.DELIVERED ?? 0} delivered`, `${data.ordersByStatus.DELIVERED ?? 0} pahunch gaye`)}
                  </Link>
                  {" · "}
                  <Link href="/admin/pharmacy/orders?status=CANCELLED" className="hover:underline">
                    {tr(`${data.ordersByStatus.CANCELLED ?? 0} cancelled`, `${data.ordersByStatus.CANCELLED ?? 0} mansookh`)}
                  </Link>
                </p>
              }
            >
              {moveError && (
                <p role="alert" className="mx-5 mb-3 flex items-center gap-1.5 text-sm font-medium text-critical sm:mx-6">
                  <Icon name="error" className="text-[16px]" />
                  {moveError}
                </p>
              )}
              {open.error ? (
                <div className="px-[22px] pb-[18px]">
                  <ErrorState message={open.error.message} onRetry={open.reload} />
                </div>
              ) : (
                // On a phone the columns scroll sideways and land one at a time.
                <div className="snap-x snap-mandatory overflow-x-auto scroll-px-5 px-[22px] pb-[18px]">
                  <div className="grid min-w-[900px] grid-cols-5 gap-2.5">
                    {COLUMNS.map((column) => {
                      const tickets = byStatus.get(column.status) ?? [];
                      const count = data.ordersByStatus[column.status] ?? tickets.length;
                      return (
                        <div
                          key={column.status}
                          {...dropZone(column.status)}
                          className={cx(
                            "flex snap-start flex-col gap-2 rounded-[18px] p-2.5 transition-colors",
                            dragging && column.status === "PACKED"
                              ? "bg-[#E8F0FE] outline-2 outline-offset-[-2px] outline-[#0B3FA8]/50 outline-dashed dark:bg-[#132E52]"
                              : "bg-[var(--console-soft,var(--surface-sunken))]",
                          )}
                        >
                          <div className="flex items-center gap-2 px-1 pt-0.5 pb-1">
                            <span aria-hidden className={cx("h-2 w-2 rounded-full", column.dot)} />
                            <span className="flex-1 text-[13px] font-semibold text-strong">{tr(...column.label)}</span>
                            <span className="rounded-full bg-card px-[7px] py-px font-mono text-[11.5px] font-semibold tabular-nums text-muted">{count}</span>
                          </div>
                          {open.loading && !open.data ? (
                            <SkeletonRows rows={1} title={false} />
                          ) : tickets.length === 0 ? (
                            <p className="flex items-center gap-1.5 px-1 py-3 text-[12.5px] text-faint">
                              <Icon name="check" className="text-[16px]" />
                              {tr(...column.empty)}
                            </p>
                          ) : (
                            <>
                              {tickets.slice(0, COLUMN_DEPTH).map((order) => (
                                <div
                                  key={order.id}
                                  draggable={column.status === "CONFIRMED"}
                                  onDragStart={(event) => {
                                    event.dataTransfer.setData("text/plain", order.id);
                                    event.dataTransfer.effectAllowed = "move";
                                    setDragging(order.id);
                                  }}
                                  onDragEnd={() => setDragging(null)}
                                  className={cx(
                                    "flex flex-col rounded-[14px] border border-line bg-card shadow-[0_1px_2px_rgba(11,22,48,0.06)] transition-[box-shadow,transform,opacity] hover:-translate-y-0.5 hover:shadow-card",
                                    column.status === "CONFIRMED" && "cursor-grab active:cursor-grabbing",
                                    (dragging === order.id || packing === order.id) && "opacity-50",
                                  )}
                                >
                                  <Link
                                    href={`/admin/pharmacy/orders/${order.id}`}
                                    draggable={false}
                                    className="flex flex-col gap-1 rounded-xl p-3 focus-visible:outline-2 focus-visible:outline-primary"
                                  >
                                    <span className="flex items-center justify-between gap-2 text-[11.5px]">
                                      <span className="font-mono font-semibold text-primary">{order.orderNumber.replace(/^ORD-\d{4}-/, "")}</span>
                                      <span className="text-faint">{ticketAge(order.createdAt, now, urdu)}</span>
                                    </span>
                                    <span className="truncate text-[13.5px] font-semibold text-strong">
                                      {order.patientName ?? order.recipientName}
                                    </span>
                                    <span className="truncate text-[12px] text-muted">
                                      {order.items[0] && productTitle({ name: order.items[0].productName, strength: order.items[0].strength })}
                                      {order.items.length > 1 && ` + ${order.items.length - 1}`}
                                    </span>
                                    <span className="flex items-center justify-between gap-2 pt-0.5 text-[12px]">
                                      <span className="font-bold tabular-nums text-strong">{rupees(order.total)}</span>
                                      <span className="text-faint">{order.paymentMethod === "COD" ? "COD" : tr("Online", "Online")}</span>
                                    </span>
                                  </Link>
                                  {column.status === "CONFIRMED" && (
                                    <button
                                      type="button"
                                      disabled={packing !== null}
                                      onClick={() => void pack(order.id)}
                                      className="mx-3 mb-3 inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-line-strong bg-card text-[12.5px] font-semibold text-strong hover:bg-sunken focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                                    >
                                      <Icon name="inventory_2" className="text-[16px]" />
                                      {packing === order.id ? tr("Marking…", "Mark ho raha hai…") : tr("Mark packed", "Pack mark karein")}
                                    </button>
                                  )}
                                </div>
                              ))}
                              {tickets.length > COLUMN_DEPTH && (
                                <Link
                                  href={`/admin/pharmacy/orders?status=${column.status}`}
                                  className="px-1 py-1 text-[12.5px] font-semibold text-primary hover:underline"
                                >
                                  {tr(`+ ${tickets.length - COLUMN_DEPTH} more`, `+ ${tickets.length - COLUMN_DEPTH} aur`)}
                                </Link>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </ConsoleCard>

            <div className="grid grid-cols-1 gap-[22px] lg:grid-cols-2">
              <ConsoleCard icon="star" title={tr("Best sellers", "Sab se zyada bikne wali")} subtitle={tr("Last 30 days", "Pichhle 30 din")}>
                {data.bestSellers.length === 0 ? (
                  <FinishedState size={110} title={tr("No sales yet", "Abhi koi farokht nahi")} />
                ) : (
                  <ol className="flex flex-col gap-3 px-[22px] pb-5">
                    {data.bestSellers.slice(0, 5).map((row, index) => (
                      <li key={`${row.productId}-${row.name}`} className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                        <span className="grid h-7 w-7 place-items-center rounded-full bg-sunken text-[12px] font-bold tabular-nums text-muted">
                          {index + 1}
                        </span>
                        <span className="truncate text-[14px] font-semibold text-strong">{row.name}</span>
                        <span className="text-right text-[14px] font-bold tabular-nums text-strong">{rupees(row.revenue)}</span>
                        <span aria-hidden />
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                            <span
                              className="bar-grow-x block h-full rounded-full bg-[#1A8FC7]"
                              style={{ width: `${((Number(row.revenue) || 0) / topRevenue) * 100}%` }}
                            />
                          </span>
                        </span>
                        <span className="text-right text-[12px] tabular-nums text-muted">× {row.quantity}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </ConsoleCard>

              <ConsoleCard
                icon="inventory"
                title={tr("Stock watch", "Stock par nazar")}
                subtitle={tr("At or below their reorder level", "Reorder level par ya kam")}
                action={
                  data.lowStock.length > 0 ? (
                    <CardLink href="/admin/pharmacy/catalog?lowStock=1">{tr("Reorder →", "Reorder →")}</CardLink>
                  ) : undefined
                }
              >
                {data.lowStock.length === 0 ? (
                  <FinishedState size={110} title={tr("Everything is stocked", "Sab stock mein hai")} />
                ) : (
                  <ul className="flex flex-col gap-3.5 px-[22px] pb-5">
                    {data.lowStock.map((product) => {
                      const left = product.stock ?? 0;
                      // The bar runs to twice the reorder level, so "at the level" sits halfway.
                      const scale = Math.max(1, (product.lowStockThreshold ?? 0) * 2);
                      return (
                        <li key={product.id} className="flex items-center gap-3">
                          <MedicinePack form={product.form} size={34} />
                          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-[14px] font-semibold text-strong">{productTitle(product)}</span>
                              <span className={cx("shrink-0 text-[12.5px] font-semibold tabular-nums", left === 0 ? "text-critical" : "text-warning")}>
                                {left === 0 ? tr("Out", "Khatam") : tr(`${left} left`, `${left} baqi`)}
                              </span>
                            </div>
                            <span className="h-1.5 overflow-hidden rounded-full bg-sunken">
                              <span
                                className={cx("bar-grow-x block h-full rounded-full", left === 0 ? "bg-critical" : "bg-[#F59E0B]")}
                                style={{ width: `${Math.max(3, Math.min(100, (left / scale) * 100))}%` }}
                              />
                            </span>
                            <span className="text-[12px] text-muted">
                              {product.packSize} · {tr(`reorder at ${product.lowStockThreshold ?? 0}`, `${product.lowStockThreshold ?? 0} par reorder`)}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </ConsoleCard>
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
