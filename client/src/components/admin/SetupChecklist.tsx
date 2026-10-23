"use client";

/**
 * What a new hospital still has to do before it runs on its own.
 *
 * Every step is checked against the real state — a doctor approved, a wallet
 * number set, medicines in the catalog — never ticked by hand, so the list is
 * right on the day it is finished and quietly disappears. A hospital that is
 * already running sees nothing here at all.
 *
 * Hiding it is remembered in this browser only: it is a convenience for the
 * person looking at it, not a setting of the hospital's.
 */

import Link from "next/link";
import { useState } from "react";

import { Icon } from "@/components/Icon";
import { cx } from "@/components/ui";
import { account, billingSettings, pharmacy } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { useAsync } from "@/lib/useAsync";

const HIDDEN_KEY = "medinova:setup-hidden";

function readHidden(): boolean {
  try {
    return window.localStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

interface Step {
  key: string;
  done: boolean;
  title: [string, string];
  detail: [string, string];
  href: string;
}

/** "five" — the count in a sentence. */
function spellCount(n: number): string {
  return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] ?? String(n);
}

export function SetupChecklist({ doctors }: { doctors: number }) {
  const tr = useTr();
  const [hidden, setHidden] = useState(() => (typeof window === "undefined" ? false : readHidden()));
  // Each check is its own read and fails on its own: a step that cannot be
  // checked is shown as not done, which is the safe way to be wrong.
  const checks = useAsync(
    () =>
      Promise.all([
        billingSettings.read().catch(() => null),
        pharmacy.products({ includeInactive: true, limit: 1 }).catch(() => null),
        pharmacy.settings().catch(() => null),
        account.twoFactor().catch(() => null),
      ]).then(([billing, catalog, store, twoFactor]) => ({
        wallet: Boolean(billing?.nayapayNumber || billing?.easypaisaNumber),
        catalog: (catalog?.meta.total ?? 0) > 0,
        licence: Boolean(store?.licenseNumber),
        twoFactor: Boolean(twoFactor?.enabled),
      })),
    [],
  );

  if (hidden || !checks.data) return null;

  const steps: Step[] = [
    {
      key: "doctor",
      done: doctors > 0,
      title: ["Approve your first doctor", "Pehla doctor manzoor karein"],
      detail: [
        "They apply with their PMDC registration; you check it and say yes.",
        "Woh PMDC registration ke saath darkhwast dete hain; aap jaanch kar haan karte hain.",
      ],
      href: "/admin/doctor-requests",
    },
    {
      key: "wallet",
      done: checks.data.wallet,
      title: ["Tell patients where to pay", "Mareezon ko batayein kahan ada karein"],
      detail: ["A NayaPay or Easypaisa number on every invoice.", "Har invoice par NayaPay ya Easypaisa number."],
      href: "/admin/billing#wallets",
    },
    {
      key: "catalog",
      done: checks.data.catalog,
      title: ["Stock the pharmacy", "Pharmacy mein dawaiyan rakhein"],
      detail: ["Load the starter catalog or import your own list.", "Starter catalog load karein ya apni list import karein."],
      href: "/admin/pharmacy/catalog",
    },
    {
      key: "licence",
      done: checks.data.licence,
      title: ["Add the pharmacy's licence", "Pharmacy ka licence darj karein"],
      detail: ["Printed on every medicine invoice.", "Har dawa ke invoice par chhapta hai."],
      href: "/admin/pharmacy/settings",
    },
    {
      key: "two-factor",
      done: checks.data.twoFactor,
      title: ["Turn on two-step sign-in", "Do-qadam sign-in chalu karein"],
      detail: [
        "An administrator's password alone should not open the hospital.",
        "Admin ka sirf password hospital nahi kholna chahiye.",
      ],
      href: "/admin/settings#security",
    },
  ];

  const done = steps.filter((step) => step.done).length;
  if (done === steps.length) return null;
  const next = steps.find((step) => !step.done);

  return (
    <section
      aria-label={tr("Getting the hospital ready", "Hospital ki tayyari")}
      className="rise-in rounded-3xl border border-line bg-card px-[22px] py-[18px] shadow-card"
    >
      <div className="flex flex-wrap items-center gap-3">
        <svg aria-hidden viewBox="0 0 40 40" className="h-[42px] w-[42px] shrink-0 -rotate-90">
          <circle cx="20" cy="20" r="16" fill="none" strokeWidth="5" className="stroke-sunken" />
          <circle
            cx="20"
            cy="20"
            r="16"
            fill="none"
            strokeWidth="5"
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={`${done / steps.length} 1`}
            className="stroke-[#0F766E] dark:stroke-[#5EEAD4]"
          />
        </svg>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[16px] font-bold text-strong">
            {tr("Getting the hospital ready", "Hospital ki tayyari")}
          </h2>
          <p className="text-[12.5px] text-muted">
            {tr(`${done} of ${steps.length} done.`, `${steps.length} mein se ${done} mukammal.`)}{" "}
            {tr(
              `Each step ticks itself when it is really done. Gone once all ${spellCount(steps.length)} are.`,
              `Har qadam asal mein mukammal hone par khud tick hota hai. Sab ${steps.length} hone par yeh chala jayega.`,
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setHidden(true);
            try {
              window.localStorage.setItem(HIDDEN_KEY, "1");
            } catch {
              // A private window: hidden for this visit only.
            }
          }}
          className="inline-flex h-8 items-center rounded-full px-[13px] text-[12.5px] font-semibold text-primary hover:bg-[var(--console-soft)] focus-visible:outline-2 focus-visible:outline-primary"
        >
          {tr("Hide", "Chhupayein")}
        </button>
      </div>

      <ol className="mt-3.5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
        {steps.map((step) => {
          const upNext = step === next;
          return (
            <li key={step.key}>
              <Link
                href={step.href}
                className={cx(
                  "flex h-full flex-col gap-1.5 rounded-2xl border p-3.5 transition-colors focus-visible:outline-2 focus-visible:outline-primary",
                  step.done
                    ? "border-transparent bg-[var(--console-soft)]"
                    : upNext
                      ? "border-[#0B3FA8]/30 bg-pastel-sky dark:border-[#7DA2FF]/30"
                      : "border-line bg-card hover:bg-[var(--console-soft)]",
                )}
              >
                <span className="flex items-center gap-2">
                  <Icon
                    name={step.done ? "check_circle" : "radio_button_unchecked"}
                    filled={step.done}
                    className={cx("text-[18px]", step.done ? "text-stable" : upNext ? "text-primary" : "text-faint")}
                  />
                  {upNext && (
                    <span className="font-mono text-[10.5px] tracking-[0.14em] text-primary uppercase">{tr("Up next", "Agla")}</span>
                  )}
                </span>
                <span className={cx("text-[13.5px] font-semibold", step.done ? "text-muted line-through decoration-faint/50" : "text-strong")}>
                  {tr(...step.title)}
                </span>
                {!step.done && <span className="text-[12px] text-muted">{tr(...step.detail)}</span>}
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
