"use client";

/**
 * The console's five doors on a phone, at the bottom where a thumb is.
 *
 * Below `lg` the rail is a drawer behind a menu button, and an administrator
 * on a ward round should not have to open a drawer to get from orders to
 * money. Four sections and "More": the sections are the rail's groups, and
 * More opens the drawer itself, so nothing in the rail is out of reach.
 */

import Link from "next/link";

import { Icon } from "@/components/Icon";
import { cx } from "@/components/ui";
import { useTr } from "@/lib/lang";

const TABS: Array<{ href: string; label: [string, string]; icon: string; owns: RegExp }> = [
  { href: "/admin", label: ["Overview", "Jaiza"], icon: "dashboard", owns: /^\/admin\/?$/ },
  { href: "/admin/appointments", label: ["Care", "Ilaaj"], icon: "calendar_today", owns: /^\/admin\/(appointments|doctor-requests)/ },
  { href: "/admin/pharmacy", label: ["Pharmacy", "Pharmacy"], icon: "local_pharmacy", owns: /^\/admin\/pharmacy/ },
  { href: "/admin/revenue", label: ["Money", "Paisa"], icon: "monitoring", owns: /^\/admin\/(revenue|billing|transactions|withdrawals)/ },
];

export function ConsoleTabBar({
  pathname,
  pendingApplications,
  onMore,
  moreOpen,
}: {
  pathname: string;
  pendingApplications: number;
  onMore: () => void;
  moreOpen: boolean;
}) {
  const tr = useTr();
  const inSection = TABS.some((tab) => tab.owns.test(pathname));

  const tabClass = (active: boolean) =>
    cx(
      "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-[20px] text-[10.5px] font-semibold transition-colors",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5EEAD4]",
      active ? "bg-[#5EEAD4] text-[#04212A]" : "text-[#B9C7DD] hover:text-white",
    );

  return (
    <nav
      aria-label={tr("Console sections", "Console ke hisse")}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-canvas via-canvas/80 to-transparent px-3.5 pt-6 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden"
    >
      <div className="pointer-events-auto mx-auto flex max-w-md items-center gap-1 rounded-[26px] bg-[linear-gradient(180deg,#0C2150,#061029)] p-1.5 shadow-[0_20px_40px_-20px_rgba(8,22,51,0.8)]">
        {TABS.map((tab) => {
          const active = tab.owns.test(pathname);
          return (
            <Link key={tab.href} href={tab.href} aria-current={active ? "page" : undefined} className={tabClass(active)}>
              <Icon name={tab.icon} filled={active} className="text-[21px]" />
              {tr(...tab.label)}
              {tab.href === "/admin/appointments" && pendingApplications > 0 && (
                <span
                  className={cx(
                    "absolute top-1 right-[calc(50%-1.6rem)] grid h-[17px] min-w-[17px] place-items-center rounded-full px-1 font-mono text-[9.5px] font-bold",
                    active ? "bg-[#04212A] text-[#5EEAD4]" : "bg-white/15 text-white",
                  )}
                >
                  {pendingApplications}
                  <span className="sr-only"> {tr("doctors waiting", "doctors muntazir")}</span>
                </span>
              )}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={onMore}
          aria-expanded={moreOpen}
          className={tabClass(!inSection)}
        >
          <Icon name="more_horiz" className="text-[21px]" />
          {tr("More", "Mazeed")}
        </button>
      </div>
    </nav>
  );
}
