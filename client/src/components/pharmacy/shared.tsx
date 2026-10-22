"use client";

/**
 * Pieces the pharmacy's screens share: money, the cart, a product's tile, an
 * order's status and its tracking line.
 *
 * **The cart is a convenience, never the truth.** It remembers which products
 * and how many, plus enough of each to draw a row without a request. Prices on
 * it are what the shelf said when the item was added; checkout asks the server
 * for the real figures and shows those. Nothing here is ever sent as a price.
 *
 * It lives in session storage, keyed by account. A cart of medicines says what
 * somebody is being treated for, and a shared family computer is a common
 * place to shop — so it does not outlive the browser tab, and one account
 * never sees another's.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";

import { Icon } from "@/components/Icon";
import { Badge, Button, cx } from "@/components/ui";
import type { OrderStatus, OrderStep, Product, ProductForm } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { useSession } from "@/lib/session";

// ---------------------------------------------------------------------------
// Money and words
// ---------------------------------------------------------------------------

/** "Rs 1,340" — rupees without paisa, the way a shop prices things. */
export function rupees(value: string | number, currency = "PKR"): string {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return `${currency} ${value}`;
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency,
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}

export const FORM_ICON: Record<ProductForm, string> = {
  TABLET: "pill",
  CAPSULE: "pill",
  SYRUP: "medication_liquid",
  SUSPENSION: "medication_liquid",
  DROPS: "water_drop",
  INJECTION: "vaccines",
  CREAM: "healing",
  OINTMENT: "healing",
  GEL: "healing",
  LOTION: "healing",
  INHALER: "air",
  SACHET: "inventory_2",
  SPRAY: "air",
  SOLUTION: "science",
  OTHER: "medication",
};

export const FORM_LABEL: Record<ProductForm, [string, string]> = {
  TABLET: ["Tablets", "Goliyan"],
  CAPSULE: ["Capsules", "Capsules"],
  SYRUP: ["Syrup", "Sharbat"],
  SUSPENSION: ["Suspension", "Suspension"],
  DROPS: ["Drops", "Qatre"],
  INJECTION: ["Injection", "Injection"],
  CREAM: ["Cream", "Cream"],
  OINTMENT: ["Ointment", "Malham"],
  GEL: ["Gel", "Gel"],
  LOTION: ["Lotion", "Lotion"],
  INHALER: ["Inhaler", "Inhaler"],
  SACHET: ["Sachets", "Sachets"],
  SPRAY: ["Spray", "Spray"],
  SOLUTION: ["Solution", "Mehlool"],
  OTHER: ["Other", "Deegar"],
};

export function productTitle(product: Pick<Product, "name" | "strength">): string {
  return [product.name, product.strength].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// The cart
// ---------------------------------------------------------------------------

export interface CartItem {
  productId: string;
  quantity: number;
  /** The patient's own prescription chosen for this line, if any. */
  prescriptionId?: string;
  name: string;
  strength: string | null;
  form: ProductForm;
  packSize: string;
  /** What the shelf said when this was added. Display only. */
  price: string;
  rxRequired: boolean;
}

export const MAX_QUANTITY = 20;

const EMPTY: CartItem[] = [];
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; items: CartItem[] }>();

function storageKey(userId: string): string {
  return `medinova.cart.${userId}`;
}

function snapshot(userId: string): CartItem[] {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(storageKey(userId));
  } catch {
    return EMPTY;
  }
  const hit = cache.get(userId);
  if (hit && hit.raw === raw) return hit.items;
  let items: CartItem[] = EMPTY;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    items = Array.isArray(parsed) ? (parsed as CartItem[]) : EMPTY;
  } catch {
    items = EMPTY;
  }
  cache.set(userId, { raw, items });
  return items;
}

function write(userId: string, items: CartItem[]): void {
  try {
    if (items.length === 0) window.sessionStorage.removeItem(storageKey(userId));
    else window.sessionStorage.setItem(storageKey(userId), JSON.stringify(items));
  } catch {
    // Storage blocked: the cart simply does not survive a reload.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCart() {
  const { user } = useSession();
  const userId = user?.id ?? "anonymous";
  const items = useSyncExternalStore(
    subscribe,
    () => snapshot(userId),
    () => EMPTY,
  );

  const add = useCallback(
    (product: Product, quantity = 1, prescriptionId?: string) => {
      const current = snapshot(userId);
      const existing = current.find((item) => item.productId === product.id);
      const next = existing
        ? current.map((item) =>
            item.productId === product.id
              ? {
                  ...item,
                  quantity: Math.min(MAX_QUANTITY, item.quantity + quantity),
                  prescriptionId: item.prescriptionId ?? prescriptionId,
                }
              : item,
          )
        : [
            ...current,
            {
              productId: product.id,
              quantity: Math.min(MAX_QUANTITY, quantity),
              prescriptionId,
              name: product.name,
              strength: product.strength,
              form: product.form,
              packSize: product.packSize,
              price: product.price,
              rxRequired: product.rxRequired,
            },
          ];
      write(userId, next);
    },
    [userId],
  );

  const setQuantity = useCallback(
    (productId: string, quantity: number) => {
      const current = snapshot(userId);
      const next =
        quantity <= 0
          ? current.filter((item) => item.productId !== productId)
          : current.map((item) =>
              item.productId === productId
                ? { ...item, quantity: Math.min(MAX_QUANTITY, quantity) }
                : item,
            );
      write(userId, next);
    },
    [userId],
  );

  const clear = useCallback(() => write(userId, []), [userId]);

  const count = useMemo(() => items.reduce((sum, item) => sum + item.quantity, 0), [items]);
  const estimate = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0),
    [items],
  );
  const quantityOf = useCallback(
    (productId: string) => items.find((item) => item.productId === productId)?.quantity ?? 0,
    [items],
  );

  return { items, add, setQuantity, clear, count, estimate, quantityOf };
}

// ---------------------------------------------------------------------------
// A product on the shelf
// ---------------------------------------------------------------------------

export function QuantityStepper({
  value,
  onChange,
  label,
  size = "md",
}: {
  value: number;
  onChange: (next: number) => void;
  label: string;
  size?: "sm" | "md";
}) {
  const tr = useTr();
  const box = size === "sm" ? "h-9 w-9" : "h-11 w-11";
  return (
    <div role="group" aria-label={label} className="inline-flex items-center rounded-xl border border-line bg-card">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        aria-label={value <= 1 ? tr("Remove", "Hatayein") : tr("One less", "Aik kam")}
        className={cx(box, "grid place-items-center rounded-l-xl text-primary hover:bg-sunken focus-visible:outline-2 focus-visible:outline-primary")}
      >
        <Icon name={value <= 1 ? "delete" : "remove"} className="text-[20px]" />
      </button>
      <span className="min-w-8 text-center font-semibold tabular-nums text-strong" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={value >= MAX_QUANTITY}
        aria-label={tr("One more", "Aik aur")}
        className={cx(box, "grid place-items-center rounded-r-xl text-primary hover:bg-sunken focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40")}
      >
        <Icon name="add" className="text-[20px]" />
      </button>
    </div>
  );
}

export function StockNote({ product }: { product: Product }) {
  const tr = useTr();
  if (!product.active || product.stockState === "OUT") {
    return <Badge tone="neutral">{tr("Out of stock", "Stock khatam")}</Badge>;
  }
  if (product.stockState === "LOW") {
    return <Badge tone="warning">{tr("Only a few left", "Thore baqi")}</Badge>;
  }
  return null;
}

export function ProductTile({
  product,
  onAdd,
  quantity,
  onQuantity,
}: {
  product: Product;
  onAdd: () => void;
  quantity: number;
  onQuantity: (next: number) => void;
}) {
  const tr = useTr();
  return (
    <article className="group flex flex-col rounded-2xl border border-line bg-card p-4 shadow-card transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-overlay">
      <div className="flex items-start gap-3">
        <span aria-hidden className="bg-gradient-soft grid h-12 w-12 shrink-0 place-items-center rounded-xl text-primary">
          <Icon name={FORM_ICON[product.form]} className="text-[24px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-base font-bold leading-snug text-strong">
            {productTitle(product)}
          </h3>
          <p className="truncate text-sm text-muted">{product.genericName}</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-faint">
        {tr(...FORM_LABEL[product.form])} · {product.packSize}
        {product.manufacturer ? ` · ${product.manufacturer}` : ""}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {product.rxRequired && (
          <Badge tone="warning">
            <Icon name="prescriptions" className="text-[14px]" />
            {tr("Prescription needed", "Nuskha zaroori")}
          </Badge>
        )}
        <StockNote product={product} />
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        <span className="font-display text-lg font-bold tabular-nums text-strong">{rupees(product.price)}</span>
        {quantity > 0 ? (
          <QuantityStepper
            value={quantity}
            onChange={onQuantity}
            size="sm"
            label={tr(`Quantity of ${product.name}`, `${product.name} ki tadaad`)}
          />
        ) : (
          <Button onClick={onAdd} disabled={!product.available}>
            <Icon name="add_shopping_cart" className="text-[20px]" />
            {tr("Add", "Shamil")}
          </Button>
        )}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// An order's progress
// ---------------------------------------------------------------------------

const STATUS: Record<OrderStatus, { label: [string, string]; tone: "neutral" | "good" | "warning" | "critical" | "info"; icon: string }> = {
  PENDING_RX: { label: ["Prescription check", "Nuskhe ki jaanch"], tone: "warning", icon: "prescriptions" },
  AWAITING_PAYMENT: { label: ["Awaiting payment", "Payment ka intezar"], tone: "warning", icon: "payments" },
  CONFIRMED: { label: ["Confirmed", "Confirm"], tone: "info", icon: "check_circle" },
  PACKED: { label: ["Packed", "Pack ho gaya"], tone: "info", icon: "inventory_2" },
  DISPATCHED: { label: ["On the way", "Raste mein"], tone: "info", icon: "local_shipping" },
  DELIVERED: { label: ["Delivered", "Pahunch gaya"], tone: "good", icon: "task_alt" },
  CANCELLED: { label: ["Cancelled", "Mansookh"], tone: "neutral", icon: "cancel" },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const tr = useTr();
  const spec = STATUS[status];
  return (
    <Badge tone={spec.tone}>
      <Icon name={spec.icon} filled className="text-[14px]" />
      {tr(...spec.label)}
    </Badge>
  );
}

const STEP_LABEL: Record<OrderStep["key"], [string, string]> = {
  PLACED: ["Order placed", "Order diya gaya"],
  PRESCRIPTION: ["Prescription approved", "Nuskha manzoor"],
  PAID: ["Payment confirmed", "Payment confirm"],
  CONFIRMED: ["Confirmed — cash on delivery", "Confirm — cash on delivery"],
  PACKED: ["Packed", "Pack ho gaya"],
  DISPATCHED: ["Out for delivery", "Delivery ke liye rawana"],
  DELIVERED: ["Delivered", "Pahunch gaya"],
  CANCELLED: ["Cancelled", "Mansookh"],
};

export function OrderTimeline({ steps }: { steps: OrderStep[] }) {
  const tr = useTr();
  const cancelled = steps.some((step) => step.key === "CANCELLED");
  const shown = cancelled
    ? steps.filter((step) => step.done || step.failed)
    : steps;
  return (
    <ol className="relative space-y-4 pl-8">
      <span aria-hidden className="absolute bottom-2 left-[0.9rem] top-2 w-0.5 rounded-full bg-line" />
      {shown.map((step) => {
        const label = step.failed ? ["Prescription not accepted", "Nuskha manzoor nahi hua"] : STEP_LABEL[step.key];
        return (
          <li key={step.key} className="relative">
            <span
              aria-hidden
              className={cx(
                "absolute -left-8 top-0.5 grid h-7 w-7 place-items-center rounded-full border-2",
                step.failed || step.key === "CANCELLED"
                  ? "border-critical bg-critical-soft text-critical"
                  : step.done
                    ? "border-transparent bg-gradient-brand text-white"
                    : "border-line-strong bg-card text-faint",
              )}
            >
              <Icon
                name={step.failed || step.key === "CANCELLED" ? "close" : step.done ? "check" : "radio_button_unchecked"}
                className="text-[16px]"
              />
            </span>
            <p className={cx("font-semibold", step.done || step.failed ? "text-strong" : "text-faint")}>
              {tr(label[0], label[1])}
            </p>
            {step.at && (
              <p className="text-xs tabular-nums text-muted">
                {new Date(step.at).toLocaleString(undefined, {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
