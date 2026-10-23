"use client";

/**
 * The break-glass review queue.
 *
 * This is the control the whole emergency-access design rests on: access is
 * granted without approval, so what keeps it honest is that somebody reads
 * every grant afterwards.
 */

import { AppShell } from "@/components/AppShell";
import { ConsoleHeader } from "@/components/admin/console";
import { useTr } from "@/lib/lang";
import { EmergencyReviewPanel } from "@/components/emergency";

export default function AdminEmergency() {
  const tr = useTr();
  return (
    <AppShell role="ADMIN">
      <div id="main">
        <ConsoleHeader mark="emergency"
          icon="e911_emergency"
          eyebrow={tr("Break-glass, reviewed afterwards", "Break-glass, baad mein review")}
          title={tr("Emergency access", "Emergency access")}
        >
          <p>
            {tr(
              "Break-glass access is granted immediately — a clinician who cannot get in during an emergency is a clinician who starts sharing logins. Reviewing each grant afterwards is what makes that safe, so nothing here is closed until someone has read it.",
              "Emergency access foran milta hai — jo doctor waqt par andar na ja sake, woh login share karna shuru kar deta hai. Har grant ka baad mein review hi isay mehfooz banata hai, is liye jab tak koi parh na le, yahan kuchh band nahi hota.",
            )}
          </p>
        </ConsoleHeader>

        <div className="mt-6">
          <EmergencyReviewPanel />
        </div>
      </div>
    </AppShell>
  );
}
