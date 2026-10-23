"use client";

/**
 * The hospital ledger.
 *
 * Administrators hold `invoice:read:any` and `invoice:manage`, so this is the
 * one place payments are recorded and corrections issued. The controls render
 * here because of the role, but the API re-checks every request (spec §34).
 */

import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { ConsoleHeader } from "@/components/admin/console";
import {
  PageSectionNav,
  Section,
  type Section as SectionSpec,
} from "@/components/layout/PageSectionNav";
import { InvoiceDrawer, INVOICE_HELD, peekHeldInvoice, takeHeldInvoice } from "@/components/admin/InvoiceDrawer";
import { paymentReview, type Invoice } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { PAGE_REFRESH_MS, useAsync } from "@/lib/useAsync";
import { BillingRates } from "@/components/BillingRates";
import { PaymentAccount } from "@/components/PaymentAccount";
import { PaymentQueue } from "@/components/PaymentQueue";
import { InvoicesPanel } from "@/components/billing";

const SECTIONS: Array<SectionSpec & { words: [string, string] }> = [
  { id: "to-confirm", label: "", words: ["To confirm", "Tasdeeq baqi"], icon: "fact_check", badge: "warning" },
  { id: "rates", label: "", words: ["Rates", "Rates"], icon: "percent" },
  { id: "wallets", label: "", words: ["Wallets", "Wallets"], icon: "account_balance_wallet" },
  { id: "invoices", label: "", words: ["Invoices", "Invoices"], icon: "receipt_long" },
];

export default function AdminBilling() {
  const tr = useTr();
  // One row is enough: the header wants the count, the queue below has the rows.
  const waiting = useAsync(() => paymentReview.pending({ limit: 1 }), [], { refreshMs: PAGE_REFRESH_MS });
  const toConfirm = waiting.data?.meta.total ?? 0;

  // An invoice search picked: held before this page arrived, or while it was showing.
  const [opened, setOpened] = useState<Invoice | null>(() => peekHeldInvoice());
  useEffect(() => {
    takeHeldInvoice();
    const onHeld = () => setOpened(takeHeldInvoice());
    window.addEventListener(INVOICE_HELD, onHeld);
    return () => window.removeEventListener(INVOICE_HELD, onHeld);
  }, []);
  return (
    <AppShell role="ADMIN">
      <div id="main">
        <ConsoleHeader
          icon="receipt_long"
          eyebrow={tr("Invoices, payments and rates", "Invoices, adaigiyan aur rates")}
          title={tr("Billing", "Billing")}
        >
          <p>
            {toConfirm > 0 ? (
              <>
                <a href="#to-confirm">
                  {tr(
                    `${toConfirm} ${toConfirm === 1 ? "payment is" : "payments are"} waiting for you to confirm`,
                    `${toConfirm} adaigiyan aap ki tasdeeq ki muntazir`,
                  )}
                </a>
                .{" "}
              </>
            ) : (
              waiting.data && <>{tr("No payments are waiting to be confirmed. ", "Koi adaigi tasdeeq ki muntazir nahi. ")}</>
            )}
            {tr(
              "Every invoice in the hospital is here, and an issued one is never edited.",
              "Hospital ka har invoice yahan hai, aur jari shuda kabhi badla nahi jaata.",
            )}
          </p>
        </ConsoleHeader>

        {/* Payments waiting on somebody come first: it is the only thing on
            this page that is *work*, and the rest is reference. */}
        <PageSectionNav
              mode="jump"
              label={tr("Sections", "Hisse")}
              sections={SECTIONS.map(({ words, ...section }) => ({ ...section, label: tr(...words) }))}
            />

        <Section id="to-confirm">
<div className="mt-6">
          <PaymentQueue />
        </div>

        {/* Then the settings that shape what the ledger below will look like. */}
        
        </Section>

        <Section id="rates">
<div className="mt-6">
          <BillingRates />
        </div>

        
        </Section>

        <Section id="wallets">
<div className="mt-6">
          <PaymentAccount />
        </div>

        
        </Section>

        <Section id="invoices">
<div className="mt-6">
          <InvoicesPanel
            canManage
            title={tr("All invoices", "Tamam invoices")}
            description={tr(
              "Record payments, cancel unpaid invoices, and issue credit notes.",
              "Adaigi darj karein, ghair-ada invoices mansookh karein, aur credit notes banayein.",
            )}
          />
        </div>
        </Section>

        <InvoiceDrawer invoice={opened} onClose={() => setOpened(null)} />
      </div>
    </AppShell>
  );
}
