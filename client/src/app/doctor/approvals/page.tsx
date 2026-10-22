"use client";

/**
 * Requests from the doctor's own patients to approve prescription-only
 * medicine.
 *
 * Each request carries exactly what a safe decision needs and nothing else:
 * the medicines asked for, the patient's allergies and conditions, and what
 * they already take. The delivery address is the pharmacy's business and is
 * not shown.
 *
 * Declining needs a reason, because the patient reads it — "not suitable with
 * your current blood-pressure medicine, book a consultation" is the difference
 * between a refusal and a dead end.
 */

import Link from "next/link";
import { useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { Segmented } from "@/components/forms";
import { OrderStatusBadge, rupees } from "@/components/pharmacy/shared";
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Field, SkeletonRows, Textarea } from "@/components/ui";
import { ApiError, pharmacy, type ApprovalRequest } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { PAGE_REFRESH_MS, useAsync } from "@/lib/useAsync";

export default function MedicineApprovals() {
  const tr = useTr();
  const [view, setView] = useState<"pending" | "all">("pending");
  const list = useAsync(
    () => pharmacy.approvals({ pending: view === "pending", limit: 50 }),
    [view],
    { refreshMs: PAGE_REFRESH_MS },
  );
  const rows = list.data?.data ?? [];

  return (
    <AppShell role="DOCTOR">
      <div id="main" className="page-enter">
        <PageHeader
          eyebrow={tr("Doctor portal", "Doctor ka portal")}
          title={tr("Medicine approvals", "Dawa ki manzoori")}
          subtitle={tr(
            "Your patients asking to buy prescription-only medicine from the MediNova pharmacy.",
            "Aap ke mareez jo MediNova pharmacy se nuskhe wali dawa lena chahte hain.",
          )}
        />

        <div className="mt-6 space-y-6">
          <Segmented
            label={tr("Show", "Dikhayein")}
            value={view}
            onChange={setView}
            options={[
              { value: "pending", label: tr("Waiting for you", "Aap ka intezar"), icon: "pending_actions" },
              { value: "all", label: tr("All requests", "Tamam darkhwastein"), icon: "history" },
            ]}
          />

          {list.loading && !list.data ? (
            <SkeletonRows rows={3} />
          ) : list.error ? (
            <ErrorState message={list.error.message} onRetry={list.reload} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon="medication"
              title={view === "pending" ? tr("Nothing waiting", "Kuchh baqi nahi") : tr("No requests yet", "Abhi koi darkhwast nahi")}
              description={tr(
                "When a patient you treat asks you to approve a medicine, it appears here.",
                "Jab aap ka koi mareez dawa ki manzoori maange ga, yahan nazar aaye gi.",
              )}
            />
          ) : (
            rows.map((request) => <RequestCard key={request.id} request={request} onDone={list.reload} />)
          )}
        </div>
      </div>
    </AppShell>
  );
}

function RequestCard({ request, onDone }: { request: ApprovalRequest; onDone: () => void }) {
  const tr = useTr();
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"APPROVE" | "REJECT" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = request.status === "PENDING_RX" && request.rxStatus === "PENDING";

  const decide = async (decision: "APPROVE" | "REJECT") => {
    setBusy(decision);
    setError(null);
    try {
      await pharmacy.decide(request.id, decision, note.trim() || undefined);
      onDone();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : tr("Could not save your answer.", "Jawab mehfooz nahi ho saka."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start gap-4">
        <Avatar name={request.patient.name ?? "Patient"} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-bold text-strong">{request.patient.name}</p>
          <p className="text-sm tabular-nums text-muted">
            {request.orderNumber} ·{" "}
            {new Date(request.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        <OrderStatusBadge status={request.status} />
      </div>

      {request.patient.allergies ? (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-critical/40 border-l-4 border-l-critical bg-critical-soft px-3 py-2 text-sm font-medium text-critical">
          <Icon name="warning" filled className="mt-px shrink-0 text-[18px]" />
          {tr("Allergies:", "Allergy:")} {request.patient.allergies}
        </p>
      ) : (
        <p className="mt-4 text-sm text-muted">{tr("No allergies recorded.", "Koi allergy darj nahi.")}</p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <p className="mono-caps text-[0.68rem] text-faint">{tr("Asked for", "Maangi gayi")}</p>
          <ul className="mt-2 space-y-2">
            {request.items.map((item) => (
              <li key={item.id} className="flex items-start gap-2 text-sm">
                <Icon name="pill" className="mt-px shrink-0 text-[18px] text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-strong">
                    {[item.productName, item.strength].filter(Boolean).join(" ")}
                  </span>{" "}
                  <span className="text-muted">
                    × {item.quantity} · {item.genericName} · {item.packSize}
                  </span>
                </span>
                {item.rxRequired && !item.coveredByPrescription && <Badge tone="warning">Rx</Badge>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs tabular-nums text-faint">
            {tr("Order total", "Order ki raqam")} {rupees(request.total)}
          </p>
        </div>
        <div className="space-y-3 text-sm">
          <div>
            <p className="mono-caps text-[0.68rem] text-faint">{tr("Already taking", "Pehle se le rahe hain")}</p>
            {request.patient.currentMedications.length === 0 ? (
              <p className="mt-1 text-muted">{tr("Nothing active on MediNova.", "MediNova par koi jari dawa nahi.")}</p>
            ) : (
              <ul className="mt-1 list-inside list-disc text-strong">
                {request.patient.currentMedications.map((medicine) => (
                  <li key={medicine}>{medicine}</li>
                ))}
              </ul>
            )}
          </div>
          {request.patient.chronicConditions && (
            <p>
              <span className="font-semibold text-strong">{tr("Conditions:", "Bimariyan:")}</span>{" "}
              <span className="text-muted">{request.patient.chronicConditions}</span>
            </p>
          )}
          {request.patient.id && (
            <Link href={`/doctor/patients/${request.patient.id}`} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
              <Icon name="folder_shared" className="text-[16px]" />
              {tr("Open the chart", "Chart kholein")}
            </Link>
          )}
        </div>
      </div>

      {!pending ? (
        request.rxNote && (
          <p className="mt-4 rounded-xl bg-sunken px-3 py-2 text-sm text-muted">
            {tr("Your note:", "Aap ka note:")} {request.rxNote}
          </p>
        )
      ) : declining ? (
        <div className="mt-5 space-y-3 rounded-2xl border border-line bg-sunken/60 p-4">
          <Field
            label={tr("Why not? The patient reads this.", "Kyun nahi? Mareez yeh parhe ga.")}
            htmlFor={`decline-${request.id}`}
          >
            <Textarea
              id={`decline-${request.id}`}
              rows={2}
              maxLength={300}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={tr("e.g. Please book a consultation first — this needs a review.", "maslan Pehle consultation book karein — is ka jaiza zaroori hai.")}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" disabled={!note.trim()} loading={busy === "REJECT"} onClick={() => void decide("REJECT")}>
              {tr("Decline", "Inkaar karein")}
            </Button>
            <Button variant="ghost" onClick={() => setDeclining(false)}>
              {tr("Back", "Wapas")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap gap-2">
          <Button loading={busy === "APPROVE"} onClick={() => void decide("APPROVE")}>
            <Icon name="check" className="text-[20px]" />
            {tr("Approve", "Manzoor karein")}
          </Button>
          <Button variant="secondary" onClick={() => setDeclining(true)}>
            {tr("Decline…", "Inkaar…")}
          </Button>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm font-medium text-critical">{error}</p>}
    </Card>
  );
}
