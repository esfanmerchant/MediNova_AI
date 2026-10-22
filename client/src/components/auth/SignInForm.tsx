"use client";

/**
 * Sign in, in one of two places.
 *
 * `/login` is the public door, for patients and doctors. Administrators have no
 * tab there any more: the administration console is reached by its own address,
 * `/admin`, which shows this form — without the role tabs or the invitation to
 * register — to anybody who is not signed in. Nothing about who an account is
 * comes from which door it used. The server decides that from the account, and
 * the tabs below are copy: they change the words and nothing else, and nothing
 * on this form sends them.
 *
 * Every refusal here is a door rather than a wall. An unverified email, a
 * doctor still awaiting approval, a half-finished profile — each of those is a
 * real state with a real next step, so each gets a banner that carries the step
 * instead of a sentence that ends the conversation.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { Icon } from "@/components/Icon";
import { AUTH_LINK, AuthHeading, AuthNotice, MarkBadge, PasswordField } from "@/components/auth/parts";
import { Segmented } from "@/components/forms";
import { Button, Checkbox, Field, Input, Loading, cx } from "@/components/ui";
import { ApiError, auth, type DeviceClass } from "@/lib/api";
import { useTr } from "@/lib/lang";
import { homePathFor, useSession } from "@/lib/session";

/** Which words a public visit gets. Never sent anywhere — see the note above. */
type Audience = "PATIENT" | "DOCTOR";

/** `public` is `/login`; `admin` is the console's own sign-in at `/admin`. */
export type SignInPortal = "public" | "admin";

/** Codes that get their own banner below; anything else falls back to the
    server's own message rather than being silently swallowed. */
const HANDLED = new Set<ApiError["code"]>([
  "EMAIL_NOT_VERIFIED",
  "PENDING_APPROVAL",
  "APPLICATION_REJECTED",
  "PROFILE_INCOMPLETE",
  "ACCOUNT_LOCKED",
  "RATE_LIMITED",
  "INVALID_CREDENTIALS",
]);

export function SignInForm({ portal }: { portal: SignInPortal }) {
  const router = useRouter();
  const params = useSearchParams();
  const { signIn, user, loading } = useSession();
  const tr = useTr();
  const admin = portal === "admin";

  const [audience, setAudience] = useState<Audience>("PATIENT");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  // Everybody signs in on the personal window.
  //
  // There used to be a choice here between "my own device" (fifteen minutes of
  // idle) and "a shared hospital terminal" (two). It was the wrong question to
  // put in front of somebody who is just trying to sign in, and picking the
  // second — or having picked it once, because the answer was *remembered in
  // localStorage* — meant being signed out after two minutes of reading a
  // record without touching the mouse. That is what "it keeps logging me out"
  // was.
  //
  // Signing in writes PERSONAL over whatever was remembered, so anybody who
  // once chose the terminal is back on the fifteen-minute window from their
  // next sign-in. The class the *server* honours is fixed when the session
  // opens, so an existing terminal session keeps its two minutes until then —
  // one more sign-out, and no more after that.
  //
  // Personal unless somebody says otherwise, and the checkbox below is the
  // otherwise. It defaults to unticked because most sign-ins are somebody's
  // own phone, and a default that logs a patient out every two minutes is the
  // one people complain about rather than the one they are protected by.
  const [shared, setShared] = useState(false);
  const deviceClass: DeviceClass = shared ? "SHARED_TERMINAL" : "PERSONAL";

  const reason = params.get("reason");
  const reasons: Record<string, string> = {
    expired: tr(
      "You were signed out after a period of inactivity. Sign in again to continue.",
      "Ghair-faal rehne ki wajah se aap sign out ho gaye the. Jari rakhne ke liye dobara login karein.",
    ),
    "signed-out": tr(
      "Your session ended. Sign in again to continue.",
      "Aap ka session khatam ho gaya. Jari rakhne ke liye dobara login karein.",
    ),
    registered: tr(
      "Your account is ready. Sign in to continue.",
      "Aap ka account tayyar hai. Jari rakhne ke liye login karein.",
    ),
    reset: tr(
      "Your password has been changed. Sign in with the new one.",
      "Aap ka password badal diya gaya hai. Naye password se login karein.",
    ),
  };

  const copy: Record<Audience, { subtitle: string; hint?: string }> = {
    PATIENT: {
      subtitle: tr("Sign in to your account.", "Apne account mein login karein."),
    },
    DOCTOR: {
      subtitle: tr("Sign in to your clinical dashboard.", "Apne clinical dashboard mein login karein."),
      hint: tr("You can only sign in once your account is approved.", "Account approval ke baad hi login hoga."),
    },
  };

  // Already signed in — do not show the form again. Only the public door does
  // this: the console's own sign-in sits inside the console's layout, which
  // decides what a signed-in visitor sees there.
  useEffect(() => {
    if (!admin && !loading && user) router.replace(homePathFor(user.role));
  }, [admin, user, loading, router]);

  /** The way out of `EMAIL_NOT_VERIFIED`: a fresh code, then the code screen. */
  async function sendVerificationCode() {
    setResending(true);
    try {
      await auth.resendCode({ email: email.trim() });
    } catch {
      // A refused resend is not a reason to strand anyone: an earlier code may
      // still be in the inbox, and the verify screen can ask for another.
    } finally {
      setResending(false);
      router.push(`/verify-email?email=${encodeURIComponent(email.trim())}`);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      // Note what is *not* here: the audience tabs. The account decides the role.
      const result = await signIn(email, password, deviceClass);
      if (result.requires2FA) {
        // Not a failure — the second factor is the rest of signing in. The
        // code screen is told which door this was, so "back" returns to it.
        router.push(
          `/login/2fa?challenge=${encodeURIComponent(result.challengeId)}&method=${result.method}` +
            (deviceClass === "SHARED_TERMINAL" ? "&shared=1" : "") +
            (admin ? "&portal=admin" : ""),
        );
        return;
      }
      // On the console's own sign-in there is nowhere to go: the page asked
      // for is already this one, and the layout around it shows it now that
      // somebody is signed in.
      if (admin) return;
      // The server's answer, not the role's default: an unapproved doctor
      // goes to their application, not to a dashboard that refuses them.
      router.replace(result.redirectTo || homePathFor(result.user.role));
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError("INTERNAL_ERROR", "Something went wrong. Try again.", 500),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Loading label={tr("Checking your session", "Session check ho raha hai")} />;

  return (
    <div className="w-full">
      {admin ? (
        <>
          <AuthHeading
            badge={<MarkBadge />}
            title={tr("Administrator sign-in", "Admin login")}
            subtitle={tr("Sign in to the administration console.", "Intezamia console mein login karein.")}
          />
          <p className="mb-5 px-1 text-[13px] leading-snug text-muted">
            {tr("Administrator accounts are created by the hospital.", "Intezamia ke accounts hospital banata hai.")}
          </p>
        </>
      ) : (
        <>
          <AuthHeading
            badge={<MarkBadge />}
            title={tr("Welcome back", "Khush aamdeed")}
            subtitle={copy[audience].subtitle}
          />

          <Segmented<Audience>
            className="mb-2 w-full"
            label={tr("Who is signing in", "Kaun login kar raha hai")}
            value={audience}
            onChange={setAudience}
            options={[
              { value: "PATIENT", label: tr("Patient", "Mareez"), icon: "person" },
              { value: "DOCTOR", label: tr("Doctor", "Doctor"), icon: "stethoscope" },
            ]}
          />
          <p className="mb-5 min-h-[18px] px-1 text-[13px] leading-snug text-muted">{copy[audience].hint}</p>
        </>
      )}

      {reason && reasons[reason] && (
        <AuthNotice tone={reason === "reset" ? "success" : "warning"} live="status" icon="info">
          {reasons[reason]}
        </AuthNotice>
      )}

      {error?.code === "EMAIL_NOT_VERIFIED" && (
        <AuthNotice
          tone="warning"
          title={tr("This email is not verified yet", "Yeh email abhi tasdeeq nahi hui")}
          action={
            <Button type="button" variant="secondary" loading={resending} onClick={sendVerificationCode}>
              {tr("Send a code", "Code bhejein")}
            </Button>
          }
        >
          {tr(
            "We will send a fresh six-digit code to this address.",
            "Hum is pate par naya chhe hindson ka code bhejenge.",
          )}
        </AuthNotice>
      )}

      {(error?.code === "PENDING_APPROVAL" || error?.code === "APPLICATION_REJECTED") && (
        <AuthNotice
          tone={error.code === "PENDING_APPROVAL" ? "warning" : "critical"}
          title={
            error.code === "PENDING_APPROVAL"
              ? tr("Your application is still being reviewed", "Aap ki darkhwast abhi zer-e-ghaur hai")
              : tr("Your application was not approved", "Aap ki darkhwast manzoor nahi hui")
          }
          action={
            <Link href="/doctor/pending" className={cx(AUTH_LINK, "inline-flex items-center gap-1")}>
              {tr("See your application", "Apni darkhwast dekhein")}
              <Icon name="arrow_forward" className="text-[16px]" />
            </Link>
          }
        >
          {error.code === "PENDING_APPROVAL"
            ? tr(
                "An administrator has to approve the account before it can sign in.",
                "Login se pehle intezamia ko account manzoor karna hoga.",
              )
            : tr(
                "The reason, and what to do next, are on your application page.",
                "Wajah aur agla qadam aap ki darkhwast ke safhe par hai.",
              )}
        </AuthNotice>
      )}

      {error?.code === "PROFILE_INCOMPLETE" && (
        <AuthNotice
          tone="warning"
          title={tr("Your profile is not finished", "Aap ki profile mukammal nahi hui")}
          action={
            <Link
              href="/doctor/onboarding"
              className={cx(AUTH_LINK, "inline-flex items-center gap-1")}
            >
              {tr("Finish your profile", "Profile mukammal karein")}
              <Icon name="arrow_forward" className="text-[16px]" />
            </Link>
          }
        >
          {tr(
            "Fill in the remaining details and the account goes for approval.",
            "Baqi tafseelat bhar dein, phir account manzoori ke liye chala jayega.",
          )}
        </AuthNotice>
      )}

      {error?.code === "ACCOUNT_LOCKED" && (
        <AuthNotice tone="critical" title={tr("This account is locked", "Yeh account band hai")}>
          {tr(
            "Too many failed attempts. Contact the hospital to have it unlocked.",
            "Bohat zyada nakaam koshishein. Khulwane ke liye hospital se rabta karein.",
          )}
        </AuthNotice>
      )}

      {error?.code === "RATE_LIMITED" && (
        <AuthNotice tone="warning" title={tr("Too many attempts", "Bohat zyada koshishein")}>
          {tr("Wait a moment and try again.", "Thora intezaar karein aur dobara koshish karein.")}
        </AuthNotice>
      )}

      {error?.code === "INVALID_CREDENTIALS" && (
        <AuthNotice tone="critical">
          {tr(
            "That email and password do not match an account.",
            "Yeh email aur password kisi account se nahi milte.",
          )}
        </AuthNotice>
      )}

      {error && !HANDLED.has(error.code) && <AuthNotice tone="critical">{error.message}</AuthNotice>}

      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <Field label={tr("Email", "Email")} htmlFor="email" error={error?.fieldError("email")}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            invalid={Boolean(error?.fieldError("email"))}
          />
        </Field>

        <div className="space-y-1.5">
          <PasswordField
            id="password"
            label={tr("Password", "Password")}
            value={password}
            onChange={setPassword}
            error={error?.fieldError("password")}
          />
          <p className="text-right">
            <Link href="/forgot-password" className={cx(AUTH_LINK, "text-sm")}>
              {tr("Forgot your password?", "Password bhool gaye?")}
            </Link>
          </p>
        </div>

        {/* The one thing the server cannot work out for itself.
            ------------------------------------------------------
            A reception desk and a doctor's own phone send identical requests,
            and the difference between them is the whole reason the session
            rules are tiered: the next person to touch a ward terminal is a
            stranger, and the next person to touch a phone is its owner. Only
            the person signing in knows which they are at.

            Ticked, the session ends after two minutes of inactivity instead of
            lasting a week — so it is worded as the fact ("this is a shared
            computer") with the consequence under it, not as a setting. */}
        <Checkbox
          checked={shared}
          onChange={(event) => setShared(event.target.checked)}
          label={
            <span>
              {tr("This is a shared computer", "Yeh mushtarka computer hai")}
              <span className="mt-0.5 block text-[13px] text-muted">
                {tr(
                  "Signs out after two minutes of inactivity.",
                  "Do minute ghair-faal rehne par khud sign out ho jayega.",
                )}
              </span>
            </span>
          }
        />

        <Button type="submit" size="lg" className="btn-shine w-full" loading={submitting}>
          {submitting ? tr("Signing in…", "Login ho raha hai…") : tr("Sign in", "Login karein")}
          {!submitting && <Icon name="arrow_forward" className="text-[20px]" />}
        </Button>
      </form>

      {/* Registration is for patients. The console's sign-in does not invite
          anybody to make an account, because there is no such thing as
          signing up to be an administrator. */}
      {!admin && (
        <p className="mt-7 border-t border-line pt-5 text-center text-sm text-muted">
          {tr("New patient?", "Naye mareez hain?")}{" "}
          <Link href="/register" className={AUTH_LINK}>
            {tr("Create an account", "Account banayein")}
          </Link>
        </p>
      )}
    </div>
  );
}
