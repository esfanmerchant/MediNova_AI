"use client";

/** The pharmacy's four rooms, for the administrator running it. */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { StatusPill, type PillTone } from "@/components/admin/console";
import { cx } from "@/components/ui";
import type { OrderStatus } from "@/lib/api";
import { useTr } from "@/lib/lang";

const TABS: { href: string; label: [string, string]; counts?: "orders" }[] = [
  { href: "/admin/pharmacy", label: ["Overview", "Jaiza"] },
  { href: "/admin/pharmacy/orders", label: ["Orders", "Orders"], counts: "orders" },
  { href: "/admin/pharmacy/catalog", label: ["Catalog", "Catalog"] },
  { href: "/admin/pharmacy/settings", label: ["Settings", "Settings"] },
];

/**
 * The console's segmented pill, as links: the room you are in is raised on
 * the card. Orders carries the count of open orders where the page knows it.
 */
export function PharmacyAdminTabs({ openOrders }: { openOrders?: number }) {
  const tr = useTr();
  const pathname = usePathname();
  return (
    <nav aria-label={tr("Pharmacy", "Pharmacy")} className="no-scrollbar max-w-full overflow-x-auto">
      <ul className="inline-flex gap-0.5 rounded-full bg-sunken p-1">
        {TABS.map((tab) => {
          const active = tab.href === "/admin/pharmacy" ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "inline-flex h-[34px] items-center gap-[7px] rounded-full px-3.5 text-[13px] font-semibold whitespace-nowrap transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                  active
                    ? "bg-card text-strong shadow-[0_1px_2px_rgba(11,22,48,0.12),0_6px_14px_-8px_rgba(11,22,48,0.3)]"
                    : "text-muted hover:text-strong",
                )}
              >
                {tr(...tab.label)}
                {tab.counts === "orders" && openOrders !== undefined && (
                  <span
                    className={cx(
                      "rounded-full px-[7px] py-px font-mono text-[11px] font-semibold text-muted tabular-nums",
                      active ? "bg-sunken" : "bg-card",
                    )}
                  >
                    {openOrders}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** An order's state in the words of the counter: what it is waiting for next. */
export const ADMIN_ORDER_STATUS: Record<OrderStatus, { tone: PillTone; label: [string, string] }> = {
  PENDING_RX: { tone: "warning", label: ["Prescription", "Nuskha"] },
  AWAITING_PAYMENT: { tone: "warning", label: ["Awaiting payment", "Payment baqi"] },
  CONFIRMED: { tone: "info", label: ["To pack", "Pack karna"] },
  PACKED: { tone: "info", label: ["To dispatch", "Bhejna"] },
  DISPATCHED: { tone: "good", label: ["On the way", "Raste mein"] },
  DELIVERED: { tone: "good", label: ["Delivered", "Pahunch gaya"] },
  CANCELLED: { tone: "neutral", label: ["Cancelled", "Mansookh"] },
};

export function AdminOrderStatus({ status, large }: { status: OrderStatus; large?: boolean }) {
  const tr = useTr();
  const spec = ADMIN_ORDER_STATUS[status];
  if (large) {
    return (
      <span className="inline-flex">
        <span className="[&>span]:h-8 [&>span]:px-3.5 [&>span]:text-[13.5px]">
          <StatusPill dot tone={spec.tone}>
            {tr(...spec.label)}
          </StatusPill>
        </span>
      </span>
    );
  }
  return (
    <StatusPill dot tone={spec.tone}>
      {tr(...spec.label)}
    </StatusPill>
  );
}
