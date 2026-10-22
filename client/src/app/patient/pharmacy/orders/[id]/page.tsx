"use client";

/**
 * One medicine order: where it is, and the one thing it needs next.
 *
 * The top of the page always answers "what do I do now" — upload the
 * prescription, pay the invoice, wait for the doctor, or nothing at all —
 * before the timeline, the lines and the address below it.
 */

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { PayInvoice } from "@/components/PayInvoice";
import { Dialog } from "@/components/overlays";
import {
  FORM_ICON,
  OrderStatusBadge,
  OrderTimeline,
  rupees,
  useCart,
} from "@/components/pharmacy/shared";
import { Badge, Button, Card, ErrorState, Field, Input, SkeletonRows, cx } from "@/components/ui";
import { ApiError, pharmacy, type Order, type ProductForm } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { useAsync } from "@/lib/useAsync";

const RX_TYPES = "image/jpeg,image/png,image/webp,application/pdf";

/** `?placed=1` arrives from checkout; reading it needs a Suspense boundary. */
function JustPlaced() {
  const tr = useTr();
  const search = useSearchParams();
  if (!search.get("placed")) return null;
  return (
    <div role="status" className="pop-in mt-6 flex items-center gap-4 rounded-2xl border border-line bg-card p-5 shadow-card">
      <span aria-hidden className="bg-gradient-brand grid h-12 w-12 shrink-0 place-items-center rounded-full text-white">
        <Icon name="check" className="text-[26px]" />
      </span>
      <div>
        <p className="font-display text-lg font-bold text-strong">{tr("Order placed!", "Order ho gaya!")}</p>
        <p className="text-sm text-muted">
          {tr("We will message you at every step.", "Har marhale par hum aap ko batayenge.")}
        </p>
      </div>
    </div>
  );
}

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const tr = useTr();
  const order = useAsync(() => pharmacy.order(id), [id], { refreshMs: 30_000 });
  const [paying, setPaying] = useState(false);

  return (
    <AppShell role="PATIENT">
      <div id="main">
        <Link
          href="/patient/pharmacy/orders"
          className="group inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
        >
          <Icon name="arrow_back" className="text-[18px] transition-transform group-hover:-translate-x-0.5" />
          {tr("My orders", "Mere orders")}
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
            <PageHeader
              eyebrow="MediNova Pharmacy"
              title={order.data.orderNumber}
              subtitle={tr(
                `Placed ${new Date(order.data.createdAt).toLocaleString(undefined, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}`,
                `${new Date(order.data.createdAt).toLocaleString(undefined, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} ko diya gaya`,
              )}
              actions={<OrderStatusBadge status={order.data.status} />}
            />

            <Suspense fallback={null}>
              <JustPlaced />
            </Suspense>

            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-w-0 space-y-6">
                <NextStep order={order.data} onChanged={order.reload} onPay={() => setPaying(true)} />

                <Card icon="medication" title={tr("Items", "Cheezein")} flush>
                  <ul className="divide-y divide-line">
                    {order.data.items.map((item) => (
                      <li key={item.id} className="flex items-center gap-3 px-5 py-3">
                        <span aria-hidden className="bg-gradient-soft grid h-10 w-10 shrink-0 place-items-center rounded-xl text-primary">
                          <Icon name={FORM_ICON[item.form as ProductForm] ?? "medication"} className="text-[20px]" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-strong">
                            {[item.productName, item.strength].filter(Boolean).join(" ")}
                          </p>
                          <p className="text-xs text-muted">
                            {item.packSize} · {item.quantity} × {rupees(item.unitPrice)}
                          </p>
                          {item.rxRequired && (
                            <Badge tone={item.coveredByPrescription ? "good" : "warning"}>
                              {item.coveredByPrescription
                                ? tr("Covered by your prescription", "Aap ke nuskhe mein")
                                : tr("Prescription needed", "Nuskha zaroori")}
                            </Badge>
                          )}
                        </div>
                        <span className="font-semibold tabular-nums text-strong">{rupees(item.lineTotal)}</span>
                      </li>
                    ))}
                  </ul>
                  <dl className="space-y-1.5 border-t border-line px-5 py-4 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted">{tr("Medicines", "Dawaiyan")}</dt>
                      <dd className="tabular-nums">{rupees(order.data.subtotal)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted">{tr("Delivery", "Delivery")}</dt>
                      <dd className="tabular-nums">
                        {Number(order.data.deliveryFee) === 0 ? tr("Free", "Muft") : rupees(order.data.deliveryFee)}
                      </dd>
                    </div>
                    <div className="flex justify-between pt-1.5 text-base">
                      <dt className="font-semibold text-strong">{tr("Total", "Kul")}</dt>
                      <dd className="font-display font-bold tabular-nums text-strong">{rupees(order.data.total)}</dd>
                    </div>
                  </dl>
                </Card>
              </div>

              <aside className="space-y-6">
                <Card icon="route" title={tr("Tracking", "Tracking")}>
                  <OrderTimeline steps={order.data.timeline} />
                  {order.data.trackingNumber && (
                    <p className="mt-4 rounded-xl bg-sunken px-3 py-2 text-sm">
                      <span className="text-muted">{order.data.courier}</span>{" "}
                      <span className="font-mono font-semibold text-strong">{order.data.trackingNumber}</span>
                    </p>
                  )}
                </Card>
                <Card icon="home_pin" title={tr("Delivering to", "Yahan bhejein ge")}>
                  <p className="font-semibold text-strong">{order.data.recipientName}</p>
                  <p className="text-sm text-muted">{order.data.addressLine}</p>
                  <p className="text-sm text-muted">{order.data.city}</p>
                  <p className="mt-1 text-sm tabular-nums text-muted">{order.data.phone}</p>
                  <p className="mt-3 text-sm">
                    <span className="text-muted">{tr("Payment:", "Payment:")}</span>{" "}
                    <span className="font-semibold text-strong">
                      {order.data.paymentMethod === "COD"
                        ? tr("Cash on delivery", "Cash on delivery")
                        : tr("Online transfer", "Online transfer")}
                    </span>
                  </p>
                </Card>
                <CancelOrder order={order.data} onDone={order.reload} />
              </aside>
            </div>

            {order.data.invoice && (
              <PayInvoice
                invoice={order.data.invoice}
                open={paying}
                onClose={() => setPaying(false)}
                onSubmitted={() => {
                  setPaying(false);
                  order.reload();
                }}
              />
            )}
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

function NextStep({ order, onChanged, onPay }: { order: Order; onChanged: () => void; onPay: () => void }) {
  const tr = useTr();
  const router = useRouter();
  const cart = useCart();
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      await pharmacy.uploadPrescription(order.id, file);
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : tr("Could not upload the prescription.", "Nuskha upload nahi ho saka."));
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = "";
    }
  };

  const orderAgain = () => {
    for (const item of order.items) {
      if (!item.productId) continue;
      cart.add(
        {
          id: item.productId,
          name: item.productName,
          genericName: item.genericName,
          strength: item.strength,
          form: item.form as ProductForm,
          packSize: item.packSize,
          category: "",
          manufacturer: null,
          description: null,
          price: item.unitPrice,
          rxRequired: item.rxRequired,
          active: true,
          stockState: "IN_STOCK",
          available: true,
        },
        item.quantity,
      );
    }
    router.push("/patient/pharmacy/checkout");
  };

  // An object rather than positional arguments, so the icon-font extractor
  // sees every `icon:` this screen can show (see scripts/icon-names.mjs).
  const step = ((): {
    tone: "warning" | "info" | "good" | "neutral";
    icon: string;
    title: string;
    body: string;
    action?: "upload" | "pay" | "again";
  } => {
    if (order.status === "PENDING_RX" && order.rxRoute === "UPLOAD") {
      return order.hasRxUpload
        ? {
            tone: "info",
            icon: "hourglass_top",
            title: tr("Your prescription is being checked", "Aap ka nuskha check ho raha hai"),
            body: tr(
              "A pharmacist is looking at it now. You can replace the photo if it was unclear.",
              "Pharmacist abhi dekh raha hai. Photo saaf na ho to badal sakte hain.",
            ),
            action: "upload",
          }
        : {
            tone: "warning",
            icon: "photo_camera",
            title: tr("Upload your prescription", "Apna nuskha upload karein"),
            body: tr(
              "A clear photo of the whole prescription, with the doctor's name and the date showing. Nothing is charged until it is approved.",
              "Poore nuskhe ki saaf photo, jis mein doctor ka naam aur tareekh nazar aaye. Manzoori tak kuchh charge nahi hota.",
            ),
            action: "upload",
          };
    }
    if (order.status === "PENDING_RX" && order.rxRoute === "DOCTOR") {
      return {
        tone: "info",
        icon: "stethoscope",
        title: tr("Waiting for your doctor", "Doctor ka intezar"),
        body: tr(
          `${order.rxDoctorName ?? "Your doctor"} has been asked to approve this order. You will be told the moment they answer.`,
          `${order.rxDoctorName ?? "Aap ke doctor"} se manzoori maangi gayi hai. Jawab aate hi aap ko bataya jaye ga.`,
        ),
      };
    }
    if (order.status === "AWAITING_PAYMENT") {
      return order.invoice?.awaitingReview
        ? {
            tone: "info",
            icon: "hourglass_top",
            title: tr("Payment being checked", "Payment check ho rahi hai"),
            body: tr("Your order is confirmed as soon as the transfer is found.", "Transfer milte hi order confirm ho jaye ga."),
          }
        : {
            tone: "warning",
            icon: "payments",
            title: tr(`Pay ${rupees(order.total)} to confirm`, `Confirm karne ke liye ${rupees(order.total)} ada karein`),
            body: tr(
              "Transfer by EasyPaisa or NayaPay and upload the screenshot. Your medicines are held for you meanwhile.",
              "EasyPaisa ya NayaPay se transfer kar ke screenshot bhejein. Tab tak dawaiyan aap ke liye rakhi hain.",
            ),
            action: "pay",
          };
    }
    if (order.status === "CONFIRMED" || order.status === "PACKED") {
      return {
        tone: "info",
        icon: "inventory_2",
        title:
          order.status === "PACKED"
            ? tr("Packed and waiting for the rider", "Pack ho gaya, rider ka intezar")
            : tr("Being prepared", "Tayyar ho raha hai"),
        body:
          order.paymentMethod === "COD"
            ? tr(`Keep ${rupees(order.total)} ready in cash for the rider.`, `Rider ke liye ${rupees(order.total)} cash tayyar rakhein.`)
            : tr("Paid. We will tell you when it leaves.", "Payment ho gayi. Rawana hone par bataya jaye ga."),
      };
    }
    if (order.status === "DISPATCHED") {
      return {
        tone: "info",
        icon: "local_shipping",
        title: tr("On its way", "Raste mein hai"),
        body:
          order.paymentMethod === "COD"
            ? tr(`With ${order.courier}. Keep ${rupees(order.total)} ready in cash.`, `${order.courier} ke paas. ${rupees(order.total)} cash tayyar rakhein.`)
            : tr(`With ${order.courier}.`, `${order.courier} ke paas.`),
      };
    }
    if (order.status === "DELIVERED") {
      return {
        tone: "good",
        icon: "task_alt",
        title: tr("Delivered", "Pahunch gaya"),
        body: tr("Take your medicines as your doctor advised. Get well soon.", "Dawaiyan doctor ki hidayat ke mutabiq lein. Jald sehatyab hon."),
        action: "again",
      };
    }
    return {
      tone: "neutral",
      icon: "cancel",
      title: tr("Cancelled", "Mansookh"),
      body: [
        order.cancelReason,
        order.refundDue
          ? tr("Your payment will be refunded to the account you paid from.", "Aap ki payment usi account mein wapas ki jaye gi.")
          : null,
      ]
        .filter(Boolean)
        .join(" "),
    };
  })();

  const action =
    step.action === "upload" ? (
      <>
        <input
          ref={picker}
          type="file"
          accept={RX_TYPES}
          capture="environment"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <Button loading={busy} onClick={() => picker.current?.click()}>
          <Icon name="upload" className="text-[20px]" />
          {order.hasRxUpload ? tr("Replace photo", "Photo badlein") : tr("Upload photo", "Photo upload karein")}
        </Button>
      </>
    ) : step.action === "pay" ? (
      <Button onClick={onPay}>
        <Icon name="payments" className="text-[20px]" />
        {tr("Pay now", "Abhi ada karein")}
      </Button>
    ) : step.action === "again" ? (
      <Button variant="secondary" onClick={orderAgain}>
        <Icon name="replay" className="text-[20px]" />
        {tr("Order again", "Dobara order karein")}
      </Button>
    ) : null;

  return (
    <div
      className={cx(
        "flex flex-wrap items-start gap-4 rounded-2xl border p-5",
        step.tone === "warning" && "border-warning/40 bg-warning-soft",
        step.tone === "info" && "border-info/40 bg-info-soft",
        step.tone === "good" && "border-stable/40 bg-stable-soft",
        step.tone === "neutral" && "border-line bg-sunken",
      )}
    >
      <Icon
        name={step.icon}
        filled
        className={cx(
          "mt-0.5 shrink-0 text-[26px]",
          step.tone === "warning" && "text-warning",
          step.tone === "info" && "text-info",
          step.tone === "good" && "text-stable",
          step.tone === "neutral" && "text-muted",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="font-display text-lg font-bold text-strong">{step.title}</p>
        {step.body && <p className="mt-0.5 text-sm text-strong">{step.body}</p>}
        {error && <p role="alert" className="mt-2 text-sm font-medium text-critical">{error}</p>}
      </div>
      {action && <div className="w-full sm:w-auto">{action}</div>}
    </div>
  );
}

function CancelOrder({ order, onDone }: { order: Order; onDone: () => void }) {
  const tr = useTr();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!order.canCancel) return null;

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await pharmacy.cancel(order.id, reason.trim() || undefined);
      setOpen(false);
      onDone();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : tr("Could not cancel.", "Cancel nahi ho saka."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="ghost" className="w-full" onClick={() => setOpen(true)}>
        <Icon name="cancel" className="text-[20px]" />
        {tr("Cancel this order", "Yeh order cancel karein")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        icon="cancel"
        title={tr("Cancel this order?", "Yeh order cancel karein?")}
        description={tr(
          "The medicines go back on the shelf. Anything already paid is refunded.",
          "Dawaiyan wapas shelf par chali jayen gi. Ada shuda raqam wapas ki jaye gi.",
        )}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {tr("Keep it", "Rehne dein")}
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void cancel()}>
              {tr("Cancel order", "Order cancel karein")}
            </Button>
          </>
        }
      >
        <Field label={tr("Reason (optional)", "Wajah (ikhtiyari)")} htmlFor="cancel-reason">
          <Input id="cancel-reason" value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
        </Field>
        {error && <p role="alert" className="mt-3 text-sm font-medium text-critical">{error}</p>}
      </Dialog>
    </>
  );
}
