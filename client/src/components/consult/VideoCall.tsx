"use client";

/**
 * The call itself: two people, one room, through Zoom's Video SDK.
 *
 * Loaded only in the browser and only on the consultation page (see its
 * `dynamic(..., { ssr: false })`): the SDK touches `window` and WebAssembly the
 * moment it is evaluated, and it is a large download nobody else should pay for.
 *
 * **Joining happens once per page, whatever React does.** Development mounts
 * every effect twice; a second `join()` is an error from the SDK and, worse, a
 * second seat in the room. So the join is a module-level promise that both
 * mounts share. Leaving is always a page navigation, which is the only reset
 * this needs.
 *
 * **The server decides who may be here.** The token this receives was signed
 * for this room and this role after the server checked the appointment, the
 * payment and the clock. Nothing on this screen can widen that.
 *
 * Nothing is recorded, and nothing here could start a recording: the token
 * carries no recording rights.
 */

import ZoomVideo, { MobileVideoFacingMode, VideoQuality } from "@zoom/videosdk";
import { useCallback, useEffect, useRef, useState } from "react";

import { Icon } from "@/components/Icon";
import { Avatar, cx } from "@/components/ui";
import type { VideoToken } from "@/lib/api";
import { useTr } from "@/lib/lang";

type Client = ReturnType<typeof ZoomVideo.createClient>;
type Stream = ReturnType<Client["getMediaStream"]>;
type Participant = ReturnType<Client["getAllUser"]>[number];

/** Created once, outside React — the SDK's own instruction. */
const client: Client = ZoomVideo.createClient();

let joining: Promise<Stream> | null = null;

function joinOnce(session: VideoToken): Promise<Stream> {
  if (!joining) {
    joining = (async () => {
      await client.init("en-US", "Global", {
        patchJsMedia: true,
        // Closing the tab leaves the room rather than leaving a ghost in it
        // until the server notices.
        leaveOnPageUnload: true,
      });
      await client.join(session.sessionName, session.token, session.userName);
      return client.getMediaStream();
    })();
    // A failed join must not be cached, or "Try again" would replay it.
    joining.catch(() => {
      joining = null;
    });
  }
  return joining;
}

/** The SDK rejects with a plain object; this turns it into a sentence. */
function reasonOf(error: unknown): string {
  if (error && typeof error === "object") {
    const shaped = error as { reason?: unknown; message?: unknown; type?: unknown };
    for (const candidate of [shaped.reason, shaped.message, shaped.type]) {
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
  }
  return error instanceof Error ? error.message : "unknown error";
}

function removeAll(detached: unknown) {
  const list = Array.isArray(detached) ? detached : [detached];
  for (const element of list) {
    if (element instanceof HTMLElement) element.remove();
  }
}

function isPhone(): boolean {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

function clock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export type CallEnd =
  | { kind: "left" }
  | { kind: "ended"; byHost: boolean }
  | { kind: "failed"; reason: string };

interface Remote {
  userId: number;
  name: string;
  videoOn: boolean;
  muted: boolean;
  unstable: boolean;
}

export default function VideoCall({
  session,
  counterpart,
  endsAt,
  onEnd,
}: {
  session: VideoToken;
  /** Who the viewer is expecting to see, before they have arrived. */
  counterpart: string;
  /** The booked end of the consultation, UTC. */
  endsAt: string;
  onEnd: (how: CallEnd) => void;
}) {
  const tr = useTr();
  const host = session.role === "host";

  const container = useRef<HTMLElement>(null);
  const stream = useRef<Stream | null>(null);
  const selfId = useRef<number | null>(null);
  const attached = useRef<Set<number>>(new Set());
  const ended = useRef(false);
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  const [phase, setPhase] = useState<"connecting" | "live" | "reconnecting">("connecting");
  const [remote, setRemote] = useState<Remote | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [busy, setBusy] = useState<"mic" | "cam" | "flip" | "leave" | null>(null);
  const [notice, setNotice] = useState<{ text: string; resume?: boolean } | null>(null);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [facing, setFacing] = useState<MobileVideoFacingMode>(MobileVideoFacingMode.User);
  const [now, setNow] = useState(() => Date.now());
  const [startedAt] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const finish = useCallback((how: CallEnd) => {
    if (ended.current) return;
    ended.current = true;
    onEndRef.current(how);
  }, []);

  // -- rendering other people's video --------------------------------------

  const remoteQuality = useCallback(
    () => (window.matchMedia("(max-width: 640px)").matches ? VideoQuality.Video_360P : VideoQuality.Video_720P),
    [],
  );

  const attachRemote = useCallback(
    async (userId: number) => {
      const media = stream.current;
      const host = container.current;
      if (!media || !host || userId === selfId.current || attached.current.has(userId)) return;
      attached.current.add(userId);
      try {
        const element = await media.attachVideo(userId, remoteQuality());
        if (element instanceof HTMLElement) {
          element.dataset.role = "remote";
          host.appendChild(element);
        } else {
          attached.current.delete(userId);
        }
      } catch {
        attached.current.delete(userId);
      }
    },
    [remoteQuality],
  );

  const detachRemote = useCallback(async (userId: number) => {
    const media = stream.current;
    attached.current.delete(userId);
    if (!media) return;
    try {
      removeAll(await media.detachVideo(userId));
    } catch {
      // Already gone — which is what was wanted.
    }
  }, []);

  /** The other person as the SDK sees them now. Events say *something* changed. */
  const syncPeople = useCallback(() => {
    const others: Participant[] = client.getAllUser().filter((user) => user.userId !== selfId.current);
    const other = others[0];
    if (!other) {
      setRemote(null);
      for (const userId of [...attached.current]) void detachRemote(userId);
      return;
    }
    setRemote({
      userId: other.userId,
      name: other.displayName,
      videoOn: other.bVideoOn,
      muted: other.muted ?? true,
      unstable: Boolean((other as { isInFailover?: boolean }).isInFailover),
    });
    for (const userId of [...attached.current]) {
      if (!others.some((user) => user.userId === userId)) void detachRemote(userId);
    }
    for (const user of others) {
      if (user.bVideoOn) void attachRemote(user.userId);
    }
  }, [attachRemote, detachRemote]);

  // -- our own camera and microphone ---------------------------------------

  const startAudio = useCallback(async () => {
    const media = stream.current;
    if (!media) return;
    try {
      await media.startAudio();
      setMicOn(!media.isAudioMuted());
      setSoundBlocked(false);
    } catch {
      // Most often the browser wanting a tap first. The button below asks.
      setSoundBlocked(true);
    }
  }, []);

  const startVideo = useCallback(async (cameraId?: string) => {
    const media = stream.current;
    const host = container.current;
    if (!media || !host || selfId.current === null) return;
    try {
      await media.startVideo(cameraId ? { cameraId } : undefined);
      const element = await media.attachVideo(selfId.current, VideoQuality.Video_360P);
      if (element instanceof HTMLElement) {
        element.dataset.role = "self";
        host.appendChild(element);
      }
      setCamOn(true);
    } catch (error) {
      setCamOn(false);
      setNotice({
        text: tr(
          `Your camera could not start (${reasonOf(error)}). You can carry on by voice.`,
          `Aap ka camera shuru nahi ho saka (${reasonOf(error)}). Aap awaz se jari rakh sakte hain.`,
        ),
      });
    }
  }, [tr]);

  const stopVideo = useCallback(async () => {
    const media = stream.current;
    if (!media || selfId.current === null) return;
    await media.stopVideo();
    removeAll(await media.detachVideo(selfId.current));
    setCamOn(false);
  }, []);

  // -- joining, and staying joined -----------------------------------------

  useEffect(() => {
    let disposed = false;

    const onConnection = (payload: { state: string; reason?: string }) => {
      const state = String(payload.state);
      if (state === "Connected") setPhase("live");
      else if (state === "Reconnecting") setPhase("reconnecting");
      else if (state === "Closed") {
        finish({ kind: "ended", byHost: String(payload.reason ?? "").includes("host") });
      } else if (state === "Fail") {
        finish({ kind: "failed", reason: String(payload.reason ?? "connection failed") });
      }
    };

    const onPeerVideo = (payload: { action: "Start" | "Stop"; userId: number }) => {
      if (payload.action === "Start") void attachRemote(payload.userId);
      else void detachRemote(payload.userId);
      syncPeople();
    };

    const onMediaFailed = (payload: { code: number; type: string; message: string }) => {
      // The SDK's own table of what each failure needs from the person.
      const resumable = [106, 107, 207].includes(payload.code);
      const permission = [103, 203].includes(payload.code);
      setNotice({
        resume: resumable,
        text: resumable
          ? tr(
              "Another app used your camera or microphone for a moment. Tap Restore to bring it back.",
              "Kisi aur app ne thori der camera ya mic liya. Wapas lane ke liye Restore dabayein.",
            )
          : permission
            ? tr(
                "Permission for the camera or microphone was turned off. Allow it in the browser, then refresh.",
                "Camera ya mic ki ijazat band ho gayi. Browser mein ijazat dein, phir refresh karein.",
              )
            : payload.code === 105
              ? tr(
                  "Your microphone is muted in this device's settings.",
                  "Aap ka mic is device ki settings mein band hai.",
                )
              : tr(
                  "Your camera or microphone stopped. Refresh the page to reconnect.",
                  "Aap ka camera ya mic ruk gaya. Dobara judne ke liye page refresh karein.",
                ),
      });
    };

    const onAutoplayFailed = () => setSoundBlocked(true);
    const onAudioChange = () => {
      if (stream.current) setMicOn(!stream.current.isAudioMuted());
    };

    client.on("connection-change", onConnection);
    client.on("peer-video-state-change", onPeerVideo);
    client.on("user-added", syncPeople);
    client.on("user-removed", syncPeople);
    client.on("user-updated", syncPeople);
    client.on("active-media-failed", onMediaFailed);
    client.on("auto-play-audio-failed", onAutoplayFailed);
    client.on("current-audio-change", onAudioChange);

    void (async () => {
      try {
        const media = await joinOnce(session);
        if (disposed) return;
        stream.current = media;
        selfId.current = client.getCurrentUserInfo().userId;
        setPhase("live");
        // Sound first: a consultation can go on without a picture, and not
        // without voices.
        await startAudio();
        if (disposed) return;
        await startVideo(isPhone() ? MobileVideoFacingMode.User : undefined);
        if (disposed) return;
        syncPeople();
      } catch (error) {
        if (!disposed) finish({ kind: "failed", reason: reasonOf(error) });
      }
    })();

    return () => {
      disposed = true;
      client.off("connection-change", onConnection);
      client.off("peer-video-state-change", onPeerVideo);
      client.off("user-added", syncPeople);
      client.off("user-removed", syncPeople);
      client.off("user-updated", syncPeople);
      client.off("active-media-failed", onMediaFailed);
      client.off("auto-play-audio-failed", onAutoplayFailed);
      client.off("current-audio-change", onAudioChange);
    };
    // Mounted once per call; the token does not change under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -- controls --------------------------------------------------------------

  const toggleMic = async () => {
    const media = stream.current;
    if (!media || busy) return;
    setBusy("mic");
    try {
      if (soundBlocked) await startAudio();
      else if (media.isAudioMuted()) await media.unmuteAudio();
      else await media.muteAudio();
      setMicOn(!media.isAudioMuted());
    } catch (error) {
      setNotice({ text: reasonOf(error) });
    } finally {
      setBusy(null);
    }
  };

  const toggleCam = async () => {
    if (busy) return;
    setBusy("cam");
    try {
      if (camOn) await stopVideo();
      else await startVideo(isPhone() ? facing : undefined);
    } finally {
      setBusy(null);
    }
  };

  const flipCamera = async () => {
    const media = stream.current;
    if (!media || busy || !camOn) return;
    setBusy("flip");
    const next =
      facing === MobileVideoFacingMode.User ? MobileVideoFacingMode.Environment : MobileVideoFacingMode.User;
    try {
      await media.switchCamera(next);
      setFacing(next);
    } catch (error) {
      setNotice({ text: reasonOf(error) });
    } finally {
      setBusy(null);
    }
  };

  const leave = async () => {
    if (busy === "leave") return;
    setBusy("leave");
    try {
      // The doctor ends the room for both; the patient only steps out of it.
      await client.leave(host);
    } catch {
      // Leaving a room that has already closed is still leaving it.
    }
    finish(host ? { kind: "ended", byHost: true } : { kind: "left" });
  };

  const restore = () => {
    // A click is what the SDK needs to take the device back; starting audio
    // again from inside it covers the microphone case too.
    setNotice(null);
    void startAudio();
  };

  // -- the clock ---------------------------------------------------------------

  const remaining = (new Date(endsAt).getTime() - now) / 1000;
  const elapsed = (now - startedAt) / 1000;
  const overtime = remaining < 0;

  const control =
    "grid h-12 w-12 place-items-center rounded-full text-white transition-[background-color,transform] duration-200 hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60 sm:h-14 sm:w-14";

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl bg-slate-950">
      <video-player-container ref={container} className="consult-stage" />

      {/* Waiting for the other person — the most common thing to see first. */}
      {phase !== "connecting" && (!remote || !remote.videoOn) && (
        <div className="pointer-events-none absolute inset-0 z-[1] grid place-items-center p-6 text-center">
          <div>
            <div className="mx-auto w-fit">
              <Avatar name={remote?.name ?? counterpart} size="lg" ring={remote ? "active" : undefined} />
            </div>
            <p className="mt-3 font-display text-lg font-bold text-white">
              {remote?.name ?? counterpart}
            </p>
            <p className="mt-1 text-sm text-white/70">
              {remote
                ? tr("Camera is off", "Camera band hai")
                : host
                  ? tr("Waiting for your patient to join…", "Mareez ke join karne ka intezar…")
                  : tr("Waiting for your doctor to join…", "Doctor ke join karne ka intezar…")}
            </p>
          </div>
        </div>
      )}

      {phase === "connecting" && (
        <div className="absolute inset-0 z-[3] grid place-items-center bg-slate-950/80 text-center text-white">
          <div role="status">
            <span
              aria-hidden
              className="mx-auto block h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white"
            />
            <p className="mt-3 text-sm">{tr("Connecting securely…", "Mehfooz connection ban raha hai…")}</p>
          </div>
        </div>
      )}

      {/* Top bar: who, and how long. */}
      <div className="absolute inset-x-0 top-0 z-[4] flex flex-wrap items-center gap-2 bg-gradient-to-b from-black/60 to-transparent p-3 text-white">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-xs font-semibold">
          <span
            aria-hidden
            className={cx(
              "h-2 w-2 rounded-full",
              phase === "live" ? "bg-emerald-400" : "animate-pulse bg-amber-400",
            )}
          />
          {phase === "reconnecting" ? tr("Reconnecting…", "Dobara jur raha hai…") : clock(elapsed)}
        </span>
        <span
          className={cx(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums",
            overtime ? "bg-amber-500/90 text-black" : "bg-black/45",
          )}
        >
          <Icon name="timer" className="text-[14px]" />
          {overtime
            ? tr(`${clock(-remaining)} over time`, `${clock(-remaining)} waqt se zyada`)
            : tr(`${Math.ceil(remaining / 60)} min left`, `${Math.ceil(remaining / 60)} min baqi`)}
        </span>
        {remote && (
          <span className="ml-auto inline-flex min-w-0 items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-xs font-semibold">
            <Icon name={remote.muted ? "mic_off" : "mic"} className="text-[14px]" />
            <span className="truncate">{remote.name}</span>
            {remote.unstable && <span className="text-amber-300">· {tr("weak signal", "kamzor signal")}</span>}
          </span>
        )}
        <span className="inline-flex items-center gap-1 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-semibold">
          <Icon name="lock" className="text-[13px]" />
          {tr("Not recorded", "Record nahi ho rahi")}
        </span>
      </div>

      {(notice || soundBlocked) && (
        <div className="absolute inset-x-3 top-14 z-[5] flex flex-wrap items-start gap-2 rounded-xl bg-white/95 p-3 text-sm text-slate-900 shadow-lg">
          <Icon name="info" className="mt-px shrink-0 text-[18px] text-amber-600" />
          <span className="min-w-0 flex-1">
            {soundBlocked
              ? tr("Tap to turn the sound on.", "Awaz chalane ke liye tap karein.")
              : notice?.text}
          </span>
          {(soundBlocked || notice?.resume) && (
            <button
              type="button"
              onClick={restore}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
            >
              {soundBlocked ? tr("Turn on sound", "Awaz chalayein") : tr("Restore", "Wapas layein")}
            </button>
          )}
          {!soundBlocked && (
            <button
              type="button"
              aria-label={tr("Dismiss", "Band karein")}
              onClick={() => setNotice(null)}
              className="rounded-lg px-1.5 text-slate-500"
            >
              <Icon name="close" className="text-[18px]" />
            </button>
          )}
        </div>
      )}

      {/* Controls. Large, few, and the red one is the one that ends things. */}
      <div className="safe-bottom absolute inset-x-0 bottom-0 z-[4] flex items-center justify-center gap-3 bg-gradient-to-t from-black/70 to-transparent p-4">
        <button
          type="button"
          onClick={() => void toggleMic()}
          disabled={phase === "connecting" || busy === "mic"}
          aria-pressed={!micOn}
          aria-label={micOn ? tr("Mute microphone", "Mic band karein") : tr("Unmute microphone", "Mic chalayein")}
          className={cx(control, micOn ? "bg-white/20 hover:bg-white/30" : "bg-rose-600 hover:bg-rose-500")}
        >
          <Icon name={micOn ? "mic" : "mic_off"} className="text-[24px]" />
        </button>
        <button
          type="button"
          onClick={() => void toggleCam()}
          disabled={phase === "connecting" || busy === "cam"}
          aria-pressed={!camOn}
          aria-label={camOn ? tr("Turn camera off", "Camera band karein") : tr("Turn camera on", "Camera chalayein")}
          className={cx(control, camOn ? "bg-white/20 hover:bg-white/30" : "bg-rose-600 hover:bg-rose-500")}
        >
          <Icon name={camOn ? "videocam" : "videocam_off"} className="text-[24px]" />
        </button>
        {typeof navigator !== "undefined" && isPhone() && (
          <button
            type="button"
            onClick={() => void flipCamera()}
            disabled={!camOn || busy === "flip"}
            aria-label={tr("Switch camera", "Camera badlein")}
            className={cx(control, "bg-white/20 hover:bg-white/30")}
          >
            <Icon name="flip_camera_ios" className="text-[24px]" />
          </button>
        )}
        <button
          type="button"
          onClick={() => void leave()}
          disabled={busy === "leave"}
          className="inline-flex h-12 items-center gap-2 rounded-full bg-rose-600 px-5 font-semibold text-white transition-colors hover:bg-rose-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:h-14"
        >
          <Icon name="call_end" className="text-[24px]" />
          {host ? tr("End call", "Call khatam") : tr("Leave", "Nikal jayein")}
        </button>
      </div>
    </div>
  );
}
