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
import { ConsoleHeader, HeaderPill } from "@/components/admin/console";
import {
  PERSON_HELD,
  PersonDrawer,
  ROLE_LABEL,
  STATUS_LABEL,
  peekHeldPerson,
  takeHeldPerson,
} from "@/components/admin/PersonDrawer";
import { StaffAccountDialog } from "@/components/admin/StaffAccountDialog";
import { RemoveAccount } from "@/components/admin/RemoveAccount";
import { useToast } from "@/components/overlays";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  SkeletonRows,
  cx,
} from "@/components/ui";
import { ApiError, users, type AccountRow, type Role } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { useSession } from "@/lib/session";
import { useAsync } from "@/lib/useAsync";

type Row = AccountRow;

const ROLES: Array<{ value: Role | ""; label: [string, string] }> = [
  { value: "", label: ["Everyone", "Sab"] },
  { value: "PATIENT", label: ["Patients", "Mareez"] },
  { value: "DOCTOR", label: ["Doctors", "Doctors"] },
  { value: "ADMIN", label: ["Admins", "Admins"] },
];

function Person({ row, onChanged, onOpen }: { row: Row; onChanged: () => void; onOpen: () => void }) {
  const tr = useTr();
  const { user } = useSession();
  const isSelf = user?.id === row.id;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState("");

  const active = row.status === "ACTIVE";

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
      setSuspending(false);
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
    <li
      className={cx(
        "rounded-2xl border p-4 shadow-card",
        // Marked by its ground and its red status badge rather than by fading
        // the row, which took the words below a readable contrast.
        active ? "border-line bg-card" : "border-critical/30 bg-sunken/50",
      )}
    >
      {/* On a phone the actions take their own line, and take it by rule
          rather than by running out of room.
          -------------------------------------------------------------
          Wrapping got there eventually, but only after the name had been
          squeezed into a column narrow enough to break "Esfan Mehmood
          Merchant" across three lines while two buttons sat beside it. Giving
          the actions the full width below `sm` hands the whole row back to the
          name, which is the part somebody is reading. */}
      <div className="flex flex-wrap items-start gap-3 sm:items-center">
        <Avatar name={row.name} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onOpen}
              className="rounded font-display text-base font-bold text-strong underline-offset-4 hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {row.name}
            </button>
            <Badge tone="neutral">{tr(...(ROLE_LABEL[row.role] ?? [row.role, row.role]))}</Badge>
            {!active && <Badge tone="critical">{tr(...(STATUS_LABEL[row.status] ?? [row.status, row.status]))}</Badge>}
          </p>
          <p className="truncate text-sm text-muted">{row.email}</p>
        </div>

        {/* Never on your own row.
            ----------------------
            The server has always refused this — `set_user_status` returns 403
            when the id is the caller's own — but the button was still offered,
            so the only thing pressing it produced was an error. An action that
            cannot succeed should not be on screen: suspending yourself would
            revoke your own session mid-click and, with one administrator left,
            lock the hospital out of its own admin portal. */}
        {isSelf ? (
          <span className="mono-caps w-full text-[11px] text-faint sm:w-auto">
            {tr("This is you", "Yeh aap hain")}
          </span>
        ) : (
          <div className="flex w-full flex-wrap items-center justify-end gap-1 sm:w-auto">
            {active ? (
              <Button variant="ghost" onClick={() => setSuspending((open) => !open)}>
                {tr("Suspend", "Mo'attal karein")}
              </Button>
            ) : (
              <Button variant="secondary" loading={busy} onClick={() => change("ACTIVE")}>
                {tr("Restore", "Bahaal karein")}
              </Button>
            )}
            {/* Quieter than Suspend on purpose. Removal is the rarer and far
                more serious act, and the panel behind it is what makes it
                deliberate — a louder button here would only make it easier to
                press by mistake. */}
            <Button
              variant="ghost"
              className="text-critical hover:bg-critical-soft"
              onClick={() => setRemoving((open) => !open)}
            >
              {tr("Remove", "Hatayein")}
            </Button>
          </div>
        )}
      </div>

      {removing && (
        <RemoveAccount
          userId={row.id}
          name={row.name}
          onCancel={() => setRemoving(false)}
          onDone={() => {
            setRemoving(false);
            onChanged();
          }}
        />
      )}

      {suspending && (
        <div className="mt-4 space-y-3 rounded-xl border border-critical/40 bg-critical-soft p-3">
          <p className="flex items-start gap-2 text-sm text-strong">
            <Icon name="warning" className="mt-0.5 shrink-0 text-[18px] text-critical" />
            <span>
              {tr(
                "They will be signed out everywhere immediately and will not be able to sign in. Their records stay — nothing is deleted.",
                "Woh foran har jagah se sign out ho jayenge aur andar nahi aa sakenge. Un ka record wahi rahega — kuch mitta nahi.",
              )}
            </span>
          </p>

          <Field
            label={tr("Why is this account being suspended?", "Yeh account kyun mo'attal ho raha hai?")}
            htmlFor={`reason-${row.id}`}
            hint={tr(
              "Recorded in the audit trail against your name.",
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

          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              loading={busy}
              disabled={reason.trim().length < 3}
              onClick={() => change("SUSPENDED")}
            >
              {tr("Suspend account", "Account mo'attal karein")}
            </Button>
            <Button variant="ghost" onClick={() => setSuspending(false)}>
              {tr("Cancel", "Cancel")}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

export default function AdminUsers() {
  const tr = useTr();
  const [role, setRole] = useState<Role | "">("");
  const [search, setSearch] = useState("");
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((n) => n + 1), []);

  const list = useAsync(
    () => users.list({ role: role || undefined, search: search || undefined, limit: 50 }),
    [role, search, refresh],
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
  // The header's sentence. Counts only — one row each — so it costs the
  // server three COUNTs, not three pages of people.
  const tally = useAsync(
    () =>
      Promise.all([
        users.list({ role: "PATIENT", limit: 1 }),
        users.list({ role: "DOCTOR", limit: 1 }),
        users.list({ status: "SUSPENDED", limit: 1 }),
      ]).then(([patients, doctors, suspended]) => ({
        patients: patients.meta.total,
        doctors: doctors.meta.total,
        suspended: suspended.meta.total,
      })),
    [refresh],
  );

  return (
    <AppShell role="ADMIN">
      <div id="main" className="space-y-6">
        <ConsoleHeader
          icon="group"
          eyebrow={tr("Everybody on the platform", "Platform par sab log")}
          title={tr("People", "Log")}
          actions={
            <HeaderPill href="/admin/users?new=staff" icon="person_add" tone="primary">
              {tr("Add a staff account", "Staff account banayein")}
            </HeaderPill>
          }
        >
          {tally.data ? (
            <p>
              <b>
                {tally.data.patients} {tr(tally.data.patients === 1 ? "patient" : "patients", "mareez")}
              </b>{" "}
              {tr("and", "aur")}{" "}
              <b>
                {tally.data.doctors} {tr(tally.data.doctors === 1 ? "doctor" : "doctors", "doctors")}
              </b>
              .{" "}
              {tally.data.suspended > 0
                ? tr(
                    `${tally.data.suspended} ${tally.data.suspended === 1 ? "account is" : "accounts are"} suspended and cannot sign in.`,
                    `${tally.data.suspended} accounts muattal hain aur sign in nahi kar sakte.`,
                  )
                : tr("Every account can sign in.", "Har account sign in kar sakta hai.")}
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

        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <div
              role="group"
              aria-label={tr("Role", "Kirdar")}
              className="inline-flex rounded-lg border border-line p-0.5"
            >
              {ROLES.map((option) => (
                <button
                  key={option.value || "all"}
                  type="button"
                  aria-pressed={role === option.value}
                  onClick={() => setRole(option.value)}
                  className={cx(
                    "min-h-11 rounded-md px-3 text-xs font-bold transition-colors sm:min-h-9",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                    role === option.value
                      ? "bg-primary text-primary-on"
                      : "text-muted hover:text-strong",
                  )}
                >
                  {tr(...option.label)}
                </button>
              ))}
            </div>

            <div className="min-w-[14rem] flex-1">
              <Field label={tr("Search", "Talash")} htmlFor="people-search">
                <Input
                  id="people-search"
                  value={search}
                  maxLength={100}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </Field>
            </div>
          </div>
        </Card>

        <Card icon="group" title={tr("Accounts", "Accounts")}>
          {list.loading && <SkeletonRows rows={4} />}
          {list.error && <ErrorState message={list.error.message} onRetry={list.reload} />}
          {list.data && rows.length === 0 && (
            <EmptyState
              icon="person_search"
              title={search ? tr(`Nobody called “${search}”`, `“${search}” naam ka koi nahi`) : tr("Nobody here yet", "Abhi yahan koi nahi")}
              description={tr(
                "Search finds a name or an email address. Try part of either, or a different role above. Removed accounts stay in the audit trail.",
                "Talash naam ya email dhoondti hai. In ka koi hissa likhein, ya upar koi aur kirdar chunein. Hataye gaye accounts audit trail mein rehte hain.",
              )}
            />
          )}
          {rows.length > 0 && (
            <ul className="space-y-3">
              {rows.map((row) => (
                <Person key={row.id} row={row} onChanged={reload} onOpen={() => setOpened(row)} />
              ))}
            </ul>
          )}
        </Card>

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
