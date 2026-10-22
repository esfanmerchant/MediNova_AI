"use client";

/**
 * The shelf: what the pharmacy sells, at what price, and how much is left.
 *
 * Stock is changed by adding or writing off, never by typing a new count —
 * an order placed while this screen was open would otherwise be silently
 * undone. Every change carries a reason, which goes to the audit trail.
 *
 * Starter-catalog prices are estimates, and the screen says so beside each one
 * until somebody saves a checked price.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { Dialog, useToast } from "@/components/overlays";
import { PharmacyAdminTabs } from "@/components/pharmacy/AdminTabs";
import { FORM_ICON, FORM_LABEL, productTitle, rupees } from "@/components/pharmacy/shared";
import { Switch } from "@/components/forms";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Loading,
  Select,
  SkeletonRows,
  Textarea,
  cx,
} from "@/components/ui";
import { ApiError, PRODUCT_FORMS, pharmacy, type Product, type ProductForm, type ProductInput } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { useAsync } from "@/lib/useAsync";

const CSV_TEMPLATE =
  "name,genericName,strength,form,packSize,category,manufacturer,price,costPrice,stock,rxRequired\n" +
  "Panadol,Paracetamol,500 mg,TABLET,Strip of 10 tablets,Pain & Fever,Haleon,40,30,200,no\n" +
  "Amoxil,Amoxicillin,500 mg,CAPSULE,Pack of 20 capsules,Antibiotics & Infections,GSK,340,260,50,yes\n";

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "medinova-catalog-template.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function Catalog() {
  const tr = useTr();
  const toast = useToast();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [stocking, setStocking] = useState<Product | null>(null);
  const [importing, setImporting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [loadingStarter, setLoadingStarter] = useState(false);

  const lowStock = params.get("lowStock") === "1";
  const unreviewed = params.get("unreviewed") === "1";
  const includeInactive = params.get("inactive") === "1";

  const setFlag = (name: string, on: boolean) => {
    const next = new URLSearchParams(params.toString());
    if (on) next.set(name, "1");
    else next.delete(name);
    router.replace(`${pathname}?${next.toString()}`);
  };

  const list = useAsync(
    () =>
      pharmacy.products({
        search: search.trim() || undefined,
        includeInactive,
        lowStock,
        unreviewedPrice: unreviewed,
        limit: 100,
      }),
    [search, includeInactive, lowStock, unreviewed, refresh],
    { live: false },
  );
  const rows = list.data?.data ?? [];
  const reload = () => setRefresh((n) => n + 1);

  const loadStarter = async () => {
    setLoadingStarter(true);
    try {
      const result = await pharmacy.loadStarterCatalog();
      toast.show({
        title: result.created
          ? tr(`${result.created} medicines added`, `${result.created} dawaiyan shamil`)
          : tr("Nothing new to add", "Shamil karne ko kuchh naya nahi"),
        body: tr("Existing products were left as they were.", "Maujooda products waise hi rahe."),
      });
      reload();
    } catch (caught) {
      toast.show({ tone: "critical", title: caught instanceof ApiError ? caught.message : "Could not load the catalog." });
    } finally {
      setLoadingStarter(false);
    }
  };

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setEditing("new")}>
          <Icon name="add" className="text-[20px]" />
          {tr("Add medicine", "Dawa shamil karein")}
        </Button>
        <Button variant="secondary" onClick={() => setImporting(true)}>
          <Icon name="upload_file" className="text-[20px]" />
          {tr("Import CSV", "CSV import")}
        </Button>
        <Button variant="ghost" loading={loadingStarter} onClick={() => void loadStarter()}>
          <Icon name="auto_awesome" className="text-[20px]" />
          {tr("Load starter catalog", "Starter catalog load karein")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-[14rem] flex-1">
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tr("Search by brand, generic or maker", "Brand, generic ya company se dhoondein")}
            aria-label={tr("Search the catalog", "Catalog dhoondein")}
          />
        </div>
        <Checkbox label={tr("Running low", "Kam stock")} checked={lowStock} onChange={() => setFlag("lowStock", !lowStock)} />
        <Checkbox label={tr("Price not checked", "Qeemat check nahi")} checked={unreviewed} onChange={() => setFlag("unreviewed", !unreviewed)} />
        <Checkbox label={tr("Show hidden", "Chhupe dikhayein")} checked={includeInactive} onChange={() => setFlag("inactive", !includeInactive)} />
      </div>

      {list.loading && !list.data ? (
        <SkeletonRows rows={6} />
      ) : list.error ? (
        <ErrorState message={list.error.message} onRetry={list.reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="inventory_2"
          title={tr("No medicines here", "Yahan koi dawa nahi")}
          description={tr(
            "Load the starter catalog of common Pakistani medicines, import your own CSV, or add one by hand.",
            "Aam Pakistani dawaon ka starter catalog load karein, apni CSV import karein, ya khud shamil karein.",
          )}
        />
      ) : (
        <Card flush>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-wider text-faint">
                  <th className="px-5 py-3">{tr("Medicine", "Dawa")}</th>
                  <th className="px-3 py-3">{tr("Category", "Category")}</th>
                  <th className="px-3 py-3 text-right">{tr("Price", "Qeemat")}</th>
                  <th className="px-3 py-3 text-right">{tr("Stock", "Stock")}</th>
                  <th className="px-5 py-3 text-right">{tr("Actions", "Amal")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((product) => {
                  const low = (product.stock ?? 0) <= (product.lowStockThreshold ?? 0);
                  return (
                    <tr key={product.id} className={cx(!product.active && "opacity-60")}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <Icon name={FORM_ICON[product.form]} className="shrink-0 text-[20px] text-primary" />
                          <div className="min-w-0">
                            <p className="font-semibold text-strong">{productTitle(product)}</p>
                            <p className="text-xs text-muted">
                              {product.genericName} · {product.packSize}
                            </p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {product.rxRequired && <Badge tone="warning">Rx</Badge>}
                              {!product.active && <Badge tone="neutral">{tr("Hidden", "Chhupa")}</Badge>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-muted">{product.category}</td>
                      <td className="px-3 py-3 text-right">
                        <span className="font-semibold tabular-nums text-strong">{rupees(product.price)}</span>
                        {product.priceReviewed === false && (
                          <span className="block text-[11px] font-semibold text-warning">{tr("Estimate", "Andaza")}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className={cx("font-semibold tabular-nums", low ? "text-warning" : "text-strong")}>
                          {product.stock}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" onClick={() => setStocking(product)}>
                            <Icon name="inventory" className="text-[18px]" />
                            {tr("Stock", "Stock")}
                          </Button>
                          <Button variant="ghost" onClick={() => setEditing(product)}>
                            <Icon name="edit" className="text-[18px]" />
                            {tr("Edit", "Edit")}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {editing && (
        <ProductDialog
          key={editing === "new" ? "new" : editing.id}
          product={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {stocking && (
        <StockDialog
          key={stocking.id}
          product={stocking}
          onClose={() => setStocking(null)}
          onSaved={() => {
            setStocking(null);
            reload();
          }}
        />
      )}
      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onImported={() => reload()}
        />
      )}
    </div>
  );
}

function ProductDialog({
  product,
  onClose,
  onSaved,
}: {
  product: Product | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tr = useTr();
  const [form, setForm] = useState<ProductInput>(() => ({
    name: product?.name ?? "",
    genericName: product?.genericName ?? "",
    strength: product?.strength ?? "",
    form: product?.form ?? "TABLET",
    packSize: product?.packSize ?? "",
    category: product?.category ?? "",
    manufacturer: product?.manufacturer ?? "",
    description: product?.description ?? "",
    price: product?.price ?? "",
    costPrice: product?.costPrice ?? "",
    lowStockThreshold: product?.lowStockThreshold ?? 10,
    rxRequired: product?.rxRequired ?? false,
    active: product?.active ?? true,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ProductInput>(key: K, value: ProductInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const valid =
    form.name.trim().length >= 2 &&
    form.genericName.trim().length >= 2 &&
    form.packSize.trim() &&
    form.category.trim().length >= 2 &&
    Number(form.price) > 0;

  const save = async () => {
    setBusy(true);
    setError(null);
    const payload: ProductInput = {
      ...form,
      strength: form.strength?.trim() || null,
      manufacturer: form.manufacturer?.trim() || null,
      description: form.description?.trim() || null,
      costPrice: form.costPrice ? String(form.costPrice) : null,
      price: String(form.price),
    };
    try {
      if (product) await pharmacy.updateProduct(product.id, payload);
      else await pharmacy.createProduct(payload);
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : tr("Could not save.", "Mehfooz nahi ho saka."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      icon="medication"
      title={product ? tr("Edit medicine", "Dawa edit karein") : tr("Add a medicine", "Dawa shamil karein")}
      description={
        product
          ? tr("Saving the price marks it as checked.", "Qeemat save karna use checked kar deta hai.")
          : tr("It starts with no stock — add stock once it is on the shelf.", "Stock zero se shuru — shelf par aane ke baad stock shamil karein.")
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{tr("Cancel", "Cancel")}</Button>
          <Button disabled={!valid} loading={busy} onClick={() => void save()}>{tr("Save", "Save")}</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={tr("Brand name", "Brand ka naam")} htmlFor="p-name">
          <Input id="p-name" value={form.name} maxLength={120} onChange={(event) => set("name", event.target.value)} placeholder="Panadol" />
        </Field>
        <Field label={tr("Generic name", "Generic naam")} htmlFor="p-generic">
          <Input id="p-generic" value={form.genericName} maxLength={200} onChange={(event) => set("genericName", event.target.value)} placeholder="Paracetamol" />
        </Field>
        <Field label={tr("Strength", "Taqat")} htmlFor="p-strength">
          <Input id="p-strength" value={form.strength ?? ""} maxLength={60} onChange={(event) => set("strength", event.target.value)} placeholder="500 mg" />
        </Field>
        <Field label={tr("Form", "Shakal")} htmlFor="p-form">
          <Select id="p-form" value={form.form} onChange={(event) => set("form", event.target.value as ProductForm)}>
            {PRODUCT_FORMS.map((value) => (
              <option key={value} value={value}>{tr(...FORM_LABEL[value])}</option>
            ))}
          </Select>
        </Field>
        <Field label={tr("Pack", "Pack")} htmlFor="p-pack">
          <Input id="p-pack" value={form.packSize} maxLength={80} onChange={(event) => set("packSize", event.target.value)} placeholder="Strip of 10 tablets" />
        </Field>
        <Field label={tr("Category", "Category")} htmlFor="p-category">
          <Input id="p-category" value={form.category} maxLength={60} onChange={(event) => set("category", event.target.value)} placeholder="Pain & Fever" />
        </Field>
        <Field label={tr("Price per pack (PKR)", "Fi pack qeemat (PKR)")} htmlFor="p-price" hint={tr("Not above the DRAP maximum retail price on the pack.", "Pack par DRAP MRP se zyada nahi.")}>
          <Input id="p-price" inputMode="decimal" value={form.price} onChange={(event) => set("price", event.target.value.replace(/[^\d.]/g, ""))} />
        </Field>
        <Field label={tr("Cost price (optional)", "Khareed qeemat (ikhtiyari)")} htmlFor="p-cost" hint={tr("Only you see this. It is how margin is worked out.", "Yeh sirf aap dekhte hain. Is se munafa nikalta hai.")}>
          <Input id="p-cost" inputMode="decimal" value={form.costPrice ?? ""} onChange={(event) => set("costPrice", event.target.value.replace(/[^\d.]/g, ""))} />
        </Field>
        <Field label={tr("Manufacturer (optional)", "Company (ikhtiyari)")} htmlFor="p-maker">
          <Input id="p-maker" value={form.manufacturer ?? ""} maxLength={120} onChange={(event) => set("manufacturer", event.target.value)} />
        </Field>
        <Field label={tr("Reorder below", "Is se kam par reorder")} htmlFor="p-threshold">
          <Input id="p-threshold" inputMode="numeric" value={String(form.lowStockThreshold ?? 10)} onChange={(event) => set("lowStockThreshold", Number(event.target.value.replace(/\D/g, "") || 0))} />
        </Field>
        <div className="sm:col-span-2">
          <Field label={tr("Short description (optional)", "Mukhtasar tafseel (ikhtiyari)")} htmlFor="p-description">
            <Textarea id="p-description" rows={2} maxLength={500} value={form.description ?? ""} onChange={(event) => set("description", event.target.value)} />
          </Field>
        </div>
        <div className="space-y-3 sm:col-span-2">
          <Switch
            checked={form.rxRequired}
            onChange={(next) => set("rxRequired", next)}
            label={tr("Prescription required", "Nuskha zaroori")}
            description={tr("Sold only against a prescription the pharmacy or a doctor has cleared.", "Sirf us nuskhe par jo pharmacy ya doctor ne manzoor kiya ho.")}
          />
          <Switch
            checked={form.active ?? true}
            onChange={(next) => set("active", next)}
            label={tr("On sale", "Farokht ke liye")}
            description={tr("Hidden medicines stay in old orders but cannot be bought.", "Chhupi dawaiyan purane orders mein rehti hain magar khareedi nahi ja saktin.")}
          />
        </div>
      </div>
      {error && <p role="alert" className="mt-4 text-sm font-medium text-critical">{error}</p>}
    </Dialog>
  );
}

function StockDialog({ product, onClose, onSaved }: { product: Product; onClose: () => void; onSaved: () => void }) {
  const tr = useTr();
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const units = Number(amount || 0);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await pharmacy.adjustStock(product.id, direction === "in" ? units : -units, reason.trim());
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : tr("Could not change the stock.", "Stock badal nahi saka."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      icon="inventory"
      title={productTitle(product)}
      description={tr(`${product.stock} on the shelf now.`, `Is waqt shelf par ${product.stock}.`)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{tr("Cancel", "Cancel")}</Button>
          <Button disabled={units <= 0 || reason.trim().length < 2} loading={busy} onClick={() => void save()}>
            {direction === "in" ? tr(`Add ${units || ""}`, `${units || ""} shamil karein`) : tr(`Remove ${units || ""}`, `${units || ""} nikalein`)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div role="radiogroup" className="grid grid-cols-2 gap-2">
          {(["in", "out"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={direction === value}
              onClick={() => setDirection(value)}
              className={cx(
                "min-h-11 rounded-xl border px-3 text-sm font-semibold",
                direction === value ? "border-primary bg-gradient-soft text-primary" : "border-line bg-card text-muted",
              )}
            >
              {value === "in" ? tr("Delivery received", "Maal aaya") : tr("Write off", "Khatam / kharab")}
            </button>
          ))}
        </div>
        <Field label={tr("How many packs?", "Kitne pack?")} htmlFor="stock-amount">
          <Input id="stock-amount" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label={tr("Reason", "Wajah")} htmlFor="stock-reason">
          <Input
            id="stock-reason"
            value={reason}
            maxLength={200}
            onChange={(event) => setReason(event.target.value)}
            placeholder={direction === "in" ? tr("e.g. Supplier invoice 4521", "maslan Supplier invoice 4521") : tr("e.g. Expired", "maslan Expire ho gayi")}
          />
        </Field>
        {error && <p role="alert" className="text-sm font-medium text-critical">{error}</p>}
      </div>
    </Dialog>
  );
}

function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const tr = useTr();
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; errors: Array<{ line: number; error: string }> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await pharmacy.importCatalog(file);
      setResult(outcome);
      onImported();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : tr("Could not read that file.", "File parhi nahi ja saki."));
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = "";
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      icon="upload_file"
      title={tr("Import from a spreadsheet", "Spreadsheet se import")}
      description={tr(
        "A row naming a medicine that exists updates it; a stock column adds to the shelf. Bad rows are listed and skipped.",
        "Maujood dawa ki row use update karti hai; stock column shelf mein izafa karta hai. Ghalat rows dikhayi aur chhor di jati hain.",
      )}
      footer={<Button variant="ghost" onClick={onClose}>{tr("Done", "Mukammal")}</Button>}
    >
      <div className="space-y-4">
        <input
          ref={picker}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button loading={busy} onClick={() => picker.current?.click()}>
            <Icon name="upload" className="text-[20px]" />
            {tr("Choose a CSV file", "CSV file chunein")}
          </Button>
          <Button variant="secondary" onClick={downloadTemplate}>
            <Icon name="download" className="text-[20px]" />
            {tr("Download template", "Template download")}
          </Button>
        </div>
        {error && <p role="alert" className="text-sm font-medium text-critical">{error}</p>}
        {result && (
          <div className="rounded-xl border border-line bg-sunken p-4 text-sm">
            <p className="font-semibold text-strong">
              {tr(`${result.created} added, ${result.updated} updated.`, `${result.created} shamil, ${result.updated} update.`)}
            </p>
            {result.errors.length > 0 && (
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-critical">
                {result.errors.map((row) => (
                  <li key={row.line}>
                    {tr("Line", "Line")} {row.line}: {row.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

export default function PharmacyCatalog() {
  const tr = useTr();
  return (
    <AppShell role="ADMIN">
      <div id="main">
        <PageHeader
          eyebrow={tr("Pharmacy", "Pharmacy")}
          title={tr("Catalog", "Catalog")}
          subtitle={tr("Medicines, prices and stock.", "Dawaiyan, qeematein aur stock.")}
        />
        <div className="mt-6">
          <PharmacyAdminTabs />
        </div>
        <Suspense fallback={<Loading />}>
          <Catalog />
        </Suspense>
      </div>
    </AppShell>
  );
}
