"use client";

/**
 * A staff account, made by an administrator.
 *
 * Nurses and administrators only. A doctor joins through Doctor requests,
 * where their PMDC registration and documents are checked first; the API would
 * create one here too, with a placeholder licence number, and offering that
 * would be a way round the check that makes a doctor's account mean something.
 * Patients register themselves — the server refuses to make one here at all.
 *
 * No password is chosen in this form. The server generates one, returns it
 * exactly once, and stores only its hash; it is shown here character for
 * character with a copy button, because a temporary password retyped from a
 * screen by hand is the usual way the first sign-in fails.
 */

import { useState, type FormEvent } from "react";

import { Icon } from "@/components/Icon";
import { Segmented } from "@/components/forms";
import { Dialog } from "@/components/overlays";
import { Button, Field, Input } from "@/components/ui";
import { ApiError, users, type AccountRow } from "@/lib/api";
import { useTr } from "@/lib/lang";

type StaffRole = "NURSE" | "ADMIN";

export function StaffAccountDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (account: AccountRow) => void;
}) {
  const tr = useTr();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<StaffRole>("NURSE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [made, setMade] = useState<(AccountRow & { temporaryPassword?: string }) | null>(null);
  const [copied, setCopied] = useState(false);

  const close = () => {
    setName("");
    setEmail("");
    setPhone("");
    setRole("NURSE");
    setError(null);
    setMade(null);
    setCopied(false);
    onClose();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const account = await users.create({
        name: name.trim(),
        email: email.trim(),
        role,
        phone: phone.trim() || undefined,
      });
      setMade(account);
      onCreated(account);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError("INTERNAL_ERROR", tr("The account could not be made.", "Account nahi ban saka."), 0),
      );
    } finally {
      setBusy(false);
    }
  };

  const ready = name.trim().length >= 2 && /.+@.+\..+/.test(email.trim());

  return (
    <Dialog
      open={open}
      onClose={close}
      icon="person_add"
      title={made ? tr("Account made", "Account ban gaya") : tr("Add a staff account", "Staff account banayein")}
      description={
        made
          ? undefined
          : tr(
              "For nurses and administrators. Doctors join through Doctor requests, after their registration is checked.",
              "Nurses aur admins ke liye. Doctors registration ki jaanch ke baad Doctor requests se aate hain.",
            )
      }
      footer={
        made ? (
          <Button onClick={close}>{tr("Done", "Ho gaya")}</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              {tr("Cancel", "Cancel")}
            </Button>
            <Button type="submit" form="staff-account" loading={busy} disabled={!ready}>
              {tr("Make the account", "Account banayein")}
            </Button>
          </>
        )
      }
    >
      {made ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-strong">
            {tr(
              `${made.name} can sign in now with ${made.email}.`,
              `${made.name} ab ${made.email} se sign in kar sakte hain.`,
            )}
          </p>
          {made.temporaryPassword && (
            <div className="flex flex-col gap-2 rounded-2xl border border-warning/40 bg-warning-soft p-4">
              <p className="text-[13px] font-semibold text-warning">
                {tr("Temporary password — shown this once", "Arzi password — sirf abhi dikhaya ja raha hai")}
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 rounded-lg bg-card px-3 py-2 font-mono text-[15px] font-semibold tracking-wide break-all text-strong select-all">
                  {made.temporaryPassword}
                </code>
                <Button
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard?.writeText(made.temporaryPassword ?? "").then(() => setCopied(true));
                  }}
                >
                  <Icon name={copied ? "check" : "content_copy"} className="text-[18px]" />
                  {copied ? tr("Copied", "Copy ho gaya") : tr("Copy", "Copy")}
                </Button>
              </div>
              <p className="text-[12.5px] text-strong">
                {tr(
                  "Give it to them in person or over the phone, exactly as written — letters are case-sensitive. Ask them to change it after they first sign in. It cannot be shown again.",
                  "Yeh unhein khud ya phone par, bilkul aise hi dein — chhote bade huroof ka farq hai. Pehli dafa sign in ke baad isay badalne ko kahein. Yeh dobara nahi dikhaya ja sakta.",
                )}
              </p>
            </div>
          )}
        </div>
      ) : (
        <form id="staff-account" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <Segmented<StaffRole>
            fill
            label={tr("Role", "Kirdar")}
            value={role}
            onChange={setRole}
            options={[
              { value: "NURSE", label: tr("Nurse", "Nurse"), icon: "medical_services" },
              { value: "ADMIN", label: tr("Administrator", "Admin"), icon: "admin_panel_settings" },
            ]}
          />
          <Field label={tr("Full name", "Poora naam")} htmlFor="staff-name" error={error?.fieldError("name")}>
            <Input id="staff-name" value={name} maxLength={120} autoComplete="off" onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field
            label={tr("Email", "Email")}
            htmlFor="staff-email"
            hint={tr("They sign in with this.", "Is se woh sign in karenge.")}
            error={error?.fieldError("email")}
          >
            <Input
              id="staff-email"
              type="email"
              value={email}
              maxLength={200}
              autoComplete="off"
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label={tr("Phone (optional)", "Phone (ikhtiyari)")} htmlFor="staff-phone" error={error?.fieldError("phone")}>
            <Input
              id="staff-phone"
              type="tel"
              value={phone}
              maxLength={20}
              placeholder="03XX XXX XXXX"
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>
          {role === "ADMIN" && (
            <p className="flex items-start gap-2 rounded-xl bg-sunken px-3.5 py-2.5 text-[13px] text-strong">
              <Icon name="shield_person" className="mt-px shrink-0 text-[17px] text-warning" />
              {tr(
                "An administrator can see every account, suspend and remove them, and read the audit trail. Making one is recorded against your name.",
                "Admin har account dekh sakta hai, muattal aur khatam kar sakta hai, aur audit trail parh sakta hai. Yeh aap ke naam se darj hota hai.",
              )}
            </p>
          )}
          {error && !error.details.length && (
            <p role="alert" className="flex items-center gap-1.5 text-sm font-medium text-critical">
              <Icon name="error" className="text-[16px]" />
              {error.message}
            </p>
          )}
        </form>
      )}
    </Dialog>
  );
}
