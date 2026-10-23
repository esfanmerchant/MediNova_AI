"use client";

/**
 * One order, from the pharmacy's side: everything needed to move it on.
 *
 * Only the next legal step is offered, and in the words of the counter — check
 * the prescription, pack it, hand it to the rider, mark it delivered. The
 * server enforces the order of things; this screen just never offers a button
 * it would refuse.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type ReactNode } from "react";

import { AppShell, useDetailCrumb } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { Art, ConsoleCard, ConsoleHeader, MedicinePack, StatusPill, consoleStamp, groupPhone } from "@/components/admin/console";
import { Dialog } from "@/components/overlays";
import { AdminOrderStatus } from "@/components/pharmacy/AdminTabs";
import { STEP_LABEL, rupees } from "@/components/pharmacy/shared";
import { Button, EmptyState, ErrorState, Field, Input, SkeletonRows, Textarea, cx } from "@/components/ui";
import { ApiError, pharmacy, type Order } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { useAsync } from "@/lib/useAsync";

/** The step an order is waiting on, drawn by what it is. */
const STEP_ICON: Record<Order["timeline"][number]["key"], string> = {
  PLACED: "receipt_long",
  PRESCRIPTION: "prescriptions",
  PAID: "payments",
  CONFIRMED: "check",
  PACKED: "inventory_2",
  DISPATCHED: "local_shipping",
  DELIVERED: "task_alt",
  CANCELLED: "close",
};

/** Couriers Pakistani pharmacies commonly hand parcels to. Free text is allowed too. */
const COURIERS = ["TCS", "Leopards", "M&P", "Trax", "PostEx", "BlueEx", "Call Courier", "Own rider"];

export default function AdminOrder() {
  const { id } = useParams<{ id: string }>();
  const tr = useTr();
  const order = useAsync(() => pharmacy.order(id), [id], { refreshMs: 30_000 });
  const data = order.data;
  useDetailCrumb(data?.orderNumber);

  return (
    <AppShell role="ADMIN">
      <div id="main">
        <Link
          href="/admin/pharmacy/orders"
          className="group inline-flex h-8 items-center gap-1 rounded-full px-1.5 text-[12.5px] font-semibold text-primary hover:bg-sunken focus-visible:outline-2 focus-visible:outline-primary"
        >
          <Icon name="chevron_left" className="text-[18px] transition-transform group-hover:-translate-x-0.5" />
          {tr("All orders", "Tamam orders")}
        </Link>

        {order.loading && !data ? (
          <div className="mt-4">
            <SkeletonRows rows={4} />
          </div>
        ) : order.error?.status === 404 ? (
          <section
            aria-label={tr("Not found", "Nahi mila")}
            className="mt-4 rounded-3xl border border-line bg-card py-1 shadow-card"
          >
            <EmptyState
              icon="search"
              title={tr("There is no such order", "Aisa koi order nahi")}
              description={tr(
                "The link may be wrong, or the order was never placed. Orders are never deleted, so search will find it if it exists.",
                "Link ghalat ho sakta hai, ya order kabhi diya hi nahi gaya. Orders kabhi delete nahi hote, is liye agar mojood hai to search mil jayega.",
              )}
              action={
                <Link
                  href="/admin/pharmacy/orders"
                  className="inline-flex h-10 items-center rounded-full bg-[#0B3FA8] px-[18px] text-[13.5px] font-semibold text-white shadow-[0_10px_22px_-12px_rgba(11,63,168,0.8)] hover:bg-[#0A3796] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:bg-[#3B6FE0] dark:hover:bg-[#4A7BEA]"
                >
                  {tr("All orders", "Tamam orders")}
                </Link>
              }
            />
          </section>
        ) : order.error ? (
          <div className="mt-4">
            <ErrorState message={order.error.message} onRetry={order.reload} />
          </div>
        ) : data ? (
          <>
            <div className="mt-3">
              <ConsoleHeader
                mark="orders"
                mono
                eyebrow={tr(`Pharmacy order · placed ${consoleStamp(data.createdAt)}`, `Pharmacy order · ${consoleStamp(data.createdAt)}`)}
                title={data.orderNumber}
                actions={<AdminOrderStatus status={data.status} large />}
              >
                <p>
                  <b>{data.patientName ?? data.recipientName}</b>{" "}
                  {tr(
                    `ordered ${data.items.length} ${data.items.length === 1 ? "medicine" : "medicines"} for`,
                    `ne ${data.items.length} dawaiyan mangwayin,`,
                  )}{" "}
                  <b>{rupees(data.total)}</b>
                  {", "}
                  {data.paymentMethod === "COD" ? tr("cash on delivery", "cash on delivery") : tr("paid by transfer", "transfer se")}
                  {tr(`, going to ${data.city}.`, `, ${data.city} jana hai.`)}
                </p>
              </ConsoleHeader>
            </div>

            <Progress order={data} />

            <div className="mt-[22px] grid grid-cols-1 items-start gap-[22px] lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-w-0 space-y-[22px]">
                <NextStep order={data} onChanged={order.reload} />

                <ConsoleCard
                  icon="medication"
                  title={tr("Medicines", "Dawaiyan")}
                  subtitle={tr(`${data.items.length} ${data.items.length === 1 ? "item" : "items"}`, `${data.items.length} cheezein`)}
                >
                  <ul>
                    {data.items.map((item) => (
                      <li key={item.id} className="flex items-center gap-3 border-t border-line px-[22px] py-3">
                        <MedicinePack form={item.form} size={34} />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-strong">
                            {[item.productName, item.strength].filter(Boolean).join(" ")}{" "}
                            <span className="font-medium text-muted tabular-nums">× {item.quantity}</span>
                          </p>
                          <p className="text-[12.5px] text-muted">
                            {item.genericName} · {item.packSize}
                          </p>
                        </div>
                        {item.rxRequired && (
                          <StatusPill tone={item.coveredByPrescription ? "good" : "warning"}>
                            {item.coveredByPrescription ? tr("Prescribed on MediNova", "MediNova par likhi gayi") : "Rx"}
                          </StatusPill>
                        )}
                        <span className="w-24 text-right font-semibold text-strong tabular-nums">{rupees(item.lineTotal)}</span>
                      </li>
                    ))}
                  </ul>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 border-t border-line px-[22px] pt-3.5 pb-[18px] text-[14px]">
                    <dt className="text-muted">{tr("Medicines", "Dawaiyan")}</dt>
                    <dd className="text-right tabular-nums">{rupees(data.subtotal)}</dd>
                    <dt className="text-muted">{tr("Delivery", "Delivery")}</dt>
                    <dd className="text-right tabular-nums">{rupees(data.deliveryFee)}</dd>
                    <dt className="text-[15px] font-semibold text-strong">{tr("Total", "Kul")}</dt>
                    <dd className="text-right font-display text-[17px] font-bold tabular-nums">{rupees(data.total)}</dd>
                  </dl>
                </ConsoleCard>
              </div>

              <div className="space-y-[22px]">
                <SideCard label={tr("Deliver to", "Yahan bhejein")}>
                  <p className="text-[15px] font-semibold text-strong">{data.recipientName}</p>
                  <p className="text-[13.5px] leading-normal text-muted">
                    {data.addressLine}
                    <br />
                    {data.city}
                  </p>
                  {data.phone && (
                    <a
                      href={`tel:${data.phone}`}
                      className="mt-1 inline-flex h-8 w-fit items-center gap-2 text-[12.5px] font-semibold text-primary tabular-nums hover:underline"
                    >
                      <Icon name="call" className="text-[15px]" />
                      {groupPhone(data.phone)}
                    </a>
                  )}
                  {data.deliveryNotes && (
                    <p className="mt-1.5 rounded-xl bg-[var(--console-soft)] px-3 py-2.5 text-[13px] text-strong">“{data.deliveryNotes}”</p>
                  )}
                </SideCard>
                {data.trackingNumber && (
                  <SideCard label={tr("Courier", "Courier")}>
                    <p className="text-[13.5px] text-strong">
                      {data.courier} <span className="font-mono font-semibold">{data.trackingNumber}</span>
                    </p>
                  </SideCard>
                )}
                {data.invoice ? (
                  <SideCard label={tr("Invoice", "Invoice")}>
                    <p className="font-mono text-[13.5px] font-semibold text-strong">{data.invoice.invoiceNumber}</p>
                    <p className="text-[13.5px] text-muted">
                      {data.invoice.status === "PAID"
                        ? tr("Paid", "Ada shuda")
                        : data.invoice.awaitingReview
                          ? tr("A payment is waiting for you in Transactions", "Aik payment Transactions mein aap ka intezar kar rahi hai")
                          : data.invoice.status}
                    </p>
                    {data.invoice.awaitingReview && (
                      <Link href="/admin/transactions" className="inline-flex w-fit items-center gap-1 text-[13.5px] font-semibold text-primary hover:underline">
                        {tr("Review the payment", "Payment dekhein")} <Icon name="arrow_forward" className="text-[16px]" />
                      </Link>
                    )}
                  </SideCard>
                ) : (
                  data.paymentMethod === "COD" &&
                  (data.status === "CONFIRMED" || data.status === "PACKED") && (
                    <SideCard label={tr("Invoice", "Invoice")}>
                      <p className="text-[13.5px] text-muted">
                        {tr(
                          "Issued when the order is handed to the courier. The rider collects the cash.",
                          "Courier ke hawale karte waqt jaari hoga. Rider cash wasool karega.",
                        )}
                      </p>
                    </SideCard>
                  )
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

function SideCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-1.5 rounded-3xl border border-line bg-card px-[22px] py-5 shadow-card">
      <h2 className="font-mono text-[11px] tracking-[0.14em] text-faint uppercase">{label}</h2>
      {children}
    </section>
  );
}

/**
 * Where the order has got to, left to right. The step it is waiting on is
 * ringed; a cancelled order shows only what happened, ending in red.
 */
function Progress({ order }: { order: Order }) {
  const tr = useTr();
  const cancelled = order.timeline.some((step) => step.key === "CANCELLED");
  const steps = cancelled ? order.timeline.filter((step) => step.done || step.failed) : order.timeline;
  const next = cancelled ? -1 : steps.findIndex((step) => !step.done);
  return (
    <section
      aria-label={tr("Progress", "Pesh-raft")}
      className="rise-in mt-[22px] overflow-x-auto rounded-3xl border border-line bg-card px-6 py-5 shadow-card"
    >
      <ol className="grid min-w-[40rem]" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((step, index) => {
          const bad = step.failed || step.key === "CANCELLED";
          const now = index === next;
          const label = step.failed ? (["Prescription not accepted", "Nuskha manzoor nahi hua"] as [string, string]) : STEP_LABEL[step.key];
          return (
            <li key={step.key} className="flex flex-col gap-2" aria-current={now ? "step" : undefined}>
              <span className="flex items-center">
                <span
                  aria-hidden
                  className={cx(
                    "grid h-7 w-7 shrink-0 place-items-center rounded-full",
                    bad
                      ? "bg-critical-soft text-critical ring-2 ring-critical ring-inset"
                      : step.done
                        ? "bg-[#0B3FA8] text-white dark:bg-[#3B6FE0]"
                        : now
                          ? "bg-card text-primary ring-2 ring-[#0B3FA8] ring-inset outline-4 outline-pastel-sky dark:ring-[#3B6FE0]"
                          : "bg-card text-faint ring-2 ring-line-strong ring-inset",
                  )}
                >
                  {/* A step still to come is an empty ring. */}
                  {(bad || step.done || now) && (
                    <Icon name={bad ? "close" : step.done ? "check" : STEP_ICON[step.key]} className="text-[14px]" />
                  )}
                </span>
                {index < steps.length - 1 && (
                  <span
                    aria-hidden
                    className={cx("mx-2 h-0.5 flex-1 rounded-full", step.done && !bad ? "bg-[#0B3FA8] dark:bg-[#3B6FE0]" : "bg-line-strong")}
                  />
                )}
              </span>
              <span className="flex flex-col gap-0.5 pr-3">
                <span className={cx("text-[13.5px] font-semibold", step.done || now || bad ? "text-strong" : "text-faint")}>
                  {tr(...label)}
                </span>
                <span className="text-[12px] text-muted tabular-nums">
                  {step.at ? consoleStamp(step.at) : now ? tr("Next", "Agla") : ""}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function NextStep({ order, onChanged }: { order: Order; onChanged: () => void }) {
  const tr = useTr();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [dispatching, setDispatching] = useState(false);
  const [courier, setCourier] = useState("TCS");
  const [tracking, setTracking] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [reason, setReason] = useState("");

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await action();
      setRejecting(false);
      setDispatching(false);
      setCancelling(false);
      setRefunding(false);
      setNote("");
      setReason("");
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : tr("That did not work.", "Yeh nahi ho saka."));
    } finally {
      setBusy(null);
    }
  };

  const viewPrescription = async () => {
    setBusy("view");
    setError(null);
    // Opened before the request so a popup blocker sees a click, not a
    // callback. Not with "noopener", which makes `open` return null; the
    // opener is cut by hand instead, before anything loads in the tab.
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    try {
      const { url } = await pharmacy.prescriptionLink(order.id);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (caught) {
      tab?.close();
      setError(caught instanceof ApiError ? caught.message : tr("Could not open the prescription.", "Nuskha khul nahi saka."));
    } finally {
      setBusy(null);
    }
  };

  const cod = order.paymentMethod === "COD";
  // What the strip says, and what it offers, for where the order is.
  let icon = "inventory_2";
  let title = "";
  let detail = "";
  let actions: ReactNode = null;
  let tone: "sky" | "mint" | "blush" = "sky";

  if (order.status === "PENDING_RX" && order.rxRoute === "UPLOAD" && order.hasRxUpload) {
    icon = "prescriptions";
    title = tr("Check the prescription", "Nuskha check karein");
    detail = tr(
      "A real prescription, for this patient, naming these medicines, signed and dated.",
      "Asli nuskha, isi mareez ka, inhi dawaon ke saath, dastakhat aur tareekh shuda.",
    );
    actions = (
      <>
        <Button variant="secondary" loading={busy === "view"} onClick={() => void viewPrescription()}>
          <Icon name="open_in_new" className="text-[18px]" />
          {tr("View prescription", "Nuskha dekhein")}
        </Button>
        <Button loading={busy === "approve"} onClick={() => void run("approve", () => pharmacy.reviewPrescription(order.id, "APPROVE"))}>
          <Icon name="check" className="text-[18px]" />
          {tr("Approve", "Manzoor")}
        </Button>
        <Button variant="ghost" onClick={() => setRejecting(true)}>
          {tr("Not acceptable…", "Qabil-e-qubool nahi…")}
        </Button>
      </>
    );
  } else if (order.status === "PENDING_RX" && order.rxRoute === "UPLOAD") {
    icon = "hourglass_top";
    title = tr("Waiting for the prescription", "Nuskhe ka intezar");
    detail = tr("The patient has not uploaded it yet.", "Mareez ne abhi upload nahi kiya.");
  } else if (order.status === "PENDING_RX") {
    icon = "hourglass_top";
    title = tr("Waiting for the doctor", "Doctor ka intezar");
    detail = tr(`Waiting for ${order.rxDoctorName ?? "the doctor"} to approve.`, `${order.rxDoctorName ?? "Doctor"} ki manzoori ka intezar.`);
  } else if (order.status === "AWAITING_PAYMENT") {
    icon = "payments";
    title = tr("Waiting for the payment", "Payment ka intezar");
    detail = tr(
      "Confirm the patient's transfer from Transactions when it arrives.",
      "Mareez ka transfer aane par Transactions se confirm karein.",
    );
    actions = (
      <Link
        href="/admin/transactions"
        className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line-strong bg-card px-[18px] text-[13.5px] font-semibold text-strong hover:bg-sunken focus-visible:outline-2 focus-visible:outline-primary"
      >
        {tr("Open transactions", "Transactions kholein")}
      </Link>
    );
  } else if (order.status === "CONFIRMED") {
    title = tr("Pack it, then hand it to the courier", "Pack karein, phir courier ke hawale");
    detail = cod
      ? tr(
          `Paid on delivery, so nothing to wait for. The rider collects ${rupees(order.total)}.`,
          `Delivery par adaigi, intezar ki zaroorat nahi. Rider ${rupees(order.total)} wasool karega.`,
        )
      : tr("Paid, so nothing to wait for.", "Ada ho chuka, intezar ki zaroorat nahi.");
    actions = (
      <Button loading={busy === "pack"} onClick={() => void run("pack", () => pharmacy.advance(order.id, "PACKED"))}>
        <Icon name="inventory_2" className="text-[18px]" />
        {tr("Mark as packed", "Pack ho gaya")}
      </Button>
    );
  } else if (order.status === "PACKED") {
    icon = "local_shipping";
    title = tr("Hand it to the courier", "Courier ke hawale karein");
    detail = tr("Add the courier and, if there is one, the tracking number.", "Courier aur, agar ho, tracking number likhein.");
    actions = (
      <Button onClick={() => setDispatching(true)}>
        <Icon name="local_shipping" className="text-[18px]" />
        {tr("Hand to the courier", "Courier ke hawale")}
      </Button>
    );
  } else if (order.status === "DISPATCHED") {
    icon = "local_shipping";
    title = tr("Out for delivery", "Delivery ke liye rawana");
    detail = order.courier
      ? tr(`With ${order.courier}${order.trackingNumber ? `, ${order.trackingNumber}` : ""}.`, `${order.courier} ke paas${order.trackingNumber ? `, ${order.trackingNumber}` : ""}.`)
      : tr("With the courier.", "Courier ke paas.");
    actions = (
      <Button loading={busy === "deliver"} onClick={() => void run("deliver", () => pharmacy.advance(order.id, "DELIVERED"))}>
        <Icon name="task_alt" className="text-[18px]" />
        {cod
          ? tr(`Delivered — ${rupees(order.total)} cash collected`, `Pahunch gaya — ${rupees(order.total)} cash wasool`)
          : tr("Mark as delivered", "Pahunch gaya")}
      </Button>
    );
  } else if (order.status === "DELIVERED") {
    tone = "mint";
    icon = "task_alt";
    title = tr("Delivered", "Pahunch gaya");
    detail = tr("Delivered and paid. Nothing more to do.", "Pahunch gaya aur ada ho gaya. Mazeed kuchh nahi.");
  } else if (order.status === "CANCELLED") {
    tone = "blush";
    icon = "cancel";
    title = tr("Cancelled", "Mansookh");
    detail = order.cancelReason ?? "";
    if (order.refundDue) {
      actions = (
        <Button variant="secondary" onClick={() => setRefunding(true)}>
          <Icon name="currency_exchange" className="text-[18px]" />
          {tr("Record the refund", "Wapsi darj karein")}
        </Button>
      );
    }
  }

  return (
    <section
      aria-label={tr("Next step", "Agla qadam")}
      className={cx(
        "rise-in flex flex-col gap-4 rounded-3xl p-5 text-pastel-ink sm:px-[22px]",
        tone === "sky" && "bg-pastel-sky",
        tone === "mint" && "bg-pastel-mint",
        tone === "blush" && "bg-pastel-blush",
      )}
    >
      <div className="flex flex-wrap items-center gap-4">
        {order.status === "DELIVERED" ? (
          <Art name="parcel" size={56} className="shrink-0" />
        ) : (
          <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-card text-primary">
            <Icon name={icon} className="text-[22px]" />
          </span>
        )}
        <div className="flex min-w-[15rem] flex-[1_1_240px] flex-col gap-[3px]">
          <span className="font-mono text-[11px] tracking-[0.14em] uppercase opacity-80">{tr("Next step", "Agla qadam")}</span>
          <span className="font-display text-[17px] font-bold">{title}</span>
          {detail && <span className="text-[13px] opacity-85">{detail}</span>}
        </div>
        {(actions || order.canCancel) && (
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            {order.canCancel && (
              <Button variant="ghost" onClick={() => setCancelling(true)}>
                {tr("Cancel order", "Order cancel karein")}
              </Button>
            )}
          </div>
        )}
      </div>

      {rejecting && (
        <div className="space-y-3 rounded-2xl border border-line bg-card p-4">
          <Field label={tr("Why? The patient reads this.", "Kyun? Mareez yeh parhe ga.")} htmlFor="rx-note">
            <Textarea
              id="rx-note"
              rows={2}
              maxLength={300}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={tr("e.g. The photo is unreadable — please upload a clearer one.", "maslan Photo parhi nahi ja rahi — saaf photo bhejein.")}
            />
          </Field>
          <Button
            variant="danger"
            disabled={!note.trim()}
            loading={busy === "reject"}
            onClick={() => void run("reject", () => pharmacy.reviewPrescription(order.id, "REJECT", note.trim()))}
          >
            {tr("Refuse and cancel the order", "Inkaar aur order cancel")}
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-critical">
          {error}
        </p>
      )}

      <Dialog
        open={dispatching}
        onClose={() => setDispatching(false)}
        icon="local_shipping"
        title={tr("Hand to the courier", "Courier ke hawale")}
        description={
          cod
            ? tr(`The rider collects ${rupees(order.total)} in cash. The invoice is issued now.`, `Rider ${rupees(order.total)} cash wasool karega. Invoice abhi jaari hoga.`)
            : tr("The patient is told who is bringing it.", "Mareez ko bataya jaye ga ke kaun la raha hai.")
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setDispatching(false)}>
              {tr("Cancel", "Cancel")}
            </Button>
            <Button
              disabled={!courier.trim()}
              loading={busy === "dispatch"}
              onClick={() =>
                void run("dispatch", () =>
                  pharmacy.advance(order.id, "DISPATCHED", { courier: courier.trim(), trackingNumber: tracking.trim() || undefined }),
                )
              }
            >
              {tr("Dispatch", "Rawana karein")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={tr("Courier", "Courier")} htmlFor="courier">
            <Input id="courier" list="couriers" value={courier} maxLength={60} onChange={(event) => setCourier(event.target.value)} />
            <datalist id="couriers">
              {COURIERS.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>
          <Field label={tr("Tracking number (optional)", "Tracking number (ikhtiyari)")} htmlFor="tracking">
            <Input
              id="tracking"
              value={tracking}
              maxLength={80}
              placeholder={tr("Shown to the patient on their order", "Mareez ko un ke order par dikhta hai")}
              onChange={(event) => setTracking(event.target.value)}
            />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        icon="cancel"
        title={tr("Cancel this order?", "Yeh order cancel karein?")}
        description={tr("The stock goes back on the shelf and the patient is told why.", "Stock wapas shelf par jaye ga aur mareez ko wajah batai jaye gi.")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelling(false)}>
              {tr("Keep it", "Rehne dein")}
            </Button>
            <Button
              variant="danger"
              disabled={!reason.trim()}
              loading={busy === "cancel"}
              onClick={() => void run("cancel", () => pharmacy.cancel(order.id, reason.trim()))}
            >
              {tr("Cancel order", "Order cancel karein")}
            </Button>
          </>
        }
      >
        <Field label={tr("Reason", "Wajah")} htmlFor="cancel-why">
          <Input
            id="cancel-why"
            value={reason}
            maxLength={300}
            onChange={(event) => setReason(event.target.value)}
            placeholder={tr("e.g. Out of stock at the supplier", "maslan Supplier ke paas stock khatam")}
          />
        </Field>
      </Dialog>

      <Dialog
        open={refunding}
        onClose={() => setRefunding(false)}
        icon="currency_exchange"
        title={tr("Record the refund", "Wapsi darj karein")}
        description={tr(
          `Send ${rupees(order.total)} back to the account it came from first. This records it with a credit note.`,
          `Pehle ${rupees(order.total)} usi account mein wapas bhejein. Yeh credit note ke saath darj karta hai.`,
        )}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRefunding(false)}>
              {tr("Not yet", "Abhi nahi")}
            </Button>
            <Button
              disabled={reason.trim().length < 3}
              loading={busy === "refund"}
              onClick={() => void run("refund", () => pharmacy.refund(order.id, reason.trim()))}
            >
              {tr("Refund sent", "Wapsi bhej di")}
            </Button>
          </>
        }
      >
        <Field label={tr("Reference", "Reference")} htmlFor="refund-ref">
          <Input
            id="refund-ref"
            value={reason}
            maxLength={300}
            onChange={(event) => setReason(event.target.value)}
            placeholder={tr("e.g. EasyPaisa refund TID 1234567890", "maslan EasyPaisa refund TID 1234567890")}
          />
        </Field>
      </Dialog>
    </section>
  );
}
