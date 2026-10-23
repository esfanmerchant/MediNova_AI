"use client";

/**
 * The queue where somebody decides whether the money actually arrived.
 *
 * This screen is the only thing standing between a hospital's bills and anybody
 * who can take a screenshot, so it is built to be *checked against something
 * else* rather than to look convincing on its own. The reviewer is expected to
 * have their banking app open beside it; everything here exists to make that
 * comparison quick — the amount, the reference, and the picture, side by side
 * and large enough to read.
 *
 * **Confirming pays the bill.** The button says so, because a reviewer who
 * thinks they are filing a note rather than settling a debt will be careless
 * with it exactly once.
 *
 * A refusal requires a sentence. The patient reads it, and somebody who has
 * genuinely paid needs to know whether to re-upload, transfer again, or come to
 * the desk — "rejected" on its own tells them none of that.
 */

import { useCallback, useState } from "react";

import { Icon } from "@/components/Icon";
import { ConsoleCard, FinishedState, StatusPill, consoleMoney, consoleStamp } from "@/components/admin/console";
import { Dialog, useToast } from "@/components/overlays";
import { Button, ErrorState, Field, Input, SkeletonRows, cx } from "@/components/ui";
import {
  ApiError,
  paymentReview,
  type PendingPayment,
  type ReceiptConcern,
  type ReceiptReading,
} from "@/lib/api";
import { useTr } from "@/lib/lang";
import { useAsync, QUEUE_REFRESH_MS } from "@/lib/useAsync";

/**
 * What was read off the screenshot, beside what the patient typed.
 *
 * This is the only part of the queue that is not evidence, and it says so. A
 * model read the picture when it was uploaded; it can be wrong about a blurry
 * screenshot, and it has certainly not watched money arrive in anybody's
 * account. What it is reliably better than a tired person at is noticing that
 * two long reference numbers differ in the middle, or that a receipt is from
 * three weeks ago.
 *
 * So concerns are stated as questions for the reviewer, never as verdicts, and
 * a field the model could not read produces nothing at all rather than a
 * warning with no evidence behind it.
 */
function ReceiptReadout({
  receipt,
  typed,
  payeeAccount,
}: {
  receipt: ReceiptReading | null;
  typed: string | null;
  /** The account the patient was told to pay into, for the comparison below. */
  payeeAccount: string | null;
}) {
  const tr = useTr();
  if (!receipt) return null;

  const CONCERNS: Record<ReceiptConcern, [string, string]> = {
    NOT_A_RECEIPT: [
      "This image does not look like a payment receipt.",
      "Yeh tasveer adaigi ki raseed nahi lagti.",
    ],
    REFERENCE_MISMATCH: [
      `The receipt shows ${receipt.reference ?? "—"}, not ${typed ?? "—"}.`,
      `Raseed par ${receipt.reference ?? "—"} hai, ${typed ?? "—"} nahi.`,
    ],
    AMOUNT_MISMATCH: [
      `The receipt shows ${receipt.amount ?? "—"}, not the amount owed.`,
      `Raseed par ${receipt.amount ?? "—"} hai, jo waajib raqam nahi.`,
    ],
    STALE_RECEIPT: [
      `This transfer is more than ${receipt.maxAgeDays} days older than the submission.`,
      `Yeh transfer submission se ${receipt.maxAgeDays} din se zyada purana hai.`,
    ],
    WRONG_DESTINATION: [
      `The money went to ${receipt.receiverAccount ?? "another account"}, not to ${
        payeeAccount ?? "the account this patient was given"
      }.`,
      `Paisa ${receipt.receiverAccount ?? "kisi aur account"} mein gaya, ${
        payeeAccount ?? "us account"
      } mein nahi jo is mareez ko diya gaya tha.`,
    ],
    PAID_FROM_A_HOSPITAL_ACCOUNT: [
      "The sender is one of the hospital's own accounts — this receipt shows money leaving, not arriving.",
      "Bhejne wala hospital ka apna account hai — yeh raseed paisa jaate hue dikhati hai, aata hua nahi.",
    ],
  };

  const clean = receipt.concerns.length === 0;

  return (
    <div
      className={cx(
        "rounded-xl border p-3",
        clean ? "border-line bg-sunken" : "border-warning/50 bg-warning-soft",
      )}
    >
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-faint">
        <Icon name="document_scanner" className="text-[15px]" />
        {tr("Read from the screenshot", "Screenshot se parha gaya")}
      </p>

      <dl className="mt-2 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
        {receipt.reference && (
          <div className="flex gap-2">
            <dt className="text-muted">{tr("Reference", "Reference")}</dt>
            <dd className="select-all font-mono font-semibold text-strong">{receipt.reference}</dd>
          </div>
        )}
        {receipt.amount && (
          <div className="flex gap-2">
            <dt className="text-muted">{tr("Amount", "Raqam")}</dt>
            <dd className="font-semibold tabular-nums text-strong">{receipt.amount}</dd>
          </div>
        )}
        {receipt.paidAt && (
          <div className="flex gap-2">
            <dt className="text-muted">{tr("Transferred", "Transfer hua")}</dt>
            <dd className="text-strong">{new Date(receipt.paidAt).toLocaleString()}</dd>
          </div>
        )}
        {receipt.senderAccount && (
          <div className="flex gap-2">
            <dt className="text-muted">{tr("From", "Kis se")}</dt>
            <dd className="font-mono text-strong">{receipt.senderAccount}</dd>
          </div>
        )}
        {receipt.receiverAccount && (
          <div className="flex gap-2">
            <dt className="text-muted">{tr("Into", "Kis account mein")}</dt>
            <dd className="font-mono text-strong">{receipt.receiverAccount}</dd>
          </div>
        )}
      </dl>

      {receipt.concerns.length > 0 && (
        <ul className="mt-2.5 space-y-1">
          {receipt.concerns.map((concern) => (
            <li key={concern} className="flex items-start gap-1.5 text-sm font-medium text-warning">
              <Icon name="warning" className="mt-px shrink-0 text-[16px]" />
              {tr(...CONCERNS[concern])}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2.5 text-xs text-faint">
        {tr(
          "Read automatically. Check the receiving account before confirming — this has not seen the money arrive.",
          "Khud-ba-khud parha gaya. Tasdeeq se pehle apna account khud dekh lein — is ne paisa aata nahi dekha.",
        )}
      </p>
    </div>
  );
}

/** Each wallet by the name on its own app, not the enum's capitals. */
const WALLET: Record<string, string> = {
  NAYAPAY: "NayaPay",
  EASYPAISA: "Easypaisa",
  JAZZCASH: "JazzCash",
  BANK: "Bank transfer",
  BANK_TRANSFER: "Bank transfer",
};

function Claim({
  payment,
  onDecided,
}: {
  payment: PendingPayment;
  onDecided: () => void;
}) {
  const tr = useTr();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [zoomed, setZoomed] = useState(false);

  async function decide(action: "confirm" | "reject") {
    setBusy(true);
    try {
      if (action === "confirm") {
        await paymentReview.confirm(payment.id);
        toast.show({
          tone: "success",
          title: tr("Payment confirmed", "Adaigi tasdeeq ho gayi"),
          body: tr(
            `Invoice ${payment.invoiceNumber} is now marked paid.`,
            `Invoice ${payment.invoiceNumber} ab ada shuda hai.`,
          ),
        });
      } else {
        await paymentReview.reject(payment.id, reason.trim());
        toast.show({
          tone: "success",
          title: tr("Payment rejected", "Adaigi mustard ho gayi"),
          body: tr("The patient will see your reason.", "Mareez ko aap ki wajah dikhegi."),
        });
      }
      setRejecting(false);
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

  const concerns = payment.receipt?.concerns.length ?? 0;

  return (
    <li className="flex flex-col gap-3 rounded-[18px] border border-line bg-[var(--console-soft,var(--surface-sunken))] p-3">
      <div className="flex flex-wrap items-center gap-3.5">
        {/* The screenshot, small: the full picture and what was read off it
            open together, beside each other, under "View receipt". */}
        <button
          type="button"
          onClick={() => setZoomed(true)}
          aria-label={tr("View receipt", "Raseed dekhein")}
          className="grid h-16 w-[52px] shrink-0 place-items-center overflow-hidden rounded-[10px] border border-line bg-[linear-gradient(180deg,#E8F0FE,#FFFFFF)] text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:bg-[linear-gradient(180deg,#132E52,#0B1733)]"
        >
          {payment.proofUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={payment.proofUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <Icon name="phone" className="text-[22px]" />
          )}
        </button>
        <span className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
          <b className="font-semibold text-strong">{payment.patientName}</b>
          <span className="text-[12.5px] text-muted">
            <span className="font-mono">{payment.invoiceNumber}</span> · {WALLET[payment.method] ?? payment.method}
            {payment.reference && (
              <>
                {" "}
                · {tr("ref", "ref")} <span className="font-mono select-all">{payment.reference}</span>
              </>
            )}
          </span>
        </span>
        <span className="font-display text-[17px] font-bold text-strong tabular-nums">
          {consoleMoney(payment.amount, payment.currency)}
        </span>
        <span className="w-[120px] text-[12.5px] text-muted tabular-nums">
          {payment.createdAt ? consoleStamp(payment.createdAt) : "—"}
        </span>
        <span className="flex gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => setZoomed(true)}>
            {tr("View receipt", "Raseed dekhein")}
          </Button>
          {/* "Paid" names the consequence: confirming settles the bill. */}
          <Button size="sm" loading={busy && !rejecting} onClick={() => decide("confirm")}>
            {tr("Confirm paid", "Ada shuda tasdeeq")}
          </Button>
          <Button size="sm" variant="ghost" className="!text-critical" onClick={() => setRejecting(true)}>
            {tr("Reject", "Mustard karein")}
          </Button>
        </span>
      </div>

      {/* What the reading of the screenshot doubts, said where the decision is
          made. A clean reading says nothing here. */}
      {concerns > 0 && (
        <p className="flex items-center gap-1.5 px-1 text-[12.5px] font-semibold text-warning">
          <Icon name="warning" className="text-[15px]" />
          {tr(
            `${concerns === 1 ? "One thing" : `${concerns} things`} on the screenshot to check — see the receipt.`,
            `Screenshot par ${concerns} cheezein dekhni hain — raseed dekhein.`,
          )}
        </p>
      )}

      {rejecting && (
        <div className="space-y-3 rounded-xl border border-line bg-card p-3">
          <Field
            label={tr("Why is this being rejected?", "Yeh kyun mustarad ho raha hai?")}
            htmlFor={`reject-${payment.id}`}
            hint={tr(
              "The patient reads this, so tell them what to do next.",
              "Mareez yeh parhega — usse batayein ke ab kya kare.",
            )}
          >
            <Input
              id={`reject-${payment.id}`}
              value={reason}
              maxLength={500}
              autoFocus
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" size="sm" loading={busy} disabled={reason.trim().length < 3} onClick={() => decide("reject")}>
              {tr("Reject payment", "Adaigi mustarad karein")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRejecting(false)}>
              {tr("Cancel", "Cancel")}
            </Button>
          </div>
        </div>
      )}

      <Dialog
        open={zoomed}
        onClose={() => setZoomed(false)}
        size="lg"
        title={tr("Payment receipt", "Adaigi ki raseed")}
        description={`${payment.patientName} · ${consoleMoney(payment.amount, payment.currency)} · ${payment.invoiceNumber}`}
      >
        <div className="flex flex-col gap-4">
          {payment.proofUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={payment.proofUrl}
              alt={tr("Payment screenshot", "Adaigi ka screenshot")}
              className="mx-auto max-h-[60vh] w-auto rounded-xl border border-line"
            />
          ) : (
            <p className="text-[13.5px] text-muted">{tr("No screenshot was sent with this payment.", "Is adaigi ke saath koi screenshot nahi bheja gaya.")}</p>
          )}
          <ReceiptReadout receipt={payment.receipt} typed={payment.reference} payeeAccount={payment.payeeAccount} />
        </div>
      </Dialog>
    </li>
  );
}

export function PaymentQueue() {
  const tr = useTr();
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((n) => n + 1), []);
  const queue = useAsync(() => paymentReview.pending({ limit: 50 }), [refresh], {
    refreshMs: QUEUE_REFRESH_MS,
  });

  const rows = queue.data?.data ?? [];

  return (
    <ConsoleCard
      icon="checklist"
      iconTone="warning"
      title={tr("Payments to confirm", "Tasdeeq talab adaigiyan")}
      subtitle={tr(
        "Check each against the banking app before confirming — confirming pays the bill.",
        "Tasdeeq se pehle har aik ko banking app se mila lein — tasdeeq bill ada kar deti hai.",
      )}
      action={
        rows.length > 0 && (
          <StatusPill tone="warning">{tr(`${rows.length} waiting`, `${rows.length} muntazir`)}</StatusPill>
        )
      }
    >
      {queue.loading && (
        <div className="px-3.5 pb-3.5">
          <SkeletonRows rows={2} />
        </div>
      )}
      {queue.error && (
        <div className="px-3.5 pb-3.5">
          <ErrorState message={queue.error.message} onRetry={queue.reload} />
        </div>
      )}
      {queue.data && rows.length === 0 && (
        <FinishedState
          size={130}
          title={tr("Nothing waiting", "Kuch zer-e-intezar nahi")}
          description={tr(
            "Payments patients send appear here for you to check.",
            "Mareez jo adaigiyan bhejenge woh yahan tasdeeq ke liye aayengi.",
          )}
        />
      )}
      {rows.length > 0 && (
        <ul className="flex flex-col gap-2 px-3.5 pb-3.5">
          {rows.map((payment) => (
            <Claim key={payment.id} payment={payment} onDecided={reload} />
          ))}
        </ul>
      )}
    </ConsoleCard>
  );
}
