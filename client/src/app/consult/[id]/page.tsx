"use client";

/**
 * The online consultation room — one page for both sides of the call.
 *
 * It walks through three moments and is honest about each:
 *
 * 1. **Before.** Whether the room is open, and if not, the one thing in the
 *    way — the doctor has not confirmed, the bill is not paid, it is not time
 *    yet. Camera and microphone are checked here, while nobody is waiting.
 * 2. **During.** The call, with the patient's essentials beside it for the
 *    doctor: allergies, what they already take, and a prescription pad linked
 *    to the pharmacy.
 * 3. **After.** For the doctor, the note that completes the consultation; for
 *    the patient, what happens next and where their medicines can be ordered.
 *
 * Its own layout rather than the portal shell: a call wants the screen, and on
 * a phone the portal's navigation would take a third of it.
 *
 * **This page must be a document of its own.** Its security headers — the
 * camera and microphone permission, and the content policy that lets the video
 * service run — are sent with the document. Arriving by a client-side link
 * would keep the previous page's headers, which forbid the camera outright, so
 * the page reloads itself once when that happens.
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { DeviceCheck } from "@/components/consult/DeviceCheck";
import type { CallEnd } from "@/components/consult/VideoCall";
import { Icon } from "@/components/Icon";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Logo } from "@/components/Logo";
import { PayInvoice } from "@/components/PayInvoice";
import { PrescribeCard } from "@/components/PrescribeCard";
import { PrescriptionRow } from "@/components/records";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Loading,
  Textarea,
  cx,
} from "@/components/ui";
import {
  ApiError,
  appointments,
  patients,
  prescriptions as prescriptionsApi,
  type Appointment,
  type RoomState,
  type VideoRoom,
  type VideoToken,
} from "@/lib/api";
import { useTr } from "@/lib/lang";
import { homePathFor, useSession } from "@/lib/session";
import { useAsync } from "@/lib/useAsync";

const VideoCall = dynamic(() => import("@/components/consult/VideoCall"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center rounded-2xl bg-slate-950 text-sm text-white/80">
      Loading the video room…
    </div>
  ),
});

type Phase = "lobby" | "joining" | "call" | "after";

/** States in which the call is still going to happen, so a device check helps. */
const UPCOMING: RoomState[] = ["OPEN", "TOO_EARLY", "UNPAID", "PAYMENT_UNDER_REVIEW", "NOT_CONFIRMED"];

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function dayOf(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function ConsultationRoom() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useSession();
  const router = useRouter();
  const tr = useTr();

  // A document of its own, with its own headers — see the module note.
  useEffect(() => {
    const entry = performance.getEntriesByType?.("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (entry && !new URL(entry.name).pathname.startsWith("/consult/")) {
      window.location.replace(window.location.href);
    }
  }, []);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const [phase, setPhase] = useState<Phase>("lobby");
  const [token, setToken] = useState<VideoToken | null>(null);
  const [ending, setEnding] = useState<CallEnd | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [paying, setPaying] = useState(false);

  const appointment = useAsync(
    () => (user ? appointments.get(id) : Promise.resolve(null)),
    [id, user?.id],
    { live: false },
  );
  const room = useAsync(
    () => (user ? appointments.video(id) : Promise.resolve(null)),
    [id, user?.id],
    // Watched while waiting: a payment confirmed or a clock reaching ten to
    // should open the door without anybody pressing refresh.
    { refreshMs: 15_000, live: phase === "lobby" },
  );

  if (loading || (user && appointment.loading && !appointment.data)) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-16">
        <Loading label={tr("Opening the consultation room", "Consultation room khul raha hai")} />
      </main>
    );
  }
  if (!user) return null;

  const home = homePathFor(user.role);
  const appt = appointment.data;
  const state = room.data;
  const isDoctor = user.role === "DOCTOR";
  const counterpart = isDoctor
    ? appt?.patientName ?? tr("your patient", "aap ka mareez")
    : appt?.doctorName ?? tr("your doctor", "aap ke doctor");

  const join = async () => {
    setJoinError(null);
    setPhase("joining");
    try {
      setToken(await appointments.videoToken(id));
      setPhase("call");
    } catch (caught) {
      setJoinError(
        caught instanceof ApiError
          ? caught.message
          : tr("Could not open the room.", "Room khul nahi saka."),
      );
      setPhase("lobby");
      room.reload();
    }
  };

  return (
    <div className="min-h-screen bg-canvas">
      <header className="safe-top sticky top-0 z-30 border-b border-line bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <Link
            href={isDoctor ? "/doctor/appointments" : "/patient/appointments"}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-primary hover:bg-gradient-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Icon name="arrow_back" className="text-[20px]" />
            <span className="hidden sm:inline">{tr("Appointments", "Appointments")}</span>
          </Link>
          <Link href={home} className="hidden sm:block" aria-label="MediNova AI">
            <Logo size="sm" />
          </Link>
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <p className="truncate font-display text-base font-bold text-strong sm:text-lg">
              {tr("Online consultation", "Online consultation")}
            </p>
            {appt && (
              <p className="truncate text-xs text-muted">
                {tr("with", "ke saath")} {counterpart} · {dayOf(appt.startTime)}, {timeOf(appt.startTime)}
              </p>
            )}
          </div>
          <LanguageToggle />
        </div>
      </header>

      <main id="main" className="mx-auto max-w-7xl px-4 py-5 sm:py-8">
        {appointment.error ? (
          <ErrorState
            title={tr("This consultation could not be found", "Yeh consultation nahi mili")}
            message={appointment.error.message}
          />
        ) : !appt ? null : !["DOCTOR", "PATIENT"].includes(user.role) ? (
          <ErrorState
            title={tr("Only the patient and the doctor join a consultation", "Consultation mein sirf mareez aur doctor shamil hote hain")}
            message={tr(
              "Administrators can see that it exists, but not sit in on it.",
              "Administrator dekh sakte hain ke yeh maujood hai, magar shamil nahi ho sakte.",
            )}
          />
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            {/* The stage: lobby, call, or what came after. */}
            <section aria-label={tr("Video", "Video")} className="min-w-0">
              {phase === "call" && token ? (
                <div className="h-[68vh] min-h-[420px] lg:h-[min(72vh,720px)]">
                  <VideoCall
                    session={token}
                    counterpart={counterpart}
                    endsAt={appt.endTime}
                    onEnd={(how) => {
                      setEnding(how);
                      setPhase("after");
                    }}
                  />
                </div>
              ) : phase === "after" ? (
                <AfterCall
                  how={ending}
                  isDoctor={isDoctor}
                  appointment={appt}
                  onCompleted={() => appointment.reload()}
                />
              ) : (
                <Lobby
                  room={state}
                  roomError={room.error?.message ?? null}
                  isDoctor={isDoctor}
                  counterpart={counterpart}
                  checked={checked}
                  joining={phase === "joining"}
                  joinError={joinError}
                  onChecked={() => setChecked(true)}
                  onJoin={() => void join()}
                  onPay={() => setPaying(true)}
                />
              )}
            </section>

            <aside className="space-y-6" aria-label={tr("Details", "Tafseel")}>
              {isDoctor ? (
                <DoctorPanel appointment={appt} />
              ) : (
                <PatientPanel appointment={appt} room={state} onPay={() => setPaying(true)} />
              )}
            </aside>
          </div>
        )}
      </main>

      {state?.invoice && !isDoctor && (
        <PayInvoice
          invoice={state.invoice}
          open={paying}
          onClose={() => setPaying(false)}
          onSubmitted={() => {
            setPaying(false);
            room.reload();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Before the call
// ---------------------------------------------------------------------------

function Lobby({
  room,
  roomError,
  isDoctor,
  counterpart,
  checked,
  joining,
  joinError,
  onChecked,
  onJoin,
  onPay,
}: {
  room: VideoRoom | null;
  roomError: string | null;
  isDoctor: boolean;
  counterpart: string;
  checked: boolean;
  joining: boolean;
  joinError: string | null;
  onChecked: () => void;
  onJoin: () => void;
  onPay: () => void;
}) {
  const tr = useTr();
  const now = useNow();

  if (roomError && !room) return <ErrorState message={roomError} />;
  if (!room) {
    return (
      <div className="grid aspect-video place-items-center rounded-2xl border border-line bg-card">
        <Loading label={tr("Checking the room", "Room check ho raha hai")} />
      </div>
    );
  }

  const opensIn = new Date(room.opensAt).getTime() - now;
  const upcoming = UPCOMING.includes(room.state);

  const banner: { tone: "good" | "info" | "warning" | "neutral"; icon: string; title: string; body: string } = (() => {
    switch (room.state) {
      case "OPEN":
        return {
          tone: "good",
          icon: "meeting_room",
          title: tr("The room is open", "Room khul gaya hai"),
          body: isDoctor
            ? tr("Join when you are ready — joining starts the consultation.", "Tayyar hon to join karein — join karna consultation shuru karta hai.")
            : tr(`${counterpart} will see you here.`, `${counterpart} aap ko yahin dekhenge.`),
        };
      case "TOO_EARLY":
        return {
          tone: "info",
          icon: "schedule",
          title: tr(`The room opens in ${countdown(opensIn)}`, `Room ${countdown(opensIn)} mein khulega`),
          body: tr(
            `At ${timeOf(room.opensAt)}, ten minutes before the start. Check your camera and microphone now so you are ready.`,
            `${timeOf(room.opensAt)} par, shuru se das minute pehle. Abhi camera aur mic check kar lein taake tayyar rahein.`,
          ),
        };
      case "UNPAID":
        return {
          tone: "warning",
          icon: "payments",
          title: isDoctor ? tr("Not paid yet", "Abhi payment nahi hui") : tr("Pay to join", "Join karne ke liye payment karein"),
          body: isDoctor
            ? tr("The patient has not paid for this consultation yet. The room opens once they have.", "Mareez ne abhi is consultation ki payment nahi ki. Payment ke baad room khulega.")
            : tr("The room opens once your payment is confirmed. It only takes a minute.", "Payment confirm hote hi room khul jaye ga. Bas aik minute lagta hai."),
        };
      case "PAYMENT_UNDER_REVIEW":
        return {
          tone: "info",
          icon: "hourglass_top",
          title: tr("Payment being checked", "Payment check ho rahi hai"),
          body: tr("The room opens as soon as the payment is confirmed. This page will update by itself.", "Payment confirm hote hi room khul jaye ga. Yeh page khud update ho jaye ga."),
        };
      case "NOT_CONFIRMED":
        return {
          tone: "info",
          icon: "pending_actions",
          title: isDoctor ? tr("Confirm this consultation first", "Pehle is consultation ki tasdeeq karein") : tr("Waiting for the doctor to confirm", "Doctor ki tasdeeq ka intezar"),
          body: isDoctor
            ? tr("Confirm it from your appointments; the patient is then asked to pay.", "Apni appointments se tasdeeq karein; phir mareez se payment ka kaha jaye ga.")
            : room.message,
        };
      default:
        return { tone: "neutral", icon: "info", title: room.message, body: "" };
    }
  })();

  const tones = {
    good: "border-stable/40 bg-stable-soft text-stable",
    info: "border-info/40 bg-info-soft text-info",
    warning: "border-warning/40 bg-warning-soft text-warning",
    neutral: "border-line bg-sunken text-muted",
  } as const;

  return (
    <div className="space-y-5">
      <div role="status" className={cx("flex flex-wrap items-start gap-3 rounded-2xl border p-4", tones[banner.tone])}>
        <Icon name={banner.icon} filled className="mt-0.5 shrink-0 text-[24px]" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-bold">{banner.title}</p>
          {banner.body && <p className="mt-0.5 text-sm text-strong">{banner.body}</p>}
        </div>
        {room.state === "UNPAID" && !isDoctor && room.invoice && (
          // Under the words on a phone, beside them where there is room.
          <div className="w-full sm:w-auto">
            <Button onClick={onPay} className="w-full sm:w-auto">
              <Icon name="payments" className="text-[20px]" />
              {tr("Pay now", "Abhi ada karein")}
            </Button>
          </div>
        )}
      </div>

      {upcoming ? (
        <Card
          icon="settings_video_camera"
          title={tr("Camera and microphone", "Camera aur mic")}
          description={tr(
            "A quick check, so the call starts with both of you seen and heard.",
            "Aik choti si jaanch, taake call shuru hote hi dono ek doosre ko dekh aur sun saken.",
          )}
        >
          {checked ? (
            <div className="space-y-4">
              <p className="flex items-center gap-2 font-semibold text-stable">
                <Icon name="check_circle" filled className="text-[22px]" />
                {tr("Your camera and microphone are ready.", "Aap ka camera aur mic tayyar hain.")}
              </p>
              {joinError && (
                <p role="alert" className="rounded-xl border border-critical/40 bg-critical-soft px-4 py-3 text-sm font-medium text-critical">
                  {joinError}
                </p>
              )}
              <Button
                size="lg"
                disabled={!room.canJoin || joining}
                loading={joining}
                onClick={onJoin}
              >
                <Icon name="videocam" className="text-[22px]" />
                {room.canJoin
                  ? isDoctor
                    ? tr("Start the consultation", "Consultation shuru karein")
                    : tr("Join the consultation", "Consultation mein shamil hon")
                  : tr("Waiting for the room to open", "Room khulne ka intezar")}
              </Button>
            </div>
          ) : (
            <DeviceCheck onReady={onChecked} />
          )}
        </Card>
      ) : (
        <EmptyState
          icon={room.state === "ENDED" ? "task_alt" : "event_busy"}
          title={room.message}
          action={
            <Link
              href={isDoctor ? "/doctor/appointments" : "/patient/appointments"}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-card px-4 font-semibold text-primary hover:bg-sunken"
            >
              {tr("Back to appointments", "Appointments par wapas")}
            </Link>
          }
        />
      )}

      <ul className="grid grid-cols-1 gap-3 text-sm text-muted sm:grid-cols-3">
        {[
          { icon: "lock", text: tr("Private, and never recorded.", "Mehfooz, aur kabhi record nahi hoti.") },
          { icon: "wb_sunny", text: tr("Sit facing a light, somewhere quiet.", "Roshni ki taraf munh kar ke, khamosh jagah baithein.") },
          { icon: "headphones", text: tr("Earphones help everyone hear clearly.", "Earphones se awaz saaf aati hai.") },
        ].map((tip) => (
          <li key={tip.icon} className="flex items-start gap-2 rounded-xl border border-line bg-card p-3">
            <Icon name={tip.icon} className="mt-px shrink-0 text-[18px] text-primary" />
            {tip.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// After the call
// ---------------------------------------------------------------------------

function AfterCall({
  how,
  isDoctor,
  appointment,
  onCompleted,
}: {
  how: CallEnd | null;
  isDoctor: boolean;
  appointment: Appointment;
  onCompleted: () => void;
}) {
  const tr = useTr();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(appointment.status === "COMPLETED");

  const failed = how?.kind === "failed";

  const complete = async () => {
    setBusy(true);
    setError(null);
    try {
      await appointments.setStatus(appointment.id, "COMPLETED", notes || undefined);
      setDone(true);
      onCompleted();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : tr("Could not complete the consultation.", "Consultation mukammal nahi ho saki."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-line bg-card p-6 shadow-card">
        <div className="flex flex-wrap items-start gap-4">
          <span
            aria-hidden
            className={cx(
              "grid h-12 w-12 shrink-0 place-items-center rounded-full",
              failed ? "bg-critical-soft text-critical" : "bg-stable-soft text-stable",
            )}
          >
            <Icon name={failed ? "wifi_off" : "call_end"} className="text-[26px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-xl font-bold text-strong">
              {failed
                ? tr("The call could not continue", "Call jari nahi reh saki")
                : how?.kind === "left"
                  ? tr("You left the call", "Aap call se nikal gaye")
                  : tr("The consultation has ended", "Consultation khatam ho gayi")}
            </p>
            <p className="mt-1 text-sm text-muted">
              {failed
                ? tr(
                    `The video service said: “${how.reason}”. Check your connection and join again.`,
                    `Video service ne kaha: “${how.reason}”. Apna connection check kar ke dobara join karein.`,
                  )
                : isDoctor
                  ? tr("Write your note to complete it. The patient sees it in their record.", "Mukammal karne ke liye note likhein. Mareez ise apne record mein dekhe ga.")
                  : tr(
                      "Your doctor will add their notes and any prescription to your record.",
                      "Aap ke doctor apne notes aur nuskha aap ke record mein shamil karenge.",
                    )}
            </p>
          </div>
        </div>
        {(failed || how?.kind === "left") && (
          <Button className="mt-4" variant="secondary" onClick={() => window.location.reload()}>
            <Icon name="refresh" className="text-[20px]" />
            {tr("Join again", "Dobara join karein")}
          </Button>
        )}
      </div>

      {isDoctor && !failed && (
        <Card icon="task_alt" title={tr("Complete the consultation", "Consultation mukammal karein")}>
          {done ? (
            <div className="space-y-3">
              <p className="flex items-center gap-2 font-semibold text-stable">
                <Icon name="check_circle" filled className="text-[22px]" />
                {tr("Completed. Your earning has been credited.", "Mukammal. Aap ki kamai account mein shamil ho gayi.")}
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href={`/doctor/patients/${appointment.patientId}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-card px-4 font-semibold text-primary hover:bg-sunken">
                  <Icon name="folder_shared" className="text-[20px]" />
                  {tr("Open the chart", "Chart kholein")}
                </Link>
                <Link href="/doctor/appointments" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-4 font-semibold text-primary hover:bg-gradient-soft">
                  {tr("Back to appointments", "Appointments par wapas")}
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <Field label={tr("Consultation note", "Consultation note")} htmlFor="consult-notes">
                <Textarea
                  id="consult-notes"
                  rows={4}
                  maxLength={2000}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder={tr("What was discussed, and what happens next.", "Kya baat hui, aur aage kya hoga.")}
                />
              </Field>
              {error && (
                <p role="alert" className="text-sm font-medium text-critical">
                  {error}
                </p>
              )}
              <Button disabled={busy} loading={busy} onClick={() => void complete()}>
                <Icon name="task_alt" className="text-[20px]" />
                {tr("Complete consultation", "Consultation mukammal karein")}
              </Button>
            </div>
          )}
        </Card>
      )}

      {!isDoctor && !failed && (
        <Card icon="local_pharmacy" title={tr("Your medicines, delivered", "Aap ki dawaiyan, ghar par")}>
          <p className="text-sm text-muted">
            {tr(
              "Once your doctor adds a prescription, order it from the MediNova pharmacy — cash on delivery or online payment.",
              "Doctor ke nuskha likhne ke baad, MediNova pharmacy se order karein — cash on delivery ya online payment.",
            )}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/patient/pharmacy" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-gradient-brand px-4 font-semibold text-white shadow-sm">
              <Icon name="medication" className="text-[20px]" />
              {tr("Go to the pharmacy", "Pharmacy par jayein")}
            </Link>
            <Link href="/patient/records" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-card px-4 font-semibold text-primary hover:bg-sunken">
              {tr("My records", "Mera record")}
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Beside the call
// ---------------------------------------------------------------------------

function DoctorPanel({ appointment }: { appointment: Appointment }) {
  const tr = useTr();
  const [refresh, setRefresh] = useState(0);
  // Opened once, not on a timer: reading a chart is audited, and a timer would
  // record looks nobody took.
  const profile = useAsync(() => patients.get(appointment.patientId), [appointment.patientId], {
    live: false,
  });
  const medication = useAsync(
    () => prescriptionsApi.list({ patientId: appointment.patientId, activeOnly: true, limit: 20 }),
    [appointment.patientId, refresh],
    { live: false },
  );
  const active = medication.data?.data ?? [];

  return (
    <>
      <Card icon="person" title={appointment.patientName ?? tr("Patient", "Mareez")}>
        {profile.loading ? (
          <Loading label={tr("Loading", "Load ho raha hai")} />
        ) : profile.data ? (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge tone="neutral">{profile.data.medicalRecordNumber}</Badge>
              {profile.data.bloodGroup && <Badge tone="info">{profile.data.bloodGroup}</Badge>}
              {profile.data.gender && <Badge tone="neutral">{profile.data.gender.toLowerCase()}</Badge>}
            </div>
            {profile.data.allergies ? (
              <p role="alert" className="flex items-start gap-2 rounded-xl border border-critical/40 border-l-4 border-l-critical bg-critical-soft px-3 py-2 font-medium text-critical">
                <Icon name="warning" filled className="mt-px shrink-0 text-[18px]" />
                {tr("Allergies:", "Allergy:")} {profile.data.allergies}
              </p>
            ) : (
              <p className="text-muted">{tr("No allergies recorded.", "Koi allergy darj nahi.")}</p>
            )}
            {profile.data.chronicConditions && (
              <p className="text-muted">
                <span className="font-semibold text-strong">{tr("Conditions:", "Bimariyan:")}</span>{" "}
                {profile.data.chronicConditions}
              </p>
            )}
            {appointment.reason && (
              <p className="text-muted">
                <span className="font-semibold text-strong">{tr("Reason for visit:", "Aane ki wajah:")}</span>{" "}
                {appointment.reason}
              </p>
            )}
            <a
              href={`/doctor/patients/${appointment.patientId}`}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
            >
              <Icon name="open_in_new" className="text-[16px]" />
              {tr("Full chart in a new tab", "Poora chart nayi tab mein")}
            </a>
          </div>
        ) : (
          <ErrorState message={profile.error?.message ?? ""} />
        )}
      </Card>

      <Card
        icon="pill"
        title={tr("Current medication", "Jari dawaiyan")}
        action={active.length > 0 && <Badge tone="good">{active.length}</Badge>}
      >
        {active.length === 0 ? (
          <p className="text-sm text-muted">{tr("Nothing active.", "Koi dawa jari nahi.")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {active.map((prescription) => (
              <li key={prescription.id}>
                <PrescriptionRow prescription={prescription} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <PrescribeCard
        patientId={appointment.patientId}
        onSaved={() => setRefresh((n) => n + 1)}
        description={tr(
          "Linked to the pharmacy, so the patient can order it with one tap.",
          "Pharmacy se juda, taake mareez aik tap se order kar sake.",
        )}
      />
    </>
  );
}

function PatientPanel({
  appointment,
  room,
  onPay,
}: {
  appointment: Appointment;
  room: VideoRoom | null;
  onPay: () => void;
}) {
  const tr = useTr();
  const invoice = room?.invoice ?? null;
  const paid = invoice && (invoice.status === "PAID" || Number(invoice.totalAmount) <= 0);

  return (
    <>
      <Card icon="stethoscope" title={appointment.doctorName ?? tr("Your doctor", "Aap ke doctor")}>
        <div className="flex items-center gap-3">
          <Avatar name={appointment.doctorName ?? "Doctor"} size="lg" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-strong">{appointment.specialization}</p>
            <p className="text-muted">
              {dayOf(appointment.startTime)} · {timeOf(appointment.startTime)}–{timeOf(appointment.endTime)}
            </p>
          </div>
        </div>
        {appointment.reason && (
          <p className="mt-3 text-sm text-muted">
            <span className="font-semibold text-strong">{tr("Your reason:", "Aap ki wajah:")}</span>{" "}
            {appointment.reason}
          </p>
        )}
      </Card>

      <Card icon="receipt_long" title={tr("Payment", "Payment")}>
        {!invoice ? (
          <p className="text-sm text-muted">
            {tr(
              "An invoice is issued when the doctor confirms this consultation.",
              "Doctor ki tasdeeq par invoice jaari hota hai.",
            )}
          </p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">{invoice.invoiceNumber}</span>
              <span className="font-display text-lg font-bold tabular-nums text-strong">
                {invoice.currency} {Number(invoice.totalAmount).toLocaleString()}
              </span>
            </div>
            {paid ? (
              <Badge tone="good">
                <Icon name="check_circle" filled className="text-[14px]" />
                {tr("Paid", "Ada shuda")}
              </Badge>
            ) : invoice.awaitingReview ? (
              <Badge tone="info">{tr("Payment being checked", "Payment check ho rahi hai")}</Badge>
            ) : (
              <Button onClick={onPay} className="w-full">
                <Icon name="payments" className="text-[20px]" />
                {tr("Pay now", "Abhi ada karein")}
              </Button>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
