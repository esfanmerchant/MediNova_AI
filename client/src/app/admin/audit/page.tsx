"use client";

/**
 * The audit trail.
 *
 * Read-only by design, not by omission: there is no endpoint to add, edit or
 * remove an entry, because a log somebody can write to is a log somebody can
 * forge (R6).
 */

import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { ConsoleHeader } from "@/components/admin/console";
import { useTr } from "@/lib/lang";
import { AuditPanel } from "@/components/audit";

export default function AdminAudit() {
  const tr = useTr();
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
              <Icon name="lock" filled className="text-[15px]" />
              {tr("Sealed · append-only", "Mohr-band · sirf izafa")}
            </span>
          }
        >
          <p>
            {tr(
              "Every sensitive action, newest first. Nobody can edit or remove an entry, and opening this page is recorded too.",
              "Har hassas amal, naya pehle. Koi entry badal ya mita nahi sakta, aur yeh safha kholna bhi darj hota hai.",
            )}
          </p>
        </ConsoleHeader>

        <div className="mt-6">
          <AuditPanel />
        </div>
      </div>
    </AppShell>
  );
}
