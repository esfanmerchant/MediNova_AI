"use client";

/**
 * Notifications, in a panel that opens from the header.
 *
 * Notification text is deliberately thin — an appointment moved, a booking was
 * confirmed — because these strings also reach places outside the access-control
 * boundary once email delivery lands. Anything clinical stays behind the link.
 *
 * So the link is the point of a notification: a row that has one is the way to
 * the thing, and opening it marks it read. Rows are grouped by day, newest
 * first, and the colour of a row's mark says how urgent the server thought it
 * was — red for priority 2 (an emergency grant to review), amber for 1.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { Icon } from "@/components/Icon";
import { Button, EmptyState, cx } from "@/components/ui";
import { notifications, type Notification, type Role } from "@/lib/api";
import { useLang, useTr } from "@/lib/lang";
import { useAsync, QUEUE_REFRESH_MS } from "@/lib/useAsync";

/** Every role that receives appointment notifications has its own list page. */
const APPOINTMENTS_PATH: Partial<Record<Role, string>> = {
  PATIENT: "/patient/appointments",
  DOCTOR: "/doctor/appointments",
  ADMIN: "/admin/appointments",
};

/** Where each role chooses what reaches it — the settings page's notifications tab. */
const PREFERENCES_PATH: Partial<Record<Role, string>> = {
  PATIENT: "/patient/settings#notifications",
  DOCTOR: "/doctor/settings#notifications",
  ADMIN: "/admin/settings#notifications",
};

function timeAgo(iso: string, urdu: boolean): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return urdu ? "abhi" : "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return urdu ? `${minutes}m pehle` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return urdu ? `${hours}h pehle` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return urdu ? `${days}d pehle` : `${days}d ago`;
}

/** An icon for the kind of thing that happened. */
function iconFor(type: string): string {
  const key = type.toLowerCase();
  if (key.includes("appointment")) return "calendar_today";
  if (key.includes("alert") || key.includes("vital")) return "monitor_heart";
  if (key.includes("invoice") || key.includes("billing") || key.includes("payment")) return "receipt_long";
  if (key.includes("emergency")) return "e911_emergency";
  if (key.includes("document")) return "description";
  if (key.includes("pharmacy") || key.includes("order")) return "local_pharmacy";
  return "notifications";
}

/** "Today", "Yesterday" or "Earlier", by the reader's own calendar. */
function dayOf(iso: string): 0 | 1 | 2 {
  const then = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (then >= today) return 0;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  return then >= yesterday ? 1 : 2;
}

const TONE = {
  urgent: "bg-critical-soft text-critical",
  soon: "bg-warning-soft text-warning",
  plain: "bg-gradient-brand text-white shadow-sm",
  read: "bg-sunken text-faint",
} as const;

export function NotificationBell({ role }: { role: Role }) {
  const tr = useTr();
  const urdu = useLang() === "ur";
  const [open, setOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  // useAsync writes state only from its async continuation, which is what keeps
  // this out of the cascading-render pattern React 19 warns about. A 401 is
  // swallowed there and handled globally by SessionProvider — the bell is
  // peripheral and must never take a page down with it.
  const { data, error, reload } = useAsync(() => notifications.list({ limit: 30 }), [], {
    refreshMs: QUEUE_REFRESH_MS,
  });
  const all: Notification[] = data?.data ?? [];
  const unread = data?.meta.unread ?? 0;
  const items = unreadOnly ? all.filter((item) => !item.readAt) : all;

  const load = useCallback(() => reload(), [reload]);

  // Close on outside click and on Escape, the two ways people expect to dismiss
  // a popover.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (panel.current && !panel.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markAll = async () => {
    await notifications.markAllRead();
    load();
  };

  const markRead = (item: Notification) => {
    if (!item.readAt) void notifications.markRead(item.id).then(load);
  };

  const groups = (["Today", "Yesterday", "Earlier"] as const)
    .map((label, day) => ({
      label: tr(label, ["Aaj", "Kal", "Pehle"][day]),
      items: items.filter((item) => dayOf(item.createdAt) === day),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div ref={panel} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          unread > 0
            ? tr(`Notifications, ${unread} unread`, `Ittilaat, ${unread} naye`)
            : tr("Notifications", "Ittilaat")
        }
        onClick={() => {
          setOpen((value) => !value);
          if (!open) void load();
        }}
        className={cx(
          "group relative grid h-11 w-11 place-items-center rounded-full text-muted transition-[background-color,color,transform] duration-200 hover:scale-105 hover:bg-gradient-soft hover:text-primary",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          open && "bg-gradient-soft text-primary",
        )}
      >
        <Icon name="notifications" filled={open || unread > 0} className="icon-ring text-[24px]" />
        {unread > 0 && (
          <span className="absolute right-2 top-2 flex h-2.5 w-2.5">
            <span className="pulse-dot absolute inline-flex h-full w-full rounded-full bg-critical" />
            <span className="sr-only">{unread}</span>
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label={tr("Notifications", "Ittilaat")}
            initial={{ opacity: 0, scale: 0.92, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.8 }}
            style={{ transformOrigin: "top right" }}
            className={cx(
              "z-50 overflow-hidden rounded-3xl border border-line bg-card shadow-overlay",
              /* On a phone the panel belongs to the screen, not to the bell.
                 Anchored to the bell it was 22rem hanging off a button already
                 near the right edge, and any sideways drift in the document
                 took it with — which is what "the notifications are cut off"
                 was. Pinned to the viewport with a margin on both sides, there
                 is no arithmetic left to get wrong: it cannot reach an edge.
                 `--topbar-h` is published by the header, so it sits under the
                 bar however tall that bar happens to be. */
              "fixed inset-x-3 top-[calc(var(--topbar-h,64px)+0.5rem)]",
              /* Above that, back to a dropdown hanging off its own button,
                 which is what a pointer expects. */
              "sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[25rem]",
            )}
          >
            <div className="flex items-center gap-2 px-5 pt-4 pb-2">
              <p className="font-display text-lg font-bold text-strong">{tr("Notifications", "Ittilaat")}</p>
              {unread > 0 && (
                <span className="rounded-full bg-critical-soft px-2 py-px text-xs font-bold tabular-nums text-critical">
                  {tr(`${unread} new`, `${unread} naye`)}
                </span>
              )}
              {unread > 0 && (
                <Button variant="ghost" className="ml-auto !min-h-9 px-2 text-sm" onClick={() => void markAll()}>
                  {tr("Mark all read", "Sab parh liye")}
                </Button>
              )}
            </div>

            <div role="tablist" aria-label={tr("Which notifications", "Kaun se ittilaat")} className="flex gap-1 border-b border-line px-4">
              {[
                { key: false, label: tr("All", "Sab"), count: all.length },
                { key: true, label: tr("Unread", "Naye"), count: unread },
              ].map((tab) => (
                <button
                  key={String(tab.key)}
                  type="button"
                  role="tab"
                  aria-selected={unreadOnly === tab.key}
                  onClick={() => setUnreadOnly(tab.key)}
                  className={cx(
                    "-mb-px inline-flex min-h-10 items-center gap-1.5 border-b-2 px-2 text-sm font-semibold transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary",
                    unreadOnly === tab.key ? "border-strong text-strong" : "border-transparent text-muted hover:text-strong",
                  )}
                >
                  {tab.label}
                  <span className="rounded-full bg-sunken px-1.5 text-[11px] font-bold tabular-nums text-muted">{tab.count}</span>
                </button>
              ))}
            </div>

            <div className="max-h-[26rem] overflow-y-auto">
              {error && (
                <p role="alert" className="px-5 py-3 text-sm text-critical">
                  {error.message}
                </p>
              )}
              {!error && items.length === 0 && (
                <div className="px-4">
                  <EmptyState
                    icon="notifications_off"
                    title={tr("Nothing to catch up on", "Kuchh naya nahi")}
                    description={tr("You are up to date.", "Aap up to date hain.")}
                  />
                </div>
              )}
              {groups.map((group) => (
                <section key={group.label} aria-label={group.label}>
                  <p className="mono-caps px-5 pt-3 pb-1 text-[0.66rem] text-faint">{group.label}</p>
                  <ul>
                    {group.items.map((item, index) => {
                      const tone = item.readAt
                        ? TONE.read
                        : item.priority >= 2
                          ? TONE.urgent
                          : item.priority === 1
                            ? TONE.soon
                            : TONE.plain;
                      const body = (
                        <>
                          <span aria-hidden className={cx("mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl", tone)}>
                            <Icon name={iconFor(item.type)} className="text-[19px]" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className={cx("text-sm text-strong", item.readAt ? "font-medium" : "font-semibold")}>{item.title}</span>
                              <span className="shrink-0 text-[11.5px] text-faint tabular-nums">{timeAgo(item.createdAt, urdu)}</span>
                            </span>
                            <span className="mt-0.5 block text-[13px] text-muted">{item.body}</span>
                          </span>
                          {!item.readAt && <span aria-hidden className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                        </>
                      );
                      return (
                        <motion.li
                          key={item.id}
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: Math.min(index, 6) * 0.04 }}
                        >
                          {item.link ? (
                            <Link
                              href={item.link}
                              onClick={() => {
                                markRead(item);
                                setOpen(false);
                              }}
                              className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
                            >
                              {body}
                            </Link>
                          ) : (
                            <button
                              type="button"
                              onClick={() => markRead(item)}
                              aria-label={item.readAt ? undefined : `${item.title} — ${tr("mark read", "parh liya")}`}
                              className="flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
                            >
                              {body}
                            </button>
                          )}
                        </motion.li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
              {PREFERENCES_PATH[role] && (
                <Link
                  href={PREFERENCES_PATH[role]}
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-strong hover:underline"
                >
                  <Icon name="tune" className="text-[17px]" />
                  {tr("Choose what reaches you", "Chunein kya aap tak pahunche")}
                </Link>
              )}
              {APPOINTMENTS_PATH[role] && (
                <Link
                  href={APPOINTMENTS_PATH[role]}
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
                >
                  {tr("Appointments", "Appointments")}
                  <Icon name="arrow_forward" className="text-[16px]" />
                </Link>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
