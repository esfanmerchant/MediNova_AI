"use client";

/**
 * Everybody on the platform, and taking somebody off it.
 *
 * **Two different actions, and the difference is the point.** Suspension ends
 * the access and leaves everything else alone — every live session is revoked
 * server-side the moment it is applied, so somebody suspended for breaking the
 * rules stops working immediately rather than when their token expires. It is
 * undone in one press.
 *
 * Removal is the other thing entirely: the account and the person's data are
 * destroyed, their email address and CNIC come free to register again, and
 * nothing brings it back. It is the only irreversible action in the product, so
 * it is deliberately harder to reach — a second press, then the real counts of
 * what is about to be deleted, then their address typed out in full. What
 * survives it is on that panel too, because a doctor's removal must not take a
 * patient's chart with it.
 *
 * **A reason is required here even though the API allows none.** This screen
 * exists for terms-of-service enforcement, and "why was this account closed"
 * is the first question anybody asks afterwards — of the administrator who did
 * it, who by then will not remember. The reason goes into the audit trail with
 * the actor and the timestamp.
 */

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { Segmented } from "@/components/forms";
import {
  ConsoleHeader,
  HeaderPill,
  Pager,
  StatusPill,
  consoleDay,
  consoleStamp,
  type PillTone,
} from "@/components/admin/console";
import {
  PERSON_HELD,
  PersonDrawer,
  ROLE_LABEL,
  STATUS_LABEL,
  peekHeldPerson,
  takeHeldPerson,
} from "@/components/admin/PersonDrawer";
import { RowMenu } from "@/components/admin/RowMenu";
import { StaffAccountDialog } from "@/components/admin/StaffAccountDialog";
import { RemoveAccount } from "@/components/admin/RemoveAccount";
import { useToast } from "@/components/overlays";
import { Button, EmptyState, ErrorState, Field, Input, SkeletonRows, cx } from "@/components/ui";
import { ApiError, users, type AccountRow, type Role } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { useSession } from "@/lib/session";
import { useAsync } from "@/lib/useAsync";

type Row = AccountRow;
type RoleTab = Role | "ALL";

/** Ten to a page: a roster is scanned, and ten rows fit a laptop screen whole. */
const PAGE = 10;

const STATUS_TONE: Record<string, PillTone> = {
  ACTIVE: "good",
  SUSPENDED: "critical",
  PENDING_VERIFICATION: "warning",
  DEACTIVATED: "neutral",
};

/** "Dr. Ayesha Raza" is AR, and Ayesha in a sentence. */
function withoutTitle(name: string): string {
  return name.replace(/^Dr\.?\s+/i, "");
}

function initialsOf(name: string): string {
  return (
    withoutTitle(name)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function PersonRow({ row, onChanged, onOpen }: { row: Row; onChanged: () => void; onOpen: () => void }) {
  const tr = useTr();
  const { user } = useSession();
  const isSelf = user?.id === row.id;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"suspend" | "remove" | null>(null);
  const [reason, setReason] = useState("");

  const suspended = row.status === "SUSPENDED";
  const first = withoutTitle(row.name).split(" ")[0];

  async function change(status: "ACTIVE" | "SUSPENDED") {
    setBusy(true);
    try {
      await users.setStatus(row.id, status, status === "SUSPENDED" ? reason.trim() : undefined);
      toast.show({
        tone: "success",
        title:
          status === "SUSPENDED"
            ? tr("Account suspended", "Account mo'attal kar diya")
            : tr("Account restored", "Account bahaal kar diya"),
        body:
          status === "SUSPENDED"
            ? tr(
                `${row.name} has been signed out everywhere and cannot sign in.`,
                `${row.name} har jagah se sign out ho gaya aur ab andar nahi aa sakta.`,
              )
            : tr(`${row.name} can sign in again.`, `${row.name} dobara sign in kar sakta hai.`),
      });
      setPanel(null);
      setReason("");
      onChanged();
    } catch (cause) {
      toast.show({
        tone: "critical",
        title: tr("That did not work", "Yeh nahi ho saka"),
        body: cause instanceof ApiError ? cause.message : String(cause),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <tr
        onClick={onOpen}
        // Marked by its ground and its red status rather than by fading the
        // row, which took the words below a readable contrast.
        className={cx("cursor-pointer", suspended && "[&>td]:bg-critical-soft/45")}
      >
        <td>
          <div className="flex min-w-0 items-center gap-[11px]">
            <span
              aria-hidden
              className={cx(
                "grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full text-[12px] font-bold",
                suspended ? "bg-critical-soft text-critical" : "bg-sunken text-primary",
              )}
            >
              {initialsOf(row.name)}
            </span>
            <span className="min-w-0">
              {/* The row opens on a click anywhere; the name is how a keyboard gets there. */}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpen();
                }}
                className="block max-w-full truncate rounded text-left text-[13.5px] font-semibold text-strong hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {row.name}
              </button>
              <span className="block truncate text-[12.5px] text-muted">{row.email}</span>
            </span>
          </div>
        </td>
        <td>
          <StatusPill>{tr(...(ROLE_LABEL[row.role] ?? [row.role, row.role]))}</StatusPill>
        </td>
        <td>
          <StatusPill dot tone={STATUS_TONE[row.status] ?? "neutral"}>
            {tr(...(STATUS_LABEL[row.status] ?? [row.status, row.status]))}
          </StatusPill>
        </td>
        <td className="whitespace-nowrap text-muted tabular-nums">
          {row.lastLoginAt ? consoleStamp(row.lastLoginAt) : tr("Never", "Kabhi nahi")}
        </td>
        <td className="whitespace-nowrap text-muted tabular-nums">{consoleDay(row.createdAt)}</td>
        <td className="text-right">
          {/* Never on your own row.
              ----------------------
              The server has always refused this — `set_user_status` returns 403
              when the id is the caller's own — and an action that cannot
              succeed should not be on screen: suspending yourself would revoke
              your own session mid-click and, with one administrator left, lock
              the hospital out of its own admin portal. */}
          {isSelf ? (
            <StatusPill tone="info">{tr("This is you", "Yeh aap hain")}</StatusPill>
          ) : (
            <RowMenu
              label={tr(`Actions for ${row.name}`, `${row.name} ke liye actions`)}
              items={[
                { label: tr("Open", "Kholein"), icon: "visibility", onSelect: onOpen },
                suspended
                  ? {
                      label: tr("Restore access", "Rasai bahaal karein"),
                      icon: "lock_open",
                      onSelect: () => void change("ACTIVE"),
                    }
                  : { label: tr("Suspend…", "Mo'attal karein…"), icon: "lock", onSelect: () => setPanel("suspend") },
                // Last and set apart: removal is the rarer and far more serious
                // act, and the panel behind it is what makes it deliberate.
                {
                  label: tr("Remove account…", "Account hatayein…"),
                  icon: "close",
                  danger: true,
                  onSelect: () => setPanel("remove"),
                },
              ]}
            />
          )}
        </td>
      </tr>

      {panel && (
        <tr className="[&>td]:!bg-card">
          <td colSpan={6} className="!pt-0">
            {panel === "remove" ? (
              <RemoveAccount
                userId={row.id}
                name={row.name}
                onCancel={() => setPanel(null)}
                onDone={() => {
                  setPanel(null);
                  onChanged();
                }}
              />
            ) : (
              <div className="rise-in mt-1 flex flex-col gap-3 rounded-2xl border border-critical/35 bg-critical-soft p-4">
                <p className="flex items-start gap-2.5 text-[13.5px] leading-normal text-strong">
                  <Icon name="warning" className="mt-px shrink-0 text-[18px] text-critical" />
                  <span>
                    {tr(
                      `${first} will be signed out everywhere at once and cannot sign in. Their records stay — nothing is deleted.`,
                      `${first} foran har jagah se sign out ho jayenge aur andar nahi aa sakenge. Un ka record wahi rahega — kuch mitta nahi.`,
                    )}
                  </span>
                </p>
                <div className="max-w-[520px]">
                  <Field
                    label={tr("Why is this account being suspended?", "Yeh account kyun mo'attal ho raha hai?")}
                    htmlFor={`reason-${row.id}`}
                    hint={tr(
                      "Written to the audit trail against your name.",
                      "Audit trail mein aap ke naam ke saath darj hoga.",
                    )}
                  >
                    <Input
                      id={`reason-${row.id}`}
                      maxLength={300}
                      autoFocus
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </Field>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="danger"
                    loading={busy}
                    disabled={reason.trim().length < 3}
                    onClick={() => change("SUSPENDED")}
                  >
                    {tr("Suspend account", "Account mo'attal karein")}
                  </Button>
                  <Button variant="ghost" onClick={() => setPanel(null)}>
                    {tr("Cancel", "Cancel")}
                  </Button>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function AdminUsers() {
  const tr = useTr();
  const [role, setRole] = useState<RoleTab>("ALL");
  const [suspendedOnly, setSuspendedOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((n) => n + 1), []);

  const list = useAsync(
    () =>
      users.list({
        role: role === "ALL" ? undefined : role,
        status: suspendedOnly ? "SUSPENDED" : undefined,
        search: search || undefined,
        limit: PAGE,
        offset,
      }),
    [role, suspendedOnly, search, offset, refresh],
  );

  const rows = list.data?.data ?? [];

  // A person search picked: held before the page arrived, or while it was
  // already showing. Read once on mount, then spent.
  const [opened, setOpened] = useState<AccountRow | null>(() => peekHeldPerson());
  useEffect(() => {
    takeHeldPerson();
    const onHeld = () => setOpened(takeHeldPerson());
    window.addEventListener(PERSON_HELD, onHeld);
    return () => window.removeEventListener(PERSON_HELD, onHeld);
  }, []);
  // The sentence and the counts on the tabs. One row each, so it costs the
  // server five COUNTs, not five pages of people.
  const tally = useAsync(
    () =>
      Promise.all([
        users.list({ limit: 1 }),
        users.list({ role: "PATIENT", limit: 1 }),
        users.list({ role: "DOCTOR", limit: 1 }),
        users.list({ role: "ADMIN", limit: 1 }),
        users.list({ status: "SUSPENDED", limit: 1 }),
      ]).then(([everyone, patients, doctors, admins, suspended]) => ({
        everyone: everyone.meta.total,
        patients: patients.meta.total,
        doctors: doctors.meta.total,
        admins: admins.meta.total,
        suspended: suspended.meta.total,
      })),
    [refresh],
  );
  const counts = tally.data;
  // Every change to what is asked for starts again at the first page.
  const narrow = (apply: () => void) => {
    apply();
    setOffset(0);
  };

  const roles: Array<{ value: RoleTab; label: string; count?: number }> = [
    { value: "ALL", label: tr("Everyone", "Sab"), count: counts?.everyone },
    { value: "PATIENT", label: tr("Patients", "Mareez"), count: counts?.patients },
    { value: "DOCTOR", label: tr("Doctors", "Doctors"), count: counts?.doctors },
    { value: "ADMIN", label: tr("Admins", "Admins"), count: counts?.admins },
  ];

  return (
    <AppShell role="ADMIN">
      <div id="main" className="space-y-6">
        <ConsoleHeader
          mark="people"
          eyebrow={tr("Everybody on the platform", "Platform par sab log")}
          title={tr("People", "Log")}
          actions={
            <HeaderPill href="/admin/users?new=staff" icon="add" tone="primary">
              {tr("Add a staff account", "Staff account banayein")}
            </HeaderPill>
          }
        >
          {counts ? (
            <p>
              <b>
                {counts.patients} {tr(counts.patients === 1 ? "patient" : "patients", "mareez")}
              </b>{" "}
              {tr("and", "aur")}{" "}
              <b>
                {counts.doctors} {tr(counts.doctors === 1 ? "doctor" : "doctors", "doctors")}
              </b>
              .{" "}
              {counts.suspended > 0 ? (
                <>
                  <a
                    href="#accounts"
                    onClick={(event) => {
                      event.preventDefault();
                      narrow(() => {
                        setRole("ALL");
                        setSuspendedOnly(true);
                      });
                    }}
                  >
                    {tr(
                      `${counts.suspended} ${counts.suspended === 1 ? "account is" : "accounts are"} suspended`,
                      `${counts.suspended} accounts muattal hain`,
                    )}
                  </a>{" "}
                  {tr("and cannot sign in.", "aur sign in nahi kar sakte.")}
                </>
              ) : (
                tr("Every account can sign in.", "Har account sign in kar sakta hai.")
              )}
            </p>
          ) : (
            <p>
              {tr(
                "Everybody on the platform, and who may still use it.",
                "Platform par sab log, aur kaun ab bhi istemal kar sakta hai.",
              )}
            </p>
          )}
        </ConsoleHeader>

        <section
          id="accounts"
          aria-label={tr("Accounts", "Accounts")}
          className="rise-in scroll-mt-24 overflow-hidden rounded-3xl border border-line bg-card shadow-card"
        >
          <div className="flex flex-wrap items-center gap-3 px-[18px] py-4">
            <Segmented
              options={roles}
              value={role}
              onChange={(next) => narrow(() => setRole(next))}
              label={tr("Role", "Kirdar")}
            />
            <button
              type="button"
              aria-pressed={suspendedOnly}
              onClick={() => narrow(() => setSuspendedOnly((value) => !value))}
              className={cx(
                "inline-flex h-8 items-center gap-2 rounded-full border px-[13px] text-[12.5px] font-semibold whitespace-nowrap transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                suspendedOnly
                  ? "border-critical bg-critical-soft text-critical"
                  : "border-line-strong bg-card text-strong hover:bg-sunken",
              )}
            >
              <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-critical" />
              {tr("Suspended only", "Sirf muattal")}
            </button>
            <label className="flex h-10 w-full items-center gap-2.5 rounded-full border border-line-strong bg-card pr-3 pl-3.5 text-muted focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary sm:ml-auto sm:w-80">
              <Icon name="search" className="text-[18px]" />
              <input
                type="search"
                aria-label={tr("Search by name or email", "Naam ya email se talash")}
                placeholder={tr("Search by name or email", "Naam ya email se talash")}
                value={search}
                maxLength={100}
                onChange={(event) => narrow(() => setSearch(event.target.value))}
                className="min-w-0 flex-1 bg-transparent text-[13.5px] text-strong outline-none placeholder:text-muted"
              />
            </label>
          </div>

          {list.loading && !list.data && (
            <div className="px-[18px] pb-5">
              <SkeletonRows rows={5} title={false} />
            </div>
          )}
          {list.error && (
            <div className="px-[18px] pb-5">
              <ErrorState message={list.error.message} onRetry={list.reload} />
            </div>
          )}
          {list.data && rows.length === 0 && (
            <EmptyState
              icon="person_search"
              title={
                search
                  ? tr(`Nobody called “${search}”`, `“${search}” naam ka koi nahi`)
                  : suspendedOnly
                    ? tr("Nobody is suspended", "Koi muattal nahi")
                    : tr("Nobody here yet", "Abhi yahan koi nahi")
              }
              description={tr(
                "Search finds a name or an email address. Try part of either, or a different role above. Removed accounts stay in the audit trail.",
                "Talash naam ya email dhoondti hai. In ka koi hissa likhein, ya upar koi aur kirdar chunein. Hataye gaye accounts audit trail mein rehte hain.",
              )}
            />
          )}
          {rows.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="console-table min-w-[52rem]">
                  <thead>
                    <tr>
                      <th scope="col">{tr("Person", "Shakhs")}</th>
                      <th scope="col">{tr("Role", "Kirdar")}</th>
                      <th scope="col">{tr("Status", "Haalat")}</th>
                      <th scope="col">{tr("Last sign-in", "Aakhri sign-in")}</th>
                      <th scope="col">{tr("Joined", "Shamil hue")}</th>
                      <th scope="col" className="text-right">
                        <span className="sr-only">{tr("Actions", "Actions")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <PersonRow key={row.id} row={row} onChanged={reload} onOpen={() => setOpened(row)} />
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager offset={offset} limit={PAGE} total={list.data?.meta.total ?? rows.length} onChange={setOffset} />
            </>
          )}
        </section>

        <PersonDrawer person={opened} onClose={() => setOpened(null)} />
        {/* useSearchParams needs a Suspense boundary of its own. */}
        <Suspense fallback={null}>
          <StaffFromLink onCreated={reload} />
        </Suspense>
      </div>
    </AppShell>
  );
}

/** The staff dialog, open while the URL says ?new=staff — which is how "+ New" reaches it. */
function StaffFromLink({ onCreated }: { onCreated: () => void }) {
  const params = useSearchParams();
  const router = useRouter();
  return (
    <StaffAccountDialog
      open={params.get("new") === "staff"}
      onClose={() => router.replace("/admin/users")}
      onCreated={onCreated}
    />
  );
}
