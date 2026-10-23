"use client";

/**
 * Doctors waiting to be paid.
 *
 * The mirror of the payment queue, and built to be used the same way: with a
 * banking app open beside it. Everything a transfer needs — name, number, bank,
 * amount — is on the card in a form somebody can copy, because a payout typed
 * out of a half-remembered screen is how money reaches the wrong account.
 *
 * Marking one paid asks for the receipt. It is not strictly required, since an
 * administrator may have paid by a route that produces no screenshot, but the
 * absence is recorded rather than hidden — this system asks a patient for proof
 * on the way in, and the way out should not be looser.
 */

import { useCallback, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import {
  ConsoleCard,
  ConsoleHeader,
  CopyButton,
  FinishedState,
  PastelTile,
  StatusPill,
  consoleMoney,
  consoleStamp,
  groupPhone,
} from "@/components/admin/console";
import { useNow } from "@/components/doctorApplication/shared";
import { useToast } from "@/components/overlays";
import { Button, ErrorState, Field, Input, SkeletonRows, cx } from "@/components/ui";
import { ApiError, withdrawalReview, type PendingWithdrawal, type WithdrawalMethod } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { useAsync, QUEUE_REFRESH_MS } from "@/lib/useAsync";

const DAY_MS = 86_400_000;

/** Each service by the name on its own app, not the enum's capitals. */
const METHOD: Record<WithdrawalMethod, string> = {
  BANK: "Bank",
  EASYPAISA: "Easypaisa",
  JAZZCASH: "JazzCash",
  NAYAPAY: "NayaPay",
};

/** A value the administrator will copy into their banking app, with the button that does it. */
function Detail({ label, value, shown, mono }: { label: string; value: string; shown?: string; mono?: boolean }) {
  const tr = useTr();
  // A dt and a dd, and nothing else, inside the group — the copy button lives
  // in the dd beside the value it copies, set against the box's right edge.
  // It copies the value as stored; `shown` is only how it reads.
  return (
    <div className="relative flex flex-col gap-0.5 rounded-[14px] border border-line bg-card py-2.5 pr-12 pl-3">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="m-0">
        <span className={cx("block truncate font-semibold text-strong", mono ? "font-mono text-[12.5px]" : "text-[13.5px]")}>
          {shown ?? value}
        </span>
        <span className="absolute top-1/2 right-3 -translate-y-1/2">
          <CopyButton bordered value={value} label={tr(`Copy ${label.toLowerCase()}`, `${label} copy karein`)} />
        </span>
      </dd>
    </div>
  );
}

function initialsOf(name: string): string {
  return (
    name
      .replace(/^Dr\.?\s+/i, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function Request({ withdrawal, onDecided }: { withdrawal: PendingWithdrawal; onDecided: () => void }) {
  const tr = useTr();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");

  async function act(what: "paid" | "reject") {
    setBusy(true);
    try {
      if (what === "paid") {
        await withdrawalReview.markPaid(withdrawal.id, {
          reference: reference.trim(),
          file: file ?? undefined,
        });
        toast.show({
          tone: "success",
          title: tr("Marked as paid", "Ada shuda darj ho gaya"),
          body: tr("The doctor has been emailed.", "Doctor ko email chali gayi."),
        });
      } else {
        await withdrawalReview.reject(withdrawal.id, reason.trim());
        toast.show({
          tone: "success",
          title: tr("Request rejected", "Darkhwast mustard ho gayi"),
          body: tr("The amount is back in the doctor's balance.", "Raqam doctor ke balance mein wapas chali gayi."),
        });
      }
      onDecided();
    } catch (cause) {
      toast.show({
        tone: "critical",
        title: tr("That did not work", "Yeh nahi ho saka"),
        body: cause instanceof ApiError ? cause.message : String(cause),
      });
    } finally {
      setBusy(false);
    }
  }

  const bank = withdrawal.method === "BANK";

  return (
    <li className="flex flex-col gap-3.5 rounded-[20px] border border-line bg-[var(--console-soft,var(--surface-sunken))] px-[18px] py-4">
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-pastel-sky text-[13px] font-bold text-primary">
          {initialsOf(withdrawal.doctorName)}
        </span>
        <span className="flex flex-col">
          <span className="text-[15px] font-semibold text-strong">{withdrawal.doctorName}</span>
          {withdrawal.createdAt && (
            <span className="text-[12.5px] text-muted tabular-nums">
              {tr(`Asked ${consoleStamp(withdrawal.createdAt)}`, `${consoleStamp(withdrawal.createdAt)} ko manga`)}
            </span>
          )}
        </span>
        <StatusPill>{METHOD[withdrawal.method]}</StatusPill>
        <span className="ml-auto font-display text-[22px] font-bold text-strong tabular-nums">
          {consoleMoney(withdrawal.amount, withdrawal.currency)}
        </span>
      </div>

      <dl className="grid gap-2.5 sm:grid-cols-3">
        <Detail label={tr("Account name", "Account ka naam")} value={withdrawal.accountName} />
        <Detail
          label={bank ? tr("Account number", "Account number") : tr("Mobile number", "Mobile number")}
          value={withdrawal.accountNumber}
          shown={bank ? undefined : groupPhone(withdrawal.accountNumber, "local")}
          mono
        />
        <Detail
          label={bank ? tr("Bank", "Bank") : tr("Service", "Service")}
          value={withdrawal.bankName ?? METHOD[withdrawal.method]}
        />
      </dl>

      {paying ? (
        <div className="space-y-3 rounded-2xl border border-line bg-card p-4">
          <Field
            label={tr("Transfer reference", "Transfer ka reference")}
            htmlFor={`ref-${withdrawal.id}`}
            hint={tr("Optional, but useful later.", "Ikhtiyari, magar baad mein kaam aata hai.")}
          >
            <Input id={`ref-${withdrawal.id}`} maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} />
          </Field>
          <div>
            <input
              id={`proof-${withdrawal.id}`}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <label
              htmlFor={`proof-${withdrawal.id}`}
              className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-line-strong bg-card px-[18px] text-[13.5px] font-semibold text-strong hover:bg-sunken"
            >
              <Icon name="image" className="text-[18px]" />
              {file ? file.name : tr("Attach the receipt", "Receipt lagayein")}
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button loading={busy} onClick={() => act("paid")}>
              {tr("Confirm sent", "Bhej diya — tasdeeq")}
            </Button>
            <Button variant="ghost" onClick={() => setPaying(false)}>
              {tr("Cancel", "Cancel")}
            </Button>
          </div>
        </div>
      ) : rejecting ? (
        <div className="space-y-3 rounded-2xl border border-critical/35 bg-critical-soft p-4">
          <Field
            label={tr("Why is this being rejected?", "Yeh kyun mustard ho raha hai?")}
            htmlFor={`reason-${withdrawal.id}`}
            hint={tr(
              "The doctor reads this, and the amount returns to their balance.",
              "Doctor yeh parhega, aur raqam us ke balance mein wapas chali jaye gi.",
            )}
          >
            <Input id={`reason-${withdrawal.id}`} maxLength={500} autoFocus value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={() => act("reject")}>
              {tr("Reject request", "Darkhwast mustard karein")}
            </Button>
            <Button variant="ghost" onClick={() => setRejecting(false)}>
              {tr("Cancel", "Cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setPaying(true)}>
            <Icon name="check" className="text-[18px]" />
            {tr("I have sent this", "Maine bhej diya hai")}
          </Button>
          <Button variant="ghost" className="!text-critical" onClick={() => setRejecting(true)}>
            {tr("Reject", "Mustard karein")}
          </Button>
        </div>
      )}
    </li>
  );
}

export default function AdminWithdrawals() {
  const tr = useTr();
  const now = useNow(true, 60_000);
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((n) => n + 1), []);
  const queue = useAsync(() => withdrawalReview.pending({ limit: 50 }), [refresh], {
    refreshMs: QUEUE_REFRESH_MS,
  });

  const rows = queue.data?.data ?? [];
  // Requests in one queue can be in different currencies only in principle;
  // the sum is shown when they agree, and left out rather than mixed when not.
  const currencies = new Set(rows.map((row) => row.currency));
  const total = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const oneCurrency = currencies.size === 1 ? [...currencies][0] : null;
  const largest = rows.reduce<PendingWithdrawal | null>(
    (best, row) => (!best || Number(row.amount) > Number(best.amount) ? row : best),
    null,
  );
  const oldest = rows.reduce<PendingWithdrawal | null>(
    (first, row) => (row.createdAt && (!first?.createdAt || row.createdAt < first.createdAt) ? row : first),
    null,
  );
  const waitedDays = oldest?.createdAt ? Math.floor((now - Date.parse(oldest.createdAt)) / DAY_MS) : 0;
  const figure = (value: number) => new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(value);

  return (
    <AppShell role="ADMIN">
      <div id="main" className="space-y-[22px]">
        <ConsoleHeader
          mark="withdrawals"
          eyebrow={tr("Doctors' earnings, paid out", "Doctors ki kamai ki adaigi")}
          title={tr("Withdrawals", "Withdrawals")}
        >
          <p>
            {rows.length > 0 ? (
              <>
                <a href="#requests">
                  {tr(
                    `${rows.length} ${rows.length === 1 ? "doctor is" : "doctors are"} waiting to be paid`,
                    `${rows.length} doctors adaigi ke muntazir`,
                  )}
                </a>
                {oneCurrency && (
                  <>
                    {", "}
                    <b>
                      {oneCurrency} {figure(total)}
                    </b>{" "}
                    {tr("in all", "kul")}
                  </>
                )}
                .{" "}
              </>
            ) : null}
            {tr(
              "Send each transfer from the hospital's account, then record its reference here.",
              "Har transfer hospital ke account se bhejein, phir us ka reference yahan darj karein.",
            )}
          </p>
        </ConsoleHeader>

        {rows.length > 0 && (
          <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-3">
            <PastelTile
              pastel="butter"
              icon="account_balance_wallet"
              label={tr("Waiting to be paid", "Adaigi baqi")}
              unit={oneCurrency ?? undefined}
              value={oneCurrency ? figure(total) : rows.length}
              note={tr(`${rows.length} ${rows.length === 1 ? "request" : "requests"}`, `${rows.length} darkhwastein`)}
            />
            {largest && (
              <PastelTile
                pastel="sky"
                icon="arrow_upward"
                label={tr("Largest request", "Sab se bari darkhwast")}
                unit={largest.currency}
                value={figure(Number(largest.amount) || 0)}
                note={largest.doctorName}
              />
            )}
            {oldest?.createdAt && (
              <PastelTile
                pastel="lilac"
                icon="schedule"
                label={tr("Waiting longest", "Sab se lamba intezar")}
                value={waitedDays < 1 ? tr("Today", "Aaj") : tr(`${waitedDays} ${waitedDays === 1 ? "day" : "days"}`, `${waitedDays} din`)}
                note={tr(`Since ${consoleStamp(oldest.createdAt)}`, `${consoleStamp(oldest.createdAt)} se`)}
              />
            )}
          </div>
        )}

        <div id="requests" className="scroll-mt-24">
          <ConsoleCard
            icon="account_balance"
            title={tr("Requests", "Darkhwastein")}
            subtitle={tr(
              "Oldest first. Copy each detail into the banking app; nothing is typed by hand.",
              "Sab se purani pehle. Har detail banking app mein copy karein; kuch haath se na likhein.",
            )}
            className="rise-in"
          >
            {queue.loading && !queue.data && (
              <div className="px-5 pb-5">
                <SkeletonRows rows={2} title={false} />
              </div>
            )}
            {queue.error && (
              <div className="px-5 pb-5">
                <ErrorState message={queue.error.message} onRetry={queue.reload} />
              </div>
            )}
            {queue.data && rows.length === 0 && (
              <FinishedState
                size={130}
                title={tr("Nothing waiting", "Kuch zer-e-intezar nahi")}
                description={tr("Withdrawal requests from doctors appear here.", "Doctors ki withdrawal darkhwastein yahan aayengi.")}
              />
            )}
            {rows.length > 0 && (
              <ul className="flex flex-col gap-2.5 px-3.5 pb-3.5">
                {rows.map((withdrawal) => (
                  <Request key={withdrawal.id} withdrawal={withdrawal} onDecided={reload} />
                ))}
              </ul>
            )}
          </ConsoleCard>
        </div>
      </div>
    </AppShell>
  );
}
