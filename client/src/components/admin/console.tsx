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
export function LiveDot({ tone = "teal" }: { tone?: "teal" | "red" }) {
  const colour = tone === "red" ? "bg-[#FF8A93]" : "bg-[#5EEAD4]";
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
 * The page's opening: what this place is, said as a sentence with its numbers
 * in it, and the one picture the page is allowed.
 *
 * The hospital render is the default because it is the console's own building;
 * a page whose subject has a drawing of its own (the pharmacy's parcel, the
 * audit trail's shield) passes that instead.
 */
export function ConsoleBanner({
  id,
  eyebrow,
  live = false,
  title,
  children,
  actions,
  stats,
  art = "hospital",
}: {
  id?: string;
  eyebrow: string;
  /** Shows the pulsing dot beside the eyebrow — only for a page that refreshes itself. */
  live?: boolean;
  title: string;
  /** The data sentence. Links inside it are the way into each number. */
  children?: ReactNode;
  actions?: ReactNode;
  stats?: BannerStat[];
  art?: "hospital" | ConsoleArt | null;
}) {
  return (
    <section
      id={id}
      aria-label={title}
      className="console-banner rise-in relative isolate overflow-hidden rounded-[28px] text-white"
    >
      <Image
        src="/admin-art/mesh.svg"
        alt=""
        aria-hidden
        fill
        priority
        sizes="100vw"
        className="-z-10 object-cover opacity-90"
      />

      <div className="relative">
        {art === "hospital" && (
          // Two renders, because the building is lit for the theme around it.
          // Hidden below `lg`: on a narrower screen it would have to sit behind
          // the sentence, and art never sits behind words. It stands on the
          // figures below rather than running under them.
          <span aria-hidden className="art-melt pointer-events-none absolute right-0 bottom-0 hidden w-[min(46%,540px)] lg:block">
            <Image
              src="/hero/hospital-light.webp"
              alt=""
              width={1000}
              height={674}
              priority
              className="art-settle h-auto w-full dark:hidden"
            />
            <Image
              src="/hero/hospital-dark.webp"
              alt=""
              width={1000}
              height={674}
              priority
              className="art-settle hidden h-auto w-full dark:block"
            />
          </span>
        )}
        {art && art !== "hospital" && (
          <span aria-hidden className="pointer-events-none absolute right-8 bottom-0 hidden lg:block">
            <Art name={art} size={180} />
          </span>
        )}

        <div className={cx("relative flex flex-col gap-5 p-6 sm:p-8", art && "lg:max-w-[56%]")}>
          <p className="mono-caps flex items-center gap-2 text-[0.7rem] text-[#9FE8DC]">
            {live && <LiveDot />}
            {eyebrow}
          </p>
          <h1 className="font-display text-[1.9rem] leading-tight font-bold sm:text-[2.25rem]">
            <RevealText text={title} at={0.04} />
          </h1>
          {children && (
            <div className="max-w-xl text-[15.5px] leading-relaxed text-[#D7E3F7] [&_a]:font-semibold [&_a]:text-white [&_a]:underline [&_a]:decoration-white/30 [&_a]:underline-offset-4 hover:[&_a]:decoration-white [&_b]:text-white">
              {children}
            </div>
          )}
          {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
        </div>
      </div>

      {stats && stats.length > 0 && (
        <dl
          className={cx(
            "relative grid grid-cols-2 border-t border-white/10 bg-[#071B45] sm:grid-cols-4",
            "[&>div]:border-white/10 [&>div:nth-child(n+3)]:border-t sm:[&>div:nth-child(n+3)]:border-t-0 [&>div+div]:border-l",
            "[&>div:nth-child(3)]:border-l-0 sm:[&>div:nth-child(3)]:border-l",
          )}
        >
          {stats.map((stat) => (
            <div key={stat.label} className="flex min-w-0 flex-col gap-1 px-5 py-4 sm:px-8">
              <dt className="text-[12px] font-medium text-[#9DB0D1]">{stat.label}</dt>
              <dd className="font-display text-lg font-bold whitespace-nowrap tabular-nums sm:text-xl">{stat.value}</dd>
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
    ghost: "border border-white/25 text-white hover:bg-white/10",
    // #C9363C, not the brighter #E5484D: white on that was 3.9:1.
    critical: "bg-[#C9363C] text-white shadow-[0_10px_24px_-10px_rgba(229,72,77,0.8)] hover:bg-[#B52F35]",
  } as const;
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
        tones[tone],
      )}
    >
      {icon && <Icon name={icon} className="text-[19px]" />}
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
  title,
  children,
  actions,
}: {
  eyebrow?: ReactNode;
  icon?: string;
  title: string;
  /** The data sentence. */
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex w-full flex-wrap items-end gap-x-6 gap-y-4">
      <div className="flex max-w-[44rem] min-w-0 flex-col gap-2">
        {eyebrow && (
          <p className="rise-in flex items-center gap-2 text-[13px] text-muted">
            {icon && <Icon name={icon} className="text-[17px]" />}
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-[2.1rem] leading-[1.05] font-bold tracking-[-0.03em] text-strong sm:text-[2.6rem]">
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
    "inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
    tone === "primary"
      ? "bg-[#0B3FA8] text-white shadow-[0_12px_24px_-12px_rgba(11,63,168,0.8)] hover:bg-[#0A3796] dark:bg-[#3B6FE0] dark:hover:bg-[#4A7BEA]"
      : "border border-line bg-card text-strong hover:bg-sunken",
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
