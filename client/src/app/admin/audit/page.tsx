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
          icon="verified_user"
          eyebrow={tr("Who saw what, and when", "Kis ne kya dekha, aur kab")}
          title={tr("Audit trail", "Audit trail")}
          actions={
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-muted shadow-card">
              <Icon name="lock" filled className="text-[16px] text-accent" />
              {tr("Append-only", "Sirf izafa")}
            </span>
          }
        >
          <p>
            {tr(
              "Every sensitive action, in order. Nobody can edit or remove an entry, and opening this page is recorded too.",
              "Har hassas amal, tarteeb se. Koi entry badal ya mita nahi sakta, aur yeh safha kholna bhi darj hota hai.",
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
