"use client";

/**
 * Every invoice in the hospital, as the Billing page's table.
 *
 * The patient's and the doctor's billing pages keep `InvoicesPanel`, which
 * opens a bill in place. Here the ledger is long and scanned rather than read,
 * so it is a dense table with tabs and search, and a bill opens in a drawer
 * where the counter's controls live.
 */

import { useState } from "react";

import { Icon } from "@/components/Icon";
import { Pager, StatusPill, consoleDay, consoleMoney } from "@/components/admin/console";
import { STATUS_LABEL, STATUS_TONE } from "@/components/billing";
import { Segmented } from "@/components/forms";
import { EmptyState, ErrorState, SkeletonRows, cx } from "@/components/ui";
import { invoices, type Invoice, type InvoiceStatus } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { PAGE_REFRESH_MS, useAsync } from "@/lib/useAsync";

type Tab = InvoiceStatus | "ALL";

/** Twenty to a page. */
const PAGE = 20;

export function AdminInvoices({ refresh, onOpen }: { refresh: number; onOpen: (invoice: Invoice) => void }) {
  const tr = useTr();
  const [tab, setTab] = useState<Tab>("ALL");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);

  const list = useAsync(
    () =>
      invoices.list({
        status: tab === "ALL" ? undefined : tab,
        search: search.trim() || undefined,
        limit: PAGE,
        offset,
      }),
    [tab, search, offset, refresh],
    { refreshMs: PAGE_REFRESH_MS },
  );
  // Counts for the tabs that are somebody's work; the records go uncounted.
  // "Waiting for approval" is worked out per bill, not stored, so it cannot be
  // asked for — the payments queue above the table is that list.
  const counts = useAsync(
    () =>
      Promise.all([invoices.list({ status: "ISSUED", limit: 1 }), invoices.list({ status: "OVERDUE", limit: 1 })]).then(
        ([due, overdue]) => ({ due: due.meta.total, overdue: overdue.meta.total }),
      ),
    [refresh],
  );
  const rows = list.data?.data ?? [];

  const tabs: Array<{ value: Tab; label: string; count?: number }> = [
    { value: "ALL", label: tr("All", "Sab") },
    { value: "ISSUED", label: tr("Due", "Wajib-ul-ada"), count: counts.data?.due },
    { value: "OVERDUE", label: tr("Overdue", "Muddat guzar gayi"), count: counts.data?.overdue },
    { value: "PAID", label: tr("Paid", "Ada shuda") },
    { value: "VOID", label: tr("Cancelled", "Mansookh") },
    { value: "REFUNDED", label: tr("Credited", "Wapas kiya gaya") },
  ];

  return (
    <section
      id="invoices"
      aria-label={tr("Invoices", "Invoices")}
      className="rise-in scroll-mt-24 overflow-hidden rounded-3xl border border-line bg-card shadow-card"
    >
      <div className="flex flex-wrap items-center gap-3 px-[18px] py-4">
        <Segmented
          options={tabs}
          value={tab}
          onChange={(next) => {
            setTab(next);
            setOffset(0);
          }}
          label={tr("Invoices to show", "Kaun se invoices")}
        />
        <label className="flex h-10 w-full items-center gap-2.5 rounded-full border border-line-strong bg-card pr-3 pl-3.5 text-muted focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary sm:ml-auto sm:w-auto sm:max-w-[300px] sm:min-w-[220px] sm:flex-1">
          <Icon name="search" className="text-[18px]" />
          <input
            type="search"
            aria-label={tr("Search invoices", "Invoices dhoondein")}
            placeholder={tr("Invoice number, patient or MRN", "Invoice number, mareez ya MRN")}
            value={search}
            maxLength={100}
            onChange={(event) => {
              setSearch(event.target.value);
              setOffset(0);
            }}
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-strong outline-none placeholder:text-muted"
          />
        </label>
      </div>

      {list.loading && !list.data && (
        <div role="status" aria-live="polite" className="px-[18px] pb-5">
          <span className="sr-only">{tr("Loading invoices", "Invoices load ho rahe hain")}…</span>
          <SkeletonRows rows={5} title={false} />
        </div>
      )}
      {list.error && (
        <div className="px-[18px] pb-5">
          <ErrorState message={list.error.message} onRetry={list.reload} />
        </div>
      )}
      {list.data && rows.length === 0 && (
        <EmptyState
          icon="receipt_long"
          title={search ? tr(`No invoice matches “${search}”`, `“${search}” se koi invoice nahi mila`) : tr("No invoices here", "Yahan koi invoice nahi")}
          description={tr(
            "An invoice is created automatically when a consultation is completed or a medicine order is paid.",
            "Consultation mukammal hone ya dawa ka order ada hone par invoice khud ban jaata hai.",
          )}
        />
      )}
      {rows.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="console-table min-w-[54rem]">
              <caption className="sr-only">{tr("All invoices", "Tamam invoices")}</caption>
              <thead>
                <tr>
                  <th scope="col">{tr("Invoice", "Invoice")}</th>
                  <th scope="col">{tr("Patient", "Mareez")}</th>
                  <th scope="col">{tr("Issued", "Jari hua")}</th>
                  <th scope="col">{tr("Due", "Aakhri tareekh")}</th>
                  <th scope="col">{tr("Status", "Haalat")}</th>
                  <th scope="col" className="text-right">
                    {tr("Total", "Kul")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((invoice) => {
                  const overdue = invoice.status === "OVERDUE";
                  const issued = invoice.issuedAt ?? invoice.createdAt;
                  return (
                    <tr key={invoice.id} onClick={() => onOpen(invoice)} className="cursor-pointer">
                      <td>
                        <span className="flex items-center gap-[11px]">
                          <span
                            aria-hidden
                            className={cx(
                              "grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[11px]",
                              overdue ? "bg-critical-soft text-critical" : "bg-sunken text-primary",
                            )}
                          >
                            <Icon
                              name={invoice.amendsInvoiceId ? "undo" : invoice.kind === "PHARMACY" ? "medication" : "receipt_long"}
                              className="text-[17px]"
                            />
                          </span>
                          <span className="flex flex-col gap-0.5">
                            {/* The row opens on a click anywhere; the number is how a keyboard gets there. */}
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                onOpen(invoice);
                              }}
                              className="rounded text-left font-mono text-[12.5px] font-semibold whitespace-nowrap text-strong hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                            >
                              {invoice.invoiceNumber}
                            </button>
                            {invoice.kind === "PHARMACY" && (
                              <span className="text-[11.5px] font-semibold text-info">{tr("Medicines", "Dawaiyan")}</span>
                            )}
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className="block font-semibold whitespace-nowrap">{invoice.patientName ?? "—"}</span>
                        {invoice.medicalRecordNumber && (
                          <span className="block font-mono text-[12px] text-muted">{invoice.medicalRecordNumber}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-muted tabular-nums">{issued ? consoleDay(issued) : "—"}</td>
                      <td className={cx("whitespace-nowrap tabular-nums", overdue ? "font-semibold text-critical" : "text-muted")}>
                        {invoice.dueAt
                          ? new Date(invoice.dueAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
                          : "—"}
                      </td>
                      <td>
                        <StatusPill dot tone={STATUS_TONE[invoice.status]}>
                          {tr(...STATUS_LABEL[invoice.status])}
                        </StatusPill>
                      </td>
                      <td className="text-right font-semibold whitespace-nowrap tabular-nums">
                        {consoleMoney(invoice.totalAmount, invoice.currency)}
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
  );
}
