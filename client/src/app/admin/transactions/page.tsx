"use client";

/**
 * Every transfer the platform has been told about.
 *
 * The payment queue answers "what needs me now" and shows nothing else, which
 * is right for a queue and left a gap: once a payment was confirmed it vanished
 * from that screen and appeared nowhere. The money existed in an invoice's
 * status and a doctor's balance, and the transfer itself — the thing anyone
 * reconciling against a bank statement actually looks for — had no page.
 *
 * So each row carries both ends and the split. **From** the patient, their
 * invoice, and the account their screenshot says the money left. **To** the
 * service and the account that same screenshot says it went to — including a
 * service this system has no name for, since a patient may pay from JazzCash or
 * a bank app while `method` only knows the two options they were offered.
 *
 * Both ends are read off the image, and the page never pretends otherwise: an
 * account the model could not make out prints "not read" rather than nothing,
 * because a column that goes quiet on failure looks exactly like one where no
 * account was involved.
 *
 * None of it is *asserted*. Whether the money reached the account this patient
 * was actually given is a separate question — checked against the account
 * snapshotted on the payment, and answered by the flag in the status column, so
 * a wrong destination stays visible as a wrong destination instead of being
 * silently corrected into looking right.
 *
 * And what the money is made of, taken from the invoice as it was issued rather
 * than recomputed from today's rates: the consultation fee belongs to the
 * doctor, the platform fee and the tax to MediNova AI. A bill from March must
 * still explain March's numbers after somebody edits the rates in April.
 */

import Link from "next/link";
import { useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import {
  ConsoleHeader,
  CopyButton,
  FinishedState,
  Pager,
  PastelTile,
  StatusPill,
  consoleMoney,
  consoleStamp,
  type PillTone,
} from "@/components/admin/console";
import { Segmented } from "@/components/forms";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import { paymentReview, type LedgerPayment, type PaymentClaimStatus } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { PAGE_REFRESH_MS, useAsync } from "@/lib/useAsync";

type Tab = "all" | PaymentClaimStatus;

/** Twenty to a page, newest first. */
const PAGE = 20;

const STATUS: Record<PaymentClaimStatus, { tone: PillTone; label: [string, string] }> = {
  SUBMITTED: { tone: "info", label: ["Awaiting review", "Tasdeeq baqi"] },
  SUCCEEDED: { tone: "good", label: ["Confirmed", "Tasdeeq shuda"] },
  FAILED: { tone: "critical", label: ["Rejected", "Mustarad"] },
};

/**
 * An account number read off a screenshot, or an honest admission that it was
 * not.
 *
 * The blank matters. Every number in the two columns either side of this comes
 * from a model reading an image, and a column that renders nothing when the
 * reading failed looks identical to one where no account was involved. Saying
 * "not read" costs a line and stops a reviewer inferring something that was
 * never established.
 */
function Account({ value }: { value: string | null }) {
  const tr = useTr();
  if (!value) {
    return <span className="block text-[12px] text-faint italic">{tr("account not read", "account nahi parha gaya")}</span>;
  }
  return <span className="block font-mono text-[12px] text-muted select-all">{value}</span>;
}

/**
 * One transfer.
 *
 * Laid out as a statement line rather than a card of controls: nothing here is
 * decided, and anything that still needs deciding belongs in the queue where a
 * reviewer has the screenshot in front of them.
 */
function Row({ payment }: { payment: LedgerPayment }) {
  const tr = useTr();
  const status = STATUS[payment.status];
  const flagged = payment.receipt?.concerns.length ?? 0;
  const ours = (Number(payment.platformFee) + Number(payment.tax)).toFixed(2);

  return (
    <tr>
      <td className="whitespace-nowrap text-muted tabular-nums">{payment.createdAt ? consoleStamp(payment.createdAt) : "—"}</td>
      {/* From: who, which bill, and the account their screenshot says it left. */}
      <td>
        <span className="block font-semibold whitespace-nowrap">{payment.payerName}</span>
        <span className="block font-mono text-[12px] text-muted">{payment.invoiceNumber}</span>
        <Account value={payment.payerAccount} />
      </td>
      {/* To: the service and the account that same screenshot says it went to.
          Whether that destination is the account this patient was actually
          given is a different question, answered by the flag in Status. */}
      <td>
        <span className="block">{payment.receiptWallet ?? payment.method}</span>
        <Account value={payment.receiptReceiverAccount} />
      </td>
      <td>
        {payment.reference ? (
          <span className="inline-flex items-center gap-1">
            <span className="font-mono text-[12.5px] select-all">{payment.reference}</span>
            <CopyButton value={payment.reference} size={26} label={tr(`Copy transaction ID ${payment.reference}`, `Transaction ID ${payment.reference} copy karein`)} />
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="text-right font-semibold whitespace-nowrap tabular-nums">{consoleMoney(payment.amount, payment.currency)}</td>
      {/* The split, as the invoice recorded it. */}
      <td className="text-right whitespace-nowrap text-muted tabular-nums">{consoleMoney(payment.doctorShare, payment.currency)}</td>
      <td className="text-right whitespace-nowrap text-muted tabular-nums">{consoleMoney(ours, payment.currency)}</td>
      <td>
        <span className="flex flex-col items-start gap-1">
          <StatusPill dot tone={status.tone}>
            {tr(...status.label)}
          </StatusPill>
          {payment.reviewedBy && <span className="text-[12px] text-muted">{payment.reviewedBy}</span>}
          {flagged > 0 && (
            <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-warning">
              <Icon name="warning" className="text-[14px]" />
              {tr(`${flagged} flagged`, `${flagged} nishan-zad`)}
            </span>
          )}
        </span>
      </td>
    </tr>
  );
}

export default function TransactionsPage() {
  const tr = useTr();
  const [tab, setTab] = useState<Tab>("all");
  const [offset, setOffset] = useState(0);

  const ledger = useAsync(
    () => paymentReview.ledger({ status: tab === "all" ? undefined : tab, limit: PAGE, offset }),
    [tab, offset],
    { refreshMs: PAGE_REFRESH_MS },
  );
  // The tiles and the counts on the tabs. Confirmed transfers are read whole
  // (up to a hundred) because their sum is the tile; the others only count.
  const tally = useAsync(
    () =>
      Promise.all([
        paymentReview.ledger({ limit: 1 }),
        paymentReview.ledger({ status: "SUCCEEDED", limit: 100 }),
        paymentReview.ledger({ status: "SUBMITTED", limit: 100 }),
        paymentReview.ledger({ status: "FAILED", limit: 1 }),
      ]).then(([all, confirmed, waiting, rejected]) => ({
        all: all.meta.total,
        confirmed: confirmed.meta.total,
        // What has actually been received, which is not what has been claimed:
        // only confirmed transfers count toward it.
        received: confirmed.data.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
        receivedPartial: confirmed.meta.total > confirmed.data.length,
        waiting: waiting.meta.total,
        claimed: waiting.data.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
        rejected: rejected.meta.total,
      })),
    [],
    { refreshMs: PAGE_REFRESH_MS },
  );
  const counts = tally.data;
  const rows = ledger.data?.data ?? [];
  const pkr = (value: number) => consoleMoney(Math.round(value));

  const options: { value: Tab; label: string; count?: number }[] = [
    { value: "all", label: tr("All", "Sab"), count: counts?.all },
    { value: "SUCCEEDED", label: tr("Confirmed", "Tasdeeq shuda"), count: counts?.confirmed },
    { value: "SUBMITTED", label: tr("Awaiting review", "Tasdeeq baqi"), count: counts?.waiting },
    { value: "FAILED", label: tr("Rejected", "Mustarad"), count: counts?.rejected },
  ];

  return (
    <AppShell role="ADMIN">
      <div id="main" className="space-y-6">
        <ConsoleHeader
          mark="transactions"
          eyebrow={tr("Every transfer patients have reported", "Har transfer jo mareezon ne bataya")}
          title={tr("Transactions", "Transactions")}
        >
          {counts ? (
            <p>
              <b>
                {counts.all} {tr(counts.all === 1 ? "transfer" : "transfers", "transfers")}
              </b>
              {", "}
              <b>{pkr(counts.received)}</b> {tr("confirmed as received.", "wasool hona tasdeeq shuda.")}{" "}
              {counts.waiting > 0 && (
                <>
                  <Link href="/admin/billing#to-confirm">
                    {tr(`${counts.waiting} still ${counts.waiting === 1 ? "needs" : "need"} checking`, `${counts.waiting} ki jaanch baqi`)}
                  </Link>
                  .
                </>
              )}
            </p>
          ) : (
            <p>{tr("Who each transfer came from and where it went.", "Har transfer kis se aaya aur kahan gaya.")}</p>
          )}
        </ConsoleHeader>

        {counts && (
          <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-3">
            <PastelTile
              pastel="mint"
              icon="task_alt"
              label={tr("Confirmed as received", "Wasool tasdeeq shuda")}
              unit="PKR"
              value={pkr(counts.received).replace(/^PKR /, "")}
              note={
                counts.receivedPartial
                  ? tr(`The latest 100 of ${counts.confirmed} transfers`, `${counts.confirmed} mein se aakhri 100 transfers`)
                  : tr(`${counts.confirmed} ${counts.confirmed === 1 ? "transfer" : "transfers"}`, `${counts.confirmed} transfers`)
              }
            />
            <PastelTile
              pastel="butter"
              icon="hourglass_top"
              label={tr("Awaiting review", "Tasdeeq baqi")}
              value={counts.waiting}
              note={tr(`${pkr(counts.claimed)} claimed`, `${pkr(counts.claimed)} ka daawa`)}
              chip={counts.waiting > 0 ? { text: tr("Check", "Jaanch"), tone: "warning" } : undefined}
              href={counts.waiting > 0 ? "/admin/billing#to-confirm" : undefined}
            />
            <PastelTile
              pastel="blush"
              icon="cancel"
              label={tr("Rejected", "Mustarad")}
              value={counts.rejected}
              note={tr("Money that never arrived", "Raqam jo kabhi nahi pahunchi")}
            />
          </div>
        )}

        <section
          aria-label={tr("Transfers", "Transfers")}
          className="rise-in overflow-hidden rounded-3xl border border-line bg-card shadow-card"
        >
          <div className="flex flex-wrap items-center gap-3 px-[18px] py-4">
            <Segmented
              options={options}
              value={tab}
              onChange={(next) => {
                setTab(next);
                setOffset(0);
              }}
              label={tr("Filter transactions", "Transactions chhantein")}
            />
            {/* Said once, above the table, rather than repeated in every cell:
                both account columns are transcriptions of an image. */}
            <span className="flex items-center gap-[7px] text-[12.5px] text-muted sm:ml-auto">
              <Icon name="info" className="text-[15px]" />
              {tr("Account numbers are read from the screenshot, not verified.", "Account numbers screenshot se parhe gaye, tasdeeq shuda nahi.")}
            </span>
          </div>

          {ledger.loading && !ledger.data && (
            <div className="px-[18px] pb-5">
              <SkeletonRows rows={5} title={false} />
            </div>
          )}
          {ledger.error && (
            <div className="px-[18px] pb-5">
              <ErrorState message={ledger.error.message} onRetry={ledger.reload} />
            </div>
          )}
          {ledger.data && rows.length === 0 && tab === "SUBMITTED" && (
            <FinishedState
              title={tr("Every transfer has been checked", "Har transfer ki jaanch ho chuki")}
              description={tr(
                "New ones appear here, and in Billing's queue, the moment a patient reports them.",
                "Naye transfers mareez ke batate hi yahan, aur Billing ki queue mein, aa jate hain.",
              )}
            />
          )}
          {ledger.data && rows.length === 0 && tab !== "SUBMITTED" && (
            <EmptyState
              icon="receipt_long"
              title={tr("Nothing here", "Yahan kuch nahi")}
              description={tr("No transfers match this filter.", "Is filter par koi transfer nahi.")}
            />
          )}
          {rows.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="console-table min-w-[64rem]">
                  <caption className="sr-only">{tr("Payment transactions", "Adaigi ke transactions")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{tr("When", "Kab")}</th>
                      <th scope="col">{tr("From", "Kis se")}</th>
                      <th scope="col">{tr("To", "Kahan")}</th>
                      <th scope="col">{tr("Transaction ID", "Transaction ID")}</th>
                      <th scope="col" className="text-right">
                        {tr("Amount", "Raqam")}
                      </th>
                      <th scope="col" className="text-right">
                        {tr("Doctor", "Doctor")}
                      </th>
                      <th scope="col" className="text-right">
                        MediNova AI
                      </th>
                      <th scope="col">{tr("Status", "Halat")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((payment) => (
                      <Row key={payment.id} payment={payment} />
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager offset={offset} limit={PAGE} total={ledger.data?.meta.total ?? rows.length} onChange={setOffset} />
            </>
          )}
        </section>
      </div>
    </AppShell>
  );
}
