"use client";

/**
 * Offers to install the app, because nothing else will.
 *
 * Everything a browser asks for is already here — manifest, service worker with
 * a fetch handler, icons at both sizes, HTTPS — so this application has been
 * installable since it was first deployed. Nobody could tell. Chrome removed
 * the automatic banner years ago, and what replaced it is an "Install app" line
 * buried in the overflow menu that visitors do not open. An installable app
 * that never says so is, in practice, not one.
 *
 * So the browser's own event is caught and answered with a visible offer.
 *
 * **iOS is a separate case and is handled separately.** Safari does not
 * implement `beforeinstallprompt` and never will fire it, so there is no event
 * to wait for and no programmatic install to trigger. The only route is Share →
 * Add to Home Screen, which the person has to do themselves — so on iOS this
 * shows the instruction rather than a button that could not work.
 *
 * **It asks once.** A dismissal is remembered, and an app already running from
 * the home screen never asks at all.
 */

import { useEffect, useState } from "react";

import { Icon } from "@/components/Icon";
import { Button, IconButton } from "@/components/ui";
import { useEnvironment } from "@/lib/env";
import { useTr } from "@/lib/lang";

/** Remembered so a "no" stays answered. */
const DISMISSED = "medinova:install-dismissed";

/** The event Chromium fires, which TypeScript's DOM library does not describe. */
interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Already installed: launched from the home screen rather than a tab. */
function running_standalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari's own flag, which predates the standard media query.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function is_ios(): boolean {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac; the touch points give it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** Already said no, on a previous visit. */
function refused_before(): boolean {
  try {
    return localStorage.getItem(DISMISSED) === "1";
  } catch {
    // Private browsing, or storage switched off. Asking again is the lesser
    // failure — worse would be never offering it to somebody who never said no.
    return false;
  }
}

export function InstallPrompt() {
  const tr = useTr();

  // Read during render rather than discovered in an effect: none of it can
  // change while the page is open, and the server's answer — offer nothing —
  // is the one that is safe to be wrong about for a frame.
  const welcome = useEnvironment(() => !running_standalone() && !refused_before(), false);
  const ios = useEnvironment(is_ios, false);

  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    const held = (raw: Event) => {
      // Without this the browser keeps its own timing and may show nothing.
      raw.preventDefault();
      setEvent(raw as InstallEvent);
    };
    // Fired when the install completes by any route, including the browser's
    // own menu. The offer has been taken; leaving it up would be an offer to do
    // something already done.
    const done = () => setClosed(true);

    window.addEventListener("beforeinstallprompt", held);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("beforeinstallprompt", held);
      window.removeEventListener("appinstalled", done);
    };
  }, []);

  const close = (remember: boolean) => {
    setClosed(true);
    if (!remember) return;
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      // Nothing to do. It will be offered again next visit.
    }
  };

  // On iOS there is no event to wait for — Safari does not implement one — so
  // the instruction is the whole offer. Everywhere else, the browser saying
  // "this is installable" is what brings the bar out.
  const gone = closed || !welcome || !(ios || event);

  const install = async () => {
    if (!event) return;
    await event.prompt();
    // Either way the offer is spent: the event can only be used once, so the
    // bar must go whatever they chose. A refusal is remembered; accepting is
    // not, because `appinstalled` handles that and a cancelled OS dialog
    // should not count as a permanent no.
    const { outcome } = await event.userChoice;
    setEvent(null);
    close(outcome === "dismissed");
  };

  if (gone) return null;

  return (
    <div
      role="dialog"
      aria-label={tr("Install MediNova AI", "MediNova AI install karein")}
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-2xl border border-line bg-card p-4 shadow-overlay sm:inset-x-auto sm:right-4"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="bg-gradient-soft grid h-10 w-10 shrink-0 place-items-center rounded-xl text-primary"
        >
          <Icon name="phone_iphone" className="text-[22px]" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {tr("Install MediNova AI", "MediNova AI install karein")}
          </p>
          <p className="mt-1 text-sm text-muted">
            {ios
              ? tr(
                  "Tap Share, then Add to Home Screen.",
                  "Share dabayein, phir Add to Home Screen chunein.",
                )
              : tr(
                  "Opens like an app, and reminders reach you without the browser.",
                  "App ki tarah khulta hai, aur reminders browser ke baghair aap tak pohanchte hain.",
                )}
          </p>

          {!ios && (
            <div className="mt-3 flex gap-2">
              <Button onClick={() => void install()}>
                <Icon name="download" className="text-[20px]" />
                {tr("Install", "Install karein")}
              </Button>
              <button
                type="button"
                onClick={() => close(true)}
                className="min-h-11 rounded-xl px-3 text-sm font-medium text-muted hover:text-primary"
              >
                {tr("Not now", "Abhi nahi")}
              </button>
            </div>
          )}
        </div>

        {/* On iOS this is the only control, because the install itself is a
            thing only the person can do from Safari's own menu. */}
        <IconButton
          icon="close"
          label={tr("Dismiss", "Band karein")}
          onClick={() => close(true)}
        />
      </div>
    </div>
  );
}
