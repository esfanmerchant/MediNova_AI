"use client";

/**
 * Break-glass access (requirement R3).
 *
 * The interface has one unusual job: it has to make a clinician comfortable
 * using this in a genuine emergency, and uncomfortable using it otherwise. Both
 * halves matter. A screen that feels like a violation to open will not be used
 * when someone is dying; one that feels like an ordinary button will be used to
 * read a colleague's chart.
 *
 * So the request form is short, obvious and fast — and it states plainly, before
 * submission rather than after, exactly what will be recorded and who will be
 * told. Nothing is hidden and nothing is dressed up.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { Icon } from "@/components/Icon";
import { FinishedState, LiveDot, StatusPill, consoleStamp } from "@/components/admin/console";
import { Segmented } from "@/components/forms";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  SkeletonRows,
  Textarea,
  cx,
} from "@/components/ui";
import {
  ApiError,
  emergency as emergencyApi,
  type EmergencyGrant,
  type GrantedAccess,
} from "@/lib/api";
import { useTr } from "@/lib/lang";
import { useAsync } from "@/lib/useAsync";

function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof ApiError ? caught.message : fallback;
}

/** Server-side minimum. Mirrored so the button explains itself before a 422. */
const MIN_REASON = 15;

function minutesLeft(iso: string): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
}

/** The expanding-panel motion shared by every disclosure on this screen. */
const EXPAND = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto", opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
};

/**
 * What is about to be recorded, shown before the request rather than after.
 *
 * Consent theatre would be a checkbox. This is the actual list, because a
 * clinician who knows exactly what the trail will say is the one this control
 * is designed for.
 */
function WhatHappensNotice() {
  const tr = useTr();
  const points: Array<[string, React.ReactNode]> = [
    [
      "person_search",
      <>
        {tr("You get access to", "Aap ko rasai milti hai sirf")}{" "}
        <strong>{tr("this patient only", "isi ek mareez ki")}</strong>
        {tr(", not to any other record.", " — kisi aur record ki nahi.")}
      </>,
    ],
    ["timer", tr("It expires automatically, and you can hand it back at any time.", "Yeh khud khatam ho jaati hai, aur aap jab chahein wapas kar sakte hain.")],
    ["history", tr("Your reason is stored, and every record you open is counted and logged.", "Aap ki wajah mehfooz hoti hai, aur jo record kholein woh gina aur darj hota hai.")],
    ["notifications_active", tr("The patient is told their record was opened this way.", "Mareez ko bataya jaata hai ke unka record is tarah khola gaya.")],
    ["fact_check", tr("An administrator reviews it afterwards.", "Baad mein administrator iska jaiza leta hai.")],
  ];

  return (
    <div className="rounded-2xl border border-warning/40 bg-warning-soft p-5 text-sm">
      <p className="flex items-center gap-2 font-display font-bold text-warning">
        <Icon name="gavel" filled className="text-[20px]" />
        {tr("What happens when you do this", "Aisa karne par kya hota hai")}
      </p>
      <ul className="mt-3 space-y-2 text-warning">
        {points.map(([icon, text], index) => (
          <li key={index} className="flex items-start gap-2.5">
            <Icon name={icon} className="mt-px shrink-0 text-[18px] opacity-80" />
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Access the clinician holds right now. Pinned and pulsing, because an open
 * grant is something to act on — hand it back — rather than something to
 * admire.
 */
function GrantCard({ grant, onRevoked }: { grant: EmergencyGrant; onRevoked: () => void }) {
  const tr = useTr();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoke = async () => {
    setBusy(true);
    setError(null);
    try {
      await emergencyApi.revoke(grant.id);
      onRevoked();
    } catch (caught) {
      setError(messageOf(caught, "Could not end the access."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="edge-pulse pop-in flex flex-wrap items-start gap-4 rounded-2xl border border-critical/40 bg-critical-soft p-5 pl-6">
      <span
        aria-hidden
        className="animate-breathe grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-card text-critical shadow-sm"
      >
        <Icon name="e911_emergency" filled className="text-[24px]" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="critical">
            <Icon name="lock_open" filled className="text-[14px]" />
            {tr("Access open", "Rasai khuli hai")}
          </Badge>
          <span className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-0.5 text-xs font-semibold tabular-nums text-strong shadow-sm">
            <Icon name="timer" className="text-[14px] text-critical" />
            {tr("expires in", "khatam hogi")} {minutesLeft(grant.expiresAt)} {tr("min", "min mein")}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-0.5 text-xs font-semibold tabular-nums text-strong shadow-sm">
            <Icon name="visibility" className="text-[14px] text-faint" />
            {grant.accessCount}{" "}
            {tr(`record${grant.accessCount === 1 ? "" : "s"} opened`, "record khole gaye")}
          </span>
          <span className="ml-auto text-xs tabular-nums text-muted">
            {grant.patientMrn ? tr("record", "record") : tr("patient", "mareez")} {grant.patientMrn ?? grant.patientId}
          </span>
        </div>

        <p className="mt-2 text-sm text-strong">{grant.reason}</p>

        {error && (
          <p role="alert" className="mt-2 text-sm font-medium text-critical">
            {error}
          </p>
        )}
      </div>

      <Button
        variant="primary"
        className="w-full sm:w-auto"
        disabled={busy}
        loading={busy}
        onClick={() => void revoke()}
      >
        <Icon name="lock" className="text-[20px]" />
        {busy ? tr("Ending…", "Khatam ho rahi hai…") : tr("I am finished — end access", "Kaam ho gaya — rasai khatam karein")}
      </Button>
    </li>
  );
}

/** Request break-glass access, and manage what is currently open. */
export function EmergencyAccessPanel() {
  const tr = useTr();
  const active = useAsync(() => emergencyApi.active(), []);
  const [patientId, setPatientId] = useState("");
  const [reason, setReason] = useState("");
  const [granted, setGranted] = useState<GrantedAccess | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await emergencyApi.request({
        patientId: patientId.trim(),
        reason: reason.trim(),
      });
      setGranted(result);
      setPatientId("");
      setReason("");
      active.reload();
    } catch (caught) {
      setError(messageOf(caught, "Could not grant emergency access."));
    } finally {
      setBusy(false);
    }
  };

  const ready = patientId.trim().length > 0 && reason.trim().length >= MIN_REASON;
  const remaining = Math.max(0, MIN_REASON - reason.trim().length);
  const held = active.data ?? [];

  return (
    <div className="space-y-6">
      <Card
        icon="e911_emergency"
        title={tr("Emergency access", "Emergency access")}
        description={tr(
          "For a patient you are treating right now who you are not otherwise authorised to see.",
          "Us mareez ke liye jiska aap abhi ilaaj kar rahe hain magar jise dekhne ki aam ijazat aap ke paas nahi.",
        )}
      >
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <WhatHappensNotice />

          <Field
            label={tr("Patient identifier", "Mareez ki shanakht")}
            htmlFor="emergency-patient"
            hint={tr(
              "The patient's record number or id, from their wristband or the ward list.",
              "Mareez ka record number ya id — wristband ya ward list se.",
            )}
          >
            <Input
              id="emergency-patient"
              value={patientId}
              maxLength={64}
              disabled={busy}
              onChange={(event) => setPatientId(event.target.value)}
            />
          </Field>

          <Field
            label={tr("Why do you need access?", "Aap ko rasai kyun chahiye?")}
            htmlFor="emergency-reason"
            hint={
              reason.trim().length < MIN_REASON
                ? tr(
                    `A sentence, not a word — at least ${MIN_REASON} characters. This is stored and reviewed.`,
                    `Ek jumla likhein, sirf lafz nahi — kam az kam ${MIN_REASON} huroof. Yeh mehfooz hota hai aur iska jaiza hota hai.`,
                  )
                : tr(
                    "This is stored on the record and reviewed by an administrator.",
                    "Yeh record par mehfooz hota hai aur administrator iska jaiza leta hai.",
                  )
            }
          >
            <Textarea
              id="emergency-reason"
              rows={3}
              maxLength={1000}
              value={reason}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>

          {/* A quiet progress line: the reason filling up towards the minimum. */}
          <div aria-hidden className="-mt-2 flex items-center gap-3 px-1">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
              <span
                className={cx(
                  "block h-full rounded-full transition-[width,background-color] duration-300 ease-out",
                  remaining === 0 ? "bg-stable" : "bg-gradient-brand",
                )}
                style={{ width: `${Math.min(100, (reason.trim().length / MIN_REASON) * 100)}%` }}
              />
            </span>
            <span className="text-xs tabular-nums text-faint">
              {remaining === 0
                ? tr("Long enough", "Kaafi hai")
                : `${remaining} ${tr("more", "aur")}`}
            </span>
          </div>

          {error && <ErrorState message={error} />}

          <AnimatePresence initial={false}>
            {granted && (
              <motion.div key="granted" {...EXPAND} className="overflow-hidden">
                <div
                  role="status"
                  className="flex items-start gap-4 rounded-2xl border border-accent/40 bg-accent-soft p-5"
                >
                  <span
                    aria-hidden
                    className="pop-scale grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-card text-accent shadow-sm"
                  >
                    <Icon name="verified_user" filled className="text-[24px]" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-display font-bold text-primary">
                      {granted.created
                        ? tr("Access granted", "Rasai mil gayi")
                        : tr("You already had access to this patient", "Is mareez ki rasai aap ke paas pehle se thi")}
                    </p>
                    <p className="mt-1 text-sm text-primary">{granted.notice}</p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Not styled as a danger button. This is a legitimate clinical
              action, and making it look like a mistake discourages the very
              use it exists for. */}
          <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={busy || !ready} loading={busy}>
            <Icon name="e911_emergency" className="text-[22px]" />
            {busy ? tr("Requesting…", "Darkhwast ja rahi hai…") : tr("Request emergency access", "Emergency access ki darkhwast karein")}
          </Button>
        </form>
      </Card>

      <Card
        icon="key"
        title={tr("Access you currently hold", "Aap ke paas is waqt jo rasai hai")}
        description={tr("Hand it back as soon as you are done.", "Kaam khatam hote hi wapas kar dein.")}
        action={
          held.length > 0 ? (
            <Badge tone="critical">
              <span className="pulse-dot h-2 w-2 rounded-full bg-critical" />
              {held.length} {tr("open", "khuli")}
            </Badge>
          ) : undefined
        }
      >
        {active.loading && (
          <div role="status" aria-live="polite">
            <span className="sr-only">{tr("Checking your access", "Rasai check ho rahi hai")}…</span>
            <SkeletonRows rows={1} title={false} />
          </div>
        )}
        {active.error && <ErrorState message={active.error.message} onRetry={active.reload} />}

        {!active.loading && !active.error && held.length === 0 && (
          <EmptyState
            icon="lock"
            title={tr("No open access", "Koi khuli rasai nahi")}
            description={tr(
              "You are not currently holding emergency access to any record.",
              "Is waqt aap ke paas kisi record ki emergency rasai nahi hai.",
            )}
          />
        )}

        {held.length > 0 && (
          <ul className="space-y-3">
            {held.map((grant) => (
              <GrantCard key={grant.id} grant={grant} onRevoked={active.reload} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Administrative review
// ---------------------------------------------------------------------------

function ReviewRow({ grant, onReviewed }: { grant: EmergencyGrant; onReviewed: (next: EmergencyGrant) => void }) {
  const tr = useTr();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onReviewed(await emergencyApi.review(grant.id, notes.trim()));
      setOpen(false);
      setNotes("");
    } catch (caught) {
      setError(messageOf(caught, "Could not record the review."));
    } finally {
      setBusy(false);
    }
  };

  const reviewed = Boolean(grant.reviewedAt);
  const requester = grant.requesterName ?? tr("(deleted account)", "(hazf shuda account)");
  const initials = (grant.requesterName ?? "?")
    .replace(/^Dr\.?\s+/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <li
      id={`review-${grant.id}`}
      className={cx(
        "flex scroll-mt-24 flex-wrap items-start gap-3.5 border-t border-line px-[18px] py-4",
        !reviewed && "bg-warning-soft/45",
      )}
    >
      <span
        aria-hidden
        className={cx(
          "grid h-10 w-10 shrink-0 place-items-center rounded-full text-[13px] font-bold",
          reviewed ? "bg-sunken text-muted" : "bg-warning-soft text-warning",
        )}
      >
        {initials || "?"}
      </span>

      <div className="flex min-w-[16rem] flex-[1_1_24rem] flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-strong">{requester}</span>
          <StatusPill dot tone={grant.live ? "critical" : "neutral"}>
            {grant.live ? tr("Still open", "Abhi khuli hai") : tr("Ended", "Khatam")}
          </StatusPill>
          <StatusPill tone={reviewed ? "good" : "warning"}>
            {reviewed ? tr("Reviewed", "Jaiza ho gaya") : tr("Awaiting review", "Jaiza baqi hai")}
          </StatusPill>
          <span className="ml-auto text-[12.5px] text-muted tabular-nums">{consoleStamp(grant.grantedAt)}</span>
        </div>

        <p className="text-sm text-strong">
          “<span>{grant.reason}</span>”
        </p>

        <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
          {/* The count is the first thing a reviewer should weigh: one read and
              ninety reads are very different events. */}
          <span
            className={cx(
              "rounded-[7px] px-[7px] py-px font-display font-bold tabular-nums",
              grant.accessCount >= 20 ? "bg-critical-soft text-critical" : "bg-sunken text-strong",
            )}
          >
            {grant.accessCount}
          </span>
          {tr(`record${grant.accessCount === 1 ? "" : "s"} opened`, "record khole gaye")} ·{" "}
          {grant.patientMrn ? tr("record", "record") : tr("patient", "mareez")}{" "}
          {/* The record number a person can look up; the internal id only
              when the API did not send one. */}
          <span className="font-mono tabular-nums">{grant.patientMrn ?? grant.patientId}</span>
        </p>

        {reviewed && grant.reviewNotes && (
          <p className="rounded-xl bg-sunken/70 px-3 py-2.5 text-[13px] text-muted">{grant.reviewNotes}</p>
        )}

        {error && <ErrorState message={error} />}

        {!reviewed && (
          <AnimatePresence initial={false}>
            {open && (
              <motion.div key="form" {...EXPAND} className="overflow-hidden">
                <div className="mt-2 space-y-3 rounded-2xl border border-line bg-card p-4">
                  <Field
                    label={tr("Review notes", "Jaize ke notes")}
                    htmlFor={`review-notes-${grant.id}`}
                    hint={tr(
                      "What you checked, and whether the access was appropriate.",
                      "Aap ne kya jaancha, aur kya yeh rasai munasib thi.",
                    )}
                  >
                    <Input
                      id={`review-notes-${grant.id}`}
                      value={notes}
                      maxLength={2000}
                      autoFocus
                      onChange={(event) => setNotes(event.target.value)}
                    />
                  </Field>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="ghost" onClick={() => setOpen(false)}>
                      {tr("Cancel", "Mansookh")}
                    </Button>
                    <Button disabled={busy || notes.trim().length < 3} onClick={() => void submit()}>
                      {busy ? tr("Saving…", "Save ho raha hai…") : tr("Save review", "Jaiza save karein")}
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>

      {!reviewed && !open && (
        <Button size="sm" className="self-center" onClick={() => setOpen(true)}>
          {tr("Record review", "Jaiza darj karein")}
        </Button>
      )}
    </li>
  );
}

/**
 * A grant that is open right now, said at the top of the review queue in red:
 * who holds it, on which record, why, and how long it has left. An
 * administrator may end it — the API allows the holder or a reviewer to — and
 * is asked once more first, because the clinician loses access mid-shift.
 */
function LiveGrant({ grant, onEnded }: { grant: EmergencyGrant; onEnded: (next: EmergencyGrant) => void }) {
  const tr = useTr();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A clock of its own, so the ring and the minutes run down while the page
  // is open rather than standing at whatever they were when it loaded.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const total = Math.max(1, new Date(grant.expiresAt).getTime() - new Date(grant.grantedAt).getTime());
  const left = Math.max(0, new Date(grant.expiresAt).getTime() - now);
  const minutes = Math.round(left / 60_000);

  const end = async () => {
    setBusy(true);
    setError(null);
    try {
      onEnded(await emergencyApi.revoke(grant.id));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : tr("Could not end the access.", "Access khatam nahi ho saki."));
      setBusy(false);
    }
  };

  return (
    <section
      aria-label={tr("Emergency access open now", "Abhi khuli emergency access")}
      className="rise-in flex flex-col gap-4 rounded-[26px] bg-[linear-gradient(140deg,#3B0A12,#6A1420_55%,#8A1E2B)] px-5 py-[22px] text-[#FDE8EA] shadow-[0_30px_60px_-32px_rgba(106,20,32,0.8)] sm:px-6"
    >
      <div className="flex flex-col gap-1.5">
        <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] text-[#FFB4B8] uppercase">
          <LiveDot tone="red" />
          {tr("Open now", "Abhi khuli")}
        </p>
        <p className="font-display text-lg leading-snug font-bold text-white sm:text-xl">
          {tr(
            `${grant.requesterName ?? "A deleted account"} has emergency access to record ${grant.patientMrn ?? grant.patientId}`,
            `${grant.requesterName ?? "Hataya gaya account"} ke paas record ${grant.patientMrn ?? grant.patientId} ki emergency access hai`,
          )}
        </p>
        <p className="text-sm text-[#F7C9CD]">“{grant.reason}”</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/[0.08] px-3.5 py-2.5">
        <svg aria-hidden viewBox="0 0 40 40" className="h-9 w-9 shrink-0 -rotate-90">
          <circle cx="20" cy="20" r="15" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="5" />
          <circle
            cx="20"
            cy="20"
            r="15"
            fill="none"
            stroke="#FFB4B8"
            strokeWidth="5"
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={`${left / total} 1`}
          />
        </svg>
        <span className="flex-1 text-[13.5px] font-semibold">
          {tr(
            `${minutes} min left · ${grant.accessCount} ${grant.accessCount === 1 ? "record" : "records"} opened so far`,
            `${minutes} min baqi · ab tak ${grant.accessCount} record khole gaye`,
          )}
        </span>
        {confirming ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[13px]">{tr("They lose access at once.", "Un ki access foran khatam hogi.")}</span>
            <Button variant="danger" loading={busy} onClick={() => void end()}>
              {tr("End it now", "Abhi khatam karein")}
            </Button>
            <Button variant="ghost" className="!text-white hover:!bg-white/10" onClick={() => setConfirming(false)}>
              {tr("Keep it open", "Khuli rehne dein")}
            </Button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="min-h-10 rounded-full border border-white/35 px-[18px] text-[13.5px] font-semibold text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
          >
            {tr("End access now", "Access abhi khatam karein")}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm font-semibold text-white">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * The compliance review queue.
 *
 * One red banner for a grant that is open now, then one list. The outstanding
 * count is on the tab and in the page's sentence, not in a second box: the
 * control this design rests on is that somebody reads every one of these, and
 * saying the number once, where it is acted on, is enough.
 */
export function EmergencyReviewPanel() {
  const tr = useTr();
  const fetched = useAsync(() => emergencyApi.list({ limit: 50 }), []);
  const [reviewed, setReviewed] = useState<Record<string, EmergencyGrant>>({});
  // Opens on what waits; with nothing waiting, on the record of every grant.
  const [chosen, setTab] = useState<"waiting" | "all" | null>(null);

  const rows = (fetched.data?.data ?? []).map((grant) => reviewed[grant.id] ?? grant);
  const live = rows.filter((grant) => grant.live && grant.status === "ACTIVE");
  const waiting = rows.filter((grant) => !grant.reviewedAt);
  const tab = chosen ?? (waiting.length > 0 ? "waiting" : "all");
  const shown = tab === "waiting" ? waiting : rows;
  const record = (next: EmergencyGrant) => setReviewed((current) => ({ ...current, [next.id]: next }));

  return (
    <div className="flex flex-col gap-6">
      {live.map((grant) => (
        <LiveGrant key={grant.id} grant={grant} onEnded={record} />
      ))}

      <section
        id="grants"
        aria-label={tr("Grants", "Grants")}
        className="rise-in scroll-mt-24 overflow-hidden rounded-3xl border border-line bg-card shadow-card"
      >
        <div className="flex flex-wrap items-center gap-3 px-[18px] py-4">
          <Segmented
            options={[
              { value: "waiting" as const, label: tr("Awaiting review", "Jaiza baqi"), count: fetched.data ? waiting.length : undefined },
              { value: "all" as const, label: tr("All", "Sab") },
            ]}
            value={tab}
            onChange={setTab}
            label={tr("Grants to show", "Kaun se grants")}
          />
          <span className="text-[13px] text-muted sm:ml-auto">
            {tr("Each review is sealed into the audit trail.", "Har jaiza audit trail mein mohar band hota hai.")}
          </span>
        </div>

        {fetched.loading && (
          <div role="status" aria-live="polite" className="px-[18px] pb-5">
            <span className="sr-only">{tr("Loading emergency access", "Emergency access load ho raha hai")}…</span>
            <SkeletonRows rows={3} title={false} />
          </div>
        )}
        {fetched.error && (
          <div className="px-[18px] pb-5">
            <ErrorState message={fetched.error.message} onRetry={fetched.reload} />
          </div>
        )}

        {!fetched.loading && !fetched.error && rows.length === 0 && (
          <FinishedState
            art="shield"
            size={130}
            title={tr("No emergency access has been used", "Ab tak koi emergency access istemal nahi hui")}
            description={tr(
              "Break-glass grants appear here as soon as they are issued.",
              "Emergency grants jari hote hi yahan nazar aate hain.",
            )}
          />
        )}
        {!fetched.loading && !fetched.error && rows.length > 0 && shown.length === 0 && (
          <FinishedState
            title={tr("Every grant has been reviewed", "Har grant ka jaiza ho chuka")}
            description={tr("Each decision is sealed in the audit trail.", "Har faisla audit trail mein mohar band hai.")}
            action={
              <Button variant="secondary" onClick={() => setTab("all")}>
                {tr("Show every grant", "Har grant dikhayein")}
              </Button>
            }
          />
        )}

        {shown.length > 0 && (
          <ul className="stagger">
            {shown.map((grant) => (
              <ReviewRow key={grant.id} grant={grant} onReviewed={record} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
