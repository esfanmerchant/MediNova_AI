"use client";

/**
 * Jump to a page by typing part of its name.
 *
 * **Pages only, deliberately.** A palette that also searched doctors,
 * appointments and invoices would be a better palette and a worse product: it
 * would need endpoints that do not exist, and — where they do — it would put
 * patient names into a box anyone walking past a ward terminal can open.
 * Navigation is chrome, and chrome is safe to search.
 *
 * The list is the role's own navigation, so it can never offer a destination
 * the rail does not, and never one the API would refuse.
 *
 * Keyboard first: the field keeps focus throughout, ↑/↓ move a virtual cursor
 * tracked with `aria-activedescendant`, Enter navigates, Escape closes and
 * hands focus back where it came from.
 */

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { Icon } from "@/components/Icon";
import { AnimatedModal } from "@/components/overlays";
import { cx } from "@/components/ui";
import { useTr } from "@/lib/lang";
import { SPRING, useCalmMotion } from "@/lib/motion";

export interface PaletteItem {
  href: string;
  /** Already translated by the caller — the palette does not know the table. */
  label: string;
  /** The rail section this page sits in, translated. Used as the group title. */
  section: string;
  icon: string;
}

/**
 * A forgiving subsequence match, scored so the obvious answer sorts first.
 *
 * "apt" finds Appointments. Letters must appear in order but need not be
 * adjacent; runs and word beginnings are worth more, which is what keeps
 * "Dashboard" above "Medical records" for "d".
 *
 * Returns null when the text does not contain the query at all.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const needle = query.toLowerCase().replace(/\s+/g, "");
  if (!needle) return 0;
  const haystack = text.toLowerCase();

  let score = 0;
  let cursor = 0;
  let run = 0;

  for (const character of needle) {
    const found = haystack.indexOf(character, cursor);
    if (found === -1) return null;
    const previous = haystack[found - 1];
    const boundary = previous === undefined || /[\s/-]/.test(previous);
    run = found === cursor ? run + 1 : 0;
    score += 1 + run * 2 + (boundary ? 4 : 0);
    cursor = found + 1;
  }
  // A short label matched in full beats a long one matched in part.
  return score + Math.max(0, 12 - text.length / 2);
}

/**
 * The panel itself, mounted only while the palette is open.
 *
 * Its whole state — the query, the cursor — is born and dies with the mount,
 * which is why there is no code anywhere that resets it. A palette that
 * remembered the last search would make the second use slower than the first.
 */
function Palette({ onClose, items }: { onClose: () => void; items: PaletteItem[] }) {
  const tr = useTr();
  const router = useRouter();
  const calm = useCalmMotion();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = `palette-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const field = useRef<HTMLInputElement>(null);

  // Ranked once per keystroke, then regrouped in the rail's own section order
  // so the palette reads like the navigation it mirrors. Each item carries the
  // index it holds in the flattened list, so the cursor can walk across groups
  // without anything counting during render.
  const results = useMemo(() => {
    const ranked = items
      .map((item) => ({
        item,
        score: Math.max(
          fuzzyScore(query, item.label) ?? -1,
          // A section name is worth matching, but never as much as a page name.
          (fuzzyScore(query, item.section) ?? -1) - 6,
        ),
      }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item);

    const sections: { label: string; items: { item: PaletteItem; index: number }[] }[] = [];
    for (const item of ranked) {
      const existing = sections.find((section) => section.label === item.section);
      if (existing) existing.items.push({ item, index: 0 });
      else sections.push({ label: item.section, items: [{ item, index: 0 }] });
    }
    let cursor = 0;
    for (const section of sections) {
      for (const entry of section.items) {
        entry.index = cursor;
        cursor += 1;
      }
    }
    return { sections, flat: sections.flatMap((section) => section.items.map((e) => e.item)) };
  }, [items, query]);

  const count = results.flat.length;
  const activeId = count > 0 ? `${listId}-option-${Math.min(active, count - 1)}` : undefined;

  // Focus in, focus back out, and no page scrolling underneath in between.
  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null;
    field.current?.focus({ preventScroll: true });
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
      restoreTo?.focus?.({ preventScroll: true });
    };
  }, []);

  // Keep the cursor in view when it walks past the fold. `getElementById`
  // rather than a selector: React's own ids contain characters a CSS selector
  // would have to escape.
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const go = useCallback(
    (item: PaletteItem | undefined) => {
      if (!item) return;
      onClose();
      router.push(item.href);
    },
    [onClose, router],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Tab is bound to the list too: there is nothing else in the panel to
    // reach, so letting it leave would drop a keyboard user out of the dialog.
    const forward = event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey);
    const back = event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey);

    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (forward) {
      event.preventDefault();
      setActive((index) => (count === 0 ? 0 : (index + 1) % count));
    } else if (back) {
      event.preventDefault();
      setActive((index) => (count === 0 ? 0 : (index - 1 + count) % count));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(Math.max(0, count - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(results.flat[active]);
    }
  };

  return (
    <>
      <div className="flex items-center gap-3 border-b border-line/70 px-4">
        <Icon name="search" className="shrink-0 text-[22px] text-faint" />
        <input
          ref={field}
          type="text"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-label={tr("Search pages", "Safhaat mein dhoondein")}
          placeholder={tr("Go to a page…", "Kisi safhe par jayein…")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="min-h-14 w-full bg-transparent text-base text-strong outline-none placeholder:text-faint"
        />
        <kbd className="mono-caps hidden shrink-0 rounded-md border border-line-strong px-1.5 py-0.5 text-[10px] text-faint sm:block">
          Esc
        </kbd>
      </div>

      {/* The count, for a reader who cannot see the list shrink. */}
      <p role="status" className="sr-only">
        {count === 1 ? tr("1 page", "1 safha") : `${count} ${tr("pages", "safhaat")}`}
      </p>

      <div id={listId} role="listbox" className="max-h-[52vh] overflow-y-auto p-2">
        {count === 0 && (
          <p className="px-3 py-8 text-center text-sm text-muted">
            {tr("No page matches that.", "Is se koi safha nahi milta.")}
          </p>
        )}

        {results.sections.map((section) => (
          <div key={section.label} role="group" aria-label={section.label} className="mb-1">
            <p className="mono-caps px-3 pb-1 pt-2 text-[0.68rem] text-faint">{section.label}</p>
            {section.items.map(({ item, index }) => {
              const selected = index === active;
              return (
                <div
                  key={item.href}
                  id={`${listId}-option-${index}`}
                  role="option"
                  aria-selected={selected}
                  onClick={() => go(item)}
                  onMouseMove={() => setActive(index)}
                  className={cx(
                    "relative flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-[0.9375rem] transition-colors",
                    selected ? "font-semibold text-primary" : "text-muted hover:bg-sunken",
                  )}
                >
                  {/* One highlight that follows the cursor from row to row,
                      rather than a row that lights up and another that goes
                      dark — the eye can track a thing that moves. */}
                  {selected && (
                    <motion.span
                      layoutId="palette-cursor"
                      aria-hidden
                      transition={calm ? { duration: 0 } : SPRING}
                      className="bg-gradient-soft absolute inset-0 rounded-xl"
                    />
                  )}
                  <Icon name={item.icon} filled={selected} className="relative text-[20px]" />
                  <span className="relative min-w-0 flex-1 truncate">{item.label}</span>
                  {selected && <Icon name="keyboard_return" className="relative text-[18px] text-faint" />}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4 border-t border-line/70 px-4 py-2 text-[11px] text-faint">
        <span className="flex items-center gap-1">
          <Icon name="keyboard_arrow_up" className="text-[16px]" />
          <Icon name="keyboard_arrow_down" className="text-[16px]" />
          {tr("move", "chalayein")}
        </span>
        <span>↵ {tr("open", "kholein")}</span>
        <span>esc {tr("close", "band")}</span>
      </div>
    </>
  );
}

export function CommandPalette({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: PaletteItem[];
}) {
  const tr = useTr();
  return (
    // The palette keeps its own keyboard — the field holds focus, Tab walks
    // the list — so the shell's focus trap stays out of its way.
    <AnimatedModal
      open={open}
      onClose={onClose}
      placement="top"
      layer="z-[120]"
      trap={false}
      label={tr("Search pages", "Safhaat mein dhoondein")}
      className="glass max-w-xl overflow-hidden rounded-2xl"
    >
      <Palette onClose={onClose} items={items} />
    </AnimatedModal>
  );
}
