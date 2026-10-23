"use client";

/**
 * How the pharmacy delivers, and who it says it is on every invoice.
 *
 * Every change is audited with its before and after. The licence number is
 * printed on pharmacy invoices, so until it is entered here the pharmacy
 * should not be selling to the public.
 */

import { useState, type ReactNode } from "react";

import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { ConsoleCard, ConsoleHeader } from "@/components/admin/console";
import { useToast } from "@/components/overlays";
import { PharmacyAdminTabs } from "@/components/pharmacy/AdminTabs";
import { Button, ErrorState, Field, Input, SkeletonRows, Textarea, cx } from "@/components/ui";
import { ApiError, pharmacy, type PharmacySettings } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { useAsync } from "@/lib/useAsync";

export default function PharmacySettingsPage() {
  const tr = useTr();
  const settings = useAsync(() => pharmacy.settings(), [], { live: false });
  // For the count on the Orders tab; the page does without it.
  const summary = useAsync(() => pharmacy.dashboard().catch(() => null), []);

  return (
    <AppShell role="ADMIN">
      <div id="main">
        <ConsoleHeader mark="settings" eyebrow={tr("Pharmacy", "Pharmacy")} title={tr("Pharmacy settings", "Pharmacy settings")}>
          <p>
            {tr(
              "Delivery, cash on delivery, and the pharmacy's licence. Every change is written to the audit trail with its before and after.",
              "Delivery, cash on delivery, aur pharmacy ka licence. Har tabdeeli pehle aur baad ke saath audit trail mein likhi jati hai.",
            )}
          </p>
        </ConsoleHeader>
        <div className="mt-[22px]">
          <PharmacyAdminTabs openOrders={summary.data?.openOrders} />
        </div>
        <div className="mt-[22px]">
          {settings.loading && !settings.data ? (
            <SkeletonRows rows={4} />
          ) : settings.error ? (
            <ErrorState message={settings.error.message} onRetry={settings.reload} />
          ) : settings.data ? (
            <SettingsForm initial={settings.data} />
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}

/** "3000.00" from the API as the field shows it: "3000". */
function plain(amount: string | null | undefined): string {
  return (amount ?? "").replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

/** A money field: "PKR" set inside it, before the figure, grouped as it is read — "2,500". */
function Money({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const [whole, fraction] = value.split(".");
  const shown = `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction !== undefined ? `.${fraction}` : ""}`;
  return (
    <>
      <span aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 z-10 -translate-y-1/2 text-[13px] font-semibold text-muted">
        PKR
      </span>
      <Input
        id={id}
        inputMode="decimal"
        value={shown}
        onChange={(event) => onChange(event.target.value.replace(/[^\d.]/g, ""))}
        className="!pl-[50px]"
      />
    </>
  );
}

function Section({ icon, title, subtitle, children }: { icon: string; title: string; subtitle: string; children: ReactNode }) {
  return (
    <ConsoleCard icon={icon} title={title} subtitle={subtitle} className="rise-in">
      <div className="flex flex-col gap-4 px-[22px] pt-1 pb-[22px]">{children}</div>
    </ConsoleCard>
  );
}

function SettingsForm({ initial }: { initial: PharmacySettings }) {
  const tr = useTr();
  const toast = useToast();
  const [saved, setSaved] = useState(initial);
  const [name, setName] = useState(initial.pharmacyName);
  const [license, setLicense] = useState(initial.licenseNumber ?? "");
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [address, setAddress] = useState(initial.address ?? "");
  const [fee, setFee] = useState(plain(initial.deliveryFee));
  const [freeAbove, setFreeAbove] = useState(plain(initial.freeDeliveryAbove));
  const [cod, setCod] = useState(initial.codEnabled);
  const [codMax, setCodMax] = useState(plain(initial.codMaxAmount));
  const [cities, setCities] = useState<string[]>(initial.cities);
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = (from: PharmacySettings) => {
    setName(from.pharmacyName);
    setLicense(from.licenseNumber ?? "");
    setPhone(from.phone ?? "");
    setAddress(from.address ?? "");
    setFee(plain(from.deliveryFee));
    setFreeAbove(plain(from.freeDeliveryAbove));
    setCod(from.codEnabled);
    setCodMax(plain(from.codMaxAmount));
    setCities(from.cities);
    setCity("");
  };

  // What differs from what is saved, counted field by field, for the bar.
  const changes = [
    name.trim() !== saved.pharmacyName,
    license.trim() !== (saved.licenseNumber ?? ""),
    phone.trim() !== (saved.phone ?? ""),
    address.trim() !== (saved.address ?? ""),
    Number(fee || 0) !== Number(saved.deliveryFee || 0),
    (freeAbove ? Number(freeAbove) : null) !== (saved.freeDeliveryAbove ? Number(saved.freeDeliveryAbove) : null),
    cod !== saved.codEnabled,
    (codMax ? Number(codMax) : null) !== (saved.codMaxAmount ? Number(saved.codMaxAmount) : null),
    cities.join("|") !== saved.cities.join("|"),
  ].filter(Boolean).length;

  const addCity = (value: string = city) => {
    const next = value.trim();
    if (next.length >= 2 && !cities.some((existing) => existing.toLowerCase() === next.toLowerCase())) {
      setCities([...cities, next]);
    }
    setCity("");
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await pharmacy.updateSettings({
        pharmacyName: name.trim(),
        licenseNumber: license.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        deliveryFee: fee || "0",
        freeDeliveryAbove: freeAbove ? freeAbove : null,
        codEnabled: cod,
        codMaxAmount: codMax ? codMax : null,
        cities,
      });
      setSaved(updated);
      reset(updated);
      toast.show({ tone: "success", title: tr("Pharmacy settings saved", "Pharmacy settings mehfooz") });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : tr("Could not save.", "Mehfooz nahi ho saka."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-[22px]">
      {!saved.licenseNumber && (
        <div role="status" className="rise-in flex items-center gap-3.5 rounded-[18px] bg-warning-soft px-[18px] py-3.5 text-sm text-strong">
          <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-card text-warning">
            <Icon name="warning" className="text-[19px]" />
          </span>
          <span>
            <b className="font-semibold">{tr("No drug sale licence number yet.", "Abhi drug sale licence number nahi.")}</b>{" "}
            {tr(
              "It is printed on every pharmacy invoice, so add it before the pharmacy sells to the public.",
              "Yeh har pharmacy invoice par chhapta hai, is liye public ko bechne se pehle shamil karein.",
            )}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-[22px] lg:grid-cols-2">
        <Section icon="storefront" title={tr("The pharmacy", "Pharmacy")} subtitle={tr("Printed on every pharmacy invoice", "Har pharmacy invoice par chhapta hai")}>
          <Field label={tr("Name", "Naam")} htmlFor="ph-name">
            <Input id="ph-name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field
            label={tr("Drug sale licence number", "Drug sale licence number")}
            htmlFor="ph-license"
            hint={tr("Issued by the provincial health department.", "Soobai mehkama-e-sehat ka jaari karda.")}
          >
            <Input
              id="ph-license"
              value={license}
              maxLength={80}
              placeholder={tr("e.g. 05-352-0091-123456P", "maslan 05-352-0091-123456P")}
              onChange={(event) => setLicense(event.target.value)}
            />
          </Field>
          <Field label={tr("Phone", "Phone")} htmlFor="ph-phone">
            <Input id="ph-phone" inputMode="tel" value={phone} maxLength={40} onChange={(event) => setPhone(event.target.value)} />
          </Field>
          <Field label={tr("Address", "Pata")} htmlFor="ph-address">
            <Textarea id="ph-address" rows={2} maxLength={300} value={address} onChange={(event) => setAddress(event.target.value)} />
          </Field>
        </Section>

        <Section
          icon="local_shipping"
          title={tr("Delivery and payment", "Delivery aur payment")}
          subtitle={tr("What a patient pays to have it brought", "Mareez ghar mangwane ka kya deta hai")}
        >
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label={tr("Delivery fee", "Delivery fees")} htmlFor="ph-fee">
              <Money id="ph-fee" value={fee} onChange={setFee} />
            </Field>
            <Field label={tr("Free delivery from", "Muft delivery")} htmlFor="ph-free" hint={tr("Empty: never free.", "Khali: kabhi muft nahi.")}>
              <Money id="ph-free" value={freeAbove} onChange={setFreeAbove} />
            </Field>
          </div>

          <div className="flex items-start gap-3.5 rounded-2xl border border-line bg-[var(--console-soft)] px-4 py-3.5">
            <span className="flex flex-1 flex-col gap-0.5">
              <span id="ph-cod-label" className="text-[14px] font-semibold text-strong">
                {tr("Cash on delivery", "Cash on delivery")}
              </span>
              <span className="text-[12.5px] text-muted">{tr("Patients pay the rider at the door.", "Mareez darwaze par rider ko ada karte hain.")}</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={cod}
              aria-labelledby="ph-cod-label"
              onClick={() => setCod(!cod)}
              className={cx(
                "relative h-7 w-[46px] shrink-0 rounded-full transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                cod ? "bg-[#0B3FA8] dark:bg-[#3B6FE0]" : "bg-line-strong",
              )}
            >
              <span
                aria-hidden
                className={cx(
                  "absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-[left]",
                  cod ? "left-[21px]" : "left-[3px]",
                )}
              />
            </button>
          </div>
          {cod && (
            <Field
              label={tr("Largest cash order", "Sab se bara cash order")}
              htmlFor="ph-codmax"
              hint={tr("Above this, the patient pays online. Empty: no limit.", "Is se upar mareez online ada kare. Khali: koi had nahi.")}
            >
              <Money id="ph-codmax" value={codMax} onChange={setCodMax} />
            </Field>
          )}

          <div className="flex flex-col gap-[7px]">
            <label htmlFor="ph-city" className="text-[13px] font-semibold text-muted">
              {tr("Cities delivered to", "Jin sheharon mein delivery")}
            </label>
            <div className="flex min-h-11 flex-wrap gap-1.5 rounded-xl border border-line-strong bg-card p-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary">
              {cities.map((name) => (
                <span key={name} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-info-soft px-[9px] text-[12px] font-semibold text-info">
                  {name}
                  <button
                    type="button"
                    aria-label={tr(`Remove ${name}`, `${name} hatayein`)}
                    onClick={() => setCities(cities.filter((existing) => existing !== name))}
                    className="grid h-4 w-4 place-items-center rounded-full hover:bg-card/70 focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <Icon name="close" className="text-[12px]" />
                  </button>
                </span>
              ))}
              <input
                id="ph-city"
                value={city}
                maxLength={60}
                placeholder={tr("Add a city, then Enter", "Shehar likh kar Enter")}
                onChange={(event) => {
                  // A comma ends a city, the way Enter does.
                  if (event.target.value.endsWith(",")) addCity(event.target.value.slice(0, -1));
                  else setCity(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addCity();
                  } else if (event.key === "Backspace" && !city && cities.length) {
                    setCities(cities.slice(0, -1));
                  }
                }}
                onBlur={() => city.trim() && addCity()}
                className="min-w-[140px] flex-1 bg-transparent px-1 text-[13.5px] text-strong outline-none placeholder:text-muted"
              />
            </div>
            <span className="text-[12.5px] text-muted">{tr("None: delivers everywhere.", "Koi nahi: har jaga delivery.")}</span>
          </div>
        </Section>
      </div>

      {/* Held at the foot of the screen while there is something to save. */}
      <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-3 rounded-full border border-line bg-card py-3 pr-3.5 pl-5 shadow-card">
        <span className="inline-flex items-center gap-2 text-[13.5px] text-muted" aria-live="polite">
          <span aria-hidden className={cx("h-2 w-2 rounded-full", changes ? "bg-[#F59E0B]" : "bg-stable")} />
          {changes
            ? tr(`${changes} unsaved ${changes === 1 ? "change" : "changes"}`, `${changes} tabdeeliyan mehfooz nahi`)
            : tr("Everything is saved", "Sab mehfooz hai")}
        </span>
        {error && (
          <p role="alert" className="text-sm font-medium text-critical">
            {error}
          </p>
        )}
        <span className="ml-auto flex gap-2">
          <Button variant="ghost" disabled={!changes || busy} onClick={() => reset(saved)}>
            {tr("Discard", "Chhor dein")}
          </Button>
          <Button loading={busy} disabled={!changes || name.trim().length < 2} onClick={() => void save()}>
            {tr("Save settings", "Settings mehfooz karein")}
          </Button>
        </span>
      </div>
    </div>
  );
}
