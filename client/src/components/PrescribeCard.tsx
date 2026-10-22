"use client";

/**
 * Writing a prescription, with the pharmacy's shelf one keystroke away.
 *
 * The medication field is still free text — a prescription is a clinical
 * statement first, and a doctor must be able to prescribe something the
 * pharmacy does not stock. But as they type, matching products from the
 * catalog are offered, and choosing one links the prescription to that exact
 * pack. That link is what lets the patient's "Order these medicines" find the
 * right box rather than guessing from a name: Amoxil 500 mg capsules, not
 * Augmentin, not the 250 mg suspension.
 *
 * Editing the name after choosing a product drops the link. A prescription
 * that says one thing and points at another is worse than one that points at
 * nothing.
 */

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Icon } from "@/components/Icon";
import { Badge, Button, Card, Field, Input, Textarea, cx } from "@/components/ui";
import {
  ApiError,
  pharmacy,
  prescriptions as prescriptionsApi,
  type Prescription,
  type Product,
} from "@/lib/api";
import { useTr } from "@/lib/lang";

const EASE = [0.16, 1, 0.3, 1] as const;

function Expand({ open, children }: { open: boolean; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="body"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.3, ease: EASE }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** "Amoxil 500 mg" — what goes in the medication field when a product is chosen. */
export function productLabel(product: Pick<Product, "name" | "strength">): string {
  return [product.name, product.strength].filter(Boolean).join(" ");
}

const FORM_WORD: Record<string, string> = {
  TABLET: "tablets",
  CAPSULE: "capsules",
  SYRUP: "syrup",
  SUSPENSION: "suspension",
  DROPS: "drops",
  INJECTION: "injection",
  CREAM: "cream",
  OINTMENT: "ointment",
  GEL: "gel",
  LOTION: "lotion",
  INHALER: "inhaler",
  SACHET: "sachets",
  SPRAY: "spray",
  SOLUTION: "solution",
  OTHER: "",
};

export function formWord(form: string): string {
  return FORM_WORD[form] ?? form.toLowerCase();
}

/**
 * The medication box and its suggestions. A combobox in the ARIA sense: the
 * input keeps focus, arrow keys move through the options, Enter picks one.
 */
function MedicationPicker({
  value,
  onChange,
  picked,
  onPick,
}: {
  value: string;
  onChange: (next: string) => void;
  picked: Product | null;
  onPick: (product: Product) => void;
}) {
  const tr = useTr();
  const listId = useId();
  const [options, setOptions] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const request = useRef(0);

  useEffect(() => {
    const term = value.trim();
    if (term.length < 2 || (picked && productLabel(picked) === value)) {
      return;
    }
    const mine = ++request.current;
    const timer = window.setTimeout(() => {
      void pharmacy
        .products({ search: term, limit: 6 })
        .then((page) => {
          if (mine !== request.current) return;
          setOptions(page.data);
          setActive(-1);
          setOpen(page.data.length > 0);
        })
        .catch(() => {
          // Suggestions are a convenience. Without them the field still works.
          if (mine === request.current) setOptions([]);
        });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [value, picked]);

  const choose = (product: Product) => {
    onPick(product);
    setOpen(false);
    setOptions([]);
  };

  return (
    <div className="relative">
      <Input
        id="medication"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={value}
        maxLength={200}
        placeholder={tr("Start typing — e.g. Amoxil", "Likhna shuru karein — maslan Amoxil")}
        onChange={(event) => {
          onChange(event.target.value);
          if (event.target.value.trim().length < 2) setOpen(false);
        }}
        onFocus={() => options.length > 0 && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(event) => {
          if (!open || options.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => (index + 1) % options.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => (index <= 0 ? options.length - 1 : index - 1));
          } else if (event.key === "Enter" && active >= 0) {
            event.preventDefault();
            choose(options[active]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {picked && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-primary">
          <Icon name="local_pharmacy" className="text-[15px]" />
          {tr("Linked to the pharmacy:", "Pharmacy se juda:")} {productLabel(picked)} ·{" "}
          {picked.packSize}
        </p>
      )}
      {open && options.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1.5 max-h-72 w-full overflow-y-auto rounded-xl border border-line bg-card p-1 shadow-overlay"
        >
          {options.map((product, index) => (
            <li
              key={product.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              // mousedown, not click: the input's blur would close the list
              // before a click ever landed.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(product);
              }}
              className={cx(
                "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2",
                index === active ? "bg-gradient-soft" : "hover:bg-sunken",
              )}
            >
              <Icon name="pill" className="shrink-0 text-[18px] text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-strong">
                  {productLabel(product)} {formWord(product.form)}
                </span>
                <span className="block truncate text-xs text-muted">
                  {product.genericName} · {product.packSize}
                </span>
              </span>
              {product.rxRequired && <Badge tone="warning">Rx</Badge>}
              {!product.available && <Badge tone="neutral">{tr("Out", "Khatam")}</Badge>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PrescribeCard({
  patientId,
  onSaved,
  title,
  description,
  startOpen = false,
}: {
  patientId: string;
  onSaved: (prescription: Prescription) => void;
  title?: string;
  description?: string;
  startOpen?: boolean;
}) {
  const tr = useTr();
  const [open, setOpen] = useState(startOpen);
  const [medication, setMedication] = useState("");
  const [product, setProduct] = useState<Product | null>(null);
  const [dosage, setDosage] = useState("");
  const [frequency, setFrequency] = useState("");
  const [duration, setDuration] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const settle = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(settle.current), []);

  const complete = medication && dosage && frequency && duration;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await prescriptionsApi.create({
        patientId,
        medication,
        dosage,
        frequency,
        duration,
        instructions: instructions || undefined,
        productId: product?.id,
      });
      setSaved(created.medication);
      setMedication("");
      setProduct(null);
      setDosage("");
      setFrequency("");
      setDuration("");
      setInstructions("");
      onSaved(created);
      settle.current = window.setTimeout(() => {
        setSaved(null);
        if (!startOpen) setOpen(false);
      }, 1400);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : tr("Could not save the prescription.", "Nuskha mehfooz nahi ho saka."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={title ?? tr("Prescribe", "Nuskha likhein")}
      description={description ?? tr("Check the current medication first.", "Pehle jari dawaiyan dekh lein.")}
      icon="prescriptions"
      action={
        !open && (
          <Button onClick={() => setOpen(true)}>
            <Icon name="add" className="text-[20px]" />
            {tr("New prescription", "Naya nuskha")}
          </Button>
        )
      }
    >
      {!open && (
        <p className="text-sm text-muted">
          {tr(
            "Prescriptions are never deleted — stopping one keeps it in the patient’s history.",
            "Nuskhe kabhi delete nahi hote — rokne par bhi mareez ki history mein rehte hain.",
          )}
        </p>
      )}
      <Expand open={open}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label={tr("Medication", "Dawa")}
              htmlFor="medication"
              hint={tr(
                "Pick from the pharmacy so the patient can order exactly this pack.",
                "Pharmacy se chunein taake mareez bilkul yahi pack order kar sake.",
              )}
            >
              <MedicationPicker
                value={medication}
                picked={product}
                onChange={(next) => {
                  setMedication(next);
                  if (product && next !== productLabel(product)) setProduct(null);
                }}
                onPick={(chosen) => {
                  setProduct(chosen);
                  setMedication(productLabel(chosen));
                  if (!dosage && chosen.strength) setDosage(chosen.strength);
                }}
              />
            </Field>
            <Field label={tr("Dosage", "Miqdar")} htmlFor="dosage">
              <Input
                id="dosage"
                value={dosage}
                maxLength={100}
                onChange={(event) => setDosage(event.target.value)}
                placeholder="e.g. 500 mg"
              />
            </Field>
            <Field label={tr("Frequency", "Kitni baar")} htmlFor="frequency">
              <Input
                id="frequency"
                value={frequency}
                maxLength={100}
                onChange={(event) => setFrequency(event.target.value)}
                placeholder="e.g. Three times daily"
              />
            </Field>
            <Field label={tr("Duration", "Muddat")} htmlFor="duration">
              <Input
                id="duration"
                value={duration}
                maxLength={100}
                onChange={(event) => setDuration(event.target.value)}
                placeholder="e.g. 5 days"
              />
            </Field>
          </div>
          <Field label={tr("Instructions for the patient", "Mareez ke liye hidayat")} htmlFor="instructions">
            <Textarea
              id="instructions"
              rows={2}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="e.g. Take after food"
            />
          </Field>

          {error && (
            <p role="alert" className="pop-in text-sm font-medium text-critical">
              {error}
            </p>
          )}
          {saved && (
            <p role="status" className="pop-in flex items-center gap-1.5 text-sm font-medium text-stable">
              <Icon name="check_circle" filled className="text-[18px]" />
              {tr(`${saved} prescribed.`, `${saved} likh di gayi.`)}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!complete || busy} loading={busy} onClick={() => void submit()}>
              <Icon name="prescriptions" className="text-[20px]" />
              {busy ? tr("Saving…", "Save ho raha hai…") : tr("Prescribe", "Nuskha likhein")}
            </Button>
            {!startOpen && (
              <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
                {tr("Cancel", "Cancel")}
              </Button>
            )}
          </div>
        </div>
      </Expand>
    </Card>
  );
}
