"use client";

/**
 * How the pharmacy delivers, and who it says it is on every invoice.
 *
 * Every change is audited with its before and after. The licence number is
 * printed on pharmacy invoices, so until it is entered here the pharmacy
 * should not be selling to the public.
 */

import { useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/components/overlays";
import { PharmacyAdminTabs } from "@/components/pharmacy/AdminTabs";
import { Switch } from "@/components/forms";
import { Badge, Button, Card, ErrorState, Field, Input, SkeletonRows, Textarea } from "@/components/ui";
import { ApiError, pharmacy, type PharmacySettings } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { useAsync } from "@/lib/useAsync";

export default function PharmacySettingsPage() {
  const tr = useTr();
  const settings = useAsync(() => pharmacy.settings(), [], { live: false });

  return (
    <AppShell role="ADMIN">
      <div id="main" className="page-enter">
        <PageHeader
          eyebrow={tr("Pharmacy", "Pharmacy")}
          title={tr("Settings", "Settings")}
          subtitle={tr("Delivery, cash on delivery, and the pharmacy's licence.", "Delivery, cash on delivery, aur pharmacy ka licence.")}
        />
        <div className="mt-6">
          <PharmacyAdminTabs />
        </div>
        <div className="mt-6">
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

function SettingsForm({ initial }: { initial: PharmacySettings }) {
  const tr = useTr();
  const toast = useToast();
  const [saved, setSaved] = useState(initial);
  const [name, setName] = useState(initial.pharmacyName);
  const [license, setLicense] = useState(initial.licenseNumber ?? "");
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [address, setAddress] = useState(initial.address ?? "");
  const [fee, setFee] = useState(initial.deliveryFee);
  const [freeAbove, setFreeAbove] = useState(initial.freeDeliveryAbove ?? "");
  const [cod, setCod] = useState(initial.codEnabled);
  const [codMax, setCodMax] = useState(initial.codMaxAmount ?? "");
  const [cities, setCities] = useState(initial.cities.join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const money = (value: string) => value.replace(/[^\d.]/g, "");

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
        cities: cities
          .split(",")
          .map((city) => city.trim())
          .filter((city) => city.length >= 2),
      });
      setSaved(updated);
      toast.show({ tone: "success", title: tr("Pharmacy settings saved", "Pharmacy settings mehfooz") });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : tr("Could not save.", "Mehfooz nahi ho saka."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card
        icon="storefront"
        title={tr("The pharmacy", "Pharmacy")}
        description={tr("Printed on every pharmacy invoice.", "Har pharmacy invoice par chhapta hai.")}
        action={!saved.licenseNumber && <Badge tone="warning">{tr("Licence missing", "Licence nahi")}</Badge>}
      >
        <div className="space-y-4">
          <Field label={tr("Name", "Naam")} htmlFor="ph-name">
            <Input id="ph-name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field
            label={tr("Drug sale licence number", "Drug sale licence number")}
            htmlFor="ph-license"
            hint={tr("Issued by the provincial health department.", "Soobai mehkama-e-sehat ka jaari karda.")}
          >
            <Input id="ph-license" value={license} maxLength={80} onChange={(event) => setLicense(event.target.value)} />
          </Field>
          <Field label={tr("Phone", "Phone")} htmlFor="ph-phone">
            <Input id="ph-phone" inputMode="tel" value={phone} maxLength={40} onChange={(event) => setPhone(event.target.value)} />
          </Field>
          <Field label={tr("Address", "Pata")} htmlFor="ph-address">
            <Textarea id="ph-address" rows={2} maxLength={300} value={address} onChange={(event) => setAddress(event.target.value)} />
          </Field>
        </div>
      </Card>

      <Card icon="local_shipping" title={tr("Delivery and payment", "Delivery aur payment")}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={tr("Delivery fee (PKR)", "Delivery fees (PKR)")} htmlFor="ph-fee">
              <Input id="ph-fee" inputMode="decimal" value={fee} onChange={(event) => setFee(money(event.target.value))} />
            </Field>
            <Field
              label={tr("Free delivery from (PKR)", "Muft delivery (PKR) se")}
              htmlFor="ph-free"
              hint={tr("Empty: never free.", "Khali: kabhi muft nahi.")}
            >
              <Input id="ph-free" inputMode="decimal" value={freeAbove} onChange={(event) => setFreeAbove(money(event.target.value))} />
            </Field>
          </div>
          <Switch
            checked={cod}
            onChange={setCod}
            label={tr("Cash on delivery", "Cash on delivery")}
            description={tr("Patients pay the rider at the door.", "Mareez darwaze par rider ko ada karte hain.")}
          />
          {cod && (
            <Field
              label={tr("Largest cash order (PKR)", "Sab se bara cash order (PKR)")}
              htmlFor="ph-codmax"
              hint={tr("Above this, the patient pays online. Empty: no limit.", "Is se upar mareez online ada kare. Khali: koi had nahi.")}
            >
              <Input id="ph-codmax" inputMode="decimal" value={codMax} onChange={(event) => setCodMax(money(event.target.value))} />
            </Field>
          )}
          <Field
            label={tr("Cities delivered to", "Jin sheharon mein delivery")}
            htmlFor="ph-cities"
            hint={tr("Separated by commas. Empty: everywhere.", "Comma se alag. Khali: har jaga.")}
          >
            <Input id="ph-cities" value={cities} onChange={(event) => setCities(event.target.value)} placeholder="Karachi, Lahore, Islamabad" />
          </Field>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3 lg:col-span-2">
        {error && <p role="alert" className="text-sm font-medium text-critical">{error}</p>}
        <Button size="lg" loading={busy} disabled={name.trim().length < 2} onClick={() => void save()}>
          <Icon name="save" className="text-[20px]" />
          {tr("Save settings", "Settings mehfooz karein")}
        </Button>
      </div>
    </div>
  );
}
