"use client";

/**
 * The pieces every administration page is built from.
 *
 * Art has three places in the console and no others (see the "Art rules"
 * board on the design canvas, and `.console-banner` in globals.css):
 *
 * 1. `ConsoleBanner` — one per page, at the top. The picture melts in from the
 *    left and stands on the banner's bottom edge; it never sits behind words.
 * 2. Art that is data — a medicine's pack, drawn by its form (`MedicinePack`).
 * 3. `FinishedState` — the one illustration a queue gets when it is empty.
 *
 * Everything else is type, colour and numbers. Art arrives once and then stays
 * still; only things that are live right now are allowed to keep moving.
 */

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { Icon } from "@/components/Icon";
import { Pictogram, type PictogramName } from "@/components/admin/Pictogram";
import { RevealText } from "@/components/motion";
import { Skeleton, cx } from "@/components/ui";
import { useTr } from "@/lib/lang";

export type ConsoleArt =
  | "calendar"
  | "capsule"
  | "caught-up"
  | "coins"
  | "doctor-badge"
  | "parcel"
  | "shield"
  | "siren";

/** Every drawing is square except the finished-queue scene, which is wider than tall. */
const ART_RATIO: Partial<Record<ConsoleArt, number>> = { "caught-up": 220 / 320 };

/**
 * A drawing from `public/admin-art`, `size` pixels wide. Always decorative: the
 * words beside it carry the meaning.
 */
export function Art({ name, size, className }: { name: ConsoleArt; size: number; className?: string }) {
  const height = Math.round(size * (ART_RATIO[name] ?? 1));
  return (
    <Image
      src={`/admin-art/${name}.svg`}
      alt=""
      aria-hidden
      width={size}
      height={height}
      style={{ width: size, height }}
      className={cx("art-settle select-none", className)}
      draggable={false}
    />
  );
}

/** The live dot: the one thing in the console that keeps moving. */
export function LiveDot({ tone = "teal" }: { tone?: "teal" | "red" | "green" }) {
  const colour = tone === "red" ? "bg-[#FF8A93]" : tone === "green" ? "bg-[#22C55E]" : "bg-[#5EEAD4]";
  return (
    <span aria-hidden className="relative inline-flex h-2 w-2">
      <span className={cx("absolute inset-0 animate-ping rounded-full opacity-70", colour)} />
      <span className={cx("relative h-2 w-2 rounded-full", colour)} />
    </span>
  );
}

export interface BannerStat {
  label: string;
  value: ReactNode;
}

/**
 * The overview's opening: what today looks like, said as a sentence with its
 * numbers in it, beside a picture made of data — today's visits by hour —
 * rather than an illustration. A banner is read for what it says; a drawing
 * behind the words is the first thing that makes a console look like a
 * brochure (see the "One look, every page" board on the design canvas).
 *
 * The circuit lines are the logo's own motif, held at 9% so they read as
 * texture, never as content.
 */
export function ConsoleBanner({
  id,
  eyebrow,
  live = false,
  title,
  children,
  actions,
  aside,
  stats,
}: {
  id?: string;
  eyebrow: string;
  /** Shows the pulsing dot beside the eyebrow — only for a page that refreshes itself. */
  live?: boolean;
  title: string;
  /** The data sentence. Links inside it are the way into each number. */
  children?: ReactNode;
  actions?: ReactNode;
  /** The right-hand panel: a small chart, never a picture. */
  aside?: ReactNode;
  stats?: BannerStat[];
}) {
  return (
    <section
      id={id}
      aria-label={title}
      className="console-banner rise-in relative isolate overflow-hidden rounded-[28px] text-white"
    >
      <span aria-hidden className="console-dots pointer-events-none absolute inset-0 -z-10" />
      <svg
        aria-hidden
        viewBox="0 0 600 260"
        preserveAspectRatio="xMaxYMid slice"
        className="pointer-events-none absolute top-0 right-0 -z-10 h-full w-[62%] opacity-[0.09]"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="1.4"
        strokeLinecap="round"
      >
        <path d="M40 210H180L196 170L214 236L230 190H330" />
        <path d="M330 190H420V120H520" />
        <path d="M420 120V60H560" />
        <path d="M380 190V240H600" />
        <circle cx="520" cy="120" r="5" />
        <circle cx="560" cy="60" r="5" />
        <circle cx="600" cy="240" r="5" />
      </svg>

      <div className="relative grid grid-cols-1 items-center gap-7 p-6 sm:p-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3.5">
          <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] text-[#9FE8DC]">
            {live && <LiveDot />}
            {eyebrow}
          </p>
          <h1 className="font-display text-[2rem] leading-[1.1] font-bold tracking-[-0.02em] sm:text-[2.25rem]">
            <RevealText text={title} at={0.04} />
          </h1>
          {children && (
            <div className="max-w-[520px] text-[15.5px] leading-relaxed text-[#D7E3F7] [&_a]:font-semibold [&_a]:text-white [&_a]:underline [&_a]:decoration-white/40 [&_a]:underline-offset-4 hover:[&_a]:decoration-white [&_b]:font-semibold [&_b]:text-white">
              {children}
            </div>
          )}
          {actions && <div className="mt-1 flex flex-wrap items-center gap-2.5">{actions}</div>}
        </div>
        {aside}
      </div>

      {stats && stats.length > 0 && (
        <dl
          className={cx(
            "relative grid grid-cols-2 border-t border-white/[0.08] bg-[#071B45] sm:grid-cols-4",
            "[&>div]:border-white/[0.08] [&>div:nth-child(n+3)]:border-t sm:[&>div:nth-child(n+3)]:border-t-0 [&>div+div]:border-l",
            "[&>div:nth-child(3)]:border-l-0 sm:[&>div:nth-child(3)]:border-l",
          )}
        >
          {stats.map((stat) => (
            <div key={stat.label} className="flex min-w-0 flex-col gap-0.5 px-5 py-3.5 sm:px-8">
              <dt className="text-[12px] text-[#9DB0D1]">{stat.label}</dt>
              <dd className="font-display text-lg font-bold whitespace-nowrap tabular-nums text-white sm:text-xl">{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/** The light pill a banner's main action wears. */
export function BannerAction({
  href,
  children,
  tone = "light",
  icon,
}: {
  href: string;
  children: ReactNode;
  tone?: "light" | "ghost" | "critical";
  icon?: string;
}) {
  const tones = {
    light: "bg-white text-[#0A2A72] hover:bg-[#EAF2FF]",
    ghost: "border border-white/30 text-white hover:bg-white/10",
    critical: "bg-[#C9363C] text-white shadow-[0_10px_22px_-10px_rgba(201,54,60,0.8)] hover:bg-[#B52F35]",
  } as const;
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex min-h-10 items-center gap-2 rounded-full px-[18px] text-[13.5px] font-semibold transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
        tones[tone],
      )}
    >
      {icon && <Icon name={icon} className="text-[17px]" />}
      {children}
    </Link>
  );
}

/**
 * How every console page other than the overview opens: the page's name, set
 * large, and one sentence that says what is on it right now — with the numbers
 * in it, and the ones that need somebody as links.
 *
 * Links in the sentence take a gold underline: they are the page's to-do list
 * said out loud. Bold is for a figure that only reports.
 */
export function ConsoleHeader({
  eyebrow,
  icon,
  mark,
  title,
  mono = false,
  children,
  actions,
}: {
  eyebrow?: ReactNode;
  /** A small glyph before the eyebrow — only where the page has no pictogram. */
  icon?: string;
  /** The page's pictogram, beside the title (see Pictogram.tsx). */
  mark?: PictogramName;
  title: string;
  /** For a title that is a code — an order or invoice number. */
  mono?: boolean;
  /** The data sentence. */
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex w-full flex-wrap items-end gap-x-6 gap-y-4">
      <div className="flex max-w-[48rem] min-w-0 items-start gap-4">
      {mark && <Pictogram name={mark} className="rise-in mt-0.5 hidden sm:grid" />}
      <div className="flex min-w-0 flex-col gap-2">
        {eyebrow && (
          <p className="rise-in flex items-center gap-2 text-[13px] text-muted">
            {icon && !mark && <Icon name={icon} className="text-[17px]" />}
            {eyebrow}
          </p>
        )}
        <h1
          className={cx(
            "leading-[1.05] font-bold text-strong",
            mono
              ? "!font-mono text-[1.75rem] tracking-[-0.01em] sm:text-[2.1rem]"
              : "font-display text-[2.1rem] tracking-[-0.03em] sm:text-[2.6rem]",
          )}
        >
          <RevealText text={title} at={0.04} />
        </h1>
        {children && (
          <div
            className="rise-in text-[15.5px] leading-relaxed text-muted [&_a]:font-semibold [&_a]:text-strong [&_a]:underline [&_a]:decoration-[#F59E0B] [&_a]:decoration-2 [&_a]:underline-offset-4 [&_b]:font-semibold [&_b]:text-strong"
            style={{ animationDelay: "0.12s" }}
          >
            {children}
          </div>
        )}
      </div>
      </div>
      {actions && (
        <div className="rise-in ml-auto flex flex-wrap items-center gap-2.5" style={{ animationDelay: "0.16s" }}>
          {actions}
        </div>
      )}
    </header>
  );
}

/** A pill button in a page header: `primary` for the page's main verb, `quiet` for the rest. */
export function HeaderPill({
  href,
  onClick,
  icon,
  children,
  tone = "quiet",
}: {
  href?: string;
  onClick?: () => void;
  icon?: string;
  children: ReactNode;
  tone?: "primary" | "quiet";
}) {
  const className = cx(
    "inline-flex min-h-10 items-center gap-2 rounded-full px-[18px] text-[13.5px] font-semibold whitespace-nowrap transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
    tone === "primary"
      ? "bg-[#0B3FA8] text-white shadow-[0_12px_24px_-12px_rgba(11,63,168,0.8)] hover:bg-[#0A3796] dark:bg-[#3B6FE0] dark:hover:bg-[#4A7BEA]"
      : "border border-line-strong bg-card text-strong hover:bg-sunken",
  );
  const inner = (
    <>
      {icon && <Icon name={icon} className="text-[19px]" />}
      {children}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={className}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {inner}
    </button>
  );
}

export type Pastel = "mint" | "sky" | "lilac" | "butter" | "blush";

const PASTELS: Record<Pastel, string> = {
  mint: "bg-pastel-mint",
  sky: "bg-pastel-sky",
  lilac: "bg-pastel-lilac",
  butter: "bg-pastel-butter",
  blush: "bg-pastel-blush",
};

/**
 * A headline figure on a soft colour of its own.
 *
 * The colour tells tiles apart, nothing more — it is not good or bad. When a
 * figure does need somebody, it says so in words, in the chip.
 */
export function PastelTile({
  pastel,
  label,
  value,
  unit,
  note,
  chip,
  href,
  icon,
}: {
  pastel: Pastel;
  label: string;
  value: ReactNode;
  /** Set small before the figure, the way a currency is. */
  unit?: string;
  note?: string;
  chip?: { text: string; tone: "warning" | "critical" | "good" };
  /** Makes the whole tile the way to the detail page. */
  href?: string;
  icon: string;
}) {
  const chips = {
    warning: "bg-[#B45309]/12 text-[#92400E] dark:bg-[#F5A524]/15 dark:text-[#FBD27A]",
    critical: "bg-[#E5484D]/12 text-[#B4232A] dark:bg-[#E5484D]/20 dark:text-[#FFB4B8]",
    good: "bg-[#0F766E]/12 text-[#0B5B55] dark:bg-[#5EEAD4]/15 dark:text-[#5EEAD4]",
  } as const;
  const frame = cx(
    "group relative flex min-h-[150px] flex-col gap-3 rounded-3xl p-5 text-pastel-ink",
    PASTELS[pastel],
  );
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          <Icon name={icon} className="text-[18px] opacity-70" />
          {label}
        </span>
        {chip && (
          <span className={cx("rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold whitespace-nowrap", chips[chip.tone])}>
            {chip.text}
          </span>
        )}
      </div>
      <span className="mt-auto font-display text-[2rem] leading-none font-bold tabular-nums">
        {unit && <span className="mr-1.5 align-[0.45em] text-[13px] font-semibold opacity-80">{unit}</span>}
        {value}
      </span>
      {note && <span className="text-[12.5px] opacity-70">{note}</span>}
      {href && (
        <Icon
          name="arrow_forward"
          className="absolute right-5 bottom-5 text-[20px] opacity-0 transition-[opacity,transform] duration-300 group-hover:translate-x-0.5 group-hover:opacity-60"
        />
      )}
    </>
  );

  if (!href) return <div className={frame}>{body}</div>;
  return (
    <Link
      href={href}
      className={cx(
        frame,
        "transition-transform duration-300 ease-out-soft hover:-translate-y-0.5",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
      )}
    >
      {body}
    </Link>
  );
}

/** A row of pastel tiles: two across on a phone, four on a wide screen. */
export function PastelRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("stagger grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4", className)}>{children}</div>
  );
}

/**
 * A queue with nothing left in it — the one moment a page earns a picture.
 */
export function FinishedState({
  art = "caught-up",
  title,
  description,
  action,
  size = 150,
}: {
  art?: ConsoleArt;
  title: string;
  description?: string;
  action?: ReactNode;
  size?: number;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
      <Art name={art} size={size} className="mb-1" />
      <p className="font-display text-lg font-bold text-strong">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** A console card: the plain surface everything that is not a banner or a tile sits on. */
export function ConsoleCard({
  id,
  title,
  subtitle,
  icon,
  action,
  footer,
  children,
  className,
}: {
  id?: string;
  title: string;
  subtitle?: ReactNode;
  icon?: string;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-label={title}
      className={cx("scroll-section flex flex-col rounded-3xl border border-line bg-card shadow-card", className)}
    >
      <header className="flex flex-wrap items-center gap-3 px-5 pt-5 pb-3 sm:px-6">
        {icon && (
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-sunken text-primary">
            <Icon name={icon} className="text-[20px]" />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="font-display text-[1.05rem] font-bold text-strong">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
        </div>
        {action && <div className="ml-auto">{action}</div>}
      </header>
      <div className="flex-1">{children}</div>
      {footer && <footer className="border-t border-line px-5 py-3.5 text-sm sm:px-6">{footer}</footer>}
    </section>
  );
}

const PACKS: Record<string, "tablet" | "capsule" | "syrup" | "device"> = {
  TABLET: "tablet",
  SACHET: "tablet",
  CAPSULE: "capsule",
  SYRUP: "syrup",
  SUSPENSION: "syrup",
  DROPS: "syrup",
  SOLUTION: "syrup",
  LOTION: "syrup",
};

/**
 * A medicine drawn as its pack — art that is data. Strip, blister, bottle or
 * box tells a pharmacist what is on the shelf before the name is read. Anything
 * not a tablet, capsule or liquid is drawn as a device box.
 */
export function MedicinePack({ form, size = 40, className }: { form: string; size?: number; className?: string }) {
  const pack = PACKS[form] ?? "device";
  return (
    <span
      aria-hidden
      className={cx("grid shrink-0 place-items-center rounded-xl border border-line bg-sunken/70", className)}
      style={{ width: size + 8, height: size + 8 }}
    >
      <Image
        src={`/admin-art/pack-${pack}.svg`}
        alt=""
        width={size}
        height={size}
        draggable={false}
        className="h-auto select-none"
        style={{ width: size }}
      />
    </span>
  );
}

export interface Need {
  key: string;
  href: string;
  icon: string;
  title: string;
  detail: string;
  tone: "critical" | "warning" | "calm";
}

const NEED_TONES = {
  critical: "bg-critical-soft text-critical",
  warning: "bg-warning-soft text-warning",
  calm: "bg-sunken text-primary",
} as const;

/**
 * A to-do list: each line is something waiting on a person, and the way to it.
 * Worst first is the caller's job — the list keeps the order it is given.
 */
export function NeedsList({ items }: { items: Need[] }) {
  return (
    <ul className="flex flex-col gap-1 px-3 pb-3">
      {items.map((need) => (
        <li key={need.key} className="pop-in">
          <Link
            href={need.href}
            className="group flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-sunken focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span aria-hidden className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-xl", NEED_TONES[need.tone])}>
              <Icon name={need.icon} filled={need.tone === "critical"} className="text-[20px]" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[14px] font-semibold text-strong">{need.title}</span>
              <span className="text-[12.5px] text-muted">{need.detail}</span>
            </span>
            <Icon name="chevron_right" className="text-[20px] text-faint transition-transform group-hover:translate-x-0.5" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** How long a load runs before the page says so. */
const SLOW_LOAD_MS = 8000;

/**
 * Said quietly once a load has run long: what is happening, and that nothing
 * is lost. Before then the skeleton alone is the answer.
 */
export function SlowLoadNote() {
  const tr = useTr();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    return () => window.clearTimeout(timer);
  }, []);
  if (!slow) return null;
  return (
    <p role="status" className="rise-in flex items-center gap-2 text-[13px] text-muted">
      <Icon name="hourglass_top" className="text-[17px]" />
      {tr(
        "Taking longer than usual. Your connection may be slow; nothing is lost.",
        "Mamool se zyada waqt lag raha hai. Shayad connection slow hai; kuchh zaya nahi hua.",
      )}
    </p>
  );
}

/**
 * The console page while it loads: grey shapes where the tiles and the card
 * will be, at their real sizes, so nothing jumps when the data lands.
 */
export function ConsoleLoading({ tiles = 4, rows = 4 }: { tiles?: number; rows?: number }) {
  const tr = useTr();
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only" role="status">
        {tr("Loading…", "Load ho raha hai…")}
      </span>
      {tiles > 0 && (
        <div aria-hidden className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: tiles }, (_, index) => (
            <div key={index} className="flex min-h-[150px] flex-col gap-3 rounded-3xl bg-sunken/80 p-5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="mt-auto h-8 w-32" />
              <Skeleton className="h-3 w-40" />
            </div>
          ))}
        </div>
      )}
      {rows > 0 && (
        <div aria-hidden className="flex flex-col gap-4 rounded-3xl border border-line bg-card p-6 shadow-card">
          <Skeleton className="h-5 w-44" />
          {Array.from({ length: rows }, (_, index) => (
            <div key={index} className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-xl" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3.5 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      )}
      <SlowLoadNote />
    </div>
  );
}

export type PillTone = "good" | "warning" | "critical" | "info" | "neutral";

const PILL_TONES: Record<PillTone, string> = {
  good: "bg-stable-soft text-stable",
  warning: "bg-warning-soft text-warning",
  critical: "bg-critical-soft text-critical",
  info: "bg-info-soft text-info",
  neutral: "bg-sunken text-muted",
};

/**
 * A state, said as a word on its own colour — with a dot when it is a status
 * somebody might act on, without one when it only labels (a role, a type).
 */
export function StatusPill({
  tone = "neutral",
  dot,
  icon,
  children,
}: {
  tone?: PillTone;
  dot?: boolean;
  icon?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-[9px] text-[12px] font-semibold whitespace-nowrap",
        PILL_TONES[tone],
      )}
    >
      {dot && <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full bg-current" />}
      {icon && <Icon name={icon} className="text-[14px]" />}
      {children}
    </span>
  );
}

/** "23 Oct · 2:41 PM" — how the console writes a moment. */
export function consoleStamp(iso: string): string {
  const at = new Date(iso);
  const day = at.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
}

/** "2 Jan 2026" — how the console writes a day. */
export function consoleDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * The foot of a console table: where in the list this page is, and the way
 * to the next. Says nothing more when everything fits on one page.
 */
export function Pager({
  offset,
  limit,
  total,
  onChange,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
}) {
  const tr = useTr();
  if (total === 0) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  const last = Math.min(total, offset + limit);
  const button =
    "grid h-8 w-8 place-items-center rounded-full border border-line-strong bg-card text-strong transition-colors hover:bg-sunken focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-card";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-line px-[18px] py-3 text-[13px] text-muted">
      <span className="tabular-nums">
        {tr("Showing ", "")}
        <b className="font-semibold text-strong">
          {offset + 1}–{last}
        </b>
        {tr(` of ${total}`, ` / ${total} dikh rahe hain`)}
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={tr("Previous page", "Pichhla safha")}
            disabled={page <= 1}
            onClick={() => onChange(Math.max(0, offset - limit))}
            className={button}
          >
            <Icon name="chevron_left" className="text-[18px]" />
          </button>
          <span className="px-1.5 tabular-nums">{tr(`Page ${page} of ${pages}`, `Safha ${page} / ${pages}`)}</span>
          <button
            type="button"
            aria-label={tr("Next page", "Agla safha")}
            disabled={page >= pages}
            onClick={() => onChange(offset + limit)}
            className={button}
          >
            <Icon name="chevron_right" className="text-[18px]" />
          </button>
        </div>
      )}
    </div>
  );
}

/** A round 32px action on a table row — an icon, named for a screen reader and a pointer. */
export function RowButton({ label, icon, onClick }: { label: string; icon: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line-strong bg-card text-strong transition-colors hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <Icon name={icon} className="text-[17px]" />
    </button>
  );
}

/** A filter that is on or off, beside a table's tabs: a dot of its colour, and its name. */
export function TogglePill({
  pressed,
  onToggle,
  dot,
  tone = "primary",
  children,
}: {
  pressed: boolean;
  onToggle: () => void;
  /** The dot's colour, as a background class. */
  dot: string;
  /** How it looks when on: navy for a view, red for a warning. */
  tone?: "primary" | "critical";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={cx(
        "inline-flex h-8 items-center gap-2 rounded-full border px-[13px] text-[12.5px] font-semibold whitespace-nowrap transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        !pressed && "border-line-strong bg-card text-strong hover:bg-sunken",
        pressed && tone === "critical" && "border-critical bg-critical-soft text-critical",
        pressed && tone === "primary" && "border-[#0B3FA8] bg-pastel-sky text-primary dark:border-[#7DA2FF]",
      )}
    >
      <span aria-hidden className={cx("h-[7px] w-[7px] shrink-0 rounded-full", dot)} />
      {children}
    </button>
  );
}

/**
 * "PKR 1,655" from the API's string, grouped in the string so an amount is
 * never a float on its way to the screen. Paisa only when there are some.
 */
export function consoleMoney(amount: string | number, currency = "PKR"): string {
  const text = String(amount);
  const negative = text.startsWith("-");
  const [whole, fraction] = (negative ? text.slice(1) : text).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const paisa = fraction && /[1-9]/.test(fraction) ? `.${fraction}` : "";
  return `${negative ? "−" : ""}${currency} ${grouped}${paisa}`;
}

/**
 * Copies one value — an account number, a reference — so it reaches a banking
 * app without being retyped. Says "Copied" by turning into a tick.
 */
export function CopyButton({ value, label, size = 30 }: { value: string; label: string; size?: number }) {
  const tr = useTr();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      aria-label={copied ? tr("Copied", "Copy ho gaya") : label}
      title={copied ? tr("Copied", "Copy ho gaya") : label}
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard?.writeText(value).then(() => setCopied(true));
      }}
      style={{ width: size, height: size }}
      className={cx(
        "grid shrink-0 place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        copied ? "bg-stable-soft text-stable" : "text-muted hover:bg-sunken hover:text-strong",
      )}
    >
      <Icon name={copied ? "check" : "content_copy"} className="text-[15px]" />
    </button>
  );
}
