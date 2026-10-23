"use client";

/**
 * One invoice, opened from search onto the Billing page.
 *
 * The ledger below already expands a row in place; this is for the invoice
 * search found, which may be pages back in that ledger. It shows the same
 * detail the row does, read-only — recording a payment or issuing a credit
 * note stays on the row, where its confirmations live.
 */

import { InvoiceDetail, STATUS_LABEL } from "@/components/billing";
import { Drawer } from "@/components/overlays";
import type { Invoice } from "@/lib/api";
import { useTr } from "@/lib/lang";

let held: Invoice | null = null;

/** Fired when an invoice is held, for a Billing page that is already showing. */
export const INVOICE_HELD = "medinova:invoice-held";

export function holdInvoice(invoice: Invoice) {
  held = invoice;
  window.dispatchEvent(new Event(INVOICE_HELD));
}

export function peekHeldInvoice(): Invoice | null {
  return held;
}

export function takeHeldInvoice(): Invoice | null {
  const invoice = held;
  held = null;
  return invoice;
}

export function InvoiceDrawer({ invoice, onClose }: { invoice: Invoice | null; onClose: () => void }) {
  const tr = useTr();
  return (
    <Drawer
      open={invoice !== null}
      onClose={onClose}
      title={invoice?.invoiceNumber ?? ""}
      description={
        invoice
          ? [invoice.patientName, invoice.medicalRecordNumber, tr(...STATUS_LABEL[invoice.status])].filter(Boolean).join(" · ")
          : undefined
      }
      width={600}
    >
      {invoice && <InvoiceDetail invoice={invoice} />}
    </Drawer>
  );
}
