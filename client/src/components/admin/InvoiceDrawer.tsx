"use client";

/**
 * One invoice, opened from the Billing table or from search.
 *
 * The whole bill, and — on the Billing page, where `onChanged` is given — the
 * counter's controls beneath it: record a payment, cancel an unpaid bill, or
 * issue a credit note. Each keeps its own confirmation, as it did on the row.
 * Printing keeps only the invoice; see `.invoice-print` in globals.css.
 */

import { AdminActions, InvoiceDetail, PrintHeader, STATUS_LABEL } from "@/components/billing";
import { Icon } from "@/components/Icon";
import { Drawer } from "@/components/overlays";
import { Button } from "@/components/ui";
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

export function InvoiceDrawer({
  invoice,
  onClose,
  onChanged,
}: {
  invoice: Invoice | null;
  onClose: () => void;
  /** Offers the counter's controls, and is told what they changed. */
  onChanged?: (next: Invoice) => void;
}) {
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
      footer={
        invoice ? (
          <Button variant="ghost" onClick={() => window.print()}>
            <Icon name="print" className="text-[18px]" />
            {tr("Print", "Print karein")}
          </Button>
        ) : undefined
      }
    >
      {invoice && (
        <div className="invoice-print">
          <PrintHeader invoice={invoice} />
          <InvoiceDetail invoice={invoice} />
          {onChanged && (
            <div className="no-print">
              <AdminActions invoice={invoice} onChanged={onChanged} />
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
