"use client";

/**
 * "+ New": everything an administrator can start from anywhere in the console.
 *
 * Each entry opens the page that owns the thing, with its form already open —
 * the menu never grows forms of its own, so there is one place to fix each.
 * The same entries are in the search palette, under "Actions", and each has
 * a two-key shortcut from anywhere in the console: N, then its letter. Typing
 * in a field never triggers one.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Icon } from "@/components/Icon";
import { cx } from "@/components/ui";
import { useTr } from "@/lib/lang";

export interface NewAction {
  href: string;
  icon: string;
  label: [string, string];
  note: [string, string];
  group: [string, string];
  /** Pressed after N. */
  key: string;
}

export const NEW_ACTIONS: NewAction[] = [
  {
    href: "/admin/users?new=staff",
    icon: "person_add",
    label: ["Add a staff account", "Staff account banayein"],
    note: ["A nurse or an administrator", "Nurse ya admin"],
    group: ["People", "Log"],
    key: "S",
  },
  {
    href: "/admin/pharmacy/catalog?new=1",
    icon: "medication",
    label: ["Add a medicine", "Dawa shamil karein"],
    note: ["With its DRAP maximum price", "DRAP ki zyada se zyada qeemat ke saath"],
    group: ["Pharmacy", "Pharmacy"],
    key: "M",
  },
  {
    href: "/admin/pharmacy/catalog?import=1",
    icon: "upload_file",
    label: ["Import medicines", "Dawaiyan import karein"],
    note: ["From a CSV file", "CSV file se"],
    group: ["Pharmacy", "Pharmacy"],
    key: "I",
  },
];

/** How long N waits for its letter. */
const CHORD_MS = 1500;

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
}

export function NewMenu() {
  const tr = useTr();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // N, then a letter. Armed by N and disarmed by the next key or by time.
  useEffect(() => {
    let armed = false;
    let timer = 0;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
      const key = event.key.toUpperCase();
      if (armed) {
        armed = false;
        window.clearTimeout(timer);
        const action = NEW_ACTIONS.find((entry) => entry.key === key);
        if (action) {
          event.preventDefault();
          setOpen(false);
          router.push(action.href);
        }
      } else if (key === "N" && !event.shiftKey) {
        armed = true;
        timer = window.setTimeout(() => {
          armed = false;
        }, CHORD_MS);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(timer);
    };
  }, [router]);
  const root = useRef<HTMLDivElement>(null);
  const items = useRef<Array<HTMLAnchorElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    // Focus the first entry, as a menu opened from a button does.
    items.current[0]?.focus();
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items.current.filter(Boolean) as HTMLAnchorElement[];
    const at = list.indexOf(document.activeElement as HTMLAnchorElement);
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>("button")?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      list[(at + 1) % list.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      list[(at - 1 + list.length) % list.length]?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  // Each action keeps its place in NEW_ACTIONS, which is also its place in
  // the arrow-key order.
  const groups = NEW_ACTIONS.reduce<Array<{ group: [string, string]; actions: Array<NewAction & { at: number }> }>>(
    (all, action, at) => {
      const existing = all.find((entry) => entry.group[0] === action.group[0]);
      if (existing) existing.actions.push({ ...action, at });
      else all.push({ group: action.group, actions: [{ ...action, at }] });
      return all;
    },
    [],
  );

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        aria-label={tr("Create something new", "Kuchh naya banayein")}
        className={cx(
          "inline-flex h-10 items-center gap-2 rounded-full bg-[#0B3FA8] px-3 text-[13.5px] font-semibold text-white shadow-[0_10px_22px_-12px_rgba(11,63,168,0.8)] transition-colors hover:bg-[#0A3796] sm:px-[18px]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:bg-[#3B6FE0] dark:hover:bg-[#4A7BEA]",
        )}
      >
        <Icon name="add" className="text-[16px]" />
        <span className="hidden lg:inline">{tr("New", "Naya")}</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={tr("Create something new", "Kuchh naya banayein")}
          onKeyDown={onMenuKey}
          className="pop-in absolute right-0 z-50 mt-2 w-[19rem] overflow-hidden rounded-3xl border border-line bg-card p-2 shadow-overlay"
        >
          {groups.map(({ group, actions }) => (
            <div key={group[0]} role="group" aria-label={tr(...group)} className="mb-1 last:mb-0">
              <p className="mono-caps px-3 pt-2 pb-1 text-[0.66rem] text-faint">{tr(...group)}</p>
              {actions.map((action) => {
                return (
                  <Link
                    key={action.href}
                    ref={(node) => {
                      items.current[action.at] = node;
                    }}
                    href={action.href}
                    role="menuitem"
                    aria-keyshortcuts={`N ${action.key}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none"
                  >
                    <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sunken text-primary">
                      <Icon name={action.icon} className="text-[19px]" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[14px] font-semibold text-strong">{tr(...action.label)}</span>
                      <span className="text-[12px] text-muted">{tr(...action.note)}</span>
                    </span>
                    <kbd className="hidden shrink-0 rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-faint sm:block">
                      {action.key}
                    </kbd>
                  </Link>
                );
              })}
            </div>
          ))}
          <p className="hidden border-t border-line px-3 pt-2.5 pb-1.5 text-[12px] text-muted sm:block">
            {tr("Anywhere in the console: press", "Console mein kahin bhi:")}{" "}
            <kbd className="rounded-md border border-line px-1.5 font-mono text-[11px]">N</kbd>{" "}
            {tr("then the letter.", "phir letter dabayein.")}
          </p>
        </div>
      )}
    </div>
  );
}
