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
import { EmergencyReviewPanel } from "@/components/emergency";
import { emergency } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { useAsync } from "@/lib/useAsync";

export default function AdminEmergency() {
  const tr = useTr();
  // One row is enough: the sentence wants the count, the list below has the rows.
  const waiting = useAsync(() => emergency.list({ unreviewedOnly: true, limit: 1 }), []);
  const unreviewed = waiting.data?.meta.unreviewed ?? waiting.data?.meta.total ?? 0;

  return (
    <AppShell role="ADMIN">
      <div id="main" className="space-y-6">
        <ConsoleHeader
          mark="emergency"
          eyebrow={tr("Break-glass, reviewed afterwards", "Break-glass, baad mein review")}
          title={tr("Emergency access", "Emergency access")}
        >
          <p>
            {unreviewed > 0 ? (
              <>
                <a href="#grants">
                  {tr(
                    `${unreviewed} ${unreviewed === 1 ? "grant has" : "grants have"} not been reviewed yet`,
                    `${unreviewed} grants ka jaiza abhi baqi hai`,
                  )}
                </a>
                .{" "}
              </>
            ) : (
              waiting.data && <>{tr("Every grant has been reviewed. ", "Har grant ka jaiza ho chuka. ")}</>
            )}
            {tr(
              "Access is granted at once, because a clinician locked out in an emergency starts sharing logins; reading every grant afterwards is what keeps it safe.",
              "Access foran milti hai, kyunke emergency mein bahar rehne wala doctor login share karne lagta hai; har grant ko baad mein parhna hi isay mehfooz rakhta hai.",
            )}
          </p>
        </ConsoleHeader>

        <EmergencyReviewPanel />
      </div>
    </AppShell>
  );
}
