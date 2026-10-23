"use client";

/**
 * The ⋯ on a table row: the row's actions, out of the way until asked for.
 *
 * Drawn through a portal at the button's place on screen rather than inside
 * the row. A table scrolls sideways in its own box, and anything absolutely
 * placed inside that box is clipped by it — the last row's menu would open
 * into a scrollbar. Scrolling or resizing closes it, which is what a menu does
 * when the thing it belongs to moves away from under it.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { Icon } from "@/components/Icon";
import { Floating } from "@/components/overlays";
import { cx } from "@/components/ui";

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  /** Red, and set apart by a line above it. */
  danger?: boolean;
  /** Quiet text at the end of the item — a count. */
  hint?: string;
  icon?: string;
}

const WIDTH = 210;

export function RowMenu({
  label,
  items,
  trigger,
  active = false,
  align = "end",
}: {
  label: string;
  items: RowMenuItem[];
  /** A worded pill in place of the ⋯ — "More", or the choice it holds. */
  trigger?: ReactNode;
  /** The pill holds the current choice, so it is drawn as chosen. */
  active?: boolean;
  /** Which edge of the button the menu lines up with. */
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    const height = menu.current?.offsetHeight ?? 150;
    const below = rect.bottom + 6 + height <= window.innerHeight;
    setPlace({
      top: below ? rect.bottom + 6 : Math.max(8, rect.top - 6 - height),
      left: Math.max(8, Math.min(window.innerWidth - WIDTH - 8, align === "start" ? rect.left : rect.right - WIDTH)),
    });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) close(false);
    };
    const moved = () => close(false);
    document.addEventListener("pointerdown", away);
    window.addEventListener("scroll", moved, true);
    window.addEventListener("resize", moved);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("scroll", moved, true);
      window.removeEventListener("resize", moved);
    };
  }, [open, close]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const entries = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? []);
    const at = entries.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      entries[(at + step + entries.length) % entries.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      entries[event.key === "Home" ? 0 : entries.length - 1]?.focus();
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={trigger ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className={cx(
          "rounded-full border transition-colors",
          "hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          trigger
            ? "inline-flex h-8 items-center gap-1.5 px-[13px] text-[12.5px] font-semibold whitespace-nowrap"
            : "grid h-8 w-8 place-items-center text-strong",
          active ? "border-[#0B3FA8] text-primary dark:border-[#7DA2FF]" : "border-line-strong text-strong",
          open ? "bg-sunken" : "bg-card",
        )}
      >
        {trigger ? (
          <>
            {trigger}
            <Icon name="expand_more" className={cx("text-[18px] transition-transform", open && "rotate-180")} />
          </>
        ) : (
          <Icon name="more_horiz" className="text-[20px]" />
        )}
      </button>
      {open && (
        <Floating>
          <div
            ref={menu}
            id={id}
            role="menu"
            aria-label={label}
            onKeyDown={onKeyDown}
            onClick={(event) => event.stopPropagation()}
            style={{ top: place?.top ?? -9999, left: place?.left ?? -9999, width: WIDTH }}
            className="rise-in fixed z-[60] rounded-2xl border border-line bg-card p-1.5 shadow-[0_24px_48px_-20px_rgba(11,22,48,0.35)]"
          >
            {items.map((item) => (
              <div key={item.label}>
                {item.danger && <div aria-hidden className="mx-1 my-[5px] h-px bg-line" />}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close(false);
                    item.onSelect();
                  }}
                  className={cx(
                    "flex h-[38px] w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13.5px] transition-colors",
                    "hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none",
                    item.danger ? "font-semibold text-critical" : "font-medium text-strong",
                  )}
                >
                  {item.icon && <Icon name={item.icon} className="text-[18px]" />}
                  <span className="flex-1">{item.label}</span>
                  {item.hint && <span className="text-[12px] font-normal text-muted tabular-nums">{item.hint}</span>}
                </button>
              </div>
            ))}
          </div>
        </Floating>
      )}
    </>
  );
}
