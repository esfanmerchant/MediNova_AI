"use client";

/**
 * The hospital ledger.
 *
 * Administrators hold `invoice:read:any` and `invoice:manage`, so this is the
 * one place payments are recorded and corrections issued. The controls render
 * here because of the role, but the API re-checks every request (spec §34).
 */

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { AdminInvoices } from "@/components/admin/AdminInvoices";
import { ConsoleHeader, consoleMoney } from "@/components/admin/console";
import { InvoiceDrawer, INVOICE_HELD, peekHeldInvoice, takeHeldInvoice } from "@/components/admin/InvoiceDrawer";
import { BillingRates } from "@/components/BillingRates";
import { exportInvoicesCsv } from "@/components/billing";
import { PaymentQueue } from "@/components/PaymentQueue";
import { Drawer, useToast } from "@/components/overlays";
import { Button } from "@/components/ui";
import { ApiError, invoices, paymentReview, type Invoice } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { PAGE_REFRESH_MS, useAsync } from "@/lib/useAsync";

export default function AdminBilling() {
  const tr = useTr();
  const toast = useToast();
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((n) => n + 1), []);
  const [rates, setRates] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // One row is enough: the header wants the count, the queue below has the rows.
  const waiting = useAsync(() => paymentReview.pending({ limit: 1 }), [refresh], { refreshMs: PAGE_REFRESH_MS });
  const toConfirm = waiting.data?.meta.total ?? 0;
  // What is still owed on bills that are due, for the sentence.
  const due = useAsync(() => invoices.list({ status: "ISSUED", limit: 1 }), [refresh], { refreshMs: PAGE_REFRESH_MS });

  // An invoice opened from the table, or picked in search: held before this
  // page arrived, or while it was showing.
  const [opened, setOpened] = useState<Invoice | null>(() => peekHeldInvoice());
  useEffect(() => {
    takeHeldInvoice();
    const onHeld = () => setOpened(takeHeldInvoice());
    window.addEventListener(INVOICE_HELD, onHeld);
    return () => window.removeEventListener(INVOICE_HELD, onHeld);
  }, []);

  // The setup checklist links to #wallets: the settings drawer opens for it.
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash === "#wallets" || window.location.hash === "#rates") setRates(true);
    };
    const timer = window.setTimeout(onHash, 0);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  async function download() {
    setDownloading(true);
    try {
      const { saved, total } = await exportInvoicesCsv();
      toast.show({
        tone: "success",
        title: tr("Invoices saved", "Invoices save hogaye"),
        body:
          total > saved
            ? tr(`The most recent ${saved} of ${total}.`, `${total} mein se haaliya ${saved}.`)
            : tr(`${saved} invoice(s) in one file.`, `Ek file mein ${saved} invoice.`),
      });
    } catch (cause) {
      toast.show({
        tone: "critical",
        title: tr("Could not save the invoices", "Invoices save nahi ho sake"),
        body: cause instanceof ApiError ? cause.message : String(cause),
      });
    } finally {
      setDownloading(false);
    }
  }

  const dueCount = due.data?.meta.total ?? 0;
  const owed = due.data?.meta.outstanding;

  return (
    <AppShell role="ADMIN">
      <div id="main" className="space-y-[22px]">
        <ConsoleHeader
          mark="billing"
          eyebrow={tr("Invoices, payments and rates", "Invoices, adaigiyan aur rates")}
          title={tr("Billing", "Billing")}
          actions={
            <>
              <Button variant="ghost" loading={downloading} onClick={() => void download()}>
                <Icon name="download" className="text-[18px]" />
                {tr("Download CSV", "CSV download")}
              </Button>
              <Button variant="secondary" onClick={() => setRates(true)}>
                <Icon name="settings" className="text-[18px]" />
                {tr("Rates and wallets", "Rates aur wallets")}
              </Button>
            </>
          }
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
            {owed !== undefined && dueCount > 0 && (
              <>
                <b>{consoleMoney(owed)}</b>{" "}
                {tr(
                  `is still owed on ${dueCount} ${dueCount === 1 ? "invoice" : "invoices"}, and an issued invoice is never edited.`,
                  `${dueCount} invoices par abhi baqi hai, aur jari shuda invoice kabhi badla nahi jaata.`,
                )}
              </>
            )}
            {owed !== undefined && dueCount === 0 &&
              tr(
                "Every invoice in the hospital is here, and an issued one is never edited.",
                "Hospital ka har invoice yahan hai, aur jari shuda kabhi badla nahi jaata.",
              )}
          </p>
        </ConsoleHeader>

        {/* Payments waiting on somebody come first: it is the only thing on
            this page that is *work*. Shown only while there is some. */}
        {toConfirm > 0 && (
          <div id="to-confirm" className="scroll-mt-24">
            <PaymentQueue />
          </div>
        )}

        <AdminInvoices refresh={refresh} onOpen={setOpened} />

        <InvoiceDrawer
          invoice={opened}
          onClose={() => setOpened(null)}
          onChanged={(next) => {
            setOpened(next);
            reload();
          }}
        />

        {/* The settings that shape every new bill, out of the ledger's way. */}
        <Drawer
          open={rates}
          onClose={() => setRates(false)}
          title={tr("Rates and wallets", "Rates aur wallets")}
          width={560}
        >
          <BillingRates />
        </Drawer>
      </div>
    </AppShell>
  );
}
