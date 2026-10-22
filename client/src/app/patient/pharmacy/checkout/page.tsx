"use client";

/**
 * Checkout: where to send it, how to pay, and — when a medicine needs one —
 * how its prescription will be cleared.
 *
 * Every figure on this screen comes from the server's quote, asked again
 * whenever the cart changes. The cart's own prices are what the shelf said
 * when something was added; the quote is what will actually be charged, and
 * the two are allowed to differ only until this page loads.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import {
  FORM_ICON,
  QuantityStepper,
  productTitle,
  rupees,
  useCart,
} from "@/components/pharmacy/shared";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Select,
  SkeletonRows,
  Textarea,
  cx,
} from "@/components/ui";
import { ApiError, patients, pharmacy, type OrderPaymentMethod } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { useSession } from "@/lib/session";
import { useAsync } from "@/lib/useAsync";

/** The courier's form of a Pakistani mobile number, or null. Mirrors the server. */
function mobile(value: string): string | null {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("92") && digits.length === 12) digits = `0${digits.slice(2)}`;
  else if (digits.startsWith("3") && digits.length === 10) digits = `0${digits}`;
  return /^03\d{9}$/.test(digits) ? digits : null;
}

function Choice({
  selected,
  disabled,
  onSelect,
  icon,
  title,
  body,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  icon: string;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cx(
        "flex w-full items-start gap-3 rounded-2xl p-4 text-left transition-[box-shadow,border-color] duration-200",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-55",
        selected ? "border-gradient-thick shadow-card" : "border border-line bg-card hover:border-primary",
      )}
    >
      <span
        aria-hidden
        className={cx(
          "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
          selected ? "bg-gradient-brand text-white" : "bg-gradient-soft text-primary",
        )}
      >
        <Icon name={icon} className="text-[22px]" />
      </span>
      <span className="min-w-0">
        <span className="block font-semibold text-strong">{title}</span>
        <span className="block text-sm text-muted">{body}</span>
      </span>
    </button>
  );
}

export default function Checkout() {
  const tr = useTr();
  const router = useRouter();
  const { user } = useSession();
  const cart = useCart();

  const [payment, setPayment] = useState<OrderPaymentMethod>("COD");
  const [route, setRoute] = useState<"UPLOAD" | "DOCTOR">("UPLOAD");
  const [doctorId, setDoctorId] = useState("");
  // `null` means untouched, so the profile's values show until somebody types.
  const [nameDraft, setName] = useState<string | null>(null);
  const [phoneDraft, setPhone] = useState<string | null>(null);
  const [addressDraft, setAddress] = useState<string | null>(null);
  const [city, setCity] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cartKey = useMemo(
    () => cart.items.map((item) => `${item.productId}:${item.quantity}:${item.prescriptionId ?? ""}`).join("|"),
    [cart.items],
  );
  const quote = useAsync(
    () =>
      cart.items.length
        ? pharmacy.quote(
            cart.items.map(({ productId, quantity, prescriptionId }) => ({ productId, quantity, prescriptionId })),
          )
        : Promise.resolve(null),
    [cartKey],
    { live: false },
  );
  const info = useAsync(() => pharmacy.info(), [], { live: false });
  const doctors = useAsync(() => pharmacy.myDoctors(), [], { live: false });
  const profile = useAsync(() => patients.me(), [], { live: false });

  const name = nameDraft ?? user?.name ?? "";
  const phone = phoneDraft ?? (user?.phone || profile.data?.phone || "");
  const address = addressDraft ?? profile.data?.address ?? "";

  const settings = info.data?.settings;
  const cities = settings?.cities ?? [];
  const q = quote.data;

  // Cash on delivery stops being a choice the moment the server says so.
  const paymentMethod: OrderPaymentMethod = q && !q.codAvailable ? "ONLINE" : payment;

  const phoneOk = mobile(phone) !== null;
  const formOk =
    name.trim().length >= 2 && phoneOk && address.trim().length >= 8 && city.trim().length >= 2;
  const rxOk = !q?.needsPrescription || route === "UPLOAD" || Boolean(doctorId);
  const canPlace = Boolean(q) && q!.problems.length === 0 && formOk && rxOk && !busy;

  const place = async () => {
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      const order = await pharmacy.place({
        items: cart.items.map(({ productId, quantity, prescriptionId }) => ({ productId, quantity, prescriptionId })),
        paymentMethod,
        recipientName: name.trim(),
        phone: mobile(phone) ?? phone,
        addressLine: address.trim(),
        city: city.trim(),
        deliveryNotes: notes.trim() || undefined,
        ...(q.needsPrescription ? { rxRoute: route, rxDoctorId: route === "DOCTOR" ? doctorId : undefined } : {}),
      });
      cart.clear();
      router.push(`/patient/pharmacy/orders/${order.id}?placed=1`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : tr("Could not place the order.", "Order nahi ho saka."));
      quote.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell role="PATIENT">
      <div id="main">
        <Link
          href="/patient/pharmacy"
          className="group inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
        >
          <Icon name="arrow_back" className="text-[18px] transition-transform group-hover:-translate-x-0.5" />
          {tr("Back to the pharmacy", "Pharmacy par wapas")}
        </Link>
        <PageHeader
          eyebrow={settings?.pharmacyName ?? "MediNova Pharmacy"}
          title={tr("Checkout", "Checkout")}
          subtitle={tr("Check your order, tell us where to bring it, and choose how to pay.", "Order dekhein, pata batayein, aur payment ka tareeqa chunein.")}
        />

        {cart.items.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              icon="shopping_bag"
              title={tr("Your cart is empty", "Aap ki cart khali hai")}
              action={
                <Link href="/patient/pharmacy" className="inline-flex min-h-11 items-center rounded-xl bg-gradient-brand px-4 font-semibold text-white">
                  {tr("Browse medicines", "Dawaiyan dekhein")}
                </Link>
              }
            />
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0 space-y-6">
              <Card icon="shopping_bag" title={tr("Your order", "Aap ka order")}>
                {quote.loading && !q ? (
                  <SkeletonRows rows={3} title={false} />
                ) : quote.error ? (
                  <ErrorState message={quote.error.message} onRetry={quote.reload} />
                ) : (
                  <ul className="divide-y divide-line">
                    {(q?.lines ?? []).map((line) => (
                      <li key={line.product.id} className="flex flex-wrap items-center gap-3 py-3">
                        <span aria-hidden className="bg-gradient-soft grid h-11 w-11 shrink-0 place-items-center rounded-xl text-primary">
                          <Icon name={FORM_ICON[line.product.form]} className="text-[22px]" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-strong">{productTitle(line.product)}</p>
                          <p className="text-xs text-muted">
                            {line.product.packSize} · {rupees(line.unitPrice)} {tr("each", "fi pack")}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {line.coveredBy && (
                              <Badge tone="good">
                                <Icon name="verified" className="text-[14px]" />
                                {tr("Covered by your prescription", "Aap ke nuskhe mein shamil")}
                              </Badge>
                            )}
                            {line.needsPrescription && (
                              <Badge tone="warning">
                                <Icon name="prescriptions" className="text-[14px]" />
                                {tr("Prescription needed", "Nuskha zaroori")}
                              </Badge>
                            )}
                          </div>
                          {line.problem && (
                            <p role="alert" className="mt-1 text-sm font-medium text-critical">{line.problem}</p>
                          )}
                        </div>
                        <QuantityStepper
                          value={line.quantity}
                          onChange={(next) => cart.setQuantity(line.product.id, next)}
                          size="sm"
                          label={tr(`Quantity of ${line.product.name}`, `${line.product.name} ki tadaad`)}
                        />
                        <span className="w-24 text-right font-semibold tabular-nums text-strong">
                          {rupees(line.lineTotal)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {(q?.problems.length ?? 0) > 0 && !q?.lines.some((line) => line.problem) && (
                  <p role="alert" className="mt-3 text-sm font-medium text-critical">{q?.problems[0]}</p>
                )}
              </Card>

              {q?.needsPrescription && (
                <Card
                  icon="prescriptions"
                  title={tr("Prescription", "Nuskha")}
                  description={tr(
                    "Some of these medicines are sold only with a prescription. Nothing is charged until it is cleared.",
                    "Inmein se kuchh dawaiyan sirf nuskhe par milti hain. Tasdeeq tak kuchh charge nahi hota.",
                  )}
                >
                  <div role="radiogroup" aria-label={tr("Prescription", "Nuskha")} className="grid grid-cols-[repeat(auto-fit,minmax(min(18rem,100%),1fr))] gap-3">
                    <Choice
                      selected={route === "UPLOAD"}
                      onSelect={() => setRoute("UPLOAD")}
                      icon="photo_camera"
                      title={tr("Upload a prescription", "Nuskhe ki photo bhejein")}
                      body={tr(
                        "A clear photo from any doctor. Our pharmacist checks it, usually within the hour.",
                        "Kisi bhi doctor ka saaf photo. Hamara pharmacist aksar aik ghante mein dekh leta hai.",
                      )}
                    />
                    <Choice
                      selected={route === "DOCTOR"}
                      disabled={(doctors.data?.length ?? 0) === 0}
                      onSelect={() => setRoute("DOCTOR")}
                      icon="stethoscope"
                      title={tr("Ask my MediNova doctor", "Apne MediNova doctor se poochhein")}
                      body={
                        (doctors.data?.length ?? 0) === 0
                          ? tr("Available once you have seen a doctor on MediNova.", "MediNova par doctor se milne ke baad dastyab.")
                          : tr("A doctor who has treated you approves it from their portal.", "Aap ka ilaaj karne wala doctor apne portal se manzoor karta hai.")
                      }
                    />
                  </div>
                  {route === "DOCTOR" && (doctors.data?.length ?? 0) > 0 && (
                    <div className="mt-4">
                      <Field label={tr("Which doctor?", "Kaun sa doctor?")} htmlFor="rx-doctor">
                        <Select id="rx-doctor" value={doctorId} onChange={(event) => setDoctorId(event.target.value)}>
                          <option value="">{tr("Choose a doctor", "Doctor chunein")}</option>
                          {(doctors.data ?? []).map((doctor) => (
                            <option key={doctor.id} value={doctor.id}>
                              {doctor.name} — {doctor.specialization}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                  )}
                  {route === "UPLOAD" && (
                    <p className="mt-3 flex items-start gap-1.5 text-sm text-muted">
                      <Icon name="info" className="mt-px shrink-0 text-[16px]" />
                      {tr(
                        "You will upload the photo on the next screen, right after placing the order.",
                        "Order dene ke foran baad agli screen par photo upload karein ge.",
                      )}
                    </p>
                  )}
                </Card>
              )}

              <Card icon="home_pin" title={tr("Delivery", "Delivery")}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label={tr("Name", "Naam")} htmlFor="recipient">
                    <Input id="recipient" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} autoComplete="name" />
                  </Field>
                  <Field
                    label={tr("Mobile number", "Mobile number")}
                    htmlFor="phone"
                    hint={tr("The rider calls this number.", "Rider is number par call karega.")}
                    error={phone && !phoneOk ? tr("Enter a Pakistani mobile number, e.g. 0300 1234567.", "Pakistani mobile number likhein, maslan 0300 1234567.") : undefined}
                  >
                    <Input
                      id="phone"
                      inputMode="tel"
                      autoComplete="tel"
                      value={phone}
                      invalid={Boolean(phone) && !phoneOk}
                      onChange={(event) => setPhone(event.target.value)}
                      placeholder="0300 1234567"
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label={tr("Address", "Pata")} htmlFor="address">
                      <Textarea
                        id="address"
                        rows={2}
                        maxLength={300}
                        value={address}
                        onChange={(event) => setAddress(event.target.value)}
                        autoComplete="street-address"
                        placeholder={tr("House, street, block and area", "Ghar, gali, block aur ilaqa")}
                      />
                    </Field>
                  </div>
                  <Field label={tr("City", "Shehar")} htmlFor="city">
                    {cities.length > 0 ? (
                      <Select id="city" value={city} onChange={(event) => setCity(event.target.value)}>
                        <option value="">{tr("Choose a city", "Shehar chunein")}</option>
                        {cities.map((entry) => (
                          <option key={entry} value={entry}>
                            {entry}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Input id="city" value={city} maxLength={80} onChange={(event) => setCity(event.target.value)} autoComplete="address-level2" placeholder="Karachi" />
                    )}
                  </Field>
                  <Field label={tr("Note for the rider (optional)", "Rider ke liye note (ikhtiyari)")} htmlFor="notes">
                    <Input id="notes" value={notes} maxLength={300} onChange={(event) => setNotes(event.target.value)} placeholder={tr("e.g. near the mosque", "maslan masjid ke qareeb")} />
                  </Field>
                </div>
              </Card>

              <Card icon="payments" title={tr("Payment", "Payment")}>
                <div role="radiogroup" aria-label={tr("Payment", "Payment")} className="grid grid-cols-[repeat(auto-fit,minmax(min(18rem,100%),1fr))] gap-3">
                  <Choice
                    selected={paymentMethod === "COD"}
                    disabled={Boolean(q && !q.codAvailable)}
                    onSelect={() => setPayment("COD")}
                    icon="local_atm"
                    title={tr("Cash on delivery", "Cash on delivery")}
                    body={q?.codRefusal ?? tr("Pay the rider when it arrives.", "Pahunchne par rider ko ada karein.")}
                  />
                  <Choice
                    selected={paymentMethod === "ONLINE"}
                    onSelect={() => setPayment("ONLINE")}
                    icon="account_balance_wallet"
                    title={tr("EasyPaisa or NayaPay", "EasyPaisa ya NayaPay")}
                    body={tr(
                      `Transfer and upload the screenshot. Your order is held for ${settings?.paymentWindowHours ?? 48} hours.`,
                      `Transfer kar ke screenshot bhejein. Order ${settings?.paymentWindowHours ?? 48} ghante ke liye mehfooz rehta hai.`,
                    )}
                  />
                </div>
              </Card>
            </div>

            <aside className="lg:sticky lg:top-24 lg:self-start">
              <Card icon="receipt" title={tr("Summary", "Khulasa")}>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted">{tr("Medicines", "Dawaiyan")}</dt>
                    <dd className="font-semibold tabular-nums text-strong">{q ? rupees(q.subtotal) : "—"}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">{tr("Delivery", "Delivery")}</dt>
                    <dd className="font-semibold tabular-nums text-strong">
                      {q ? (Number(q.deliveryFee) === 0 ? tr("Free", "Muft") : rupees(q.deliveryFee)) : "—"}
                    </dd>
                  </div>
                  {q && q.freeDeliveryAbove && Number(q.deliveryFee) > 0 && (
                    <p className="text-xs text-muted">
                      {tr(
                        `Add ${rupees(Number(q.freeDeliveryAbove) - Number(q.subtotal))} more for free delivery.`,
                        `Muft delivery ke liye ${rupees(Number(q.freeDeliveryAbove) - Number(q.subtotal))} aur shamil karein.`,
                      )}
                    </p>
                  )}
                  <div className="flex justify-between border-t border-line pt-3 text-base">
                    <dt className="font-semibold text-strong">{tr("Total", "Kul")}</dt>
                    <dd className="font-display text-xl font-bold tabular-nums text-strong">{q ? rupees(q.total) : "—"}</dd>
                  </div>
                </dl>

                {error && (
                  <p role="alert" className="mt-4 rounded-xl border border-critical/40 bg-critical-soft px-3 py-2 text-sm font-medium text-critical">
                    {error}
                  </p>
                )}

                <Button size="lg" className="mt-5 w-full" disabled={!canPlace} loading={busy} onClick={() => void place()}>
                  <Icon name="lock" className="text-[20px]" />
                  {busy ? tr("Placing…", "Order ho raha hai…") : tr("Place order", "Order dein")}
                </Button>
                {!formOk && (
                  <p className="mt-2 text-center text-xs text-muted">
                    {tr("Fill in the delivery details to continue.", "Aage barhne ke liye delivery ki tafseel likhein.")}
                  </p>
                )}
                <p className="mt-4 flex items-start gap-1.5 text-xs text-muted">
                  <Icon name="verified_user" className="mt-px shrink-0 text-[14px]" />
                  {tr(
                    "Prices are confirmed by the pharmacy when you place the order. You can cancel until it is dispatched.",
                    "Qeemat order dene par pharmacy confirm karti hai. Rawana hone tak cancel kar sakte hain.",
                  )}
                </p>
              </Card>
            </aside>
          </div>
        )}
      </div>
    </AppShell>
  );
}
