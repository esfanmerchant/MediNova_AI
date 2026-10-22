"use client";

/**
 * The MediNova pharmacy: genuine medicines, delivered.
 *
 * Built around the one thing a patient arriving here most often wants — the
 * medicines their doctor just prescribed — so those come first, matched to the
 * shelf and one press from the cart. Browsing and search follow for everything
 * else.
 *
 * Prescription-only medicine is shown, priced and addable like anything else,
 * with a clear badge. The check happens at checkout, where the patient chooses
 * how to clear it, rather than as a wall in front of the shelf.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import {
  ProductTile,
  productTitle,
  rupees,
  useCart,
} from "@/components/pharmacy/shared";
import { Badge, Button, Card, EmptyState, ErrorState, Input, Skeleton, cx } from "@/components/ui";
import { pharmacy, type Product } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { useAsync } from "@/lib/useAsync";

const PAGE = 24;
/** The API's own ceiling on one page. */
const MAX_PAGE = 100;

function useDebounced<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export default function PharmacyStore() {
  const tr = useTr();
  const cart = useCart();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const term = useDebounced(search.trim());

  const info = useAsync(() => pharmacy.info(), [], { live: false });
  const mine = useAsync(() => pharmacy.myPrescriptions(), [], { live: false });
  const products = useAsync(
    () => pharmacy.products({ search: term || undefined, category: category || undefined, limit }),
    [term, category, limit],
    { live: false },
  );

  const settings = info.data?.settings;
  const prescribed = useMemo(
    () => (mine.data ?? []).filter((entry) => entry.products.length > 0),
    [mine.data],
  );

  const addAllPrescribed = () => {
    for (const entry of prescribed) {
      const product = entry.products.find((option) => option.available);
      if (product && cart.quantityOf(product.id) === 0) cart.add(product, 1, entry.prescriptionId);
    }
  };

  return (
    <AppShell role="PATIENT">
      <div id="main" className="page-enter pb-28">
        <PageHeader
          eyebrow={settings?.pharmacyName ?? tr("MediNova Pharmacy", "MediNova Pharmacy")}
          title={tr("Pharmacy", "Pharmacy")}
          subtitle={tr(
            "Genuine medicines delivered to your door. Pay in cash on delivery, or online.",
            "Asli dawaiyan aap ke ghar tak. Cash on delivery ya online payment.",
          )}
          actions={
            <Link
              href="/patient/pharmacy/orders"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-card px-4 font-semibold text-primary hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <Icon name="receipt_long" className="text-[20px]" />
              {tr("My orders", "Mere orders")}
            </Link>
          }
        />

        {/* The terms, said once and plainly. */}
        {settings && (
          <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <li className="flex items-center gap-3 rounded-2xl border border-line bg-card p-4">
              <Icon name="local_shipping" className="text-[24px] text-primary" />
              <span className="text-sm">
                <span className="block font-semibold text-strong">
                  {Number(settings.deliveryFee) > 0
                    ? tr(`Delivery ${rupees(settings.deliveryFee)}`, `Delivery ${rupees(settings.deliveryFee)}`)
                    : tr("Free delivery", "Muft delivery")}
                </span>
                {settings.freeDeliveryAbove && Number(settings.deliveryFee) > 0 && (
                  <span className="text-muted">
                    {tr(`Free above ${rupees(settings.freeDeliveryAbove)}`, `${rupees(settings.freeDeliveryAbove)} se upar muft`)}
                  </span>
                )}
              </span>
            </li>
            <li className="flex items-center gap-3 rounded-2xl border border-line bg-card p-4">
              <Icon name="payments" className="text-[24px] text-primary" />
              <span className="text-sm">
                <span className="block font-semibold text-strong">
                  {settings.codEnabled
                    ? tr("Cash on delivery", "Cash on delivery")
                    : tr("Online payment", "Online payment")}
                </span>
                <span className="text-muted">
                  {settings.codEnabled
                    ? tr("or EasyPaisa / NayaPay transfer", "ya EasyPaisa / NayaPay transfer")
                    : tr("EasyPaisa / NayaPay transfer", "EasyPaisa / NayaPay transfer")}
                </span>
              </span>
            </li>
            <li className="flex items-center gap-3 rounded-2xl border border-line bg-card p-4">
              <Icon name="verified" className="text-[24px] text-primary" />
              <span className="text-sm">
                <span className="block font-semibold text-strong">
                  {tr("Checked by a pharmacist", "Pharmacist ki jaanch")}
                </span>
                <span className="text-muted">
                  {tr("Prescriptions verified before dispatch", "Bhejne se pehle nuskhe ki tasdeeq")}
                </span>
              </span>
            </li>
          </ul>
        )}

        {/* What the doctor prescribed, on the shelf. */}
        {prescribed.length > 0 && (
          <div className="mt-6">
            <Card
              icon="prescriptions"
              title={tr("From your prescriptions", "Aap ke nuskhon se")}
              description={tr(
                "Medicines your MediNova doctor prescribed, ready to order. No extra checks needed.",
                "Aap ke MediNova doctor ki likhi dawaiyan, order ke liye tayyar. Koi izafi jaanch nahi.",
              )}
              action={
                <Button variant="secondary" onClick={addAllPrescribed}>
                  <Icon name="add_shopping_cart" className="text-[20px]" />
                  {tr("Add all", "Sab shamil karein")}
                </Button>
              }
            >
              <ul className="divide-y divide-line">
                {prescribed.map((entry) => (
                  <li key={entry.prescriptionId} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-strong">{entry.medication}</p>
                      <p className="text-sm text-muted">
                        {[entry.dosage, entry.frequency, entry.duration].filter(Boolean).join(" · ")}
                        {entry.doctorName ? ` · ${entry.doctorName}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {entry.products.slice(0, 3).map((product) => {
                        const inCart = cart.quantityOf(product.id) > 0;
                        return (
                          <Button
                            key={product.id}
                            variant={inCart ? "ghost" : "secondary"}
                            disabled={!product.available || inCart}
                            onClick={() => cart.add(product, 1, entry.prescriptionId)}
                          >
                            <Icon name={inCart ? "check" : "add"} className="text-[18px]" />
                            <span className="tabular-nums">
                              {productTitle(product)} · {rupees(product.price)}
                            </span>
                          </Button>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}

        {/* Search and shelves. */}
        <div className="mt-6 space-y-4">
          <div className="relative">
            <Icon
              name="search"
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[22px] text-faint"
            />
            <Input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setLimit(PAGE);
              }}
              placeholder={tr("Search medicines — e.g. Panadol, paracetamol", "Dawa dhoondein — maslan Panadol")}
              aria-label={tr("Search medicines", "Dawa dhoondein")}
              className="pl-11"
            />
          </div>

          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {[{ name: "", products: 0 }, ...(info.data?.categories ?? [])].map((entry) => {
              const active = category === entry.name;
              return (
                <button
                  key={entry.name || "all"}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setCategory(entry.name);
                    setLimit(PAGE);
                  }}
                  className={cx(
                    "inline-flex min-h-9 shrink-0 items-center rounded-full px-3.5 text-[13px] font-semibold transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                    active
                      ? "bg-primary text-primary-on"
                      : "border border-line bg-card text-muted hover:border-primary hover:text-strong",
                  )}
                >
                  {entry.name || tr("All", "Sab")}
                  {entry.name && <span className="ml-1.5 tabular-nums opacity-70">{entry.products}</span>}
                </button>
              );
            })}
          </div>

          {products.loading && !products.data ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden>
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-48 rounded-2xl" />
              ))}
            </div>
          ) : products.error ? (
            <ErrorState message={products.error.message} onRetry={products.reload} />
          ) : (products.data?.data.length ?? 0) === 0 ? (
            <EmptyState
              icon="search_off"
              title={tr("Nothing matches that", "Is se kuchh nahi milta")}
              description={tr(
                "Try the generic name — paracetamol rather than a brand — or another category.",
                "Generic naam se dhoondein — brand ki jaga paracetamol — ya koi aur category.",
              )}
            />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {(products.data?.data ?? []).map((product: Product) => (
                  <ProductTile
                    key={product.id}
                    product={product}
                    quantity={cart.quantityOf(product.id)}
                    onAdd={() => cart.add(product)}
                    onQuantity={(next) => cart.setQuantity(product.id, next)}
                  />
                ))}
              </div>
              {(products.data?.meta.total ?? 0) > (products.data?.data.length ?? 0) &&
                limit < MAX_PAGE && (
                  <div className="flex justify-center">
                    <Button
                      variant="secondary"
                      onClick={() => setLimit((n) => Math.min(MAX_PAGE, n + PAGE))}
                    >
                      {tr("Show more", "Aur dikhayein")}
                    </Button>
                  </div>
                )}
              {limit >= MAX_PAGE && (products.data?.meta.total ?? 0) > MAX_PAGE && (
                <p className="text-center text-sm text-muted">
                  {tr(
                    "Showing the first 100. Search or pick a category to find the rest.",
                    "Pehle 100 dikh rahe hain. Baqi ke liye search karein ya category chunein.",
                  )}
                </p>
              )}
            </>
          )}
        </div>

        {/* The cart, always reachable, never in the way. */}
        {cart.count > 0 && (
          <div className="safe-bottom fixed inset-x-0 bottom-16 z-30 px-4 lg:bottom-6 lg:left-auto lg:right-8 lg:w-[26rem] lg:px-0">
            <div className="pop-in flex items-center gap-3 rounded-2xl border border-line bg-card p-3 shadow-overlay">
              <span className="bg-gradient-brand relative grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white">
                <Icon name="shopping_bag" className="text-[22px]" />
                <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-critical px-1 text-[11px] font-bold tabular-nums text-white">
                  {cart.count}
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-strong">
                  {tr(`${cart.count} ${cart.count === 1 ? "item" : "items"}`, `${cart.count} ${cart.count === 1 ? "cheez" : "cheezein"}`)}
                </p>
                <p className="text-xs tabular-nums text-muted">
                  {tr("About", "Taqreeban")} {rupees(cart.estimate)}
                  {cart.items.some((item) => item.rxRequired) && (
                    <Badge tone="warning">Rx</Badge>
                  )}
                </p>
              </div>
              <Link
                href="/patient/pharmacy/checkout"
                className="bg-gradient-brand inline-flex min-h-11 items-center gap-1.5 rounded-xl px-4 font-semibold text-white shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {tr("Checkout", "Checkout")}
                <Icon name="arrow_forward" className="text-[20px]" />
              </Link>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
