"use client";

/**
 * The audit trail (requirement R6).
 *
 * Read-only, and visibly so — there is no edit control anywhere in this file
 * because there is no endpoint behind one. The log is append-only, and an
 * interface that implied otherwise would misrepresent the guarantee it is
 * displaying.
 *
 * Two design choices carry the screen:
 *
 * - **Security events are surfaced, not filtered to.** Denied access and
 *   break-glass use are what an administrator is here for; a count only visible
 *   to someone who already suspected something is not a control.
 * - **Chain verification is a button with a real answer.** "Immutable" is a
 *   claim; recomputing the hashes and saying whether they still agree is
 *   evidence.
 *
 * The trail is a dense table, newest first, under a row for each day. The seal
 * is said once, at the top of the page, rather than as a lock on every row —
 * it is the one promise this screen makes, and it is kept by the tamper check
 * above the table, not by repeating it.
 */

import { useEffect, useState } from "react";

import { Icon } from "@/components/Icon";
import { ROLE_LABEL } from "@/components/admin/PersonDrawer";
import { Pager, StatusPill } from "@/components/admin/console";
import { useNow } from "@/components/doctorApplication/shared";
import { Segmented } from "@/components/forms";
import { Button, EmptyState, ErrorState, SkeletonRows, cx } from "@/components/ui";
import {
  ApiError,
  audit as auditApi,
  type AuditEntry,
  type AuditSeverity,
  type ChainVerification,
  type Role,
} from "@/lib/api";
import { DATE_BOUNDS } from "@/lib/dates";
import { useTr } from "@/lib/lang";
import { useAsync } from "@/lib/useAsync";

const SEVERITY_TONE: Record<AuditSeverity, "critical" | "warning" | "info" | "neutral"> = {
  SECURITY: "critical",
  BREAK_GLASS: "critical",
  WARNING: "warning",
  NOTICE: "info",
  INFO: "neutral",
};

/** Severities worth pulling out of the stream. */
const ALERTING: AuditSeverity[] = ["SECURITY", "BREAK_GLASS"];

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Where the plain reading of the name says less than the page means. */
const ACTION_NAMES: Record<string, string> = {
  AUDIT_VIEWED: "Audit trail viewed",
};

/** "c7f1a2c4…09be" — an id short enough for its column, both ends kept. */
function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

/** "PATIENT_RECORD_VIEW" reads badly in a table; "Patient record view" does. */
function humanise(action: string): string {
  if (ACTION_NAMES[action]) return ACTION_NAMES[action];
  const words = action.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** An icon for the kind of thing that was done. Decorative only. */
function iconFor(action: string, severity: AuditSeverity): string {
  if (severity === "BREAK_GLASS") return "e911_emergency";
  if (severity === "SECURITY") return "gpp_maybe";
  const key = action.toLowerCase();
  if (key.includes("login") || key.includes("logout") || key.includes("session")) return "login";
  if (key.includes("delete") || key.includes("remove")) return "delete";
  if (key.includes("create") || key.includes("add")) return "add_circle";
  if (key.includes("update") || key.includes("edit") || key.includes("change")) return "edit";
  if (key.includes("export") || key.includes("download")) return "download";
  if (key.includes("view") || key.includes("read") || key.includes("open")) return "visibility";
  if (key.includes("invoice") || key.includes("payment")) return "receipt_long";
  if (key.includes("appointment")) return "calendar_today";
  return "history";
}

// ---------------------------------------------------------------------------
// Metadata, as one line
// ---------------------------------------------------------------------------

/** The recorded detail on one dark line, as the design sets it: `{ "count": 2 }`. */
function JsonLine({ value }: { value: unknown }) {
  const text = (JSON.stringify(value, null, 1) ?? "null").replace(/\n\s*/g, " ");
  return (
    <pre className="overflow-x-auto rounded-xl bg-[#0B1630] px-3.5 py-3 font-mono text-[12px] leading-[1.6] text-[#DCE7F7] dark:bg-[#050D1F]">
      {text}
    </pre>
  );
}

/** "AuditLog" as a person would say it: "Audit log"; a patient is their record. */
function entityName(type: string | null): string | null {
  if (!type) return null;
  if (type === "Patient") return "Patient record";
  const words = type.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ---------------------------------------------------------------------------
// Tamper check
// ---------------------------------------------------------------------------

/** Seven linked blocks, the last one this check: what "a chain" means, drawn. */
function ChainLinks({ broken }: { broken: boolean }) {
  return (
    <span aria-hidden className="flex items-center">
      {Array.from({ length: 7 }, (_, index) => (
        <span key={index} className="flex items-center">
          {index > 0 && (
            <span className={cx("h-0.5 w-3", broken && index === 5 ? "bg-critical [mask:repeating-linear-gradient(90deg,#000_0_3px,transparent_3px_5px)]" : "bg-stable/50")} />
          )}
          <span
            className={cx(
              "pop-scale h-4 w-5 rounded-[5px] border-2",
              broken && index >= 5 ? "border-critical bg-critical-soft" : "border-stable bg-stable-soft",
            )}
            style={{ animationDelay: `${index * 0.05}s` }}
          />
        </span>
      ))}
    </span>
  );
}

/**
 * The tamper check, as one line above the trail: what the chain is, and a
 * button that recomputes it. The answer replaces the line — green when it
 * holds, and announced in red when it does not.
 */
function ChainStatus({ entries }: { entries: number | null }) {
  const tr = useTr();
  const [result, setResult] = useState<ChainVerification | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = (value: number) => new Intl.NumberFormat("en-PK").format(value);

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await auditApi.verify(1000));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : tr("Could not verify the chain.", "Chain verify nahi ho saki."));
    } finally {
      setBusy(false);
    }
  };

  const holds = result?.valid === true;
  const broken = result?.valid === false;

  return (
    <section
      aria-label={tr("Tamper check", "Cherh-chharh ki jaanch")}
      className={cx(
        "rise-in flex flex-wrap items-center gap-3.5 rounded-[18px] border px-[18px] py-3.5",
        holds && "border-stable/35 bg-stable-soft",
        broken && "glow-critical border-critical/60 bg-critical-soft",
        !result && "border-line bg-card",
      )}
    >
      <span
        aria-hidden
        className={cx(
          "grid h-[38px] w-[38px] shrink-0 place-items-center rounded-xl",
          holds ? "bg-card text-stable" : broken ? "bg-card text-critical" : "bg-sunken text-primary",
        )}
      >
        <Icon name={broken ? "gpp_bad" : "verified_user"} filled={Boolean(result)} className="text-[20px]" />
      </span>
      {/* A broken chain means the table has been tampered with. It is
          announced, not just coloured. */}
      <div role={result ? (holds ? "status" : "alert") : undefined} className="flex min-w-[16rem] flex-[1_1_20rem] flex-col gap-0.5">
        {result ? (
          <>
            <span className="flex flex-wrap items-center gap-3">
              <b className={cx("text-[14px] font-semibold", holds ? "text-stable" : "text-critical")}>{result.detail}</b>
              <ChainLinks broken={broken} />
            </span>
            <span className="text-[13px] text-strong tabular-nums">
              {result.checked} {tr("entries checked", "entries jaanchi gayin")}
              {result.brokenAt && ` · ${tr("first break at entry", "pehla tor is entry par:")} ${result.brokenAt}`}
              {holds && ` · ${tr("the check itself is in the trail", "jaanch khud bhi trail mein darj hai")}`}
            </span>
          </>
        ) : (
          <>
            <b className="text-[14px] font-semibold text-strong">
              {entries !== null
                ? tr(
                    `${count(entries)} entries, each hashed together with the one before it`,
                    `${count(entries)} entries, har aik apni pichhli ke saath hash`,
                  )
                : tr("Each entry is hashed together with the one before it", "Har entry apni pichhli ke saath hash hoti hai")}
            </b>
            <span className="text-[13px] text-muted">
              {tr(
                "An entry altered or removed directly in the database would no longer verify. Checking is recorded too.",
                "Database mein seedha badli ya hataayi gayi entry verify nahi hogi. Jaanch bhi darj hoti hai.",
              )}
            </span>
          </>
        )}
        {error && <span className="text-[13px] font-medium text-critical">{error}</span>}
      </div>
      <Button size="sm" variant="secondary" loading={busy} onClick={() => void verify()}>
        {result ? tr("Check again", "Dobara jaanchein") : tr("Verify chain", "Chain verify karein")}
      </Button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The trail, as a table grouped by day
// ---------------------------------------------------------------------------

function Reference({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-faint">{label}</dt>
      <dd className={cx("mt-0.5 truncate font-mono", value ? "text-strong" : "text-faint")} title={value ?? undefined}>
        {value ? shortId(value) : "—"}
      </dd>
    </div>
  );
}

/** "6:11 PM" — the day is the row above. */
function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "Today · Fri 23 Oct", "Yesterday · Thu 22 Oct", "Wed 21 Oct 2026". */
function dayLabel(iso: string, today: string, yesterday: string, words: { today: string; yesterday: string }): string {
  const at = new Date(iso);
  const key = at.toDateString();
  const short = at.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
  if (key === today) return `${words.today} · ${short}`;
  if (key === yesterday) return `${words.yesterday} · ${short}`;
  return at.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).replace(",", "");
}

function EntryRows({ entry }: { entry: AuditEntry }) {
  const tr = useTr();
  const [open, setOpen] = useState(false);
  const alerting = ALERTING.includes(entry.severity);
  const hasMetadata = entry.metadata !== null && Object.keys(entry.metadata).length > 0;
  const panelId = `audit-entry-${entry.id}`;

  return (
    <>
      <tr onClick={() => setOpen((value) => !value)} className={cx("cursor-pointer", alerting && "[&>td]:bg-critical-soft/40")}>
        <td className="whitespace-nowrap text-muted tabular-nums" title={when(entry.timestamp)}>
          {clock(entry.timestamp)}
        </td>
        <td>
          <span className="flex items-center gap-2.5">
            <span
              aria-hidden
              className={cx(
                "grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[10px]",
                alerting ? "bg-critical-soft text-critical" : "bg-sunken text-primary",
              )}
            >
              <Icon name={iconFor(entry.action, entry.severity)} filled={alerting} className="text-[16px]" />
            </span>
            <span className="font-semibold">{humanise(entry.action)}</span>
            {alerting && (
              <StatusPill tone={SEVERITY_TONE[entry.severity] === "critical" ? "critical" : "warning"}>
                {humanise(entry.severity)}
              </StatusPill>
            )}
          </span>
        </td>
        <td>
          {/* Null when the account has since been deleted. `userId` is
              deliberately not a foreign key — the trail outlives its subject. */}
          <span className="block font-medium whitespace-nowrap">
            {entry.actorName ?? <span className="text-faint italic">{tr("(deleted account)", "(hazf shuda account)")}</span>}
          </span>
          {entry.actorRole && (
            <span className="block text-[12px] text-muted">
              {tr(...(ROLE_LABEL[entry.actorRole as Role] ?? [humanise(entry.actorRole), humanise(entry.actorRole)]))}
            </span>
          )}
        </td>
        <td className="text-muted">{entityName(entry.entityType) ?? "—"}</td>
        <td className="font-mono text-[12.5px] text-muted">{entry.ipAddress ?? "—"}</td>
        <td className="text-right">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={open ? tr("Hide detail", "Tafseel chhupayein") : tr("Show detail", "Tafseel dekhein")}
            onClick={(event) => {
              event.stopPropagation();
              setOpen((value) => !value);
            }}
            className="grid h-[30px] w-[30px] place-items-center rounded-full text-strong hover:bg-sunken focus-visible:outline-2 focus-visible:outline-primary"
          >
            <Icon name="expand_more" className={cx("text-[16px] transition-transform duration-300", open && "rotate-180")} />
          </button>
        </td>
      </tr>
      {open && (
        <tr id={panelId} className="[&>td]:!bg-sunken/50">
          <td colSpan={6} className="!pt-1 !pb-4">
            <div className="space-y-3">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12.5px] sm:grid-cols-4">
                <Reference label={tr("Entity", "Cheez")} value={entityName(entry.entityType)} />
                <Reference label={tr("Entity id", "Cheez ki id")} value={entry.entityId} />
                <Reference label={tr("Request", "Darkhwast")} value={entry.requestId} />
                <Reference label={tr("Emergency grant", "Emergency grant")} value={entry.emergencyAccessId} />
                {/* Whose record, when the entry was about a patient by way of
                    something else — a document, a prescription. */}
                {entry.patientId && entry.patientId !== entry.entityId && (
                  <Reference label={tr("Patient", "Mareez")} value={entry.patientId} />
                )}
              </dl>
              {hasMetadata ? (
                <JsonLine value={entry.metadata} />
              ) : (
                <p className="rounded-xl border border-dashed border-line px-4 py-3 text-sm text-faint">
                  {tr(
                    "Nothing beyond the references above was recorded for this entry.",
                    "Is entry ke liye upar diye hawalon ke ilawa kuchh darj nahi hua.",
                  )}
                </p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** Fifty to a page: a day's worth, most days. */
const PAGE = 50;

export type AuditKind = "all" | "SECURITY" | "BREAK_GLASS";

/** What the page's sentence quotes: the whole trail's size, and the week's alarms. */
export interface AuditSummary {
  total: number | null;
  alertsThisWeek: number;
}

export function AuditPanel({
  kind: chosen,
  onKind,
  onSummary,
}: {
  /** Set from outside — the page's "security events" link opens that tab. */
  kind?: AuditKind;
  onKind?: (kind: AuditKind) => void;
  /** Reading the trail is itself audited, so the page takes its figures from
      this one read rather than making another. */
  onSummary?: (summary: AuditSummary) => void;
}) {
  const tr = useTr();
  const now = useNow(true, 60_000);
  const [own, setOwn] = useState<AuditKind>("all");
  const kind = chosen ?? own;
  const setKind = (next: AuditKind) => {
    if (onKind) onKind(next);
    else setOwn(next);
    setOffset(0);
  };
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [offset, setOffset] = useState(0);
  // Reading the audit trail is itself audited, so a timer would write an entry
  // a minute about a person who looked once — each one a new link in a hash
  // chain that exists to be trustworthy. It refreshes when they come back.
  const fetched = useAsync(
    () =>
      auditApi.list({
        severity: kind === "all" ? undefined : kind,
        since: since ? new Date(`${since}T00:00:00`).toISOString() : undefined,
        until: until ? new Date(`${until}T23:59:59`).toISOString() : undefined,
        limit: PAGE,
        offset,
      }),
    [kind, since, until, offset],
    { live: "on-return" },
  );

  const rows = fetched.data?.data ?? [];
  const bySeverity = fetched.data?.meta.bySeverity;
  const unfiltered = kind === "all" && !since && !until;
  const meta = fetched.data?.meta;
  useEffect(() => {
    if (!meta || !onSummary) return;
    onSummary({ total: unfiltered ? meta.total : null, alertsThisWeek: meta.alertsThisWeek });
  }, [meta, unfiltered, onSummary]);

  // Rows under the day they happened, in the order the server sent them.
  const today = new Date(now).toDateString();
  const yesterday = new Date(now - 86_400_000).toDateString();
  const words = { today: tr("Today", "Aaj"), yesterday: tr("Yesterday", "Kal") };
  const days: Array<{ label: string; entries: AuditEntry[] }> = [];
  for (const entry of rows) {
    const label = dayLabel(entry.timestamp, today, yesterday, words);
    const last = days.at(-1);
    if (last && last.label === label) last.entries.push(entry);
    else days.push({ label, entries: [entry] });
  }

  const dateInput =
    "h-10 w-[160px] rounded-xl border border-line-strong bg-card px-3.5 text-[14px] text-strong focus-visible:outline-2 focus-visible:outline-primary";

  return (
    <div className="space-y-[22px]">
      {/* The total is the unfiltered list's; with a filter on it would be only
          part of the trail. */}
      <ChainStatus entries={kind === "all" && !since && !until ? (fetched.data?.meta.total ?? null) : null} />

      <section
        id="entries"
        aria-label={tr("Entries", "Entries")}
        className="rise-in scroll-mt-24 overflow-hidden rounded-3xl border border-line bg-card shadow-card"
      >
        <div className="flex flex-wrap items-center gap-3 px-[18px] py-4">
          <Segmented
            options={[
              { value: "all" as const, label: tr("All", "Sab") },
              { value: "SECURITY" as const, label: tr("Security", "Security"), count: bySeverity?.SECURITY },
              { value: "BREAK_GLASS" as const, label: tr("Break-glass", "Emergency"), count: bySeverity?.BREAK_GLASS },
            ]}
            value={kind}
            onChange={setKind}
            label={tr("Filter the audit trail", "Audit trail filter karein")}
          />
          <span className="flex flex-wrap items-center gap-3 sm:ml-auto">
            <span className="flex items-center gap-2">
              <label htmlFor="audit-since" className="text-[13px] font-semibold text-muted">
                {tr("From", "Se")}
              </label>
              <input
                id="audit-since"
                type="date"
                min={DATE_BOUNDS.min}
                max={DATE_BOUNDS.max}
                value={since}
                onChange={(event) => {
                  setSince(event.target.value);
                  setOffset(0);
                }}
                className={dateInput}
              />
            </span>
            <span className="flex items-center gap-2">
              <label htmlFor="audit-until" className="text-[13px] font-semibold text-muted">
                {tr("To", "Tak")}
              </label>
              <input
                id="audit-until"
                type="date"
                min={DATE_BOUNDS.min}
                max={DATE_BOUNDS.max}
                value={until}
                onChange={(event) => {
                  setUntil(event.target.value);
                  setOffset(0);
                }}
                className={dateInput}
              />
            </span>
          </span>
        </div>

        {fetched.loading && !fetched.data && (
          <div role="status" aria-live="polite" className="px-[18px] pb-5">
            <span className="sr-only">{tr("Loading the audit trail", "Audit trail load ho raha hai")}…</span>
            <SkeletonRows rows={5} title={false} />
          </div>
        )}
        {fetched.error && (
          <div className="px-[18px] pb-5">
            <ErrorState message={fetched.error.message} onRetry={fetched.reload} />
          </div>
        )}

        {fetched.data && rows.length === 0 && (
          <EmptyState
            icon={kind === "all" ? "history" : "gpp_good"}
            title={kind === "all" ? tr("No entries", "Koi entry nahi") : tr("No security events", "Koi security waqia nahi")}
            description={
              kind === "all"
                ? tr("Sensitive actions are recorded here as they happen.", "Hassas amal hote hi yahan darj ho jate hain.")
                : tr(
                    "No denied access or break-glass use has been recorded.",
                    "Na koi rasai roki gayi, na emergency access istemal hui.",
                  )
            }
            action={
              kind !== "all" ? (
                <Button variant="secondary" onClick={() => setKind("all")}>
                  {tr("Show all", "Sab dikhayein")}
                </Button>
              ) : undefined
            }
          />
        )}

        {rows.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="console-table min-w-[52rem]">
                <caption className="sr-only">{tr("Audit trail, newest first", "Audit trail, naya pehle")}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="w-[110px]">
                      {tr("Time", "Waqt")}
                    </th>
                    <th scope="col">{tr("What happened", "Kya hua")}</th>
                    <th scope="col">{tr("Who", "Kis ne")}</th>
                    <th scope="col">{tr("On", "Kis par")}</th>
                    <th scope="col">{tr("Network", "Network")}</th>
                    <th scope="col" className="w-12">
                      <span className="sr-only">{tr("Detail", "Tafseel")}</span>
                    </th>
                  </tr>
                </thead>
                {days.map((day) => (
                  <tbody key={day.label}>
                    <tr className="[&>th]:!bg-sunken/60">
                      <th scope="colgroup" colSpan={6} className="!py-2 text-left text-[12px] font-bold tracking-[0.04em] text-muted">
                        {day.label}
                      </th>
                    </tr>
                    {day.entries.map((entry) => (
                      <EntryRows key={entry.id} entry={entry} />
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
            <Pager offset={offset} limit={PAGE} total={fetched.data?.meta.total ?? rows.length} onChange={setOffset} />
          </>
        )}
      </section>
    </div>
  );
}
