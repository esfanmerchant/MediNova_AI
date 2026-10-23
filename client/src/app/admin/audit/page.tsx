"use client";

/**
 * The audit trail.
 *
 * Read-only by design, not by omission: there is no endpoint to add, edit or
 * remove an entry, because a log somebody can write to is a log somebody can
 * forge (R6).
 */

import { useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { ConsoleHeader } from "@/components/admin/console";
import { useTr } from "@/lib/lang";
import { AuditPanel, type AuditKind, type AuditSummary } from "@/components/audit";

export default function AdminAudit() {
  const tr = useTr();
  const [kind, setKind] = useState<AuditKind>("all");
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const count = (value: number) => new Intl.NumberFormat("en-PK").format(value);
  return (
    <AppShell role="ADMIN">
      <div id="main">
        <ConsoleHeader
          mark="audit"
          eyebrow={tr("Who saw what, and when", "Kis ne kya dekha, aur kab")}
          title={tr("Audit trail", "Audit trail")}
          actions={
            // The seal, said once for the whole trail rather than on every row.
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-stable-soft px-3.5 text-[13px] font-semibold text-stable">
              <Icon name="lock" className="text-[14px]" />
              {tr("Sealed · append-only", "Mohr-band · sirf izafa")}
            </span>
          }
        >
          <p>
            {summary?.total != null ? (
              <b>{tr(`${count(summary.total)} ${summary.total === 1 ? "entry" : "entries"}`, `${count(summary.total)} entries`)}</b>
            ) : (
              tr("Every sensitive action", "Har hassas amal")
            )}
            {tr(
              ", newest first. Nobody can edit or remove one, and opening this page is recorded too.",
              ", naya pehle. Koi entry badal ya mita nahi sakta, aur yeh safha kholna bhi darj hota hai.",
            )}
            {summary && summary.alertsThisWeek > 0 && (
              <>
                {" "}
                <a
                  href="#entries"
                  onClick={() => setKind("SECURITY")}
                >
                  {tr(
                    `${summary.alertsThisWeek} security ${summary.alertsThisWeek === 1 ? "event" : "events"}`,
                    `${summary.alertsThisWeek} security waqiat`,
                  )}
                </a>
                {tr(" this week.", " is hafte.")}
              </>
            )}
          </p>
        </ConsoleHeader>

        <div className="mt-[22px]">
          <AuditPanel kind={kind} onKind={setKind} onSummary={setSummary} />
        </div>
      </div>
    </AppShell>
  );
}
