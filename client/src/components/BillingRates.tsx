"use client";

/**
 * The rates an administrator owns, and the wallets patients pay into — the
 * console's "Rates and wallets" drawer.
 *
 * The tax rate used to be an environment variable, which put the number a
 * hospital administrator is accountable for behind a redeployment by whoever
 * holds the server. It sits here now, beside two figures that did not exist at
 * all: a platform fee, and what a bill costs if it is paid late.
 *
 * **Each figure can be a flat amount or a share of the bill.** Tax is normally
 * a percentage and a platform fee normally a flat charge, but clinics exist
 * that do the opposite. The unit printed in the box — "PKR" before the figure,
 * "%" after it — is the switch: pressing it reads the same number the other
 * way, so the box always says what its number means.
 *
 * **The one thing this screen has to be honest about** is which invoices a
 * change reaches. Every invoice stores the rates it charged, so changing a
 * number here touches nothing already issued — a bill a patient has been sent
 * must not quietly grow because somebody corrected a percentage this morning.
 *
 * The wallets are shown, not laid open: a wrong number sends a patient's
 * transfer to a stranger, so changing one starts with "Edit" on its row.
 * Nothing here is a secret — it is published to every patient with a bill — so
 * it lives in the database, where the administrator whose account it is can
 * reach it.
 */

import { useEffect, useState } from "react";

import { Icon } from "@/components/Icon";
import { StatusPill, groupPhone } from "@/components/admin/console";
import { useToast } from "@/components/overlays";
import { Button, Field, Input, cx } from "@/components/ui";
import { ApiError, billingSettings, type BillingSettings, type FeeMode } from "@/lib/api";
import { useTr } from "@/lib/lang";

/** One editable figure: what was typed, and how to read it. */
interface Entry {
  value: string;
  mode: FeeMode;
}

interface Draft {
  tax: Entry;
  platform: Entry;
  late: Entry;
  payeeName: string;
  nayapayNumber: string;
  easypaisaNumber: string;
  paymentNote: string;
}

/** "150.00" as the box shows it: "150". */
function plain(amount: string | null | undefined): string {
  return (amount ?? "").replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function draftOf(settings: BillingSettings | null): Draft {
  return {
    tax: { value: plain(settings?.taxPercent), mode: settings?.taxMode ?? "PERCENT" },
    platform: { value: plain(settings?.platformFee), mode: settings?.platformFeeMode ?? "FIXED" },
    late: { value: plain(settings?.lateFee), mode: settings?.lateFeeMode ?? "FIXED" },
    payeeName: settings?.payeeName ?? "",
    nayapayNumber: settings?.nayapayNumber ?? "",
    easypaisaNumber: settings?.easypaisaNumber ?? "",
    paymentNote: settings?.paymentNote ?? "",
  };
}

/**
 * The number somebody meant, out of what they actually typed.
 *
 * People type `15%` into a box labelled "percent" and `PKR 500` or `1,500` into
 * one labelled with a currency, because that is how those quantities are
 * written down everywhere else. The symbols say the same thing the box already
 * says, so they are simply removed.
 *
 * Returns null only when what is left is genuinely not a number.
 */
function parseAmount(raw: string): number | null {
  const cleaned = raw
    .replace(/%/g, "")
    .replace(/,/g, "")
    .replace(/[A-Za-z\s]/g, "")
    .trim();
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** The section names: mono capitals, as the design labels a drawer's parts. */
function SectionLabel({ children }: { children: string }) {
  return <h3 className="font-mono text-[11px] tracking-[0.14em] text-faint uppercase">{children}</h3>;
}

function RateField({
  id,
  label,
  entry,
  onChange,
  currency,
  error,
}: {
  id: string;
  label: string;
  entry: Entry;
  onChange: (entry: Entry) => void;
  currency: string;
  error?: string;
}) {
  const tr = useTr();
  const fixed = entry.mode === "FIXED";
  return (
    <Field label={label} htmlFor={id} error={error}>
      <Input
        id={id}
        inputMode="decimal"
        className={cx("tabular-nums", fixed ? "!pl-[50px]" : "!pr-9")}
        value={entry.value}
        onChange={(event) => onChange({ ...entry, value: event.target.value })}
      />
      {/* The unit is the switch: pressed, the same number is read the other way. */}
      <button
        type="button"
        aria-label={
          fixed
            ? tr(`${label}: ${currency} per invoice — change to a percentage`, `${label}: ${currency} har invoice — feesad karein`)
            : tr(`${label}: a percentage — change to ${currency}`, `${label}: feesad — ${currency} karein`)
        }
        title={fixed ? tr("Make it a percentage", "Feesad karein") : tr(`Make it ${currency}`, `${currency} karein`)}
        onClick={() => onChange({ ...entry, mode: fixed ? "PERCENT" : "FIXED" })}
        className={cx(
          "absolute top-1/2 -translate-y-1/2 rounded text-[13px] font-semibold text-muted underline-offset-2 hover:text-strong hover:underline",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          fixed ? "left-3.5" : "right-3.5",
        )}
      >
        {fixed ? currency : "%"}
      </button>
    </Field>
  );
}

type Wallet = "nayapayNumber" | "easypaisaNumber";

const WALLETS: Array<{ key: Wallet; name: string; tone: "info" | "good" }> = [
  { key: "nayapayNumber", name: "NayaPay", tone: "info" },
  { key: "easypaisaNumber", name: "Easypaisa", tone: "good" },
];

export function BillingRates() {
  const tr = useTr();
  const toast = useToast();

  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [draft, setDraft] = useState<Draft>(draftOf(null));
  const [editing, setEditing] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void billingSettings
      .read()
      .then((loaded) => {
        if (cancelled) return;
        setSettings(loaded);
        setDraft(draftOf(loaded));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const currency = settings?.currency ?? "PKR";
  const patch = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }));

  /** The refusal for one figure, or undefined if it is fine. */
  function problem(entry: Entry): string | undefined {
    const value = parseAmount(entry.value);
    if (value === null) return tr("Enter a number.", "Number likhein.");
    if (entry.mode === "PERCENT" && value > 100) {
      // A share of a bill cannot exceed the bill. Only checkable here, because
      // the same box holds a flat 500 quite legitimately.
      return tr("A percentage cannot be over 100.", "Feesad 100 se zyada nahi ho sakta.");
    }
    return undefined;
  }

  const problems = {
    tax: problem(draft.tax),
    platform: problem(draft.platform),
    late: problem(draft.late),
  };
  const valid = !problems.tax && !problems.platform && !problems.late;
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(settings));
  const anyAccount = Boolean(draft.nayapayNumber.trim() || draft.easypaisaNumber.trim());

  async function save() {
    if (!valid) return;
    if (!dirty) {
      toast.show({ tone: "info", title: tr("Nothing has changed", "Kuchh nahi badla") });
      return;
    }
    setSaving(true);
    try {
      const saved = await billingSettings.update({
        // Sent as the parsed number, not as what was typed: `15%` reaches the
        // API as `15`.
        taxPercent: String(parseAmount(draft.tax.value)),
        taxMode: draft.tax.mode,
        platformFee: String(parseAmount(draft.platform.value)),
        platformFeeMode: draft.platform.mode,
        lateFee: String(parseAmount(draft.late.value)),
        lateFeeMode: draft.late.mode,
        payeeName: draft.payeeName.trim(),
        nayapayNumber: draft.nayapayNumber.trim(),
        easypaisaNumber: draft.easypaisaNumber.trim(),
        paymentNote: draft.paymentNote.trim(),
      });
      setSettings(saved);
      setDraft(draftOf(saved));
      setEditing(null);
      toast.show({
        tone: "success",
        title: tr("Rates and wallets saved", "Rates aur wallets mehfooz"),
        body: tr(
          "Invoices issued from now on use these. Existing invoices are unchanged.",
          "Ab se banne wale invoices inhi par honge. Purane invoices waise hi rahenge.",
        ),
      });
    } catch (cause) {
      toast.show({
        tone: "critical",
        title: tr("Not saved", "Mehfooz nahi hua"),
        body: cause instanceof ApiError ? cause.message : String(cause),
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-muted">{tr("Loading…", "Load ho raha hai…")}</p>;

  return (
    <div className="flex flex-col gap-6">
      <section aria-label={tr("Rates", "Rates")} className="flex flex-col gap-3.5">
        <SectionLabel>{tr("Rates on new invoices", "Naye invoices ke rates")}</SectionLabel>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <RateField
            id="rate-platform"
            label={tr("Platform fee", "Platform fee")}
            entry={draft.platform}
            error={problems.platform}
            currency={currency}
            onChange={(platform) => patch({ platform })}
          />
          <RateField
            id="rate-tax"
            label={tr("Tax", "Tax")}
            entry={draft.tax}
            error={problems.tax}
            currency={currency}
            onChange={(tax) => patch({ tax })}
          />
          {/* Set by the hospital's billing rules rather than here; shown so the
              late fee beside it reads against the days it waits for. */}
          <Field label={tr("Days to pay", "Adaigi ke din")} htmlFor="rate-days">
            <Input
              id="rate-days"
              readOnly
              aria-readonly
              value={String(settings?.paymentTermsDays ?? "")}
              title={tr("Fixed for every invoice", "Har invoice ke liye muqarrar")}
              className="cursor-default !bg-[var(--console-soft,var(--surface-sunken))] tabular-nums"
            />
          </Field>
          {/* Added once when a bill passes its due date, never per day. */}
          <RateField
            id="rate-late"
            label={tr("Late fee", "Der ki fees")}
            entry={draft.late}
            error={problems.late}
            currency={currency}
            onChange={(late) => patch({ late })}
          />
        </div>
        <p className="text-[12.5px] text-muted">
          {tr(
            "An invoice already issued keeps the rates it was issued with.",
            "Jaari shuda invoice apne rates par rehta hai.",
          )}
        </p>
      </section>

      <section aria-label={tr("Wallets", "Wallets")} className="flex flex-col gap-3.5">
        <SectionLabel>{tr("Where patients pay", "Mareez kahan ada karein")}</SectionLabel>
        {/* Said before the rows, not after a failed save: with no account
            entered, the Pay button on every bill has nothing to show. */}
        {!anyAccount && (
          <p role="status" className="flex items-start gap-2 rounded-2xl bg-warning-soft px-3.5 py-3 text-[13px] text-strong">
            <Icon name="info" className="mt-px shrink-0 text-[16px] text-warning" />
            {tr(
              "Until one is filled in, patients are told online payment is unavailable and to pay at the desk.",
              "Jab tak ek nahi bharte, mareezon ko likha aayega ke online adaigi mojood nahi aur desk par ada karein.",
            )}
          </p>
        )}
        {WALLETS.map((wallet) =>
          editing === wallet.key ? (
            <div key={wallet.key} className="flex flex-col gap-3.5 rounded-2xl border border-line-strong p-3.5">
              <span className="flex items-center gap-2">
                <StatusPill tone={wallet.tone}>{wallet.name}</StatusPill>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing(null)}>
                  {tr("Done", "Theek hai")}
                </Button>
              </span>
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <Field
                  label={tr("Account holder", "Account holder")}
                  htmlFor="pay-holder"
                  hint={tr("The name patients see on both wallets.", "Dono wallets par yahi naam dikhega.")}
                >
                  <Input id="pay-holder" value={draft.payeeName} maxLength={120} onChange={(event) => patch({ payeeName: event.target.value })} />
                </Field>
                <Field label={tr(`${wallet.name} number`, `${wallet.name} number`)} htmlFor={`pay-${wallet.key}`}>
                  <Input
                    id={`pay-${wallet.key}`}
                    inputMode="tel"
                    className="font-mono"
                    value={draft[wallet.key]}
                    maxLength={20}
                    placeholder="03XX XXX XXXX"
                    onChange={(event) => patch({ [wallet.key]: event.target.value } as Partial<Draft>)}
                  />
                </Field>
              </div>
              <Field
                label={tr("Note for patients", "Mareezon ke liye note")}
                htmlFor="pay-note"
                hint={tr("Shown under the wallets on every bill. Optional.", "Har bill par wallets ke neeche. Ikhtiyari.")}
              >
                <Input id="pay-note" value={draft.paymentNote} maxLength={300} onChange={(event) => patch({ paymentNote: event.target.value })} />
              </Field>
            </div>
          ) : (
            <div key={wallet.key} className="flex items-center gap-3 rounded-2xl border border-line p-3.5">
              <StatusPill tone={wallet.tone}>{wallet.name}</StatusPill>
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="font-semibold text-strong">{draft.payeeName || tr("No account holder yet", "Abhi koi account holder nahi")}</b>
                <span className="font-mono text-[12.5px] text-muted">
                  {draft[wallet.key] ? groupPhone(draft[wallet.key], "local") : tr("Not set", "Nahi diya gaya")}
                </span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => setEditing(wallet.key)}>
                {draft[wallet.key] ? tr("Edit", "Badlein") : tr("Add", "Shamil karein")}
              </Button>
            </div>
          ),
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} loading={saving} disabled={!valid}>
          {tr("Save rates and wallets", "Rates aur wallets mehfooz karein")}
        </Button>
        {dirty && <span className="text-[13px] text-muted">{tr("Unsaved changes", "Tabdeeliyan mehfooz nahi hui")}</span>}
      </div>
    </div>
  );
}
