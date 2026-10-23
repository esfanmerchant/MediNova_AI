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
import { useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { Art, ConsoleHeader, MedicinePack } from "@/components/admin/console";
import { Dialog } from "@/components/overlays";
import { OrderStatusBadge, OrderTimeline, rupees } from "@/components/pharmacy/shared";
import { Badge, Button, Card, ErrorState, Field, Input, SkeletonRows, Textarea } from "@/components/ui";
import { ApiError, pharmacy, type Order } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { useAsync } from "@/lib/useAsync";

/** Couriers Pakistani pharmacies commonly hand parcels to. Free text is allowed too. */
const COURIERS = ["TCS", "Leopards", "M&P", "Trax", "PostEx", "BlueEx", "Call Courier", "Own rider"];

export default function AdminOrder() {
  const { id } = useParams<{ id: string }>();
  const tr = useTr();
  const order = useAsync(() => pharmacy.order(id), [id], { refreshMs: 30_000 });

  return (
    <AppShell role="ADMIN">
      <div id="main">
        <Link
          href="/admin/pharmacy/orders"
          className="group inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
        >
          <Icon name="arrow_back" className="text-[18px] transition-transform group-hover:-translate-x-0.5" />
          {tr("All orders", "Tamam orders")}
        </Link>

        {order.loading && !order.data ? (
          <div className="mt-4">
            <SkeletonRows rows={4} />
          </div>
        ) : order.error ? (
          <div className="mt-4">
            <ErrorState message={order.error.message} onRetry={order.reload} />
          </div>
        ) : order.data ? (
          <>
            <div className="mt-2">
              <ConsoleHeader
                icon="local_pharmacy"
                eyebrow={tr("Pharmacy order", "Pharmacy order")}
                title={order.data.orderNumber}
                actions={<OrderStatusBadge status={order.data.status} />}
              >
                <p>
                  <b>{order.data.patientName ?? order.data.recipientName}</b>{" "}
                  {tr(
                    `ordered ${order.data.items.length} ${order.data.items.length === 1 ? "medicine" : "medicines"} for`,
                    `ne ${order.data.items.length} dawaiyan mangwayin,`,
                  )}{" "}
                  <b>{rupees(order.data.total)}</b>
                  {tr(", ", ", ")}
                  {order.data.paymentMethod === "COD"
                    ? tr("cash on delivery", "cash on delivery")
                    : tr("paid by transfer", "transfer se")}
                  {tr(`, going to ${order.data.city}.`, `, ${order.data.city} jana hai.`)}
                </p>
              </ConsoleHeader>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-w-0 space-y-6">
                <Actions order={order.data} onChanged={order.reload} />

                <Card icon="medication" title={tr("Items", "Cheezein")} flush>
                  <ul className="divide-y divide-line">
                    {order.data.items.map((item) => (
                      <li key={item.id} className="flex items-center gap-3 px-5 py-3">
                        <MedicinePack form={item.form} />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-strong">
                            {[item.productName, item.strength].filter(Boolean).join(" ")} × {item.quantity}
                          </p>
                          <p className="text-xs text-muted">
                            {item.genericName} · {item.packSize}
                          </p>
                        </div>
                        {item.rxRequired && (
                          <Badge tone={item.coveredByPrescription ? "good" : "warning"}>
                            {item.coveredByPrescription ? tr("Prescribed on MediNova", "MediNova par likhi gayi") : "Rx"}
                          </Badge>
                        )}
                        <span className="w-24 text-right font-semibold tabular-nums text-strong">{rupees(item.lineTotal)}</span>
                      </li>
                    ))}
                  </ul>
                  <dl className="space-y-1.5 border-t border-line px-5 py-4 text-sm">
                    <div className="flex justify-between"><dt className="text-muted">{tr("Medicines", "Dawaiyan")}</dt><dd className="tabular-nums">{rupees(order.data.subtotal)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">{tr("Delivery", "Delivery")}</dt><dd className="tabular-nums">{rupees(order.data.deliveryFee)}</dd></div>
                    <div className="flex justify-between text-base"><dt className="font-semibold text-strong">{tr("Total", "Kul")}</dt><dd className="font-display font-bold tabular-nums">{rupees(order.data.total)}</dd></div>
                  </dl>
                </Card>
              </div>

              <aside className="space-y-6">
                <Card icon="home_pin" title={tr("Deliver to", "Yahan bhejein")}>
                  <p className="font-semibold text-strong">{order.data.recipientName}</p>
                  <p className="text-sm text-muted">{order.data.addressLine}</p>
                  <p className="text-sm text-muted">{order.data.city}</p>
                  {order.data.phone && (
                    <a href={`tel:${order.data.phone}`} className="mt-2 inline-flex items-center gap-1.5 font-semibold tabular-nums text-primary hover:underline">
                      <Icon name="call" className="text-[18px]" />
                      {order.data.phone}
                    </a>
                  )}
                  {order.data.deliveryNotes && (
                    <p className="mt-2 rounded-lg bg-sunken px-3 py-2 text-sm text-strong">“{order.data.deliveryNotes}”</p>
                  )}
                </Card>
                <Card icon="route" title={tr("Progress", "Pesh-raft")}>
                  <OrderTimeline steps={order.data.timeline} />
                  {order.data.trackingNumber && (
                    <p className="mt-4 rounded-xl bg-sunken px-3 py-2 text-sm">
                      {order.data.courier} <span className="font-mono font-semibold">{order.data.trackingNumber}</span>
                    </p>
                  )}
                </Card>
                {order.data.invoice && (
                  <Card icon="receipt_long" title={tr("Invoice", "Invoice")}>
                    <p className="text-sm tabular-nums text-strong">{order.data.invoice.invoiceNumber}</p>
                    <p className="mt-1 text-sm text-muted">
                      {order.data.invoice.status === "PAID"
                        ? tr("Paid", "Ada shuda")
                        : order.data.invoice.awaitingReview
                          ? tr("A payment is waiting for you in Transactions", "Aik payment Transactions mein aap ka intezar kar rahi hai")
                          : order.data.invoice.status}
                    </p>
                    {order.data.invoice.awaitingReview && (
                      <Link href="/admin/transactions" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
                        {tr("Review the payment", "Payment dekhein")} <Icon name="arrow_forward" className="text-[16px]" />
                      </Link>
                    )}
                  </Card>
                )}
              </aside>
            </div>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

function Actions({ order, onChanged }: { order: Order; onChanged: () => void }) {
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

  return (
    <Card icon="bolt" title={tr("Next step", "Agla qadam")}>
      <div className="space-y-4">
        {order.status === "PENDING_RX" && order.rxRoute === "UPLOAD" && (
          order.hasRxUpload ? (
            <div className="space-y-3">
              <p className="text-sm text-strong">
                {tr(
                  "Check the photo: a real prescription, for this patient, naming these medicines, signed and dated.",
                  "Photo check karein: asli nuskha, isi mareez ka, inhi dawaon ke saath, dastakhat aur tareekh shuda.",
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" loading={busy === "view"} onClick={() => void viewPrescription()}>
                  <Icon name="open_in_new" className="text-[20px]" />
                  {tr("View prescription", "Nuskha dekhein")}
                </Button>
                <Button loading={busy === "approve"} onClick={() => void run("approve", () => pharmacy.reviewPrescription(order.id, "APPROVE"))}>
                  <Icon name="check" className="text-[20px]" />
                  {tr("Approve", "Manzoor")}
                </Button>
                <Button variant="ghost" onClick={() => setRejecting(true)}>
                  {tr("Not acceptable…", "Qabil-e-qubool nahi…")}
                </Button>
              </div>
              {rejecting && (
                <div className="space-y-3 rounded-2xl border border-line bg-sunken/60 p-4">
                  <Field label={tr("Why? The patient reads this.", "Kyun? Mareez yeh parhe ga.")} htmlFor="rx-note">
                    <Textarea id="rx-note" rows={2} maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} placeholder={tr("e.g. The photo is unreadable — please upload a clearer one.", "maslan Photo parhi nahi ja rahi — saaf photo bhejein.")} />
                  </Field>
                  <Button variant="danger" disabled={!note.trim()} loading={busy === "reject"} onClick={() => void run("reject", () => pharmacy.reviewPrescription(order.id, "REJECT", note.trim()))}>
                    {tr("Refuse and cancel the order", "Inkaar aur order cancel")}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">{tr("Waiting for the patient to upload their prescription.", "Mareez ke nuskha upload karne ka intezar.")}</p>
          )
        )}

        {order.status === "PENDING_RX" && order.rxRoute === "DOCTOR" && (
          <p className="text-sm text-muted">
            {tr(`Waiting for ${order.rxDoctorName ?? "the doctor"} to approve.`, `${order.rxDoctorName ?? "Doctor"} ki manzoori ka intezar.`)}
          </p>
        )}

        {order.status === "AWAITING_PAYMENT" && (
          <p className="text-sm text-muted">
            {tr("Waiting for the patient's transfer. Confirm it from Transactions when it arrives.", "Mareez ke transfer ka intezar. Aane par Transactions se confirm karein.")}
          </p>
        )}

        {order.status === "CONFIRMED" && (
          <Button loading={busy === "pack"} onClick={() => void run("pack", () => pharmacy.advance(order.id, "PACKED"))}>
            <Icon name="inventory_2" className="text-[20px]" />
            {tr("Mark as packed", "Pack ho gaya")}
          </Button>
        )}

        {order.status === "PACKED" && (
          <Button onClick={() => setDispatching(true)}>
            <Icon name="local_shipping" className="text-[20px]" />
            {tr("Hand to the courier", "Courier ke hawale")}
          </Button>
        )}

        {order.status === "DISPATCHED" && (
          <Button loading={busy === "deliver"} onClick={() => void run("deliver", () => pharmacy.advance(order.id, "DELIVERED"))}>
            <Icon name="task_alt" className="text-[20px]" />
            {order.paymentMethod === "COD"
              ? tr(`Delivered — ${rupees(order.total)} cash collected`, `Pahunch gaya — ${rupees(order.total)} cash wasool`)
              : tr("Mark as delivered", "Pahunch gaya")}
          </Button>
        )}

        {order.status === "DELIVERED" && (
          <div className="flex items-center gap-4">
            <Art name="parcel" size={88} className="shrink-0" />
            <p className="flex items-center gap-2 text-sm font-semibold text-stable">
              <Icon name="check_circle" filled className="text-[20px]" />
              {tr("Delivered and paid. Nothing more to do.", "Pahunch gaya aur ada ho gaya. Mazeed kuchh nahi.")}
            </p>
          </div>
        )}

        {order.status === "CANCELLED" && (
          <div className="space-y-3 text-sm">
            <p className="text-muted">{order.cancelReason}</p>
            {order.refundDue && (
              <Button variant="secondary" onClick={() => setRefunding(true)}>
                <Icon name="currency_exchange" className="text-[20px]" />
                {tr("Record the refund", "Wapsi darj karein")}
              </Button>
            )}
          </div>
        )}

        {order.canCancel && (
          <div className="border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setCancelling(true)}>
              <Icon name="cancel" className="text-[20px]" />
              {tr("Cancel order", "Order cancel karein")}
            </Button>
          </div>
        )}

        {error && <p role="alert" className="text-sm font-medium text-critical">{error}</p>}
      </div>

      <Dialog
        open={dispatching}
        onClose={() => setDispatching(false)}
        icon="local_shipping"
        title={tr("Hand to the courier", "Courier ke hawale")}
        description={
          order.paymentMethod === "COD"
            ? tr(`The rider collects ${rupees(order.total)} in cash. The invoice is issued now.`, `Rider ${rupees(order.total)} cash wasool karega. Invoice abhi jaari hoga.`)
            : tr("The patient is told who is bringing it.", "Mareez ko bataya jaye ga ke kaun la raha hai.")
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setDispatching(false)}>{tr("Cancel", "Cancel")}</Button>
            <Button
              disabled={!courier.trim()}
              loading={busy === "dispatch"}
              onClick={() => void run("dispatch", () => pharmacy.advance(order.id, "DISPATCHED", { courier: courier.trim(), trackingNumber: tracking.trim() || undefined }))}
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
              {COURIERS.map((name) => <option key={name} value={name} />)}
            </datalist>
          </Field>
          <Field label={tr("Tracking number (optional)", "Tracking number (ikhtiyari)")} htmlFor="tracking">
            <Input id="tracking" value={tracking} maxLength={80} onChange={(event) => setTracking(event.target.value)} />
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
            <Button variant="ghost" onClick={() => setCancelling(false)}>{tr("Keep it", "Rehne dein")}</Button>
            <Button variant="danger" disabled={!reason.trim()} loading={busy === "cancel"} onClick={() => void run("cancel", () => pharmacy.cancel(order.id, reason.trim()))}>
              {tr("Cancel order", "Order cancel karein")}
            </Button>
          </>
        }
      >
        <Field label={tr("Reason", "Wajah")} htmlFor="cancel-why">
          <Input id="cancel-why" value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder={tr("e.g. Out of stock at the supplier", "maslan Supplier ke paas stock khatam")} />
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
            <Button variant="ghost" onClick={() => setRefunding(false)}>{tr("Not yet", "Abhi nahi")}</Button>
            <Button disabled={reason.trim().length < 3} loading={busy === "refund"} onClick={() => void run("refund", () => pharmacy.refund(order.id, reason.trim()))}>
              {tr("Refund sent", "Wapsi bhej di")}
            </Button>
          </>
        }
      >
        <Field label={tr("Reference", "Reference")} htmlFor="refund-ref">
          <Input id="refund-ref" value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder={tr("e.g. EasyPaisa refund TID 1234567890", "maslan EasyPaisa refund TID 1234567890")} />
        </Field>
      </Dialog>
    </Card>
  );
}
