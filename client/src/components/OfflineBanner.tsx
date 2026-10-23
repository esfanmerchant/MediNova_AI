"use client";

/**
 * Says so when the connection drops, under the header, until it comes back.
 *
 * What is on screen stays — it was loaded before — but nothing can be saved,
 * and the app does not queue changes to send later, so the banner says that
 * plainly rather than promising otherwise. It names the time the connection
 * went, so a figure on screen can be read for how old it is.
 */

import { useEffect, useState, useSyncExternalStore } from "react";

import { Icon } from "@/components/Icon";
import { useTr } from "@/lib/lang";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function OfflineBanner() {
  const tr = useTr();
  // The server render and the first client render both say "online", so the
  // banner can only ever appear after hydration, never cause a mismatch.
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  const [since, setSince] = useState<Date | null>(null);
  useEffect(() => {
    const onOffline = () => setSince(new Date());
    window.addEventListener("offline", onOffline);
    return () => window.removeEventListener("offline", onOffline);
  }, []);

  if (online) return null;
  const at = since?.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  return (
    <div role="status" className="flex items-center gap-2.5 border-b border-warning/40 bg-warning-soft px-4 py-2 text-[13px] text-strong sm:px-6">
      <Icon name="cloud_off" className="shrink-0 text-[18px] text-warning" />
      <span>
        <b className="font-semibold">{tr("You are offline.", "Aap offline hain.")}</b>{" "}
        {at
          ? tr(`What is on screen was loaded before ${at}.`, `Screen par jo hai woh ${at} se pehle load hua tha.`)
          : tr("What is on screen was loaded earlier.", "Screen par jo hai woh pehle load hua tha.")}{" "}
        {tr("Nothing can be saved until the connection is back.", "Connection wapas aane tak kuchh save nahi ho sakta.")}
      </span>
    </div>
  );
}
