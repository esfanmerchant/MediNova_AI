"use client";

/**
 * The shelf: what the pharmacy sells, at what price, and how much is left.
 *
 * Stock is changed by adding or writing off, never by typing a new count —
 * an order placed while this screen was open would otherwise be silently
 * undone. Every change carries a reason, which goes to the audit trail.
 *
 * Starter-catalog prices are estimates. The screen says so once, in the price
 * check above the table, and marks each one with an amber dot until somebody
 * saves a checked price.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { ConsoleHeader, MedicinePack, Pager, RowButton, StatusPill, TogglePill } from "@/components/admin/console";
import { Dialog, useToast } from "@/components/overlays";
import { PharmacyAdminTabs } from "@/components/pharmacy/AdminTabs";
import { FORM_LABEL, productTitle, rupees } from "@/components/pharmacy/shared";
import { Switch } from "@/components/forms";
import {
  Button,
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

/** Twenty to a page, with the header held while the page scrolls. */
const PAGE = 20;

function Catalog() {
  const tr = useTr();
  const toast = useToast();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [stocking, setStocking] = useState<Product | null>(null);
  const [importing, setImporting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [loadingStarter, setLoadingStarter] = useState(false);

  const lowStock = params.get("lowStock") === "1";
  const unreviewed = params.get("unreviewed") === "1";
  const includeInactive = params.get("inactive") === "1";

  const setFlags = (flags: Record<string, boolean>) => {
    const next = new URLSearchParams(params.toString());
    for (const [name, on] of Object.entries(flags)) {
      if (on) next.set(name, "1");
      else next.delete(name);
    }
    setOffset(0);
    router.replace(`${pathname}?${next.toString()}`);
  };
  const setFlag = (name: string, on: boolean) => setFlags({ [name]: on });

  // "+ New" opens this page with ?new=1 or ?import=1. Read from the URL rather
  // than copied into state, so the dialog also opens when the menu is used
  // while this page is already showing; closing it takes the flag back off.
  const adding = params.get("new") === "1";
  const importingFromLink = params.get("import") === "1";
  const product = editing ?? (adding ? "new" : null);
  const showImport = importing || importingFromLink;

  const list = useAsync(
    () =>
      pharmacy.products({
        search: search.trim() || undefined,
        includeInactive,
        lowStock,
        unreviewedPrice: unreviewed,
        limit: PAGE,
        offset,
      }),
    [search, includeInactive, lowStock, unreviewed, offset, refresh],
    { live: false },
  );
  // The sentence and the price check: the dashboard's counts, and the size of
  // the shelf from a one-row read.
  const summary = useAsync(() => pharmacy.dashboard(), [refresh], { live: false });
  const onSale = useAsync(() => pharmacy.products({ limit: 1 }), [refresh], { live: false });
  const everything = useAsync(() => pharmacy.products({ includeInactive: true, limit: 1 }), [refresh], { live: false });
  const rows = list.data?.data ?? [];
  const reload = () => setRefresh((n) => n + 1);
  const data = summary.data;
  const shelf = everything.data?.meta.total ?? 0;
  const checked = data ? Math.max(0, shelf - data.unreviewedPrices) : 0;

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
    <>
      <ConsoleHeader
        mark="catalog"
        eyebrow={tr("Pharmacy", "Pharmacy")}
        title={tr("Catalog", "Catalog")}
        actions={
          <>
            <Button variant="ghost" loading={loadingStarter} onClick={() => void loadStarter()}>
              {tr("Load starter catalog", "Starter catalog load karein")}
            </Button>
            <Button variant="secondary" onClick={() => setImporting(true)}>
              <Icon name="upload_file" className="text-[18px]" />
              {tr("Import CSV", "CSV import")}
            </Button>
            <Button onClick={() => setEditing("new")}>
              <Icon name="add" className="text-[18px]" />
              {tr("Add a medicine", "Dawa shamil karein")}
            </Button>
          </>
        }
      >
        {data && onSale.data ? (
          <p>
            <b>
              {onSale.data.meta.total} {tr(onSale.data.meta.total === 1 ? "medicine" : "medicines", "dawaiyan")}
            </b>{" "}
            {tr("on sale.", "farokht ke liye.")}{" "}
            {data.lowStockCount > 0 && (
              <>
                <a
                  href="#medicines"
                  onClick={(event) => {
                    event.preventDefault();
                    setFlags({ lowStock: true, unreviewed: false });
                  }}
                >
                  {tr(`${data.lowStockCount} running low`, `${data.lowStockCount} kam`)}
                </a>
                {data.unreviewedPrices > 0 ? tr(", and ", ", aur ") : ". "}
              </>
            )}
            {data.unreviewedPrices > 0 && (
              <>
                <a
                  href="#medicines"
                  onClick={(event) => {
                    event.preventDefault();
                    setFlags({ unreviewed: true, lowStock: false });
                  }}
                >
                  {tr(
                    `${data.unreviewedPrices} ${data.unreviewedPrices === 1 ? "price" : "prices"} not yet checked`,
                    `${data.unreviewedPrices} qeematein abhi check nahi`,
                  )}
                </a>{" "}
                {tr("against DRAP.", "DRAP ke mutabiq.")}
              </>
            )}
          </p>
        ) : (
          <p>
            {tr(
              "Every medicine the pharmacy sells: its price, its stock, and whether it needs a prescription.",
              "Pharmacy ki har dawa: qeemat, stock, aur kya nuskha zaroori hai.",
            )}
          </p>
        )}
      </ConsoleHeader>
      <div className="mt-[22px]">
        <PharmacyAdminTabs openOrders={data?.openOrders} />
      </div>

      {data && data.unreviewedPrices > 0 && (
        // The price check, said once for the whole shelf; each estimate carries
        // only an amber dot beside its price.
        <section
          aria-label={tr("Price check", "Qeemat ki jaanch")}
          className="rise-in mt-[22px] flex flex-wrap items-center gap-x-5 gap-y-3.5 rounded-[18px] bg-pastel-butter px-[18px] py-3.5 text-pastel-ink"
        >
          <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-card/70 text-[#B45309] dark:text-[#FBD27A]">
            <Icon name="price_check" className="text-[19px]" />
          </span>
          <p className="min-w-[16rem] flex-1 text-sm">
            <b className="font-semibold">
              {tr(
                `${data.unreviewedPrices} ${data.unreviewedPrices === 1 ? "price is" : "prices are"} still estimates.`,
                `${data.unreviewedPrices} qeematein abhi andaze hain.`,
              )}
            </b>{" "}
            {tr(
              "Each one carries an amber mark until it is saved against the pack's DRAP maximum retail price.",
              "Har aik par amber nishan rehta hai jab tak pack ki DRAP MRP ke mutabiq save na ho.",
            )}
          </p>
          {shelf > 0 && (
            <span className="flex items-center gap-2.5">
              <span
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={shelf}
                aria-valuenow={checked}
                aria-label={tr("Prices checked", "Check shuda qeematein")}
                className="h-2 w-[140px] overflow-hidden rounded-full bg-pastel-ink/10"
              >
                <span
                  className="bar-grow-x block h-full rounded-full bg-[#B45309] dark:bg-[#FBD27A]"
                  style={{ width: `${(checked / shelf) * 100}%` }}
                />
              </span>
              <b className="text-[12.5px] font-semibold tabular-nums">
                {tr(`${checked} of ${shelf}`, `${shelf} mein se ${checked}`)}
              </b>
            </span>
          )}
          <Button size="sm" variant="secondary" onClick={() => setFlags({ unreviewed: true, lowStock: false })}>
            {tr("Show them", "Dikhayein")}
          </Button>
        </section>
      )}

      <section
        id="medicines"
        aria-label={tr("Medicines", "Dawaiyan")}
        className="rise-in mt-[22px] scroll-mt-24 overflow-hidden rounded-3xl border border-line bg-card shadow-card"
      >
        <div className="flex flex-wrap items-center gap-2.5 px-[18px] py-4">
          <label className="flex h-10 w-full items-center gap-2.5 rounded-full border border-line-strong bg-card pr-3 pl-3.5 text-muted focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary sm:w-[340px]">
            <Icon name="search" className="text-[18px]" />
            <input
              type="search"
              aria-label={tr("Search the catalog", "Catalog dhoondein")}
              placeholder={tr("Brand, generic or maker", "Brand, generic ya company")}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setOffset(0);
              }}
              className="min-w-0 flex-1 bg-transparent text-[13.5px] text-strong outline-none placeholder:text-muted"
            />
          </label>
          <TogglePill pressed={lowStock} onToggle={() => setFlag("lowStock", !lowStock)} dot="bg-[#F59E0B]">
            {tr("Running low", "Kam stock")}
          </TogglePill>
          <TogglePill pressed={unreviewed} onToggle={() => setFlag("unreviewed", !unreviewed)} dot="bg-[#B45309]">
            {tr("Price not checked", "Qeemat check nahi")}
          </TogglePill>
          <TogglePill pressed={includeInactive} onToggle={() => setFlag("inactive", !includeInactive)} dot="bg-faint">
            {tr("Show hidden", "Chhupe dikhayein")}
          </TogglePill>
        </div>

        {list.loading && !list.data ? (
          <div className="px-[18px] pb-5">
            <SkeletonRows rows={6} title={false} />
          </div>
        ) : list.error ? (
          <div className="px-[18px] pb-5">
            <ErrorState message={list.error.message} onRetry={list.reload} />
          </div>
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
          <>
            <div className="relative overflow-x-auto">
              <table className="console-table min-w-[50rem]">
                <thead>
                  <tr>
                    <th scope="col">{tr("Medicine", "Dawa")}</th>
                    <th scope="col">{tr("Category", "Category")}</th>
                    <th scope="col" className="text-right">
                      {tr("Price", "Qeemat")}
                    </th>
                    <th scope="col" className="w-[220px]">
                      {tr("Stock", "Stock")}
                    </th>
                    <th scope="col" className="text-right">
                      <span className="sr-only">{tr("Actions", "Amal")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((product) => {
                    const left = product.stock ?? 0;
                    const level = product.lowStockThreshold ?? 0;
                    const out = left === 0;
                    const short = left <= level;
                    return (
                      <tr key={product.id}>
                        <td>
                          <div className="flex items-center gap-3">
                            <MedicinePack form={product.form} size={32} />
                            <div className="min-w-0">
                              <p className="flex flex-wrap items-center gap-1.5">
                                <span className="font-semibold text-strong">{productTitle(product)}</span>
                                {product.rxRequired && <StatusPill tone="warning">Rx</StatusPill>}
                                {!product.active && <StatusPill>{tr("Hidden", "Chhupa")}</StatusPill>}
                              </p>
                              <p className="text-[12.5px] text-muted">
                                {product.genericName} · {product.packSize}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="text-muted">{product.category}</td>
                        <td className="text-right whitespace-nowrap tabular-nums">
                          <span className="inline-flex items-center gap-[7px]">
                            {product.priceReviewed === false && (
                              <span
                                title={tr("Estimate — not yet checked against DRAP", "Andaza — DRAP se abhi check nahi")}
                                className="h-2 w-2 rounded-full bg-[#F59E0B]"
                              >
                                <span className="sr-only">{tr("Estimate", "Andaza")}</span>
                              </span>
                            )}
                            <span className="font-semibold text-strong">{rupees(product.price)}</span>
                          </span>
                        </td>
                        <td>
                          <span className="flex items-center gap-2.5">
                            <span aria-hidden className="h-1.5 max-w-[120px] flex-1 overflow-hidden rounded-full bg-sunken">
                              <span
                                className={cx(
                                  "bar-grow-x block h-full rounded-full",
                                  out ? "bg-critical" : short ? "bg-[#F59E0B]" : "bg-stable",
                                )}
                                style={{ width: `${out ? 0 : Math.max(4, Math.min(100, (left / Math.max(1, level * 4)) * 100))}%` }}
                              />
                            </span>
                            <span
                              className={cx(
                                "w-9 text-right font-semibold tabular-nums",
                                out ? "text-critical" : short ? "text-warning" : "text-strong",
                              )}
                            >
                              {out ? tr("Out", "Khatam") : left}
                            </span>
                          </span>
                        </td>
                        <td>
                          <div className="flex justify-end gap-1.5">
                            <RowButton
                              label={tr(`Change the stock of ${productTitle(product)}`, `${productTitle(product)} ka stock badlein`)}
                              icon="inventory"
                              onClick={() => setStocking(product)}
                            />
                            <RowButton
                              label={tr(`Edit ${productTitle(product)}`, `${productTitle(product)} edit karein`)}
                              icon="edit"
                              onClick={() => setEditing(product)}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager offset={offset} limit={PAGE} total={list.data?.meta.total ?? rows.length} onChange={setOffset} />
          </>
        )}
      </section>

      {product && (
        <ProductDialog
          key={product === "new" ? "new" : product.id}
          product={product === "new" ? null : product}
          onClose={() => {
            setEditing(null);
            if (adding) setFlag("new", false);
          }}
          onSaved={() => {
            setEditing(null);
            if (adding) setFlag("new", false);
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
      {showImport && (
        <ImportDialog
          onClose={() => {
            setImporting(false);
            if (importingFromLink) setFlag("import", false);
          }}
          onImported={() => reload()}
        />
      )}
    </>
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
  return (
    <AppShell role="ADMIN">
      <div id="main">
        <Suspense fallback={<Loading />}>
          <Catalog />
        </Suspense>
      </div>
    </AppShell>
  );
}
