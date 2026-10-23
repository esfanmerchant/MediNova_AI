"use client";

/**
 * The administration console's front door: the frame around its sign-in and
 * its second-factor screen.
 *
 * The public sign-in (`AuthPanel`) speaks to patients — a chat with the
 * assistant, promises about their records. The console's door speaks to the
 * people who run the hospital, in the console's own dress: the navy panel and
 * the form on a quiet ground beside it.
 *
 * **Nothing on this page is live**, and nothing is a picture of the building:
 * the mark as a watermark, one ECG line, and two facts true of every sign-in.
 * A page anybody can open before signing in is no place for the hospital's
 * figures.
 *
 * On a phone the panel folds to a short navy header with the mark, so the form
 * is the first thing under the thumb.
 */

import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "@/components/Icon";
import { LanguageToggle } from "@/components/LanguageToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LiveDot } from "@/components/admin/console";
import { LogoMark } from "@/components/brand/Logo";
import { ConsoleSurface } from "@/components/ui";
import { useTr } from "@/lib/lang";

function Fact({ icon, tone, label, value }: { icon: string; tone: "teal" | "green"; label: string; value: string }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#061230]/55 px-3.5 py-3">
      <span
        aria-hidden
        className={
          tone === "teal"
            ? "grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-[#5EEAD4]/[0.16] text-[#5EEAD4]"
            : "grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-[#3DDC9F]/[0.14] text-[#3DDC9F]"
        }
      >
        <Icon name={icon} className="text-[19px]" />
      </span>
      <span className="flex flex-col">
        <span className="text-[12px] text-[#B9C7DD]">{label}</span>
        <span className="font-semibold text-white">{value}</span>
      </span>
    </li>
  );
}

/**
 * What is behind the door, drawn rather than photographed: two cards in the
 * console's own shapes — a day's visits by hour, a short to-do list — with no
 * figures on them. A screenshot here would be a screen inside a screen, and
 * real numbers on a page anybody can open would be the hospital's business on
 * show; shapes say "this is a calm, orderly console" without either.
 */
function ConsolePreview() {
  const bars = [30, 46, 38, 0, 22, 54, 70, 48, 40, 34, 0, 18];
  return (
    <div aria-hidden className="pointer-events-none absolute right-11 bottom-[150px] -z-10 hidden w-[420px] xl:block">
      <div className="art-settle rounded-[22px] border border-white/[0.14] bg-white/[0.07] p-5 shadow-[0_30px_60px_-28px_rgba(0,0,0,0.6)] backdrop-blur-md">
        <div className="mb-4 flex items-center gap-2">
          <span className="h-2 w-24 rounded-full bg-white/40" />
          <span className="ml-auto h-5 w-16 rounded-full bg-[#5EEAD4]/25" />
        </div>
        <div className="flex h-24 items-end gap-1.5 border-b border-white/15">
          {bars.map((height, index) => (
            <span
              key={index}
              className={`flex-1 rounded-t-[4px] ${index < 3 ? "bg-[#5EEAD4]" : index === 5 ? "bg-white" : "bg-white/30"}`}
              style={{ height: `${height || 5}%` }}
            />
          ))}
        </div>
        <div className="mt-3 flex gap-4">
          <span className="h-2 w-14 rounded-full bg-white/25" />
          <span className="h-2 w-20 rounded-full bg-white/25" />
          <span className="h-2 w-12 rounded-full bg-white/25" />
        </div>
      </div>
      <div className="art-settle absolute -bottom-14 -left-16 w-[250px] rounded-[20px] border border-white/[0.14] bg-[#061230]/70 p-4 shadow-[0_24px_48px_-24px_rgba(0,0,0,0.7)] backdrop-blur-md [animation-delay:0.3s]">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center gap-3 py-2">
            <span className={`h-8 w-8 rounded-xl ${row === 0 ? "bg-[#FF8A93]/30" : "bg-[#FBD27A]/25"}`} />
            <span className="flex flex-1 flex-col gap-1.5">
              <span className="h-2 w-28 rounded-full bg-white/45" />
              <span className="h-1.5 w-20 rounded-full bg-white/20" />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ConsoleAuthFrame({ children }: { children: ReactNode }) {
  const tr = useTr();

  return (
    <main id="main" className="flex min-h-screen flex-col overflow-x-clip bg-canvas lg:flex-row">
      {/* --- the console's panel ------------------------------------------ */}
      <section
        aria-label={tr("MediNova AI administration", "MediNova AI intezamia")}
        className="relative isolate flex flex-col overflow-hidden bg-[radial-gradient(620px_380px_at_92%_-6%,rgba(20,196,193,0.34),transparent_65%),radial-gradient(560px_420px_at_70%_105%,rgba(26,143,199,0.42),transparent_70%),linear-gradient(160deg,#0B2C6B_0%,#0A2358_45%,#071A44_100%)] px-6 py-6 text-[#DCE7F7] lg:m-4 lg:mr-0 lg:min-h-[calc(100vh-2rem)] lg:flex-[1_1_56%] lg:rounded-[32px] lg:px-11 lg:py-10"
      >
        <span aria-hidden className="console-dots pointer-events-none absolute inset-0 -z-10" />
        <ConsolePreview />

        <Link
          href="/"
          className="relative flex w-fit items-center gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
        >
          <span className="grid h-[42px] w-[42px] place-items-center rounded-[13px] bg-white p-1.5">
            <LogoMark className="h-auto w-full" />
          </span>
          <span className="flex flex-col">
            <span className="font-display text-lg font-bold text-white">MediNova AI</span>
            <span className="text-[12.5px] text-[#8EA1C2]">{tr("Administration", "Intezamia")}</span>
          </span>
        </Link>

        {/* Out of sight on a phone, where the panel is a header strip — but
            still there, so the page keeps its one top-level heading. */}
        <div className="relative mt-16 flex max-w-[520px] flex-col gap-3.5 max-lg:sr-only">
          <h1 className="font-display text-[2.625rem] leading-[1.1] font-bold tracking-[-0.02em] text-balance text-white">
            {tr("The whole hospital, on one quiet screen.", "Poora hospital, ek pur-sukoon screen par.")}
          </h1>
          <p className="max-w-[46ch] text-base leading-relaxed text-[#DCE7F7]/80">
            {tr(
              "Visits, doctors, the pharmacy and every rupee — and every record you open, sealed into the audit trail.",
              "Visits, doctors, pharmacy aur har rupaya — aur har khola gaya record audit trail mein mohar band.",
            )}
          </p>
        </div>

        <ul className="relative mt-10 hidden max-w-[420px] flex-col gap-3 lg:flex">
          <Fact
            icon="lock"
            tone="teal"
            label={tr("Signing in", "Sign in")}
            value={tr("Two-step, once you turn it on", "Do-qadam, chalu karne ke baad")}
          />
          <Fact
            icon="verified_user"
            tone="green"
            label={tr("Audit trail", "Audit trail")}
            value={tr("Every sign-in is sealed, failed ones too", "Har sign-in mohar band, nakam bhi")}
          />
        </ul>

        <span className="relative mt-auto hidden pt-10 text-[12.5px] text-[#8EA1C2] lg:block">
          {tr("This page is not linked from the public site.", "Yeh safha public site se link nahi hai.")}
        </span>
      </section>

      {/* --- the form ---------------------------------------------------- */}
      <section className="relative flex flex-1 flex-col items-center justify-center px-5 py-10 sm:px-10 lg:flex-[1_1_44%] lg:py-12">
        <div className="absolute top-4 right-4 flex items-center gap-2 sm:top-6 sm:right-6">
          <LanguageToggle />
          <ThemeToggle />
        </div>

        <div className="rise-in mt-10 flex w-full max-w-[420px] flex-col gap-6 lg:mt-0" style={{ animationDelay: "0.15s" }}>
          {/* The console's fields and buttons: labels above, the navy pill. */}
          <ConsoleSurface.Provider value>{children}</ConsoleSurface.Provider>

          <div className="flex gap-3 rounded-2xl border border-line bg-sunken/60 px-4 py-3.5 text-[13px] leading-normal text-muted">
            <span className="mt-1.5 shrink-0">
              <LiveDot tone="green" />
            </span>
            <span>
              {tr(
                "Every sign-in, and every failed try, is written to the audit trail with the time and the network it came from.",
                "Har sign-in, aur har nakam koshish, waqt aur network ke saath audit trail mein darj hoti hai.",
              )}
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
