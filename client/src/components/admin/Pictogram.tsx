"use client";

/**
 * Page pictograms: one drawing per console page, beside its title.
 *
 * Pictograms, not icons — the distinction IBM's Carbon system draws: an icon
 * is a control-sized glyph that sits in a button or a row; a pictogram is an
 * illustration-sized mark (48px and up) that names a place at a glance. The
 * console uses them only in page headers, so a page is recognisable before
 * its title is read, and never in place of an icon.
 *
 * One style for all of them: a 2px navy line drawing on a 48-unit grid with a
 * single teal accent shape, on a soft blue-to-mint tile. The same paths draw
 * the "Final UI" boards on the design canvas (gen/pictograms.json there).
 */

import { cx } from "@/components/ui";

export const PICTOGRAMS = {
  overview: {
    accent: "M12 26h6v8h-6z",
    lines: "M8 14a4 4 0 0 1 4-4h24a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4zM8 18h32M24 34v-8M30 34V22M36 34v-5",
  },
  people: {
    accent: "M18 21a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
    lines: "M18 21a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM8 37c0-5.5 4.5-9 10-9s10 3.5 10 9M31 20a4 4 0 1 0 0-8M33 27.5c4 .9 7 3.9 7 9.5",
  },
  appointments: {
    accent: "M15 24h6v5h-6z",
    lines: "M9 14a2 2 0 0 1 2-2h26a2 2 0 0 1 2 2v23a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2zM9 19h30M16 9v6M32 9v6M27 24h6M15 32h6M27 32h6",
  },
  requests: {
    accent: "M33 34a6 6 0 1 0 0-12 6 6 0 0 0 0 12z",
    lines: "M20 20a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM10 38c0-6 4.5-10 10-10 1.9 0 3.7.5 5.2 1.4M33 34a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM30.5 28l1.8 1.8 3.4-3.6",
  },
  pharmacy: {
    accent: "M11 30l7.5-7.5 10 10L21 40a7 7 0 0 1-10-10z",
    lines: "M11 30l15-15a7 7 0 0 1 10 10L21 40a7 7 0 0 1-10-10zM18.5 22.5l10 10",
  },
  orders: {
    accent: "M24 22l14-7v16l-14 7z",
    lines: "M24 8l14 7v16l-14 7-14-7V15zM10 15l14 7 14-7M24 22v16M17 11.5l14 7",
  },
  catalog: {
    accent: "M27 14h7v6h-7z",
    lines: "M9 38h30M14 38V22h7v16M27 38V14h7v24M14 27h7M27 20h7M14 22l3.5-4 3.5 4",
  },
  revenue: {
    accent: "M20 38V25h5v13z",
    lines: "M9 38h30M14 38v-7M22.5 38V25M31 38V29M10 23l8-6 6 4 12-9M30 12h6v6",
  },
  billing: {
    accent: "M31 35a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
    lines: "M13 8h22v32l-4-3-3 3-4-3-4 3-3-3-4 3zM18 16h12M18 22h12M18 28h5M31 35a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
  },
  transactions: {
    accent: "M19 24a5 5 0 1 0 10 0 5 5 0 0 0-10 0z",
    lines: "M12 15h24M31 10l5 5-5 5M36 33H12M17 28l-5 5 5 5M19 24a5 5 0 1 0 10 0 5 5 0 0 0-10 0z",
  },
  withdrawals: {
    accent: "M10 18h28L24 10z",
    lines: "M8 18l16-9 16 9zM10 18h28M13 22v12M20 22v12M28 22v12M35 22v12M9 38h30",
  },
  emergency: {
    accent: "M24 12l10 4v7c0 6.5-4.2 10.5-10 13z",
    lines: "M24 8l14 5.5V23c0 8.5-6 14-14 17-8-3-14-8.5-14-17v-9.5zM24 17v9M24 31h.01",
  },
  audit: {
    accent: "M31 39a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
    lines: "M13 8h15l8 8v10M13 8v32h12M28 8v8h8M18 21h12M18 27h7M31 39a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM29 34l1.5 1.5 3-3",
  },
  settings: {
    accent: "M18 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    lines: "M10 14h5M21 14h17M10 24h17M33 24h5M10 34h9M25 34h13M18 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM30 27a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM22 37a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  },
} as const;

export type PictogramName = keyof typeof PICTOGRAMS;

export function Pictogram({ name, className }: { name: PictogramName; className?: string }) {
  const mark = PICTOGRAMS[name];
  return (
    <span
      aria-hidden
      className={cx(
        "grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-[#0B3FA8]/10 bg-[linear-gradient(135deg,#E8F0FE,#DDF5F1)] text-[#0B3FA8]",
        "dark:border-white/10 dark:bg-[linear-gradient(135deg,#132E52,#123B3A)] dark:text-[#86ABFF]",
        className,
      )}
    >
      <svg viewBox="0 0 48 48" className="h-10 w-10" fill="none">
        <path d={mark.accent} className="fill-[#5EEAD4]/60 dark:fill-[#5EEAD4]/40" />
        <path d={mark.lines} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
