"use client";

/**
 * The administrator's queue of doctors asking to join.
 *
 * Three tabs rather than one list with a filter, because the three are three
 * different jobs: pending is work, approved is a record, rejected is a record
 * with a reason attached. Each tab fetches its own status, so a queue of four
 * never has to carry a year of decisions behind it.
 *
 * A decided row leaves the pending tab the way it leaves the queue — it slides
 * out, rather than blinking away, so the reviewer sees which one they just
 * finished with.
 */

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { ConsoleHeader, FinishedState, StatusPill } from "@/components/admin/console";
import { Segmented } from "@/components/forms";
import { Button, EmptyState, ErrorState, SkeletonTable, cx } from "@/components/ui";
import {
  ApiError,
  doctorRequests,
  type ApplicationDocument,
  type ApplicationDocumentKind,
  type ApplicationStatus,
  type DoctorApplication,
} from "@/lib/api";
import { useTr } from "@/lib/lang";
import { QUEUE_REFRESH_MS } from "@/lib/useAsync";

import { ReviewDrawer } from "@/components/doctorApplication/ReviewDrawer";
import { useNow } from "@/components/doctorApplication/shared";

type Tab = "pending" | "approved" | "rejected";

const TAB_STATUS: Record<Tab, ApplicationStatus> = {
  pending: "SUBMITTED",
  approved: "APPROVED",
  rejected: "REJECTED",
};

const KINDS: Array<{ kind: ApplicationDocumentKind; icon: string; label: [string, string] }> = [
  { kind: "REGISTRATION_CERTIFICATE", icon: "description", label: ["Registration certificate", "Registration certificate"] },
  { kind: "DEGREE", icon: "star", label: ["Degree", "Degree"] },
  { kind: "NATIONAL_ID", icon: "key", label: ["National ID", "Shanakhti card"] },
  { kind: "PHOTO", icon: "group", label: ["Photo", "Tasveer"] },
];

const DAY_MS = 86_400_000;

function initialsOf(name: string): string {
  return (
    name
      .replace(/^Dr\.?\s+/i, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

/**
 * The four papers an application needs, one square each: green once an
 * administrator has checked it, grey while it waits, dashed while it is not
 * there at all — so a missing degree shows before the drawer is opened.
 */
function Documents({ documents }: { documents: ApplicationDocument[] }) {
  const tr = useTr();
  const states = KINDS.map(({ kind }) => {
    const mine = documents.filter((document) => document.kind === kind);
    return mine.length === 0 ? "missing" : mine.some((document) => document.verified) ? "checked" : "uploaded";
  });
  const missing = states.filter((state) => state === "missing").length;
  const toCheck = states.filter((state) => state === "uploaded").length;
  const note = missing
    ? tr(`${missing} missing`, `${missing} ghayab`)
    : toCheck
      ? tr(`${toCheck} to check`, `${toCheck} check karne hain`)
      : tr("All checked", "Sab check ho gaye");
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex gap-1">
        {KINDS.map(({ kind, icon, label }, index) => {
          const state = states[index];
          return (
            <span
              key={kind}
              title={`${tr(...label)} · ${
                state === "checked"
                  ? tr("checked", "check ho gaya")
                  : state === "uploaded"
                    ? tr("not checked yet", "abhi check nahi hua")
                    : tr("missing", "ghayab")
              }`}
              className={cx(
                "grid h-[26px] w-[26px] place-items-center rounded-lg",
                state === "checked" && "bg-stable-soft text-stable",
                state === "uploaded" && "bg-sunken text-primary",
                state === "missing" && "border-[1.5px] border-dashed border-line-strong text-faint",
              )}
            >
              <Icon name={icon} className="text-[15px]" />
            </span>
          );
        })}
      </span>
      <span className="text-[12.5px] whitespace-nowrap text-muted">{note}</span>
    </span>
  );
}

/** How long it has waited — amber from the second day — or when it was decided. */
function Age({ application }: { application: DoctorApplication }) {
  const tr = useTr();
  const now = useNow(true, 60_000);
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  if (application.status === "APPROVED" || application.status === "REJECTED") {
    const approved = application.status === "APPROVED";
    return (
      <StatusPill tone={approved ? "good" : "critical"}>
        {application.reviewedAt
          ? approved
            ? tr(`Approved ${day(application.reviewedAt)}`, `${day(application.reviewedAt)} ko manzoor`)
            : tr(`Rejected ${day(application.reviewedAt)}`, `${day(application.reviewedAt)} ko na-manzoor`)
          : approved
            ? tr("Approved", "Manzoor")
            : tr("Rejected", "Na-manzoor")}
      </StatusPill>
    );
  }
  if (!application.submittedAt) return <span className="text-faint">—</span>;
  const days = Math.floor((now - Date.parse(application.submittedAt)) / DAY_MS);
  return (
    <span title={new Date(application.submittedAt).toLocaleString("en-GB")}>
      <StatusPill tone={days >= 2 ? "warning" : "neutral"}>
        {days < 1
          ? tr("Sent today", "Aaj bheji")
          : tr(`Waiting ${days} ${days === 1 ? "day" : "days"}`, `${days} din se intezar`)}
      </StatusPill>
    </span>
  );
}

export default function DoctorRequestsPage() {
  const tr = useTr();
  const reduced = useReducedMotion();

  const [tab, setTab] = useState<Tab>("pending");
  const [nonce, setNonce] = useState(0);
  const [selected, setSelected] = useState<DoctorApplication | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  /**
   * One piece of state, stamped with the request that produced it.
   *
   * The stamp is what makes "loading" derivable rather than stored: while the
   * answer on hand belongs to a different tab, this tab is loading. Without it
   * the previous status's rows would sit under the new tab's heading for the
   * length of a request — approved doctors, shown as pending.
   */
  const requestKey = `${tab}:${nonce}`;
  const [answer, setAnswer] = useState<{
    key: string;
    rows: DoctorApplication[];
    pending: number | null;
    error: ApiError | null;
  } | null>(null);

  const fresh = answer?.key === requestKey ? answer : null;
  const loading = fresh === null;
  const rows = fresh?.error ? null : (fresh?.rows ?? null);
  const error = fresh?.error ?? null;
  const pending = fresh?.pending ?? null;

  useEffect(() => {
    let cancelled = false;
    const requested = `${tab}:${nonce}`;
    void doctorRequests
      .list({ status: TAB_STATUS[tab], limit: 100 })
      .then((result) => {
        if (cancelled) return;
        setAnswer({
          key: requested,
          rows: result.data,
          pending: result.meta.pending ?? null,
          error: null,
        });
      })
      .catch((caught: unknown) => {
        // A 401 is handled globally by the session provider; leaving this tab
        // on its skeleton is the honest state while the redirect happens.
        if (cancelled || (caught instanceof ApiError && caught.isAuthFailure)) return;
        setAnswer({
          key: requested,
          rows: [],
          pending: null,
          error:
            caught instanceof ApiError
              ? caught
              : new ApiError("INTERNAL_ERROR", "Something went wrong.", 500),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [tab, nonce]);

  /**
   * The queue keeps itself current, which is why there is no Refresh button.
   *
   * This deliberately does not bump the nonce. The nonce is part of the request
   * key, and the key is what makes "loading" derivable — bumping it every half
   * minute would blink the whole table back to a skeleton under a reviewer who
   * is reading a row. Instead the rows are replaced in place, and only when the
   * answer on hand still belongs to the tab that was asked about.
   */
  useEffect(() => {
    const ask = async () => {
      if (document.hidden) return;
      try {
        const result = await doctorRequests.list({ status: TAB_STATUS[tab], limit: 100 });
        setAnswer((current) =>
          current === null || !current.key.startsWith(`${tab}:`)
            ? current
            : {
                ...current,
                rows: result.data,
                pending: result.meta.pending ?? null,
                error: null,
              },
        );
      } catch {
        // Silent on purpose: what is already on screen is still the best answer
        // we have, and a failed background poll is not news.
      }
    };

    const timer = window.setInterval(() => void ask(), QUEUE_REFRESH_MS);
    const onVisibilityChange = () => {
      if (!document.hidden) void ask();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [tab]);

  const onDecided = useCallback((result: DoctorApplication) => {
    setAnswer((current) =>
      current === null
        ? current
        : {
            ...current,
            rows: current.rows.filter((row) => row.id !== result.id),
            // It has left the pending set, so the count on the tab must say so.
            pending:
              current.pending === null || !current.key.startsWith("pending:")
                ? current.pending
                : Math.max(0, current.pending - 1),
          },
    );
  }, []);

  const options: { value: Tab; label: string; count?: number }[] = [
    { value: "pending", label: tr("Pending", "Zer-e-ghaur"), count: pending ?? undefined },
    { value: "approved", label: tr("Approved", "Manzoor") },
    { value: "rejected", label: tr("Rejected", "Na-manzoor") },
  ];

  const empty: Record<Tab, { title: string; description: string; icon: string }> = {
    pending: {
      icon: "how_to_reg",
      title: tr("Nothing waiting", "Kuchh zer-e-ghaur nahi"),
      description: tr(
        "New doctor applications land here the moment they are sent.",
        "Doctors ki nayi darkhwastein bhejte hi yahan aa jati hain.",
      ),
    },
    approved: {
      icon: "verified",
      title: tr("No approved applications yet", "Abhi koi manzoor shuda darkhwast nahi"),
      description: tr(
        "Doctors you approve appear here with the date you approved them.",
        "Jin doctors ko aap manzoor karenge woh tareekh ke saath yahan aayenge.",
      ),
    },
    rejected: {
      icon: "block",
      title: tr("Nothing rejected", "Koi na-manzoor nahi"),
      description: tr(
        "Refused applications are kept here with the reason given.",
        "Na-manzoor darkhwastein wajah ke saath yahan mehfooz rehti hain.",
      ),
    },
  };

  return (
    <AppShell role="ADMIN">
      <div id="main" className="space-y-[22px]">
        <ConsoleHeader
          mark="requests"
          eyebrow={tr("Doctors who want to join", "Doctors jo shamil hona chahte hain")}
          title={tr("Doctor requests", "Doctors ki darkhwastein")}
        >
          <p>
            {pending !== null && pending > 0 ? (
              <>
                <a
                  href="#applications"
                  onClick={(event) => {
                    event.preventDefault();
                    setTab("pending");
                  }}
                >
                  {tr(
                    `${pending} ${pending === 1 ? "doctor is" : "doctors are"} waiting for a decision`,
                    `${pending} doctors faisle ke muntazir`,
                  )}
                </a>
                .{" "}
              </>
            ) : pending === 0 ? (
              <>{tr("Nobody is waiting for a decision. ", "Koi faisle ka muntazir nahi. ")}</>
            ) : null}
            {tr(
              "Check each applicant's registration and documents before their account opens.",
              "Account kholne se pehle har applicant ki registration aur documents check karein.",
            )}
          </p>
        </ConsoleHeader>

        <section
          id="applications"
          aria-label={tr("Applications", "Darkhwastein")}
          className="rise-in scroll-mt-24 overflow-hidden rounded-3xl border border-line bg-card shadow-card"
        >
          <div className="flex flex-wrap items-center gap-3 px-[18px] py-4">
            <Segmented
              options={options}
              value={tab}
              onChange={setTab}
              label={tr("Application status", "Darkhwast ki soorat-e-haal")}
            />
            <span className="text-[13px] text-muted sm:ml-auto">
              {tr("Oldest first · updates on its own", "Sab se purani pehle · khud update hoti hai")}
            </span>
          </div>

          {loading && <SkeletonTable rows={4} columns={5} />}

          {error && (
            <div className="px-[18px] pb-5">
              <ErrorState message={error.message} onRetry={() => setNonce((value) => value + 1)} />
            </div>
          )}

          {rows && rows.length === 0 && !error && tab === "pending" && (
            <FinishedState title={empty[tab].title} description={empty[tab].description} />
          )}
          {rows && rows.length === 0 && !error && tab !== "pending" && (
            <EmptyState icon={empty[tab].icon} title={empty[tab].title} description={empty[tab].description} />
          )}

          {rows && rows.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="console-table min-w-[56rem]">
                  <thead>
                    <tr>
                      <th scope="col">{tr("Applicant", "Applicant")}</th>
                      <th scope="col">{tr("Speciality", "Speciality")}</th>
                      <th scope="col">{tr("PMDC number", "PMDC number")}</th>
                      <th scope="col">{tr("Documents", "Documents")}</th>
                      <th scope="col">{tab === "pending" ? tr("Waiting", "Intezar") : tr("Decided", "Faisla")}</th>
                      <th scope="col" className="text-right">
                        <span className="sr-only">{tr("Review", "Jaiza")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <AnimatePresence initial={false}>
                      {rows.map((row) => {
                        const name = row.applicant?.name ?? row.fullName ?? "";
                        return (
                          <motion.tr
                            key={row.id}
                            layout={!reduced}
                            initial={false}
                            exit={reduced ? { opacity: 0 } : { opacity: 0, x: 48, transition: { duration: 0.28 } }}
                          >
                            <td>
                              <div className="flex min-w-0 items-center gap-[11px]">
                                <span
                                  aria-hidden
                                  className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-pastel-lilac text-[12px] font-bold text-pastel-ink"
                                >
                                  {initialsOf(name)}
                                </span>
                                <span className="min-w-0">
                                  <span className="block truncate font-semibold text-strong">
                                    {name || tr("Unnamed applicant", "Naam nahi diya")}
                                  </span>
                                  {row.applicant?.email && (
                                    <span className="block truncate text-[12.5px] text-muted">{row.applicant.email}</span>
                                  )}
                                </span>
                              </div>
                            </td>
                            <td>
                              {row.specialization ? (
                                <StatusPill tone="info">{row.specialization}</StatusPill>
                              ) : (
                                <span className="text-faint">—</span>
                              )}
                            </td>
                            <td className="font-mono text-[12.5px] whitespace-nowrap text-muted">
                              {row.registrationNumber || "—"}
                            </td>
                            <td>
                              <Documents documents={row.documents} />
                            </td>
                            <td>
                              <Age application={row} />
                            </td>
                            <td className="text-right">
                              <Button
                                size="sm"
                                variant={tab === "pending" ? "primary" : "secondary"}
                                onClick={() => {
                                  setSelected(row);
                                  setDrawerOpen(true);
                                }}
                              >
                                <Icon name="visibility" className="text-[16px]" />
                                {tab === "pending" ? tr("Review", "Jaiza lein") : tr("Open", "Kholein")}
                              </Button>
                            </td>
                          </motion.tr>
                        );
                      })}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-[18px] py-3 text-[12.5px] text-muted">
                <span className="inline-flex items-center gap-[7px]">
                  <span aria-hidden className="grid h-[18px] w-[18px] place-items-center rounded-md bg-stable-soft text-stable">
                    <Icon name="check" className="text-[12px]" />
                  </span>
                  {tr("Checked by an admin", "Admin ne check kiya")}
                </span>
                <span className="inline-flex items-center gap-[7px]">
                  <span aria-hidden className="h-[18px] w-[18px] rounded-md bg-sunken" />
                  {tr("Uploaded, not checked", "Upload hua, check nahi")}
                </span>
                <span className="inline-flex items-center gap-[7px]">
                  <span aria-hidden className="h-[18px] w-[18px] rounded-md border-[1.5px] border-dashed border-line-strong" />
                  {tr("Missing", "Ghayab")}
                </span>
              </div>
            </>
          )}
        </section>
      </div>

      {/* Keyed by applicant: a different row mounts a fresh panel, so last
          review's notes and half-typed reason cannot follow it there. */}
      <ReviewDrawer
        key={selected?.id ?? "none"}
        open={drawerOpen}
        application={selected}
        onClose={() => setDrawerOpen(false)}
        onDecided={onDecided}
      />
    </AppShell>
  );
}
