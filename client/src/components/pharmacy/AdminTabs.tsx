"use client";

/** The pharmacy's four rooms, for the administrator running it. */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon } from "@/components/Icon";
import { cx } from "@/components/ui";
import { useTr } from "@/lib/lang";

const TABS: { href: string; label: [string, string]; icon: string }[] = [
  { href: "/admin/pharmacy", label: ["Overview", "Jaiza"], icon: "monitoring" },
  { href: "/admin/pharmacy/orders", label: ["Orders", "Orders"], icon: "receipt_long" },
  { href: "/admin/pharmacy/catalog", label: ["Catalog", "Catalog"], icon: "inventory_2" },
  { href: "/admin/pharmacy/settings", label: ["Settings", "Settings"], icon: "tune" },
];

export function PharmacyAdminTabs() {
  const tr = useTr();
  const pathname = usePathname();
  return (
    <nav aria-label={tr("Pharmacy", "Pharmacy")} className="no-scrollbar -mx-4 overflow-x-auto px-4">
      <ul className="inline-flex min-w-full gap-1 rounded-xl border border-line bg-sunken p-1 sm:min-w-0">
        {TABS.map((tab) => {
          const active =
            tab.href === "/admin/pharmacy" ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <li key={tab.href} className="flex-1 sm:flex-none">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-4 text-sm font-semibold transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                  active ? "bg-gradient-brand text-white shadow-sm" : "text-muted hover:text-strong",
                )}
              >
                <Icon name={tab.icon} filled={active} className="text-[18px]" />
                {tr(...tab.label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
